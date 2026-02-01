/**
 * Feature Notifications Mutations and Queries
 * 
 * Convex operations for notifying users of new features.
 * Requirements: 28.8
 * 
 * Key features:
 * - Create and manage feature notifications
 * - Support scoped notifications (global, platform, restaurant, branch)
 * - Track user dismissals
 * - Automatic expiration of notifications
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Notification scope validator
 */
const notificationScopeValidator = v.union(
  v.literal("global"),
  v.literal("platform"),
  v.literal("restaurant"),
  v.literal("branch")
);

/**
 * Notification type validator
 */
const notificationTypeValidator = v.union(
  v.literal("new_feature"),
  v.literal("migration"),
  v.literal("deprecation"),
  v.literal("update")
);

/**
 * Notification priority validator
 */
const notificationPriorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

/**
 * Generate a unique notification ID
 */
function generateNotificationId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "NOTIF";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a feature notification
 * 
 * Requirements: 28.8
 */
export const createNotification = mutation({
  args: {
    scope: notificationScopeValidator,
    scopeId: v.optional(v.string()),
    title: v.string(),
    message: v.string(),
    featureName: v.string(),
    type: notificationTypeValidator,
    priority: notificationPriorityValidator,
    dismissible: v.boolean(),
    actionUrl: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate scopeId requirement
    if (args.scope !== "global" && !args.scopeId) {
      return {
        success: false,
        message: `scopeId is required for ${args.scope} scope`,
      };
    }

    const now = Date.now();

    // Generate unique notification ID
    let notificationId: string;
    let existingNotification;

    do {
      notificationId = generateNotificationId();
      existingNotification = await ctx.db
        .query("featureNotifications")
        .withIndex("by_notification_id", (q) => q.eq("notificationId", notificationId))
        .first();
    } while (existingNotification);

    await ctx.db.insert("featureNotifications", {
      notificationId,
      scope: args.scope,
      scopeId: args.scopeId,
      title: args.title,
      message: args.message,
      featureName: args.featureName,
      type: args.type,
      priority: args.priority,
      dismissible: args.dismissible,
      actionUrl: args.actionUrl,
      actionLabel: args.actionLabel,
      isActive: true,
      startsAt: args.startsAt || now,
      expiresAt: args.expiresAt,
      createdAt: now,
    });

    return {
      success: true,
      message: "Notification created successfully",
      notificationId,
    };
  },
});


/**
 * Get active notifications for a user context
 * 
 * Returns notifications that:
 * - Are active and within their display window
 * - Match the user's scope (global + platform + restaurant + branch)
 * - Have not been dismissed by the user
 * 
 * Requirements: 28.8
 */
export const getActiveNotifications = query({
  args: {
    userId: v.string(),
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all active notifications
    const allNotifications = await ctx.db
      .query("featureNotifications")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter notifications that apply to this context
    const applicableNotifications = allNotifications.filter((n) => {
      // Check if notification is within display window
      if (n.startsAt > now) return false;
      if (n.expiresAt && n.expiresAt < now) return false;

      // Check scope
      if (n.scope === "global") return true;
      if (n.scope === "platform" && args.platformId && n.scopeId === args.platformId) return true;
      if (n.scope === "restaurant" && args.restaurantId && n.scopeId === args.restaurantId) return true;
      if (n.scope === "branch" && args.branchId && n.scopeId === args.branchId) return true;

      return false;
    });

    // Get user's dismissals
    const dismissals = await ctx.db
      .query("userNotificationDismissals")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .collect();

    const dismissedIds = new Set(dismissals.map((d) => d.notificationId));

    // Filter out dismissed notifications
    const activeNotifications = applicableNotifications.filter(
      (n) => !dismissedIds.has(n.notificationId)
    );

    // Sort by priority (high first) then by creation date (newest first)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    activeNotifications.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });

    return {
      notifications: activeNotifications.map((n) => ({
        notificationId: n.notificationId,
        title: n.title,
        message: n.message,
        featureName: n.featureName,
        type: n.type,
        priority: n.priority,
        dismissible: n.dismissible,
        actionUrl: n.actionUrl,
        actionLabel: n.actionLabel,
        createdAt: n.createdAt,
      })),
      totalCount: activeNotifications.length,
      dismissedCount: dismissals.length,
    };
  },
});

/**
 * Dismiss a notification for a user
 * 
 * Requirements: 28.8
 */
export const dismissNotification = mutation({
  args: {
    notificationId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if notification exists
    const notification = await ctx.db
      .query("featureNotifications")
      .withIndex("by_notification_id", (q) => q.eq("notificationId", args.notificationId))
      .first();

    if (!notification) {
      return {
        success: false,
        message: `Notification ${args.notificationId} not found`,
      };
    }

    if (!notification.dismissible) {
      return {
        success: false,
        message: "This notification cannot be dismissed",
      };
    }

    // Check if already dismissed
    const existingDismissal = await ctx.db
      .query("userNotificationDismissals")
      .withIndex("by_notification_and_user", (q) =>
        q.eq("notificationId", args.notificationId).eq("userId", args.userId)
      )
      .first();

    if (existingDismissal) {
      return {
        success: true,
        message: "Notification already dismissed",
      };
    }

    // Create dismissal record
    await ctx.db.insert("userNotificationDismissals", {
      notificationId: args.notificationId,
      userId: args.userId,
      dismissedAt: Date.now(),
    });

    return {
      success: true,
      message: "Notification dismissed",
    };
  },
});


/**
 * Update a notification
 * 
 * Requirements: 28.8
 */
export const updateNotification = mutation({
  args: {
    notificationId: v.string(),
    title: v.optional(v.string()),
    message: v.optional(v.string()),
    priority: v.optional(notificationPriorityValidator),
    dismissible: v.optional(v.boolean()),
    actionUrl: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db
      .query("featureNotifications")
      .withIndex("by_notification_id", (q) => q.eq("notificationId", args.notificationId))
      .first();

    if (!notification) {
      return {
        success: false,
        message: `Notification ${args.notificationId} not found`,
      };
    }

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.message !== undefined) updates.message = args.message;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dismissible !== undefined) updates.dismissible = args.dismissible;
    if (args.actionUrl !== undefined) updates.actionUrl = args.actionUrl;
    if (args.actionLabel !== undefined) updates.actionLabel = args.actionLabel;
    if (args.isActive !== undefined) updates.isActive = args.isActive;
    if (args.expiresAt !== undefined) updates.expiresAt = args.expiresAt;

    await ctx.db.patch(notification._id, updates);

    return {
      success: true,
      message: "Notification updated successfully",
    };
  },
});

/**
 * Deactivate a notification
 * 
 * Requirements: 28.8
 */
export const deactivateNotification = mutation({
  args: {
    notificationId: v.string(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db
      .query("featureNotifications")
      .withIndex("by_notification_id", (q) => q.eq("notificationId", args.notificationId))
      .first();

    if (!notification) {
      return {
        success: false,
        message: `Notification ${args.notificationId} not found`,
      };
    }

    await ctx.db.patch(notification._id, { isActive: false });

    return {
      success: true,
      message: "Notification deactivated",
    };
  },
});

/**
 * Get all notifications (admin view)
 */
export const getAllNotifications = query({
  args: {},
  handler: async (ctx) => {
    const notifications = await ctx.db.query("featureNotifications").collect();
    const now = Date.now();

    return notifications.map((n) => ({
      notificationId: n.notificationId,
      scope: n.scope,
      scopeId: n.scopeId,
      title: n.title,
      message: n.message,
      featureName: n.featureName,
      type: n.type,
      priority: n.priority,
      dismissible: n.dismissible,
      actionUrl: n.actionUrl,
      actionLabel: n.actionLabel,
      isActive: n.isActive,
      startsAt: n.startsAt,
      expiresAt: n.expiresAt,
      isExpired: n.expiresAt ? now > n.expiresAt : false,
      createdAt: n.createdAt,
    }));
  },
});

/**
 * Create migration-related notifications
 * 
 * Helper to create standard notifications for migration events.
 * Requirements: 28.8
 */
export const createMigrationNotifications = mutation({
  args: {
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

    const notifications = [
      {
        scope: "global" as const,
        title: "Multi-Tenant Platform Now Available",
        message: "Your restaurant has been migrated to our new multi-tenant platform. You can now manage multiple branches from a single dashboard.",
        featureName: "multi_tenant_enabled",
        type: "migration" as const,
        priority: "high" as const,
      },
      {
        scope: "global" as const,
        title: "New Payment Options Available",
        message: "Paystack, Flutterwave, and Cash-on-Delivery payment methods are now available for your restaurant.",
        featureName: "paystack_enabled",
        type: "new_feature" as const,
        priority: "medium" as const,
      },
      {
        scope: "global" as const,
        title: "WhatsApp Notifications Enabled",
        message: "You can now send order confirmations and status updates to customers via WhatsApp.",
        featureName: "whatsapp_enabled",
        type: "new_feature" as const,
        priority: "medium" as const,
      },
      {
        scope: "global" as const,
        title: "Nigerian Language Support",
        message: "Our AI agent now supports Nigerian English and Pidgin for better customer interactions.",
        featureName: "nigerian_english_enabled",
        type: "new_feature" as const,
        priority: "low" as const,
      },
      {
        scope: "global" as const,
        title: "Rollback Available",
        message: "If you experience any issues with the migration, you can rollback to the previous version within 30 days.",
        featureName: "migration_complete",
        type: "migration" as const,
        priority: "medium" as const,
      },
    ];

    const createdIds: string[] = [];

    for (const notif of notifications) {
      let notificationId: string;
      let existingNotification;

      do {
        notificationId = generateNotificationId();
        existingNotification = await ctx.db
          .query("featureNotifications")
          .withIndex("by_notification_id", (q) => q.eq("notificationId", notificationId))
          .first();
      } while (existingNotification);

      await ctx.db.insert("featureNotifications", {
        notificationId,
        scope: notif.scope,
        scopeId: args.platformId || args.restaurantId,
        title: notif.title,
        message: notif.message,
        featureName: notif.featureName,
        type: notif.type,
        priority: notif.priority,
        dismissible: true,
        isActive: true,
        startsAt: now,
        expiresAt: thirtyDaysFromNow,
        createdAt: now,
      });

      createdIds.push(notificationId);
    }

    return {
      success: true,
      message: `Created ${createdIds.length} migration notifications`,
      notificationIds: createdIds,
    };
  },
});

/**
 * Expire old notifications
 * 
 * Deactivates notifications past their expiration date.
 * Should be run periodically (e.g., daily cron job).
 */
export const expireOldNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const activeNotifications = await ctx.db
      .query("featureNotifications")
      .withIndex("by_is_active", (q) => q.eq("isActive", true))
      .collect();

    let expiredCount = 0;

    for (const notification of activeNotifications) {
      if (notification.expiresAt && now > notification.expiresAt) {
        await ctx.db.patch(notification._id, { isActive: false });
        expiredCount++;
      }
    }

    return {
      success: true,
      message: `Expired ${expiredCount} notifications`,
      expiredCount,
    };
  },
});
