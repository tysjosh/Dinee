/**
 * Feature: dinee-voice-platform, Task 6.11 — Runsheet phase gating
 *
 * Applying Property 6 (tool-call gating: membership ∧ phase) to the Runsheet
 * fuel-intake flow: a MUTATION tool (`runsheet_create_order_draft`) requested
 * BEFORE the `customer_identification` phase completes must be rejected — the
 * tool is not executed, the call state is preserved, and an audit entry
 * recording the rejected tool name, the current call phase, and the call
 * identifier is written (Req 7.4).
 *
 * The behavior is exercised end-to-end through the real pack-driven session
 * driver (`runtime/session.ts` → `SessionDriver.handleFunctionCall`), which
 * consults `isToolCallPermitted` and records the audit entry, rather than a
 * local harness. `customer_identification` is the initial phase of the
 * fuel-intake conversation, and `runsheet_create_order_draft` is only permitted
 * in `order_building`, so in the initial phase it is rejected with reason
 * `not_in_phase`.
 *
 * _Requirements: 7.4_
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerRunsheetVoicePack } from "../../src/lib/modules/packs/runsheet";
import { clearRegistry as clearVoiceRegistry } from "../../src/lib/modules/voiceDomainPackRegistry";
import { clearRegistry as clearToolPackRegistry } from "../../src/lib/modules/toolPackRegistry";
import {
  prepareSession,
  SessionDriver,
  type AuditRecord,
  type ResolvedCallContext,
} from "../../src/app/ws-server/runtime/session";
import {
  registerToolHandler,
  clearToolHandlers,
} from "../../src/app/ws-server/runtime/toolExecutor";

const FUEL_INTAKE_TYPE = "runsheet_fuel_order_intake";
const CUSTOMER_IDENTIFICATION_PHASE = "customer_identification";
const CREATE_DRAFT_TOOL = "runsheet_create_order_draft";
const LOOKUP_TOOL = "runsheet_lookup_customer";

/** Builds a resolved routing context for a Runsheet fuel-intake call. */
function makeContext(callSid: string): ResolvedCallContext {
  return {
    callSid,
    fromNumber: "+15551230000",
    toNumber: "+15559990000",
    tenantId: "tenant_runsheet_1",
    conversationType: FUEL_INTAKE_TYPE,
    enabledIntegrations: ["runsheet"],
  };
}

/**
 * Starts a session driver for a fresh fuel-intake call, wiring an audit sink and
 * a spy that records which tool handlers actually execute. Fails the test if
 * `prepareSession` does not resolve to a `start` decision.
 */
function startDriver(callSid: string) {
  const audits: AuditRecord[] = [];
  const executed: string[] = [];

  // Register spy handlers so "not executed" is verifiable: if gating fails open
  // and dispatches, the handler would push the tool name.
  registerToolHandler(CREATE_DRAFT_TOOL, async () => {
    executed.push(CREATE_DRAFT_TOOL);
    return { draft: { id: "draft_should_not_exist" } };
  });
  registerToolHandler(LOOKUP_TOOL, async () => {
    executed.push(LOOKUP_TOOL);
    return { customers: [], phaseEvent: "customer_identified" };
  });

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

  return { driver, audits, executed, ctx };
}

describe("Task 6.11: Runsheet phase gating (Property 6)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearToolPackRegistry();
    clearToolHandlers();
    const result = registerRunsheetVoicePack();
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    clearVoiceRegistry();
    clearToolPackRegistry();
    clearToolHandlers();
  });

  it("rejects runsheet_create_order_draft requested before customer_identification completes, with an audit entry", async () => {
    const { driver, audits, executed, ctx } = startDriver("call_reject_1");

    // The session starts in the customer-identification phase.
    expect(driver.phase).toBe(CUSTOMER_IDENTIFICATION_PHASE);

    const result = await driver.handleFunctionCall({
      callId: "fc_create_draft",
      name: CREATE_DRAFT_TOOL,
      args: { customerId: "c1" },
    });

    // Rejected by phase gating: the mutation tool is in the set but not
    // permitted in the customer-identification phase (Req 7.4).
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return; // narrow for the type checker
    expect(result.reason).toBe("not_in_phase");

    // Not executed: no handler ran.
    expect(executed).not.toContain(CREATE_DRAFT_TOOL);
    expect(executed).toEqual([]);

    // Call state preserved: still in the initial phase.
    expect(result.phase).toBe(CUSTOMER_IDENTIFICATION_PHASE);
    expect(driver.phase).toBe(CUSTOMER_IDENTIFICATION_PHASE);

    // A rejection result is returned to the model.
    expect(result.output.callId).toBe("fc_create_draft");
    expect(result.output.output).toContain("tool_call_rejected");

    // An audit entry recording the rejected tool, the current phase, and the
    // call identifier is written (Req 7.4).
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    expect(audit.event).toBe("tool_rejected");
    expect(audit.tool).toBe(CREATE_DRAFT_TOOL);
    expect(audit.phase).toBe(CUSTOMER_IDENTIFICATION_PHASE);
    expect(audit.callId).toBe(ctx.callSid);
    expect(audit.reason).toBe("not_in_phase");
  });

  it("permits the read-only customer lookup tool in the initial phase (contrast)", async () => {
    const { driver, audits, executed } = startDriver("call_allow_1");

    const result = await driver.handleFunctionCall({
      callId: "fc_lookup",
      name: LOOKUP_TOOL,
      args: { phone: "+15551230000" },
    });

    // The lookup tool IS permitted in customer_identification, so it executes
    // and records no rejection audit — showing the gate is phase-specific.
    expect(result.kind).toBe("executed");
    expect(executed).toContain(LOOKUP_TOOL);
    expect(audits.filter((a) => a.event === "tool_rejected")).toEqual([]);
  });
});
