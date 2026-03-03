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
import { checkIdempotency, storeIdempotencyResult, hashRequestBody } from '@/lib/logistics/idempotency';
import { dispatchLogisticsWebhookEvent } from '@/lib/logistics/webhook-dispatch';
import type { ApiErrorResponse } from '@/lib/partner-api/types';

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

    // 3. Parse body
    const body = await request.json();
    const { newStatus, failureReason, proofOfDelivery, actorType, actorId } = body;

    if (!newStatus) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required field: newStatus' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Validate newStatus is a valid delivery status
    if (!VALID_DELIVERY_STATUSES.has(newStatus)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Invalid status: "${newStatus}". Valid statuses: ${[...VALID_DELIVERY_STATUSES].join(', ')}`,
        },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Get shipment to find organizationId for authorization
    const shipment = await convexClient.query(api.logistics.shipments.getShipment, {
      shipmentId,
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `Shipment '${shipmentId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Authorization — verify partner owns the organization
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, shipment.organizationId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 7. Idempotency check
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

    // 8. Call updateShipmentStatus mutation
    const result = await convexClient.mutation(api.logistics.shipments.updateShipmentStatus, {
      shipmentId,
      newStatus,
      ...(failureReason ? { failureReason } : {}),
      ...(proofOfDelivery ? { proofOfDelivery } : {}),
      ...(actorType ? { actorType } : {}),
      ...(actorId ? { actorId } : {}),
    });

    const responseBody = JSON.stringify({
      success: true,
      data: {
        shipmentId: result.shipmentId,
        oldStatus: result.oldStatus,
        newStatus: result.newStatus,
      },
    });

    // 9. Store idempotency result
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

    // 10. Dispatch webhook — use specific event type based on new status
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
    });

    // 11. Return 200
    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update shipment status';

    // Handle invalid transition errors (422)
    if (message.startsWith('Invalid status transition:')) {
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

    console.error('Logistics API: Error updating shipment status:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update shipment status' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
