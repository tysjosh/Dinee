/**
 * Logistics Voice Agent Tool Pack
 *
 * Wrapper functions for logistics operations called by the voice agent.
 * Each tool calls the corresponding logistics API endpoint internally,
 * following the same pattern as restaurant tools in tools.ts.
 *
 * @module ws-server/logistics-tools
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { createLogger } from "../../lib/logger";

const logger = createLogger("ws-server-logistics-tools");

const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";

// ============================================================================
// Type Definitions
// ============================================================================

interface Address {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  lat?: number;
  lng?: number;
}

interface Parcel {
  type: string;
  weightKg?: number;
  dimensions?: string;
  declaredValue?: number;
  notes?: string;
}

interface CreateShipmentData {
  shipmentId: string;
  organizationId: string;
  locationId?: string;
  customerId?: string;
  sender: Address;
  recipient: Address;
  parcel: Parcel;
  serviceType: "same_day" | "next_day" | "express" | "scheduled";
  paymentMethod?: "paystack" | "flutterwave" | "cod" | "wallet";
  paymentStatus?: "pending" | "paid" | "failed" | "refunded";
  etaMinutes?: number;
}

interface UpdateShipmentData {
  newStatus: string;
  failureReason?: string;
  proofOfDelivery?: {
    photoUrl?: string;
    signatureUrl?: string;
    recipientName?: string;
    deliveredAt?: number;
  };
  actorType?: "system" | "agent" | "rider" | "merchant";
  actorId?: string;
}

interface QuoteDeliveryParams {
  sender: { city: string; state: string; lat?: number; lng?: number };
  recipient: { city: string; state: string; lat?: number; lng?: number };
  serviceType: "same_day" | "next_day" | "express" | "scheduled";
}

interface DeliveryQuote {
  estimatedCostNGN: number;
  etaMinutes: number;
  serviceType: string;
  currency: string;
}

// ============================================================================
// Base cost and ETA defaults by service type (NGN)
// ============================================================================

const SERVICE_DEFAULTS: Record<string, { baseCostNGN: number; etaMinutes: number }> = {
  same_day: { baseCostNGN: 2500, etaMinutes: 360 },
  next_day: { baseCostNGN: 1800, etaMinutes: 1440 },
  express: { baseCostNGN: 4000, etaMinutes: 120 },
  scheduled: { baseCostNGN: 1500, etaMinutes: 2880 },
};

// ============================================================================
// Retry Logic (Req 16.1–16.6)
// ============================================================================

const TRANSIENT_ERROR_PATTERNS = [
  "network",
  "timeout",
  "ECONNREFUSED",
  "mutation conflict",
  "rate limit",
  "503",
  "502",
];

/**
 * Determines if an error is transient and eligible for retry.
 * Validation errors (invalid input, unauthorized) are NOT transient.
 * @requirements 16.6
 */
export function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR_PATTERNS.some((p) =>
    msg.toLowerCase().includes(p.toLowerCase())
  );
}

/**
 * Wraps an async operation with retry logic for transient errors.
 * Max 2 retries with exponential backoff (1s, 3s).
 * Logs retries at "warn" level, final failures at "error" level.
 * @requirements 16.1, 16.2, 16.3, 16.4, 16.5
 */
export async function withRetry<T>(
  toolName: string,
  fn: () => Promise<T>,
  maxRetries: number = 2,
  backoffMs: number[] = [1000, 3000]
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxRetries) {
        logger.error(`Tool ${toolName} failed after ${attempt + 1} attempts`, {
          toolName,
          attempt: attempt + 1,
          error: String(error),
        } as Record<string, unknown>);
        throw error;
      }
      logger.warn(`Tool ${toolName} retry attempt ${attempt + 1}`, {
        toolName,
        attempt: attempt + 1,
        error: String(error),
      } as Record<string, unknown>);
      await new Promise((r) => setTimeout(r, backoffMs[attempt] ?? 3000));
    }
  }
  throw lastError;
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Creates a new shipment via the logistics API.
 * Requirement 12.1
 * @param data - Shipment creation data
 * @param correlationId - Optional voice session correlation ID (Req 17.2, 17.3)
 */
export async function wrapperCreateShipment(data: CreateShipmentData, correlationId?: string): Promise<unknown> {
  if (!data.shipmentId || !data.organizationId || !data.sender || !data.recipient || !data.parcel || !data.serviceType) {
    return { success: false, error: "Missing required fields: shipmentId, organizationId, sender, recipient, parcel, serviceType" };
  }

  try {
    const result = await withRetry("create_shipment", async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      };
      // Req 17.3: Propagate correlationId to downstream API for shipment events and webhooks
      if (correlationId) headers["X-Correlation-Id"] = correlationId;

      const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      return await response.json();
    });
    // Req 17.10: Include correlationId in audit log entries during voice tool execution
    if (correlationId) {
      logger.info("Voice tool: create_shipment completed", { shipmentId: data.shipmentId, correlationId });
    }
    return result;
  } catch (error) {
    logger.error("Failed to create shipment", { error, shipmentId: data.shipmentId, ...(correlationId && { correlationId }) });
    return { success: false, error: "Sorry, I could not create the shipment right now. Please try again shortly." };
  }
}

/**
 * Updates a shipment's status via the logistics API.
 * Requirement 12.2
 * @param shipmentId - Shipment to update
 * @param updates - Status update data
 * @param correlationId - Optional voice session correlation ID (Req 17.2, 17.3)
 */
export async function wrapperUpdateShipment(shipmentId: string, updates: UpdateShipmentData, correlationId?: string): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!updates.newStatus) {
    return { success: false, error: "newStatus is required" };
  }

  try {
    const result = await withRetry("update_shipment", async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      };
      if (correlationId) headers["X-Correlation-Id"] = correlationId;

      const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify(updates),
      });
      return await response.json();
    });
    if (correlationId) {
      logger.info("Voice tool: update_shipment completed", { shipmentId, newStatus: updates.newStatus, correlationId });
    }
    return result;
  } catch (error) {
    logger.error("Failed to update shipment", { error, shipmentId, ...(correlationId && { correlationId }) });
    return { success: false, error: "Sorry, I could not update the shipment right now. Please try again shortly." };
  }
}

/**
 * Assigns a rider to a shipment via the logistics API.
 * Requirement 12.3
 * @param shipmentId - Shipment to assign
 * @param riderId - Rider to assign
 * @param correlationId - Optional voice session correlation ID (Req 17.2, 17.3)
 */
export async function wrapperAssignRider(shipmentId: string, riderId: string, correlationId?: string): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!riderId) {
    return { success: false, error: "Rider ID is required" };
  }

  try {
    const result = await withRetry("assign_rider", async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      };
      if (correlationId) headers["X-Correlation-Id"] = correlationId;

      const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}/assign`, {
        method: "POST",
        headers,
        body: JSON.stringify({ riderId }),
      });
      return await response.json();
    });
    if (correlationId) {
      logger.info("Voice tool: assign_rider completed", { shipmentId, riderId, correlationId });
    }
    return result;
  } catch (error) {
    logger.error("Failed to assign rider", { error, shipmentId, riderId, ...(correlationId && { correlationId }) });
    return { success: false, error: "Sorry, I could not assign the rider right now. Please try again shortly." };
  }
}

/**
 * Adds a shipment event by triggering a status update with event metadata.
 * Events are created as side effects of status changes via the status endpoint.
 * When used purely for event logging (no status change), it posts to the status
 * endpoint with the current status and event metadata in actorType/actorId.
 * Requirement 12.4
 * @param shipmentId - Shipment to add event to
 * @param eventType - Type of event
 * @param payload - Event payload
 * @param correlationId - Optional voice session correlation ID (Req 17.2, 17.3)
 */
export /**
 * Voice tool: Append an event to the shipment event log.
 *
 * Calls the Convex `createShipmentEvent` mutation directly instead of
 * going through the HTTP status endpoint. This is a proper implementation
 * of Req 12.4 — a dedicated event-append tool, not a side effect of
 * status transitions.
 *
 * @requirements 12.4
 */
async function wrapperAddShipmentEvent(
  shipmentId: string,
  eventType: string,
  payload: Record<string, unknown>,
  correlationId?: string
): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!eventType) {
    return { success: false, error: "Event type is required" };
  }

  try {
    const result = await withRetry("add_shipment_event", async () => {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
      if (!convexUrl) {
        throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
      }

      // Lazy imports — avoids breaking test files that import utility functions
      // from this module but don't need the Convex client
      const { ConvexHttpClient } = require("convex/browser");
      const { api } = require("../../convex/_generated/api.js");
      const convexClient = new ConvexHttpClient(convexUrl);

      const eventId = `evt_${shipmentId}_${eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const payloadWithCorrelation = correlationId
        ? { ...payload, correlationId }
        : payload;

      const mutationResult = await convexClient.mutation(
        api.logistics.shipmentEvents.createShipmentEvent,
        {
          eventId,
          shipmentId,
          eventType,
          actorType: (payload.actorType as "system" | "agent" | "rider" | "merchant") || "agent",
          actorId: (payload.actorId as string) || "voice-agent",
          payload: JSON.stringify(payloadWithCorrelation),
          createdAt: Date.now(),
        }
      );

      return { success: true, data: { eventId, shipmentId, eventType, ...mutationResult } };
    });

    if (correlationId) {
      logger.info("Voice tool: add_shipment_event completed", { shipmentId, eventType, correlationId });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Surface 409 conflicts (duplicate eventId) as a clear message
    if (message.includes("409")) {
      logger.warn("Duplicate shipment event", { shipmentId, eventType, ...(correlationId && { correlationId }) });
      return { success: false, error: "This event has already been recorded." };
    }

    logger.error("Failed to add shipment event", { error, shipmentId, eventType, ...(correlationId && { correlationId }) });
    return { success: false, error: "Sorry, I could not add the shipment event right now. Please try again shortly." };
  }
}


/**
 * Returns a delivery cost and ETA estimate based on service type.
 * This is a local calculation with reasonable defaults since there
 * is no backend endpoint for quoting.
 * Requirement 12.5
 */
export function wrapperQuoteDelivery(
  sender: QuoteDeliveryParams["sender"],
  recipient: QuoteDeliveryParams["recipient"],
  serviceType: QuoteDeliveryParams["serviceType"]
): DeliveryQuote {
  const defaults = SERVICE_DEFAULTS[serviceType] || SERVICE_DEFAULTS.next_day;

  let costMultiplier = 1.0;

  // Apply inter-city surcharge when sender and recipient are in different cities
  if (sender.city?.toLowerCase() !== recipient.city?.toLowerCase()) {
    costMultiplier += 0.5;
  }

  // Apply inter-state surcharge
  if (sender.state?.toLowerCase() !== recipient.state?.toLowerCase()) {
    costMultiplier += 0.75;
  }

  const estimatedCostNGN = Math.round(defaults.baseCostNGN * costMultiplier);
  const etaMinutes = defaults.etaMinutes;

  return {
    estimatedCostNGN,
    etaMinutes,
    serviceType,
    currency: "NGN",
  };
}
