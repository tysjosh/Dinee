/**
 * Feature: multi-platform-voice-integrations
 * Validates: Requirements 4.4, 4.5
 *
 * Example tests for the generalized `resolvePhoneToRoute` resolution behavior:
 *
 *   Req 4.4 — WHEN the Phone_Route_Resolver receives an inbound number that has
 *   no stored generic Phone_Route, THE Phone_Route_Resolver SHALL fall through
 *   to the existing branch and location resolution paths.
 *
 *   Req 4.5 — IF phone-route resolution raises an error, THEN THE
 *   Phone_Route_Resolver SHALL default to the restaurant inbound-order route so
 *   an inbound call is never dropped by a routing failure (fail-open).
 *
 * `resolvePhoneToRoute` queries three Convex functions in order:
 *   1. api.integrations.phoneRoutes.resolveRoute      (generic phone route)
 *   2. api.runsheet.numberAssignments.resolveNumber   (legacy Runsheet route)
 *   3. api.phoneLookup.getEntityByPhoneNumber         (branch/location lookup)
 *
 * These tests use a fake ConvexHttpClient whose `.query` dispatches by the api
 * function reference (via getFunctionName), mirroring the mocking approach in
 * callPathBaseline.test.ts.
 */
import { describe, it, expect } from "vitest";
import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { resolvePhoneToRoute } from "../../src/lib/call-routing/phone-lookup";

type QueryRef = Parameters<typeof getFunctionName>[0];

/** Classify a query reference by the resolver it targets. */
function refKind(
  ref: QueryRef,
): "resolveRoute" | "resolveNumber" | "getEntity" | "other" {
  const name = getFunctionName(ref);
  if (name.includes("resolveRoute")) return "resolveRoute";
  if (name.includes("resolveNumber")) return "resolveNumber";
  if (name.includes("getEntityByPhoneNumber")) return "getEntity";
  return "other";
}

/**
 * Build a fake ConvexHttpClient whose `.query` dispatches by the api function
 * reference, returning a per-resolver result. A result of `THROW` makes that
 * specific query reject, exercising the fail-open path.
 */
const THROW = Symbol("throw");
function fakeConvexClient(results: {
  resolveRoute: unknown;
  resolveNumber: unknown;
  getEntity: unknown;
}): ConvexHttpClient {
  return {
    query: async (ref: QueryRef) => {
      const kind = refKind(ref);
      const value = kind === "other" ? null : results[kind];
      if (value === THROW) {
        throw new Error(`convex query failed: ${kind}`);
      }
      return value;
    },
  } as unknown as ConvexHttpClient;
}

describe("resolvePhoneToRoute — fall-through (Req 4.4)", () => {
  it("falls through to a branch/location entity when the generic phoneRoutes store misses", async () => {
    // Generic route MISS + Runsheet MISS, but a branch entity exists.
    const branchEntity = {
      vertical: "restaurant",
      type: "branch",
      branchId: "branch-123",
      restaurantId: "restaurant-456",
      platformId: null,
    };

    const client = fakeConvexClient({
      resolveRoute: null, // phoneRoutes miss
      resolveNumber: null, // runsheet miss
      getEntity: branchEntity, // branch/location lookup hit
    });

    const result = await resolvePhoneToRoute(client, "+15551234567");

    // Proves fall-through: the result is derived from the branch entity, NOT a
    // generic route (no platformId carried as the vertical).
    expect(result.vertical).toBe("restaurant");
    expect(result.conversationType).toBe("restaurant_inbound_order");
    expect(result.branchId).toBe("branch-123");
    expect(result.restaurantId).toBe("restaurant-456");
    // A generic-route hit would have set the vertical to the platformId; here it
    // stays the branch/location vertical, confirming the fall-through path ran.
    expect(result.tenantId).toBeUndefined();
  });

  it("falls through to a logistics location entity when the generic phoneRoutes store misses", async () => {
    const locationEntity = {
      vertical: "logistics",
      type: "location",
      locationId: "loc-789",
      organizationId: "org-321",
      platformId: null,
    };

    const client = fakeConvexClient({
      resolveRoute: null, // phoneRoutes miss
      resolveNumber: null, // runsheet miss
      getEntity: locationEntity, // branch/location lookup hit
    });

    const result = await resolvePhoneToRoute(client, "+15559876543");

    // Fell through to the branch/location path and derived a logistics route.
    expect(result.vertical).toBe("logistics");
    expect(result.conversationType).toBe("logistics_booking");
    expect(result.locationId).toBe("loc-789");
    expect(result.organizationId).toBe("org-321");
  });
});

describe("resolvePhoneToRoute — fail-open (Req 4.5)", () => {
  it("defaults to the restaurant inbound-order route when the generic route lookup throws", async () => {
    const client = fakeConvexClient({
      resolveRoute: THROW, // resolution raises an error
      resolveNumber: null,
      getEntity: null,
    });

    const result = await resolvePhoneToRoute(client, "+15550000001");

    // The call is never dropped: it defaults to the restaurant inbound-order route.
    expect(result.vertical).toBe("restaurant");
    expect(result.conversationType).toBe("restaurant_inbound_order");
  });

  it("defaults to the restaurant inbound-order route when the branch/location lookup throws", async () => {
    const client = fakeConvexClient({
      resolveRoute: null, // generic route miss
      resolveNumber: null, // runsheet miss
      getEntity: THROW, // branch/location lookup raises an error
    });

    const result = await resolvePhoneToRoute(client, "+15550000002");

    expect(result.vertical).toBe("restaurant");
    expect(result.conversationType).toBe("restaurant_inbound_order");
  });
});
