/**
 * Logistics API — Rider Status Heartbeat
 *
 * POST /api/v1/logistics/riders/{riderId}/status — Update rider status and location
 *
 * No idempotency needed — this is a status update (heartbeat), not a create.
 *
 * @module api/logistics/riders/[riderId]/status
 * @requirements 7.8, 7.9, 7.10, 23.5
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { authorizeLogisticsAccess } from '@/lib/logistics/authorization';
import { isLogisticsEnabled } from '@/lib/logistics/feature-gate';
import { getOrCreateRequestId } from '@/lib/logistics/correlation';
import type { ApiErrorResponse } from '@/lib/partner-api/types';

// ============================================================================
// Constants
// ============================================================================

const VALID_RIDER_STATUSES = new Set(['offline', 'available', 'busy']);

// ============================================================================
// Helper
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

// ============================================================================
// POST — Rider Status Heartbeat
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ riderId: string }> }
): Promise<NextResponse> {
  const { riderId } = await params;
  const requestId = getOrCreateRequestId(request.headers);

  // 1. Auth
  const validation = await validateApiRequest(request, {
    requiredScopes: ['riders:write'],
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
    const { status, location } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Missing required field: status' },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    if (!VALID_RIDER_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Invalid status: "${status}". Valid statuses: ${[...VALID_RIDER_STATUSES].join(', ')}`,
        },
        { status: 400, headers: { 'X-Request-Id': requestId } }
      );
    }

    // Validate location shape if provided
    if (location) {
      if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
        return NextResponse.json(
          { error: 'Bad Request', message: 'location must include numeric lat and lng' },
          { status: 400, headers: { 'X-Request-Id': requestId } }
        );
      }
    }

    // 4. Get rider to find organizationId for authorization
    const rider = await convexClient.query(api.logistics.riders.getRider, {
      riderId,
    });

    if (!rider) {
      return NextResponse.json(
        { error: 'Not Found', message: `Rider '${riderId}' not found` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 5. Authorization — verify partner owns the rider's organization
    const authz = await authorizeLogisticsAccess(convexClient, context.partnerId, rider.organizationId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 6. Call updateRiderStatus mutation
    const result = await convexClient.mutation(api.logistics.riders.updateRiderStatus, {
      riderId,
      status,
      ...(location ? { location } : {}),
    });

    // 7. Return 200
    return NextResponse.json(
      {
        success: true,
        data: {
          riderId: result.riderId,
          status: result.status,
        },
      },
      { status: 200, headers: { 'X-Request-Id': requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update rider status';

    // Handle rider not found from mutation
    if (message.startsWith('Rider not found:')) {
      return NextResponse.json(
        { error: 'Not Found', message },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    console.error('Logistics API: Error updating rider status:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update rider status' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
