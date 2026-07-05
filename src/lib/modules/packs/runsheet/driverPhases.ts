/**
 * Runsheet driver-exception phase machine (Driver_Agent).
 *
 * Defines the ordered call phases the Driver_Agent moves through and the events
 * that advance them. Tool gating (see `driverTools.ts` and the registry's
 * `isToolCallPermitted`) references these phase ids so that reporting/mutation
 * tools are permitted only after the driver's identity is confirmed AND an
 * active assignment is present (Req 15.5).
 *
 * Phase flow:
 *   driver_verification --(driver_verified)-----------> assignment_confirmed
 *   assignment_confirmed --(active_assignment_present)-> reporting
 *
 * Gating summary (Req 15.2, 15.5, 15.6):
 * - `driver_verification` (initial): ONLY the driver-verification tool
 *   (`runsheet_verify_driver`) and the active-assignment lookup tool
 *   (`runsheet_get_active_assignment`) are permitted (Req 15.2). Reporting tools
 *   are absent from this phase, so a reporting tool requested before the driver
 *   is verified is rejected (Req 15.6).
 * - `assignment_confirmed`: identity is confirmed; the active-assignment lookup
 *   is permitted so the agent can retrieve the assignment. Reporting tools are
 *   still absent until an active assignment is present (Req 15.5, 15.6).
 * - `reporting`: reached only once identity is confirmed AND an active
 *   assignment is present. The four reporting/mutation tools are permitted here
 *   (Req 15.1, 15.5).
 *
 * Phase ids are exported as constants so `driverTools.ts` and the pack assembly
 * module (`index.ts`) reference the same ids without drift.
 *
 * Requirements: 15.2, 15.5, 15.6
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/** Initial phase: the driver's identity is being established (Req 15.2). */
export const DRIVER_VERIFICATION_PHASE = "driver_verification";

/** Identity confirmed; the active assignment is being retrieved (Req 15.5). */
export const ASSIGNMENT_CONFIRMED_PHASE = "assignment_confirmed";

/** Identity confirmed AND active assignment present; reporting is permitted (Req 15.5). */
export const DRIVER_REPORTING_PHASE = "reporting";

/** Event advancing driver_verification → assignment_confirmed (Req 15.2, 15.5). */
export const DRIVER_VERIFIED_EVENT = "driver_verified";

/** Event advancing assignment_confirmed → reporting (Req 15.5). */
export const ACTIVE_ASSIGNMENT_PRESENT_EVENT = "active_assignment_present";

/**
 * The initial phase of the driver-exception conversation. The Driver_Agent
 * starts here; the session driver initializes call-phase state to this id.
 */
export const RUNSHEET_DRIVER_INITIAL_PHASE = DRIVER_VERIFICATION_PHASE;

/**
 * The driver-exception phase machine (Req 15.2, 15.5, 15.6). The reporting phase
 * is reachable only after BOTH the identity-confirmation transition
 * (`driver_verified`) and the active-assignment transition
 * (`active_assignment_present`), so reporting tools — permitted only in the
 * reporting phase — can never be invoked before both conditions hold.
 */
export const runsheetDriverPhases: CallPhaseDefinition[] = [
  {
    id: DRIVER_VERIFICATION_PHASE,
    transitions: [
      { event: DRIVER_VERIFIED_EVENT, to: ASSIGNMENT_CONFIRMED_PHASE },
    ],
  },
  {
    id: ASSIGNMENT_CONFIRMED_PHASE,
    transitions: [
      { event: ACTIVE_ASSIGNMENT_PRESENT_EVENT, to: DRIVER_REPORTING_PHASE },
    ],
  },
  {
    id: DRIVER_REPORTING_PHASE,
    transitions: [],
  },
];
