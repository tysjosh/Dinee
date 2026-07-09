/**
 * Feature: dinee-campus, Property: Schema additivity is backward compatible
 *
 * Validates: Requirements 4.2, 8.8, 12.5
 *
 * The dinee-campus schema work extends three existing tables additively (all new
 * fields optional) so that no pre-existing row is invalidated:
 *   - users.role       gains the "student_creator" literal (Req 4.2)
 *   - users            gains campusDisplayName / campusHandle / creatorPageVisibility
 *   - calls            gains campusAgentId (Req 8.8) and recordingEnabled (Req 12.5)
 *   - phoneNumbers.assignedToType gains the "campus_agent" literal (Req 4.2 reuse)
 *
 * This test validates arbitrary "legacy" rows — rows that carry ONLY the pre-Campus
 * fields — against the ACTUAL Convex validators exported from convex/schema.ts, and
 * asserts:
 *   1. Every legacy users / calls / phoneNumbers row (no new optional Campus fields)
 *      still validates. If any Campus field had been added as required, these rows
 *      would fail — so this guards the "additive" property directly.
 *   2. Every pre-existing users.role value AND every pre-existing
 *      phoneNumbers.assignedToType value still validates (the new literals did not
 *      displace the old ones), and the new "student_creator" / "campus_agent"
 *      literals validate too.
 *
 * The test walks the real validator AST (schema.tables.<t>.validator) rather than a
 * hand-copied mirror, so a future non-additive change (e.g. making a Campus field
 * required) breaks this test.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import schema from "../../../convex/schema";

// ─── Minimal Convex validator walker ────────────────────────────────────────
// Mirrors Convex object-validation semantics: exact field set (no unknown keys),
// required fields must be present, optional fields may be absent/undefined.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Validator = any;

function validate(validator: Validator, value: unknown): boolean {
  switch (validator.kind) {
    case "any":
      return true;
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "float64":
      return typeof value === "number";
    case "int64":
      return typeof value === "bigint";
    case "boolean":
      return typeof value === "boolean";
    case "bytes":
      return value instanceof ArrayBuffer;
    case "id":
      return typeof value === "string";
    case "literal":
      return value === validator.value;
    case "union":
      return (validator.members as Validator[]).some((m) => validate(m, value));
    case "array":
      return (
        Array.isArray(value) &&
        value.every((el) => validate(validator.element, el))
      );
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const fields = validator.fields as Record<string, Validator>;
      // Reject unknown keys — Convex object validators are exact.
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!(key in fields)) return false;
      }
      for (const [key, fieldValidator] of Object.entries(fields)) {
        const has = key in (value as Record<string, unknown>);
        const inner = (value as Record<string, unknown>)[key];
        if (!has || inner === undefined) {
          if (fieldValidator.isOptional !== "optional") return false;
          continue;
        }
        if (!validate(fieldValidator, inner)) return false;
      }
      return true;
    }
    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      return Object.entries(value as Record<string, unknown>).every(
        ([k, val]) => validate(validator.key, k) && validate(validator.value, val)
      );
    }
    default:
      throw new Error(`Unhandled validator kind: ${validator.kind}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tables = (schema as any).tables;
const usersValidator = tables.users.validator;
const callsValidator = tables.calls.validator;
const phoneNumbersValidator = tables.phoneNumbers.validator;

// The Campus-added optional fields that a legacy (pre-Campus) row would NOT have.
const CAMPUS_USER_FIELDS = ["campusDisplayName", "campusHandle", "creatorPageVisibility"] as const;
const CAMPUS_CALL_FIELDS = ["campusAgentId", "recordingEnabled"] as const;

// Pre-existing role values (everything the union accepted before student_creator).
const PRE_CAMPUS_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
  "partner",
] as const;

// Pre-existing assignment targets (before "campus_agent" was added).
const PRE_CAMPUS_ASSIGNED_TYPES = ["branch", "location"] as const;

// ─── Arbitraries for LEGACY rows (no new Campus fields) ─────────────────────

const idArb = fc.string({ minLength: 1, maxLength: 40 });
const optNum = fc.option(fc.integer({ min: 0, max: 2_000_000_000 }), { nil: undefined });
const optStr = fc.option(fc.string({ maxLength: 40 }), { nil: undefined });

/** A users row as it existed before the Campus additions (never sets Campus fields). */
const legacyUserArb = fc.record(
  {
    name: optStr,
    email: optStr,
    phone: optStr,
    isAnonymous: fc.option(fc.boolean(), { nil: undefined }),
    userId: optStr,
    role: fc.option(fc.constantFrom(...PRE_CAMPUS_ROLES), { nil: undefined }),
    tenantType: fc.option(
      fc.constantFrom("platform", "restaurant", "business", "branch"),
      { nil: undefined }
    ),
    tenantId: optStr,
    lastLoginAt: optNum,
    createdAt: optNum,
  },
  { requiredKeys: [] }
);

const callStatusArb = fc.option(fc.constantFrom("active", "completed"), { nil: undefined });

/** A calls row as it existed before Campus (callId required; no campus fields). */
const legacyCallArb = fc.record(
  {
    callId: idArb, // required
    orderId: optStr,
    restaurantId: optStr,
    branchId: optStr,
    phoneNumber: optStr,
    callStartTime: optNum,
    callEndTime: optNum,
    duration: optNum,
    status: callStatusArb,
  },
  { requiredKeys: ["callId"] }
);

const capabilityArb = fc.constantFrom("voice", "sms", "mms", "fax");

/** A phoneNumbers row as it existed before Campus (assignedToType branch|location only). */
const legacyPhoneNumberArb = fc.record(
  {
    numberId: idArb,
    phoneNumber: idArb,
    provider: idArb,
    status: fc.constantFrom(
      "available",
      "assigned",
      "releasing",
      "released",
      "quarantined",
      "failed"
    ),
    capabilities: fc.array(capabilityArb, { maxLength: 4 }),
    region: idArb,
    countryCode: fc.string({ minLength: 1, maxLength: 4 }),
    createdAt: fc.integer({ min: 0, max: 2_000_000_000 }),
    assignedToType: fc.option(fc.constantFrom(...PRE_CAMPUS_ASSIGNED_TYPES), {
      nil: undefined,
    }),
    assignedToId: optStr,
  },
  {
    requiredKeys: [
      "numberId",
      "phoneNumber",
      "provider",
      "status",
      "capabilities",
      "region",
      "countryCode",
      "createdAt",
    ],
  }
);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("dinee-campus schema additivity — legacy rows still validate", () => {
  it("sanity: the three extended tables expose object validators", () => {
    expect(usersValidator.kind).toBe("object");
    expect(callsValidator.kind).toBe("object");
    expect(phoneNumbersValidator.kind).toBe("object");
  });

  it("legacy users rows (no Campus fields) still validate", () => {
    fc.assert(
      fc.property(legacyUserArb, (row) => {
        // Guard: the generated legacy row carries none of the Campus additions.
        for (const f of CAMPUS_USER_FIELDS) {
          expect(f in row).toBe(false);
        }
        expect(validate(usersValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("legacy calls rows (no campusAgentId / recordingEnabled) still validate", () => {
    fc.assert(
      fc.property(legacyCallArb, (row) => {
        for (const f of CAMPUS_CALL_FIELDS) {
          expect(f in row).toBe(false);
        }
        expect(validate(callsValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("legacy phoneNumbers rows (no campus_agent assignment) still validate", () => {
    fc.assert(
      fc.property(legacyPhoneNumberArb, (row) => {
        expect(validate(phoneNumbersValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe("dinee-campus schema additivity — new literals do not break existing values", () => {
  const roleValidator = usersValidator.fields.role;
  const assignedTypeValidator = phoneNumbersValidator.fields.assignedToType;

  it("every pre-existing users.role value still validates", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PRE_CAMPUS_ROLES), (role) => {
        expect(validate(roleValidator, role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("the new student_creator role validates alongside the existing roles", () => {
    expect(validate(roleValidator, "student_creator")).toBe(true);
    // A full legacy user row is unaffected when the new role is chosen instead.
    const rowWithNewRole = { userId: "u1", role: "student_creator" };
    expect(validate(usersValidator, rowWithNewRole)).toBe(true);
  });

  it("a value outside the role union is still rejected (union did not turn permissive)", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter(
            (s) =>
              !([...PRE_CAMPUS_ROLES, "student_creator"] as readonly string[]).includes(
                s
              )
          ),
        (badRole) => {
          expect(validate(roleValidator, badRole)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every pre-existing phoneNumbers.assignedToType value still validates", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PRE_CAMPUS_ASSIGNED_TYPES), (t) => {
        expect(validate(assignedTypeValidator, t)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("the new campus_agent assignment target validates", () => {
    expect(validate(assignedTypeValidator, "campus_agent")).toBe(true);
  });
});
