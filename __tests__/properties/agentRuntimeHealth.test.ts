/**
 * Feature: dinee-voice-platform, Task 4.10: Agent-runtime health harness.
 *
 * Exercises {@link runAgentRuntimeHealthCheck} end-to-end against the real
 * Voice_Runtime seams a live inbound call flows through:
 *   1. phone-number lookup resolves a route (resolvePhoneToRoute),
 *   2. call-phase state initializes (prepareSession → start with initialPhase),
 *   3. tool definitions load for the resolved domain (resolveToolSet), and
 *   4. out-of-set tool calls are rejected (SessionDriver.handleFunctionCall).
 *
 * The harness composes production code only; the Convex phone lookup is driven
 * through a fake `ConvexHttpClient` whose `getEntityByPhoneNumber` query returns
 * a configured entity, exactly as the call-path baseline test does. The domain
 * packs are registered through the real registration path so the registry the
 * harness reads is the production one.
 *
 * Validates: Requirements 1.12
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";

import { runAgentRuntimeHealthCheck } from "../../src/app/ws-server/runtime/healthHarness";
import { registerRestaurantVoicePack } from "../../src/lib/modules/packs/restaurant/index";
import { registerLogisticsVoicePack } from "../../src/lib/modules/packs/logistics/index";
import { clearRegistry as clearVoiceRegistry } from "../../src/lib/modules/voiceDomainPackRegistry";
import { clearRegistry as clearModuleRegistry } from "../../src/lib/modules/toolPackRegistry";

/**
 * True when a query reference is one of the route-precedence resolvers that
 * `resolvePhoneToRoute` consults before the branch/location lookup: the generic
 * `phoneRoutes.resolveRoute` store and the legacy Runsheet number-assignment
 * resolver. The fakes below return null for both so non-mapped numbers fall
 * through to the existing branch/location routing unchanged.
 */
function isResolveNumberQuery(ref: Parameters<typeof getFunctionName>[0]): boolean {
  const name = getFunctionName(ref);
  return name.includes("resolveNumber") || name.includes("resolveRoute");
}

/** Build a fake ConvexHttpClient whose getEntityByPhoneNumber query returns `entity`. */
function fakeConvexClient(entity: unknown): ConvexHttpClient {
  return {
    query: async (ref: Parameters<typeof getFunctionName>[0]) =>
      isResolveNumberQuery(ref) ? null : entity,
  } as unknown as ConvexHttpClient;
}

/** A ConvexHttpClient whose query throws, exercising the lookup fail-safe fallback. */
function throwingConvexClient(): ConvexHttpClient {
  return {
    query: async () => {
      throw new Error("convex unavailable");
    },
  } as unknown as ConvexHttpClient;
}

/** A configured restaurant branch entity (as returned by getEntityByPhoneNumber). */
const restaurantBranchEntity = {
  vertical: "restaurant",
  type: "branch",
  branchId: "branch_123",
  restaurantId: "rest_123",
  platformId: null,
  phoneNumberId: "pn_123",
};

/** A configured logistics location entity. */
const logisticsLocationEntity = {
  vertical: "logistics",
  type: "location",
  locationId: "loc_123",
  organizationId: "org_123",
  platformId: null,
  phoneNumberId: "pn_456",
};

/** The four checks the harness must always report, in order. */
const EXPECTED_CHECK_NAMES = [
  "phone_lookup",
  "phase_init",
  "tools_loaded",
  "out_of_set_rejected",
] as const;

describe("Agent-runtime health harness (Req 1.12)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
    registerRestaurantVoicePack();
    registerLogisticsVoicePack();
  });

  afterEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  it("reports healthy for a configured restaurant number: lookup → phase → tools → rejection", async () => {
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(restaurantBranchEntity),
      "+15550000001"
    );

    expect(report.healthy).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual([...EXPECTED_CHECK_NAMES]);
    expect(report.checks.every((c) => c.passed)).toBe(true);

    // 1. Lookup resolved a restaurant route.
    expect(report.conversationType).toBe("restaurant_inbound_order");
    expect(report.route?.vertical).toBe("restaurant");

    // 2. Phase initialized to the restaurant inbound initial phase.
    expect(report.initialPhase).toBe("await_restaurant_id");

    // 3. Tools loaded for the restaurant domain.
    expect(report.toolNames).toContain("get_restaurant_details");
    expect(report.toolNames.length).toBeGreaterThan(0);
  });

  it("reports healthy for a configured logistics number and loads the logistics tool set", async () => {
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(logisticsLocationEntity),
      "+15550000002"
    );

    expect(report.healthy).toBe(true);
    expect(report.conversationType).toBe("logistics_booking");
    expect(report.route?.vertical).toBe("logistics");
    expect(report.initialPhase).toBe("await_org_verification");
    // Bridged logistics tool set (six tools) loads with no extra integrations.
    expect(report.toolNames).toContain("get_organization_details");
    expect(report.toolNames).toContain("create_shipment");
    expect(report.toolNames.length).toBe(6);
  });

  it("resolves the shared-number fallback route and remains healthy when no entity matches", async () => {
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(null),
      "+15550000003"
    );

    // Fallback flow still resolves a real conversation route (restaurant inbound).
    expect(report.conversationType).toBe("restaurant_inbound_order");
    expect(report.healthy).toBe(true);
  });

  it("stays healthy via the lookup fail-safe when the Convex query throws", async () => {
    const report = await runAgentRuntimeHealthCheck(
      throwingConvexClient(),
      "+15550000004"
    );

    expect(report.conversationType).toBe("restaurant_inbound_order");
    expect(report.healthy).toBe(true);
  });

  it("routes a follow-up callback reason to the follow-up conversation type", async () => {
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(restaurantBranchEntity),
      "+15550000005",
      { callbackReason: "followup" }
    );

    expect(report.conversationType).toBe("restaurant_followup");
    expect(report.healthy).toBe(true);
    // Follow-up starts in the order_open phase.
    expect(report.initialPhase).toBe("order_open");
  });

  it("rejects a real-but-out-of-phase tool as not_in_set only when it is absent from the set", async () => {
    // `upsert_order` is a real restaurant tool but is not exposed out-of-set;
    // it IS in the set, so a synthetic unknown name must be used to prove the
    // out-of-set path. Here we assert the explicit out-of-set override rejects.
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(restaurantBranchEntity),
      "+15550000006",
      { outOfSetToolName: "definitely_not_a_registered_tool" }
    );

    const rejection = report.checks.find((c) => c.name === "out_of_set_rejected");
    expect(rejection?.passed).toBe(true);
    expect(rejection?.detail).toContain("not_in_set");
    // Phase is preserved at the initial phase after a rejected call.
    expect(rejection?.detail).toContain("await_restaurant_id");
  });

  it("terminates (unhealthy) when the resolved conversation type has no registered pack", async () => {
    // Clearing the voice registry leaves prepareSession with no pack to resolve.
    clearVoiceRegistry();
    const report = await runAgentRuntimeHealthCheck(
      fakeConvexClient(restaurantBranchEntity),
      "+15550000007"
    );

    expect(report.healthy).toBe(false);
    // Lookup still succeeds; the failure is downstream at phase init.
    const lookup = report.checks.find((c) => c.name === "phone_lookup");
    expect(lookup?.passed).toBe(true);
    const phase = report.checks.find((c) => c.name === "phase_init");
    expect(phase?.passed).toBe(false);
    // The report always describes all four checks, even when short-circuited.
    expect(report.checks.map((c) => c.name)).toEqual([...EXPECTED_CHECK_NAMES]);
  });

  it("holds across arbitrary numbers and both configured verticals", async () => {
    const entityArb = fc.constantFrom(
      restaurantBranchEntity,
      logisticsLocationEntity
    );
    const phoneArb = fc.string({ minLength: 1, maxLength: 20 });

    await fc.assert(
      fc.asyncProperty(entityArb, phoneArb, async (entity, toNumber) => {
        const report = await runAgentRuntimeHealthCheck(
          fakeConvexClient(entity),
          toNumber
        );

        // All four checks are always reported, in order.
        expect(report.checks.map((c) => c.name)).toEqual([
          ...EXPECTED_CHECK_NAMES,
        ]);
        // A configured number yields a healthy runtime: route → phase → tools →
        // out-of-set rejection all pass.
        expect(report.healthy).toBe(true);
        expect(report.conversationType.length).toBeGreaterThan(0);
        expect(report.initialPhase).not.toBeNull();
        expect(report.toolNames.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
