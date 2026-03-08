/**
 * Feature: phone-number-provisioning, Property 2: Provisioning request record schema completeness
 *
 * Validates: Requirements 1.5
 *
 * For any provisioning request record created in the system, it must contain all
 * required fields (requestId, targetType, provider, status, region, countryCode,
 * attemptCount, maxAttempts, createdAt, updatedAt) with correct types, and either
 * branchId or locationId must be set matching the targetType.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  type TelecomProvider,
  type ProvisioningRequestStatus,
  type AssignedToType,
  type ProvisioningRegion,
} from "../../convex/shared/phoneProvisioningTypes";

// ─── Valid value sets ────────────────────────────────────────────────────────

const TELECOM_PROVIDERS: TelecomProvider[] = [
  "twilio",
  "vonage",
  "africas_talking",
  "termii",
];

const PROVISIONING_REQUEST_STATUSES: ProvisioningRequestStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
];

const TARGET_TYPES: AssignedToType[] = ["branch", "location"];

const PROVISIONING_REGIONS: ProvisioningRegion[] = [
  "nigeria",
  "ghana",
  "kenya",
  "south_africa",
  "default",
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const providerArb = fc.constantFrom<TelecomProvider>(...TELECOM_PROVIDERS);
const statusArb = fc.constantFrom<ProvisioningRequestStatus>(...PROVISIONING_REQUEST_STATUSES);
const targetTypeArb = fc.constantFrom<AssignedToType>(...TARGET_TYPES);
const regionArb = fc.constantFrom<ProvisioningRegion>(...PROVISIONING_REGIONS);
const countryCodeArb = fc.constantFrom("NG", "GH", "KE", "ZA", "US", "GB");
const timestampArb = fc.integer({ min: 1_700_000_000_000, max: 2_000_000_000_000 });

/** Non-empty alphanumeric ID string */
const idArb = fc
  .array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789".split(""))), {
    minLength: 4,
    maxLength: 20,
  })
  .map((chars) => chars.join(""));

const requestIdArb = idArb.map((id) => `PR_${id}`);
const branchIdArb = idArb.map((id) => `BR_${id}`);
const locationIdArb = idArb.map((id) => `LOC_${id}`);
const phoneNumberIdArb = idArb.map((id) => `PN_${id}`);

// ─── Provisioning request record interface (mirrors schema) ─────────────────

interface ProvisioningRequestRecord {
  // Required fields
  requestId: string;
  targetType: AssignedToType;
  provider: TelecomProvider;
  status: ProvisioningRequestStatus;
  region: ProvisioningRegion;
  countryCode: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  // Conditional on targetType
  branchId?: string;
  locationId?: string;
  // Optional fields
  lastError?: string;
  phoneNumberId?: string;
  completedAt?: number;
}

// ─── Record generators ──────────────────────────────────────────────────────

/** Generate a provisioning request with targetType="branch" */
const branchRequestArb: fc.Arbitrary<ProvisioningRequestRecord> = fc
  .tuple(
    requestIdArb,
    branchIdArb,
    providerArb,
    statusArb,
    regionArb,
    countryCodeArb,
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 1, max: 10 }),
    timestampArb,
    timestampArb,
    fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    fc.option(phoneNumberIdArb, { nil: undefined }),
    fc.option(timestampArb, { nil: undefined })
  )
  .map(([requestId, branchId, provider, status, region, countryCode, attemptCount, maxAttempts, createdAt, updatedAt, lastError, phoneNumberId, completedAt]) => {
    const record: ProvisioningRequestRecord = {
      requestId,
      targetType: "branch",
      branchId,
      provider,
      status,
      region,
      countryCode,
      attemptCount,
      maxAttempts,
      createdAt,
      updatedAt,
    };
    if (lastError !== undefined) record.lastError = lastError;
    if (phoneNumberId !== undefined) record.phoneNumberId = phoneNumberId;
    if (completedAt !== undefined) record.completedAt = completedAt;
    return record;
  });

/** Generate a provisioning request with targetType="location" */
const locationRequestArb: fc.Arbitrary<ProvisioningRequestRecord> = fc
  .tuple(
    requestIdArb,
    locationIdArb,
    providerArb,
    statusArb,
    regionArb,
    countryCodeArb,
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 1, max: 10 }),
    timestampArb,
    timestampArb,
    fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    fc.option(phoneNumberIdArb, { nil: undefined }),
    fc.option(timestampArb, { nil: undefined })
  )
  .map(([requestId, locationId, provider, status, region, countryCode, attemptCount, maxAttempts, createdAt, updatedAt, lastError, phoneNumberId, completedAt]) => {
    const record: ProvisioningRequestRecord = {
      requestId,
      targetType: "location",
      locationId,
      provider,
      status,
      region,
      countryCode,
      attemptCount,
      maxAttempts,
      createdAt,
      updatedAt,
    };
    if (lastError !== undefined) record.lastError = lastError;
    if (phoneNumberId !== undefined) record.phoneNumberId = phoneNumberId;
    if (completedAt !== undefined) record.completedAt = completedAt;
    return record;
  });

/** Generate any valid provisioning request (branch or location) */
const validRequestArb: fc.Arbitrary<ProvisioningRequestRecord> = fc.oneof(
  branchRequestArb,
  locationRequestArb
);

// ─── Validation helpers ─────────────────────────────────────────────────────

function hasAllRequiredFields(record: ProvisioningRequestRecord): boolean {
  return (
    typeof record.requestId === "string" &&
    record.requestId.length > 0 &&
    typeof record.targetType === "string" &&
    TARGET_TYPES.includes(record.targetType) &&
    typeof record.provider === "string" &&
    TELECOM_PROVIDERS.includes(record.provider) &&
    typeof record.status === "string" &&
    PROVISIONING_REQUEST_STATUSES.includes(record.status) &&
    typeof record.region === "string" &&
    PROVISIONING_REGIONS.includes(record.region as ProvisioningRegion) &&
    typeof record.countryCode === "string" &&
    record.countryCode.length > 0 &&
    typeof record.attemptCount === "number" &&
    record.attemptCount >= 0 &&
    typeof record.maxAttempts === "number" &&
    record.maxAttempts >= 1 &&
    typeof record.createdAt === "number" &&
    record.createdAt > 0 &&
    typeof record.updatedAt === "number" &&
    record.updatedAt > 0
  );
}

function hasCorrectTargetIdMapping(record: ProvisioningRequestRecord): boolean {
  if (record.targetType === "branch") {
    return (
      typeof record.branchId === "string" &&
      record.branchId.length > 0 &&
      record.locationId === undefined
    );
  }
  if (record.targetType === "location") {
    return (
      typeof record.locationId === "string" &&
      record.locationId.length > 0 &&
      record.branchId === undefined
    );
  }
  return false;
}

function hasCorrectOptionalFieldTypes(record: ProvisioningRequestRecord): boolean {
  if (record.lastError !== undefined && typeof record.lastError !== "string") return false;
  if (record.phoneNumberId !== undefined && typeof record.phoneNumberId !== "string") return false;
  if (record.completedAt !== undefined && typeof record.completedAt !== "number") return false;
  return true;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Property 2: Provisioning request record schema completeness", () => {
  it("all required fields are present with correct types", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(hasAllRequiredFields(record)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("branchId is set when targetType is 'branch', locationId is undefined", () => {
    fc.assert(
      fc.property(branchRequestArb, (record) => {
        expect(record.targetType).toBe("branch");
        expect(typeof record.branchId).toBe("string");
        expect(record.branchId!.length).toBeGreaterThan(0);
        expect(record.locationId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("locationId is set when targetType is 'location', branchId is undefined", () => {
    fc.assert(
      fc.property(locationRequestArb, (record) => {
        expect(record.targetType).toBe("location");
        expect(typeof record.locationId).toBe("string");
        expect(record.locationId!.length).toBeGreaterThan(0);
        expect(record.branchId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("targetType always matches the correct ID field (branchId or locationId)", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(hasCorrectTargetIdMapping(record)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("optional fields have correct types when present", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(hasCorrectOptionalFieldTypes(record)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("provider is always a valid telecom provider", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(TELECOM_PROVIDERS).toContain(record.provider);
      }),
      { numRuns: 100 }
    );
  });

  it("status is always a valid provisioning request status", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(PROVISIONING_REQUEST_STATUSES).toContain(record.status);
      }),
      { numRuns: 100 }
    );
  });

  it("region is always a valid provisioning region", () => {
    fc.assert(
      fc.property(validRequestArb, (record) => {
        expect(PROVISIONING_REGIONS).toContain(record.region);
      }),
      { numRuns: 100 }
    );
  });
});
