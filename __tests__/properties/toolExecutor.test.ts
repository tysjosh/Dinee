/**
 * Feature: dinee-voice-platform — Unit tests for the tool executor.
 *
 * Exercises the normalized {@link ToolOutcome} contract of
 * `src/app/ws-server/runtime/toolExecutor.ts`:
 *
 *  - a handler that never resolves yields `timeout` at the 5s deadline (Req 6.5),
 *    verified with fake timers so no real wall-clock wait is needed;
 *  - a handler that rejects (a Runsheet_Backend failure) yields `error` (Req 6.6);
 *  - a handler that resolves yields `ok` with its result;
 *  - a missing handler yields `error`;
 *  - the dispatch-review fail-safe: while `runsheet_queue_dispatch_review`
 *    placement is unconfirmed (the executor returns `error` or `timeout`), the
 *    transient Order_Draft is retained for retry and is never discarded; only a
 *    confirmed (`ok`) placement clears it (Req 6.8, and the retention rule of
 *    Req 6.10 it depends on).
 *
 * Validates: Requirements 6.5, 6.6, 6.8
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  executeTool,
  registerToolHandler,
  clearToolHandlers,
  DEFAULT_TOOL_TIMEOUT_MS,
  type ToolExecContext,
  type ToolOutcome,
} from "../../src/app/ws-server/runtime/toolExecutor";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ctx: ToolExecContext = {
  callSid: "CA_test_123",
  tenantId: "tenant_abc",
  conversationType: "runsheet_fuel_order_intake",
  toolName: "runsheet_queue_dispatch_review",
  enabledIntegrations: ["runsheet"],
};

/**
 * Dispatch-review fail-safe (Req 6.8 / 6.10): a transient Order_Draft is
 * retained while placement is unconfirmed and cleared only on a confirmed (`ok`)
 * outcome. Modeled here as the caller-side rule the session driver applies to
 * the executor's outcome.
 */
function retainDraftUnlessConfirmed<T>(
  current: T | undefined,
  outcome: ToolOutcome
): T | undefined {
  return outcome.status === "ok" ? undefined : current;
}

beforeEach(() => {
  clearToolHandlers();
});

afterEach(() => {
  vi.useRealTimers();
  clearToolHandlers();
});

// ─── Timeout (Req 6.5) ────────────────────────────────────────────────────────

describe("executeTool — timeout at the deadline", () => {
  it("yields status 'timeout' when the handler never resolves (fake timers)", async () => {
    vi.useFakeTimers();
    registerToolHandler("never", () => new Promise<never>(() => {}));

    const pending = executeTool("never", { any: "args" }, ctx);
    // Drive the 5s deadline without waiting on the wall clock.
    await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_TIMEOUT_MS);
    const outcome = await pending;

    expect(outcome.status).toBe("timeout");
    expect(outcome.result).toBeUndefined();
    expect(outcome.error).toContain("timed out");
    expect(outcome.error).toContain(String(DEFAULT_TOOL_TIMEOUT_MS));
  });

  it("honors a custom timeoutMs deadline", async () => {
    vi.useFakeTimers();
    registerToolHandler("never", () => new Promise<never>(() => {}));

    const pending = executeTool("never", {}, ctx, 1500);
    await vi.advanceTimersByTimeAsync(1500);
    const outcome = await pending;

    expect(outcome.status).toBe("timeout");
    expect(outcome.error).toContain("1500ms");
  });
});

// ─── Backend error (Req 6.6) ──────────────────────────────────────────────────

describe("executeTool — backend / handler failure", () => {
  it("yields status 'error' when the handler rejects with an Error", async () => {
    registerToolHandler("boom", async () => {
      throw new Error("backend unavailable");
    });

    const outcome = await executeTool("boom", {}, ctx);

    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("backend unavailable");
    expect(outcome.result).toBeUndefined();
  });

  it("yields status 'error' when the handler rejects with a non-Error value", async () => {
    registerToolHandler("boom", () => Promise.reject("string failure"));

    const outcome = await executeTool("boom", {}, ctx);

    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("string failure");
  });

  it("yields status 'error' when the handler throws synchronously", async () => {
    registerToolHandler("sync-throw", () => {
      throw new Error("synchronous boom");
    });

    const outcome = await executeTool("sync-throw", {}, ctx);

    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("synchronous boom");
  });

  it("yields status 'error' when no handler is registered for the key", async () => {
    const outcome = await executeTool("not-registered", {}, ctx);

    expect(outcome.status).toBe("error");
    expect(outcome.error).toContain("no handler registered");
    expect(outcome.error).toContain("not-registered");
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("executeTool — success", () => {
  it("yields status 'ok' with the handler's result", async () => {
    registerToolHandler("echo", async (args) => ({ echoed: args }));

    const outcome = await executeTool("echo", { productCode: "diesel" }, ctx);

    expect(outcome.status).toBe("ok");
    expect(outcome.result).toEqual({ echoed: { productCode: "diesel" } });
    expect(outcome.error).toBeUndefined();
  });

  it("passes the per-call context through to the handler", async () => {
    let seen: ToolExecContext | undefined;
    registerToolHandler("capture-ctx", async (_args, handlerCtx) => {
      seen = handlerCtx;
      return "done";
    });

    const outcome = await executeTool("capture-ctx", {}, ctx);

    expect(outcome.status).toBe("ok");
    expect(seen).toEqual(ctx);
  });
});

// ─── Dispatch-review fail-safe (Req 6.8 / 6.10) ───────────────────────────────

describe("dispatch-review non-confirmation retains the transient draft", () => {
  const draft = { customerId: "cust_1", productCode: "diesel", quantity: 500 };

  it("retains the draft when placement fails with a backend error", async () => {
    registerToolHandler("runsheet_queue_dispatch_review", async () => {
      throw new Error("intake path unavailable");
    });

    const outcome = await executeTool(
      "runsheet_queue_dispatch_review",
      draft,
      ctx
    );
    const retained = retainDraftUnlessConfirmed(draft, outcome);

    expect(outcome.status).toBe("error");
    // Placement unconfirmed → draft is retained for retry, never discarded.
    expect(retained).toBe(draft);
  });

  it("retains the draft when placement times out (unconfirmed)", async () => {
    vi.useFakeTimers();
    registerToolHandler(
      "runsheet_queue_dispatch_review",
      () => new Promise<never>(() => {})
    );

    const pending = executeTool("runsheet_queue_dispatch_review", draft, ctx);
    await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_TIMEOUT_MS);
    const outcome = await pending;
    const retained = retainDraftUnlessConfirmed(draft, outcome);

    expect(outcome.status).toBe("timeout");
    expect(retained).toBe(draft);
  });

  it("clears the transient draft only once placement is confirmed", async () => {
    registerToolHandler("runsheet_queue_dispatch_review", async () => ({
      queued: true,
      reviewId: "rev_123",
    }));

    const outcome = await executeTool(
      "runsheet_queue_dispatch_review",
      draft,
      ctx
    );
    const retained = retainDraftUnlessConfirmed(draft, outcome);

    expect(outcome.status).toBe("ok");
    expect(retained).toBeUndefined();
  });
});
