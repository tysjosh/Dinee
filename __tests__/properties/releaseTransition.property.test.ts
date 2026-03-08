/**
 * Feature: phone-number-provisioning, Property 11: Release state transition chain
 *
 * **Validates: Requirements 4.1, 4.2, 4.4, 8.4**
 *
 * For any assigned number that is released, the status must transition through
 * "assigned" → "releasing" → "quarantined" in order, with assignment fields
 * cleared and releasedAt set when entering "releasing", and quarantineExpiresAt
 * set to releasedAt + QUARANTINE_PERIOD_MS (30 days) when entering "quarantined".
 *
 * This is a pure logic test — we simulate the release logic from mutations.ts:
 * 1. Start with an "assigned" phone number record
 * 2. Apply the release transition (releasing → quarantined)
 * 3. Verify all field updates and state transitions
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
  QUARANTINE_PERIOD_MS,
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

const branchIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `BR_${chars.join("")}`);

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** An assigned phone number record (pre-release) */
interface AssignedPhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "assigned";
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  assignedToType: "branch";
  assignedToId: string;
  assignedAt: number;
  providerNumberSid?: string;
  monthlyCost?: number;
  currency?: string;
}

/** The phone number record after entering "releasing" state */
interface ReleasingPhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "releasing";
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  assignedToType: undefined;
  assignedToId: undefined;
  assignedAt: undefined;
  releasedAt: number;
  providerNumberSid?: string;
  monthlyCost?: number;
  currency?: string;
}

/** The phone number record after entering "quarantined" state */
interface QuarantinedPhoneNumberRecord extends Omit<ReleasingPhoneNumberRecord, "status"> {
  status: "quarantined";
  quarantineExpiresAt: number;
}

// ─── Simulate release logic (mirrors mutations.ts releaseNumber) ────────────

function simulateRelease(
  record: AssignedPhoneNumberRecord,
  releaseTimestamp: number
): {
  releasingRecord: ReleasingPhoneNumberRecord;
  quarantinedRecord: QuarantinedPhoneNumberRecord;
} {
  // Step 1: Transition to "releasing" — clear assignment fields, set releasedAt
  const releasingRecord: ReleasingPhoneNumberRecord = {
    numberId: record.numberId,
    phoneNumber: record.phoneNumber,
    provider: record.provider,
    status: "releasing",
    capabilities: record.capabilities,
    region: record.region,
    countryCode: record.countryCode,
    createdAt: record.createdAt,
    assignedToType: undefined,
    assignedToId: undefined,
    assignedAt: undefined,
    releasedAt: releaseTimestamp,
    providerNumberSid: record.providerNumberSid,
    monthlyCost: record.monthlyCost,
    currency: record.currency,
  };

  // Step 2: Transition to "quarantined" — set quarantineExpiresAt
  const quarantinedRecord: QuarantinedPhoneNumberRecord = {
    ...releasingRecord,
    status: "quarantined",
    quarantineExpiresAt: releaseTimestamp + QUARANTINE_PERIOD_MS,
  };

  return { releasingRecord, quarantinedRecord };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate an assigned phone number record with assignment fields set */
const assignedRecordArb: fc.Arbitrary<AssignedPhoneNumberRecord> = fc
  .tuple(
    numberIdArb,
    e164Arb,
    providerArb,
    capabilitiesArb,
    regionArb,
    countryCodeArb,
    timestampArb,
    branchIdArb,
    timestampArb
  )
  .map(([numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt, branchId, assignedAt]) => ({
    numberId,
    phoneNumber,
    provider,
    status: "assigned" as const,
    capabilities,
    region,
    countryCode,
    createdAt,
    assignedToType: "branch" as const,
    assignedToId: branchId,
    assignedAt,
  }));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 11: Release state transition chain", () => {
  it("releasing record status is 'releasing' after first transition", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { releasingRecord } = simulateRelease(record, releaseTs);
        expect(releasingRecord.status).toBe("releasing");
      }),
      { numRuns: 100 }
    );
  });

  it("assignment fields are cleared in releasing state (Req 4.2)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { releasingRecord } = simulateRelease(record, releaseTs);
        expect(releasingRecord.assignedToType).toBeUndefined();
        expect(releasingRecord.assignedToId).toBeUndefined();
        expect(releasingRecord.assignedAt).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("releasedAt is set to the release timestamp (Req 4.1)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { releasingRecord } = simulateRelease(record, releaseTs);
        expect(releasingRecord.releasedAt).toBe(releaseTs);
        expect(releasingRecord.releasedAt).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("final status is 'quarantined' after full transition chain (Req 4.4)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { quarantinedRecord } = simulateRelease(record, releaseTs);
        expect(quarantinedRecord.status).toBe("quarantined");
      }),
      { numRuns: 100 }
    );
  });

  it("quarantineExpiresAt equals releasedAt + QUARANTINE_PERIOD_MS (30 days) (Req 4.4, 8.4)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { quarantinedRecord } = simulateRelease(record, releaseTs);
        expect(quarantinedRecord.quarantineExpiresAt).toBe(releaseTs + QUARANTINE_PERIOD_MS);
        // Verify QUARANTINE_PERIOD_MS is 30 days
        expect(QUARANTINE_PERIOD_MS).toBe(30 * 24 * 60 * 60 * 1000);
      }),
      { numRuns: 100 }
    );
  });

  it("assignment fields remain cleared in quarantined state", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { quarantinedRecord } = simulateRelease(record, releaseTs);
        expect(quarantinedRecord.assignedToType).toBeUndefined();
        expect(quarantinedRecord.assignedToId).toBeUndefined();
        expect(quarantinedRecord.assignedAt).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("releasedAt is preserved in quarantined state", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { quarantinedRecord } = simulateRelease(record, releaseTs);
        expect(quarantinedRecord.releasedAt).toBe(releaseTs);
      }),
      { numRuns: 100 }
    );
  });

  it("original fields (numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt) are preserved", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { quarantinedRecord } = simulateRelease(record, releaseTs);
        expect(quarantinedRecord.numberId).toBe(record.numberId);
        expect(quarantinedRecord.phoneNumber).toBe(record.phoneNumber);
        expect(quarantinedRecord.provider).toBe(record.provider);
        expect(quarantinedRecord.capabilities).toEqual(record.capabilities);
        expect(quarantinedRecord.region).toBe(record.region);
        expect(quarantinedRecord.countryCode).toBe(record.countryCode);
        expect(quarantinedRecord.createdAt).toBe(record.createdAt);
      }),
      { numRuns: 100 }
    );
  });

  it("all release transition invariants hold simultaneously for any valid input", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, releaseTs) => {
        const { releasingRecord, quarantinedRecord } = simulateRelease(record, releaseTs);

        // Transition chain: assigned → releasing → quarantined
        expect(record.status).toBe("assigned");
        expect(releasingRecord.status).toBe("releasing");
        expect(quarantinedRecord.status).toBe("quarantined");

        // Req 4.2 — assignment fields cleared in releasing
        expect(releasingRecord.assignedToType).toBeUndefined();
        expect(releasingRecord.assignedToId).toBeUndefined();
        expect(releasingRecord.assignedAt).toBeUndefined();

        // Req 4.1 — releasedAt set
        expect(releasingRecord.releasedAt).toBe(releaseTs);
        expect(releasingRecord.releasedAt).toBeGreaterThan(0);

        // Req 4.4 — quarantineExpiresAt = releasedAt + QUARANTINE_PERIOD_MS
        expect(quarantinedRecord.quarantineExpiresAt).toBe(releaseTs + QUARANTINE_PERIOD_MS);

        // Assignment fields still cleared in quarantined
        expect(quarantinedRecord.assignedToType).toBeUndefined();
        expect(quarantinedRecord.assignedToId).toBeUndefined();
        expect(quarantinedRecord.assignedAt).toBeUndefined();

        // releasedAt preserved
        expect(quarantinedRecord.releasedAt).toBe(releaseTs);

        // Original fields preserved
        expect(quarantinedRecord.numberId).toBe(record.numberId);
        expect(quarantinedRecord.phoneNumber).toBe(record.phoneNumber);
        expect(quarantinedRecord.provider).toBe(record.provider);
        expect(quarantinedRecord.capabilities).toEqual(record.capabilities);
        expect(quarantinedRecord.region).toBe(record.region);
        expect(quarantinedRecord.countryCode).toBe(record.countryCode);
        expect(quarantinedRecord.createdAt).toBe(record.createdAt);
      }),
      { numRuns: 100 }
    );
  });
});
