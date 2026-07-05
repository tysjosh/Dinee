/**
 * Runsheet fuel-intake phase machine.
 *
 * Defines the ordered call phases the Fuel_Intake_Agent moves through and the
 * events that advance them. Tool gating (see `tools.ts` and the registry's
 * `isToolCallPermitted`) references these phase ids to enforce that mutations
 * happen only after the caller and order context are established.
 *
 * Phase flow:
 *   customer_identification --(customer_identified)--> order_building
 *   order_building          --(draft_created)-------> order_finalized (terminal)
 *
 * Gating summary (Req 7.1–7.4):
 * - `customer_identification` (initial): only the read-only customer lookup and
 *   site/tank listing tools are permitted; mutation tools are absent here so any
 *   mutation attempted before customer identification completes is rejected.
 * - `order_building`: the product validation and order-draft creation tools are
 *   permitted.
 * - `order_finalized` (terminal): only the dispatch-review queueing tool is
 *   permitted.
 *
 * Requirements: 7.1, 7.2, 7.3
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/** The phase in which the caller and their account are established (initial phase). */
export const CUSTOMER_IDENTIFICATION_PHASE = "customer_identification";

/** The phase in which order details are collected and the draft is built. */
export const ORDER_BUILDING_PHASE = "order_building";

/** The terminal phase reached once the Order_Draft is finalized. */
export const ORDER_FINALIZED_PHASE = "order_finalized";

/** Event that advances customer_identification → order_building (Req 7.1, 7.2). */
export const CUSTOMER_IDENTIFIED_EVENT = "customer_identified";

/** Event that advances order_building → order_finalized (Req 7.2, 7.3). */
export const DRAFT_CREATED_EVENT = "draft_created";

/**
 * The initial phase of the fuel-intake conversation. The Fuel_Intake_Agent
 * starts here; the session driver initializes call-phase state to this id.
 */
export const RUNSHEET_FUEL_INTAKE_INITIAL_PHASE = CUSTOMER_IDENTIFICATION_PHASE;

/**
 * The fuel-intake phase machine (Req 7.1–7.3). Mutation phases (order_building,
 * order_finalized) exclude the customer-identification phase so mutation tools
 * are never permitted before the customer is identified.
 */
export const runsheetFuelIntakePhases: CallPhaseDefinition[] = [
  {
    id: CUSTOMER_IDENTIFICATION_PHASE,
    transitions: [
      { event: CUSTOMER_IDENTIFIED_EVENT, to: ORDER_BUILDING_PHASE },
    ],
  },
  {
    id: ORDER_BUILDING_PHASE,
    transitions: [{ event: DRAFT_CREATED_EVENT, to: ORDER_FINALIZED_PHASE }],
  },
  {
    id: ORDER_FINALIZED_PHASE,
    transitions: [],
    terminal: true,
  },
];
