import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  computeAgentRates,
  computeTenantAgentRates,
  type AgentMetricRow,
} from "../../src/lib/monitoring/windowedMetrics";

/**
 * Per-agent monitoring metrics (Dinee-owned, later phase — Requirement 16).
 *
 * The Monitoring_Service records one metric row per completed call for the
 * active agent (identified by conversation type). Each row captures the
 * calls-received / calls-completed counts, the call duration, tool
 * success/failure counts, whether a fallback occurred, whether the outcome
 * required dispatcher review, and the Auto_Submit outcome (Req 16.1).
 *
 * These per-call rows are append-only inputs the windowed rate computation
 * (Req 16.2, task 15.2) later scans to derive per-agent tool-failure /
 * fallback / review-required / Auto_Submit rates. This is Dinee-owned
 * monitoring data — it is NOT order-of-record data (that lives in the Runsheet
 * backend).
 *
 * Requirements: 16.1 (dinee-voice-platform)
 */

/**
 * Validator for the Auto_Submit outcome recorded per call (Req 16.1).
 * `auto_submitted` when the draft was auto-submitted; `not_eligible` when
 * auto-submit was considered but the eligibility conjunction failed;
 * `not_applicable` when the agent/tenant is in review-only mode (MVP default).
 */
export const autoSubmitOutcomeValidator = v.union(
  v.literal("auto_submitted"),
  v.literal("not_eligible"),
  v.literal("not_applicable")
);

/**
 * Record the per-agent outcome of a completed call (Req 16.1).
 *
 * Inserts a single metric row for the active agent on call completion. The
 * caller supplies the observed counts and outcomes gathered during the call;
 * `callsReceived` / `callsCompleted` default to 1 (a received, completed call)
 * but are overridable so an abandoned call can record `callsCompleted: 0`.
 *
 * Requirements: 16.1
 */
export const recordCallOutcome = mutation({
  args: {
    tenantId: v.string(),
    conversationType: v.string(),
    callId: v.string(),
    // Counts contributed by this call; default to a single received/completed
    // call when omitted.
    callsReceived: v.optional(v.number()),
    callsCompleted: v.optional(v.number()),
    durationMs: v.number(),
    toolSuccessCount: v.number(),
    toolFailureCount: v.number(),
    fallbackOccurred: v.boolean(),
    reviewRequired: v.boolean(),
    autoSubmitOutcome: autoSubmitOutcomeValidator,
  },
  handler: async (ctx, args) => {
    const metricId = await ctx.db.insert("agentMetrics", {
      tenantId: args.tenantId,
      conversationType: args.conversationType,
      callId: args.callId,
      callsReceived: args.callsReceived ?? 1,
      callsCompleted: args.callsCompleted ?? 1,
      durationMs: args.durationMs,
      toolSuccessCount: args.toolSuccessCount,
      toolFailureCount: args.toolFailureCount,
      fallbackOccurred: args.fallbackOccurred,
      reviewRequired: args.reviewRequired,
      autoSubmitOutcome: args.autoSubmitOutcome,
      createdAt: Date.now(),
    });

    return { metricId };
  },
});

/**
 * List the recorded metric rows for a single call. Primarily a helper for
 * verification and debugging of the recording path (Req 16.1).
 *
 * Requirements: 16.1
 */
export const getByCallId = query({
  args: {
    callId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentMetrics")
      .filter((q) => q.eq(q.field("callId"), args.callId))
      .collect();
  },
});

/**
 * Compute per-agent windowed rates with tenant scoping (Req 16.2, 16.3, 16.4).
 *
 * Scans the append-only `agentMetrics` rows over the half-open reporting window
 * `[windowStart, windowEnd)` using the `by_created_at` index, then delegates the
 * rate math to the pure `computeAgentRates` / `computeTenantAgentRates`
 * aggregation (`src/lib/monitoring/windowedMetrics.ts`).
 *
 * Scope is explicit so the two Req 16 audiences cannot be confused:
 *   - `{ kind: "tenant", tenantId }` — a Runsheet_Admin. Metrics are scoped to
 *     that single tenant's rows (Req 16.3). The result lists exactly that one
 *     tenant (empty `agents` when it had no activity in the window).
 *   - `{ kind: "platform" }` — a Dinee_Platform operator. Metrics span all
 *     tenants, grouped per tenant (Req 16.4).
 *
 * Requirements: 16.2, 16.3, 16.4
 */
export const computeWindowedRates = query({
  args: {
    windowStart: v.number(),
    windowEnd: v.number(),
    scope: v.union(
      v.object({
        kind: v.literal("tenant"),
        tenantId: v.string(),
      }),
      v.object({
        kind: v.literal("platform"),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { windowStart, windowEnd, scope } = args;

    // Scan rows over the window via the by_created_at index. The pure
    // aggregation applies the same half-open window filter defensively, so the
    // index range and the computed rates always agree.
    const windowRows = await ctx.db
      .query("agentMetrics")
      .withIndex("by_created_at", (q) =>
        q.gte("createdAt", windowStart).lt("createdAt", windowEnd)
      )
      .collect();

    if (scope.kind === "tenant") {
      const tenantRows: AgentMetricRow[] = windowRows.filter(
        (row) => row.tenantId === scope.tenantId
      );
      const agents = computeAgentRates(tenantRows, windowStart, windowEnd);
      return {
        windowStart,
        windowEnd,
        tenants: [{ tenantId: scope.tenantId, agents }],
      };
    }

    const tenants = computeTenantAgentRates(windowRows, windowStart, windowEnd);
    return { windowStart, windowEnd, tenants };
  },
});
