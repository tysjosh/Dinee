/**
 * Logistics API — Update Shipment Status
 *
 * POST /api/v1/logistics/shipments/{shipmentId}/status — Update the delivery status of a shipment
 *
 * Dispatches webhook events:
 *   - `shipment.delivered` when status transitions to "delivered"
 *   - `shipment.failed` when status transitions to "failed"
 *   - `shipment.status_updated` for all other valid transitions
 *
 * @module api/logistics/shipments/[shipmentId]/status
 * @requirements 7.6, 7.9, 7.10, 7.11, 7.12, 17.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { authorizeLogisticsAccess } from '@/lib/logistics/authorization';
import { isLogisticsEnabled } from '@/lib/logistics/feature-gate';
import { getOrCreateRequestId } from '@/lib/logistics/correlation';
import { reserveIdempotency, storeIdempotencyResult, storeIdempotencyFailure, hashRequestBody } from '@/lib/logistics/idempotency';
import { dispatchLogisticsWebhookEvent } from '@/lib/logistics/webhook-dispatch';
import { createLogger } from '@/lib/logger';
import type { ApiErrorResponse } from '@/lib/partner-api/types';

const logger = createLogger('logistics-api');

// ============================================================================
// Constants
// ============================================================================

const VALID_DELIVERY_STATUSES = new Set([
  'created', 'assigned', 'picked_up', 'in_transit',
  'delivered', 'failed', 'cancelled',
]);

// ============================================================================
// Helper
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

/**
 * Determine the webhook event type based on the new delivery status.
 */
function getWebhookEventType(newStatus: string): string {
  switch (newStatus) {
    case 'delivered':
      return 'shipment.delivered';
    case 'failed':
      return 'shipment.failed';
    default:
      return 'shipment.status_updated';
  }
}

// ============================================================================
// POST — Update Shipment Status
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

    // 5. Parse body
    const body = await request.json();
    const { newStatus, failureReason, proofOfDelivery, actorType, actorId } = body;

    // Compute request hash early so it's available in the catch block for failed idempotency storage
    bodyHash = hashRequestBody(body);

    if (!newStatus) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required field: newStatus' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Validate newStatus is a valid delivery status
    if (!VALID_DELIVERY_STATUSES.has(newStatus)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Invalid status: "${newStatus}". Valid statuses: ${[...VALID_DELIVERY_STATUSES].join(', ')}`,
        },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 7. Get shipment to verify it belongs to the tenant
    const shipment = await convexClient.query(api.logistics.shipments.getShipment, {
      shipmentId,
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `Shipment '${shipmentId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 8. Cross-validate shipment belongs to the tenant (Req 2.7)
    if (shipment.organizationId !== tenantId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 9. Idempotency check
    parsedIdempotencyKey = request.headers.get('X-Idempotency-Key');
    const idempotencyKey = parsedIdempotencyKey;
    if (idempotencyKey) {
      const reqHash = bodyHash;
      // Atomically reserve the key before any side effects.
      const idempotencyResult = await reserveIdempotency(
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

      if ('inProgress' in idempotencyResult && idempotencyResult.inProgress) {
        logger.warn('Concurrent duplicate idempotent request in progress', {
          tenantId,
          vertical: 'logistics',
          endpoint: `/api/v1/logistics/shipments/${shipmentId}/status`,
          method: 'POST',
          requestId,
          correlationId,
        });
        return NextResponse.json(
          {
            error: 'Conflict',
            message: 'A request with this idempotency key is already being processed',
          },
          { status: 409, headers: { 'X-Request-Id': requestId } }
        );
      }
      // else: reserved → proceed with the mutation below
    }

    // Req 4.1, 4.2: Audit log for status update request
    logger.info('Shipment status update request', {
      tenantId,
      vertical: 'logistics',
      endpoint: `/api/v1/logistics/shipments/${shipmentId}/status`,
      method: 'POST',
      resourceId: shipmentId,
      requestId,
      correlationId,
    });

    // 10. Call updateShipmentStatus mutation
    const result = await convexClient.mutation(api.logistics.shipments.updateShipmentStatus, {
      shipmentId,
      newStatus,
      ...(failureReason ? { failureReason } : {}),
      ...(proofOfDelivery ? { proofOfDelivery } : {}),
      ...(actorType ? { actorType } : {}),
      ...(actorId ? { actorId } : {}),
      // Req 17.8: Propagate correlationId to shipment events via mutation
      ...(correlationId ? { correlationId } : {}),
    });

    const responseBody = JSON.stringify({
      success: true,
      data: {
        shipmentId: result.shipmentId,
        oldStatus: result.oldStatus,
        newStatus: result.newStatus,
      },
    });

    // 11. Store idempotency result
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

    // 12. Dispatch webhook — use specific event type based on new status
    const webhookEventType = getWebhookEventType(newStatus);
    await dispatchLogisticsWebhookEvent(convexClient, {
      shipmentId: result.shipmentId,
      eventType: webhookEventType,
      payload: JSON.stringify({
        shipmentId: result.shipmentId,
        organizationId: shipment.organizationId,
        oldStatus: result.oldStatus,
        newStatus: result.newStatus,
        ...(failureReason ? { failureReason } : {}),
      }),
      requestId,
      // Req 17.5: Propagate correlationId to webhook payloads for voice-originated requests
      correlationId,
    });

    // 13. Return 200
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update shipment status';

    // Req 3.8: Finalize the idempotency reservation as "failed" for ANY error
    // so a retry re-executes rather than being blocked by a lingering "pending"
    // reservation.
    if (parsedIdempotencyKey && bodyHash) {
      await storeIdempotencyFailure(convexClient, parsedIdempotencyKey, context.partnerId, bodyHash, message).catch(() => {});
    }

    // Handle invalid transition errors (422)
    if (message.startsWith('Invalid status transition:')) {
      logger.warn('Invalid status transition rejected', {
        tenantId: request.headers.get('X-Tenant-Id') || undefined,
        vertical: 'logistics',
        endpoint: `/api/v1/logistics/shipments/${shipmentId}/status`,
        method: 'POST',
        resourceId: shipmentId,
        requestId,
        correlationId,
      });
      return NextResponse.json(
        { error: 'Unprocessable Entity', message },
        { status: 422, headers: { 'X-Request-Id': requestId } }
      );
    }

    // Handle missing failureReason or invalid proof of delivery
    if (
      message.includes('failureReason is required') ||
      message.includes('Proof of delivery must include')
    ) {
      return NextResponse.json(
        { error: 'Unprocessable Entity', message },
        { status: 422, headers: { 'X-Request-Id': requestId } }
      );
    }

    // Handle shipment not found from mutation
    if (message.startsWith('Shipment not found:')) {
      return NextResponse.json(
        { error: 'Not Found', message },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    logger.error('Shipment status update failed', {
      tenantId: request.headers.get('X-Tenant-Id') || undefined,
      vertical: 'logistics',
      endpoint: `/api/v1/logistics/shipments/${shipmentId}/status`,
      method: 'POST',
      resourceId: shipmentId,
      requestId,
      correlationId,
      error: message,
    });
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update shipment status' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
