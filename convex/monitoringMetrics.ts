/**
 * Monitoring Metrics Mutations and Queries
 * 
 * Convex operations for storing and retrieving monitoring metrics.
 * Used by MonitoringService for tracking API, database, and external service performance.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Maximum metrics to keep in database */
const MAX_METRICS = 10000;

/**
 * Generate a unique metric ID
 */
function generateMetricId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
}

/**
 * Record an API response time metric
 */
export const recordAPIMetric = mutation({
  args: {
    endpoint: v.string(),
    method: v.string(),
    responseTimeMs: v.number(),
    statusCode: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const metricId = generateMetricId("API");
    
    await ctx.db.insert("monitoringMetrics", {
      metricId,
      type: "api_response_time",
      timestamp: Date.now(),
      endpoint: args.endpoint,
      method: args.method,
      responseTimeMs: args.responseTimeMs,
      statusCode: args.statusCode,
      success: args.success,
      errorMessage: args.errorMessage,
    });

    return { success: true, metricId };
  },
});

/**
 * Record a database query latency metric
 */
export const recordDatabaseMetric = mutation({
  args: {
    queryType: v.string(),
    tableName: v.string(),
    latencyMs: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const metricId = generateMetricId("DB");
    
    await ctx.db.insert("monitoringMetrics", {
      metricId,
      type: "database_query_latency",
      timestamp: Date.now(),
      queryType: args.queryType,
      tableName: args.tableName,
      latencyMs: args.latencyMs,
      success: args.success,
      errorMessage: args.errorMessage,
    });

    return { success: true, metricId };
  },
});

/**
 * Record an external service response time metric
 */
export const recordExternalServiceMetric = mutation({
  args: {
    service: v.string(),
    responseTimeMs: v.number(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const metricId = generateMetricId("EXT");
    
    await ctx.db.insert("monitoringMetrics", {
      metricId,
      type: "external_service_response_time",
      timestamp: Date.now(),
      service: args.service,
      responseTimeMs: args.responseTimeMs,
      success: args.success,
      errorMessage: args.errorMessage,
    });

    return { success: true, metricId };
  },
});

/**
 * Record an uptime check metric
 */
export const recordUptimeCheck = mutation({
  args: {
    target: v.string(),
    isUp: v.boolean(),
    responseTimeMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const metricId = generateMetricId("UP");
    
    await ctx.db.insert("monitoringMetrics", {
      metricId,
      type: "uptime_check",
      timestamp: Date.now(),
      target: args.target,
      isUp: args.isUp,
      responseTimeMs: args.responseTimeMs,
      success: args.isUp,
      errorMessage: args.errorMessage,
    });

    // Update uptime tracking
    const existing = await ctx.db
      .query("uptimeTracking")
      .withIndex("by_target", (q) => q.eq("target", args.target))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        upCount: existing.upCount + (args.isUp ? 1 : 0),
        totalCount: existing.totalCount + 1,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("uptimeTracking", {
        target: args.target,
        upCount: args.isUp ? 1 : 0,
        totalCount: 1,
        lastUpdated: Date.now(),
      });
    }

    return { success: true, metricId };
  },
});

/**
 * Get metrics with optional filtering
 */
export const getMetrics = query({
  args: {
    type: v.optional(v.union(
      v.literal("api_response_time"),
      v.literal("database_query_latency"),
      v.literal("external_service_response_time"),
      v.literal("uptime_check"),
      v.literal("error_rate")
    )),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let metrics;
    
    if (args.type) {
      metrics = await ctx.db
        .query("monitoringMetrics")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .collect();
    } else {
      metrics = await ctx.db.query("monitoringMetrics").collect();
    }

    // Apply time filters
    if (args.startTime) {
      metrics = metrics.filter(m => m.timestamp >= args.startTime!);
    }
    if (args.endTime) {
      metrics = metrics.filter(m => m.timestamp <= args.endTime!);
    }

    // Sort by timestamp descending
    metrics.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (args.limit) {
      metrics = metrics.slice(0, args.limit);
    }

    return metrics;
  },
});

/**
 * Get aggregated metrics for a time period
 */
export const getAggregatedMetrics = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const metrics = await ctx.db.query("monitoringMetrics").collect();
    
    const metricsInPeriod = metrics.filter(
      m => m.timestamp >= args.startTime && m.timestamp <= args.endTime
    );

    // Aggregate API metrics
    const apiMetrics = metricsInPeriod.filter(m => m.type === "api_response_time");
    const apiResponseTimes = apiMetrics
      .map(m => m.responseTimeMs)
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);

    // Aggregate database metrics
    const dbMetrics = metricsInPeriod.filter(m => m.type === "database_query_latency");
    const dbLatencies = dbMetrics
      .map(m => m.latencyMs)
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);

    // Calculate percentiles
    const calculatePercentile = (sortedValues: number[], percentile: number): number => {
      if (sortedValues.length === 0) return 0;
      const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
      return sortedValues[Math.max(0, index)];
    };

    const apiErrorRate = apiMetrics.length > 0
      ? (apiMetrics.filter(m => !m.success).length / apiMetrics.length) * 100
      : 0;

    const avgApiLatency = apiResponseTimes.length > 0
      ? apiResponseTimes.reduce((a, b) => a + b, 0) / apiResponseTimes.length
      : 0;

    return {
      period: { start: args.startTime, end: args.endTime },
      api: {
        totalRequests: apiMetrics.length,
        successfulRequests: apiMetrics.filter(m => m.success).length,
        failedRequests: apiMetrics.filter(m => !m.success).length,
        averageResponseTimeMs: Math.round(avgApiLatency),
        p50ResponseTimeMs: calculatePercentile(apiResponseTimes, 50),
        p95ResponseTimeMs: calculatePercentile(apiResponseTimes, 95),
        p99ResponseTimeMs: calculatePercentile(apiResponseTimes, 99),
        errorRate: Math.round(apiErrorRate * 100) / 100,
      },
      database: {
        totalQueries: dbMetrics.length,
        successfulQueries: dbMetrics.filter(m => m.success).length,
        failedQueries: dbMetrics.filter(m => !m.success).length,
        averageLatencyMs: dbLatencies.length > 0
          ? Math.round(dbLatencies.reduce((a, b) => a + b, 0) / dbLatencies.length)
          : 0,
        p50LatencyMs: calculatePercentile(dbLatencies, 50),
        p95LatencyMs: calculatePercentile(dbLatencies, 95),
        p99LatencyMs: calculatePercentile(dbLatencies, 99),
      },
    };
  },
});

/**
 * Get uptime percentage for a target
 */
export const getUptimePercentage = query({
  args: {
    target: v.string(),
  },
  handler: async (ctx, args) => {
    const tracking = await ctx.db
      .query("uptimeTracking")
      .withIndex("by_target", (q) => q.eq("target", args.target))
      .first();

    if (!tracking || tracking.totalCount === 0) {
      return { target: args.target, uptimePercentage: 100, upCount: 0, totalCount: 0 };
    }

    return {
      target: args.target,
      uptimePercentage: (tracking.upCount / tracking.totalCount) * 100,
      upCount: tracking.upCount,
      totalCount: tracking.totalCount,
    };
  },
});

/**
 * Get overall uptime percentage across all targets
 */
export const getOverallUptime = query({
  args: {},
  handler: async (ctx) => {
    const allTracking = await ctx.db.query("uptimeTracking").collect();

    let totalUp = 0;
    let totalChecks = 0;

    for (const tracking of allTracking) {
      totalUp += tracking.upCount;
      totalChecks += tracking.totalCount;
    }

    return {
      uptimePercentage: totalChecks > 0 ? (totalUp / totalChecks) * 100 : 100,
      totalUp,
      totalChecks,
      targetCount: allTracking.length,
    };
  },
});

/**
 * Cleanup old metrics (keep only recent ones)
 */
export const cleanupOldMetrics = mutation({
  args: {
    maxAge: v.optional(v.number()), // Max age in milliseconds, default 24 hours
  },
  handler: async (ctx, args) => {
    const maxAge = args.maxAge ?? 24 * 60 * 60 * 1000; // 24 hours default
    const cutoffTime = Date.now() - maxAge;

    const allMetrics = await ctx.db.query("monitoringMetrics").collect();
    const oldMetrics = allMetrics.filter(m => m.timestamp < cutoffTime);

    for (const metric of oldMetrics) {
      await ctx.db.delete(metric._id);
    }

    // Also trim if we have too many metrics
    const remainingMetrics = await ctx.db.query("monitoringMetrics").collect();
    if (remainingMetrics.length > MAX_METRICS) {
      const sortedMetrics = remainingMetrics.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = sortedMetrics.slice(0, remainingMetrics.length - MAX_METRICS);
      
      for (const metric of toDelete) {
        await ctx.db.delete(metric._id);
      }
    }

    return { success: true, deletedCount: oldMetrics.length };
  },
});

/**
 * Clear all metrics (for testing)
 */
export const clearAllMetrics = mutation({
  args: {},
  handler: async (ctx) => {
    const allMetrics = await ctx.db.query("monitoringMetrics").collect();
    const allTracking = await ctx.db.query("uptimeTracking").collect();

    for (const metric of allMetrics) {
      await ctx.db.delete(metric._id);
    }

    for (const tracking of allTracking) {
      await ctx.db.delete(tracking._id);
    }

    return { 
      success: true, 
      deletedMetrics: allMetrics.length,
      deletedTracking: allTracking.length,
    };
  },
});
