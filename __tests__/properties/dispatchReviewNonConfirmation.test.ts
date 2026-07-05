/**
 * Feature: dinee-voice-platform, Task 10.3 — Dispatch-review non-confirmation
 * and escalation-on-unconfirmed.
 *
 * Exercises the unconfirmed-submission fail-safe of the pack-driven session
 * driver (`runtime/session.ts` → {@link SessionDriver}) end-to-end:
 *
 *  1. A successful `runsheet_create_order_draft` produces a transient in-session
 *     draft that the driver RETAINS (it is never persisted as a Dinee
 *     order-of-record during the active call — Req 6.8, 6.10).
 *  2. A `runsheet_queue_dispatch_review` call that does NOT confirm placement
 *     (returns `{ placed: false }`, or throws / times out) leaves placement
 *     unconfirmed, keeps the transient draft retained, and records a
 *     `dispatch_unconfirmed` audit entry (Req 6.8).
 *  3. If placement is still unconfirmed when the call ends,
 *     {@link SessionDriver.handleCallEnd} ESCALATES/transfers per the configured
 *     `Escalation_Target`, handing back the retained draft rather than
 *     discarding it (Req 6.9, 6.10).
 *  4. When placement IS confirmed, `handleCallEnd` returns `none` — there is
 *     nothing to escalate (Req 6.9).
 *
 * The behavior is driven through the real registry + session driver rather than
 * a local harness. Because the shipped Runsheet pack declares no escalation
 * rules, this test registers a purpose-built VoiceDomainPack that carries an
 * `Escalation_Target` so the escalation path (Req 6.9) is observable, using the
 * exact dispatch-review / create-draft tool names the driver special-cases.
 *
 * _Requirements: 6.8, 6.9, 6.10_
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  EscalationTarget,
  VoiceDomainPack,
} from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  clearRegistry as clearVoiceRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import {
  prepareSession,
  SessionDriver,
  CREATE_ORDER_DRAFT_TOOL,
  DISPATCH_REVIEW_TOOL,
  type AuditRecord,
  type ResolvedCallContext,
} from "../../src/app/ws-server/runtime/session";
import {
  registerToolHandler,
  clearToolHandlers,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "../../src/app/ws-server/runtime/toolExecutor";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONVERSATION_TYPE = "test_dispatch_review_intake";
const ORDER_BUILDING_PHASE = "order_building";
const ORDER_FINALIZED_PHASE = "order_finalized";

/** The escalation target the pack configures — the driver must route to this. */
const ESCALATION_TARGET: EscalationTarget = {
  kind: "phone",
  value: "+15550009999",
};

/** The transient draft a successful create-order-draft call yields. */
const DRAFT = {
  customerId: "cust_42",
  siteId: "site_7",
  productCode: "diesel",
  quantity: 500,
};

/**
 * A purpose-built pack with an `order_building → order_finalized` machine, the
 * two special-cased tools, and a configured `Escalation_Target`. Both tools are
 * permitted in `order_building` so the flow (create draft → dispatch review) can
 * run without a phase transition.
 */
const TEST_PACK: VoiceDomainPack = {
  id: "test_dispatch_review_pack",
  name: "Dispatch Review Test Pack",
  description: "Test-only pack exercising the unconfirmed-submission fail-safe.",
  conversationTypes: [
    {
      type: CONVERSATION_TYPE,
      initialPhase: ORDER_BUILDING_PHASE,
      transcriptMetadata: { fields: {} },
      fallbackBehavior: { kind: "escalate" },
    },
  ],
  tools: [
    {
      name: CREATE_ORDER_DRAFT_TOOL,
      description: "Build the transient in-session order draft.",
      parameters: { type: "object" },
      allowedPhases: [ORDER_BUILDING_PHASE],
      readOnly: false,
      handler: CREATE_ORDER_DRAFT_TOOL,
    },
    {
      name: DISPATCH_REVIEW_TOOL,
      description: "Queue the draft for dispatcher review.",
      parameters: { type: "object" },
      allowedPhases: [ORDER_BUILDING_PHASE, ORDER_FINALIZED_PHASE],
      readOnly: false,
      handler: DISPATCH_REVIEW_TOOL,
    },
  ],
  phases: [
    {
      id: ORDER_BUILDING_PHASE,
      transitions: [{ event: "order_finalized", to: ORDER_FINALIZED_PHASE }],
    },
    { id: ORDER_FINALIZED_PHASE, transitions: [], terminal: true },
  ],
  defaultPrompt: "You are a fuel-intake agent.",
  escalationRules: [
    { trigger: "tool_failure", target: ESCALATION_TARGET },
  ],
  integrations: [],
};

/** Builds a resolved routing context for the test conversation type. */
function makeContext(callSid: string): ResolvedCallContext {
  return {
    callSid,
    fromNumber: "+15551230000",
    toNumber: "+15559990000",
    tenantId: "tenant_test_1",
    conversationType: CONVERSATION_TYPE,
    enabledIntegrations: [],
  };
}

/**
 * Registers the test pack, prepares a session, and returns a fresh driver plus
 * an audit sink. Fails the test if `prepareSession` does not `start`.
 */
function startDriver(callSid: string) {
  const audits: AuditRecord[] = [];
  const ctx = makeContext(callSid);
  const prepared = prepareSession(ctx);
  if (prepared.kind !== "start") {
    throw new Error(
      `expected prepareSession to start a session, got terminate (${prepared.reason})`
    );
  }
  const driver = new SessionDriver(ctx, prepared.init, {
    onAudit: (record) => audits.push(record),
  });
  return { driver, audits, ctx };
}

beforeEach(() => {
  clearVoiceRegistry();
  clearToolHandlers();
  const result = registerVoiceDomainPack(TEST_PACK);
  expect(result.ok).toBe(true);
});

afterEach(() => {
  vi.useRealTimers();
  clearVoiceRegistry();
  clearToolHandlers();
});

// ─── (1) create_order_draft retains a transient draft (Req 6.8, 6.10) ─────────

describe("Task 10.3: create_order_draft retains a transient draft", () => {
  it("captures the draft produced by a successful create-order-draft call", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    const { driver } = startDriver("call_draft_retained");

    // No draft before the tool runs.
    expect(driver.draft).toBeUndefined();

    const result = await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });

    expect(result.kind).toBe("executed");
    // The transient draft is retained on the driver, unpersisted.
    expect(driver.draft).toEqual(DRAFT);
    // Placement has not been confirmed by merely drafting.
    expect(driver.placementConfirmed).toBe(false);
  });
});

// ─── (2) unconfirmed dispatch-review keeps the draft + audits (Req 6.8) ───────

describe("Task 10.3: unconfirmed dispatch-review retains the draft", () => {
  it("keeps placement unconfirmed and retains the draft when review returns { placed: false }", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    registerToolHandler(DISPATCH_REVIEW_TOOL, async () => ({ placed: false }));
    const { driver, audits } = startDriver("call_unconfirmed_false");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });

    const review = await driver.handleFunctionCall({
      callId: "fc_review",
      name: DISPATCH_REVIEW_TOOL,
      args: {},
    });

    // Placement not confirmed → draft retained, dispatch_unconfirmed audited.
    expect(driver.placementConfirmed).toBe(false);
    expect(driver.draft).toEqual(DRAFT);
    expect(review.kind).toBe("executed");
    if (review.kind === "executed") {
      expect(review.audit?.event).toBe("dispatch_unconfirmed");
      expect(review.audit?.tool).toBe(DISPATCH_REVIEW_TOOL);
    }
    expect(
      audits.some((a) => a.event === "dispatch_unconfirmed")
    ).toBe(true);
  });

  it("keeps placement unconfirmed and retains the draft when review throws (backend error)", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    registerToolHandler(DISPATCH_REVIEW_TOOL, async () => {
      throw new Error("intake path unavailable");
    });
    const { driver, audits } = startDriver("call_unconfirmed_error");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });
    await driver.handleFunctionCall({
      callId: "fc_review",
      name: DISPATCH_REVIEW_TOOL,
      args: {},
    });

    expect(driver.placementConfirmed).toBe(false);
    expect(driver.draft).toEqual(DRAFT);
    expect(
      audits.some((a) => a.event === "dispatch_unconfirmed")
    ).toBe(true);
  });

  it("keeps placement unconfirmed and retains the draft when review times out", async () => {
    vi.useFakeTimers();
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    registerToolHandler(
      DISPATCH_REVIEW_TOOL,
      () => new Promise<never>(() => {})
    );
    const { driver, audits } = startDriver("call_unconfirmed_timeout");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });

    const pending = driver.handleFunctionCall({
      callId: "fc_review",
      name: DISPATCH_REVIEW_TOOL,
      args: {},
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_TIMEOUT_MS);
    await pending;

    expect(driver.placementConfirmed).toBe(false);
    expect(driver.draft).toEqual(DRAFT);
    expect(
      audits.some((a) => a.event === "dispatch_unconfirmed")
    ).toBe(true);
  });
});

// ─── (3) call end with unconfirmed placement escalates (Req 6.9, 6.10) ────────

describe("Task 10.3: call end escalates per the configured Escalation_Target", () => {
  it("escalates with the retained draft when placement is unconfirmed at call end", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    registerToolHandler(DISPATCH_REVIEW_TOOL, async () => ({ placed: false }));
    const { driver, audits, ctx } = startDriver("call_escalate");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });
    await driver.handleFunctionCall({
      callId: "fc_review",
      name: DISPATCH_REVIEW_TOOL,
      args: {},
    });

    const end = driver.handleCallEnd();

    // Escalates per the configured Escalation_Target rather than discarding.
    expect(end.kind).toBe("escalate");
    if (end.kind === "escalate") {
      expect(end.target).toEqual(ESCALATION_TARGET);
      // The retained draft is handed back, never discarded (Req 6.10).
      expect(end.draft).toEqual(DRAFT);
      expect(end.audit.event).toBe("call_end_escalation");
      expect(end.audit.callId).toBe(ctx.callSid);
      expect(end.audit.detail).toBe(ESCALATION_TARGET.kind);
    }
    expect(
      audits.some((a) => a.event === "call_end_escalation")
    ).toBe(true);
  });

  it("escalates when the draft exists but dispatch-review was never attempted", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    const { driver } = startDriver("call_escalate_no_review");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });

    const end = driver.handleCallEnd();

    expect(end.kind).toBe("escalate");
    if (end.kind === "escalate") {
      expect(end.target).toEqual(ESCALATION_TARGET);
      expect(end.draft).toEqual(DRAFT);
    }
  });
});

// ─── (4) confirmed placement → call end does nothing (Req 6.9) ────────────────

describe("Task 10.3: confirmed placement needs no escalation", () => {
  it("returns 'none' from handleCallEnd once placement is confirmed", async () => {
    registerToolHandler(CREATE_ORDER_DRAFT_TOOL, async () => ({ draft: DRAFT }));
    registerToolHandler(DISPATCH_REVIEW_TOOL, async () => ({
      placed: true,
      reviewId: "rev_123",
    }));
    const { driver, audits } = startDriver("call_confirmed");

    await driver.handleFunctionCall({
      callId: "fc_create",
      name: CREATE_ORDER_DRAFT_TOOL,
      args: DRAFT,
    });
    const review = await driver.handleFunctionCall({
      callId: "fc_review",
      name: DISPATCH_REVIEW_TOOL,
      args: {},
    });

    // Placement confirmed → no dispatch_unconfirmed audit.
    expect(driver.placementConfirmed).toBe(true);
    if (review.kind === "executed") {
      expect(review.audit).toBeUndefined();
    }

    const end = driver.handleCallEnd();

    expect(end.kind).toBe("none");
    expect(
      audits.some((a) => a.event === "call_end_escalation")
    ).toBe(false);
  });
});
