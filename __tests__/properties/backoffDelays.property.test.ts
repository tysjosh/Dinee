/**
 * Feature: phone-number-provisioning, Property 16: Exponential backoff retry delays
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * For any provisioning attempt that fails with a transient error, the retry
 * delay must follow the exponential backoff schedule (5s, 30s, 2m, 10m) based
 * on the attempt number, and the total attempts must not exceed 5 (1 initial +
 * 4 retries).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getBackoffDelay } from "../../convex/phoneProvisioning/providerRouting";
import {
  BACKOFF_DELAYS,
  MAX_PROVISION_ATTEMPTS,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Valid retry attempt numbers (1-indexed: 1 = first retry, 4 = last retry) */
const validAttemptArb = fc.integer({ min: 1, max: 4 });

/** Non-positive attempt numbers (initial attempt or invalid) */
const nonPositiveAttemptArb = fc.integer({ min: -100, max: 0 });

/** Any attempt number in the broader range for monotonicity checks */
const anyAttemptArb = fc.integer({ min: 1, max: 10 });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 16: Exponential backoff retry delays", () => {
  it("attempt 1 delay is 5000ms (5 seconds)", () => {
    fc.assert(
      fc.property(fc.constant(1), (attempt) => {
        expect(getBackoffDelay(attempt)).toBe(5_000);
      }),
      { numRuns: 100 }
    );
  });

  it("attempt 2 delay is 30000ms (30 seconds)", () => {
    fc.assert(
      fc.property(fc.constant(2), (attempt) => {
        expect(getBackoffDelay(attempt)).toBe(30_000);
      }),
      { numRuns: 100 }
    );
  });

  it("attempt 3 delay is 120000ms (2 minutes)", () => {
    fc.assert(
      fc.property(fc.constant(3), (attempt) => {
        expect(getBackoffDelay(attempt)).toBe(120_000);
      }),
      { numRuns: 100 }
    );
  });

  it("attempt 4 delay is 600000ms (10 minutes)", () => {
    fc.assert(
      fc.property(fc.constant(4), (attempt) => {
        expect(getBackoffDelay(attempt)).toBe(600_000);
      }),
      { numRuns: 100 }
    );
  });

  it("delay for attempt n matches BACKOFF_DELAYS[n-1] for valid attempts 1-4", () => {
    fc.assert(
      fc.property(validAttemptArb, (attempt) => {
        const delay = getBackoffDelay(attempt);
        expect(delay).toBe(BACKOFF_DELAYS[attempt - 1]);
      }),
      { numRuns: 100 }
    );
  });

  it("delay is 0 for non-positive attempt numbers", () => {
    fc.assert(
      fc.property(nonPositiveAttemptArb, (attempt) => {
        expect(getBackoffDelay(attempt)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("total attempts never exceed MAX_PROVISION_ATTEMPTS (5)", () => {
    // 1 initial attempt + 4 retries = 5 total, matching BACKOFF_DELAYS length + 1
    expect(MAX_PROVISION_ATTEMPTS).toBe(5);
    expect(BACKOFF_DELAYS.length).toBe(MAX_PROVISION_ATTEMPTS - 1);
  });

  it("delays are monotonically non-decreasing across consecutive attempts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        (attempt) => {
          const current = getBackoffDelay(attempt);
          const next = getBackoffDelay(attempt + 1);
          expect(next).toBeGreaterThanOrEqual(current);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all backoff delays are positive for valid retry attempts", () => {
    fc.assert(
      fc.property(validAttemptArb, (attempt) => {
        expect(getBackoffDelay(attempt)).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("attempts beyond the backoff table use the last delay value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 100 }),
        (attempt) => {
          const delay = getBackoffDelay(attempt);
          const lastDelay = BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
          expect(delay).toBe(lastDelay);
        }
      ),
      { numRuns: 100 }
    );
  });
});
