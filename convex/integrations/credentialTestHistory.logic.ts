/**
 * Feature: platform-control-plane
 *
 * Pure, property-testable cores for the credential-test history surface
 * (Requirement 8). These functions carry NO Convex `ctx` and perform no I/O so
 * they can be exercised directly by unit and property tests. The Convex
 * query/mutation module (`credentialTestHistory.ts`) and the credential-test
 * callback wiring (`adminConfig.ts`) delegate to these helpers.
 *
 * Covered behaviors:
 *   - 8.2: `statusToOutcome` maps a Connection_Status to a recorded outcome
 *     (`connected → success`, otherwise `failure`); `truncateToSecondUtc`
 *     expresses a completion timestamp in UTC accurate to the second.
 *   - 8.3: `mostRecentPage` returns the recorded outcomes most-recent-first by
 *     completion timestamp, in a page of at most `limit` (100) entries.
 */

/** Current state of an Integration (mirrors the base config-store union). */
export type ConnectionStatus = "connected" | "disconnected" | "error";

/** A recorded Credential_Test outcome (Req 8.2). */
export type TestOutcome = "success" | "failure";

/** The maximum number of outcomes returned in a single history page (Req 8.3). */
export const CREDENTIAL_TEST_HISTORY_PAGE_LIMIT = 100;

/**
 * A single append-only credential-test record. References the Integration by
 * `(platformId, tenantId)` only and never carries any credential value
 * (Req 8.4).
 */
export interface CredentialTestRecord {
  platformId: string;
  tenantId: string;
  outcome: TestOutcome;
  /** Epoch ms, truncated to a whole UTC second for display (Req 8.2). */
  completedAt: number;
}

/**
 * Maps a Connection_Status to the outcome recorded for a completed
 * Credential_Test (Req 8.2). A `connected` result is the only success; every
 * other status (`disconnected`, `error`, or any future value) is a failure.
 */
export function statusToOutcome(status: ConnectionStatus): TestOutcome {
  return status === "connected" ? "success" : "failure";
}

/**
 * Truncates an epoch-millisecond timestamp to a whole UTC second (Req 8.2).
 * Because epoch time is inherently UTC, flooring to the second yields a
 * timestamp accurate to the second with no sub-second component. Non-finite
 * inputs collapse to `0` so callers never persist `NaN`/`Infinity`.
 */
export function truncateToSecondUtc(epochMs: number): number {
  if (!Number.isFinite(epochMs)) return 0;
  return Math.floor(epochMs / 1000) * 1000;
}

/**
 * Returns the credential-test outcomes ordered most-recent-first by
 * `completedAt`, in a page of at most `limit` entries (default 100) (Req 8.3).
 * The input array is not mutated. Ordering is total and deterministic: ties on
 * `completedAt` are broken by `(platformId, tenantId, outcome)` so repeated
 * identical requests return an identical page.
 */
export function mostRecentPage(
  records: CredentialTestRecord[],
  limit: number = CREDENTIAL_TEST_HISTORY_PAGE_LIMIT,
): CredentialTestRecord[] {
  const cap = Math.max(0, Math.min(limit, CREDENTIAL_TEST_HISTORY_PAGE_LIMIT));
  return [...records]
    .sort((a, b) => {
      if (b.completedAt !== a.completedAt) return b.completedAt - a.completedAt;
      if (a.platformId !== b.platformId)
        return a.platformId < b.platformId ? -1 : 1;
      if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
      if (a.outcome !== b.outcome) return a.outcome < b.outcome ? -1 : 1;
      return 0;
    })
    .slice(0, cap);
}
