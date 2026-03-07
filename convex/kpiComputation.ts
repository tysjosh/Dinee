/**
 * Internal KPI computation action for scheduled daily snapshots.
 * Called by the cron scheduler to compute and store KPI metrics.
 *
 * Requirements: 15.6
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";

const VERTICALS = [
  "general_services",
  "healthcare",
  "legal",
  "hospitality",
  "logistics",
  "restaurant",
] as const;

const METRICS = [
  "active_tenant_count",
  "churn_rate",
] as const;

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

    // For each vertical, store a placeholder snapshot for active_tenant_count
    // In production, this would query actual business data
    for (const vertical of VERTICALS) {
      for (const metric of METRICS) {
        const snapshotId = `${metric}_${vertical}_day_${periodStart}`;

        await ctx.runMutation(api.kpiSnapshots.storeSnapshot, {
          snapshotId,
          metricName: metric,
          vertical,
          periodType: "day",
          periodStart,
          periodEnd,
          value: 0, // Actual computation would query business/call data
          metadata: JSON.stringify({ computedAt: now }),
        });
      }
    }
  },
});
