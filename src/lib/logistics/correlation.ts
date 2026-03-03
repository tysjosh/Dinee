import { randomUUID } from "crypto";

/**
 * Reads X-Request-Id from incoming headers, or generates a new UUID.
 * Propagated to all downstream Convex mutations, voice tool calls, and webhook payloads.
 * Returned in response X-Request-Id header.
 */
export function getOrCreateRequestId(headers: Headers): string {
  return headers.get("X-Request-Id") || randomUUID();
}

/**
 * Generates a unique correlationId for voice call sessions.
 * Used to trace all downstream records (call, transcripts, shipment events,
 * audit logs, webhook payloads) back to a single voice session.
 * Distinct from requestId used for API requests (Req 17.6).
 */
export function generateCorrelationId(): string {
  return `voice-${randomUUID()}`;
}

