/**
 * Logistics Feature Gate
 *
 * Checks whether logistics functionality is enabled for a given platform.
 * Both conditions must be true:
 *   1. The platform's `enabledVerticals` array includes `"logistics"`
 *   2. The `logistics_api_enabled` feature flag is enabled for the platform
 *
 * @module logistics/feature-gate
 * @requirements 29.1, 29.2, 29.3, 29.5
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

/**
 * Determine whether logistics API access is enabled for a platform.
 *
 * Returns `true` only when the platform exists, its `enabledVerticals`
 * contains `"logistics"`, AND the `logistics_api_enabled` feature flag
 * is set to `true` at the platform scope.
 */
export async function isLogisticsEnabled(
  convexClient: ConvexHttpClient,
  platformId: string
): Promise<boolean> {
  // 1. Fetch the platform record
  const platform = await convexClient.query(api.platforms.getPlatform, {
    platformId,
  });

  if (!platform) {
    return false;
  }

  // Check enabledVerticals includes "logistics"
  const enabledVerticals = platform.enabledVerticals ?? [];
  if (!enabledVerticals.includes("logistics")) {
    return false;
  }

  // 2. Check the logistics_api_enabled feature flag for this platform
  const flag = await convexClient.query(api.featureFlags.getFlag, {
    name: "logistics_api_enabled",
    scope: "platform",
    scopeId: platformId,
  });

  if (!flag || !flag.enabled) {
    return false;
  }

  return true;
}
