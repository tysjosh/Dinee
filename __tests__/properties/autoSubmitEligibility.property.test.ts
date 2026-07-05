// Feature: dinee-voice-platform, Property 25: Auto-submit eligibility — a finalized Order_Draft is auto-submitted iff the full eligibility conjunction holds; otherwise it is routed to review
//
// Validates: Requirements 13.1, 13.2
//
// Req 13.1: WHILE the tenant's review mode is `auto_submit_low_risk`, THE
// Fuel_Intake_Agent SHALL auto-submit an Order_Draft only when the customer,
// site, tank, and product are all known, the Confidence_Score is at or above
// the configured threshold, and there is no compliance warning, credit hold, or
// unusual delivery instruction.
// Req 13.2: IF any of those conditions is not met (or the tenant is not in
// `auto_submit_low_risk` mode), THEN the Order_Draft SHALL be routed to review.
//
// This property exercises the pure `evaluateAutoSubmit` decision function:
// across arbitrary inputs (review modes, confidence spanning the threshold, and
// each hazard toggled), the outcome must be `auto_submit` iff the full
// conjunction holds, and `review` otherwise.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateAutoSubmit,
  type AutoSubmitInput,
  type AutoSubmitSignals,
  type ReviewMode,
} from "../../src/lib/modules/packs/runsheet/autoSubmit";

/** Both review modes, so ~half the inputs are ineligible purely on mode (Req 13.2). */
const reviewModeArb: fc.Arbitrary<ReviewMode> = fc.constantFrom(
  "always_review",
  "auto_submit_low_risk"
);

/**
 * Confidence and threshold generator. Draws both from a coarse grid so scores
 * land below, exactly at, and above the threshold with meaningful frequency,
 * exercising the `>=` boundary of the confidence condition (Req 13.1).
 */
const confidenceGridArb: fc.Arbitrary<number> = fc.constantFrom(
  0, 0.1, 0.25, 0.5, 0.7, 0.75, 0.8, 0.9, 0.95, 1
);

/**
 * Signals generator. Each known-flag and each hazard is an independent boolean,
 * and confidence/threshold are drawn from the boundary-hitting grid, so every
 * conjunct is exercised true and false across the run.
 */
const signalsArb: fc.Arbitrary<AutoSubmitSignals> = fc.record({
  customerKnown: fc.boolean(),
  siteKnown: fc.boolean(),
  tankKnown: fc.boolean(),
  productKnown: fc.boolean(),
  confidenceScore: confidenceGridArb,
  confidenceThreshold: confidenceGridArb,
  complianceWarning: fc.boolean(),
  creditHold: fc.boolean(),
  unusualInstruction: fc.boolean(),
});

const inputArb: fc.Arbitrary<AutoSubmitInput> = fc.record({
  reviewMode: reviewModeArb,
  signals: signalsArb,
});

/**
 * Independent reference oracle for the full eligibility conjunction, including
 * the review-mode gate. Mirrors Req 13.1 directly.
 */
function isEligible(input: AutoSubmitInput): boolean {
  if (input.reviewMode !== "auto_submit_low_risk") return false;
  const s = input.signals;
  return (
    s.customerKnown &&
    s.siteKnown &&
    s.tankKnown &&
    s.productKnown &&
    s.confidenceScore >= s.confidenceThreshold &&
    !s.complianceWarning &&
    !s.creditHold &&
    !s.unusualInstruction
  );
}

describe("Property 25: Auto-submit eligibility", () => {
  it("auto-submits iff the full conjunction holds; otherwise routes to review", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const decision = evaluateAutoSubmit(input);
        const eligible = isEligible(input);

        expect(decision.outcome).toBe(eligible ? "auto_submit" : "review");

        if (eligible) {
          expect(decision.autoSubmitted).toBe(true);
          if (decision.outcome === "auto_submit") {
            // The Confidence_Score is recorded at submission (Req 13.4).
            expect(decision.confidenceAtSubmission).toBe(
              input.signals.confidenceScore
            );
          }
        } else {
          expect(decision.autoSubmitted).toBe(false);
          if (decision.outcome === "review") {
            // A review decision must record at least one failing reason.
            expect(decision.reasons.length).toBeGreaterThan(0);
            expect(decision.reason).toBe(decision.reasons[0]);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("routes to review whenever the tenant is not in auto_submit_low_risk mode", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const decision = evaluateAutoSubmit({
          reviewMode: "always_review",
          signals,
        });
        // Regardless of how favorable the signals are, mode gates auto-submit.
        expect(decision.outcome).toBe("review");
        expect(decision.autoSubmitted).toBe(false);
        if (decision.outcome === "review") {
          expect(decision.reasons).toContain("review_mode_not_auto_submit");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("routes to review whenever any single hazard or unknown is present under auto_submit_low_risk", () => {
    // A focused variant: start from a fully-eligible signal set and flip exactly
    // one disqualifier, asserting the outcome becomes review (Req 13.2).
    const disqualifierArb = fc.constantFrom<keyof AutoSubmitSignals>(
      "customerKnown",
      "siteKnown",
      "tankKnown",
      "productKnown",
      "complianceWarning",
      "creditHold",
      "unusualInstruction"
    );

    fc.assert(
      fc.property(disqualifierArb, (field) => {
        const base: AutoSubmitSignals = {
          customerKnown: true,
          siteKnown: true,
          tankKnown: true,
          productKnown: true,
          confidenceScore: 0.9,
          confidenceThreshold: 0.8,
          complianceWarning: false,
          creditHold: false,
          unusualInstruction: false,
        };
        // Known-flags flip to false; hazards flip to true — either disqualifies.
        const isHazard =
          field === "complianceWarning" ||
          field === "creditHold" ||
          field === "unusualInstruction";
        const signals: AutoSubmitSignals = { ...base, [field]: isHazard };

        const decision = evaluateAutoSubmit({
          reviewMode: "auto_submit_low_risk",
          signals,
        });
        expect(decision.outcome).toBe("review");
      }),
      { numRuns: 100 }
    );
  });
});
