/**
 * Logistics API — Assign Rider to Shipment
 *
 * POST /api/v1/logistics/shipments/{shipmentId}/assign — Assign a rider to a shipment
 *
 * @module api/logistics/shipments/[shipmentId]/assign
 * @requirements 7.5, 7.9, 7.10, 7.11, 7.12
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { authorizeLogisticsAccess } from '@/lib/logistics/authorization';
import { isLogisticsEnabled } from '@/lib/logistics/feature-gate';
import { getOrCreateRequestId } from '@/lib/logistics/correlation';
import { checkIdempotency, storeIdempotencyResult, storeIdempotencyFailure, hashRequestBody } from '@/lib/logistics/idempotency';
import { dispatchLogisticsWebhookEvent } from '@/lib/logistics/webhook-dispatch';
import { createLogger } from '@/lib/logger';
import type { ApiErrorResponse } from '@/lib/partner-api/types';

const logger = createLogger('logistics-api');

// ============================================================================
// Helper
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

// ============================================================================
// POST — Assign Rider to Shipment
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
): Promise<NextResponse> {
  const { shipmentId } = await params;
  const requestId = getOrCreateRequestId(request.headers);
  // Req 17.3: Read correlationId from voice-originated requests
  const correlationId = request.headers.get('X-Correlation-Id') || undefined;

  // 1. Auth
  const validation = await validateApiRequest(request, {
    requiredScopes: ['shipments:write'],
  });

  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }

  const { context } = validation;

  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }

  // Track these outside try for catch block access (Req 3.8)
  let bodyHash: string | undefined;
  let parsedIdempotencyKey: string | null = null;

  try {
    // 2. Require X-Tenant-Id header (Req 2.1, 2.5)
    const tenantId = request.headers.get('X-Tenant-Id');
    if (!tenantId) {
      return NextResponse.json(
        { error: 'X-Tenant-Id header is required' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 3. Feature gate — look up partner to get platformId
    const partner = await convexClient.query(api.partners.getPartnerByPartnerId, {
      partnerId: context.partnerId,
    });

    if (!partner) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Partner not found' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    const logisticsEnabled = await isLogisticsEnabled(convexClient, partner.platformId);
    if (!logisticsEnabled) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Logistics is not enabled for this platform' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Authorization — verify partner owns the organization via X-Tenant-Id (Req 2.6, 2.7)
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, tenantId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Parse body — riderId is required
    const body = await request.json();
    const { riderId } = body;

    // Compute request hash early so it's available in the catch block for failed idempotency storage
    bodyHash = hashRequestBody(body);

    if (!riderId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required field: riderId' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Get shipment to verify it belongs to the tenant
    const shipment = await convexClient.query(api.logistics.shipments.getShipment, {
      shipmentId,
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `Shipment '${shipmentId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 7. Cross-validate shipment belongs to the tenant (Req 2.7)
    if (shipment.organizationId !== tenantId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 8. Idempotency check
    parsedIdempotencyKey = request.headers.get('X-Idempotency-Key');
    const idempotencyKey = parsedIdempotencyKey;
    if (idempotencyKey) {
      const reqHash = bodyHash;
      const idempotencyResult = await checkIdempotency(
        convexClient,
        idempotencyKey,
        context.partnerId,
        reqHash
      );

      if ('mismatch' in idempotencyResult && idempotencyResult.mismatch) {
        return NextResponse.json(
          {
            error: 'Unprocessable Entity',
            message: 'Idempotency key has already been used with a different request body',
          },
          { status: 422, headers: { 'X-Request-Id': requestId } }
        );
      }

      if ('replay' in idempotencyResult && idempotencyResult.replay) {
        return new NextResponse(idempotencyResult.body, {
          status: idempotencyResult.status,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
            'X-Idempotent-Replayed': 'true',
          },
        });
      }

      // Req 3.8, 3.9: If previous attempt failed, re-execute the mutation
      if ('failed' in idempotencyResult && idempotencyResult.failed) {
        logger.info('Re-executing previously failed idempotent request', {
          tenantId,
          vertical: 'logistics',
          endpoint: `/api/v1/logistics/shipments/${shipmentId}/assign`,
          method: 'POST',
          requestId,
          correlationId,
        });
      }
    }

    // Req 4.1, 4.2: Audit log for rider assignment request
    logger.info('Rider assignment request', {
      tenantId,
      vertical: 'logistics',
      endpoint: `/api/v1/logistics/shipments/${shipmentId}/assign`,
      method: 'POST',
      resourceId: shipmentId,
      requestId,
      correlationId,
    });

    // 9. Assign rider via Convex mutation
    const result = await convexClient.mutation(api.logistics.shipments.assignRider, {
      shipmentId,
      riderId,
      // Req 17.8: Propagate correlationId to shipment events via mutation
      ...(correlationId ? { correlationId } : {}),
    });

    const responseBody = JSON.stringify({
      success: true,
      data: {
        shipmentId: result.shipmentId,
        riderId: result.riderId,
        newStatus: result.newStatus,
      },
    });

    // 10. Store idempotency result
    if (idempotencyKey) {
      await storeIdempotencyResult(
        convexClient,
        idempotencyKey,
        context.partnerId,
        bodyHash,
        200,
        responseBody
      );
    }

    // 11. Dispatch webhook
    await dispatchLogisticsWebhookEvent(convexClient, {
      shipmentId: result.shipmentId,
      eventType: 'shipment.assigned',
      payload: JSON.stringify({
        shipmentId: result.shipmentId,
        riderId: result.riderId,
        organizationId: shipment.organizationId,
        newStatus: result.newStatus,
      }),
      requestId,
      // Req 17.5: Propagate correlationId to webhook payloads for voice-originated requests
      correlationId,
    });

    // 12. Return 200
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign rider';

    // Handle 409 Conflict from Convex mutation (rider not available)
    if (message.startsWith('409:')) {
      logger.warn('Rider assignment conflict', {
        tenantId: request.headers.get('X-Tenant-Id') || undefined,
        vertical: 'logistics',
        endpoint: `/api/v1/logistics/shipments/${shipmentId}/assign`,
        method: 'POST',
        resourceId: shipmentId,
        requestId,
        correlationId,
      });
      return NextResponse.json(
        { error: 'Conflict', message: message.replace('409: ', '') },
        { status: 409, headers: { 'X-Request-Id': requestId } }
      );
    }

    // Req 3.8: Store failed idempotency state on unexpected errors
    if (parsedIdempotencyKey && bodyHash) {
      await storeIdempotencyFailure(convexClient, parsedIdempotencyKey, context.partnerId, bodyHash, message).catch(() => {});
    }

    logger.error('Rider assignment failed', {
      tenantId: request.headers.get('X-Tenant-Id') || undefined,
      vertical: 'logistics',
      endpoint: `/api/v1/logistics/shipments/${shipmentId}/assign`,
      method: 'POST',
      resourceId: shipmentId,
      requestId,
      correlationId,
      error: message,
    });
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to assign rider' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
