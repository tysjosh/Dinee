/**
 * Feature: dinee-campus (Task 3.1)
 *
 * Pure, property-testable field validators for Dinee Campus. These functions
 * carry NO Convex `ctx` and perform no I/O, so they can be exercised directly
 * by unit and property tests and imported by the Convex service functions that
 * enforce the same rules.
 *
 * Covered behaviors:
 *   - 2.3 / 2.5 / 4.7: the required-field set and its per-field constraints
 *     (name 1..50, type ∈ 7 types, campus 1..100, voice selected, tone
 *     selected, ≥1 knowledge source, visibility public|private, description
 *     1..280, display name 1..50). {@link validateRequiredFields} returns the
 *     EXACT set of failing fields so the caller can identify each empty/invalid
 *     required field (2.5).
 *   - 2.7: contact-email and monetization-link value validators that identify
 *     the specific invalid field.
 *   - 8.10 / 8.11: the call-rating validator (integer 1..5 inclusive).
 *   - 11.1 / 11.2: the report validator (agentId present + reason length
 *     1..1000), identifying the invalid field.
 *   - 10.1 / 10.2: the campus-tag publish gate (a non-empty Campus_Tag is
 *     required to publish).
 */

/** The seven Agent_Types a Campus_Agent can be classified as (Req 2.3). */
export const AGENT_TYPES = [
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/** The two Visibility values a Campus_Agent can be published with (Req 2.3). */
export const VISIBILITY_VALUES = ["public", "private"] as const;

export type Visibility = (typeof VISIBILITY_VALUES)[number];

// Field length bounds (inclusive), from Req 2.3, 4.7, 6.1, 11.1.
export const NAME_MIN = 1;
export const NAME_MAX = 50;
export const CAMPUS_MIN = 1;
export const CAMPUS_MAX = 100;
export const DESCRIPTION_MIN = 1;
export const DESCRIPTION_MAX = 280;
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 50;
export const REPORT_REASON_MIN = 1;
export const REPORT_REASON_MAX = 1000;
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * The identifiers for the required Campus_Agent fields (Req 2.3). A failing
 * field name in this set means that field is empty or violates its constraint
 * (Req 2.5).
 */
export type RequiredFieldName =
  | "name"
  | "agentType"
  | "campus"
  | "voice"
  | "tone"
  | "knowledgeSources"
  | "visibility"
  | "description"
  | "displayName";

/**
 * The candidate required-field values a Student_Creator supplies when
 * completing onboarding / creation. Every field is optional/loose here so the
 * validator can be handed partial, unvalidated input and report exactly which
 * fields fail (Req 2.5). `knowledgeSourceCount` models "at least one
 * Knowledge_Source" without pulling in the Knowledge_Store shape.
 */
export interface RequiredFieldInput {
  name?: string | null;
  agentType?: string | null;
  campus?: string | null;
  voice?: string | null;
  tone?: string | null;
  knowledgeSourceCount?: number | null;
  visibility?: string | null;
  description?: string | null;
  displayName?: string | null;
}

/** Returns true when a value is a string whose length is within [min, max]. */
function isStringInRange(
  value: unknown,
  min: number,
  max: number
): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

/**
 * Validates the required-field set, returning the EXACT set of failing field
 * names (Req 2.3, 2.5, 4.7). A field is failing when it is empty or violates
 * its constraint:
 *   - name: string 1..50
 *   - agentType: one of the seven {@link AGENT_TYPES}
 *   - campus: string 1..100
 *   - voice: a non-empty selection
 *   - tone: a non-empty selection
 *   - knowledgeSources: at least one source (count ≥ 1)
 *   - visibility: `public` or `private`
 *   - description: string 1..280
 *   - displayName: string 1..50
 *
 * Pure and non-mutating. The result order is deterministic (declaration order).
 */
export function validateRequiredFields(
  input: RequiredFieldInput
): RequiredFieldName[] {
  const failing: RequiredFieldName[] = [];

  if (!isStringInRange(input.name, NAME_MIN, NAME_MAX)) {
    failing.push("name");
  }
  if (!isValidAgentType(input.agentType)) {
    failing.push("agentType");
  }
  if (!isStringInRange(input.campus, CAMPUS_MIN, CAMPUS_MAX)) {
    failing.push("campus");
  }
  if (typeof input.voice !== "string" || input.voice.length === 0) {
    failing.push("voice");
  }
  if (typeof input.tone !== "string" || input.tone.length === 0) {
    failing.push("tone");
  }
  if (typeof input.knowledgeSourceCount !== "number" || input.knowledgeSourceCount < 1) {
    failing.push("knowledgeSources");
  }
  if (!isValidVisibility(input.visibility)) {
    failing.push("visibility");
  }
  if (!isStringInRange(input.description, DESCRIPTION_MIN, DESCRIPTION_MAX)) {
    failing.push("description");
  }
  if (!isStringInRange(input.displayName, DISPLAY_NAME_MIN, DISPLAY_NAME_MAX)) {
    failing.push("displayName");
  }

  return failing;
}

/** True iff `value` is one of the seven Agent_Types (Req 2.3). */
export function isValidAgentType(value: unknown): value is AgentType {
  return typeof value === "string" && (AGENT_TYPES as readonly string[]).includes(value);
}

/** True iff `value` is a valid Visibility (`public` | `private`) (Req 2.3). */
export function isValidVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITY_VALUES as readonly string[]).includes(value);
}

/**
 * The optional value-bearing fields whose format is validated on completion
 * (Req 2.4, 2.7). Each is optional; only present, non-empty values are checked.
 */
export type OptionalValueFieldName = "contactEmail" | "monetizationLink";

export interface OptionalValueInput {
  contactEmail?: string | null;
  monetizationLink?: string | null;
}

/**
 * A permissive but well-formedness-checking email pattern: a non-empty local
 * part, an `@`, a domain label, a dot, and a TLD of at least two characters,
 * with no whitespace. Intentionally avoids the full RFC 5322 grammar while
 * rejecting the common malformed cases (missing `@`, missing domain/TLD,
 * embedded spaces).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** True iff `value` is a well-formed contact email (Req 2.7). */
export function isValidContactEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/**
 * True iff `value` is a well-formed http(s) URL (Req 2.7). Uses the URL parser
 * and additionally requires an `http:`/`https:` scheme and a non-empty host, so
 * bare schemes and non-web URLs are rejected.
 */
export function isValidMonetizationLink(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return parsed.hostname.length > 0;
}

/**
 * Validates the optional value-bearing fields, returning the set of fields
 * whose provided value is malformed (Req 2.7). An absent, null, or empty value
 * is treated as "not provided" and therefore never fails (these fields are
 * optional per Req 2.4). Pure and non-mutating; deterministic order.
 */
export function validateOptionalValues(
  input: OptionalValueInput
): OptionalValueFieldName[] {
  const failing: OptionalValueFieldName[] = [];

  if (typeof input.contactEmail === "string" && input.contactEmail.length > 0) {
    if (!isValidContactEmail(input.contactEmail)) {
      failing.push("contactEmail");
    }
  }
  if (typeof input.monetizationLink === "string" && input.monetizationLink.length > 0) {
    if (!isValidMonetizationLink(input.monetizationLink)) {
      failing.push("monetizationLink");
    }
  }

  return failing;
}

/**
 * True iff `value` is a call rating that is an integer from 1 to 5 inclusive
 * (Req 8.10, 8.11). Rejects non-numbers, non-integers (e.g. 3.5), NaN, and
 * out-of-range values.
 */
export function isValidCallRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

/** The identifiers for the fields validated on a submitted report (Req 11.1). */
export type ReportFieldName = "agentId" | "reason";

export interface ReportInput {
  agentId?: string | null;
  reason?: string | null;
}

/**
 * Validates a submitted report, returning the set of invalid fields (Req 11.1,
 * 11.2). A report is well-formed when the reported agent identifier is present
 * (non-empty) and the reason is 1..1000 characters. Returns the specific
 * invalid field(s):
 *   - `agentId`: missing/empty reported Campus_Agent identifier
 *   - `reason`: missing, empty, or longer than 1000 characters
 *
 * Pure and non-mutating; deterministic order.
 */
export function validateReport(input: ReportInput): ReportFieldName[] {
  const failing: ReportFieldName[] = [];

  if (typeof input.agentId !== "string" || input.agentId.length === 0) {
    failing.push("agentId");
  }
  if (!isStringInRange(input.reason, REPORT_REASON_MIN, REPORT_REASON_MAX)) {
    failing.push("reason");
  }

  return failing;
}

/**
 * The campus-tag publish gate (Req 10.1, 10.2): a Campus_Agent may be published
 * only when it carries a non-empty Campus_Tag. Returns true iff `campusTag` is
 * a string with at least one character, so publish can proceed and the tag is
 * attached (Req 10.1); a false result means publication must be blocked with an
 * indication that a Campus_Tag is required (Req 10.2). A whitespace-only tag is
 * treated as empty.
 */
export function hasPublishableCampusTag(campusTag: unknown): campusTag is string {
  return typeof campusTag === "string" && campusTag.trim().length > 0;
}
