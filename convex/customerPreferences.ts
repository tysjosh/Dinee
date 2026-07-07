import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserOrInternal } from "./shared/ownership";

/**
 * Customer Preferences CRUD Operations
 *
 * Manages customer communication preferences for WhatsApp and SMS opt-in/opt-out.
 *
 * SECURITY: preferences are keyed by phone number (not tenant-scoped), so these
 * require either an authenticated session (a dashboard user handling the
 * customer) or the internal secret (server callers: WhatsApp webhook, messaging
 * routes). Previously fully public — anyone could opt any customer in/out.
 *
 * Validates: Requirements 13.1
 */

/**
 * Get customer preferences by phone number
 * Uses the by_phone index for efficient lookup
 */
export const getByPhoneNumber = query({
  args: {
    phoneNumber: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const preferences = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
    
    return preferences;
  },
});

/**
 * Create or update customer preferences
 * If preferences exist for the phone number, updates them; otherwise creates new record
 */
export const upsertPreferences = mutation({
  args: {
    phoneNumber: v.string(),
    whatsappOptIn: v.boolean(),
    smsOptIn: v.boolean(),
    preferredLanguage: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const existing = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing preferences
      await ctx.db.patch(existing._id, {
        whatsappOptIn: args.whatsappOptIn,
        smsOptIn: args.smsOptIn,
        preferredLanguage: args.preferredLanguage,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new preferences
      const id = await ctx.db.insert("customerPreferences", {
        phoneNumber: args.phoneNumber,
        whatsappOptIn: args.whatsappOptIn,
        smsOptIn: args.smsOptIn,
        preferredLanguage: args.preferredLanguage,
        updatedAt: now,
      });
      return id;
    }
  },
});

/**
 * Update WhatsApp opt-in status for a customer
 * Used when customer sends STOP/START keywords via WhatsApp
 * Validates: Requirements 13.4, 13.6
 */
export const updateWhatsAppOptIn = mutation({
  args: {
    phoneNumber: v.string(),
    optIn: v.boolean(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const existing = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing preferences
      await ctx.db.patch(existing._id, {
        whatsappOptIn: args.optIn,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new preferences with default SMS opt-in as false
      const id = await ctx.db.insert("customerPreferences", {
        phoneNumber: args.phoneNumber,
        whatsappOptIn: args.optIn,
        smsOptIn: false,
        updatedAt: now,
      });
      return id;
    }
  },
});

/**
 * Update SMS opt-in status for a customer
 */
export const updateSmsOptIn = mutation({
  args: {
    phoneNumber: v.string(),
    optIn: v.boolean(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const existing = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing preferences
      await ctx.db.patch(existing._id, {
        smsOptIn: args.optIn,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new preferences with default WhatsApp opt-in as false
      const id = await ctx.db.insert("customerPreferences", {
        phoneNumber: args.phoneNumber,
        whatsappOptIn: false,
        smsOptIn: args.optIn,
        updatedAt: now,
      });
      return id;
    }
  },
});

/**
 * Check if customer has opted in to WhatsApp messages
 * Used before sending any WhatsApp message
 * Validates: Requirements 13.7
 */
export const checkWhatsAppOptIn = query({
  args: {
    phoneNumber: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const preferences = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
    
    // If no preferences exist, customer has not opted in
    return preferences?.whatsappOptIn ?? false;
  },
});

/**
 * Check if customer has opted in to SMS messages
 */
export const checkSmsOptIn = query({
  args: {
    phoneNumber: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserOrInternal(ctx, args.internalSecret);
    const preferences = await ctx.db
      .query("customerPreferences")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
    
    // If no preferences exist, customer has not opted in
    return preferences?.smsOptIn ?? false;
  },
});
