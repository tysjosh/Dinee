// Feature: dinee-campus, Property 26: Report validation and recording
/**
 * Feature: dinee-campus, Property 26: Report validation and recording
 *
 * Validates: Requirements 11.1, 11.2
 *
 * For any report submission, the Safety_Service SHALL accept it if and only if
 * it includes an agent identifier and a reason of length 1..1000; a rejected
 * report SHALL indicate the specific invalid field (missing identifier, missing
 * reason, or reason too long).
 *
 * The pure gate under test is {@link validateReport}. It returns the set of
 * invalid fields for a submitted report. An empty result models "accept and
 * record" (Req 11.1); a non-empty result models "reject and indicate the
 * specific invalid field(s)" (Req 11.2): `agentId` for a missing/empty reported
 * agent identifier and `reason` for a missing, empty, or over-length reason.
 * The property asserts the biconditional and the exactness of the reported
 * invalid-field set.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateReport,
  type ReportFieldName,
  REPORT_REASON_MIN,
  REPORT_REASON_MAX,
} from "../../../convex/campus/logic/validation";

/** Reference oracle: an agentId is valid iff it is a non-empty string. */
function isValidAgentId(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/** Reference oracle: a reason is valid iff it is a string of length 1..1000. */
function isValidReason(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= REPORT_REASON_MIN &&
    value.length <= REPORT_REASON_MAX
  );
}

/** Independently computes the exact expected set of failing fields. */
function expectedFailingFields(input: {
  agentId?: string | null;
  reason?: string | null;
}): ReportFieldName[] {
  const failing: ReportFieldName[] = [];
  if (!isValidAgentId(input.agentId)) failing.push("agentId");
  if (!isValidReason(input.reason)) failing.push("reason");
  return failing;
}

/**
 * Arbitrary agent identifiers spanning valid (non-empty strings) and invalid
 * (empty string, null, undefined) cases.
 */
const agentIdArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom("", null, undefined)
);

/**
 * Arbitrary reasons spanning the full space around the 1..1000 length bounds:
 * empty (too short), in-range, exactly-at-boundary lengths, over-length, and
 * the null/undefined "not provided" cases.
 */
const reasonArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  // In-range reasons, including the exact boundaries 1 and 1000.
  fc.string({ minLength: REPORT_REASON_MIN, maxLength: REPORT_REASON_MAX }),
  fc.constant("a"),
  fc.constant("a".repeat(REPORT_REASON_MAX)),
  // Over-length reasons (1001+ characters).
  fc.constant("a".repeat(REPORT_REASON_MAX + 1)),
  fc
    .string({ minLength: REPORT_REASON_MAX + 1, maxLength: REPORT_REASON_MAX + 50 }),
  // Missing / empty.
  fc.constantFrom("", null, undefined)
);

describe("Property 26: Report validation and recording", () => {
  it("accepts a report iff it has a non-empty agentId and a reason of length 1..1000", () => {
    fc.assert(
      fc.property(agentIdArb, reasonArb, (agentId, reason) => {
        const result = validateReport({ agentId, reason });
        const accepted = result.length === 0;
        expect(accepted).toBe(isValidAgentId(agentId) && isValidReason(reason));
      }),
      { numRuns: 100 }
    );
  });

  it("reports exactly the specific invalid field(s) on rejection", () => {
    fc.assert(
      fc.property(agentIdArb, reasonArb, (agentId, reason) => {
        const result = validateReport({ agentId, reason });
        expect(result).toEqual(expectedFailingFields({ agentId, reason }));
      }),
      { numRuns: 100 }
    );
  });

  it("accepts every well-formed report (non-empty id, reason within bounds)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: REPORT_REASON_MIN, maxLength: REPORT_REASON_MAX }),
        (agentId, reason) => {
          expect(validateReport({ agentId, reason })).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("flags reason as invalid when it exceeds 1000 characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: REPORT_REASON_MAX + 1, max: REPORT_REASON_MAX + 200 }),
        (agentId, length) => {
          const reason = "a".repeat(length);
          expect(validateReport({ agentId, reason })).toEqual(["reason"]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("flags agentId as invalid when the reported identifier is missing", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: REPORT_REASON_MIN, maxLength: REPORT_REASON_MAX }),
        (reason) => {
          expect(validateReport({ agentId: "", reason })).toEqual(["agentId"]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
