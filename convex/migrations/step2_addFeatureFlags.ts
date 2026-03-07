import { mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Migration Step 2: Add feature flags for vertical packs.
 *
 * Creates global-scope feature flag records for all vertical pack flags
 * and runsheet_connect_enabled, defaulting to disabled.
 *
 * Idempotent: skips flags that already exist at global scope.
 * Supports dry-run mode to preview what would be created.
 *
 * Requirements: 16.1, 6.4
 */

const VERTICAL_PACK_FLAGS = [
  { name: "restaurant_pack_enabled", description: "Enables the restaurant vertical pack" },
  { name: "logistics_pack_enabled", description: "Enables the logistics vertical pack" },
  { name: "healthcare_pack_enabled", description: "Enables the healthcare vertical pack" },
  { name: "legal_pack_enabled", description: "Enables the legal vertical pack" },
  { name: "hospitality_pack_enabled", description: "Enables the hospitality vertical pack" },
  { name: "general_services_pack_enabled", description: "Enables the general services vertical pack" },
  { name: "runsheet_connect_enabled", description: "Enables the Runsheet Connect integration" },
] as const;

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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let createdCount = 0;
    let skippedCount = 0;
    const created: string[] = [];
    const skipped: string[] = [];

    for (const flag of VERTICAL_PACK_FLAGS) {
      // Check if a global-scope flag with this name already exists
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_name", (q) => q.eq("name", flag.name))
        .filter((q) => q.eq(q.field("scope"), "global"))
        .first();

      if (existing) {
        skippedCount++;
        skipped.push(flag.name);
        continue;
      }

      if (!args.dryRun) {
        await ctx.db.insert("featureFlags", {
          flagId: generateFlagId(),
          name: flag.name,
          enabled: false,
          scope: "global",
          reason: "Migration step 2: default disabled for new vertical pack flag",
          createdAt: now,
          updatedAt: now,
        });
      }

      createdCount++;
      created.push(flag.name);
    }

    return {
      dryRun: args.dryRun,
      createdCount,
      skippedCount,
      created,
      skipped,
    };
  },
});
