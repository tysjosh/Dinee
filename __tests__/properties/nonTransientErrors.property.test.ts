/**
 * Feature: phone-number-provisioning, Property 17: Non-transient errors are not retried
 *
 * **Validates: Requirements 6.4**
 *
 * For any provisioning attempt that fails with a non-transient error (invalid
 * credentials, account suspended, insufficient funds, authentication_failed,
 * authorization_failed, account_disabled), the system must classify it as
 * "non_transient" and must not schedule a retry.
 *
 * Conversely, transient errors must classify as "transient", and unknown error
 * codes must default to "transient" (safe default for retryability).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { classifyError } from "../../convex/phoneProvisioning/providerRouting";

// ─── Constants ───────────────────────────────────────────────────────────────

const NON_TRANSIENT_ERROR_CODES = [
  "invalid_credentials",
  "account_suspended",
  "insufficient_funds",
  "authentication_failed",
  "authorization_failed",
  "account_disabled",
] as const;

const TRANSIENT_ERROR_CODES = [
  "network_timeout",
  "rate_limit",
  "temporary_unavailability",
  "no_inventory",
  "server_error",
] as const;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Random non-transient error code from the known set */
const nonTransientErrorArb = fc.constantFrom(...NON_TRANSIENT_ERROR_CODES);

/** Random transient error code from the known set */
const transientErrorArb = fc.constantFrom(...TRANSIENT_ERROR_CODES);

/** Random unknown error code that is NOT in the non-transient set */
const unknownErrorArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !(NON_TRANSIENT_ERROR_CODES as readonly string[]).includes(s));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 17: Non-transient errors are not retried", () => {
  it("all known non-transient error codes classify as 'non_transient'", () => {
    fc.assert(
      fc.property(nonTransientErrorArb, (errorCode) => {
        expect(classifyError(errorCode)).toBe("non_transient");
      }),
      { numRuns: 100 }
    );
  });

  it("known transient error codes classify as 'transient'", () => {
    fc.assert(
      fc.property(transientErrorArb, (errorCode) => {
        expect(classifyError(errorCode)).toBe("transient");
      }),
      { numRuns: 100 }
    );
  });

  it("unknown/random error codes default to 'transient' (safe default)", () => {
    fc.assert(
      fc.property(unknownErrorArb, (errorCode) => {
        expect(classifyError(errorCode)).toBe("transient");
      }),
      { numRuns: 100 }
    );
  });

  it("non-transient classification means no retry should be scheduled", () => {
    fc.assert(
      fc.property(nonTransientErrorArb, (errorCode) => {
        const classification = classifyError(errorCode);
        // Non-transient errors must NOT trigger retry
        const shouldRetry = classification === "transient";
        expect(shouldRetry).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
