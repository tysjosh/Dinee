/**
 * Feature: dinee-campus (Task 15.1)
 *
 * Pure, property-testable core for the Safety_Service's fail-closed
 * content-screening decision (Requirements 11.7, 11.8, 11.9). This function
 * carries NO Convex `ctx` and performs no I/O: it takes the outcome of a
 * screening attempt — either a completed classification against the policies,
 * or a signal that the screening dependency was unavailable — and decides
 * whether the content is flagged and withheld. It is imported by both the
 * `convex/campus/safety.ts` `screenContent` action (which supplies the
 * classification / timeout-or-error signal) and the property tests.
 *
 * Covered behaviors:
 *   - 11.7: content is screened against the profanity, harassment, and
 *     sexual-content policies. This module models the OUTCOME of that screen
 *     (which policies, if any, were violated); the ≤5s timeout and the call to
 *     the screening dependency live in the wrapping action.
 *   - 11.8: when screened content violates a policy, it is marked flagged and
 *     withheld from delivery.
 *   - 11.9: when screening cannot complete because a dependency is unavailable,
 *     the content is treated as flagged, withheld, AND a `screening_unavailable`
 *     error indication is returned (fail-closed).
 *
 * The decision is deliberately fail-closed: the ONLY outcome that is neither
 * flagged nor withheld is an available classification that violated no policy.
 * Any dependency failure — and, defensively, any malformed/unknown input — is
 * treated as a violation.
 */

/**
 * The content policies a Knowledge_Source or caller voice message is screened
 * against (Req 11.7).
 */
export const SCREENING_POLICIES = ["profanity", "harassment", "sexual"] as const;

export type ScreeningPolicy = (typeof SCREENING_POLICIES)[number];

/**
 * The error indication returned when screening could not complete because a
 * screening dependency was unavailable (Req 11.9).
 */
export const SCREENING_UNAVAILABLE_ERROR = "screening_unavailable" as const;

export type ScreeningError = typeof SCREENING_UNAVAILABLE_ERROR;

/**
 * The moderation status assigned to the content, aligned with the
 * `campusKnowledgeSources.moderationStatus` union in the schema (Req 11.7,
 * 11.8). This decision function only ever produces `approved` or `flagged`
 * (`pending` is the pre-screen state owned by the storage layer).
 */
export type ModerationStatus = "approved" | "flagged";

/**
 * The result of a screening attempt handed to {@link decideScreening}.
 *
 *   - `{ available: true, violatedPolicies }`: the screening dependency
 *     completed and reported the set of policies the content violated (an empty
 *     set means the content is clean).
 *   - `{ available: false }`: the screening dependency was unavailable — it
 *     errored, timed out, or otherwise could not complete (Req 11.9).
 */
export type ScreeningOutcome =
  | { available: true; violatedPolicies: readonly ScreeningPolicy[] }
  | { available: false };

/**
 * The fail-closed screening decision for a single piece of content.
 *
 *   - `moderationStatus`: `flagged` whenever the content is withheld,
 *     `approved` only for clean, successfully-screened content (Req 11.7, 11.8).
 *   - `flagged`: whether the content was marked as a policy violation (Req 11.8,
 *     11.9). Always equal to `withheld`.
 *   - `withheld`: whether the content must be withheld from delivery / excluded
 *     from grounding (Req 11.8, 11.9). Always equal to `flagged`.
 *   - `violatedPolicies`: the policies the content violated. Empty for a clean
 *     classification and for a dependency failure (a failure yields no policy
 *     detail, only the error).
 *   - `error`: present and set to `screening_unavailable` ONLY when the decision
 *     was forced by an unavailable screening dependency (Req 11.9); absent
 *     otherwise.
 */
export interface ScreeningDecision {
  moderationStatus: ModerationStatus;
  flagged: boolean;
  withheld: boolean;
  violatedPolicies: readonly ScreeningPolicy[];
  error?: ScreeningError;
}

/** Builds the fail-closed decision shared by every "treat as violation" path. */
function flaggedDecision(
  violatedPolicies: readonly ScreeningPolicy[],
  error?: ScreeningError
): ScreeningDecision {
  const decision: ScreeningDecision = {
    moderationStatus: "flagged",
    flagged: true,
    withheld: true,
    violatedPolicies,
  };
  if (error !== undefined) {
    decision.error = error;
  }
  return decision;
}

/**
 * Decides whether screened content is flagged and withheld, fail-closed
 * (Req 11.7, 11.8, 11.9). Pure and non-mutating.
 *
 * The decision rule is:
 *   - Screening dependency unavailable ⇒ flagged + withheld, with a
 *     `screening_unavailable` error indication (Req 11.9).
 *   - Screening completed and the content violated at least one policy ⇒
 *     flagged + withheld, carrying the violated policies, no error (Req 11.8).
 *   - Screening completed and the content violated no policy ⇒ approved, not
 *     flagged, not withheld (Req 11.7).
 *
 * Defensively fail-closed: any malformed/unknown outcome (e.g. `available:true`
 * without a policy array) is treated as a dependency failure so unscreened
 * content can never be delivered.
 */
export function decideScreening(outcome: ScreeningOutcome): ScreeningDecision {
  // Dependency unavailable: fail closed with the error indication (Req 11.9).
  if (!outcome || outcome.available !== true) {
    return flaggedDecision([], SCREENING_UNAVAILABLE_ERROR);
  }

  const violated = outcome.violatedPolicies;
  // Defensive: a completed screen must report an array of policies. Anything
  // else is malformed and is treated as a failure to complete (Req 11.9).
  if (!Array.isArray(violated)) {
    return flaggedDecision([], SCREENING_UNAVAILABLE_ERROR);
  }

  // Completed screen with one or more violations: flag + withhold (Req 11.8).
  if (violated.length > 0) {
    return flaggedDecision(violated);
  }

  // Completed screen, no violations: the sole approved-and-delivered path.
  return {
    moderationStatus: "approved",
    flagged: false,
    withheld: false,
    violatedPolicies: [],
  };
}
