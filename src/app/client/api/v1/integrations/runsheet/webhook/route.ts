/**
 * Runsheet Connect Webhook Endpoint
 *
 * Accepts inbound webhook events from the Runsheet logistics dispatch API.
 * Validates HMAC-SHA256 signatures, enforces replay protection, deduplicates
 * by eventId, and processes shipment_status / rider_assignment events.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 18.7, 18.8
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../../convex/_generated/api";
import { validateRunsheetSignature } from "@/lib/integrations/runsheetClient";
import { internalSecretArg } from "@/lib/internal-auth";

// ============================================================================
// Types
// ============================================================================

interface RunsheetWebhookPayload {
  eventId: string;
  eventType: "shipment_status" | "rider_assignment";
  timestamp: string; // ISO 8601
  payload: {
    shipmentId: string;
    deliveryStatus?: string;
    riderId?: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// Helpers
// ============================================================================

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes (Req 18.8)

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("[runsheet-webhook] NEXT_PUBLIC_CONVEX_URL not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Look up the business that owns this webhook secret.
 * In production, the businessId would come from the URL path or a header.
 * For now, we extract it from the x-runsheet-business-id header.
 */
function getBusinessId(request: NextRequest): string | null {
  return request.headers.get("x-runsheet-business-id");
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read raw body
  let rawBody: string;
  let body: RunsheetWebhookPayload;

  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // 2. Basic payload validation
  if (!body.eventId || !body.eventType || !body.timestamp || !body.payload) {
    return NextResponse.json(
      { error: "Missing required fields: eventId, eventType, timestamp, payload" },
      { status: 400 }
    );
  }

  if (!["shipment_status", "rider_assignment"].includes(body.eventType)) {
    return NextResponse.json(
      { error: `Unsupported eventType: ${body.eventType}` },
      { status: 400 }
    );
  }

  // 3. Validate HMAC-SHA256 signature (Req 8.2, 18.7)
  const signature = request.headers.get("x-runsheet-signature") || "";

  // Resolve per-business webhook secret from the database, falling back to env var
  const businessId = getBusinessId(request);
  let webhookSecret: string | null = null;

  if (businessId) {
    const convexClientForSecret = getConvexClient();
    if (convexClientForSecret) {
      try {
        webhookSecret = await convexClientForSecret.query(
          api.runsheetWebhook.getBusinessWebhookSecret,
          { businessId, ...internalSecretArg() }
        );
      } catch (err) {
        console.error("[runsheet-webhook] Failed to fetch per-business secret:", err);
      }
    }
  }

  // Fall back to global env var only if no per-business secret found
  if (!webhookSecret) {
    webhookSecret = process.env.RUNSHEET_WEBHOOK_SECRET ?? null;
  }

  if (!webhookSecret) {
    console.error("[runsheet-webhook] No webhook secret configured for business:", businessId);
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  const isValid = validateRunsheetSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("[runsheet-webhook] Invalid signature for event:", body.eventId);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // 4. Replay protection — reject events older than 5 minutes (Req 18.8)
  const eventTimestamp = new Date(body.timestamp).getTime();
  const now = Date.now();

  if (isNaN(eventTimestamp)) {
    return NextResponse.json(
      { error: "Invalid timestamp format" },
      { status: 400 }
    );
  }

  if (now - eventTimestamp > REPLAY_WINDOW_MS) {
    console.warn("[runsheet-webhook] Replay rejected — event too old:", body.eventId);
    return NextResponse.json(
      { error: "Event timestamp too old (replay protection)" },
      { status: 403 }
    );
  }

  // 5. Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // 6. Deduplication check (Req 8.7)
  try {
    const existing = await convexClient.query(
      api.runsheetWebhook.checkDeduplication,
      { eventId: body.eventId, provider: "runsheet", ...internalSecretArg() }
    );

    if (existing) {
      // Already processed — return 200 for idempotency
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }
  } catch (err) {
    console.error("[runsheet-webhook] Deduplication check failed:", err);
    return NextResponse.json(
      { error: "Internal error during deduplication check" },
      { status: 500 }
    );
  }

  // 7. Process the event based on eventType
  const { shipmentId } = body.payload;

  if (!shipmentId) {
    return NextResponse.json(
      { error: "Missing payload.shipmentId" },
      { status: 400 }
    );
  }

  try {
    let result: { found: boolean };

    if (body.eventType === "shipment_status") {
      // Req 8.3: Update shipment deliveryStatus
      const deliveryStatus = body.payload.deliveryStatus;
      if (!deliveryStatus) {
        return NextResponse.json(
          { error: "Missing payload.deliveryStatus for shipment_status event" },
          { status: 400 }
        );
      }

      result = await convexClient.mutation(
        api.runsheetWebhook.updateShipmentFromWebhook,
        {
          shipmentId,
          deliveryStatus,
          eventId: body.eventId,
          eventType: "shipment_status",
          payload: JSON.stringify(body.payload),
          ...internalSecretArg(),
        }
      );
    } else {
      // rider_assignment — Req 8.4: Update shipment assignedRiderId
      const riderId = body.payload.riderId;
      if (!riderId) {
        return NextResponse.json(
          { error: "Missing payload.riderId for rider_assignment event" },
          { status: 400 }
        );
      }

      result = await convexClient.mutation(
        api.runsheetWebhook.updateRiderFromWebhook,
        {
          shipmentId,
          riderId,
          eventId: body.eventId,
          payload: JSON.stringify(body.payload),
          ...internalSecretArg(),
        }
      );
    }

    // 8. Handle unmatched shipmentId (Req 8.6)
    if (!result.found) {
      console.warn("[runsheet-webhook] Unmatched shipmentId:", shipmentId);

      const businessId = getBusinessId(request);
      if (businessId) {
        await convexClient.mutation(
          api.runsheetWebhook.incrementRunsheetFailureCount,
          { businessId, ...internalSecretArg() }
        );
      }

      // Record deduplication even for unmatched — prevents reprocessing
      await convexClient.mutation(
        api.runsheetWebhook.recordDeduplication,
        { eventId: body.eventId, provider: "runsheet", ...internalSecretArg() }
      );

      return NextResponse.json(
        { status: "unmatched_shipment", shipmentId },
        { status: 200 }
      );
    }

    // 9. Record deduplication entry (Req 8.7)
    await convexClient.mutation(
      api.runsheetWebhook.recordDeduplication,
      { eventId: body.eventId, provider: "runsheet", ...internalSecretArg() }
    );

    return NextResponse.json(
      { status: "processed", eventId: body.eventId },
      { status: 200 }
    );
  } catch (err) {
    console.error("[runsheet-webhook] Processing error:", err);
    return NextResponse.json(
      { error: "Internal processing error" },
      { status: 500 }
    );
  }
}
