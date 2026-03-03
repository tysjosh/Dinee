/**
 * Logistics API — Single Shipment Endpoint
 *
 * GET /api/v1/logistics/shipments/{shipmentId} — Retrieve a single shipment
 *
 * @module api/logistics/shipments/[shipmentId]
 * @requirements 7.3, 7.9, 7.10, 7.11, 7.12
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { authorizeLogisticsAccess } from '@/lib/logistics/authorization';
import { isLogisticsEnabled } from '@/lib/logistics/feature-gate';
import { getOrCreateRequestId } from '@/lib/logistics/correlation';
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
// GET — Single Shipment
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
): Promise<NextResponse> {
  const { shipmentId } = await params;
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

    // 5. Query shipment
    const shipment = await convexClient.query(api.logistics.shipments.getShipment, {
      shipmentId,
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `Shipment '${shipmentId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Cross-validate shipment belongs to the tenant (Req 2.7)
    if (shipment.organizationId !== tenantId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 7. Return 200
    return NextResponse.json(
      {
        success: true,
        data: shipment,
      },
      {
        status: 200,
        headers: { 'X-Request-Id': requestId },
      }
    );
  } catch (error) {
    console.error('Logistics API: Error fetching shipment:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch shipment' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
