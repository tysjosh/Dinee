/**
 * Idempotency Layer — Replay Protection for Write Endpoints
 *
 * Provides idempotency key check/store logic for logistics write endpoints.
 * Uses the shared `idempotencyKeys` Convex table scoped by partnerId,
 * making it reusable for restaurant write paths in the future.
 *
 * Flow:
 * 1. Check if key exists (scoped to partnerId)
 * 2. If exists with same request hash → return stored response (replay)
 * 3. If exists with different request hash → 422 key mismatch
 * 4. If not exists → caller proceeds with mutation, then stores result
 *
 * @module logistics/idempotency
 * @requirements 21.1, 21.2, 21.3, 21.4, 21.6
 */

import { createHash } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyReplay {
  replay: true;
  status: number;
  body: string;
}

export interface IdempotencyMismatch {
  mismatch: true;
}

export interface IdempotencyProceed {
  replay: false;
}

/**
 * Returned when a previous attempt with this key stored a "failed" state.
 * Signals the caller to re-execute the mutation rather than replaying the error.
 * @requirements 3.8, 3.9
 */
export interface IdempotencyFailed {
  failed: true;
}

export type IdempotencyCheckResult =
  | IdempotencyReplay
  | IdempotencyMismatch
  | IdempotencyProceed
  | IdempotencyFailed;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a deterministic SHA-256 hash of a request body.
 * Handles `undefined`/`null` by hashing an empty string.
 */
export function hashRequestBody(body: unknown): string {
  const serialized = body != null ? JSON.stringify(body) : "";
  return createHash("sha256").update(serialized).digest("hex");
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check whether an idempotency key has been seen before for this partner.
 *
 * @returns
 *  - `{ replay: true, status, body }` — key exists with matching hash; caller returns stored response
 *  - `{ mismatch: true }` — key exists with different hash; caller returns 422
 *  - `{ replay: false }` — key not seen; caller proceeds with mutation
 */
export async function checkIdempotency(
  convexClient: ConvexHttpClient,
  key: string,
  partnerId: string,
  requestHash: string
): Promise<IdempotencyCheckResult> {
  const existing = await convexClient.query(
    api.logistics.idempotencyKeys.checkIdempotencyKey,
    { key, partnerId }
  );

  if (!existing) {
    return { replay: false };
  }

  // Req 3.8, 3.9: If previous attempt failed, allow re-execution
  if (existing.status === "failed") {
    return { failed: true };
  }

  if (existing.requestHash === requestHash) {
    return {
      replay: true,
      status: existing.responseStatus,
      body: existing.responseBody,
    };
  }

  // Same key, different body → mismatch
  return { mismatch: true };
}

/**
 * Store the result of a successful mutation so future replays return it.
 *
 * @param convexClient - Convex HTTP client
 * @param key - The idempotency key from the request header
 * @param partnerId - Scoped partner identifier
 * @param requestHash - SHA-256 hash of the original request body
 * @param status - HTTP status code of the response
 * @param body - Serialized JSON response body
 */
export async function storeIdempotencyResult(
  convexClient: ConvexHttpClient,
  key: string,
  partnerId: string,
  requestHash: string,
  status: number,
  body: string
): Promise<void> {
  await convexClient.mutation(
    api.logistics.idempotencyKeys.storeIdempotencyKey,
    { key, partnerId, requestHash, responseStatus: status, responseBody: body }
  );
}

/**
 * Store a failed idempotency state so that retries re-execute the mutation
 * instead of replaying the error.
 *
 * @param convexClient - Convex HTTP client
 * @param key - The idempotency key from the request header
 * @param partnerId - Scoped partner identifier
 * @param requestHash - SHA-256 hash of the original request body
 * @param error - Error message describing the failure
 * @requirements 3.8, 3.9
 */
export async function storeIdempotencyFailure(
  convexClient: ConvexHttpClient,
  key: string,
  partnerId: string,
  requestHash: string,
  error: string
): Promise<void> {
  await convexClient.mutation(
    api.logistics.idempotencyKeys.storeIdempotencyKey,
    {
      key,
      partnerId,
      requestHash,
      responseStatus: 500,
      responseBody: JSON.stringify({ error }),
      status: "failed",
    }
  );
}
