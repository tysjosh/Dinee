import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Migration Step 3: Gate restaurant flows behind feature flag.
 *
 * Creates a business-scope `restaurant_pack_enabled` feature flag
 * (enabled: true) for each existing restaurant business, so that
 * restaurant-specific UI and API endpoints are gated behind the flag.
 *
 * Targets restaurants with vertical "restaurant" or no vertical set
 * (legacy records that haven't been through step 1 yet).
 *
 * Idempotent: skips businesses that already have a business-scope
 * `restaurant_pack_enabled` flag.
 *
 * Requirements: 16.1, 16.3
 */

function generateFlagId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "FF";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const execute = mutation({
  args: {
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batch = args.batchSize ?? 100;

    // Query all restaurants — those with vertical "restaurant" or no vertical (legacy)
    const allRestaurants = await ctx.db.query("restaurants").collect();
    const targetRestaurants = allRestaurants.filter(
      (r) => r.vertical === "restaurant" || !r.vertical
    );

    let createdCount = 0;
    let skippedCount = 0;
    const created: string[] = [];
    const skipped: string[] = [];

    for (const restaurant of targetRestaurants.slice(0, batch)) {
      // Check if a business-scope restaurant_pack_enabled flag already exists for this business
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_name", (q) => q.eq("name", "restaurant_pack_enabled"))
        .filter((q) =>
          q.and(
            q.eq(q.field("scope"), "business"),
            q.eq(q.field("scopeId"), restaurant.restaurantId)
          )
        )
        .first();

      if (existing) {
        skippedCount++;
        skipped.push(restaurant.restaurantId);
        continue;
      }

      if (!args.dryRun) {
        await ctx.db.insert("featureFlags", {
          flagId: generateFlagId(),
          name: "restaurant_pack_enabled",
          enabled: true,
          scope: "business",
          scopeId: restaurant.restaurantId,
          reason: "Migration step 3: enable restaurant pack for existing restaurant business",
          createdAt: now,
          updatedAt: now,
        });
      }

      createdCount++;
      created.push(restaurant.restaurantId);
    }

    return {
      dryRun: args.dryRun,
      totalTargeted: targetRestaurants.length,
      createdCount,
      skippedCount,
      created,
      skipped,
    };
  },
});
