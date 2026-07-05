/**
 * Runsheet VoiceDomainPack — assembly and registration.
 *
 * Assembles the Runsheet conversation types, fuel-intake tools, phase machine,
 * prompt, and integration requirement into a {@link VoiceDomainPack} and
 * registers it with the VoiceDomainPack_Registry during platform initialization
 * (Req 4.2). A validation failure is returned as a {@link RegisterResult} so the
 * caller can surface it per Req 4.3 rather than failing silently.
 *
 * The pack carries a {@link ModulePackBridge} that REUSES the existing logistics
 * `VerticalPack` / tool-pack registration (registered under the `logistics`
 * vertical key in `src/lib/modules/toolPackRegistry.ts`) rather than duplicating
 * a parallel registry (Req 2.8, 2.9). Runsheet is a fuel-and-logistics dispatch
 * product, so it bridges the logistics vertical in `extend` mode. The Runsheet
 * fuel-intake tools have no counterpart in the logistics tool pack (none set
 * `reusesModuleTool`), so `extend` mode layers all six fuel-intake tools on top
 * of the (empty) reused set as voice-only tools — the bridge reuses the
 * logistics registration for module-level gating consistency without altering
 * the resolved fuel-intake tool set.
 *
 * PHASE RECONCILIATION (design §"VoiceDomainPack Registry", validation step 5):
 * the registry validates that every `conversationType.initialPhase` is a defined
 * phase in the pack's `phases`. The four conversation types declare four initial
 * phases — `customer_identification` (fuel intake), `status_lookup`,
 * `driver_verification`, and `callback_identification`. `phases.ts` defines the
 * fuel-intake machine (`customer_identification`, `order_building`,
 * `order_finalized`) and `driverPhases.ts` defines the driver-exception machine
 * (`driver_verification`, `assignment_confirmed`, `reporting`). The remaining
 * two conversation types — the read-only status agent and the later-phase
 * callback agent — contribute minimal placeholder phases so all four
 * conversation types (Req 4.1) pass registry validation. The callback
 * placeholder will be replaced when that agent is built.
 *
 * OWNERSHIP BOUNDARY: this module registers only Dinee-side voice configuration.
 * It produces no order-of-record data; the Runsheet backend owns operational
 * truth (Req 10.7, 10.8, 20.2, 20.3).
 *
 * Requirements: 2.8, 2.9, 4.2, 4.3
 */

import type {
  CallPhaseDefinition,
  ModulePackBridge,
  VoiceDomainPack,
} from "@/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  type RegisterResult,
} from "@/lib/modules/voiceDomainPackRegistry";
import { hasToolPack } from "@/lib/modules/toolPackRegistry";
import { registerLogisticsPack } from "@/lib/modules/packs/logisticsPack";
import { runsheetConversationTypes } from "@/lib/modules/packs/runsheet/conversationTypes";
import {
  runsheetFuelIntakeTools,
  runsheetSubmitOrder,
  RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID,
} from "@/lib/modules/packs/runsheet/tools";
import {
  runsheetStatusTools,
  STATUS_LOOKUP_PHASE,
} from "@/lib/modules/packs/runsheet/statusTools";
import { runsheetDriverTools } from "@/lib/modules/packs/runsheet/driverTools";
import { runsheetFuelIntakePhases } from "@/lib/modules/packs/runsheet/phases";
import { runsheetDriverPhases } from "@/lib/modules/packs/runsheet/driverPhases";
import { RUNSHEET_DEFAULT_PROMPT } from "@/lib/modules/packs/runsheet/prompts";
import { registerRunsheetHandlers } from "@/lib/modules/packs/runsheet/handlers";
import { registerRunsheetDriverHandlers } from "@/lib/modules/packs/runsheet/driverHandlers";

/** Unique id of the Runsheet VoiceDomainPack (Req 2.2, 4.2). */
export const RUNSHEET_PACK_ID = "runsheet";

/** Integration id the Runsheet pack requires to operate (Req 4.4). */
export const RUNSHEET_INTEGRATION_ID = "runsheet";

/**
 * The tool-pack registry key the logistics `VerticalPack` registers under (its
 * `vertical`). The bridge's vertical reference and reused tool-pack reference
 * both use this key. Runsheet reuses this existing registration rather than
 * standing up a parallel one (Req 2.9).
 */
const LOGISTICS_VERTICAL_KEY = "logistics";

/**
 * Placeholder initial phases for the conversation types whose full phase
 * machines are not yet defined (`runsheet_order_status`,
 * `runsheet_dispatch_callback`). Declaring them lets those conversation types
 * (Req 4.1) pass the registry's `initialPhase ∈ phases` validation. They carry
 * no transitions and are not terminal; the later-phase callback agent will
 * replace `callback_identification`. The status agent's `status_lookup` phase is
 * read-only, so it legitimately needs no transitions. The driver-exception
 * conversation type now has a full phase machine (`driverPhases.ts`), so its
 * `driver_verification` placeholder is no longer declared here.
 */
const runsheetPlaceholderPhases: CallPhaseDefinition[] = [
  { id: STATUS_LOOKUP_PHASE, transitions: [] },
  { id: "callback_identification", transitions: [] },
];

/**
 * The complete phase set for the Runsheet pack: the fuel-intake machine, the
 * driver-exception machine (`driver_verification` → `assignment_confirmed` →
 * `reporting`, Req 15.2/15.5), plus the placeholder initial phases for the
 * remaining non-MVP conversation types. Within the registry's 1–20 phase bound
 * (Req 2.1) — currently eight phases.
 */
export const runsheetPhases: CallPhaseDefinition[] = [
  ...runsheetFuelIntakePhases,
  ...runsheetDriverPhases,
  ...runsheetPlaceholderPhases,
];

/**
 * Bridge to the existing logistics Module_Pack_System registration (Req 2.8,
 * 2.9). `extend` mode reuses the linked logistics tool-pack registration for
 * module-level gating consistency and layers the voice-only fuel-intake tools on
 * top (they set no `reusesModuleTool`, so the resolved fuel-intake tool set is
 * exactly the six MVP tools).
 */
const runsheetModuleBridge: ModulePackBridge = {
  verticalPackId: LOGISTICS_VERTICAL_KEY,
  reuseToolPackIds: [LOGISTICS_VERTICAL_KEY],
  mode: "extend",
};

/**
 * The assembled Runsheet VoiceDomainPack.
 *
 * `tools` carries the six review-only MVP fuel-intake tools, the four read-only
 * Status_Agent tools for the `runsheet_order_status` conversation (Req 14.1),
 * PLUS the later-phase `runsheet_submit_order` Auto_Submit tool (Req 13.5).
 *
 * Tool exposure is scoped by phase rather than only by pack membership: the
 * status tools are permitted only in the `status_lookup` phase and the
 * fuel-intake tools only in the fuel phases, so the two conversation types stay
 * disjoint even though both tool sets are declared on the one pack.
 * `runsheet_submit_order` requires the distinct `runsheet_auto_submit`
 * integration, so `resolveToolSet` exposes it only for tenants that have
 * Auto_Submit enabled; a tenant with only the base `runsheet` integration
 * resolves the fuel-intake and status tools but never `runsheet_submit_order`,
 * preserving the review-only invariant (Req 6.2, 13.5).
 */
export const runsheetVoicePack: VoiceDomainPack = {
  id: RUNSHEET_PACK_ID,
  name: "Runsheet",
  description:
    "Voice agent for a fuel and logistics dispatch product: phone-based fuel order intake with dispatcher review, bridged to the existing logistics module pack.",
  conversationTypes: [...runsheetConversationTypes],
  tools: [
    ...runsheetFuelIntakeTools,
    ...runsheetStatusTools,
    ...runsheetDriverTools,
    runsheetSubmitOrder,
  ],
  phases: runsheetPhases,
  defaultPrompt: RUNSHEET_DEFAULT_PROMPT,
  escalationRules: [],
  integrations: [
    { id: RUNSHEET_INTEGRATION_ID, required: true },
    // Auto_Submit is optional: its tool is gated behind this integration id so
    // it is resolved only when a tenant enables the later-phase feature (Req 13.5).
    { id: RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID, required: false },
  ],
  moduleBridge: runsheetModuleBridge,
};

/**
 * Registers the Runsheet VoiceDomainPack with the VoiceDomainPack_Registry
 * (Req 4.2).
 *
 * Ensures the bridged logistics tool-pack registration exists first (so the
 * `moduleBridge` reference resolves and is not rejected as
 * `unknown_module_bridge`), then registers the voice pack. Returns the
 * {@link RegisterResult} so the caller can surface a validation failure per
 * Req 4.3; on failure the registry is left unchanged (Req 2.3, 2.4, 4.3).
 */
export function registerRunsheetVoicePack(): RegisterResult {
  // The bridge reuses the logistics tool-pack registration; make sure it is
  // present before registering the voice pack so the bridge reference resolves
  // (Req 2.9). Reuse, don't duplicate.
  if (!hasToolPack(LOGISTICS_VERTICAL_KEY)) {
    registerLogisticsPack();
  }
  // Wire the six fuel-intake tool handlers into the runtime tool executor. The
  // dispatch-review handler submits the transient draft over the signed
  // Intake_Contract carrying the full confirmed transcript content (Req 6.8,
  // 10.9, 18.2); per-call materials are bound by the runtime via
  // `bindRunsheetCallSession` (see `handlers.ts`).
  registerRunsheetHandlers();
  // Wire the six driver-exception tool handlers (Req 15.1). Reporting/mutation
  // handlers enforce identity + active-assignment (Req 15.5) and sensitive-action
  // PIN gating (Req 15.4) as defense in depth; per-call materials are bound by
  // the runtime via `bindDriverCallSession` (see `driverHandlers.ts`).
  registerRunsheetDriverHandlers();
  return registerVoiceDomainPack(runsheetVoicePack);
}
