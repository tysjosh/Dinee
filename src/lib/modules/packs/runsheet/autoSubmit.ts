/**
 * Runsheet Auto_Submit eligibility evaluator (later phase, Requirement 13).
 *
 * A PURE decision function that decides whether a finalized fuel Order_Draft may
 * be auto-submitted (bypassing the Dispatcher_Review_Queue) or must be routed to
 * review. It performs no I/O and does not mutate its inputs.
 *
 * Eligibility rule (Req 13.1, 13.2):
 *   WHILE the tenant's review mode is `auto_submit_low_risk`, the draft is
 *   auto-submitted ONLY when the FULL conjunction holds:
 *     - the customer is known,
 *     - the delivery site is known,
 *     - the tank is known,
 *     - the product is known,
 *     - the Confidence_Score is at or above the configured threshold,
 *     - no compliance warning is present,
 *     - no credit hold is present, and
 *     - no unusual delivery instruction is present.
 *   If ANY condition is not met — or the review mode is not
 *   `auto_submit_low_risk` — the draft is routed to review.
 *
 * On an auto-submit decision the result records that the draft was auto-submitted
 * (Req 13.3) and the Confidence_Score at submission (Req 13.4). On a review
 * decision it records every failing condition so the caller can explain why the
 * draft was not auto-submitted.
 *
 * This evaluator is the decision half of the later-phase Auto_Submit feature; the
 * `runsheet_submit_order` tool (see `tools.ts`) is the tool half, exposed only
 * when the tenant has Auto_Submit enabled (Req 13.5).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

/**
 * The tenant's configured review mode (mirrors the `defaultReviewMode` union in
 * `convex/schema.ts`, Req 8.4). Auto-submit is only ever considered under
 * `auto_submit_low_risk` (Req 13.1).
 */
export type ReviewMode = "always_review" | "auto_submit_low_risk";

/**
 * The risk signals evaluated for auto-submit eligibility (Req 13.1). Every flag
 * is expressed positively as a required condition (`*Known`) or a disqualifying
 * hazard (`complianceWarning`, `creditHold`, `unusualInstruction`) so the
 * conjunction reads directly off the requirement.
 */
export interface AutoSubmitSignals {
  /** Whether the customer was resolved to a known account (Req 13.1). */
  customerKnown: boolean;
  /** Whether the delivery site is a known site on file (Req 13.1). */
  siteKnown: boolean;
  /** Whether the tank is a known tank on file (Req 13.1). */
  tankKnown: boolean;
  /** Whether the product code is a known/valid product (Req 13.1). */
  productKnown: boolean;
  /** The extraction Confidence_Score for the draft, in `[0, 1]` (Req 13.1, 13.4). */
  confidenceScore: number;
  /** The tenant's configured confidence threshold, in `[0, 1]` (Req 13.1). */
  confidenceThreshold: number;
  /** Whether any compliance warning is present (a hazard; Req 13.1). */
  complianceWarning: boolean;
  /** Whether a credit hold is present on the account (a hazard; Req 13.1). */
  creditHold: boolean;
  /** Whether an unusual delivery instruction is present (a hazard; Req 13.1). */
  unusualInstruction: boolean;
}

/** Input to {@link evaluateAutoSubmit}: the tenant review mode plus the risk signals. */
export interface AutoSubmitInput {
  /** The tenant's configured review mode (Req 13.1). */
  reviewMode: ReviewMode;
  /** The risk signals evaluated for eligibility (Req 13.1). */
  signals: AutoSubmitSignals;
}

/**
 * A single reason an Order_Draft was routed to review instead of auto-submitted.
 * `review_mode_not_auto_submit` covers the case where auto-submit is not even
 * considered because the tenant is not in `auto_submit_low_risk` mode.
 */
export type AutoSubmitIneligibilityReason =
  | "review_mode_not_auto_submit"
  | "unknown_customer"
  | "unknown_site"
  | "unknown_tank"
  | "unknown_product"
  | "confidence_below_threshold"
  | "compliance_warning"
  | "credit_hold"
  | "unusual_instruction";

/**
 * The decision produced by {@link evaluateAutoSubmit}.
 *
 * - `auto_submit`: the full conjunction held; records `autoSubmitted: true` and
 *   the `confidenceAtSubmission` (Req 13.3, 13.4).
 * - `review`: at least one condition failed (or the tenant is not in
 *   `auto_submit_low_risk` mode); records every failing `reason`.
 */
export type AutoSubmitDecision =
  | {
      outcome: "auto_submit";
      /** Recorded per Req 13.3. Always `true` on an auto-submit decision. */
      autoSubmitted: true;
      /** The Confidence_Score recorded at submission (Req 13.4). */
      confidenceAtSubmission: number;
    }
  | {
      outcome: "review";
      /** Recorded per Req 13.3. Always `false` on a review decision. */
      autoSubmitted: false;
      /** The primary reason the draft was routed to review (first failing condition). */
      reason: AutoSubmitIneligibilityReason;
      /** Every failing condition, in evaluation order, for full transparency. */
      reasons: AutoSubmitIneligibilityReason[];
    };

/**
 * Collects the failing eligibility conditions for the given signals, in a fixed
 * evaluation order (Req 13.1). An empty result means every condition held.
 */
function collectFailures(signals: AutoSubmitSignals): AutoSubmitIneligibilityReason[] {
  const failures: AutoSubmitIneligibilityReason[] = [];
  if (!signals.customerKnown) failures.push("unknown_customer");
  if (!signals.siteKnown) failures.push("unknown_site");
  if (!signals.tankKnown) failures.push("unknown_tank");
  if (!signals.productKnown) failures.push("unknown_product");
  if (!(signals.confidenceScore >= signals.confidenceThreshold)) {
    // Note: `!(a >= b)` also rejects a NaN confidence/threshold, so a
    // non-comparable score can never satisfy the threshold condition.
    failures.push("confidence_below_threshold");
  }
  if (signals.complianceWarning) failures.push("compliance_warning");
  if (signals.creditHold) failures.push("credit_hold");
  if (signals.unusualInstruction) failures.push("unusual_instruction");
  return failures;
}

/**
 * Evaluates auto-submit eligibility for a finalized Order_Draft (Req 13.1, 13.2).
 *
 * Returns an `auto_submit` decision — recording `autoSubmitted` and the
 * confidence at submission (Req 13.3, 13.4) — if and only if the tenant is in
 * `auto_submit_low_risk` mode AND the full eligibility conjunction holds.
 * Otherwise returns a `review` decision listing every failing condition.
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function evaluateAutoSubmit(input: AutoSubmitInput): AutoSubmitDecision {
  // Auto-submit is only considered under `auto_submit_low_risk` (Req 13.1).
  if (input.reviewMode !== "auto_submit_low_risk") {
    return {
      outcome: "review",
      autoSubmitted: false,
      reason: "review_mode_not_auto_submit",
      reasons: ["review_mode_not_auto_submit"],
    };
  }

  const failures = collectFailures(input.signals);
  if (failures.length > 0) {
    // Any unmet condition routes to review (Req 13.2).
    return {
      outcome: "review",
      autoSubmitted: false,
      reason: failures[0],
      reasons: failures,
    };
  }

  // Full conjunction held: auto-submit and record the confidence (Req 13.3, 13.4).
  return {
    outcome: "auto_submit",
    autoSubmitted: true,
    confidenceAtSubmission: input.signals.confidenceScore,
  };
}
