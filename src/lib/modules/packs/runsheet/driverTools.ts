/**
 * Runsheet Pack — driver-exception tool definitions (Driver_Agent).
 *
 * Declares EXACTLY the six tools the `runsheet_driver_exception` conversation
 * type owns (Req 15.1):
 *   - runsheet_verify_driver           (driver-verification)
 *   - runsheet_get_active_assignment   (active-assignment lookup)
 *   - runsheet_report_delay            (mutation)
 *   - runsheet_report_terminal_wait    (mutation)
 *   - runsheet_report_exception        (mutation, sensitive by default)
 *   - runsheet_append_driver_note      (mutation, sensitive by default)
 *
 * Every tool declares `requiresIntegration: "runsheet"` so it is excluded from
 * the resolved tool set when the tenant's Runsheet_Integration is disabled or
 * absent (Req 4.4).
 *
 * Phase gating (Req 15.2, 15.5, 15.6), enforced by the registry's
 * `isToolCallPermitted` against each tool's `allowedPhases`:
 * - `driver_verification` (initial): ONLY `runsheet_verify_driver` and
 *   `runsheet_get_active_assignment` are permitted (Req 15.2).
 * - `assignment_confirmed`: verification (to submit a PIN) and the
 *   active-assignment lookup remain permitted.
 * - `reporting`: the four reporting/mutation tools are permitted — reached only
 *   after identity is confirmed AND an active assignment is present (Req 15.5).
 *
 * Sensitive-action PIN gating (Req 15.4): a driver action listed in
 * {@link RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS} requires a verified driver
 * PIN before the backend is called. Sensitivity is a runtime configuration (the
 * bound driver call session carries the effective set), so the PIN check lives
 * in the handler layer (`driverHandlers.ts`); `runsheet_verify_driver` is
 * permitted in the reporting phase so the agent can submit the PIN when a
 * sensitive action is attempted.
 *
 * Phase ids are imported from the sibling `driverPhases.ts` so this module and
 * the phase machine never drift.
 *
 * Requirements: 15.1, 15.2, 15.4, 15.5, 15.6
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";
import {
  ASSIGNMENT_CONFIRMED_PHASE,
  DRIVER_REPORTING_PHASE,
  DRIVER_VERIFICATION_PHASE,
} from "@/lib/modules/packs/runsheet/driverPhases";

/** Integration id every Runsheet driver tool requires to be exposed (Req 4.4). */
const RUNSHEET_INTEGRATION_ID = "runsheet";

/**
 * Verify the calling driver's identity by caller phone number or an explicit
 * driver identifier, optionally submitting a driver PIN for sensitive actions
 * (Req 15.2, 15.3, 15.4). Permitted throughout the flow so the agent can submit
 * a PIN when a sensitive reporting action is attempted; the verification handler
 * advances the phase only when identity is first confirmed.
 */
export const runsheetVerifyDriver: VoiceToolDefinition = {
  name: "runsheet_verify_driver",
  description:
    "Verify the calling driver's identity. The caller's phone number is checked automatically; if it does not match a known driver, ask the driver for their driver identifier and pass it as driverIdentifier. When a sensitive action requires it, ask the driver for their PIN and pass it as pin.",
  parameters: {
    type: "object",
    properties: {
      driverIdentifier: {
        type: "string",
        description:
          "The driver's identifier, required only when the caller phone number does not match a known driver.",
      },
      pin: {
        type: "string",
        description:
          "The driver's PIN, provided when a sensitive action requires PIN confirmation before it can be performed.",
      },
    },
    required: [],
  },
  allowedPhases: [
    DRIVER_VERIFICATION_PHASE,
    ASSIGNMENT_CONFIRMED_PHASE,
    DRIVER_REPORTING_PHASE,
  ],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_verify_driver",
};

/**
 * Look up the verified driver's current active assignment (Req 15.5). Permitted
 * in the driver-verification and assignment-confirmed phases (Req 15.2). The
 * handler refuses the lookup until the driver's identity is confirmed, so a
 * caller whose phone did not match must first supply a driver identifier
 * (Req 15.3).
 */
export const runsheetGetActiveAssignment: VoiceToolDefinition = {
  name: "runsheet_get_active_assignment",
  description:
    "Look up the driver's current active assignment so delays and exceptions can be reported against it. Only call this after the driver's identity has been confirmed.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  allowedPhases: [DRIVER_VERIFICATION_PHASE, ASSIGNMENT_CONFIRMED_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_get_active_assignment",
};

/**
 * Report a delay on the driver's active assignment (Req 15.1). Mutation;
 * permitted only in the reporting phase, reached after identity confirmation and
 * an active-assignment lookup (Req 15.5).
 */
export const runsheetReportDelay: VoiceToolDefinition = {
  name: "runsheet_report_delay",
  description:
    "Report a delay on the driver's active assignment so dispatch is updated. Provide the reason for the delay and, when known, the estimated additional minutes.",
  parameters: {
    type: "object",
    properties: {
      detail: {
        type: "string",
        description: "The reason for the delay.",
      },
      etaMinutes: {
        type: "number",
        description: "Estimated additional minutes of delay, when known.",
      },
    },
    required: ["detail"],
  },
  allowedPhases: [DRIVER_REPORTING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_report_delay",
};

/**
 * Report a terminal wait on the driver's active assignment (Req 15.1). Mutation;
 * permitted only in the reporting phase (Req 15.5).
 */
export const runsheetReportTerminalWait: VoiceToolDefinition = {
  name: "runsheet_report_terminal_wait",
  description:
    "Report that the driver is waiting at a terminal so dispatch is updated. Provide the terminal name or wait reason and, when known, the estimated additional minutes.",
  parameters: {
    type: "object",
    properties: {
      detail: {
        type: "string",
        description: "The terminal name or the reason for the wait.",
      },
      etaMinutes: {
        type: "number",
        description: "Estimated additional minutes of wait, when known.",
      },
    },
    required: ["detail"],
  },
  allowedPhases: [DRIVER_REPORTING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_report_terminal_wait",
};

/**
 * Report an exception on the driver's active assignment (Req 15.1). Mutation;
 * permitted only in the reporting phase (Req 15.5). Sensitive by default
 * (Req 15.4): requires a verified driver PIN before it is performed.
 */
export const runsheetReportException: VoiceToolDefinition = {
  name: "runsheet_report_exception",
  description:
    "Report an exception on the driver's active assignment (for example a breakdown, refused delivery, or safety issue) so dispatch can respond. Describe the exception. This is a sensitive action and requires the driver's PIN.",
  parameters: {
    type: "object",
    properties: {
      detail: {
        type: "string",
        description: "A description of the exception.",
      },
    },
    required: ["detail"],
  },
  allowedPhases: [DRIVER_REPORTING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_report_exception",
};

/**
 * Append a free-form note to the driver's active assignment (Req 15.1).
 * Mutation; permitted only in the reporting phase (Req 15.5). Sensitive by
 * default (Req 15.4): requires a verified driver PIN before it is performed.
 */
export const runsheetAppendDriverNote: VoiceToolDefinition = {
  name: "runsheet_append_driver_note",
  description:
    "Append a note from the driver to their active assignment. This is a sensitive action and requires the driver's PIN.",
  parameters: {
    type: "object",
    properties: {
      detail: {
        type: "string",
        description: "The note to append to the assignment.",
      },
    },
    required: ["detail"],
  },
  allowedPhases: [DRIVER_REPORTING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_append_driver_note",
};

/**
 * The complete driver-exception tool set — EXACTLY the six tools required by
 * Req 15.1, in phase order (verification → assignment lookup → reporting).
 */
export const runsheetDriverTools: readonly VoiceToolDefinition[] = [
  runsheetVerifyDriver,
  runsheetGetActiveAssignment,
  runsheetReportDelay,
  runsheetReportTerminalWait,
  runsheetReportException,
  runsheetAppendDriverNote,
];

/**
 * The driver actions treated as sensitive by default (Req 15.4). A sensitive
 * action requires a verified driver PIN before the backend is called. This is a
 * default; the runtime binds the effective set on the driver call session, so a
 * tenant may configure it. Reporting an exception and appending a free-form note
 * mutate the assignment record with driver-authored content, so they are
 * sensitive; routine delay / terminal-wait status updates are not.
 */
export const RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS: ReadonlySet<string> =
  new Set(["runsheet_report_exception", "runsheet_append_driver_note"]);
