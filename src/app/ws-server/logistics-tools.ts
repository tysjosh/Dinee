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

import { createLogger } from "../../lib/logger.ts";

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
// Tool Implementations
// ============================================================================

/**
 * Creates a new shipment via the logistics API.
 * Requirement 12.1
 */
export async function wrapperCreateShipment(data: CreateShipmentData): Promise<unknown> {
  if (!data.shipmentId || !data.organizationId || !data.sender || !data.recipient || !data.parcel || !data.serviceType) {
    return { success: false, error: "Missing required fields: shipmentId, organizationId, sender, recipient, parcel, serviceType" };
  }

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    return result;
  } catch (error) {
    logger.error("Failed to create shipment", { error, shipmentId: data.shipmentId });
    return { success: false, error: "Failed to create shipment" };
  }
}

/**
 * Updates a shipment's status via the logistics API.
 * Requirement 12.2
 */
export async function wrapperUpdateShipment(shipmentId: string, updates: UpdateShipmentData): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!updates.newStatus) {
    return { success: false, error: "newStatus is required" };
  }

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify(updates),
    });
    const result = await response.json();
    return result;
  } catch (error) {
    logger.error("Failed to update shipment", { error, shipmentId });
    return { success: false, error: "Failed to update shipment" };
  }
}

/**
 * Assigns a rider to a shipment via the logistics API.
 * Requirement 12.3
 */
export async function wrapperAssignRider(shipmentId: string, riderId: string): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!riderId) {
    return { success: false, error: "Rider ID is required" };
  }

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}/assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify({ riderId }),
    });
    const result = await response.json();
    return result;
  } catch (error) {
    logger.error("Failed to assign rider", { error, shipmentId, riderId });
    return { success: false, error: "Failed to assign rider" };
  }
}

/**
 * Adds a shipment event by triggering a status update with event metadata.
 * Events are created as side effects of status changes via the status endpoint.
 * When used purely for event logging (no status change), it posts to the status
 * endpoint with the current status and event metadata in actorType/actorId.
 * Requirement 12.4
 */
export async function wrapperAddShipmentEvent(
  shipmentId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  if (!shipmentId) {
    return { success: false, error: "Shipment ID is required" };
  }
  if (!eventType) {
    return { success: false, error: "Event type is required" };
  }

  try {
    // First, get the current shipment to know its status
    const getResponse = await fetch(
      `${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}`,
      {
        headers: {
          "x-api-key": process.env.INTERNAL_API_KEY || "",
        },
      }
    );
    const shipmentData = await getResponse.json();

    if (!getResponse.ok || !shipmentData?.data) {
      return { success: false, error: "Failed to retrieve shipment for event logging" };
    }

    // Post to the status endpoint with event metadata.
    // The status endpoint creates shipment events as side effects.
    const response = await fetch(
      `${NEXT_APP_URL}/api/v1/logistics/shipments/${encodeURIComponent(shipmentId)}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify({
          newStatus: shipmentData.data.deliveryStatus,
          actorType: payload.actorType || "agent",
          actorId: payload.actorId || "voice-agent",
        }),
      }
    );
    const result = await response.json();
    return result;
  } catch (error) {
    logger.error("Failed to add shipment event", { error, shipmentId, eventType });
    return { success: false, error: "Failed to add shipment event" };
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
