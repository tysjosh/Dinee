// Feature: multi-platform-voice-integrations, Property 9: Phone route save→resolve round-trip — saving a phone route (phoneNumber → platformId, tenantId, conversationType) with an ALLOWED conversation type, then resolving that phoneNumber returns the mapped { platformId, tenantId, conversationType }
// Feature: multi-platform-voice-integrations, Property 10: Disallowed conversation type is rejected — saving a route with a conversation type NOT in the tenant's allowed set is rejected (naming the offending type) and leaves existing routes unchanged
//
// Property 9 — Validates: Requirements 4.1, 4.2
// Property 10 — Validates: Requirements 4.3
//
// Req 4.1: WHEN a Phone_Route is saved with an inbound phone number, a
// Platform_Id, a Tenant_Id, and one or more conversation types, THE
// Phone_Route_Resolver SHALL persist the mapping so the number resolves to that
// Platform_Id, Tenant_Id, and conversation type set.
//
// Req 4.2: WHEN the Phone_Route_Resolver receives an inbound number that has a
// stored Phone_Route, THE Phone_Route_Resolver SHALL return the mapped
// Platform_Id, Tenant_Id, and resolved conversation type.
//
// Req 4.3: IF a Phone_Route is saved with a conversation type that is not in
// the owning tenant's allowed conversation types for the Platform, THEN THE
// Phone_Route_Resolver SHALL reject the save and report a
// disallowed-conversation-type error.
//
// The Convex mutation `savePhoneRoute` and query `resolveRoute` in
// convex/integrations/phoneRoutes.ts guard on the pure predicate
// `isConversationTypeAllowed(allowed, type)` and upsert by phoneNumber. Since
// the mutation/query themselves need a Convex DB, this property tests at the
// level of the PURE decision plus a tiny in-memory model of the phone-route
// store that mirrors the mutation's validate-before-write + upsert-by-
// phoneNumber semantics — the exact behavior Req 4.1/4.2/4.3 constrain. This
// mirrors the prevailing approach in this repo (see numberMapping.property.test.ts),
// which tests the pure predicate + an in-memory model rather than convex-test.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isConversationTypeAllowed } from "../../convex/runsheet/numberAssignments";

/** Known platform conversation types plus some out-of-set noise. */
const KNOWN_CONVERSATION_TYPES = [
  "runsheet_fuel_order_intake",
  "runsheet_order_status",
  "runsheet_driver_exception",
  "runsheet_dispatch_callback",
] as const;

const conversationTypeArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KNOWN_CONVERSATION_TYPES),
  // out-of-set / arbitrary strings so both accept and reject paths are hit
  fc.constantFrom("restaurant_reservation", "logistics_pickup", "unknown_type", ""),
  fc.string()
);

/** A tenant's allowed conversation types — any subset of the known types. */
const allowedSetArb: fc.Arbitrary<string[]> = fc
  .subarray([...KNOWN_CONVERSATION_TYPES], { minLength: 0, maxLength: 4 })
  .map((arr) => [...arr]);

/** A phone number in E.164-ish shape (value shape is irrelevant to the guard). */
const phoneArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 })
  .map((digits) => `+1${digits.join("")}`);

const platformIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "runsheet",
  "acme-logistics",
  "platform_x"
);

const tenantIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "tenant-a",
  "tenant-b",
  "tenant-c"
);

/** The mapped route triple stored per phone number. */
interface Route {
  platformId: string;
  tenantId: string;
  conversationType: string;
}

/** Minimal in-memory model of the generic phoneRoutes store, keyed by number. */
type RouteStore = Map<string, Route>;

type SaveResult =
  | { accepted: true }
  | { accepted: false; error: string };

/**
 * Replicates the `savePhoneRoute` mutation decision against a pure store:
 * validate-before-write — reject (leaving the store unchanged) when the
 * conversation type is not in the tenant's allowed set, naming the offending
 * type; otherwise upsert by phoneNumber (a number resolves to exactly one
 * route).
 */
function trySave(
  store: RouteStore,
  allowedConversationTypes: readonly string[],
  route: Route & { phoneNumber: string }
): SaveResult {
  if (!isConversationTypeAllowed(allowedConversationTypes, route.conversationType)) {
    // Req 4.3: reject naming the offending type; no write occurs.
    return {
      accepted: false,
      error: `Conversation type "${route.conversationType}" is not in the tenant's allowed conversation types`,
    };
  }
  store.set(route.phoneNumber, {
    platformId: route.platformId,
    tenantId: route.tenantId,
    conversationType: route.conversationType,
  });
  return { accepted: true };
}

/** Replicates the `resolveRoute` query: exact triple or null on a miss. */
function resolveRoute(store: RouteStore, phoneNumber: string): Route | null {
  return store.get(phoneNumber) ?? null;
}

describe("Property 9: Phone route save→resolve round-trip", () => {
  it("saving an allowed route then resolving the number returns the exact mapped triple (Req 4.1, 4.2)", () => {
    fc.assert(
      fc.property(
        // Guarantee a non-empty allowed set so an accepted path exists.
        fc
          .subarray([...KNOWN_CONVERSATION_TYPES], { minLength: 1, maxLength: 4 })
          .map((arr) => [...arr]),
        phoneArb,
        platformIdArb,
        tenantIdArb,
        fc.nat(),
        (allowed, phoneNumber, platformId, tenantId, pick) => {
          const conversationType = allowed[pick % allowed.length];
          const store: RouteStore = new Map();

          const result = trySave(store, allowed, {
            phoneNumber,
            platformId,
            tenantId,
            conversationType,
          });

          expect(result.accepted).toBe(true);

          // Resolving the saved number returns exactly the mapped triple.
          const resolved = resolveRoute(store, phoneNumber);
          expect(resolved).toEqual({ platformId, tenantId, conversationType });
        }
      ),
      { numRuns: 100 }
    );
  });

  it("re-saving the same number upserts (a number resolves to exactly one route) (Req 4.1)", () => {
    fc.assert(
      fc.property(
        fc
          .subarray([...KNOWN_CONVERSATION_TYPES], { minLength: 2, maxLength: 4 })
          .map((arr) => [...arr]),
        phoneArb,
        platformIdArb,
        tenantIdArb,
        (allowed, phoneNumber, platformId, tenantId) => {
          const store: RouteStore = new Map();
          const first = allowed[0];
          const second = allowed[1];

          trySave(store, allowed, {
            phoneNumber,
            platformId,
            tenantId,
            conversationType: first,
          });
          const second_result = trySave(store, allowed, {
            phoneNumber,
            platformId,
            tenantId,
            conversationType: second,
          });

          expect(second_result.accepted).toBe(true);
          // Exactly one route for the number, reflecting the latest save.
          expect(store.size).toBe(1);
          expect(resolveRoute(store, phoneNumber)).toEqual({
            platformId,
            tenantId,
            conversationType: second,
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 10: Disallowed conversation type is rejected", () => {
  it("rejects a conversation type not in the allowed set, names the type, and leaves existing routes unchanged (Req 4.3)", () => {
    fc.assert(
      fc.property(
        allowedSetArb,
        phoneArb,
        platformIdArb,
        tenantIdArb,
        conversationTypeArb,
        // a pre-existing route already in the store for the same number
        fc.record({
          platformId: platformIdArb,
          tenantId: tenantIdArb,
          conversationType: fc.constantFrom(...KNOWN_CONVERSATION_TYPES),
        }),
        (allowed, phoneNumber, platformId, tenantId, conversationType, existing) => {
          // Only exercise the rejection path.
          fc.pre(!isConversationTypeAllowed(allowed, conversationType));

          const store: RouteStore = new Map([[phoneNumber, existing]]);
          const snapshot = new Map(store);

          const result = trySave(store, allowed, {
            phoneNumber,
            platformId,
            tenantId,
            conversationType,
          });

          expect(result.accepted).toBe(false);
          if (!result.accepted) {
            // The error names the offending conversation type.
            expect(result.error).toContain(conversationType);
          }
          // Existing routes are byte-for-byte unchanged on rejection.
          expect([...store.entries()]).toEqual([...snapshot.entries()]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
