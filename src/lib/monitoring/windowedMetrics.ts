/**
 * Windowed per-agent metric aggregation (Dinee-owned, later phase — Requirement 16).
 *
 * The Monitoring_Service records one append-only `agentMetrics` row per
 * completed call (Req 16.1, task 15.1). This module contains the *pure*
 * aggregation that derives, per agent over a reporting window, the four rates
 * required by Req 16.2:
 *
 *   - tool failure rate
 *   - fallback rate
 *   - review-required rate
 *   - Auto_Submit rate
 *
 * Keeping the aggregation pure (no Convex / database dependency) lets the
 * Convex query (`convex/runsheet/agentMetrics.ts`) scan rows over a window and
 * delegate the math here, and lets the computation be unit-tested directly.
 * Tenant scoping (Req 16.3 Runsheet_Admin → single tenant, Req 16.4 platform
 * operator → all tenants) is handled by the caller selecting which rows to
 * pass in and by `computeTenantAgentRates` grouping across tenants.
 *
 * Requirements: 16.2, 16.3, 16.4 (dinee-voice-platform)
 */

/** The Auto_Submit outcome recorded per call (mirrors the schema union). */
export type AutoSubmitOutcome =
  | "auto_submitted"
  | "not_eligible"
  | "not_applicable";

/**
 * The subset of an `agentMetrics` row the aggregation needs. Declared
 * structurally so the pure functions do not depend on Convex's generated
 * `Doc<"agentMetrics">` type.
 */
export interface AgentMetricRow {
  /** Dinee tenant that owns the row — the tenant-scoping key (Req 16.3, 16.4). */
  tenantId: string;
  /** The per-agent grouping key (agents are identified by conversation type). */
  conversationType: string;
  /** Row creation time (epoch ms) — the window filter key (Req 16.2). */
  createdAt: number;
  callsReceived: number;
  callsCompleted: number;
  toolSuccessCount: number;
  toolFailureCount: number;
  fallbackOccurred: boolean;
  reviewRequired: boolean;
  autoSubmitOutcome: AutoSubmitOutcome;
}

/** Per-agent windowed rates and the raw counts they were derived from. */
export interface AgentRateMetrics {
  /** The agent identity (conversation type). */
  conversationType: string;
  /** Number of recorded calls (rows) for this agent within the window. */
  callCount: number;
  /** Sum of calls-received across the window. */
  callsReceived: number;
  /** Sum of calls-completed across the window. */
  callsCompleted: number;
  /** Total tool invocations (success + failure) across the window. */
  toolInvocations: number;
  /** toolFailureCount / toolInvocations, or 0 when there were no invocations. */
  toolFailureRate: number;
  /** Calls with a fallback / callCount, or 0 when there were no calls. */
  fallbackRate: number;
  /** Calls requiring review / callCount, or 0 when there were no calls. */
  reviewRequiredRate: number;
  /** Auto-submitted calls / callCount, or 0 when there were no calls. */
  autoSubmitRate: number;
}

/** Per-tenant grouping of per-agent rates (Req 16.4 all-tenant exposure). */
export interface TenantAgentMetrics {
  tenantId: string;
  agents: AgentRateMetrics[];
}

/**
 * Whether a row's timestamp falls inside the half-open window
 * `[windowStart, windowEnd)`. Half-open avoids double-counting a row that sits
 * exactly on the boundary between two consecutive windows.
 */
function isWithinWindow(
  createdAt: number,
  windowStart: number,
  windowEnd: number
): boolean {
  return createdAt >= windowStart && createdAt < windowEnd;
}

/** Divide guarding against a zero denominator (undefined rate → 0). */
function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Compute per-agent windowed rates from a set of metric rows (Req 16.2).
 *
 * Rows outside `[windowStart, windowEnd)` are ignored. Remaining rows are
 * grouped by `conversationType` (the per-agent key) and reduced into the four
 * required rates plus the raw counts. The result is sorted by
 * `conversationType` for deterministic output.
 *
 * This function does not filter by tenant; the caller passes in the rows it
 * wants aggregated (a single tenant's rows for a Runsheet_Admin, Req 16.3).
 */
export function computeAgentRates(
  rows: readonly AgentMetricRow[],
  windowStart: number,
  windowEnd: number
): AgentRateMetrics[] {
  interface Accumulator {
    callCount: number;
    callsReceived: number;
    callsCompleted: number;
    toolSuccessCount: number;
    toolFailureCount: number;
    fallbackCount: number;
    reviewRequiredCount: number;
    autoSubmittedCount: number;
  }

  const byAgent = new Map<string, Accumulator>();

  for (const row of rows) {
    if (!isWithinWindow(row.createdAt, windowStart, windowEnd)) {
      continue;
    }

    let acc = byAgent.get(row.conversationType);
    if (acc === undefined) {
      acc = {
        callCount: 0,
        callsReceived: 0,
        callsCompleted: 0,
        toolSuccessCount: 0,
        toolFailureCount: 0,
        fallbackCount: 0,
        reviewRequiredCount: 0,
        autoSubmittedCount: 0,
      };
      byAgent.set(row.conversationType, acc);
    }

    acc.callCount += 1;
    acc.callsReceived += row.callsReceived;
    acc.callsCompleted += row.callsCompleted;
    acc.toolSuccessCount += row.toolSuccessCount;
    acc.toolFailureCount += row.toolFailureCount;
    if (row.fallbackOccurred) {
      acc.fallbackCount += 1;
    }
    if (row.reviewRequired) {
      acc.reviewRequiredCount += 1;
    }
    if (row.autoSubmitOutcome === "auto_submitted") {
      acc.autoSubmittedCount += 1;
    }
  }

  const results: AgentRateMetrics[] = [];
  for (const [conversationType, acc] of byAgent) {
    const toolInvocations = acc.toolSuccessCount + acc.toolFailureCount;
    results.push({
      conversationType,
      callCount: acc.callCount,
      callsReceived: acc.callsReceived,
      callsCompleted: acc.callsCompleted,
      toolInvocations,
      toolFailureRate: safeRate(acc.toolFailureCount, toolInvocations),
      fallbackRate: safeRate(acc.fallbackCount, acc.callCount),
      reviewRequiredRate: safeRate(acc.reviewRequiredCount, acc.callCount),
      autoSubmitRate: safeRate(acc.autoSubmittedCount, acc.callCount),
    });
  }

  results.sort((a, b) => a.conversationType.localeCompare(b.conversationType));
  return results;
}

/**
 * Compute per-agent windowed rates grouped by tenant (Req 16.4).
 *
 * Used for the platform-operator scope, which exposes metrics across all
 * tenants. Rows are first partitioned by `tenantId`, then each partition is
 * reduced with {@link computeAgentRates}. The result is sorted by `tenantId`
 * for deterministic output.
 */
export function computeTenantAgentRates(
  rows: readonly AgentMetricRow[],
  windowStart: number,
  windowEnd: number
): TenantAgentMetrics[] {
  const byTenant = new Map<string, AgentMetricRow[]>();

  for (const row of rows) {
    let tenantRows = byTenant.get(row.tenantId);
    if (tenantRows === undefined) {
      tenantRows = [];
      byTenant.set(row.tenantId, tenantRows);
    }
    tenantRows.push(row);
  }

  const results: TenantAgentMetrics[] = [];
  for (const [tenantId, tenantRows] of byTenant) {
    const agents = computeAgentRates(tenantRows, windowStart, windowEnd);
    // A tenant whose rows all fall outside the window contributes no agents;
    // omit it so the output only lists tenants with activity in the window.
    if (agents.length > 0) {
      results.push({ tenantId, agents });
    }
  }

  results.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  return results;
}
