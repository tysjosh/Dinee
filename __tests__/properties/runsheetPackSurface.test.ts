/**
 * Feature: dinee-voice-platform, Task 6.10 — Runsheet pack declared surface
 *
 * Example tests asserting the Runsheet VoiceDomainPack's declared surface:
 *   - it declares EXACTLY the four conversation types (Req 4.1), and no others;
 *   - the review-only MVP fuel-intake tool set is EXACTLY the six tools
 *     (Req 6.1): runsheet_lookup_customer, runsheet_list_customer_sites,
 *     runsheet_list_customer_tanks, runsheet_validate_product,
 *     runsheet_create_order_draft, runsheet_queue_dispatch_review;
 *   - the set contains NO model-invoked transcript-append/capture tool
 *     (transcript capture is a runtime side-effect, Req 6.1, 18.1); and
 *   - the set contains NO runsheet_submit_order (later-phase Auto_Submit tool,
 *     Req 6.2); and
 *   - it declares the six Driver_Agent tools for the `runsheet_driver_exception`
 *     conversation (Req 15.1) with verification → assignment → reporting phase
 *     gating (Req 15.2, 15.5, 15.6) and sensitive-action PIN defaults (Req 15.4).
 *
 * The exposed tool set is checked through the registry (register the pack, then
 * resolve the integration-gated tool set for a tenant with the runsheet
 * integration enabled) so the assertion covers the surface the runtime actually
 * exposes to the model, not just the raw declaration.
 *
 * _Requirements: 4.1, 6.1, 6.2_
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  runsheetVoicePack,
  registerRunsheetVoicePack,
  RUNSHEET_INTEGRATION_ID,
} from "../../src/lib/modules/packs/runsheet";
import { runsheetFuelIntakeTools } from "../../src/lib/modules/packs/runsheet/tools";
import {
  runsheetDriverTools,
  RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS,
} from "../../src/lib/modules/packs/runsheet/driverTools";
import {
  resolveToolSet,
  clearRegistry as clearVoiceRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import { clearRegistry as clearToolPackRegistry } from "../../src/lib/modules/toolPackRegistry";

/** The four conversation types the Runsheet_Pack must declare, and only these (Req 4.1). */
const EXPECTED_CONVERSATION_TYPES = [
  "runsheet_fuel_order_intake",
  "runsheet_order_status",
  "runsheet_driver_exception",
  "runsheet_dispatch_callback",
];

/** The six tools that make up the review-only MVP fuel-intake tool set (Req 6.1). */
const EXPECTED_FUEL_INTAKE_TOOLS = [
  "runsheet_lookup_customer",
  "runsheet_list_customer_sites",
  "runsheet_list_customer_tanks",
  "runsheet_validate_product",
  "runsheet_create_order_draft",
  "runsheet_queue_dispatch_review",
];

/**
 * The four read-only Status_Agent tools for the `runsheet_order_status`
 * conversation (Req 14.1). They are declared on the same pack as a DIFFERENT
 * conversation type; phase gating keeps them disjoint from the fuel-intake set.
 */
const EXPECTED_STATUS_TOOLS = [
  "runsheet_lookup_order_by_phone",
  "runsheet_get_order_status",
  "runsheet_get_eta",
  "runsheet_get_recent_deliveries",
];

/**
 * The six Driver_Agent tools for the `runsheet_driver_exception` conversation
 * (Req 15.1). Declared on the same pack as a DIFFERENT conversation type; phase
 * gating keeps them disjoint from the fuel-intake and status sets.
 */
const EXPECTED_DRIVER_TOOLS = [
  "runsheet_verify_driver",
  "runsheet_get_active_assignment",
  "runsheet_report_delay",
  "runsheet_report_terminal_wait",
  "runsheet_report_exception",
  "runsheet_append_driver_note",
];

describe("Task 6.10: Runsheet pack declared surface", () => {
  beforeEach(() => {
    // Clear both registries between cases and register via the pack's own
    // registration entry point (which also ensures the bridged logistics
    // tool-pack registration exists).
    clearVoiceRegistry();
    clearToolPackRegistry();
    const result = registerRunsheetVoicePack();
    expect(result.ok).toBe(true);
  });

  it("declares exactly the four Runsheet conversation types and no others", () => {
    const declared = runsheetVoicePack.conversationTypes.map((c) => c.type);

    // Same membership regardless of order, and exactly four entries.
    expect(declared).toHaveLength(EXPECTED_CONVERSATION_TYPES.length);
    expect([...declared].sort()).toEqual([...EXPECTED_CONVERSATION_TYPES].sort());
    for (const type of EXPECTED_CONVERSATION_TYPES) {
      expect(declared).toContain(type);
    }
  });

  it("exposes the six review-only MVP fuel-intake tools when the integration is enabled", () => {
    const exposed = resolveToolSet(runsheetVoicePack, [RUNSHEET_INTEGRATION_ID]).map(
      (t) => t.name
    );

    // All six fuel-intake tools are present in the resolved set. The set also
    // carries the read-only Status_Agent tools (a different conversation type,
    // Req 14.1), which phase gating keeps disjoint from the fuel phases, so this
    // asserts the fuel-intake tools are a present subset rather than an exact
    // count of every pack tool.
    for (const tool of EXPECTED_FUEL_INTAKE_TOOLS) {
      expect(exposed).toContain(tool);
    }

    // The raw fuel-intake tool declaration remains EXACTLY the six-tool set —
    // the status tools live in their own module and never leak into it.
    const declared = runsheetFuelIntakeTools.map((t) => t.name);
    expect(declared).toHaveLength(EXPECTED_FUEL_INTAKE_TOOLS.length);
    expect([...declared].sort()).toEqual([...EXPECTED_FUEL_INTAKE_TOOLS].sort());
  });

  it("exposes the four read-only Status_Agent tools when the integration is enabled", () => {
    const resolved = resolveToolSet(runsheetVoicePack, [RUNSHEET_INTEGRATION_ID]);
    const exposed = resolved.map((t) => t.name);

    for (const tool of EXPECTED_STATUS_TOOLS) {
      expect(exposed).toContain(tool);
    }

    // Every Status_Agent tool is read-only and permitted only in the
    // status-lookup phase (Req 14.1) — no mutation reaches the status flow.
    for (const name of EXPECTED_STATUS_TOOLS) {
      const tool = resolved.find((t) => t.name === name);
      expect(tool?.readOnly).toBe(true);
      expect(tool?.allowedPhases).toEqual(["status_lookup"]);
    }
  });

  it("declares exactly the six driver-exception tools with verification → assignment → reporting phase gating (Req 15.1, 15.2, 15.5)", () => {
    // The raw driver tool declaration is EXACTLY the six-tool set (Req 15.1).
    const declared = runsheetDriverTools.map((t) => t.name);
    expect(declared).toHaveLength(EXPECTED_DRIVER_TOOLS.length);
    expect([...declared].sort()).toEqual([...EXPECTED_DRIVER_TOOLS].sort());

    const resolved = resolveToolSet(runsheetVoicePack, [RUNSHEET_INTEGRATION_ID]);
    const byName = new Map(resolved.map((t) => [t.name, t]));

    // All six driver tools are exposed for a runsheet-enabled tenant.
    for (const name of EXPECTED_DRIVER_TOOLS) {
      expect(byName.has(name)).toBe(true);
    }

    // In the driver-verification phase, only verification + active-assignment
    // lookup are permitted (Req 15.2).
    expect(byName.get("runsheet_verify_driver")?.allowedPhases).toContain(
      "driver_verification"
    );
    expect(
      byName.get("runsheet_get_active_assignment")?.allowedPhases
    ).toContain("driver_verification");

    // Reporting/mutation tools are permitted ONLY in the reporting phase, which
    // is reachable only after identity confirmation AND an active assignment
    // (Req 15.5). None of them are permitted in the verification phase (Req 15.6).
    const reportingTools = [
      "runsheet_report_delay",
      "runsheet_report_terminal_wait",
      "runsheet_report_exception",
      "runsheet_append_driver_note",
    ];
    for (const name of reportingTools) {
      const tool = byName.get(name);
      expect(tool?.allowedPhases).toEqual(["reporting"]);
      expect(tool?.readOnly).toBe(false);
      expect(tool?.allowedPhases).not.toContain("driver_verification");
      expect(tool?.allowedPhases).not.toContain("assignment_confirmed");
    }

    // The default sensitive-action set requires a PIN before invocation (Req 15.4).
    expect(RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS.has("runsheet_report_exception")).toBe(
      true
    );
    expect(
      RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS.has("runsheet_append_driver_note")
    ).toBe(true);
  });

  it("does NOT include a model-invoked transcript-append/capture tool", () => {
    const declared = runsheetFuelIntakeTools.map((t) => t.name);
    const exposed = resolveToolSet(runsheetVoicePack, [RUNSHEET_INTEGRATION_ID]).map(
      (t) => t.name
    );

    for (const names of [declared, exposed]) {
      expect(names).not.toContain("runsheet_append_call_transcript");
      // Defensive: no tool whose name mentions transcript at all.
      expect(names.some((n) => /transcript/i.test(n))).toBe(false);
    }
  });

  it("does NOT include the later-phase runsheet_submit_order tool", () => {
    const declared = runsheetFuelIntakeTools.map((t) => t.name);
    const exposed = resolveToolSet(runsheetVoicePack, [RUNSHEET_INTEGRATION_ID]).map(
      (t) => t.name
    );

    expect(declared).not.toContain("runsheet_submit_order");
    expect(exposed).not.toContain("runsheet_submit_order");
  });
});
