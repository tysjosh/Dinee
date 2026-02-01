/**
 * Monitoring Alerts Mutations and Queries
 * 
 * Convex operations for storing and managing monitoring alerts.
 * Used by MonitoringService and AlertingService for alert lifecycle management.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Maximum alerts to keep in database */
const MAX_ALERTS = 1000;

/**
 * Generate a unique alert ID
 */
function generateAlertId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ALERT_${timestamp}_${random}`.toUpperCase();
}

/**
 * Create a new alert
 */
export const createAlert = mutation({
  args: {
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
    title: v.string(),
    message: v.string(),
    metricType: v.union(
      v.literal("api_response_time"),
      v.literal("database_query_latency"),
      v.literal("external_service_response_time"),
      v.literal("uptime_check"),
      v.literal("error_rate")
    ),
    currentValue: v.number(),
    threshold: v.number(),
    context: v.optional(v.string()), // JSON string
  },
  handler: async (ctx, args) => {
    const alertId = generateAlertId();
    
    await ctx.db.insert("monitoringAlerts", {
      alertId,
      severity: args.severity,
      title: args.title,
      message: args.message,
      metricType: args.metricType,
      currentValue: args.currentValue,
      threshold: args.threshold,
      timestamp: Date.now(),
      acknowledged: false,
      resolved: false,
      context: args.context,
    });

    // Trim old alerts if we exceed the limit
    const allAlerts = await ctx.db.query("monitoringAlerts").collect();
    if (allAlerts.length > MAX_ALERTS) {
      const sortedAlerts = allAlerts.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = sortedAlerts.slice(0, allAlerts.length - MAX_ALERTS);
      
      for (const alert of toDelete) {
        await ctx.db.delete(alert._id);
      }
    }

    return { success: true, alertId };
  },
});

/**
 * Get active (unresolved) alerts
 */
export const getActiveAlerts = query({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db
      .query("monitoringAlerts")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .collect();

    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  },
});

/**
 * Get alert history with filtering
 */
export const getAlertHistory = query({
  args: {
    severity: v.optional(v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    )),
    acknowledged: v.optional(v.boolean()),
    resolved: v.optional(v.boolean()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let alerts = await ctx.db.query("monitoringAlerts").collect();

    // Apply filters
    if (args.severity !== undefined) {
      alerts = alerts.filter(a => a.severity === args.severity);
    }
    if (args.acknowledged !== undefined) {
      alerts = alerts.filter(a => a.acknowledged === args.acknowledged);
    }
    if (args.resolved !== undefined) {
      alerts = alerts.filter(a => a.resolved === args.resolved);
    }
    if (args.startTime !== undefined) {
      alerts = alerts.filter(a => a.timestamp >= args.startTime!);
    }
    if (args.endTime !== undefined) {
      alerts = alerts.filter(a => a.timestamp <= args.endTime!);
    }

    // Sort by timestamp descending
    alerts.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (args.limit !== undefined) {
      alerts = alerts.slice(0, args.limit);
    }

    return alerts;
  },
});

/**
 * Get alert by ID
 */
export const getAlert = query({
  args: {
    alertId: v.string(),
  },
  handler: async (ctx, args) => {
    const alert = await ctx.db
      .query("monitoringAlerts")
      .withIndex("by_alert_id", (q) => q.eq("alertId", args.alertId))
      .first();

    return alert;
  },
});

/**
 * Acknowledge an alert
 */
export const acknowledgeAlert = mutation({
  args: {
    alertId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const alert = await ctx.db
      .query("monitoringAlerts")
      .withIndex("by_alert_id", (q) => q.eq("alertId", args.alertId))
      .first();

    if (!alert) {
      return { success: false, error: "Alert not found" };
    }

    await ctx.db.patch(alert._id, {
      acknowledged: true,
      acknowledgedAt: Date.now(),
      acknowledgedBy: args.userId,
    });

    return { success: true };
  },
});

/**
 * Resolve an alert
 */
export const resolveAlert = mutation({
  args: {
    alertId: v.string(),
  },
  handler: async (ctx, args) => {
    const alert = await ctx.db
      .query("monitoringAlerts")
      .withIndex("by_alert_id", (q) => q.eq("alertId", args.alertId))
      .first();

    if (!alert) {
      return { success: false, error: "Alert not found" };
    }

    await ctx.db.patch(alert._id, {
      resolved: true,
      resolvedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get alerts by severity
 */
export const getAlertsBySeverity = query({
  args: {
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
  },
  handler: async (ctx, args) => {
    const alerts = await ctx.db
      .query("monitoringAlerts")
      .withIndex("by_severity", (q) => q.eq("severity", args.severity))
      .collect();

    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  },
});

/**
 * Get alert rule breach tracking
 */
export const getRuleBreach = query({
  args: {
    ruleId: v.string(),
  },
  handler: async (ctx, args) => {
    const breach = await ctx.db
      .query("alertRuleBreaches")
      .withIndex("by_rule_id", (q) => q.eq("ruleId", args.ruleId))
      .first();

    if (!breach) {
      return {
        ruleId: args.ruleId,
        breachCount: 0,
        lastAlertTime: 0,
        lastBreachTime: 0,
      };
    }

    return breach;
  },
});

/**
 * Update alert rule breach tracking
 */
export const updateRuleBreach = mutation({
  args: {
    ruleId: v.string(),
    breachCount: v.number(),
    lastAlertTime: v.optional(v.number()),
    lastBreachTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertRuleBreaches")
      .withIndex("by_rule_id", (q) => q.eq("ruleId", args.ruleId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        breachCount: args.breachCount,
        lastAlertTime: args.lastAlertTime ?? existing.lastAlertTime,
        lastBreachTime: args.lastBreachTime ?? now,
      });
    } else {
      await ctx.db.insert("alertRuleBreaches", {
        ruleId: args.ruleId,
        breachCount: args.breachCount,
        lastAlertTime: args.lastAlertTime ?? 0,
        lastBreachTime: args.lastBreachTime ?? now,
      });
    }

    return { success: true };
  },
});

/**
 * Reset breach count for a rule
 */
export const resetRuleBreach = mutation({
  args: {
    ruleId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertRuleBreaches")
      .withIndex("by_rule_id", (q) => q.eq("ruleId", args.ruleId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        breachCount: 0,
      });
    }

    return { success: true };
  },
});

/**
 * Record alert sent (update last alert time)
 */
export const recordAlertSent = mutation({
  args: {
    ruleId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertRuleBreaches")
      .withIndex("by_rule_id", (q) => q.eq("ruleId", args.ruleId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        breachCount: 0, // Reset after alert sent
        lastAlertTime: now,
      });
    } else {
      await ctx.db.insert("alertRuleBreaches", {
        ruleId: args.ruleId,
        breachCount: 0,
        lastAlertTime: now,
        lastBreachTime: now,
      });
    }

    return { success: true };
  },
});

/**
 * Clear all alerts (for testing)
 */
export const clearAllAlerts = mutation({
  args: {},
  handler: async (ctx) => {
    const allAlerts = await ctx.db.query("monitoringAlerts").collect();
    const allBreaches = await ctx.db.query("alertRuleBreaches").collect();

    for (const alert of allAlerts) {
      await ctx.db.delete(alert._id);
    }

    for (const breach of allBreaches) {
      await ctx.db.delete(breach._id);
    }

    return { 
      success: true, 
      deletedAlerts: allAlerts.length,
      deletedBreaches: allBreaches.length,
    };
  },
});

/**
 * Get alert statistics
 */
export const getAlertStats = query({
  args: {
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let alerts = await ctx.db.query("monitoringAlerts").collect();

    // Apply time filters
    if (args.startTime !== undefined) {
      alerts = alerts.filter(a => a.timestamp >= args.startTime!);
    }
    if (args.endTime !== undefined) {
      alerts = alerts.filter(a => a.timestamp <= args.endTime!);
    }

    const total = alerts.length;
    const active = alerts.filter(a => !a.resolved).length;
    const acknowledged = alerts.filter(a => a.acknowledged).length;
    const resolved = alerts.filter(a => a.resolved).length;

    const bySeverity = {
      info: alerts.filter(a => a.severity === "info").length,
      warning: alerts.filter(a => a.severity === "warning").length,
      critical: alerts.filter(a => a.severity === "critical").length,
    };

    const byMetricType = {
      api_response_time: alerts.filter(a => a.metricType === "api_response_time").length,
      database_query_latency: alerts.filter(a => a.metricType === "database_query_latency").length,
      external_service_response_time: alerts.filter(a => a.metricType === "external_service_response_time").length,
      uptime_check: alerts.filter(a => a.metricType === "uptime_check").length,
      error_rate: alerts.filter(a => a.metricType === "error_rate").length,
    };

    return {
      total,
      active,
      acknowledged,
      resolved,
      bySeverity,
      byMetricType,
    };
  },
});
