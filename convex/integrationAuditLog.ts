/**
 * Integration Audit Log — immutable audit trail for credential lifecycle events.
 *
 * Entries are created for: create, rotate, revoke, expire, connect, disconnect.
 * No update or delete mutations are exposed to ensure immutability (Req 18.10).
 *
 * Requirements: 18.9, 18.10
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const ALLOWED_ADMIN_ROLES = ["platform_admin"];
const ALLOWED_WRITE_ROLES = ["business_owner", "platform_admin"];

const actionTypeValidator = v.union(
  v.literal("create"),
  v.literal("rotate"),
  v.literal("revoke"),
  v.literal("expire"),
  v.literal("connect"),
  v.literal("disconnect")
);

/**
 * Creates an immutable audit log entry for an integration credential event.
 * Only business_owner and platform_admin roles can write entries.
 */
export const createAuditEntry = mutation({
  args: {
    entryId: v.string(),
    businessId: v.string(),
    integrationName: v.string(),
    actionType: actionTypeValidator,
    actorUserId: v.string(),
    actorRole: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_WRITE_ROLES.includes(args.actorRole)) {
      throw new Error("Forbidden: insufficient role for audit log creation");
    }

    await ctx.db.insert("integrationAuditLog", {
      entryId: args.entryId,
      businessId: args.businessId,
      integrationName: args.integrationName,
      actionType: args.actionType,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      details: args.details,
      createdAt: Date.now(),
    });

    return { success: true, entryId: args.entryId };
  },
});

/**
 * Queries audit log entries for a specific business.
 * Only platform_admin users can query the full audit log.
 */
export const getAuditLogByBusiness = query({
  args: {
    businessId: v.string(),
    callerRole: v.string(),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_ADMIN_ROLES.includes(args.callerRole)) {
      throw new Error("Forbidden: only platform_admin can view audit logs");
    }

    const entries = await ctx.db
      .query("integrationAuditLog")
      .withIndex("by_business_id", (q) => q.eq("businessId", args.businessId))
      .collect();

    return entries;
  },
});

/**
 * Queries audit log entries for a specific integration across all businesses.
 * Only platform_admin users can query.
 */
export const getAuditLogByIntegration = query({
  args: {
    integrationName: v.string(),
    callerRole: v.string(),
  },
  handler: async (ctx, args) => {
    if (!ALLOWED_ADMIN_ROLES.includes(args.callerRole)) {
      throw new Error("Forbidden: only platform_admin can view audit logs");
    }

    const entries = await ctx.db
      .query("integrationAuditLog")
      .withIndex("by_integration", (q) =>
        q.eq("integrationName", args.integrationName)
      )
      .collect();

    return entries;
  },
});
