/**
 * Provider routing and utility functions for phone number provisioning.
 *
 * Pure utility module — no Convex decorators. Imports shared types/constants
 * from convex/shared/phoneProvisioningTypes.ts and exposes higher-level
 * helpers consumed by mutations, actions, and scheduled functions.
 *
 * Requirements: 2.1, 2.2, 2.3, 6.1, 6.4
 */

import {
  PROVIDER_ROUTING_TABLE,
  BACKOFF_DELAYS,
  MAX_PROVISION_ATTEMPTS,
  isValidE164,
  classifyError as sharedClassifyError,
  type TelecomProvider,
  type ProvisioningRegion,
} from "../shared/phoneProvisioningTypes";

// Re-export shared utilities so consumers can import from one place
export { isValidE164, MAX_PROVISION_ATTEMPTS };

// ─── Provider Routing (Req 2.1, 2.2, 2.3) ──────────────────────────────────

/**
 * Returns the ordered list of providers for a region based on the routing table.
 * Order: primary → secondary → tertiary providers.
 */
export function getProviderOrder(region: ProvisioningRegion): TelecomProvider[] {
  const route = PROVIDER_ROUTING_TABLE[region];
  return [route.primary, route.secondary, ...route.tertiary];
}

/**
 * Returns the next untried provider for a region, or `null` if all have been
 * attempted. Preserves the routing table order (primary → secondary → tertiary)
 * while skipping already-attempted providers.
 */
export function getNextProvider(
  region: ProvisioningRegion,
  attemptedProviders: TelecomProvider[]
): TelecomProvider | null {
  const attempted = new Set(attemptedProviders);
  const ordered = getProviderOrder(region);
  return ordered.find((p) => !attempted.has(p)) ?? null;
}

// ─── Error Classification (Req 6.4) ─────────────────────────────────────────

/**
 * Classify a provisioning error as "transient" (retryable) or "non_transient".
 * Delegates to the shared classifier.
 */
export function classifyError(
  errorCode: string
): "transient" | "non_transient" {
  return sharedClassifyError(errorCode);
}

// ─── Retry / Backoff (Req 6.1) ──────────────────────────────────────────────

/**
 * Returns the backoff delay in milliseconds for the given attempt number.
 *
 * Attempt numbers are 1-indexed (attempt 1 = first retry after initial failure).
 * Schedule: 5 s → 30 s → 2 min → 10 min.
 *
 * If `attemptNumber` exceeds the backoff table length, the last delay is used.
 * If `attemptNumber` is ≤ 0, returns 0 (no delay for the initial attempt).
 */
export function getBackoffDelay(attemptNumber: number): number {
  if (attemptNumber <= 0) return 0;
  const index = Math.min(attemptNumber - 1, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[index];
}

// ─── E.164 Validation (Req 6.1) ─────────────────────────────────────────────

/**
 * Validates whether a phone number is in E.164 format.
 * Re-exported from shared types for convenience.
 */
export function validateE164(phoneNumber: string): boolean {
  return isValidE164(phoneNumber);
}

// ─── ID Generation ──────────────────────────────────────────────────────────

/**
 * Generates a unique phone number ID with the "PN_" prefix.
 * Uses crypto.randomUUID() for uniqueness.
 */
export function generateNumberId(): string {
  return `PN_${crypto.randomUUID()}`;
}

/**
 * Generates a unique provisioning request ID with the "PR_" prefix.
 * Uses crypto.randomUUID() for uniqueness.
 */
export function generateRequestId(): string {
  return `PR_${crypto.randomUUID()}`;
}
