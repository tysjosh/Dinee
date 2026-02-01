import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Platform settings validator (reusable)
const platformSettingsValidator = v.object({
  defaultLanguage: v.union(
    v.literal("english"),
    v.literal("nigerian_english"),
    v.literal("pidgin"),
    v.literal("spanish"),
    v.literal("french")
  ),
  enabledPaymentMethods: v.array(
    v.union(v.literal("paystack"), v.literal("flutterwave"), v.literal("cod"))
  ),
  whatsappEnabled: v.boolean(),
  smsEnabled: v.boolean(),
});

// Type for platform settings
type PlatformSettings = {
  defaultLanguage: "english" | "nigerian_english" | "pidgin" | "spanish" | "french";
  enabledPaymentMethods: ("paystack" | "flutterwave" | "cod")[];
  whatsappEnabled: boolean;
  smsEnabled: boolean;
};

// Generate a unique platform ID (8-character alphanumeric)
function generatePlatformId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Default platform settings
function getDefaultSettings(): PlatformSettings {
  return {
    defaultLanguage: "english",
    enabledPaymentMethods: ["paystack", "cod"],
    whatsappEnabled: true,
    smsEnabled: true,
  };
}

/**
 * Create a new platform
 */
export const createPlatform = mutation({
  args: {
    name: v.string(),
    settings: v.optional(platformSettingsValidator),
  },
  handler: async (ctx, args) => {
    // Generate unique platform ID
    let platformId: string;
    let existingPlatform;

    do {
      platformId = generatePlatformId();
      existingPlatform = await ctx.db
        .query("platforms")
        .withIndex("by_platform_id", (q) => q.eq("platformId", platformId))
        .first();
    } while (existingPlatform);

    const settings = args.settings ?? getDefaultSettings();

    const docId = await ctx.db.insert("platforms", {
      platformId,
      name: args.name,
      settings,
      createdAt: Date.now(),
    });

    return { platformId, docId };
  },
});

/**
 * Get a platform by platformId
 */
export const getPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();

    return platform;
  },
});

/**
 * Get all platforms
 */
export const getAllPlatforms = query({
  args: {},
  handler: async (ctx) => {
    const platforms = await ctx.db.query("platforms").collect();
    return platforms;
  },
});

/**
 * Update a platform
 */
export const updatePlatform = mutation({
  args: {
    platformId: v.string(),
    name: v.optional(v.string()),
    settings: v.optional(platformSettingsValidator),
  },
  handler: async (ctx, args) => {
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();

    if (!platform) {
      throw new Error("Platform not found");
    }

    // Build updates object with only provided fields
    const updates: {
      name?: string;
      settings?: PlatformSettings;
    } = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }

    if (args.settings !== undefined) {
      updates.settings = args.settings;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(platform._id, updates);
    }

    return platform._id;
  },
});

/**
 * Update platform settings (partial update)
 */
export const updatePlatformSettings = mutation({
  args: {
    platformId: v.string(),
    defaultLanguage: v.optional(
      v.union(
        v.literal("english"),
        v.literal("nigerian_english"),
        v.literal("pidgin"),
        v.literal("spanish"),
        v.literal("french")
      )
    ),
    enabledPaymentMethods: v.optional(
      v.array(
        v.union(v.literal("paystack"), v.literal("flutterwave"), v.literal("cod"))
      )
    ),
    whatsappEnabled: v.optional(v.boolean()),
    smsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();

    if (!platform) {
      throw new Error("Platform not found");
    }

    // Merge existing settings with updates
    const updatedSettings: PlatformSettings = {
      ...platform.settings,
    };

    if (args.defaultLanguage !== undefined) {
      updatedSettings.defaultLanguage = args.defaultLanguage;
    }
    if (args.enabledPaymentMethods !== undefined) {
      updatedSettings.enabledPaymentMethods = args.enabledPaymentMethods;
    }
    if (args.whatsappEnabled !== undefined) {
      updatedSettings.whatsappEnabled = args.whatsappEnabled;
    }
    if (args.smsEnabled !== undefined) {
      updatedSettings.smsEnabled = args.smsEnabled;
    }

    await ctx.db.patch(platform._id, { settings: updatedSettings });

    return platform._id;
  },
});

/**
 * Delete a platform
 */
export const deletePlatform = mutation({
  args: { platformId: v.string() },
  handler: async (ctx, args) => {
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", args.platformId))
      .first();

    if (!platform) {
      throw new Error("Platform not found");
    }

    await ctx.db.delete(platform._id);

    return { success: true, platformId: args.platformId };
  },
});
