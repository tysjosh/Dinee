// Feature: dinee-voice-platform, Property 8: Number-to-conversation-type mapping and allowed-set restriction — a number→conversation-type assignment is accepted iff the conversation type is in the tenant's allowed set; a disallowed type is rejected and leaves existing assignments unchanged
//
// Validates: Requirements 9.5, 9.6
//
// Req 9.5: WHEN a Runsheet_Admin selects a default agent type, THE Dinee_Platform
// SHALL restrict callable conversation types to the tenant's allowed
// conversation types.
//
// Req 9.6: IF a Runsheet_Admin assigns a Dinee-managed phone number to a
// conversation type that is not in the tenant's allowed conversation types,
// THEN THE Dinee_Platform SHALL reject the assignment, return an error
// indicating the disallowed conversation type, and leave the existing number
// assignments unchanged.
//
// The mutation `assignNumber` in convex/runsheet/numberAssignments.ts guards on
// the pure predicate `isConversationTypeAllowed(allowed, type)`. Since the
// mutation itself needs a Convex DB, this property tests the pure decision that
// gates it — membership in the tenant's allowed set — which is the exact
// condition Req 9.5/9.6 constrain. To close the loop on "leaves existing
// assignments unchanged", we drive a tiny in-memory model of the assignment
// store through the same predicate and assert the store is untouched on
// rejection.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isConversationTypeAllowed } from "../../convex/runsheet/numberAssignments";

/** The four Runsheet conversation types plus some out-of-set noise. */
const RUNSHEET_CONVERSATION_TYPES = [
  "runsheet_fuel_order_intake",
  "runsheet_order_status",
  "runsheet_driver_exception",
  "runsheet_dispatch_callback",
] as const;

const conversationTypeArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...RUNSHEET_CONVERSATION_TYPES),
  // out-of-set / arbitrary strings so both accept and reject paths are hit
  fc.constantFrom("restaurant_reservation", "logistics_pickup", "unknown_type", ""),
  fc.string()
);

/** A tenant's allowed conversation types — any subset of the known types. */
const allowedSetArb: fc.Arbitrary<string[]> = fc
  .subarray([...RUNSHEET_CONVERSATION_TYPES], { minLength: 0, maxLength: 4 })
  .map((arr) => [...arr]);

/** A phone number in E.164-ish shape (value shape is irrelevant to the guard). */
const phoneArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 })
  .map((digits) => `+1${digits.join("")}`);

/** Minimal in-memory model of the number→type assignment store. */
type AssignmentStore = Map<string, string>;

/**
 * Replicates the `assignNumber` decision against a pure store: accept iff the
 * conversation type is allowed (upserting the mapping), otherwise reject and
 * leave the store unchanged.
 */
function tryAssign(
  store: AssignmentStore,
  allowed: readonly string[],
  phoneNumber: string,
  conversationType: string
): { accepted: boolean } {
  if (!isConversationTypeAllowed(allowed, conversationType)) {
    return { accepted: false };
  }
  store.set(phoneNumber, conversationType);
  return { accepted: true };
}

describe("Property 8: Number mapping and allowed-set restriction", () => {
  it("accepts an assignment iff the conversation type is in the tenant's allowed set", () => {
    fc.assert(
      fc.property(allowedSetArb, conversationTypeArb, (allowed, conversationType) => {
        const membership = allowed.includes(conversationType);
        expect(isConversationTypeAllowed(allowed, conversationType)).toBe(membership);
      }),
      { numRuns: 100 }
    );
  });

  it("a disallowed conversation type is rejected and leaves existing assignments unchanged (Req 9.6)", () => {
    fc.assert(
      fc.property(
        allowedSetArb,
        phoneArb,
        conversationTypeArb,
        // a pre-existing mapping already in the store for the same number
        fc.constantFrom(...RUNSHEET_CONVERSATION_TYPES),
        (allowed, phoneNumber, conversationType, existingType) => {
          // Only exercise the rejection path.
          fc.pre(!isConversationTypeAllowed(allowed, conversationType));

          const store: AssignmentStore = new Map([[phoneNumber, existingType]]);
          const snapshot = new Map(store);

          const result = tryAssign(store, allowed, phoneNumber, conversationType);

          expect(result.accepted).toBe(false);
          // The store is byte-for-byte unchanged on rejection.
          expect([...store.entries()]).toEqual([...snapshot.entries()]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("an allowed conversation type is accepted and the number maps to exactly that type (Req 9.5)", () => {
    fc.assert(
      fc.property(
        // Guarantee a non-empty allowed set so an accepted path exists.
        fc
          .subarray([...RUNSHEET_CONVERSATION_TYPES], { minLength: 1, maxLength: 4 })
          .map((arr) => [...arr]),
        phoneArb,
        (allowed, phoneNumber) => {
          const conversationType = allowed[0];
          const store: AssignmentStore = new Map();

          const result = tryAssign(store, allowed, phoneNumber, conversationType);

          expect(result.accepted).toBe(true);
          // Resolving the accepted number returns exactly the mapped type.
          expect(store.get(phoneNumber)).toBe(conversationType);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("callable conversation types are a subset of the tenant's allowed set (Req 9.5)", () => {
    // For any set of candidate types, the ones that pass the guard (i.e. the
    // callable/assignable set) never contain a type outside the allowed set.
    fc.assert(
      fc.property(
        allowedSetArb,
        fc.array(conversationTypeArb, { maxLength: 8 }),
        (allowed, candidates) => {
          const callable = candidates.filter((t) => isConversationTypeAllowed(allowed, t));
          for (const t of callable) {
            expect(allowed).toContain(t);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
