/**
 * Feature: phone-number-provisioning, Property 3: Provider failover ordering
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * For any region and sequence of provider failures, the provisioning service
 * must attempt providers in the correct order: primary provider first, then
 * secondary, then remaining providers in the defined tertiary order, never
 * repeating an already-attempted provider.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getProviderOrder,
  getNextProvider,
} from "../../convex/phoneProvisioning/providerRouting";
import {
  PROVIDER_ROUTING_TABLE,
  type TelecomProvider,
  type ProvisioningRegion,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_REGIONS: ProvisioningRegion[] = [
  "nigeria",
  "ghana",
  "kenya",
  "south_africa",
  "default",
];

const ALL_PROVIDERS: TelecomProvider[] = [
  "twilio",
  "vonage",
  "africas_talking",
  "termii",
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const regionArb = fc.constantFrom<ProvisioningRegion>(...ALL_REGIONS);
const providerArb = fc.constantFrom<TelecomProvider>(...ALL_PROVIDERS);

/** Generate a random subset of providers as "already attempted" */
const attemptedProvidersArb = fc.subarray(ALL_PROVIDERS, { minLength: 0, maxLength: 4 });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 3: Provider failover ordering", () => {
  it("getProviderOrder always returns exactly 4 providers (one for each telecom)", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const order = getProviderOrder(region);
        expect(order).toHaveLength(4);
      }),
      { numRuns: 100 }
    );
  });

  it("getProviderOrder returns providers in routing table order (primary, secondary, tertiary)", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const order = getProviderOrder(region);
        const route = PROVIDER_ROUTING_TABLE[region];

        expect(order[0]).toBe(route.primary);
        expect(order[1]).toBe(route.secondary);
        expect(order.slice(2)).toEqual(route.tertiary);
      }),
      { numRuns: 100 }
    );
  });

  it("getProviderOrder never contains duplicate providers", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const order = getProviderOrder(region);
        const unique = new Set(order);
        expect(unique.size).toBe(order.length);
      }),
      { numRuns: 100 }
    );
  });

  it("getProviderOrder contains all four telecom providers", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const order = getProviderOrder(region);
        const sorted = [...order].sort();
        const expected = [...ALL_PROVIDERS].sort();
        expect(sorted).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("getNextProvider never returns a provider that has already been attempted", () => {
    fc.assert(
      fc.property(regionArb, attemptedProvidersArb, (region, attempted) => {
        const next = getNextProvider(region, attempted);
        if (next !== null) {
          expect(attempted).not.toContain(next);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("getNextProvider returns null when all providers have been attempted", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const result = getNextProvider(region, ALL_PROVIDERS);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("getNextProvider returns the first provider in routing order that has not been attempted", () => {
    fc.assert(
      fc.property(regionArb, attemptedProvidersArb, (region, attempted) => {
        const next = getNextProvider(region, attempted);
        const order = getProviderOrder(region);
        const attemptedSet = new Set(attempted);

        // Find the expected next provider manually
        const expected = order.find((p) => !attemptedSet.has(p)) ?? null;
        expect(next).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("simulating sequential failures: each getNextProvider call returns the next provider in routing table order", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const expectedOrder = getProviderOrder(region);
        const attempted: TelecomProvider[] = [];

        for (const expectedProvider of expectedOrder) {
          const next = getNextProvider(region, attempted);
          expect(next).toBe(expectedProvider);
          attempted.push(next!);
        }

        // After all providers attempted, should return null
        const final = getNextProvider(region, attempted);
        expect(final).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("getNextProvider with empty attempted list always returns the primary provider", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const next = getNextProvider(region, []);
        const route = PROVIDER_ROUTING_TABLE[region];
        expect(next).toBe(route.primary);
      }),
      { numRuns: 100 }
    );
  });

  it("getNextProvider with only primary attempted returns the secondary provider", () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const route = PROVIDER_ROUTING_TABLE[region];
        const next = getNextProvider(region, [route.primary]);
        expect(next).toBe(route.secondary);
      }),
      { numRuns: 100 }
    );
  });
});
