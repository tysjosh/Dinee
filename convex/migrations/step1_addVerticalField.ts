import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Migration Step 1: Add vertical field and backfill existing tenants.
 *
 * Backfills all existing restaurant records with:
 *   - vertical: "restaurant"
 *   - enabledModules: ["core_platform", "restaurant_pack"]
 *
 * Idempotent: skips records that already have a vertical set.
 * Supports dry-run mode to preview affected records without modification.
 *
 * Requirements: 16.1, 16.2, 16.8, 16.9
 */
export const execute = mutation({
  args: {
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const businesses = await ctx.db.query("restaurants").collect();
    const needsMigration = businesses.filter((b) => !b.vertical);

    if (args.dryRun) {
      return {
        dryRun: true,
        affectedCount: needsMigration.length,
        sample: needsMigration.slice(0, 5).map((b) => b.restaurantId),
      };
    }

    let successCount = 0;
    const failedRecords: Array<{ id: string; error: string }> = [];
    const batch = args.batchSize ?? 100;

    for (const business of needsMigration.slice(0, batch)) {
      try {
        await ctx.db.patch(business._id, {
          vertical: "restaurant",
          enabledModules: ["core_platform", "restaurant_pack"],
        });
        successCount++;
      } catch (e) {
        failedRecords.push({
          id: business.restaurantId,
          error: String(e),
        });
      }
    }

    return {
      dryRun: false,
      totalTargeted: needsMigration.length,
      successCount,
      failedCount: failedRecords.length,
      failedRecords,
      successRate:
        needsMigration.length > 0
          ? (successCount / needsMigration.length * 100).toFixed(2) + "%"
          : "N/A",
    };
  },
});
