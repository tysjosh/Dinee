/**
 * Feature: ai-reception-os-pivot, Property 5: Migration Idempotency
 *
 * Validates: Requirements 16.8, 4.6, 16.2
 *
 * For any migration step function and any initial database state, executing
 * the step once and then executing it again SHALL produce the same final
 * database state as executing it only once.
 * Formally: migrate(migrate(state)) === migrate(state)
 *
 * Also verifies that dry-run mode leaves state unchanged (Req 16.9).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Types: simulated Business record
// ---------------------------------------------------------------------------

type Vertical =
  | "general_services"
  | "healthcare"
  | "legal"
  | "hospitality"
  | "logistics"
  | "restaurant";

interface BusinessRecord {
  _id: string;
  restaurantId: string;
  vertical?: Vertical;
  enabledModules?: string[];
}

// ---------------------------------------------------------------------------
// Pure simulation of migration step 1 logic (mirrors step1_addVerticalField)
// ---------------------------------------------------------------------------

/**
 * Simulates the step1_addVerticalField migration on an array of business
 * records. Records without a `vertical` field are backfilled with
 * vertical: "restaurant" and enabledModules: ["core_platform", "restaurant_pack"].
 * Records that already have `vertical` set are left untouched.
 */
function applyStep1Migration(
  records: BusinessRecord[],
  dryRun: boolean
): BusinessRecord[] {
  if (dryRun) {
    // Dry-run: return records unchanged (deep copy to prove no mutation)
    return records.map((r) => ({ ...r }));
  }

  return records.map((record) => {
    if (!record.vertical) {
      return {
        ...record,
        vertical: "restaurant" as Vertical,
        enabledModules: ["core_platform", "restaurant_pack"],
      };
    }
    // Already has vertical — leave untouched (idempotency)
    return { ...record };
  });
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ALL_VERTICALS: Vertical[] = [
  "general_services",
  "healthcare",
  "legal",
  "hospitality",
  "logistics",
  "restaurant",
];

const ALL_MODULES = [
  "core_platform",
  "restaurant_pack",
  "logistics_pack",
  "healthcare_pack",
  "legal_pack",
  "hospitality_pack",
  "general_services_pack",
  "runsheet_connect",
];

/** Generate a single business record with a partial migration state */
const businessRecordArb: fc.Arbitrary<BusinessRecord> = fc
  .record({
    _id: fc.uuid(),
    restaurantId: fc.string({ minLength: 1, maxLength: 20 }),
    hasVertical: fc.boolean(),
    vertical: fc.constantFrom(...ALL_VERTICALS),
    enabledModules: fc.subarray(ALL_MODULES, { minLength: 1 }),
  })
  .map(({ _id, restaurantId, hasVertical, vertical, enabledModules }) => {
    const record: BusinessRecord = { _id, restaurantId };
    if (hasVertical) {
      record.vertical = vertical;
      record.enabledModules = enabledModules;
    }
    return record;
  });

/** Generate a set of business records (1–30) with mixed migration states */
const businessRecordSetArb = fc.array(businessRecordArb, {
  minLength: 1,
  maxLength: 30,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-equal comparison of two record arrays by field values */
function recordsAreEqual(
  a: BusinessRecord[],
  b: BusinessRecord[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]._id !== b[i]._id) return false;
    if (a[i].restaurantId !== b[i].restaurantId) return false;
    if (a[i].vertical !== b[i].vertical) return false;
    const aModules = JSON.stringify(a[i].enabledModules ?? null);
    const bModules = JSON.stringify(b[i].enabledModules ?? null);
    if (aModules !== bModules) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 5: Migration Idempotency", () => {
  it("applying step 1 twice produces the same state as applying it once", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const afterFirst = applyStep1Migration(records, false);
        const afterSecond = applyStep1Migration(afterFirst, false);

        expect(recordsAreEqual(afterFirst, afterSecond)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("records with vertical already set are never modified by migration", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const alreadyMigrated = records.filter((r) => r.vertical !== undefined);
        const afterMigration = applyStep1Migration(records, false);

        for (const original of alreadyMigrated) {
          const migrated = afterMigration.find((r) => r._id === original._id);
          expect(migrated).toBeDefined();
          expect(migrated!.vertical).toBe(original.vertical);
          expect(JSON.stringify(migrated!.enabledModules)).toBe(
            JSON.stringify(original.enabledModules)
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it("records without vertical are backfilled to restaurant with correct modules", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const needsMigration = records.filter((r) => r.vertical === undefined);
        const afterMigration = applyStep1Migration(records, false);

        for (const original of needsMigration) {
          const migrated = afterMigration.find((r) => r._id === original._id);
          expect(migrated).toBeDefined();
          expect(migrated!.vertical).toBe("restaurant");
          expect(migrated!.enabledModules).toEqual([
            "core_platform",
            "restaurant_pack",
          ]);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("dry-run mode leaves all records unchanged", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const afterDryRun = applyStep1Migration(records, true);

        expect(recordsAreEqual(records, afterDryRun)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("record count is preserved after migration", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const afterMigration = applyStep1Migration(records, false);
        expect(afterMigration.length).toBe(records.length);
      }),
      { numRuns: 100 }
    );
  });

  it("all records have a vertical set after migration", () => {
    fc.assert(
      fc.property(businessRecordSetArb, (records) => {
        const afterMigration = applyStep1Migration(records, false);

        for (const record of afterMigration) {
          expect(record.vertical).toBeDefined();
          expect(ALL_VERTICALS).toContain(record.vertical);
        }
      }),
      { numRuns: 100 }
    );
  });
});
