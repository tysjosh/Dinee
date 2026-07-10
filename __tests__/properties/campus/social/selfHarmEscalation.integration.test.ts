// Feature: campus-social-loops, Task 17.2: Integration test for self-harm escalation
/**
 * Feature: campus-social-loops, Task 17.2 — Integration test for self-harm
 * escalation.
 *
 * Validates: Requirement 7.6
 *
 * IF a Social_Loops_Layer interaction contains a self-harm disclosure, THEN THE
 * Safety_Service SHALL trigger the configured self-harm escalation behavior
 * within 5 seconds and record that the escalation was triggered with a
 * timestamp (in `campusSafetyEscalations`).
 *
 * The reused Safety_Service escalation is exercised through the SAME
 * pure/injectable seam the `escalateSelfHarmDisclosure` action uses at runtime:
 * {@link routeSelfHarmEscalation} detects the disclosure and hands off to an
 * injected recorder that, in production, is the reused
 * `api.campus.safety.recordSelfHarmEscalation` mutation. Here the recorder is an
 * in-memory stand-in that mimics the `campusSafetyEscalations` insert (an
 * `escalationId` + a `triggeredAt` timestamp), so the "triggers within 5 s and
 * records with a timestamp" behavior is asserted exactly as production runs it,
 * without a Convex runtime.
 */
import { describe, it, expect } from "vitest";
import {
  routeSelfHarmEscalation,
  detectSelfHarmDisclosure,
  SELF_HARM_ESCALATION_BUDGET_MS,
  SELF_HARM_ESCALATION_KIND,
  type SelfHarmEscalationContext,
  type SelfHarmEscalationRecord,
} from "../../../../convex/campus/social/companion";

/** An in-memory `campusSafetyEscalations` table for the reused escalation. */
interface EscalationRow extends SelfHarmEscalationRecord {
  agentId: string;
  callId?: string;
  kind: typeof SELF_HARM_ESCALATION_KIND;
  behavior: string;
}

/**
 * Builds a recorder that mimics the reused `recordSelfHarmEscalation` mutation:
 * it inserts a row into the in-memory escalations table carrying a timestamp
 * and returns the audit record. `nowMs` models the wall clock at record time.
 */
function makeRecorder(store: EscalationRow[], nowMs: number) {
  let seq = 0;
  return async (
    context: SelfHarmEscalationContext
  ): Promise<SelfHarmEscalationRecord> => {
    seq += 1;
    const row: EscalationRow = {
      escalationId: `ESC_test_${seq}`,
      agentId: context.agentId,
      callId: context.callId,
      kind: SELF_HARM_ESCALATION_KIND,
      behavior: context.behavior ?? "default",
      triggeredAt: nowMs,
    };
    store.push(row);
    return { escalationId: row.escalationId, triggeredAt: row.triggeredAt };
  };
}

describe("Task 17.2: a self-harm disclosure in a social-loops interaction escalates within 5s and is recorded with a timestamp (Req 7.6)", () => {
  it("triggers the reused escalation, recording it with a timestamp in the escalations store", async () => {
    const store: EscalationRow[] = [];
    const recordedAt = 1_700_000_000_000;
    const startedAt = recordedAt - 40; // routing took 40 ms — well within budget

    const outcome = await routeSelfHarmEscalation(
      "honestly i want to kill myself, this semester is too much",
      { agentId: "AGENT_companion", callId: "CALL_group_1", behavior: "default" },
      makeRecorder(store, recordedAt),
      { startedAt, now: () => recordedAt }
    );

    // The escalation behavior was triggered (Req 7.6).
    expect(outcome.triggered).toBe(true);
    if (!outcome.triggered) return;

    // Recorded within the 5-second budget (Req 7.6).
    expect(outcome.withinBudget).toBe(true);
    expect(outcome.latencyMs).toBeLessThanOrEqual(SELF_HARM_ESCALATION_BUDGET_MS);
    expect(SELF_HARM_ESCALATION_BUDGET_MS).toBe(5_000);

    // Recorded with a timestamp in `campusSafetyEscalations` (Req 7.6).
    expect(store).toHaveLength(1);
    const row = store[0];
    expect(row.kind).toBe("self_harm");
    expect(row.agentId).toBe("AGENT_companion");
    expect(row.callId).toBe("CALL_group_1");
    expect(row.triggeredAt).toBe(recordedAt);
    expect(typeof row.triggeredAt).toBe("number");
    // The outcome carries the same recorded audit id + timestamp.
    expect(outcome.escalationId).toBe(row.escalationId);
    expect(outcome.triggeredAt).toBe(row.triggeredAt);
  });

  it("does not escalate (and records nothing) for an interaction with no self-harm disclosure", async () => {
    const store: EscalationRow[] = [];
    const now = 1_700_000_000_000;

    const outcome = await routeSelfHarmEscalation(
      "which dining hall has the best late-night food?",
      { agentId: "AGENT_guide" },
      makeRecorder(store, now),
      { startedAt: now, now: () => now }
    );

    expect(outcome.triggered).toBe(false);
    expect(store).toHaveLength(0);
  });

  it("still reports within-budget when routing latency stays at or under 5 seconds", async () => {
    const store: EscalationRow[] = [];
    const startedAt = 1_700_000_000_000;
    // Recording completes exactly at the 5-second boundary.
    const recordedAt = startedAt + SELF_HARM_ESCALATION_BUDGET_MS;

    const outcome = await routeSelfHarmEscalation(
      "i feel suicidal",
      { agentId: "AGENT_twin" },
      makeRecorder(store, recordedAt),
      { startedAt, now: () => recordedAt }
    );

    expect(outcome.triggered).toBe(true);
    if (!outcome.triggered) return;
    expect(outcome.latencyMs).toBe(SELF_HARM_ESCALATION_BUDGET_MS);
    expect(outcome.withinBudget).toBe(true);
    expect(store).toHaveLength(1);
    expect(store[0].triggeredAt).toBe(recordedAt);
  });

  it("detects a range of self-harm disclosures and ignores benign social content", () => {
    // High-signal disclosures across social-loops surfaces (battle/challenge/group).
    expect(detectSelfHarmDisclosure("I want to kill myself")).toBe(true);
    expect(detectSelfHarmDisclosure("thinking about suicide")).toBe(true);
    expect(detectSelfHarmDisclosure("I might hurt myself tonight")).toBe(true);
    expect(detectSelfHarmDisclosure("there's no reason to live")).toBe(true);
    // Case-insensitive.
    expect(detectSelfHarmDisclosure("I WANT TO DIE")).toBe(true);

    // Benign content is never a disclosure.
    expect(detectSelfHarmDisclosure("this roast battle is killing me, so funny")).toBe(
      false
    );
    expect(detectSelfHarmDisclosure("best study spot on campus?")).toBe(false);
    expect(detectSelfHarmDisclosure("")).toBe(false);
    expect(detectSelfHarmDisclosure(null)).toBe(false);
    expect(detectSelfHarmDisclosure(undefined)).toBe(false);
  });
});
