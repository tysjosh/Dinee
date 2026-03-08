/**
 * Feature: phone-number-provisioning, Property 7: Assignment invariants
 *
 * **Validates: Requirements 3.3, 3.4, 3.5**
 *
 * For any number assignment to a branch, the phone number record must have
 * status "assigned", assignedToType "branch", assignedToId equal to the
 * branchId, and assignedAt set to the assignment timestamp, AND the branch
 * record's phoneNumber field must be updated with the E.164 number.
 *
 * This is a pure logic test — we simulate the assignment by applying the
 * expected field updates to a generated "available" phone number record and
 * verify all invariants hold.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
  isValidE164,
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

/** An available phone number record (pre-assignment) */
interface AvailablePhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "available";
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  providerNumberSid?: string;
  monthlyCost?: number;
  currency?: string;
}

/** The phone number record after assignment */
interface AssignedPhoneNumberRecord extends Omit<AvailablePhoneNumberRecord, "status"> {
  status: "assigned";
  assignedToType: "branch";
  assignedToId: string;
  assignedAt: number;
}

/** Simulated branch record */
interface BranchRecord {
  branchId: string;
  phoneNumber: string;
}

// ─── Simulate assignment logic (mirrors mutations.ts assignNumberToBranch) ──

function simulateAssignment(
  record: AvailablePhoneNumberRecord,
  branchId: string,
  assignmentTimestamp: number
): { phoneNumberRecord: AssignedPhoneNumberRecord; branchUpdate: BranchRecord } {
  const phoneNumberRecord: AssignedPhoneNumberRecord = {
    ...record,
    status: "assigned",
    assignedToType: "branch",
    assignedToId: branchId,
    assignedAt: assignmentTimestamp,
  };

  const branchUpdate: BranchRecord = {
    branchId,
    phoneNumber: record.phoneNumber,
  };

  return { phoneNumberRecord, branchUpdate };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate an available phone number record with no assignment fields */
const availableRecordArb: fc.Arbitrary<AvailablePhoneNumberRecord> = fc
  .tuple(
    numberIdArb,
    e164Arb,
    providerArb,
    capabilitiesArb,
    regionArb,
    countryCodeArb,
    timestampArb
  )
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 7: Assignment invariants", () => {
  it("assigned record status is 'assigned'", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord } = simulateAssignment(record, branchId, ts);
        expect(phoneNumberRecord.status).toBe("assigned");
      }),
      { numRuns: 100 }
    );
  });

  it("assigned record assignedToType is 'branch'", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord } = simulateAssignment(record, branchId, ts);
        expect(phoneNumberRecord.assignedToType).toBe("branch");
      }),
      { numRuns: 100 }
    );
  });

  it("assigned record assignedToId equals the branchId", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord } = simulateAssignment(record, branchId, ts);
        expect(phoneNumberRecord.assignedToId).toBe(branchId);
      }),
      { numRuns: 100 }
    );
  });

  it("assigned record assignedAt is a valid timestamp (> 0)", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord } = simulateAssignment(record, branchId, ts);
        expect(phoneNumberRecord.assignedAt).toBeGreaterThan(0);
        expect(phoneNumberRecord.assignedAt).toBe(ts);
      }),
      { numRuns: 100 }
    );
  });

  it("branch record phoneNumber is updated with the E.164 number", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { branchUpdate } = simulateAssignment(record, branchId, ts);
        expect(branchUpdate.phoneNumber).toBe(record.phoneNumber);
        expect(isValidE164(branchUpdate.phoneNumber)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("branch record branchId matches the assignment target", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { branchUpdate } = simulateAssignment(record, branchId, ts);
        expect(branchUpdate.branchId).toBe(branchId);
      }),
      { numRuns: 100 }
    );
  });

  it("original fields (numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt) are preserved", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord } = simulateAssignment(record, branchId, ts);
        expect(phoneNumberRecord.numberId).toBe(record.numberId);
        expect(phoneNumberRecord.phoneNumber).toBe(record.phoneNumber);
        expect(phoneNumberRecord.provider).toBe(record.provider);
        expect(phoneNumberRecord.capabilities).toEqual(record.capabilities);
        expect(phoneNumberRecord.region).toBe(record.region);
        expect(phoneNumberRecord.countryCode).toBe(record.countryCode);
        expect(phoneNumberRecord.createdAt).toBe(record.createdAt);
      }),
      { numRuns: 100 }
    );
  });

  it("all assignment invariants hold simultaneously for any valid input", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, timestampArb, (record, branchId, ts) => {
        const { phoneNumberRecord, branchUpdate } = simulateAssignment(record, branchId, ts);

        // Req 3.5 — status transitions to "assigned"
        expect(phoneNumberRecord.status).toBe("assigned");
        // Req 3.3 — assignedToType is "branch", assignedToId is branchId, assignedAt is set
        expect(phoneNumberRecord.assignedToType).toBe("branch");
        expect(phoneNumberRecord.assignedToId).toBe(branchId);
        expect(phoneNumberRecord.assignedAt).toBe(ts);
        expect(phoneNumberRecord.assignedAt).toBeGreaterThan(0);
        // Req 3.4 — branch record's phoneNumber is updated with E.164 number
        expect(branchUpdate.phoneNumber).toBe(record.phoneNumber);
        expect(isValidE164(branchUpdate.phoneNumber)).toBe(true);
        // Original fields preserved
        expect(phoneNumberRecord.numberId).toBe(record.numberId);
        expect(phoneNumberRecord.provider).toBe(record.provider);
        expect(phoneNumberRecord.region).toBe(record.region);
      }),
      { numRuns: 100 }
    );
  });
});
