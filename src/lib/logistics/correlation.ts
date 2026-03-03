import { randomUUID } from "crypto";

/**
 * Reads X-Request-Id from incoming headers, or generates a new UUID.
 * Propagated to all downstream Convex mutations, voice tool calls, and webhook payloads.
 * Returned in response X-Request-Id header.
 */
export function getOrCreateRequestId(headers: Headers): string {
  return headers.get("X-Request-Id") || randomUUID();
}
