/**
 * Internal KPI computation action for scheduled daily snapshots.
 * Computes real metrics per the definitions in docs/kpi-metric-definitions.md.
 *
 * Requirements: REQ-6.2
 */

import { internalAction } from "./_generated/server";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { verticalValidator } from "./shared/validators";

type Vertical = "general_services" | "healthcare" | "legal" | "hospitality" | "logistics" | "restaurant";

const VERTICALS: Vertical[] = [
  "general_services",
  "healthcare",
  "legal",
  "hospitality",
  "logistics",
  "restaurant",
];

// ============================================================================
// Internal queries used by the computation action
// ============================================================================

/**
 * Returns active tenant count: businesses with ≥1 call in the given window, per vertical.
 */
export const getActiveTenantCount = query({
  args: { vertical: verticalValidator, windowStart: v.number(), windowEnd: v.number() },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical))
      .collect();
    const verticalIds = new Set(restaurants.map((r) => r.restaurantId));
    if (verticalIds.size === 0) return 0;

    // Scan only the window's calls via the time index (was an N+1 loop that
    // collected every call for every restaurant), then count distinct tenants
    // in this vertical that had a call.
    const windowCalls = await ctx.db
      .query("calls")
      .withIndex("by_call_start_time", (q) =>
        q.gte("callStartTime", args.windowStart).lt("callStartTime", args.windowEnd)
      )
      .collect();

    const activeIds = new Set<string>();
    for (const c of windowCalls) {
      if (c.restaurantId && verticalIds.has(c.restaurantId)) {
        activeIds.add(c.restaurantId);
      }
    }
    return activeIds.size;
  },
});

/**
 * Returns call volume and total minutes for a day, per vertical.
 */
export const getCallMetrics = query({
  args: { vertical: verticalValidator, periodStart: v.number(), periodEnd: v.number() },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical))
      .collect();
    const restaurantIds = new Set(restaurants.map((r) => r.restaurantId));

    // Scan only the period's calls via the time index (was a whole-table scan).
    const periodCallsAll = await ctx.db
      .query("calls")
      .withIndex("by_call_start_time", (q) =>
        q.gte("callStartTime", args.periodStart).lt("callStartTime", args.periodEnd)
      )
      .collect();
    const periodCalls = periodCallsAll.filter(
      (c) => c.restaurantId && restaurantIds.has(c.restaurantId)
    );

    let totalDurationSeconds = 0;
    for (const call of periodCalls) {
      totalDurationSeconds += call.duration ?? 0;
    }

    return {
      callVolume: periodCalls.length,
      callMinutes: Math.round((totalDurationSeconds / 60) * 100) / 100,
    };
  },
});

/**
 * Returns call-to-outcome conversion rate for a day, per vertical.
 */
export const getConversionRate = query({
  args: { vertical: verticalValidator, periodStart: v.number(), periodEnd: v.number() },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical))
      .collect();
    const restaurantIds = new Set(restaurants.map((r) => r.restaurantId));

    // Scan only the period's calls/orders via the time indexes (was two
    // whole-table scans).
    const periodCalls = await ctx.db
      .query("calls")
      .withIndex("by_call_start_time", (q) =>
        q.gte("callStartTime", args.periodStart).lt("callStartTime", args.periodEnd)
      )
      .collect();
    const completedCalls = periodCalls.filter(
      (c) =>
        c.status === "completed" &&
        c.restaurantId &&
        restaurantIds.has(c.restaurantId)
    );

    const periodOrders = await ctx.db
      .query("orders")
      .withIndex("by_order_placement_time", (q) =>
        q.gte("orderPlacementTime", args.periodStart).lt("orderPlacementTime", args.periodEnd)
      )
      .collect();
    const ordersFromCalls = periodOrders.filter(
      (o) => o.callId && restaurantIds.has(o.restaurantId)
    );

    if (completedCalls.length === 0) return 0;
    return Math.round((ordersFromCalls.length / completedCalls.length) * 10000) / 10000;
  },
});

/**
 * Returns integration attach rate (runsheet connected / total) per vertical.
 */
export const getIntegrationAttachRate = query({
  args: { vertical: verticalValidator },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_vertical", (q) => q.eq("vertical", args.vertical))
      .collect();

    if (restaurants.length === 0) return 0;

    const connected = restaurants.filter(
      (r) => r.integrations?.runsheet?.status === "connected"
    ).length;

    return Math.round((connected / restaurants.length) * 10000) / 10000;
  },
});

// ============================================================================
// ARPA + Churn queries (Phase C)
// ============================================================================

/**
 * Returns ARPA (Average Revenue Per Account) for a monthly period per vertical.
 */
export const getArpa = query({
  args: { vertical: verticalValidator, periodStart: v.number(), periodEnd: v.number() },
  handler: async (ctx, args) => {
    // Get active subscriptions for this vertical
    const allSubscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const verticalSubscriptions = allSubscriptions.filter((s) => (s.vertical ?? "restaurant") === args.vertical);

    if (verticalSubscriptions.length === 0) return 0;

    // Sum paid invoices in period
    const allInvoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_status", (q) => q.eq("status", "paid"))
      .collect();
    const periodInvoices = allInvoices.filter(
      (inv) => inv.paidAt && inv.paidAt >= args.periodStart && inv.paidAt < args.periodEnd
    );

    // Match invoices to subscriptions in this vertical
    const subscriptionIds = new Set(verticalSubscriptions.map((s) => s.subscriptionId));
    const matchingInvoices = periodInvoices.filter((inv) => subscriptionIds.has(inv.subscriptionId));

    const totalRevenue = matchingInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    return Math.round((totalRevenue / verticalSubscriptions.length) * 100) / 100;
  },
});

/**
 * Returns churn rate for a monthly period per vertical.
 */
export const getChurnRate = query({
  args: { vertical: verticalValidator, periodStart: v.number(), periodEnd: v.number() },
  handler: async (ctx, args) => {
    const allSubscriptions = await ctx.db.query("subscriptions").collect();

    // Active at period start: created before periodStart and not cancelled before periodStart
    const activeAtStart = allSubscriptions.filter((s) => {
      const v = s.vertical ?? "restaurant";
      if (v !== args.vertical) return false;
      if (s.createdAt > args.periodStart) return false;
      if (s.cancelledAt && s.cancelledAt < args.periodStart) return false;
      return s.status === "active" || s.status === "cancelled";
    });

    if (activeAtStart.length === 0) return 0;

    // Cancelled in period
    const cancelledInPeriod = allSubscriptions.filter((s) => {
      const v = s.vertical ?? "restaurant";
      if (v !== args.vertical) return false;
      return s.cancelledAt && s.cancelledAt >= args.periodStart && s.cancelledAt < args.periodEnd;
    });

    return Math.round((cancelledInPeriod.length / activeAtStart.length) * 10000) / 10000;
  },
});

// ============================================================================
// Daily snapshot computation action
// ============================================================================

/**
 * Computes daily KPI snapshots for all verticals and stores them.
 * Runs as a scheduled internal action via cron.
 */
export const computeDailySnapshots = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayDate = new Date(now);
    const periodStart = Date.UTC(
      todayDate.getUTCFullYear(),
      todayDate.getUTCMonth(),
      todayDate.getUTCDate()
    );
    const periodEnd = periodStart + 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = periodStart - 30 * 24 * 60 * 60 * 1000;

    for (const vertical of VERTICALS) {
      // active_tenant_count — 30-day rolling window
      const activeTenants = await ctx.runQuery(api.kpiComputation.getActiveTenantCount, {
        vertical,
        windowStart: thirtyDaysAgo,
        windowEnd: periodEnd,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `active_tenant_count_${vertical}_day_${periodStart}`,
        metricName: "active_tenant_count",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: activeTenants,
        metadata: JSON.stringify({ computedAt: now }),
      });

      // call_volume + call_minutes
      const callMetrics = await ctx.runQuery(api.kpiComputation.getCallMetrics, {
        vertical,
        periodStart,
        periodEnd,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `call_volume_${vertical}_day_${periodStart}`,
        metricName: "call_volume",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: callMetrics.callVolume,
        metadata: JSON.stringify({ computedAt: now }),
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `call_minutes_${vertical}_day_${periodStart}`,
        metricName: "call_minutes",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: callMetrics.callMinutes,
        metadata: JSON.stringify({ computedAt: now }),
      });

      // call_to_outcome_conversion
      const conversionRate = await ctx.runQuery(api.kpiComputation.getConversionRate, {
        vertical,
        periodStart,
        periodEnd,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `call_to_outcome_conversion_${vertical}_day_${periodStart}`,
        metricName: "call_to_outcome_conversion",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: conversionRate,
        metadata: JSON.stringify({ computedAt: now }),
      });

      // integration_attach_rate
      const attachRate = await ctx.runQuery(api.kpiComputation.getIntegrationAttachRate, {
        vertical,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `integration_attach_rate_${vertical}_day_${periodStart}`,
        metricName: "integration_attach_rate",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: attachRate,
        metadata: JSON.stringify({ computedAt: now }),
      });

      // arpa — monthly, but we store daily snapshots for trend
      const monthStart = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1);
      const nextMonth = todayDate.getUTCMonth() === 11
        ? Date.UTC(todayDate.getUTCFullYear() + 1, 0, 1)
        : Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1);
      const arpa = await ctx.runQuery(api.kpiComputation.getArpa, {
        vertical,
        periodStart: monthStart,
        periodEnd: nextMonth,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `arpa_${vertical}_day_${periodStart}`,
        metricName: "arpa",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: arpa,
        metadata: JSON.stringify({ computedAt: now, monthStart, monthEnd: nextMonth }),
      });

      // churn_rate — monthly
      const churnRate = await ctx.runQuery(api.kpiComputation.getChurnRate, {
        vertical,
        periodStart: monthStart,
        periodEnd: nextMonth,
      });
      await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
        snapshotId: `churn_rate_${vertical}_day_${periodStart}`,
        metricName: "churn_rate",
        vertical,
        periodType: "day",
        periodStart,
        periodEnd,
        value: churnRate,
        metadata: JSON.stringify({ computedAt: now, monthStart, monthEnd: nextMonth }),
      });
    }
  },
});
