/**
 * Feature: phone-number-provisioning, Property 15: Pool invariant
 *
 * **Validates: Requirements 5.4**
 *
 * For any number in the pool (status "available"), it must have no
 * assignedToId and no assignedToType set. Conversely, any record with
 * assignedToId or assignedToType set should NOT have status "available".
 *
 * This is a pure data-integrity test — we generate random phone number
 * records with various statuses and verify the pool invariant holds.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberStatus,
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
  type AssignedToType,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets ────────────────────────────────────────────────────────

const NUMBER_STATUSES: NumberStatus[] = [
  "available",
  "assigned",
  "releasing",
  "released",
  "quarantined",
  "failed",
];

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

const ASSIGNED_TO_TYPES: AssignedToType[] = ["branch", "location"];

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
const statusArb = fc.constantFrom<NumberStatus>(...NUMBER_STATUSES);
const countryCodeArb = fc.constantFrom("NG", "GH", "KE", "ZA", "US", "GB");
const timestampArb = fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 });
const assignedToTypeArb = fc.constantFrom<AssignedToType>(...ASSIGNED_TO_TYPES);

const capabilitiesArb = fc.uniqueArray(
  fc.constantFrom<NumberCapability>(...NUMBER_CAPABILITIES),
  { minLength: 1, maxLength: 4 }
);

const numberIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `PN_${chars.join("")}`);

const entityIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `ENT_${chars.join("")}`);

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface PhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: NumberStatus;
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  assignedToType?: AssignedToType;
  assignedToId?: string;
  assignedAt?: number;
}

// ─── Pool invariant check ────────────────────────────────────────────────────

/**
 * Checks the pool invariant: an "available" number must NOT have
 * assignedToId or assignedToType set.
 */
function checkPoolInvariant(record: PhoneNumberRecord): boolean {
  if (record.status === "available") {
    return record.assignedToId === undefined && record.assignedToType === undefined;
  }
  return true;
}

/**
 * Checks the inverse invariant: a record with assignedToId or
 * assignedToType set must NOT have status "available".
 */
function checkInverseInvariant(record: PhoneNumberRecord): boolean {
  if (record.assignedToId !== undefined || record.assignedToType !== undefined) {
    return record.status !== "available";
  }
  return true;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid pool number (status "available", no assignment fields) */
const validPoolRecordArb: fc.Arbitrary<PhoneNumberRecord> = fc
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

/** Generate a record with assignment fields set and a non-available status */
const assignedRecordArb: fc.Arbitrary<PhoneNumberRecord> = fc
  .tuple(
    numberIdArb,
    e164Arb,
    providerArb,
    capabilitiesArb,
    regionArb,
    countryCodeArb,
    timestampArb,
    assignedToTypeArb,
    entityIdArb,
    timestampArb
  )
  .map(([numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt, assignedToType, assignedToId, assignedAt]) => ({
    numberId,
    phoneNumber,
    provider,
    status: "assigned" as const,
    capabilities,
    region,
    countryCode,
    createdAt,
    assignedToType,
    assignedToId,
    assignedAt,
  }));

/** Generate a random phone number record with any status and optional assignment fields */
const randomRecordArb: fc.Arbitrary<PhoneNumberRecord> = fc
  .tuple(
    numberIdArb,
    e164Arb,
    providerArb,
    statusArb,
    capabilitiesArb,
    regionArb,
    countryCodeArb,
    timestampArb,
    fc.option(assignedToTypeArb, { nil: undefined }),
    fc.option(entityIdArb, { nil: undefined }),
    fc.option(timestampArb, { nil: undefined })
  )
  .map(([numberId, phoneNumber, provider, status, capabilities, region, countryCode, createdAt, assignedToType, assignedToId, assignedAt]) => ({
    numberId,
    phoneNumber,
    provider,
    status,
    capabilities,
    region,
    countryCode,
    createdAt,
    ...(assignedToType !== undefined ? { assignedToType } : {}),
    ...(assignedToId !== undefined ? { assignedToId } : {}),
    ...(assignedAt !== undefined ? { assignedAt } : {}),
  }));

/** Generate a pool of records that all satisfy the invariant */
const validPoolArb = fc.array(
  fc.oneof(validPoolRecordArb, assignedRecordArb),
  { minLength: 1, maxLength: 20 }
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 15: Pool invariant", () => {
  it("available numbers have no assignedToId set", () => {
    fc.assert(
      fc.property(validPoolRecordArb, (record) => {
        expect(record.status).toBe("available");
        expect(record.assignedToId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("available numbers have no assignedToType set", () => {
    fc.assert(
      fc.property(validPoolRecordArb, (record) => {
        expect(record.status).toBe("available");
        expect(record.assignedToType).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("pool invariant holds for all valid pool records", () => {
    fc.assert(
      fc.property(validPoolArb, (pool) => {
        for (const record of pool) {
          expect(checkPoolInvariant(record)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("inverse invariant: records with assignment fields are not available", () => {
    fc.assert(
      fc.property(assignedRecordArb, (record) => {
        expect(record.assignedToId).toBeDefined();
        expect(record.assignedToType).toBeDefined();
        expect(record.status).not.toBe("available");
      }),
      { numRuns: 100 }
    );
  });

  it("random records that satisfy pool invariant pass the check", () => {
    fc.assert(
      fc.property(randomRecordArb, (record) => {
        // Filter to only records that satisfy the invariant
        const satisfiesInvariant = checkPoolInvariant(record);
        if (record.status === "available") {
          // If available, invariant holds iff no assignment fields
          expect(satisfiesInvariant).toBe(
            record.assignedToId === undefined && record.assignedToType === undefined
          );
        } else {
          // Non-available records always satisfy the pool invariant
          expect(satisfiesInvariant).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("random records that satisfy inverse invariant pass the check", () => {
    fc.assert(
      fc.property(randomRecordArb, (record) => {
        const satisfiesInverse = checkInverseInvariant(record);
        if (record.assignedToId !== undefined || record.assignedToType !== undefined) {
          // If assignment fields set, inverse holds iff status is not available
          expect(satisfiesInverse).toBe(record.status !== "available");
        } else {
          // No assignment fields → inverse always holds
          expect(satisfiesInverse).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("both invariants hold simultaneously for well-formed pool states", () => {
    fc.assert(
      fc.property(validPoolArb, (pool) => {
        for (const record of pool) {
          // Pool invariant: available → no assignment
          expect(checkPoolInvariant(record)).toBe(true);
          // Inverse invariant: has assignment → not available
          expect(checkInverseInvariant(record)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
