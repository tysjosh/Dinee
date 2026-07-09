// Feature: dinee-campus, Property 2: Required-field validation matches the constraint conjunction
/**
 * Feature: dinee-campus, Property 2: Required-field validation matches the
 * constraint conjunction
 *
 * Validates: Requirements 2.3, 2.5, 4.7
 *
 * Req 2.3 defines the required Campus_Agent field set and each field's
 * constraint (name 1..50, Agent_Type ∈ the seven types, campus 1..100, a
 * selected voice, a selected tone, ≥1 Knowledge_Source, Visibility
 * public|private, description 1..280, creator display name 1..50). Req 2.5 (and
 * 4.7 for the name) requires that completion is blocked and EACH empty/invalid
 * required field is identified.
 *
 * The property under test: `validateRequiredFields` returns EXACTLY the set of
 * fields whose individual constraint predicate is violated — i.e. the failing
 * set equals the conjunction of the per-field constraints, field-for-field. In
 * particular a field appears in the result if and only if its own constraint
 * fails, so the result is empty precisely when every constraint holds.
 *
 * The oracle below re-derives each constraint independently (not via the
 * module under test) and asserts the two sets match, in the validator's
 * declaration order.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateRequiredFields,
  AGENT_TYPES,
  VISIBILITY_VALUES,
  NAME_MIN,
  NAME_MAX,
  CAMPUS_MIN,
  CAMPUS_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_MAX,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_MAX,
  type RequiredFieldInput,
  type RequiredFieldName,
} from "../../../convex/campus/logic/validation";

// --- Value arbitraries -------------------------------------------------------
//
// Each field arbitrary spans BOTH sides of its constraint boundary and also
// non-string / wrong-type values, so the generated input independently lands
// in the valid or invalid region for every field. Strings are built from a
// repeated ASCII unit so `.length` (UTF-16 code units, what the validator
// checks) is exactly the chosen length — giving precise boundary coverage.

/** A string whose `.length` is exactly `len`. */
const stringOfLength = (len: number): string => "a".repeat(len);

/** A length-bounded string, sampled across [0, upper] to straddle boundaries. */
const sizedStringArb = (upper: number): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: upper }).map(stringOfLength);

/** Values that are not usable strings, to exercise the type guards. */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.boolean()
);

// name: string 1..50 → generate lengths a bit past the max, plus non-strings.
const nameArb = fc.oneof(sizedStringArb(NAME_MAX + 10), nonStringArb);

// agentType: one of the seven, an arbitrary (likely invalid) string, or non-string.
const agentTypeArb = fc.oneof(
  fc.constantFrom(...AGENT_TYPES),
  fc.string({ maxLength: 20 }),
  nonStringArb
);

// campus: string 1..100.
const campusArb = fc.oneof(sizedStringArb(CAMPUS_MAX + 10), nonStringArb);

// voice / tone: any non-empty string is a valid selection.
const selectionArb = fc.oneof(sizedStringArb(6), nonStringArb);

// knowledgeSourceCount: number ≥ 1 is valid; include 0, negatives, fractions, non-numbers.
const knowledgeCountArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -3, max: 5 }),
  fc.double({ min: -1, max: 3, noNaN: true }),
  fc.constant(null),
  fc.constant(undefined),
  fc.string({ maxLength: 3 })
);

// visibility: public | private, plus other strings and non-strings.
const visibilityArb = fc.oneof(
  fc.constantFrom(...VISIBILITY_VALUES),
  fc.string({ maxLength: 10 }),
  nonStringArb
);

// description: string 1..280.
const descriptionArb = fc.oneof(
  sizedStringArb(DESCRIPTION_MAX + 20),
  nonStringArb
);

// displayName: string 1..50.
const displayNameArb = fc.oneof(sizedStringArb(DISPLAY_NAME_MAX + 10), nonStringArb);

const inputArb: fc.Arbitrary<RequiredFieldInput> = fc.record({
  name: nameArb,
  agentType: agentTypeArb,
  campus: campusArb,
  voice: selectionArb,
  tone: selectionArb,
  knowledgeSourceCount: knowledgeCountArb,
  visibility: visibilityArb,
  description: descriptionArb,
  displayName: displayNameArb,
}) as fc.Arbitrary<RequiredFieldInput>;

// --- Independent oracle ------------------------------------------------------

const stringInRange = (v: unknown, min: number, max: number): boolean =>
  typeof v === "string" && v.length >= min && v.length <= max;

/** Re-derives the expected failing-field set in the validator's declaration order. */
function expectedFailing(input: RequiredFieldInput): RequiredFieldName[] {
  const failing: RequiredFieldName[] = [];
  if (!stringInRange(input.name, NAME_MIN, NAME_MAX)) failing.push("name");
  if (
    !(
      typeof input.agentType === "string" &&
      (AGENT_TYPES as readonly string[]).includes(input.agentType)
    )
  )
    failing.push("agentType");
  if (!stringInRange(input.campus, CAMPUS_MIN, CAMPUS_MAX)) failing.push("campus");
  if (!(typeof input.voice === "string" && input.voice.length > 0))
    failing.push("voice");
  if (!(typeof input.tone === "string" && input.tone.length > 0))
    failing.push("tone");
  if (
    !(
      typeof input.knowledgeSourceCount === "number" &&
      input.knowledgeSourceCount >= 1
    )
  )
    failing.push("knowledgeSources");
  if (
    !(
      typeof input.visibility === "string" &&
      (VISIBILITY_VALUES as readonly string[]).includes(input.visibility)
    )
  )
    failing.push("visibility");
  if (!stringInRange(input.description, DESCRIPTION_MIN, DESCRIPTION_MAX))
    failing.push("description");
  if (!stringInRange(input.displayName, DISPLAY_NAME_MIN, DISPLAY_NAME_MAX))
    failing.push("displayName");
  return failing;
}

describe("Property 2: Required-field validation matches the constraint conjunction", () => {
  it("returns exactly the fields whose individual constraint is violated", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(validateRequiredFields(input)).toEqual(expectedFailing(input));
      }),
      { numRuns: 100 }
    );
  });

  it("returns an empty set iff every constraint holds (all-valid ⇔ [])", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = validateRequiredFields(input);
        expect(result.length === 0).toBe(expectedFailing(input).length === 0);
      }),
      { numRuns: 100 }
    );
  });

  it("passes a fully-valid field set and identifies every field when all are invalid (examples)", () => {
    const valid: RequiredFieldInput = {
      name: "Ada",
      agentType: "study_agent",
      campus: "State University",
      voice: "voice_1",
      tone: "friendly",
      knowledgeSourceCount: 1,
      visibility: "public",
      description: "Helps with CS101.",
      displayName: "Ada L.",
    };
    expect(validateRequiredFields(valid)).toEqual([]);

    const allInvalid: RequiredFieldInput = {
      name: "",
      agentType: "not_a_type",
      campus: "",
      voice: "",
      tone: "",
      knowledgeSourceCount: 0,
      visibility: "everyone",
      description: "",
      displayName: "",
    };
    expect(validateRequiredFields(allInvalid)).toEqual([
      "name",
      "agentType",
      "campus",
      "voice",
      "tone",
      "knowledgeSources",
      "visibility",
      "description",
      "displayName",
    ]);
  });
});
