/**
 * Feature: dinee-campus (Task 14.1)
 *
 * Pure, property-testable core for the voice-clone consent publish gate. These
 * functions carry NO Convex `ctx` and perform no I/O, so they can be exercised
 * directly by unit and property tests and imported by the Safety_Service /
 * `publishAgent` orchestration that enforces the same rule (Req 11.12 step 3 of
 * the publish state machine).
 *
 * Covered behaviors:
 *   - 11.11: Voice_Clone_Consent is verified through a recorded phrase or
 *     account ownership. {@link CONSENT_METHODS} enumerates the two accepted
 *     verification methods, matching `campusVoiceCloneConsents.method`.
 *   - 11.12 / Property 29: the publish gate — publication is permitted with
 *     respect to consent if and only if the agent does NOT represent a real
 *     person, OR a verified Voice_Clone_Consent (recorded phrase or account
 *     ownership) exists for that agent; otherwise publication is blocked with a
 *     `consent_required` error.
 */

// ---------------------------------------------------------------------------
// Domain types (declared locally so this module stays dependency-free)
// ---------------------------------------------------------------------------

/**
 * The two accepted Voice_Clone_Consent verification methods (Req 11.11),
 * matching `campusVoiceCloneConsents.method`:
 *   - `recorded_phrase`: the subject recorded a verification phrase.
 *   - `account_ownership`: the creator proved ownership of the account/voice.
 */
export const CONSENT_METHODS = ["recorded_phrase", "account_ownership"] as const;

export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * The minimal Voice_Clone_Consent view the gate needs, structurally satisfied
 * by a full `campusVoiceCloneConsents` row. A consent counts only when it
 * belongs to the agent, uses one of the accepted methods, and is `verified`.
 */
export interface ConsentRecordView {
  agentId: string;
  method: ConsentMethod;
  verified: boolean;
}

/**
 * The publish gate's input. `representsRealPerson` is the agent's declaration
 * of whether it depicts/clones a real person (Req 11.12). `consents` is the set
 * of consent records to resolve against — typically the rows returned by
 * `campusVoiceCloneConsents.by_agent_id` for the agent being published.
 */
export interface ConsentGateInput {
  agentId: string;
  representsRealPerson: boolean;
  consents?: readonly ConsentRecordView[];
}

/**
 * The error returned when publication is blocked by the consent gate: no
 * recorded/verified Voice_Clone_Consent exists for an agent that represents a
 * real person (Req 11.12).
 */
export type ConsentDenialCode = "consent_required";

/** The outcome of the consent gate: permit publish, or block with a reason. */
export type ConsentGateDecision =
  | { permitted: true }
  | { permitted: false; error: ConsentDenialCode };

/** True iff `value` is one of the accepted consent methods (Req 11.11). */
export function isValidConsentMethod(value: unknown): value is ConsentMethod {
  return (
    typeof value === "string" &&
    (CONSENT_METHODS as readonly string[]).includes(value)
  );
}

/**
 * True iff `consents` contains a verified Voice_Clone_Consent for `agentId`
 * (Req 11.11). A consent qualifies only when it belongs to the agent, carries a
 * valid method (`recorded_phrase` or `account_ownership`), and is `verified`.
 * An unverified, mismatched-agent, or unknown-method record does not qualify.
 * Pure and non-mutating.
 */
export function hasVerifiedConsent(
  consents: readonly ConsentRecordView[] | undefined,
  agentId: string
): boolean {
  if (!consents) {
    return false;
  }
  return consents.some(
    (consent) =>
      consent.agentId === agentId &&
      consent.verified === true &&
      isValidConsentMethod(consent.method)
  );
}

/**
 * The voice-clone consent publish gate (Req 11.11, 11.12; Property 29).
 * Publication is permitted with respect to consent if and only if EITHER the
 * agent does not represent a real person, OR a verified Voice_Clone_Consent
 * (recorded phrase or account ownership) exists for that agent. In every other
 * case — an agent that represents a real person with no recorded/verified
 * consent — publication is blocked with a `consent_required` error. Pure and
 * non-mutating.
 */
export function evaluateConsentGate(
  input: ConsentGateInput
): ConsentGateDecision {
  if (!input.representsRealPerson) {
    return { permitted: true };
  }
  if (hasVerifiedConsent(input.consents, input.agentId)) {
    return { permitted: true };
  }
  return { permitted: false, error: "consent_required" };
}
