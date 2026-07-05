/**
 * Feature: dinee-voice-platform, Task 13.2 — Read-only mutation rejection
 * Property 6: Tool-call gating (membership ∧ phase)
 *
 * Applying Property 6 to the Runsheet Status_Agent (`runsheet_order_status`
 * conversation type): the status agent is READ-ONLY, so any MUTATION tool
 * requested during a `runsheet_order_status` conversation must be REJECTED with
 * an audit entry and never executed (Req 14.3).
 *
 * The `runsheet_order_status` conversation starts (and stays) in the
 * `status_lookup` phase, where only the four read-only status tools are
 * permitted. `resolveToolSet` gates the exposed tool set by integration only:
 * the fuel-intake mutation tools (`runsheet_create_order_draft`,
 * `runsheet_queue_dispatch_review`) require the base `runsheet` integration, so
 * for a tenant with `runsheet` enabled they ARE in the resolved set — but their
 * `allowedPhases` are the fuel phases (`order_building` / `order_finalized`),
 * not `status_lookup`. A mutation tool requested during the status conversation
 * is therefore rejected by phase gating with reason `not_in_phase`.
 *
 * The behavior is exercised end-to-end through the real pack-driven session
 * driver (`runtime/session.ts` → `SessionDriver.handleFunctionCall`), which
 * consults `isToolCallPermitted` and records the `tool_rejected` audit entry,
 * rather than a local harness. Spy handlers registered on the tool executor
 * prove the rejected mutation tool is never executed.
 *
 * _Requirements: 14.3_
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

const STATUS_TYPE = "runsheet_order_status";
const STATUS_LOOKUP_PHASE = "status_lookup";

/** A read-only status tool, permitted in the status-lookup phase (contrast). */
const STATUS_TOOL = "runsheet_lookup_order_by_phone";

/**
 * Mutation tools that must be rejected during a read-only status conversation.
 * Both are fuel-intake mutations gated to the fuel phases, so they are never
 * permitted in `status_lookup` (Req 14.3).
 */
const MUTATION_TOOLS = [
  "runsheet_create_order_draft",
  "runsheet_queue_dispatch_review",
] as const;

/** Builds a resolved routing context for a Runsheet order-status call. */
function makeContext(callSid: string): ResolvedCallContext {
  return {
    callSid,
    fromNumber: "+15551230000",
    toNumber: "+15559990000",
    tenantId: "tenant_runsheet_1",
    conversationType: STATUS_TYPE,
    enabledIntegrations: ["runsheet"],
  };
}

/**
 * Starts a session driver for a fresh order-status call, wiring an audit sink
 * and spy handlers that record which tool handlers actually execute. If gating
 * fails open and dispatches a mutation, the spy would push the tool name — so
 * an empty `executed` list proves non-execution. Fails the test if
 * `prepareSession` does not resolve to a `start` decision.
 */
function startDriver(callSid: string) {
  const audits: AuditRecord[] = [];
  const executed: string[] = [];

  for (const tool of MUTATION_TOOLS) {
    registerToolHandler(tool, async () => {
      executed.push(tool);
      return { mutated: true };
    });
  }
  // The read-only status tool is legitimately permitted; its spy proves the
  // contrast case executes.
  registerToolHandler(STATUS_TOOL, async () => {
    executed.push(STATUS_TOOL);
    return { orders: [] };
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

describe("Task 13.2: Read-only mutation rejection (Property 6)", () => {
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

  it.each(MUTATION_TOOLS)(
    "rejects the mutation tool %s requested during a runsheet_order_status conversation, with an audit entry",
    async (mutationTool) => {
      const { driver, audits, executed, ctx } = startDriver(
        `call_reject_${mutationTool}`
      );

      // The status conversation runs in the read-only status-lookup phase.
      expect(driver.phase).toBe(STATUS_LOOKUP_PHASE);

      const result = await driver.handleFunctionCall({
        callId: `fc_${mutationTool}`,
        name: mutationTool,
        args: { draftId: "should_not_mutate", customerId: "c1" },
      });

      // Rejected by phase gating: the fuel mutation tool is in the resolved set
      // (requires the base `runsheet` integration) but its allowedPhases are the
      // fuel phases, never `status_lookup` (Req 14.3).
      expect(result.kind).toBe("rejected");
      if (result.kind !== "rejected") return; // narrow for the type checker
      expect(result.reason).toBe("not_in_phase");

      // Not executed: no mutation handler ran.
      expect(executed).not.toContain(mutationTool);
      expect(executed).toEqual([]);

      // Call state preserved: still in the read-only status-lookup phase.
      expect(result.phase).toBe(STATUS_LOOKUP_PHASE);
      expect(driver.phase).toBe(STATUS_LOOKUP_PHASE);

      // A rejection result is returned to the model.
      expect(result.output.callId).toBe(`fc_${mutationTool}`);
      expect(result.output.output).toContain("tool_call_rejected");

      // A tool_rejected audit entry recording the rejected tool, the phase, and
      // the call identifier is written (Req 14.3).
      expect(audits).toHaveLength(1);
      const audit = audits[0];
      expect(audit.event).toBe("tool_rejected");
      expect(audit.tool).toBe(mutationTool);
      expect(audit.phase).toBe(STATUS_LOOKUP_PHASE);
      expect(audit.callId).toBe(ctx.callSid);
      expect(audit.reason).toBe("not_in_phase");
    }
  );

  it("permits a read-only status tool in the status-lookup phase (contrast)", async () => {
    const { driver, audits, executed } = startDriver("call_allow_status");

    expect(driver.phase).toBe(STATUS_LOOKUP_PHASE);

    const result = await driver.handleFunctionCall({
      callId: "fc_lookup",
      name: STATUS_TOOL,
      args: { phone: "+15551230000" },
    });

    // The read-only status tool IS permitted in status_lookup, so it executes
    // and records no rejection audit — showing the status agent is read-only by
    // phase gating, not by blanket rejection (Req 14.3).
    expect(result.kind).toBe("executed");
    expect(executed).toContain(STATUS_TOOL);
    expect(audits.filter((a) => a.event === "tool_rejected")).toEqual([]);
  });
});
