/**
 * Logistics pack — call-phase machine (extracted from the legacy runtime).
 *
 * Re-expresses the phase machine currently living in
 * `src/app/ws-server/logistics-call-phase.ts` as VoiceDomainPack
 * {@link CallPhaseDefinition}s so the generic `phaseEngine` and the registry's
 * `isToolCallPermitted` can drive it. This is part of the GRADUAL extraction
 * (Req 1.4, 1.6): the legacy `logistics-call-phase.ts` module stays intact and
 * working until the compatibility test (task 4.4) passes and legacy removal
 * (task 4.8) runs — the definitions here mirror it exactly so behavior is
 * preserved.
 *
 * Phase flow (identical to `nextLogisticsPhase`):
 *   await_org_verification --(org_verified)------> org_verified
 *   org_verified           --(shipment_created)--> shipment_open
 *   shipment_open          --(shipment_finalized)-> shipment_confirmed (terminal)
 *
 * Tool gating per phase (identical to the legacy `ALLOWED_TOOLS` matrix) is
 * encoded on each tool's `allowedPhases` in the sibling `tools.ts` module.
 *
 * Requirements: 1.4, 1.6
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/** Caller's organization is not yet verified; only the org lookup is allowed. */
export const AWAIT_ORG_VERIFICATION_PHASE = "await_org_verification";

/** Organization verified; shipment creation and quoting become available. */
export const ORG_VERIFIED_PHASE = "org_verified";

/** A shipment is open; status updates, rider assignment, and events are allowed. */
export const SHIPMENT_OPEN_PHASE = "shipment_open";

/** Terminal phase once the shipment is confirmed; read-only tools only. */
export const SHIPMENT_CONFIRMED_PHASE = "shipment_confirmed";

/** Event advancing await_org_verification → org_verified. */
export const ORG_VERIFIED_EVENT = "org_verified";

/** Event advancing org_verified → shipment_open. */
export const SHIPMENT_CREATED_EVENT = "shipment_created";

/** Event advancing shipment_open → shipment_confirmed. */
export const SHIPMENT_FINALIZED_EVENT = "shipment_finalized";

/**
 * The initial phase of a logistics conversation. The session driver initializes
 * call-phase state to this id, matching the legacy `logisticsPhase` default of
 * `await_org_verification`.
 */
export const LOGISTICS_INITIAL_PHASE = AWAIT_ORG_VERIFICATION_PHASE;

/**
 * The logistics phase machine, mirroring the legacy `logistics-call-phase.ts`
 * transitions exactly (Req 1.4, 1.6). Mutation-capable phases (org_verified,
 * shipment_open) are reachable only after org verification completes, so
 * mutation tools are never permitted before the organization is verified.
 */
export const logisticsPhases: CallPhaseDefinition[] = [
  {
    id: AWAIT_ORG_VERIFICATION_PHASE,
    transitions: [{ event: ORG_VERIFIED_EVENT, to: ORG_VERIFIED_PHASE }],
  },
  {
    id: ORG_VERIFIED_PHASE,
    transitions: [{ event: SHIPMENT_CREATED_EVENT, to: SHIPMENT_OPEN_PHASE }],
  },
  {
    id: SHIPMENT_OPEN_PHASE,
    transitions: [
      { event: SHIPMENT_FINALIZED_EVENT, to: SHIPMENT_CONFIRMED_PHASE },
    ],
  },
  {
    id: SHIPMENT_CONFIRMED_PHASE,
    transitions: [],
    terminal: true,
  },
];
