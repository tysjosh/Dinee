/**
 * Restaurant inbound-order phase machine.
 *
 * Re-expresses the legacy `src/app/ws-server/call-phase.ts` state machine
 * against the {@link CallPhaseDefinition} contract (Req 1.4, 1.6). The phase
 * ids, transitions, and per-phase tool permissions mirror the legacy module
 * exactly so the restaurant compatibility test (task 4.2) can assert behavioral
 * equivalence against the Phase 0 baseline before legacy removal (task 4.8).
 *
 * Legacy phase flow (preserved verbatim):
 *   await_restaurant_id --(restaurant_verified)--> restaurant_verified
 *   restaurant_verified --(order_id_generated)---> order_open
 *   order_open          --(order_finalized)------> order_finalized (terminal)
 *
 * Per-phase tool permissions (mirrored onto each tool's `allowedPhases` in
 * `tools.ts`, enforced by the registry's `isToolCallPermitted`):
 * - await_restaurant_id (initial): get_restaurant_details
 * - restaurant_verified:           upsert_call_data, add_transcript_dialogue, generate_order_id
 * - order_open:                    upsert_order, add_transcript_dialogue, generate_order_id
 * - order_finalized (terminal):    add_transcript_dialogue
 *
 * Requirements: 1.4, 1.6
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/** Initial phase: awaiting the caller's restaurant id (legacy `await_restaurant_id`). */
export const AWAIT_RESTAURANT_ID_PHASE = "await_restaurant_id";

/** Phase reached once the restaurant id is fetched and verified. */
export const RESTAURANT_VERIFIED_PHASE = "restaurant_verified";

/** Phase in which an order is being built (an order id has been generated). */
export const ORDER_OPEN_PHASE = "order_open";

/** Terminal phase reached once the order is finalized (legacy `order_finalized`). */
export const ORDER_FINALIZED_PHASE = "order_finalized";

/** Event that advances await_restaurant_id → restaurant_verified. */
export const RESTAURANT_VERIFIED_EVENT = "restaurant_verified";

/** Event that advances restaurant_verified → order_open. */
export const ORDER_ID_GENERATED_EVENT = "order_id_generated";

/** Event that advances order_open → order_finalized. */
export const ORDER_FINALIZED_EVENT = "order_finalized";

/** The phase the inbound-order conversation starts in. */
export const RESTAURANT_INBOUND_INITIAL_PHASE = AWAIT_RESTAURANT_ID_PHASE;

/**
 * The restaurant inbound-order phase machine, mirroring legacy `call-phase.ts`
 * transitions. A `nextPhase(phases, current, event)` call on the generic
 * `phaseEngine` reproduces the legacy `nextPhase(current, event)` behavior:
 * only the declared transitions advance the phase; any other event leaves the
 * phase unchanged.
 *
 * Requirements: 1.4, 1.6
 */
export const restaurantInboundPhases: CallPhaseDefinition[] = [
  {
    id: AWAIT_RESTAURANT_ID_PHASE,
    transitions: [
      { event: RESTAURANT_VERIFIED_EVENT, to: RESTAURANT_VERIFIED_PHASE },
    ],
  },
  {
    id: RESTAURANT_VERIFIED_PHASE,
    transitions: [{ event: ORDER_ID_GENERATED_EVENT, to: ORDER_OPEN_PHASE }],
  },
  {
    id: ORDER_OPEN_PHASE,
    transitions: [{ event: ORDER_FINALIZED_EVENT, to: ORDER_FINALIZED_PHASE }],
  },
  {
    id: ORDER_FINALIZED_PHASE,
    transitions: [],
    terminal: true,
  },
];
