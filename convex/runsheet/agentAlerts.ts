import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Per-agent alerting persistence (Dinee-owned, later phase — Requirement 17).
 *
 * The pure alert-rule evaluator in `src/lib/monitoring/alertRules.ts` decides
 * which alerts to raise for a tenant's reporting window; this module persists
 * those decisions as `agentAlerts` rows. Five alert conditions are covered:
 * dependency failure (Req 17.1), low-confidence rate (Req 17.2),
 * review-required rate (Req 17.3), per-tenant tool-rejection rate (Req 17.4),
 * and per-tenant authentication-failure rate (Req 17.5).
 *
 * This is Dinee-owned monitoring data — it is NOT order-of-record data (that
 * lives in the Runsheet backend).
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5 (dinee-voice-platform)
 */

/** Validator for the five monitored alert conditions (Req 17.1–17.5). */
export const alertTypeValidator = v.union(
  v.literal("dependency_failure"),
  v.literal("low_confidence_rate"),
  v.literal("review_required_rate"),
  v.literal("tool_rejection_rate"),
  v.literal("auth_failure_rate")
);

/** Validator for alert severity levels. */
export const alertSeverityValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("critical")
);

/** Validator for a monitored dependency (Req 17.1). */
export const dependencyValidator = v.union(
  v.literal("openai"),
  v.literal("twilio"),
  v.literal("runsheet")
);

/**
 * The fields describing a single raised alert. Mirrors the `RaisedAlert` shape
 * produced by the pure evaluator; `createdAt` and `resolved` are managed by the
 * mutation.
 */
const raisedAlertFields = {
  tenantId: v.string(),
  alertType: alertTypeValidator,
  severity: alertSeverityValidator,
  subject: v.string(),
  dependency: v.optional(dependencyValidator),
  threshold: v.optional(v.number()),
  observedValue: v.optional(v.number()),
  windowStart: v.number(),
  windowEnd: v.number(),
  message: v.string(),
};

/**
 * Persist a single raised alert (Req 17.1–17.5).
 *
 * Inserts one `agentAlerts` row, stamping `createdAt` and defaulting the alert
 * to unresolved. Returns the new alert id.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */
export const raiseAlert = mutation({
  args: raisedAlertFields,
  handler: async (ctx, args) => {
    const alertId = await ctx.db.insert("agentAlerts", {
      ...args,
      createdAt: Date.now(),
      resolved: false,
    });

    return { alertId };
  },
});

/**
 * Persist a batch of raised alerts (Req 17.1–17.5).
 *
 * Convenience over `raiseAlert` for the common case where the evaluator returns
 * several breaches for one window. Inserts each row unresolved with a shared
 * `createdAt` and returns the inserted ids in order.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */
export const raiseAlerts = mutation({
  args: {
    alerts: v.array(v.object(raisedAlertFields)),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const alertIds = [];
    for (const alert of args.alerts) {
      const alertId = await ctx.db.insert("agentAlerts", {
        ...alert,
        createdAt,
        resolved: false,
      });
      alertIds.push(alertId);
    }

    return { alertIds };
  },
});

/**
 * List alerts raised for a tenant, most recent first. Primarily a helper for
 * verification and dispatcher-facing views (Req 17.4, 17.5).
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */
export const getByTenantId = query({
  args: {
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentAlerts")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .collect();
  },
});
