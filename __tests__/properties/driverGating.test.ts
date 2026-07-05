/**
 * Feature: dinee-voice-platform, Task 14.2 — Driver gating
 * Property 6: Tool-call gating (membership ∧ phase)
 *
 * Applying Property 6 to the Runsheet Driver_Agent (`runsheet_driver_exception`
 * conversation type): reporting/mutation tools must be REJECTED before the
 * driver's identity is confirmed and an active assignment is present. The
 * `runsheet_driver_exception` conversation starts in the `driver_verification`
 * phase, where only the verification and active-assignment-lookup tools are
 * permitted (Req 15.2). The reporting tools (`runsheet_report_delay`,
 * `runsheet_report_terminal_wait`, `runsheet_report_exception`,
 * `runsheet_append_driver_note`) are permitted only in the `reporting` phase,
 * reached after `driver_verified` then `active_assignment_present` (Req 15.5).
 * A reporting tool requested in the initial `driver_verification` phase is
 * therefore rejected with reason `not_in_phase` (Req 15.6).
 *
 * The behavior is exercised end-to-end through the real pack-driven session
 * driver (`runtime/session.ts` → `SessionDriver.handleFunctionCall`), which
 * consults `isToolCallPermitted` and records the `tool_rejected` audit entry
 * (tool, phase, callId), rather than a local harness. Spy handlers registered
 * on the tool executor prove the rejected tool is never executed.
 *
 * _Requirements: 15.2, 15.5, 15.6_
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

const DRIVER_EXCEPTION_TYPE = "runsheet_driver_exception";
const DRIVER_VERIFICATION_PHASE = "driver_verification";

/** Verification tool permitted in the initial driver_verification phase (Req 15.2). */
const VERIFY_TOOL = "runsheet_verify_driver";

/** Reporting/mutation tools permitted ONLY in the reporting phase (Req 15.5). */
const REPORTING_TOOLS = [
  "runsheet_report_delay",
  "runsheet_report_terminal_wait",
  "runsheet_report_exception",
  "runsheet_append_driver_note",
] as const;

/** Builds a resolved routing context for a Runsheet driver-exception call. */
function makeContext(callSid: string): ResolvedCallContext {
  return {
    callSid,
    fromNumber: "+15551230000",
    toNumber: "+15559990000",
    tenantId: "tenant_runsheet_1",
    conversationType: DRIVER_EXCEPTION_TYPE,
    enabledIntegrations: ["runsheet"],
  };
}

/**
 * Starts a session driver for a fresh driver-exception call, wiring an audit
 * sink and spy handlers that record which tool handlers actually execute. If
 * gating fails open and dispatches a rejected call, the spy would push the tool
 * name — so an empty `executed` list proves non-execution. Fails the test if
 * `prepareSession` does not resolve to a `start` decision.
 */
function startDriver(callSid: string) {
  const audits: AuditRecord[] = [];
  const executed: string[] = [];

  for (const tool of REPORTING_TOOLS) {
    registerToolHandler(tool, async () => {
      executed.push(tool);
      return { ok: true };
    });
  }
  // The verification tool is legitimately permitted in the initial phase; its
  // spy proves the contrast case executes.
  registerToolHandler(VERIFY_TOOL, async () => {
    executed.push(VERIFY_TOOL);
    return { verified: true };
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

describe("Task 14.2: Driver gating (Property 6)", () => {
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

  it.each(REPORTING_TOOLS)(
    "rejects the reporting tool %s requested in the initial driver_verification phase, with an audit entry",
    async (reportingTool) => {
      const { driver, audits, executed, ctx } = startDriver(
        `call_reject_${reportingTool}`
      );

      // The session starts in the driver-verification phase (before identity
      // is confirmed / an active assignment is present).
      expect(driver.phase).toBe(DRIVER_VERIFICATION_PHASE);

      const result = await driver.handleFunctionCall({
        callId: `fc_${reportingTool}`,
        name: reportingTool,
        args: { detail: "should not be recorded" },
      });

      // Rejected by phase gating: the reporting tool is in the resolved set but
      // not permitted before the reporting phase (Req 15.5, 15.6).
      expect(result.kind).toBe("rejected");
      if (result.kind !== "rejected") return; // narrow for the type checker
      expect(result.reason).toBe("not_in_phase");

      // Not executed: no handler ran.
      expect(executed).not.toContain(reportingTool);
      expect(executed).toEqual([]);

      // Call state preserved: still in the initial verification phase.
      expect(result.phase).toBe(DRIVER_VERIFICATION_PHASE);
      expect(driver.phase).toBe(DRIVER_VERIFICATION_PHASE);

      // A rejection result is returned to the model.
      expect(result.output.callId).toBe(`fc_${reportingTool}`);
      expect(result.output.output).toContain("tool_call_rejected");

      // An audit entry recording the rejected tool, the current phase, and the
      // call identifier is written (Req 15.6).
      expect(audits).toHaveLength(1);
      const audit = audits[0];
      expect(audit.event).toBe("tool_rejected");
      expect(audit.tool).toBe(reportingTool);
      expect(audit.phase).toBe(DRIVER_VERIFICATION_PHASE);
      expect(audit.callId).toBe(ctx.callSid);
      expect(audit.reason).toBe("not_in_phase");
    }
  );

  it("permits the driver-verification tool in the initial phase (contrast)", async () => {
    const { driver, audits, executed } = startDriver("call_allow_verify");

    expect(driver.phase).toBe(DRIVER_VERIFICATION_PHASE);

    const result = await driver.handleFunctionCall({
      callId: "fc_verify",
      name: VERIFY_TOOL,
      args: { driverIdentifier: "driver_42" },
    });

    // runsheet_verify_driver IS permitted in driver_verification, so it executes
    // and records no rejection audit — showing the gate is phase-specific
    // (Req 15.2).
    expect(result.kind).toBe("executed");
    expect(executed).toContain(VERIFY_TOOL);
    expect(audits.filter((a) => a.event === "tool_rejected")).toEqual([]);
  });
});
