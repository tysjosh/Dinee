/**
 * Module Resolver — determines whether a module is active for a given business.
 *
 * Precedence rule (Requirements 6.7, 6.8, 6.9, 6.10):
 *
 *   `enabledModules` on the Business record is the SOURCE OF TRUTH for module
 *   activation. Feature flags (`<module>_enabled`) are ROLLOUT GUARDRAILS only
 *   — they act as a kill switch, not as the primary activation mechanism.
 *
 *   Resolution logic:
 *     1. If the module is NOT in `enabledModules` → blocked (not activated).
 *        The feature flag state is irrelevant.
 *     2. If the module IS in `enabledModules`:
 *        a. Check the corresponding feature flag `<moduleName>_enabled`.
 *        b. If the flag is explicitly `false` → blocked (kill switch).
 *        c. If the flag is `true` OR `undefined` (not set) → allowed.
 *
 *   This means a module can only be active when BOTH conditions hold:
 *     - The business has opted in via `enabledModules`, AND
 *     - The feature flag has not been set to `false`.
 */

export type ModuleResolution =
  | "allowed"
  | "blocked_not_activated"
  | "blocked_kill_switch";

export interface ModuleResolverResult {
  resolution: ModuleResolution;
  moduleName: string;
}

/**
 * Resolves whether a module is active for a given business.
 *
 * @param businessEnabledModules - The `enabledModules` array from the Business
 *   record. This is the tenant configuration source of truth (Req 6.7).
 * @param moduleName - The module identifier to check, e.g. "restaurant_pack".
 * @param featureFlags - A map of resolved feature flag values. Flags use the
 *   naming convention `<moduleName>_enabled`. A value of `false` acts as a
 *   kill switch (Req 6.8). A value of `true` or `undefined` does not block.
 * @returns A result indicating whether the module is allowed, blocked because
 *   the business hasn't activated it, or blocked by a feature flag kill switch.
 */
export function resolveModule(
  businessEnabledModules: string[],
  moduleName: string,
  featureFlags: Record<string, boolean | undefined>
): ModuleResolverResult {
  // Step 1: Check enabledModules — tenant config is the source of truth (Req 6.7).
  // If the module is not in the business's enabledModules, it is not activated
  // regardless of any feature flag state.
  if (!businessEnabledModules.includes(moduleName)) {
    return { resolution: "blocked_not_activated", moduleName };
  }

  // Step 2: Check the feature flag kill switch (Req 6.8, 6.9).
  // Feature flags are rollout guardrails, not the primary activation mechanism.
  // The flag name follows the convention: `<moduleName>_enabled`.
  const flagName = `${moduleName}_enabled`;
  const flagValue = featureFlags[flagName];

  // If the flag is explicitly set to `false`, it acts as a kill switch —
  // the module is deactivated even though the business has it in enabledModules (Req 6.9).
  if (flagValue === false) {
    return { resolution: "blocked_kill_switch", moduleName };
  }

  // Flag is `true` or `undefined` (not set) — the module is allowed (Req 6.9).
  // An undefined flag means no rollout restriction has been applied.
  return { resolution: "allowed", moduleName };
}
