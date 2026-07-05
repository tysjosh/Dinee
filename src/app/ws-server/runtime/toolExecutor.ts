/**
 * Tool executor — resolves a pack tool's handler and runs it with a deadline.
 *
 * The session driver dispatches permitted tool calls through {@link executeTool}.
 * The executor maps a {@link VoiceToolDefinition.handler} key to a registered
 * implementation, applies a 5-second deadline, and normalizes the result into a
 * {@link ToolOutcome} so the driver can react uniformly:
 *
 *  - `ok`      — the handler resolved within the deadline; `result` carries its value.
 *  - `timeout` — the handler did not resolve within `timeoutMs`; the driver
 *                records `{tool, "timeout"}` and continues with the
 *                conversation-type fallback behavior (Req 6.5).
 *  - `error`   — the handler rejected (a backend failure) or no handler is
 *                registered for the key; the driver records `{tool, error}` and
 *                continues with the fallback behavior (Req 6.6).
 *
 * The executor never throws for a handler failure or timeout — every path
 * resolves to a {@link ToolOutcome} — so the driver can always continue the
 * conversation rather than tearing down the call.
 *
 * Handlers are registered in a small in-memory registry rather than imported
 * directly, so packs (extracted from the legacy `tools.ts` / `logistics-tools.ts`
 * modules) can supply their implementations without the runtime depending on any
 * specific pack.
 *
 * Requirements: 6.5, 6.6
 */

/** The normalized outcome of a single tool invocation (Req 6.5, 6.6). */
export interface ToolOutcome {
  /** `ok` on success, `error` on backend/handler failure, `timeout` at the deadline. */
  status: "ok" | "error" | "timeout";
  /** The handler's return value; present only when `status` is `ok`. */
  result?: unknown;
  /** A stable error/timeout description; present when `status` is `error` or `timeout`. */
  error?: string;
}

/**
 * Per-call context handed to every tool handler. Carries the identifiers a
 * handler needs to act on behalf of a specific call/tenant without coupling the
 * executor to any pack-specific shape.
 */
export interface ToolExecContext {
  /** Twilio call identifier for the active call. */
  callSid: string;
  /** The tenant the call resolved to. */
  tenantId: string;
  /** The active conversation type driving the session. */
  conversationType: string;
  /** The tool name being invoked, for logging/audit correlation. */
  toolName: string;
  /** Integrations enabled for the tenant, for handlers that branch on them. */
  enabledIntegrations: string[];
}

/**
 * A tool handler implementation. Receives the model-supplied arguments and the
 * per-call context, and resolves with an arbitrary result. Rejecting signals a
 * backend failure, which the executor surfaces as an `error` outcome (Req 6.6).
 */
export type ToolHandler = (
  args: unknown,
  ctx: ToolExecContext
) => Promise<unknown>;

/** The default per-invocation deadline in milliseconds (Req 6.5). */
export const DEFAULT_TOOL_TIMEOUT_MS = 5000;

/**
 * In-memory registry mapping a {@link VoiceToolDefinition.handler} key to its
 * implementation. Packs register their handlers here during initialization; the
 * executor resolves by key at dispatch time.
 */
const handlerRegistry = new Map<string, ToolHandler>();

/**
 * Registers (or replaces) the handler for `handlerKey`. Packs call this during
 * initialization to supply their tool implementations.
 */
export function registerToolHandler(
  handlerKey: string,
  handler: ToolHandler
): void {
  handlerRegistry.set(handlerKey, handler);
}

/** Returns the handler registered for `handlerKey`, or `undefined` if none. */
export function getToolHandler(handlerKey: string): ToolHandler | undefined {
  return handlerRegistry.get(handlerKey);
}

/** Removes every registered handler. Testing only. */
export function clearToolHandlers(): void {
  handlerRegistry.clear();
}

/** Normalizes a thrown value into a stable error string without leaking objects. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "tool handler failed";
}

/** A private sentinel used to detect the deadline winning the race. */
const TIMEOUT = Symbol("tool-timeout");

/**
 * Resolves the handler for `handlerKey` and runs it with a `timeoutMs` deadline.
 *
 * The handler is raced against a timer. If the timer wins the outcome is
 * `timeout` (Req 6.5); if the handler rejects, or no handler is registered for
 * the key, the outcome is `error` (Req 6.6); otherwise the outcome is `ok` with
 * the handler's result. The timer is always cleared so it never leaks past the
 * call.
 *
 * @param handlerKey The {@link VoiceToolDefinition.handler} key to resolve.
 * @param args       The model-supplied tool arguments.
 * @param ctx        Per-call context passed to the handler.
 * @param timeoutMs  The deadline in milliseconds (defaults to 5000).
 * @returns A {@link ToolOutcome}; this promise never rejects.
 */
export async function executeTool(
  handlerKey: string,
  args: unknown,
  ctx: ToolExecContext,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS
): Promise<ToolOutcome> {
  const handler = handlerRegistry.get(handlerKey);
  if (!handler) {
    return {
      status: "error",
      error: `no handler registered for "${handlerKey}"`,
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });

  try {
    // Wrap the handler call so a synchronous throw is captured as a rejection
    // rather than escaping the race.
    const invocation = Promise.resolve().then(() => handler(args, ctx));
    const winner = await Promise.race([invocation, deadline]);

    if (winner === TIMEOUT) {
      return {
        status: "timeout",
        error: `tool "${ctx.toolName}" timed out after ${timeoutMs}ms`,
      };
    }

    return { status: "ok", result: winner };
  } catch (error) {
    return { status: "error", error: toErrorMessage(error) };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
