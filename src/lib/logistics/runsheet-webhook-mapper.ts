/**
 * Runsheet Webhook Mapper
 *
 * Maps Dinee internal webhook event names and payloads into the
 * Runsheet-compatible envelope format. Also provides the HMAC-SHA256
 * signer that Runsheet expects (raw body, no timestamp prefix).
 *
 * @module logistics/runsheet-webhook-mapper
 */

import crypto from "crypto";

// ============================================================================
// Event-type mapping (dot → underscore)
// ============================================================================

const RUNSHEET_EVENT_MAP: Record<string, string> = {
  "shipment.created": "shipment_created",
  "shipment.status_updated": "shipment_updated",
  "shipment.delivered": "shipment_delivered",
  "shipment.failed": "shipment_failed",
  "shipment.assigned": "rider_assigned",
  "rider.status_changed": "rider_status_changed",
};

/**
 * Convert a Dinee dot-notation event type to Runsheet underscore form.
 * Falls back to replacing all dots with underscores for unknown types.
 */
export function toRunsheetEventType(dineeType: string): string {
  return RUNSHEET_EVENT_MAP[dineeType] ?? dineeType.replace(/\./g, "_");
}

// ============================================================================
// Runsheet envelope
// ============================================================================

export interface RunsheetEnvelope {
  event_id: string;
  event_type: string;
  schema_version: string;
  tenant_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Build a Runsheet-compatible webhook body from Dinee event data.
 *
 * @param eventId   - Stable unique event id (existing Dinee eventId)
 * @param eventType - Dinee dot-notation event type
 * @param tenantId  - Authoritative tenant id from server context / record
 * @param data      - Normalized event data object
 */
export function buildRunsheetBody(
  eventId: string,
  eventType: string,
  tenantId: string,
  data: Record<string, unknown>,
): RunsheetEnvelope {
  return {
    event_id: eventId,
    event_type: toRunsheetEventType(eventType),
    schema_version: "1.0",
    tenant_id: tenantId,
    timestamp: new Date().toISOString(),
    data,
  };
}

// ============================================================================
// HMAC signer — Runsheet mode
// ============================================================================

/**
 * Sign a raw JSON string with HMAC-SHA256 for Runsheet consumption.
 * Unlike the partner mode which prefixes `${timestamp}.${body}`,
 * Runsheet signs the raw body only.
 */
export function signRunsheet(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}
