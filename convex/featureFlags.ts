/**
 * Feature Flags Mutations and Queries
 * 
 * Convex operations for feature flag management during gradual migration.
 * Requirements: 28.5, 28.6
 * 
 * Key features:
 * - Store and retrieve feature flag overrides
 * - Support hierarchical flag resolution (global → platform → restaurant → branch)
 * - Track flag changes for audit purposes
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Feature flag scope validator
 */
const featureFlagScopeValidator = v.union(
  v.literal("global"),
  v.literal("platform"),
  v.literal("restaurant"),
  v.literal("branch")
);

/**
 * Feature flag name validator
 * Includes all feature flags defined in the system
 */
const featureFlagNameValidator = v.union(
  // Multi-tenancy features
  v.literal("multi_tenant_enabled"),
  v.literal("branch_support_enabled"),
  v.literal("platform_dashboard_enabled"),
  // Payment features
  v.literal("paystack_enabled"),
  v.literal("flutterwave_enabled"),
  v.literal("cod_enabled"),
  // Messaging features
  v.literal("whatsapp_enabled"),
  v.literal("sms_enabled"),
  v.literal("whatsapp_order_confirmation"),
  v.literal("whatsapp_status_updates"),
  // Voice features
  v.literal("nigerian_english_enabled"),
  v.literal("pidgin_enabled"),
  v.literal("voice_fallback_enabled"),
  // Delivery features
  v.literal("delivery_tracking_enabled"),
  v.literal("rider_api_enabled"),
  // Analytics features
  v.literal("funnel_analytics_enabled"),
  v.literal("agent_performance_dashboard"),
  // Advanced features
  v.literal("upsell_prompts_enabled"),
  v.literal("fraud_detection_enabled"),
  v.literal("multi_location_routing_enabled"),
  // Partner API features
  v.literal("partner_api_enabled"),
  v.literal("webhook_delivery_enabled"),
  // Billing features
  v.literal("self_serve_billing_enabled"),
  // Migration features
  v.literal("legacy_api_mode"),
  v.literal("migration_complete")
);

/**
 * Generate a unique flag ID
 */
function generateFlagId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "FF";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get all feature flag overrides
 * 
 * Returns all stored feature flag overrides from the database.
 */
export const getAllFlags = query({
  args: {},
  handler: async (ctx) => {
    const flags = await ctx.db.query("featureFlags").collect();
    return flags;
  },
});

/**
 * Get feature flags for a specific context
 * 
 * Returns feature flag overrides that apply to the given context.
 * This includes global flags and flags specific to the platform/restaurant/branch.
 */
export const getFlagsForContext = query({
  args: {
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allFlags = await ctx.db.query("featureFlags").collect();
    
    // Filter flags that apply to this context
    const applicableFlags = allFlags.filter((flag) => {
      // Global flags always apply
      if (flag.scope === "global") {
        return true;
      }
      
      // Platform flags apply if platformId matches
      if (flag.scope === "platform" && args.platformId && flag.scopeId === args.platformId) {
        return true;
      }
      
      // Restaurant flags apply if restaurantId matches
      if (flag.scope === "restaurant" && args.restaurantId && flag.scopeId === args.restaurantId) {
        return true;
      }
      
      // Branch flags apply if branchId matches
      if (flag.scope === "branch" && args.branchId && flag.scopeId === args.branchId) {
        return true;
      }
      
      return false;
    });
    
    return applicableFlags;
  },
});

/**
 * Get a specific feature flag
 */
export const getFlag = query({
  args: {
    name: featureFlagNameValidator,
    scope: featureFlagScopeValidator,
    scopeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const flags = await ctx.db.query("featureFlags").collect();
    
    return flags.find(
      (f) =>
        f.name === args.name &&
        f.scope === args.scope &&
        (args.scope === "global" || f.scopeId === args.scopeId)
    );
  },
});

/**
 * Set a feature flag
 * 
 * Creates or updates a feature flag override.
 * If the flag already exists for the given scope/scopeId, it will be updated.
 */
export const setFlag = mutation({
  args: {
    name: featureFlagNameValidator,
    enabled: v.boolean(),
    scope: featureFlagScopeValidator,
    scopeId: v.optional(v.string()),
    reason: v.optional(v.string()),
    setBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate scopeId requirement
    if (args.scope !== "global" && !args.scopeId) {
      return {
        success: false,
        message: `scopeId is required for ${args.scope} scope`,
      };
    }

    // Check if flag already exists
    const existingFlags = await ctx.db.query("featureFlags").collect();
    const existingFlag = existingFlags.find(
      (f) =>
        f.name === args.name &&
        f.scope === args.scope &&
        (args.scope === "global" || f.scopeId === args.scopeId)
    );

    const now = Date.now();

    if (existingFlag) {
      // Update existing flag
      await ctx.db.patch(existingFlag._id, {
        enabled: args.enabled,
        reason: args.reason,
        setBy: args.setBy,
        updatedAt: now,
      });

      return {
        success: true,
        message: `Feature flag ${args.name} updated`,
        flagId: existingFlag.flagId,
        isNew: false,
      };
    }

    // Create new flag
    const flagId = generateFlagId();
    await ctx.db.insert("featureFlags", {
      flagId,
      name: args.name,
      enabled: args.enabled,
      scope: args.scope,
      scopeId: args.scopeId,
      reason: args.reason,
      setBy: args.setBy,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      message: `Feature flag ${args.name} created`,
      flagId,
      isNew: true,
    };
  },
});

/**
 * Delete a feature flag override
 * 
 * Removes a feature flag override, reverting to the default value.
 */
export const deleteFlag = mutation({
  args: {
    name: featureFlagNameValidator,
    scope: featureFlagScopeValidator,
    scopeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingFlags = await ctx.db.query("featureFlags").collect();
    const existingFlag = existingFlags.find(
      (f) =>
        f.name === args.name &&
        f.scope === args.scope &&
        (args.scope === "global" || f.scopeId === args.scopeId)
    );

    if (!existingFlag) {
      return {
        success: false,
        message: `Feature flag ${args.name} not found for ${args.scope} scope`,
      };
    }

    await ctx.db.delete(existingFlag._id);

    return {
      success: true,
      message: `Feature flag ${args.name} deleted`,
      flagId: existingFlag.flagId,
    };
  },
});

/**
 * Bulk set feature flags
 * 
 * Sets multiple feature flags at once.
 * Useful for enabling/disabling a set of related features.
 */
export const bulkSetFlags = mutation({
  args: {
    flags: v.array(
      v.object({
        name: featureFlagNameValidator,
        enabled: v.boolean(),
        scope: featureFlagScopeValidator,
        scopeId: v.optional(v.string()),
        reason: v.optional(v.string()),
      })
    ),
    setBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      name: string;
      success: boolean;
      message: string;
    }> = [];

    const now = Date.now();
    const existingFlags = await ctx.db.query("featureFlags").collect();

    for (const flag of args.flags) {
      // Validate scopeId requirement
      if (flag.scope !== "global" && !flag.scopeId) {
        results.push({
          name: flag.name,
          success: false,
          message: `scopeId is required for ${flag.scope} scope`,
        });
        continue;
      }

      const existingFlag = existingFlags.find(
        (f) =>
          f.name === flag.name &&
          f.scope === flag.scope &&
          (flag.scope === "global" || f.scopeId === flag.scopeId)
      );

      try {
        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled: flag.enabled,
            reason: flag.reason,
            setBy: args.setBy,
            updatedAt: now,
          });
          results.push({
            name: flag.name,
            success: true,
            message: "Updated",
          });
        } else {
          const flagId = generateFlagId();
          await ctx.db.insert("featureFlags", {
            flagId,
            name: flag.name,
            enabled: flag.enabled,
            scope: flag.scope,
            scopeId: flag.scopeId,
            reason: flag.reason,
            setBy: args.setBy,
            createdAt: now,
            updatedAt: now,
          });
          results.push({
            name: flag.name,
            success: true,
            message: "Created",
          });
        }
      } catch (error) {
        results.push({
          name: flag.name,
          success: false,
          message: `Error: ${error}`,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      message: `Processed ${args.flags.length} flags: ${successCount} succeeded, ${failedCount} failed`,
      results,
    };
  },
});

/**
 * Enable migration phase features
 * 
 * Enables all features for a specific migration phase.
 * Useful for rolling out features in phases.
 */
export const enableMigrationPhase = mutation({
  args: {
    phase: v.union(
      v.literal("phase_1_multi_tenancy"),
      v.literal("phase_2_payments_messaging"),
      v.literal("phase_3_localization"),
      v.literal("complete")
    ),
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    setBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const phaseFeatures: Record<string, Array<{ name: string; scope: string }>> = {
      phase_1_multi_tenancy: [
        { name: "multi_tenant_enabled", scope: "global" },
        { name: "branch_support_enabled", scope: "restaurant" },
        { name: "platform_dashboard_enabled", scope: "platform" },
      ],
      phase_2_payments_messaging: [
        { name: "paystack_enabled", scope: "restaurant" },
        { name: "flutterwave_enabled", scope: "restaurant" },
        { name: "cod_enabled", scope: "restaurant" },
        { name: "whatsapp_enabled", scope: "platform" },
        { name: "sms_enabled", scope: "platform" },
        { name: "whatsapp_order_confirmation", scope: "restaurant" },
        { name: "whatsapp_status_updates", scope: "restaurant" },
        { name: "delivery_tracking_enabled", scope: "restaurant" },
        { name: "rider_api_enabled", scope: "restaurant" },
      ],
      phase_3_localization: [
        { name: "nigerian_english_enabled", scope: "restaurant" },
        { name: "pidgin_enabled", scope: "restaurant" },
        { name: "voice_fallback_enabled", scope: "restaurant" },
        { name: "funnel_analytics_enabled", scope: "platform" },
        { name: "agent_performance_dashboard", scope: "restaurant" },
      ],
      complete: [
        { name: "migration_complete", scope: "global" },
        { name: "legacy_api_mode", scope: "global" },
      ],
    };

    const features = phaseFeatures[args.phase] || [];
    const now = Date.now();
    const existingFlags = await ctx.db.query("featureFlags").collect();
    const results: Array<{ name: string; success: boolean }> = [];

    for (const feature of features) {
      // Determine scopeId based on feature scope
      let scopeId: string | undefined;
      if (feature.scope === "platform") {
        scopeId = args.platformId;
      } else if (feature.scope === "restaurant") {
        scopeId = args.restaurantId;
      }

      // Skip if scopeId is required but not provided
      if (feature.scope !== "global" && !scopeId) {
        results.push({ name: feature.name, success: false });
        continue;
      }

      const existingFlag = existingFlags.find(
        (f) =>
          f.name === feature.name &&
          f.scope === feature.scope &&
          (feature.scope === "global" || f.scopeId === scopeId)
      );

      try {
        // For "complete" phase, disable legacy_api_mode
        const enabled = args.phase === "complete" && feature.name === "legacy_api_mode" 
          ? false 
          : true;

        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled,
            reason: `Enabled for ${args.phase}`,
            setBy: args.setBy,
            updatedAt: now,
          });
        } else {
          const flagId = generateFlagId();
          await ctx.db.insert("featureFlags", {
            flagId,
            name: feature.name,
            enabled,
            scope: feature.scope as "global" | "platform" | "restaurant" | "branch",
            scopeId,
            reason: `Enabled for ${args.phase}`,
            setBy: args.setBy,
            createdAt: now,
            updatedAt: now,
          });
        }
        results.push({ name: feature.name, success: true });
      } catch (error) {
        console.error(`Failed to enable ${feature.name}:`, error);
        results.push({ name: feature.name, success: false });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: successCount === features.length,
      message: `Enabled ${successCount}/${features.length} features for ${args.phase}`,
      results,
    };
  },
});

/**
 * Get migration status based on feature flags
 */
export const getMigrationFeatureStatus = query({
  args: {
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allFlags = await ctx.db.query("featureFlags").collect();
    
    // Filter flags that apply to this context
    const applicableFlags = allFlags.filter((flag) => {
      if (flag.scope === "global") return true;
      if (flag.scope === "platform" && args.platformId && flag.scopeId === args.platformId) return true;
      if (flag.scope === "restaurant" && args.restaurantId && flag.scopeId === args.restaurantId) return true;
      if (flag.scope === "branch" && args.branchId && flag.scopeId === args.branchId) return true;
      return false;
    });

    // Check key features for each phase
    const phase1Features = ["multi_tenant_enabled", "branch_support_enabled", "platform_dashboard_enabled"];
    const phase2Features = ["paystack_enabled", "flutterwave_enabled", "whatsapp_enabled", "delivery_tracking_enabled"];
    const phase3Features = ["nigerian_english_enabled", "pidgin_enabled", "voice_fallback_enabled"];

    const isPhase1Enabled = phase1Features.some((f) => 
      applicableFlags.some((af) => af.name === f && af.enabled)
    );
    const isPhase2Enabled = phase2Features.some((f) => 
      applicableFlags.some((af) => af.name === f && af.enabled)
    );
    const isPhase3Enabled = phase3Features.some((f) => 
      applicableFlags.some((af) => af.name === f && af.enabled)
    );
    const isMigrationComplete = applicableFlags.some(
      (f) => f.name === "migration_complete" && f.enabled
    );

    // Determine current phase
    let phase: string;
    if (isMigrationComplete) {
      phase = "complete";
    } else if (isPhase3Enabled) {
      phase = "phase_3_localization";
    } else if (isPhase2Enabled) {
      phase = "phase_2_payments_messaging";
    } else if (isPhase1Enabled) {
      phase = "phase_1_multi_tenancy";
    } else {
      phase = "not_started";
    }

    // Count enabled features
    const enabledFeatures = applicableFlags.filter((f) => f.enabled).map((f) => f.name);
    const totalFeatures = 24; // Total non-internal features
    const completionPercentage = Math.round((enabledFeatures.length / totalFeatures) * 100);

    return {
      phase,
      enabledFeatures,
      enabledCount: enabledFeatures.length,
      totalFeatures,
      completionPercentage,
      isLegacyMode: applicableFlags.some((f) => f.name === "legacy_api_mode" && f.enabled),
    };
  },
});
