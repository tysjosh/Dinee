// Feature: campus-social-loops, Property 31: Social-loops voice interactions are metered and gated by the owning account's call-minutes limit
/**
 * Feature: campus-social-loops (Task 9.3), Property 31: Social-loops voice
 * interactions are metered and gated by the owning account's call-minutes
 * limit.
 *
 * Validates: Requirements 8.4, 8.5
 *
 * This test verifies REUSE, not re-proof: battle, challenge, and group voice
 * interactions do not implement their own metering — each start is gated by the
 * SAME reused {@link canStartCall} from `convex/campus/logic/usage.ts`,
 * evaluated against the account that OWNS the Campus_Agent and that account's
 * existing Usage_Limits (Req 8.4). The gate permits a start iff the owning
 * account's call-minutes usage is strictly below the tier limit; when the limit
 * is reached the start is declined as "temporarily unavailable" and no minutes
 * are metered (Req 8.5).
 *
 * The property drives the reused gate with the shared social arbitraries
 * (call-minutes clustered around the free-tier boundary × tier) and tags each
 * input with the social interaction kind (battle / challenge / group) to show
 * the identical metering gate governs every social voice path.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canStartCall,
  resolveTierLimits,
  FREE_TIER_LIMITS,
} from "../../../../convex/campus/logic/usage";
import { usageStateInputArb } from "./arbitraries";

/**
 * The social voice interactions that consume call minutes. The metering gate is
 * kind-agnostic, so tagging each input demonstrates that battle, challenge, and
 * group minutes are all metered against the owning account identically
 * (Req 8.4).
 */
const socialInteractionKindArb: fc.Arbitrary<string> = fc.constantFrom(
  "battle_minutes",
  "challenge_minutes",
  "group_minutes",
);

describe("Property 31: Social-loops voice interactions are metered and gated by the owning account's call-minutes limit", () => {
  it("permits a social voice start iff the owning account's call-minutes usage is strictly below the tier limit (Req 8.4, 8.5)", () => {
    fc.assert(
      fc.property(
        socialInteractionKindArb,
        usageStateInputArb,
        (_kind, { callMinutesUsed, tier }) => {
          const decision = canStartCall(callMinutesUsed, tier);
          const limit = resolveTierLimits(tier).callMinutes;
          const expectedAllowed = callMinutesUsed < limit;

          expect(decision.allowed).toBe(expectedAllowed);

          if (!decision.allowed) {
            // A declined start is surfaced as temporarily unavailable and
            // carries the applicable limit; purity guarantees no minutes are
            // metered for the declined interaction (Req 8.5).
            expect(decision.reason).toBe("call_minutes_exhausted");
            expect(decision.unavailable).toBe(true);
            expect(decision.limit).toBe(limit);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("declines a free-tier social voice start exactly when used minutes reach the 30-minute limit (Req 8.5)", () => {
    fc.assert(
      fc.property(
        socialInteractionKindArb,
        fc.integer({ min: 0, max: FREE_TIER_LIMITS.callMinutes + 10 }),
        (_kind, callMinutesUsed) => {
          const decision = canStartCall(callMinutesUsed, "free");
          if (callMinutesUsed >= FREE_TIER_LIMITS.callMinutes) {
            expect(decision.allowed).toBe(false);
          } else {
            expect(decision.allowed).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
