/**
 * Feature: phone-number-provisioning, Property 1: Phone number record schema completeness
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * For any phone number record created in the system, it must contain all required
 * fields (numberId, phoneNumber in E.164 format, provider, status, capabilities
 * array, region, countryCode, createdAt) with correct types, and optional fields
 * (assignedToType, assignedToId, assignedAt, releasedAt, quarantineExpiresAt,
 * providerNumberSid, monthlyCost, currency, lastHealthCheckAt, healthStatus)
 * must be accepted when provided.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type NumberStatus,
  type HealthStatus,
  type NumberCapability,
  type AssignedToType,
  type TelecomProvider,
  type ProvisioningRegion,
  isValidE164,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets (mirroring the type definitions) ───────────────────────

const NUMBER_STATUSES: NumberStatus[] = [
  "available",
  "assigned",
  "releasing",
  "released",
  "quarantined",
  "failed",
];

const HEALTH_STATUSES: HealthStatus[] = ["healthy", "degraded", "unreachable"];

const NUMBER_CAPABILITIES: NumberCapability[] = ["voice", "sms", "mms", "fax"];

const ASSIGNED_TO_TYPES: AssignedToType[] = ["branch", "location"];

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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid E.164 phone number: + followed by [1-9] then 1-14 more digits */
const digitArb = fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");
const e164Arb = fc
  .tuple(
    fc.constantFrom("1", "2", "3", "4", "5", "6", "7", "8", "9"),
    fc.array(digitArb, { minLength: 1, maxLength: 14 })
  )
  .map(([first, rest]) => `+${first}${rest.join("")}`);

const numberStatusArb = fc.constantFrom<NumberStatus>(...NUMBER_STATUSES);
const healthStatusArb = fc.constantFrom<HealthStatus>(...HEALTH_STATUSES);
const capabilityArb = fc.constantFrom<NumberCapability>(...NUMBER_CAPABILITIES);
const assignedToTypeArb = fc.constantFrom<AssignedToType>(...ASSIGNED_TO_TYPES);
const providerArb = fc.constantFrom<TelecomProvider>(...TELECOM_PROVIDERS);
const regionArb = fc.constantFrom<ProvisioningRegion>(...PROVISIONING_REGIONS);

/** Country codes matching regions */
const countryCodeArb = fc.constantFrom("NG", "GH", "KE", "ZA", "US", "GB");

/** Non-empty alphanumeric ID string */
const idArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => `PN_${chars.join("")}`);

/** Non-empty capabilities array with at least one element */
const capabilitiesArb = fc
  .uniqueArray(capabilityArb, { minLength: 1, maxLength: 4 })
  .filter((arr) => arr.length >= 1);

/** Timestamp arbitrary (reasonable range) */
const timestampArb = fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 });

// ─── Phone number record interface (mirrors schema) ─────────────────────────

interface PhoneNumberRecord {
  // Required fields (Req 1.1)
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: NumberStatus;
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  // Optional assignment fields (Req 1.2)
  assignedToType?: AssignedToType;
  assignedToId?: string;
  assignedAt?: number;
  releasedAt?: number;
  // Optional lifecycle fields (Req 1.3)
  quarantineExpiresAt?: number;
  providerNumberSid?: string;
  monthlyCost?: number;
  currency?: string;
  lastHealthCheckAt?: number;
  healthStatus?: HealthStatus;
}

// ─── Record generators ──────────────────────────────────────────────────────

/** Generate a phone number record with only required fields */
const requiredOnlyRecordArb: fc.Arbitrary<PhoneNumberRecord> = fc
  .tuple(idArb, e164Arb, providerArb, numberStatusArb, capabilitiesArb, regionArb, countryCodeArb, timestampArb)
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

/** Generate optional assignment fields */
const optionalAssignmentArb = fc.record({
  assignedToType: fc.option(assignedToTypeArb, { nil: undefined }),
  assignedToId: fc.option(idArb, { nil: undefined }),
  assignedAt: fc.option(timestampArb, { nil: undefined }),
  releasedAt: fc.option(timestampArb, { nil: undefined }),
});

/** Generate optional lifecycle fields */
const optionalLifecycleArb = fc.record({
  quarantineExpiresAt: fc.option(timestampArb, { nil: undefined }),
  providerNumberSid: fc.option(
    fc.array(fc.constantFrom(...("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""))), {
      minLength: 10,
      maxLength: 34,
    }).map((chars) => chars.join("")),
    { nil: undefined }
  ),
  monthlyCost: fc.option(fc.double({ min: 0.01, max: 100, noNaN: true }), { nil: undefined }),
  currency: fc.option(fc.constantFrom("USD", "NGN", "GHS", "KES", "ZAR", "GBP", "EUR"), { nil: undefined }),
  lastHealthCheckAt: fc.option(timestampArb, { nil: undefined }),
  healthStatus: fc.option(healthStatusArb, { nil: undefined }),
});

/** Generate a full phone number record with required + optional fields */
const fullRecordArb: fc.Arbitrary<PhoneNumberRecord> = fc
  .tuple(requiredOnlyRecordArb, optionalAssignmentArb, optionalLifecycleArb)
  .map(([required, assignment, lifecycle]) => {
    const record: PhoneNumberRecord = { ...required };
    // Only add optional fields that are defined
    if (assignment.assignedToType !== undefined) record.assignedToType = assignment.assignedToType;
    if (assignment.assignedToId !== undefined) record.assignedToId = assignment.assignedToId;
    if (assignment.assignedAt !== undefined) record.assignedAt = assignment.assignedAt;
    if (assignment.releasedAt !== undefined) record.releasedAt = assignment.releasedAt;
    if (lifecycle.quarantineExpiresAt !== undefined) record.quarantineExpiresAt = lifecycle.quarantineExpiresAt;
    if (lifecycle.providerNumberSid !== undefined) record.providerNumberSid = lifecycle.providerNumberSid;
    if (lifecycle.monthlyCost !== undefined) record.monthlyCost = lifecycle.monthlyCost;
    if (lifecycle.currency !== undefined) record.currency = lifecycle.currency;
    if (lifecycle.lastHealthCheckAt !== undefined) record.lastHealthCheckAt = lifecycle.lastHealthCheckAt;
    if (lifecycle.healthStatus !== undefined) record.healthStatus = lifecycle.healthStatus;
    return record;
  });

// ─── Validation helpers ─────────────────────────────────────────────────────

function hasCorrectRequiredFieldTypes(record: PhoneNumberRecord): boolean {
  return (
    typeof record.numberId === "string" &&
    record.numberId.length > 0 &&
    typeof record.phoneNumber === "string" &&
    isValidE164(record.phoneNumber) &&
    typeof record.provider === "string" &&
    TELECOM_PROVIDERS.includes(record.provider) &&
    typeof record.status === "string" &&
    NUMBER_STATUSES.includes(record.status) &&
    Array.isArray(record.capabilities) &&
    record.capabilities.length >= 1 &&
    record.capabilities.every((c) => NUMBER_CAPABILITIES.includes(c)) &&
    typeof record.region === "string" &&
    PROVISIONING_REGIONS.includes(record.region as ProvisioningRegion) &&
    typeof record.countryCode === "string" &&
    record.countryCode.length > 0 &&
    typeof record.createdAt === "number" &&
    record.createdAt > 0
  );
}

function hasCorrectOptionalFieldTypes(record: PhoneNumberRecord): boolean {
  if (record.assignedToType !== undefined && !ASSIGNED_TO_TYPES.includes(record.assignedToType)) return false;
  if (record.assignedToId !== undefined && typeof record.assignedToId !== "string") return false;
  if (record.assignedAt !== undefined && typeof record.assignedAt !== "number") return false;
  if (record.releasedAt !== undefined && typeof record.releasedAt !== "number") return false;
  if (record.quarantineExpiresAt !== undefined && typeof record.quarantineExpiresAt !== "number") return false;
  if (record.providerNumberSid !== undefined && typeof record.providerNumberSid !== "string") return false;
  if (record.monthlyCost !== undefined && typeof record.monthlyCost !== "number") return false;
  if (record.currency !== undefined && typeof record.currency !== "string") return false;
  if (record.lastHealthCheckAt !== undefined && typeof record.lastHealthCheckAt !== "number") return false;
  if (record.healthStatus !== undefined && !HEALTH_STATUSES.includes(record.healthStatus)) return false;
  return true;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 1: Phone number record schema completeness", () => {
  it("generated E.164 phone numbers pass validation", () => {
    fc.assert(
      fc.property(e164Arb, (phoneNumber) => {
        expect(isValidE164(phoneNumber)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("required-only records have all required fields with correct types", () => {
    fc.assert(
      fc.property(requiredOnlyRecordArb, (record) => {
        expect(hasCorrectRequiredFieldTypes(record)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("full records with optional fields have correct types for all fields", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        expect(hasCorrectRequiredFieldTypes(record)).toBe(true);
        expect(hasCorrectOptionalFieldTypes(record)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("capabilities array always contains at least one valid capability", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        expect(record.capabilities.length).toBeGreaterThanOrEqual(1);
        for (const cap of record.capabilities) {
          expect(NUMBER_CAPABILITIES).toContain(cap);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("provider is always a valid telecom provider", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        expect(TELECOM_PROVIDERS).toContain(record.provider);
      }),
      { numRuns: 100 }
    );
  });

  it("status is always a valid number status", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        expect(NUMBER_STATUSES).toContain(record.status);
      }),
      { numRuns: 100 }
    );
  });

  it("optional healthStatus when present is a valid health status", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        if (record.healthStatus !== undefined) {
          expect(HEALTH_STATUSES).toContain(record.healthStatus);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("optional assignedToType when present is a valid assignment type", () => {
    fc.assert(
      fc.property(fullRecordArb, (record) => {
        if (record.assignedToType !== undefined) {
          expect(ASSIGNED_TO_TYPES).toContain(record.assignedToType);
        }
      }),
      { numRuns: 100 }
    );
  });
});
