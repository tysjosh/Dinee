/**
 * Feature: phone-number-provisioning, Property 9: Only available numbers can be assigned
 *
 * **Validates: Requirements 3.7, 4.7**
 *
 * For any phone number not in "available" status (including "assigned",
 * "quarantined", "releasing", "released", "failed"), an assignment attempt
 * must be rejected. This prevents double-assignment and quarantine bypass.
 * Additionally, numbers with "available" status must be accepted.
 *
 * This is a pure logic test — we simulate the assignment guard that checks
 * status !== "available" and verify it correctly rejects non-available
 * numbers and accepts available ones.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberStatus,
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets ────────────────────────────────────────────────────────

const NON_AVAILABLE_STATUSES: NumberStatus[] = [
  "assigned",
  "quarantined",
  "releasing",
  "released",
  "failed",
];

const ALL_STATUSES: NumberStatus[] = [
  "available",
  ...NON_AVAILABLE_STATUSES,
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

const nonAvailableStatusArb = fc.constantFrom<NumberStatus>(...NON_AVAILABLE_STATUSES);

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** A phone number record with any status */
interface PhoneNumberRecord {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: NumberStatus;
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
}

// ─── Assignment guard logic (mirrors mutations.ts assignNumberToBranch) ─────

/**
 * Simulates the assignment guard from the mutations module.
 * Returns { accepted: true } if the number can be assigned,
 * or { accepted: false, reason: string } if rejected.
 */
function tryAssignment(
  record: PhoneNumberRecord,
  branchId: string
): { accepted: true } | { accepted: false; reason: string } {
  // Req 3.7, 4.7 — only "available" numbers can be assigned
  if (record.status !== "available") {
    return {
      accepted: false,
      reason: `Cannot assign number ${record.numberId}: status is "${record.status}", expected "available"`,
    };
  }
  return { accepted: true };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a phone number record with a specific status */
function phoneNumberRecordArb(statusArb: fc.Arbitrary<NumberStatus>): fc.Arbitrary<PhoneNumberRecord> {
  return fc
    .tuple(numberIdArb, e164Arb, providerArb, statusArb, capabilitiesArb, regionArb, countryCodeArb, timestampArb)
    .map(([numberId, phoneNumber, provider, status, capabilities, region, countryCode, createdAt]) => ({
      numberId,
      phoneNumber,
      provider,
      status,
      capabilities,
      region,
      countryCode,
      createdAt,
    }));
}

const nonAvailableRecordArb = phoneNumberRecordArb(nonAvailableStatusArb);
const availableRecordArb = phoneNumberRecordArb(fc.constant<NumberStatus>("available"));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 9: Only available numbers can be assigned", () => {
  it("rejects assignment for numbers with non-available statuses", () => {
    fc.assert(
      fc.property(nonAvailableRecordArb, branchIdArb, (record, branchId) => {
        const result = tryAssignment(record, branchId);
        expect(result.accepted).toBe(false);
        if (!result.accepted) {
          expect(result.reason).toContain(record.status);
          expect(result.reason).toContain("expected \"available\"");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects assignment for 'assigned' status (prevents double-assignment)", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constant<NumberStatus>("assigned")),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          expect(result.accepted).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects assignment for 'quarantined' status (prevents quarantine bypass)", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constant<NumberStatus>("quarantined")),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          expect(result.accepted).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects assignment for 'releasing' status", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constant<NumberStatus>("releasing")),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          expect(result.accepted).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects assignment for 'released' status", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constant<NumberStatus>("released")),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          expect(result.accepted).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects assignment for 'failed' status", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constant<NumberStatus>("failed")),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          expect(result.accepted).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts assignment for 'available' status", () => {
    fc.assert(
      fc.property(availableRecordArb, branchIdArb, (record, branchId) => {
        const result = tryAssignment(record, branchId);
        expect(result.accepted).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("available is the ONLY status that is accepted across all statuses", () => {
    fc.assert(
      fc.property(
        phoneNumberRecordArb(fc.constantFrom<NumberStatus>(...ALL_STATUSES)),
        branchIdArb,
        (record, branchId) => {
          const result = tryAssignment(record, branchId);
          if (record.status === "available") {
            expect(result.accepted).toBe(true);
          } else {
            expect(result.accepted).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
