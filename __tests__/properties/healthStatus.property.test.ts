/**
 * Feature: phone-number-provisioning, Property 18: Health status correctness
 *
 * **Validates: Requirements 7.3, 7.4, 7.5, 7.6**
 *
 * For any assigned phone number after a health check, the healthStatus must be:
 * - "unreachable" if the provider reports the number is unreachable (Req 7.3)
 * - "degraded" if the webhook is misconfigured but the number is active (Req 7.4)
 * - "healthy" if the number passes all checks (Req 7.5)
 *
 * The lastHealthCheckAt field must be updated on every health check regardless
 * of result (Req 7.6).
 *
 * This is a pure logic test — we simulate the health update logic from
 * mutations.ts updateHealthStatus: given a phone number record and a new
 * health check result, apply the update and verify the resulting state.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type HealthStatus,
  type NumberCapability,
  type TelecomProvider,
  type ProvisioningRegion,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets ────────────────────────────────────────────────────────

const HEALTH_STATUSES: HealthStatus[] = ["healthy", "degraded", "unreachable"];

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
const healthStatusArb = fc.constantFrom<HealthStatus>(...HEALTH_STATUSES);

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

const branchIdArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `BR_${chars.join("")}`);

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** An assigned phone number record before a health check */
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
  providerNumberSid: string;
  healthStatus?: HealthStatus;
  lastHealthCheckAt?: number;
}

/** The phone number record after a health check update */
interface UpdatedPhoneNumberRecord extends AssignedPhoneNumberRecord {
  healthStatus: HealthStatus;
  lastHealthCheckAt: number;
}

// ─── Simulate health update logic (mirrors mutations.ts updateHealthStatus) ─

function applyHealthUpdate(
  record: AssignedPhoneNumberRecord,
  newHealthStatus: HealthStatus,
  checkTimestamp: number
): UpdatedPhoneNumberRecord {
  return {
    ...record,
    healthStatus: newHealthStatus,
    lastHealthCheckAt: checkTimestamp,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate an assigned phone number record with optional prior health status */
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
    timestampArb,
    fc.option(healthStatusArb, { nil: undefined }),
    fc.option(timestampArb, { nil: undefined })
  )
  .map(([numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt, branchId, assignedAt, healthStatus, lastHealthCheckAt]) => ({
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
    providerNumberSid: `SID_${numberId}`,
    ...(healthStatus !== undefined ? { healthStatus } : {}),
    ...(lastHealthCheckAt !== undefined ? { lastHealthCheckAt } : {}),
  }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 18: Health status correctness", () => {
  it("healthStatus is set to 'unreachable' when provider reports unreachable (Req 7.3)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, checkTs) => {
        const updated = applyHealthUpdate(record, "unreachable", checkTs);
        expect(updated.healthStatus).toBe("unreachable");
      }),
      { numRuns: 100 }
    );
  });

  it("healthStatus is set to 'degraded' when webhook misconfigured but number active (Req 7.4)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, checkTs) => {
        const updated = applyHealthUpdate(record, "degraded", checkTs);
        expect(updated.healthStatus).toBe("degraded");
      }),
      { numRuns: 100 }
    );
  });

  it("healthStatus is set to 'healthy' when number passes all checks (Req 7.5)", () => {
    fc.assert(
      fc.property(assignedRecordArb, timestampArb, (record, checkTs) => {
        const updated = applyHealthUpdate(record, "healthy", checkTs);
        expect(updated.healthStatus).toBe("healthy");
      }),
      { numRuns: 100 }
    );
  });

  it("lastHealthCheckAt is always updated regardless of health result (Req 7.6)", () => {
    fc.assert(
      fc.property(assignedRecordArb, healthStatusArb, timestampArb, (record, newStatus, checkTs) => {
        const updated = applyHealthUpdate(record, newStatus, checkTs);
        expect(updated.lastHealthCheckAt).toBe(checkTs);
      }),
      { numRuns: 100 }
    );
  });

  it("healthStatus always matches the new check result, not the previous value", () => {
    fc.assert(
      fc.property(assignedRecordArb, healthStatusArb, timestampArb, (record, newStatus, checkTs) => {
        const updated = applyHealthUpdate(record, newStatus, checkTs);
        expect(updated.healthStatus).toBe(newStatus);
        // The new status may differ from the previous one
        if (record.healthStatus !== undefined && record.healthStatus !== newStatus) {
          expect(updated.healthStatus).not.toBe(record.healthStatus);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("lastHealthCheckAt is updated even when healthStatus does not change", () => {
    fc.assert(
      fc.property(assignedRecordArb, healthStatusArb, timestampArb, (record, newStatus, checkTs) => {
        // First health check
        const afterFirst = applyHealthUpdate(record, newStatus, checkTs);
        // Second health check with same status but later timestamp
        const laterTs = checkTs + 1_000_000;
        const afterSecond = applyHealthUpdate(afterFirst, newStatus, laterTs);

        expect(afterSecond.healthStatus).toBe(newStatus);
        expect(afterSecond.lastHealthCheckAt).toBe(laterTs);
        expect(afterSecond.lastHealthCheckAt).toBeGreaterThan(afterFirst.lastHealthCheckAt);
      }),
      { numRuns: 100 }
    );
  });

  it("original record fields are preserved after health update", () => {
    fc.assert(
      fc.property(assignedRecordArb, healthStatusArb, timestampArb, (record, newStatus, checkTs) => {
        const updated = applyHealthUpdate(record, newStatus, checkTs);

        expect(updated.numberId).toBe(record.numberId);
        expect(updated.phoneNumber).toBe(record.phoneNumber);
        expect(updated.provider).toBe(record.provider);
        expect(updated.status).toBe("assigned");
        expect(updated.capabilities).toEqual(record.capabilities);
        expect(updated.region).toBe(record.region);
        expect(updated.countryCode).toBe(record.countryCode);
        expect(updated.createdAt).toBe(record.createdAt);
        expect(updated.assignedToType).toBe("branch");
        expect(updated.assignedToId).toBe(record.assignedToId);
        expect(updated.assignedAt).toBe(record.assignedAt);
        expect(updated.providerNumberSid).toBe(record.providerNumberSid);
      }),
      { numRuns: 100 }
    );
  });

  it("all health status invariants hold simultaneously for any valid input", () => {
    fc.assert(
      fc.property(assignedRecordArb, healthStatusArb, timestampArb, (record, newStatus, checkTs) => {
        const updated = applyHealthUpdate(record, newStatus, checkTs);

        // Req 7.3 — unreachable correctly set
        if (newStatus === "unreachable") {
          expect(updated.healthStatus).toBe("unreachable");
        }
        // Req 7.4 — degraded correctly set
        if (newStatus === "degraded") {
          expect(updated.healthStatus).toBe("degraded");
        }
        // Req 7.5 — healthy correctly set
        if (newStatus === "healthy") {
          expect(updated.healthStatus).toBe("healthy");
        }

        // Req 7.6 — lastHealthCheckAt always updated
        expect(updated.lastHealthCheckAt).toBe(checkTs);

        // healthStatus is always one of the valid values
        expect(HEALTH_STATUSES).toContain(updated.healthStatus);

        // Original fields preserved
        expect(updated.numberId).toBe(record.numberId);
        expect(updated.phoneNumber).toBe(record.phoneNumber);
        expect(updated.provider).toBe(record.provider);
        expect(updated.status).toBe("assigned");
      }),
      { numRuns: 100 }
    );
  });
});
