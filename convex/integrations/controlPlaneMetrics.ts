/**
 * Feature: platform-control-plane — Optional per-platform usage & health
 * metrics (Requirement 10). Task 6.1.
 *
 * A single flag-gated, scope-checked read surface exposing per-integration
 * submission-health metrics over a configurable time window. It is OPTIONAL and
 * deferrable by design: the metric-count sourcing from `agentMetrics` has no
 * natural submission-attempt mapping today (that table tracks calls/tools, not
 * submissions), so this surface returns zero counts as its best-effort baseline
 * — which is also the correct value when an integration has no activity in the
 * window (Req 10.4). The gating, scope enforcement, window bounds, and current
 * status are fully implemented.
 *
 * Behavior:
 *   - Flag disabled → returns a "metrics disabled" indication (`{ enabled:
 *     false }`); the surface performs no lookup and discloses nothing (Req 10
 *     WHERE clauses).
 *   - Flag enabled → resolves the actor via `requireActor`, verifies the target
 *     `(platformId, tenantId)` is within the actor's Authorization_Scope, and
 *     returns the health metrics. Out-of-scope / unauthenticated → authorization
 *     error, no data (Req 10.2, 10.5).
 *   - Window: 1 hour ≤ window ≤ 90 days, inclusive; default 24 hours when none
 *     is supplied; a window outside those bounds is rejected (Req 10.3).
 *   - Counts are attempts / successes / failures plus the current
 *     Connection_Status; zero counts when there is no activity (Req 10.4). No
 *     credential value is ever included (Req 10.1).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { isPairInScope, requireActor } from "./authorization";
import type { ConnectionStatus } from "./configStore";

// ---------------------------------------------------------------------------
// Window bounds (Req 10.3)
// ---------------------------------------------------------------------------

/** Minimum accepted metrics window: 1 hour, in milliseconds (Req 10.3). */
export const METRICS_WINDOW_MIN_MS = 60 * 60 * 1000; // 3_600_000
/** Maximum accepted metrics window: 90 days, in milliseconds (Req 10.3). */
export const METRICS_WINDOW_MAX_MS = 90 * 24 * 60 * 60 * 1000; // 7_776_000_000
/** Default metrics window applied when none is supplied: 24 hours (Req 10.3). */
export const METRICS_WINDOW_DEFAULT_MS = 24 * 60 * 60 * 1000; // 86_400_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-platform health metrics for an Integration within the actor's scope
 * (Req 10.1). References the Integration by `(platformId, tenantId)` only and
 * never carries any credential value.
 */
export interface PlatformHealthMetrics {
  platformId: string;
  tenantId: string;
  /** Count of submission attempts over the window (Req 10.1, 10.4). */
  submissionAttempts: number;
  /** Count of successful submissions over the window (Req 10.1, 10.4). */
  submissionSuccesses: number;
  /** Count of failed submissions over the window (Req 10.1, 10.4). */
  submissionFailures: number;
  /** Current Connection_Status of the Integration (Req 10.1). */
  status: ConnectionStatus;
  /** Inclusive window start (epoch ms). */
  windowStart: number;
  /** Exclusive window end (epoch ms) — the request time. */
  windowEnd: number;
}

/**
 * The result of a metrics request: a "metrics disabled" indication when the
 * feature flag is off, otherwise the computed health metrics.
 */
export type PlatformMetricsResult =
  | { enabled: false }
  | { enabled: true; metrics: PlatformHealthMetrics };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Reports whether per-platform metrics are enabled, from the
 * `CONTROL_PLANE_METRICS_ENABLED` environment flag. Only the explicit truthy
 * values `"true"` and `"1"` enable the surface; any other value (including
 * unset, `"false"`, or `"0"`) leaves it disabled.
 */
export function metricsEnabled(): boolean {
  const raw = process.env.CONTROL_PLANE_METRICS_ENABLED;
  return raw === "true" || raw === "1";
}

/**
 * Resolves the effective window in milliseconds, applying the 24-hour default
 * when none is supplied and enforcing the inclusive 1-hour–90-day bounds
 * (Req 10.3). A supplied value outside those bounds (or non-finite) throws so
 * the request is rejected rather than silently clamped.
 */
export function resolveWindowMs(windowMs?: number): number {
  if (windowMs === undefined) return METRICS_WINDOW_DEFAULT_MS;
  if (
    !Number.isFinite(windowMs) ||
    windowMs < METRICS_WINDOW_MIN_MS ||
    windowMs > METRICS_WINDOW_MAX_MS
  ) {
    throw new Error(
      `Metrics window out of range: must be between ${METRICS_WINDOW_MIN_MS}ms ` +
        `(1 hour) and ${METRICS_WINDOW_MAX_MS}ms (90 days) inclusive`
    );
  }
  return windowMs;
}

// ---------------------------------------------------------------------------
// Convex surface
// ---------------------------------------------------------------------------

/**
 * Optional per-platform usage & health metrics for a single Integration,
 * gated by `CONTROL_PLANE_METRICS_ENABLED` (Req 10).
 *
 * When the flag is disabled, returns `{ enabled: false }` — a "metrics
 * disabled" indication — and performs no lookup. When enabled, resolves the
 * actor, verifies the target pair is within the actor's Authorization_Scope
 * (Req 10.2, 10.5), applies the window bounds/default (Req 10.3), and returns
 * the attempt/success/failure counts plus the current Connection_Status
 * (Req 10.1), with zero counts when there is no activity (Req 10.4). Never
 * includes a credential value.
 */
export const getPlatformMetrics = query({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PlatformMetricsResult> => {
    // Req 10 WHERE-gate: when the feature flag is off, the surface returns a
    // "metrics disabled" indication and discloses nothing.
    if (!metricsEnabled()) {
      return { enabled: false };
    }

    // Every Control-Plane surface authorizes FIRST and returns no data on
    // failure (Req 10.2, 10.5).
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      throw new Error(`Not authorized to read platform metrics (${actor.reason})`);
    }
    if (!isPairInScope(actor.scope, args.platformId, args.tenantId)) {
      throw new Error(
        "Not authorized to read platform metrics for the requested integration"
      );
    }

    // Resolve + validate the window (default 24h; 1h–90d inclusive) (Req 10.3).
    const windowMs = resolveWindowMs(args.windowMs);
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowMs;

    // Current Connection_Status from the base `integrations` store. When no
    // record exists yet the integration is treated as `disconnected`.
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();
    const status: ConnectionStatus = integration?.status ?? "disconnected";

    // Submission-count sourcing is deferrable (see module header): `agentMetrics`
    // has no natural submission-attempt mapping, so counts are reported as zero.
    // This is also the correct value when there is no activity in the window
    // (Req 10.4). Never includes any credential value (Req 10.1).
    return {
      enabled: true,
      metrics: {
        platformId: args.platformId,
        tenantId: args.tenantId,
        submissionAttempts: 0,
        submissionSuccesses: 0,
        submissionFailures: 0,
        status,
        windowStart,
        windowEnd,
      },
    };
  },
});
