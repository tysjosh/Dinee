/**
 * Feature: phone-number-provisioning, Property 13: Pool oldest-first selection
 *
 * **Validates: Requirements 5.5**
 *
 * For any number assignment from the pool, the selected number must be the one
 * with the earliest createdAt timestamp among all available numbers in the
 * requested region.
 *
 * This is a pure logic test — we simulate the pool selection algorithm from
 * initiateProvisioning (filter by region, sort by createdAt ascending, pick
 * first) and verify the result always has the minimum createdAt in the target
 * region.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets ────────────────────────────────────────────────────────

const TELECOM_PROVIDERS: TelecomProvider[] = [
  "twilio",
  "vonage",
  "africas_talking",
  "termii",
];

const PROVISIONING_REGIONS: ProvisioningRegion[] = [
  "nigeria",
  "ghana",
  "kenya",
  "south_africa",
  "default",
];

const NUMBER_CAPABILITIES: NumberCapability[] = ["voice", "sms", "mms", "fax"];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const digitArb = fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");

const e164Arb = fc
  .tuple(
    fc.constantFrom("1", "2", "3", "4", "5", "6", "7", "8", "9"),
    fc.array(digitArb, { minLength: 1, maxLength: 14 })
  )
  .map(([first, rest]) => `+${first}${rest.join("")}`);

const providerArb = fc.constantFrom<TelecomProvider>(...TELECOM_PROVIDERS);
const regionArb = fc.constantFrom<ProvisioningRegion>(...PROVISIONING_REGIONS);
const countryCodeArb = fc.constantFrom("NG", "GH", "KE", "ZA", "US", "GB");
const timestampArb = fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 });

const capabilitiesArb = fc
  .uniqueArray(fc.constantFrom<NumberCapability>(...NUMBER_CAPABILITIES), {
    minLength: 1,
    maxLength: 4,
  })
  .filter((arr) => arr.length >= 1);

const numberIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `PN_${chars.join("")}`);

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** An available phone number record in the pool */
interface AvailablePoolNumber {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "available";
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
}

// ─── Pool selection logic (mirrors mutations.ts initiateProvisioning) ────────

function selectFromPool(
  pool: AvailablePoolNumber[],
  targetRegion: ProvisioningRegion
): AvailablePoolNumber | null {
  const regionPool = pool
    .filter((n) => n.region === targetRegion)
    .sort((a, b) => a.createdAt - b.createdAt);

  return regionPool.length > 0 ? regionPool[0] : null;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a single available pool number with a specific region */
const poolNumberArb = (region: ProvisioningRegion): fc.Arbitrary<AvailablePoolNumber> =>
  fc
    .tuple(numberIdArb, e164Arb, providerArb, capabilitiesArb, countryCodeArb, timestampArb)
    .map(([numberId, phoneNumber, provider, capabilities, countryCode, createdAt]) => ({
      numberId,
      phoneNumber,
      provider,
      status: "available" as const,
      capabilities,
      region,
      countryCode,
      createdAt,
    }));

/** Generate a pool number with any region */
const anyPoolNumberArb: fc.Arbitrary<AvailablePoolNumber> = fc
  .tuple(numberIdArb, e164Arb, providerArb, capabilitiesArb, regionArb, countryCodeArb, timestampArb)
  .map(([numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt]) => ({
    numberId,
    phoneNumber,
    provider,
    status: "available" as const,
    capabilities,
    region,
    countryCode,
    createdAt,
  }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 13: Pool oldest-first selection", () => {
  it("selects the number with the earliest createdAt from the target region", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.array(anyPoolNumberArb, { minLength: 1, maxLength: 30 }),
        (targetRegion, pool) => {
          const regionNumbers = pool.filter((n) => n.region === targetRegion);
          // Only test when there are numbers in the target region
          fc.pre(regionNumbers.length > 0);

          const selected = selectFromPool(pool, targetRegion);
          expect(selected).not.toBeNull();

          // The selected number must have the minimum createdAt in the region
          const minCreatedAt = Math.min(...regionNumbers.map((n) => n.createdAt));
          expect(selected!.createdAt).toBe(minCreatedAt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("only considers numbers in the target region, ignoring other regions", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.array(anyPoolNumberArb, { minLength: 1, maxLength: 30 }),
        (targetRegion, pool) => {
          const regionNumbers = pool.filter((n) => n.region === targetRegion);
          fc.pre(regionNumbers.length > 0);

          const selected = selectFromPool(pool, targetRegion);
          expect(selected).not.toBeNull();
          expect(selected!.region).toBe(targetRegion);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("selects the only number when pool has a single number in the target region", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.tuple(numberIdArb, e164Arb, providerArb, capabilitiesArb, countryCodeArb, timestampArb),
        (targetRegion, [numberId, phoneNumber, provider, capabilities, countryCode, createdAt]) => {
          const singleNumber: AvailablePoolNumber = {
            numberId,
            phoneNumber,
            provider,
            status: "available",
            capabilities,
            region: targetRegion,
            countryCode,
            createdAt,
          };

          const selected = selectFromPool([singleNumber], targetRegion);
          expect(selected).not.toBeNull();
          expect(selected!.numberId).toBe(numberId);
          expect(selected!.createdAt).toBe(createdAt);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null when pool has no numbers in the target region", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.array(anyPoolNumberArb, { minLength: 0, maxLength: 20 }),
        (targetRegion, pool) => {
          // Ensure no numbers match the target region
          const filteredPool = pool.filter((n) => n.region !== targetRegion);

          const selected = selectFromPool(filteredPool, targetRegion);
          expect(selected).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles numbers with identical createdAt — selects one of them (stable sort)", () => {
    fc.assert(
      fc.property(
        regionArb,
        timestampArb,
        fc.array(
          fc.tuple(numberIdArb, e164Arb, providerArb, capabilitiesArb, countryCodeArb),
          { minLength: 2, maxLength: 10 }
        ),
        (targetRegion, sharedTimestamp, numberTuples) => {
          // Create multiple numbers with the same createdAt
          const pool: AvailablePoolNumber[] = numberTuples.map(
            ([numberId, phoneNumber, provider, capabilities, countryCode]) => ({
              numberId,
              phoneNumber,
              provider,
              status: "available" as const,
              capabilities,
              region: targetRegion,
              countryCode,
              createdAt: sharedTimestamp,
            })
          );

          const selected = selectFromPool(pool, targetRegion);
          expect(selected).not.toBeNull();
          // The selected number must be one of the pool numbers
          expect(pool.some((n) => n.numberId === selected!.numberId)).toBe(true);
          // Its createdAt must equal the shared timestamp (which is the minimum)
          expect(selected!.createdAt).toBe(sharedTimestamp);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("selected number always has createdAt <= all other numbers in the target region", () => {
    fc.assert(
      fc.property(
        regionArb,
        fc.array(anyPoolNumberArb, { minLength: 1, maxLength: 30 }),
        (targetRegion, pool) => {
          const regionNumbers = pool.filter((n) => n.region === targetRegion);
          fc.pre(regionNumbers.length > 0);

          const selected = selectFromPool(pool, targetRegion);
          expect(selected).not.toBeNull();

          // The selected number's createdAt must be <= every other number in the region
          for (const n of regionNumbers) {
            expect(selected!.createdAt).toBeLessThanOrEqual(n.createdAt);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
