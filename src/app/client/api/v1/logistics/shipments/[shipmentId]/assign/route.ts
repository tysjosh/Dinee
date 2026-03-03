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
import { checkIdempotency, storeIdempotencyResult, hashRequestBody } from '@/lib/logistics/idempotency';
import { dispatchLogisticsWebhookEvent } from '@/lib/logistics/webhook-dispatch';
import type { ApiErrorResponse } from '@/lib/partner-api/types';

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

  try {
    // 2. Feature gate — look up partner to get platformId
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

    // 3. Parse body — riderId is required
    const body = await request.json();
    const { riderId } = body;

    if (!riderId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required field: riderId' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Get shipment to find organizationId for authorization
    const shipment = await convexClient.query(api.logistics.shipments.getShipment, {
      shipmentId,
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `Shipment '${shipmentId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Authorization — verify partner owns the organization
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, shipment.organizationId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Idempotency check
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    if (idempotencyKey) {
      const reqHash = hashRequestBody(body);
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
    }

    // 7. Assign rider via Convex mutation
    const result = await convexClient.mutation(api.logistics.shipments.assignRider, {
      shipmentId,
      riderId,
    });

    const responseBody = JSON.stringify({
      success: true,
      data: {
        shipmentId: result.shipmentId,
        riderId: result.riderId,
        newStatus: result.newStatus,
      },
    });

    // 8. Store idempotency result
    if (idempotencyKey) {
      const reqHash = hashRequestBody(body);
      await storeIdempotencyResult(
        convexClient,
        idempotencyKey,
        context.partnerId,
        reqHash,
        200,
        responseBody
      );
    }

    // 9. Dispatch webhook
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
    });

    // 10. Return 200
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
      return NextResponse.json(
        { error: 'Conflict', message: message.replace('409: ', '') },
        { status: 409, headers: { 'X-Request-Id': requestId } }
      );
    }

    console.error('Logistics API: Error assigning rider:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to assign rider' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
