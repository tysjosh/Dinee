/**
 * Logistics API — Shipments Endpoint
 *
 * POST /api/v1/logistics/shipments — Create a new shipment
 * GET  /api/v1/logistics/shipments — List shipments with pagination
 *
 * @module api/logistics/shipments
 * @requirements 7.1, 7.2, 7.4, 7.9, 7.10, 7.11, 7.12, 9.1, 9.4, 22.1, 22.3
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../convex/_generated/api';
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
// POST — Create Shipment
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    const {
      shipmentId,
      organizationId,
      locationId,
      customerId,
      sender,
      recipient,
      parcel,
      serviceType,
      paymentMethod,
      paymentStatus,
      etaMinutes,
    } = body;

    if (!shipmentId || !organizationId || !sender || !recipient || !parcel || !serviceType) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Missing required fields: shipmentId, organizationId, sender, recipient, parcel, serviceType',
        },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Authorization — verify partner owns the organization
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, organizationId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Idempotency check
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

    // 6. Create shipment via Convex mutation
    const shipment = await convexClient.mutation(api.logistics.shipments.createShipment, {
      shipmentId,
      organizationId,
      locationId,
      customerId,
      sender,
      recipient,
      parcel,
      serviceType,
      paymentMethod,
      paymentStatus,
      etaMinutes,
    });

    const responseBody = JSON.stringify({
      success: true,
      data: {
        shipmentId: shipment.shipmentId,
        trackingCode: shipment.trackingCode,
      },
    });

    // 7. Store idempotency result
    if (idempotencyKey) {
      const reqHash = hashRequestBody(body);
      await storeIdempotencyResult(
        convexClient,
        idempotencyKey,
        context.partnerId,
        reqHash,
        201,
        responseBody
      );
    }

    // 8. Dispatch webhook
    await dispatchLogisticsWebhookEvent(convexClient, {
      shipmentId: shipment.shipmentId,
      eventType: 'shipment.created',
      payload: JSON.stringify({
        shipmentId: shipment.shipmentId,
        trackingCode: shipment.trackingCode,
        organizationId,
        serviceType,
      }),
      requestId,
    });

    // 9. Return 201
    return new NextResponse(responseBody, {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create shipment';

    // Handle 409 Conflict from Convex mutation
    if (message.startsWith('409:')) {
      return NextResponse.json(
        { error: 'Conflict', message: message.replace('409: ', '') },
        { status: 409, headers: { 'X-Request-Id': requestId } }
      );
    }

    console.error('Logistics API: Error creating shipment:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create shipment' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}

// ============================================================================
// GET — List Shipments
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request.headers);

  // 1. Auth
  const validation = await validateApiRequest(request, {
    requiredScopes: ['shipments:read'],
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
    // 2. Feature gate
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

    // 3. Parse query params
    const searchParams = request.nextUrl.searchParams;
    const organizationId = searchParams.get('organizationId');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'organizationId query parameter is required' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Authorization
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, organizationId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Query shipments
    const validStatuses = ['created', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled'];
    const statusParam = status && validStatuses.includes(status) ? status as "created" | "assigned" | "picked_up" | "in_transit" | "delivered" | "failed" | "cancelled" : undefined;

    const result = await convexClient.query(api.logistics.shipments.listShipments, {
      organizationId,
      status: statusParam,
      page,
      perPage,
    });

    // 6. Return 200
    return NextResponse.json(
      {
        success: true,
        data: result.items,
        pagination: {
          page: result.page,
          perPage: result.perPage,
          totalCount: result.totalCount,
        },
      },
      {
        status: 200,
        headers: { 'X-Request-Id': requestId },
      }
    );
  } catch (error) {
    console.error('Logistics API: Error listing shipments:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to list shipments' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
