/**
 * Feature: phone-number-provisioning, Property 19: Cost aggregation correctness
 *
 * **Validates: Requirements 8.2, 8.3**
 *
 * For any set of phone number records, the total monthly cost query grouped by
 * provider and region must equal the sum of monthlyCost values for each group,
 * and the per-branch cost query must return the monthlyCost of the number
 * assigned to that branch.
 *
 * This is a pure logic test — we simulate the aggregation by applying the same
 * grouping/summing logic the Convex queries use, against randomly generated
 * phone number records.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type TelecomProvider,
  type ProvisioningRegion,
  type NumberCapability,
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

const CURRENCIES = ["USD", "NGN", "GHS", "KES", "ZAR"];

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Minimal assigned phone number record for cost aggregation */
interface AssignedPhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "assigned";
  region: ProvisioningRegion;
  assignedToType: "branch";
  assignedToId: string;
  monthlyCost: number;
  currency: string;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const providerArb = fc.constantFrom<TelecomProvider>(...TELECOM_PROVIDERS);
const regionArb = fc.constantFrom<ProvisioningRegion>(...PROVISIONING_REGIONS);
const currencyArb = fc.constantFrom(...CURRENCIES);

/** Monthly cost: 0 to 100 with 2 decimal places */
const monthlyCostArb = fc
  .integer({ min: 0, max: 10000 })
  .map((n) => n / 100);

const branchIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 12,
  })
  .map((chars) => `BR_${chars.join("")}`);

const numberIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 12,
  })
  .map((chars) => `PN_${chars.join("")}`);

const digitArb = fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");

const e164Arb = fc
  .tuple(
    fc.constantFrom("1", "2", "3", "4", "5", "6", "7", "8", "9"),
    fc.array(digitArb, { minLength: 1, maxLength: 14 })
  )
  .map(([first, rest]) => `+${first}${rest.join("")}`);

/** Generate a single assigned phone number record */
const assignedRecordArb: fc.Arbitrary<AssignedPhoneNumberRecord> = fc
  .tuple(numberIdArb, e164Arb, providerArb, regionArb, branchIdArb, monthlyCostArb, currencyArb)
  .map(([numberId, phoneNumber, provider, region, assignedToId, monthlyCost, currency]) => ({
    numberId,
    phoneNumber,
    provider,
    status: "assigned" as const,
    region,
    assignedToType: "branch" as const,
    assignedToId,
    monthlyCost,
    currency,
  }));

/** Generate a list of assigned phone number records (1 to 30) */
const recordSetArb = fc.array(assignedRecordArb, { minLength: 1, maxLength: 30 });

// ─── Aggregation logic (mirrors getMonthlyPhoneNumberCosts query) ────────────

function aggregateCosts(
  records: AssignedPhoneNumberRecord[],
  groupBy: "provider" | "region"
): Record<string, { totalCost: number; currency: string; count: number }> {
  const groups: Record<string, { totalCost: number; currency: string; count: number }> = {};

  for (const record of records) {
    const key = groupBy === "provider" ? record.provider : record.region;
    if (!groups[key]) {
      groups[key] = { totalCost: 0, currency: record.currency, count: 0 };
    }
    groups[key].totalCost += record.monthlyCost;
    groups[key].count += 1;
  }

  return groups;
}

// ─── Per-branch cost logic (mirrors getBranchPhoneNumberCost query) ──────────

function getBranchCost(
  records: AssignedPhoneNumberRecord[],
  branchId: string
): { branchId: string; monthlyCost: number; currency: string; hasNumber: boolean } {
  const record = records.find((r) => r.assignedToId === branchId);
  if (!record) {
    return { branchId, monthlyCost: 0, currency: "USD", hasNumber: false };
  }
  return {
    branchId,
    monthlyCost: record.monthlyCost,
    currency: record.currency,
    hasNumber: true,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 19: Cost aggregation correctness", () => {
  it("provider grouping: sum of monthlyCost per provider matches manual calculation", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "provider");

        // Manually compute expected sums per provider
        const expected: Record<string, number> = {};
        for (const r of records) {
          expected[r.provider] = (expected[r.provider] || 0) + r.monthlyCost;
        }

        for (const [provider, expectedSum] of Object.entries(expected)) {
          expect(aggregated[provider].totalCost).toBeCloseTo(expectedSum, 10);
        }

        // No extra groups
        expect(Object.keys(aggregated).sort()).toEqual(Object.keys(expected).sort());
      }),
      { numRuns: 100 }
    );
  });

  it("region grouping: sum of monthlyCost per region matches manual calculation", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "region");

        // Manually compute expected sums per region
        const expected: Record<string, number> = {};
        for (const r of records) {
          expected[r.region] = (expected[r.region] || 0) + r.monthlyCost;
        }

        for (const [region, expectedSum] of Object.entries(expected)) {
          expect(aggregated[region].totalCost).toBeCloseTo(expectedSum, 10);
        }

        expect(Object.keys(aggregated).sort()).toEqual(Object.keys(expected).sort());
      }),
      { numRuns: 100 }
    );
  });

  it("provider grouping: count per group is correct", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "provider");

        const expectedCounts: Record<string, number> = {};
        for (const r of records) {
          expectedCounts[r.provider] = (expectedCounts[r.provider] || 0) + 1;
        }

        for (const [provider, expectedCount] of Object.entries(expectedCounts)) {
          expect(aggregated[provider].count).toBe(expectedCount);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("region grouping: count per group is correct", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "region");

        const expectedCounts: Record<string, number> = {};
        for (const r of records) {
          expectedCounts[r.region] = (expectedCounts[r.region] || 0) + 1;
        }

        for (const [region, expectedCount] of Object.entries(expectedCounts)) {
          expect(aggregated[region].count).toBe(expectedCount);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("per-branch cost returns correct monthlyCost for an assigned branch", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        // Pick a random record and check its branch cost
        for (const record of records) {
          const result = getBranchCost(records, record.assignedToId);
          expect(result.hasNumber).toBe(true);
          expect(result.monthlyCost).toBe(record.monthlyCost);
          expect(result.currency).toBe(record.currency);
          expect(result.branchId).toBe(record.assignedToId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("per-branch cost returns hasNumber false for non-existent branch", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const fakeBranchId = "BR_nonexistent_branch_xyz";
        const result = getBranchCost(records, fakeBranchId);
        expect(result.hasNumber).toBe(false);
        expect(result.monthlyCost).toBe(0);
        expect(result.currency).toBe("USD");
      }),
      { numRuns: 100 }
    );
  });

  it("total cost across all provider groups equals sum of all record costs", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "provider");

        const totalFromGroups = Object.values(aggregated).reduce(
          (sum, g) => sum + g.totalCost,
          0
        );
        const totalFromRecords = records.reduce((sum, r) => sum + r.monthlyCost, 0);

        expect(totalFromGroups).toBeCloseTo(totalFromRecords, 10);
      }),
      { numRuns: 100 }
    );
  });

  it("total cost across all region groups equals sum of all record costs", () => {
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const aggregated = aggregateCosts(records, "region");

        const totalFromGroups = Object.values(aggregated).reduce(
          (sum, g) => sum + g.totalCost,
          0
        );
        const totalFromRecords = records.reduce((sum, r) => sum + r.monthlyCost, 0);

        expect(totalFromGroups).toBeCloseTo(totalFromRecords, 10);
      }),
      { numRuns: 100 }
    );
  });

  it("total count across all groups equals total number of records", () => {
    fc.assert(
      fc.property(
        recordSetArb,
        fc.constantFrom<"provider" | "region">("provider", "region"),
        (records, groupBy) => {
          const aggregated = aggregateCosts(records, groupBy);

          const totalCount = Object.values(aggregated).reduce(
            (sum, g) => sum + g.count,
            0
          );

          expect(totalCount).toBe(records.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("empty record set produces empty aggregation", () => {
    const emptyAggProvider = aggregateCosts([], "provider");
    const emptyAggRegion = aggregateCosts([], "region");
    expect(Object.keys(emptyAggProvider)).toHaveLength(0);
    expect(Object.keys(emptyAggRegion)).toHaveLength(0);

    const branchCost = getBranchCost([], "BR_any");
    expect(branchCost.hasNumber).toBe(false);
    expect(branchCost.monthlyCost).toBe(0);
  });
});
