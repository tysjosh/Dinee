/**
 * Runsheet pack — driver-exception tool handler registration and per-call seam.
 *
 * Binds each Driver_Agent {@link VoiceToolDefinition.handler} key to an
 * implementation in the tool-executor registry (`registerToolHandler`), mirroring
 * the fuel-intake `handlers.ts`. The six driver tools are wired here:
 *
 *   - `runsheet_verify_driver`         → {@link RunsheetApiClient.verifyDriver}
 *   - `runsheet_get_active_assignment` → {@link RunsheetApiClient.getActiveAssignment}
 *   - `runsheet_report_delay`          → {@link RunsheetApiClient.reportDelay}
 *   - `runsheet_report_terminal_wait`  → {@link RunsheetApiClient.reportTerminalWait}
 *   - `runsheet_report_exception`      → {@link RunsheetApiClient.reportException}
 *   - `runsheet_append_driver_note`    → {@link RunsheetApiClient.appendDriverNote}
 *
 * DEFENSE IN DEPTH (Req 15.5, 15.6): phase gating (`driverPhases.ts` +
 * `isToolCallPermitted`) already prevents a reporting tool from being invoked
 * before the reporting phase, which is reachable only after identity is confirmed
 * AND an active assignment is present. The reporting handlers ALSO re-check the
 * bound session's verification state so no reporting/mutation call reaches the
 * backend unless both conditions hold, guarding against any state drift.
 *
 * DRIVER-IDENTIFIER FALLBACK (Req 15.3): `runsheet_verify_driver` verifies by the
 * caller's phone number first. When the phone does not match a known driver, the
 * handler reports `needsDriverIdentifier` and does NOT confirm identity, so the
 * `runsheet_get_active_assignment` handler refuses the lookup until the agent
 * re-verifies with an explicit driver identifier.
 *
 * SENSITIVE-ACTION PIN GATING (Req 15.4): a driver action configured as sensitive
 * (the bound session's `sensitiveActions` set) requires a verified driver PIN
 * before the backend is called. When the PIN is not yet verified the handler
 * reports `requiresPin` and performs no mutation; the agent submits the PIN via
 * `runsheet_verify_driver` (permitted in the reporting phase) and retries.
 *
 * PER-CALL RUNTIME SEAM: handlers are registered once globally but act on behalf
 * of a specific in-progress call. Per-call materials — the read/report client,
 * the caller phone, the effective sensitive-action set, and the mutable
 * verification state — are bound by the runtime via {@link bindDriverCallSession}
 * when a driver call starts and released via {@link releaseDriverCallSession} at
 * call end. Handlers resolve the session by `callSid`; tests may inject a
 * resolver directly.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import {
  registerToolHandler,
  type ToolExecContext,
  type ToolHandler,
} from "@/app/ws-server/runtime/toolExecutor";
import type {
  DriverReportInput,
  DriverReportResult,
  RunsheetApiClient,
} from "@/lib/integrations/runsheet/apiClient";
import {
  ACTIVE_ASSIGNMENT_PRESENT_EVENT,
  DRIVER_VERIFIED_EVENT,
} from "@/lib/modules/packs/runsheet/driverPhases";
import { RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS } from "@/lib/modules/packs/runsheet/driverTools";

// ============================================================================
// Per-call runtime seam
// ============================================================================

/** Static, per-call driver configuration bound by the runtime. */
export interface DriverSessionConfig {
  /** The calling party phone number, used for the phone-match verification (Req 15.2). */
  callerPhone: string;
  /** Tool names configured as sensitive; each requires a verified PIN (Req 15.4). */
  sensitiveActions: ReadonlySet<string>;
}

/**
 * Mutable per-call verification state. The verification and lookup handlers
 * populate it; the reporting handlers read it to enforce that a report only
 * reaches the backend once identity is confirmed AND an active assignment is
 * present (Req 15.5), and once any required PIN is verified (Req 15.4).
 */
export interface DriverVerificationState {
  /** The confirmed driver identifier, set once verification succeeds. */
  driverId?: string;
  /** True once the driver's identity is confirmed (Req 15.2, 15.5). */
  verified: boolean;
  /** True once a valid driver PIN has been confirmed (Req 15.4). */
  pinVerified: boolean;
  /** The present active-assignment id, set once a lookup finds one (Req 15.5). */
  activeAssignmentId?: string;
}

/**
 * Per-call materials the runtime binds so the globally-registered driver
 * handlers can act on behalf of one in-progress call without the executor
 * coupling to any pack-specific shape.
 */
export interface DriverCallSession {
  /** Read/report client scoped to this call's Runsheet tenant. */
  apiClient: RunsheetApiClient;
  /** Static per-call driver configuration. */
  config: DriverSessionConfig;
  /** Mutable verification state advanced by the driver handlers. */
  state: DriverVerificationState;
}

/** Resolves the bound {@link DriverCallSession} for a tool-exec context. */
export type DriverSessionResolver = (
  ctx: ToolExecContext
) => DriverCallSession | Promise<DriverCallSession>;

/** Module-level registry of bound driver call sessions, keyed by `callSid`. */
const driverSessions = new Map<string, DriverCallSession>();

/**
 * Creates a fresh, unverified {@link DriverVerificationState}. Convenience for
 * the runtime when binding a new driver call session.
 */
export function newDriverVerificationState(): DriverVerificationState {
  return { verified: false, pinVerified: false };
}

/**
 * Binds per-call materials for a driver call so the registered handlers can
 * serve it. Call when a `runsheet_driver_exception` conversation starts.
 * Replaces any existing binding for the same `callSid`.
 */
export function bindDriverCallSession(
  callSid: string,
  session: DriverCallSession
): void {
  driverSessions.set(callSid, session);
}

/** Releases the bound driver call session at call end so no state outlives the call. */
export function releaseDriverCallSession(callSid: string): void {
  driverSessions.delete(callSid);
}

/** Returns the bound driver call session for `callSid`, or `undefined` if none. */
export function getDriverCallSession(
  callSid: string
): DriverCallSession | undefined {
  return driverSessions.get(callSid);
}

/** Clears every bound driver call session. Testing only. */
export function clearDriverCallSessions(): void {
  driverSessions.clear();
}

/** Default resolver: looks the session up in the module-level registry. */
const defaultResolveDriverSession: DriverSessionResolver = (ctx) => {
  const session = driverSessions.get(ctx.callSid);
  if (!session) {
    throw new Error(
      `no runsheet driver call session bound for callSid "${ctx.callSid}"`
    );
  }
  return session;
};

// ============================================================================
// Tool argument shapes (mirror the driver tool schemas in driverTools.ts)
// ============================================================================

/** Arguments for `runsheet_verify_driver`. */
interface VerifyDriverArgs {
  driverIdentifier?: string;
  pin?: string;
}

/** Arguments common to the driver reporting/mutation tools. */
interface DriverReportArgs {
  detail?: string;
  etaMinutes?: number;
}

// ============================================================================
// Handlers
// ============================================================================

const makeVerifyDriverHandler =
  (resolveSession: DriverSessionResolver): ToolHandler =>
  async (args: unknown, ctx: ToolExecContext) => {
    const { driverIdentifier, pin } = args as VerifyDriverArgs;
    const session = await resolveSession(ctx);

    const result = await session.apiClient.verifyDriver({
      phone: session.config.callerPhone,
      driverIdentifier,
      pin,
    });

    if (result.kind === "unverified") {
      // Caller phone did not match (and no matching identifier supplied): the
      // agent must request a driver identifier before an active-assignment
      // lookup (Req 15.3). Identity remains unconfirmed; no phase advance.
      session.state.verified = false;
      return { verified: false, needsDriverIdentifier: true };
    }

    session.state.driverId = result.driver.id;
    session.state.verified = true;
    // A PIN submitted with this verification confirms it for sensitive actions
    // (Req 15.4). Preserve a prior confirmation across re-verification.
    session.state.pinVerified = session.state.pinVerified || result.pinVerified;

    // Advance driver_verification → assignment_confirmed on first confirmation
    // (Req 15.2, 15.5). Re-verifying later (e.g. to submit a PIN) emits the same
    // event, which is a no-op once past the verification phase.
    return {
      verified: true,
      driverId: result.driver.id,
      driverName: result.driver.name,
      pinVerified: session.state.pinVerified,
      phaseEvent: DRIVER_VERIFIED_EVENT,
    };
  };

const makeGetActiveAssignmentHandler =
  (resolveSession: DriverSessionResolver): ToolHandler =>
  async (_args: unknown, ctx: ToolExecContext) => {
    const session = await resolveSession(ctx);

    // The lookup is refused until identity is confirmed, so a caller whose phone
    // did not match must first re-verify with a driver identifier (Req 15.3).
    if (!session.state.verified || !session.state.driverId) {
      return { assignment: null, needsDriverIdentifier: true };
    }

    const assignment = await session.apiClient.getActiveAssignment(
      session.state.driverId
    );

    if (!assignment) {
      session.state.activeAssignmentId = undefined;
      return { assignment: null, activeAssignmentPresent: false };
    }

    // An active assignment is present: record it and advance
    // assignment_confirmed → reporting so reporting tools become permitted
    // (Req 15.5).
    session.state.activeAssignmentId = assignment.id;
    return {
      assignment,
      activeAssignmentPresent: true,
      phaseEvent: ACTIVE_ASSIGNMENT_PRESENT_EVENT,
    };
  };

/**
 * Builds a reporting/mutation handler. Enforces, as defense in depth beyond
 * phase gating, that identity is confirmed AND an active assignment is present
 * (Req 15.5), then the sensitive-action PIN gate (Req 15.4), before delegating
 * to the client method.
 */
const makeReportHandler =
  (
    resolveSession: DriverSessionResolver,
    toolName: string,
    invoke: (
      client: RunsheetApiClient,
      input: DriverReportInput
    ) => Promise<DriverReportResult>
  ): ToolHandler =>
  async (args: unknown, ctx: ToolExecContext) => {
    const session = await resolveSession(ctx);
    const { detail, etaMinutes } = args as DriverReportArgs;

    // Req 15.5 / 15.6 (defense in depth): never report without a confirmed
    // identity and a present active assignment.
    if (
      !session.state.verified ||
      !session.state.driverId ||
      !session.state.activeAssignmentId
    ) {
      return { recorded: false, error: "driver_not_ready" };
    }

    // Req 15.4: a configured-sensitive action requires a verified PIN first.
    if (
      session.config.sensitiveActions.has(toolName) &&
      !session.state.pinVerified
    ) {
      return { recorded: false, requiresPin: true };
    }

    const result = await invoke(session.apiClient, {
      driverId: session.state.driverId,
      assignmentId: session.state.activeAssignmentId,
      detail,
      etaMinutes,
    });
    return { recorded: result.recorded, reportId: result.reportId };
  };

/**
 * Registers every Runsheet driver-exception tool handler with the tool-executor
 * registry. Safe to call more than once — `registerToolHandler` replaces any
 * existing entry for a key, so repeated registration is idempotent.
 *
 * @param resolveSession Resolver for the per-call {@link DriverCallSession}.
 *   Defaults to the module-level registry populated by
 *   {@link bindDriverCallSession}; tests may inject a resolver directly.
 */
export function registerRunsheetDriverHandlers(
  resolveSession: DriverSessionResolver = defaultResolveDriverSession
): void {
  registerToolHandler(
    "runsheet_verify_driver",
    makeVerifyDriverHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_get_active_assignment",
    makeGetActiveAssignmentHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_report_delay",
    makeReportHandler(resolveSession, "runsheet_report_delay", (client, input) =>
      client.reportDelay(input)
    )
  );
  registerToolHandler(
    "runsheet_report_terminal_wait",
    makeReportHandler(
      resolveSession,
      "runsheet_report_terminal_wait",
      (client, input) => client.reportTerminalWait(input)
    )
  );
  registerToolHandler(
    "runsheet_report_exception",
    makeReportHandler(
      resolveSession,
      "runsheet_report_exception",
      (client, input) => client.reportException(input)
    )
  );
  registerToolHandler(
    "runsheet_append_driver_note",
    makeReportHandler(
      resolveSession,
      "runsheet_append_driver_note",
      (client, input) => client.appendDriverNote(input)
    )
  );
}

/** The default sensitive-action set, re-exported for runtime binding convenience. */
export { RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS };
