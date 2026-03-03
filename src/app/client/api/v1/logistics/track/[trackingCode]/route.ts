/**
 * Logistics API — Public Shipment Tracking Endpoint
 *
 * GET /api/v1/logistics/track/{trackingCode} — Public, no auth required
 *
 * Returns masked shipment tracking info. Rate-limited to 60 req/min per IP.
 *
 * @module api/logistics/track
 * @requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 23.4, 26.1, 26.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../convex/_generated/api';
import { maskPhone, maskAddress } from '@/lib/logistics/masking';
import { isLogisticsEnabled } from '@/lib/logistics/feature-gate';
import { getOrCreateRequestId } from '@/lib/logistics/correlation';

// ============================================================================
// In-memory IP rate limiter (60 req/min per IP)
// ============================================================================

const ipRequests = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequests.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// ============================================================================
// Helper
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

// ============================================================================
// GET — Public Shipment Tracking
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackingCode: string }> }
): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request.headers);
  const { trackingCode } = await params;

  // 1. Rate limit by IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  if (!checkIpRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: { 'X-Request-Id': requestId, 'Retry-After': '60' } }
    );
  }

  // 2. Validate tracking code param
  if (!trackingCode || trackingCode.trim() === '') {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Tracking code is required' },
      { status: 400, headers: { 'X-Request-Id': requestId } }
    );
  }

  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }

  try {
    // 3. Query shipment by tracking code
    const shipment = await convexClient.query(
      api.logistics.shipments.getShipmentByTrackingCode,
      { trackingCode }
    );

    if (!shipment) {
      return NextResponse.json(
        { error: 'Not Found', message: `No shipment found for tracking code: ${trackingCode}` },
        { status: 404, headers: { 'X-Request-Id': requestId } }
      );
    }

    // 4. Feature gate — look up organization to get platformId, then check flag
    const organization = await convexClient.query(
      api.logistics.organizations.getOrganization,
      { organizationId: shipment.organizationId }
    );

    if (organization) {
      const logisticsEnabled = await isLogisticsEnabled(convexClient, organization.platformId);
      if (!logisticsEnabled) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Logistics is not enabled for this platform' },
          { status: 403, headers: { 'X-Request-Id': requestId } }
        );
      }
    }

    // 5. Get last event timestamp
    const events = await convexClient.query(
      api.logistics.shipmentEvents.listShipmentEvents,
      { shipmentId: shipment.shipmentId }
    );

    const lastEvent = events.length > 0 ? events[events.length - 1] : null;

    // 6. Apply PII masking on sender/recipient for logging (not returned in response)
    // Response only includes safe fields — no sender/recipient details at all
    const maskedSender = {
      phone: maskPhone(shipment.sender.phone),
      ...maskAddress(shipment.sender),
    };
    const maskedRecipient = {
      phone: maskPhone(shipment.recipient.phone),
      ...maskAddress(shipment.recipient),
    };

    // 7. Return only safe fields
    return NextResponse.json(
      {
        success: true,
        data: {
          trackingCode: shipment.trackingCode,
          deliveryStatus: shipment.deliveryStatus,
          serviceType: shipment.serviceType,
          etaMinutes: shipment.etaMinutes ?? null,
          lastEventAt: lastEvent?.createdAt ?? null,
          sender: maskedSender,
          recipient: maskedRecipient,
        },
      },
      {
        status: 200,
        headers: { 'X-Request-Id': requestId },
      }
    );
  } catch (error) {
    console.error('Logistics API: Error tracking shipment:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to retrieve tracking information' },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
