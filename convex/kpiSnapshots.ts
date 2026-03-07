/**
 * KPI snapshot storage and queries.
 * Snapshots are computed by a scheduled cron and stored for historical trend analysis.
 *
 * Requirements: 15.6, 15.7
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verticalValidator } from "./shared/validators";

const periodTypeValidator = v.union(
  v.literal("day"),
  v.literal("week"),
  v.literal("month")
);

/**
 * Stores a computed KPI snapshot.
 */
export const storeSnapshot = mutation({
  args: {
    snapshotId: v.string(),
    metricName: v.string(),
    vertical: verticalValidator,
    periodType: periodTypeValidator,
    periodStart: v.number(),
    periodEnd: v.number(),
    value: v.number(),
    metadata: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotent: skip if snapshot already exists
    const existing = await ctx.db
      .query("kpiSnapshots")
      .withIndex("by_snapshot_id", (q) => q.eq("snapshotId", args.snapshotId))
      .unique();

    if (existing) {
      return { success: true, skipped: true, snapshotId: args.snapshotId };
    }

    await ctx.db.insert("kpiSnapshots", {
      ...args,
      createdAt: Date.now(),
    });

    return { success: true, skipped: false, snapshotId: args.snapshotId };
  },
});

/**
 * Queries KPI snapshots filtered by metric, vertical, and period range.
 */
export const getSnapshots = query({
  args: {
    metricName: v.string(),
    vertical: verticalValidator,
    periodType: v.optional(periodTypeValidator),
    startAfter: v.optional(v.number()),
    endBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db
      .query("kpiSnapshots")
      .withIndex("by_metric_and_vertical", (q) =>
        q.eq("metricName", args.metricName).eq("vertical", args.vertical)
      )
      .collect();

    if (args.periodType) {
      results = results.filter((s) => s.periodType === args.periodType);
    }
    if (args.startAfter !== undefined) {
      results = results.filter((s) => s.periodStart >= args.startAfter!);
    }
    if (args.endBefore !== undefined) {
      results = results.filter((s) => s.periodEnd <= args.endBefore!);
    }

    return results;
  },
});

/**
 * Queries the latest snapshot for each metric/vertical combination.
 */
export const getLatestSnapshots = query({
  args: {
    vertical: verticalValidator,
  },
  handler: async (ctx, args) => {
    const allSnapshots = await ctx.db
      .query("kpiSnapshots")
      .collect();

    const verticalSnapshots = allSnapshots.filter(
      (s) => s.vertical === args.vertical
    );

    // Group by metricName, keep latest by createdAt
    const latestByMetric: Record<string, typeof verticalSnapshots[number]> = {};
    for (const snapshot of verticalSnapshots) {
      const existing = latestByMetric[snapshot.metricName];
      if (!existing || snapshot.createdAt > existing.createdAt) {
        latestByMetric[snapshot.metricName] = snapshot;
      }
    }

    return Object.values(latestByMetric);
  },
});
