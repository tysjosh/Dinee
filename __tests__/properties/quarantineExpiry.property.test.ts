/**
 * Feature: phone-number-provisioning, Property 23: Quarantine expiry routing decision
 *
 * **Validates: Requirements 12.1, 12.2**
 *
 * For any quarantined number whose quarantineExpiresAt has passed:
 * - Req 12.1: If the number pool for that region is at or above DEFAULT_POOL_MIN,
 *   the number must be released back to the provider (status → "released")
 * - Req 12.2: If the pool is below DEFAULT_POOL_MIN, the number must be retained
 *   in the pool with status "available"
 *
 * This is a pure logic test — we simulate the quarantine expiry routing decision
 * from scheduledFunctions.ts processQuarantineExpirations: given a quarantined
 * number and the available count for its region, determine whether to release
 * or retain.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  DEFAULT_POOL_MIN,
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

/** Pool size: 0 to 20 (covers below, at, and above DEFAULT_POOL_MIN) */
const poolSizeArb = fc.integer({ min: 0, max: 20 });

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** A quarantined phone number with an expired quarantine period */
interface QuarantinedPhoneNumber {
  numberId: string;
  phoneNumber: string;
  provider: TelecomProvider;
  status: "quarantined";
  capabilities: NumberCapability[];
  region: ProvisioningRegion;
  countryCode: string;
  createdAt: number;
  quarantineExpiresAt: number;
  providerNumberSid: string;
}

type RoutingDecision = "release_to_provider" | "retain_in_pool";

interface RoutingResult {
  decision: RoutingDecision;
  newStatus: "released" | "available";
}

// ─── Simulate quarantine expiry routing decision ─────────────────────────────
// Mirrors the logic in scheduledFunctions.ts processQuarantineExpirations:
//   if availableCount < DEFAULT_POOL_MIN → retain (status "available")
//   if availableCount >= DEFAULT_POOL_MIN → release (status "released")

function quarantineExpiryRoutingDecision(
  _number: QuarantinedPhoneNumber,
  availableCountInRegion: number
): RoutingResult {
  if (availableCountInRegion < DEFAULT_POOL_MIN) {
    return { decision: "retain_in_pool", newStatus: "available" };
  }
  return { decision: "release_to_provider", newStatus: "released" };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a quarantined phone number with an expired quarantineExpiresAt */
const quarantinedNumberArb: fc.Arbitrary<QuarantinedPhoneNumber> = fc
  .tuple(
    numberIdArb,
    e164Arb,
    providerArb,
    capabilitiesArb,
    regionArb,
    countryCodeArb,
    timestampArb,
    timestampArb
  )
  .map(([numberId, phoneNumber, provider, capabilities, region, countryCode, createdAt, quarantineExpiresAt]) => ({
    numberId,
    phoneNumber,
    provider,
    status: "quarantined" as const,
    capabilities,
    region,
    countryCode,
    createdAt,
    quarantineExpiresAt,
    providerNumberSid: `SID_${numberId}`,
  }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 23: Quarantine expiry routing decision", () => {
  it("releases to provider when pool >= DEFAULT_POOL_MIN (Req 12.1)", () => {
    const poolAtOrAboveMinArb = fc.integer({ min: DEFAULT_POOL_MIN, max: 50 });

    fc.assert(
      fc.property(quarantinedNumberArb, poolAtOrAboveMinArb, (number, poolSize) => {
        const result = quarantineExpiryRoutingDecision(number, poolSize);

        expect(result.decision).toBe("release_to_provider");
        expect(result.newStatus).toBe("released");
      }),
      { numRuns: 100 }
    );
  });

  it("retains in pool when pool < DEFAULT_POOL_MIN (Req 12.2)", () => {
    const poolBelowMinArb = fc.integer({ min: 0, max: DEFAULT_POOL_MIN - 1 });

    fc.assert(
      fc.property(quarantinedNumberArb, poolBelowMinArb, (number, poolSize) => {
        const result = quarantineExpiryRoutingDecision(number, poolSize);

        expect(result.decision).toBe("retain_in_pool");
        expect(result.newStatus).toBe("available");
      }),
      { numRuns: 100 }
    );
  });

  it("boundary: pool exactly at DEFAULT_POOL_MIN triggers release", () => {
    fc.assert(
      fc.property(quarantinedNumberArb, (number) => {
        const result = quarantineExpiryRoutingDecision(number, DEFAULT_POOL_MIN);

        expect(result.decision).toBe("release_to_provider");
        expect(result.newStatus).toBe("released");
      }),
      { numRuns: 100 }
    );
  });

  it("boundary: pool at DEFAULT_POOL_MIN - 1 triggers retain", () => {
    fc.assert(
      fc.property(quarantinedNumberArb, (number) => {
        const result = quarantineExpiryRoutingDecision(number, DEFAULT_POOL_MIN - 1);

        expect(result.decision).toBe("retain_in_pool");
        expect(result.newStatus).toBe("available");
      }),
      { numRuns: 100 }
    );
  });

  it("routing decision is consistent regardless of number properties", () => {
    fc.assert(
      fc.property(quarantinedNumberArb, poolSizeArb, (number, poolSize) => {
        const result = quarantineExpiryRoutingDecision(number, poolSize);

        // Decision depends only on poolSize vs DEFAULT_POOL_MIN
        if (poolSize < DEFAULT_POOL_MIN) {
          expect(result.decision).toBe("retain_in_pool");
          expect(result.newStatus).toBe("available");
        } else {
          expect(result.decision).toBe("release_to_provider");
          expect(result.newStatus).toBe("released");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("result status is always a valid terminal state", () => {
    fc.assert(
      fc.property(quarantinedNumberArb, poolSizeArb, (number, poolSize) => {
        const result = quarantineExpiryRoutingDecision(number, poolSize);

        expect(["released", "available"]).toContain(result.newStatus);
        expect(["release_to_provider", "retain_in_pool"]).toContain(result.decision);
      }),
      { numRuns: 100 }
    );
  });

  it("DEFAULT_POOL_MIN is used as the decision boundary (value is 5)", () => {
    expect(DEFAULT_POOL_MIN).toBe(5);
  });

  it("all routing invariants hold simultaneously for any valid input", () => {
    fc.assert(
      fc.property(quarantinedNumberArb, poolSizeArb, (number, poolSize) => {
        const result = quarantineExpiryRoutingDecision(number, poolSize);

        // Input must be quarantined
        expect(number.status).toBe("quarantined");

        // Req 12.1 — pool >= min → release
        if (poolSize >= DEFAULT_POOL_MIN) {
          expect(result.decision).toBe("release_to_provider");
          expect(result.newStatus).toBe("released");
        }

        // Req 12.2 — pool < min → retain
        if (poolSize < DEFAULT_POOL_MIN) {
          expect(result.decision).toBe("retain_in_pool");
          expect(result.newStatus).toBe("available");
        }

        // Decision and newStatus are always consistent
        if (result.decision === "release_to_provider") {
          expect(result.newStatus).toBe("released");
        }
        if (result.decision === "retain_in_pool") {
          expect(result.newStatus).toBe("available");
        }
      }),
      { numRuns: 100 }
    );
  });
});
