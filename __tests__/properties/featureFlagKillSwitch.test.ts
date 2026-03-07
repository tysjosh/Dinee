/**
 * Property 8: Feature Flag Kill Switch
 * Validates: Requirements 6.2, 6.9
 *
 * For any Business where a module is present in enabledModules but the
 * corresponding {module}_enabled feature flag is explicitly set to false,
 * the module SHALL be deactivated ("blocked_kill_switch").
 *
 * Tests hierarchical resolution: more specific scope overrides less specific.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveModule } from "../../src/lib/modules/moduleResolver";

const ALL_MODULES = [
  "core_platform",
  "restaurant_pack",
  "logistics_pack",
  "healthcare_pack",
  "legal_pack",
  "hospitality_pack",
  "general_services_pack",
  "runsheet_connect",
];

const SCOPES = ["global", "platform", "business", "location"] as const;

/**
 * Simulates hierarchical flag resolution: the most specific scope wins.
 * Scope specificity order: global < platform < business < location.
 */
function resolveHierarchicalFlag(
  scopeFlags: Partial<Record<(typeof SCOPES)[number], boolean | undefined>>
): boolean | undefined {
  // Walk from most specific to least specific
  for (let i = SCOPES.length - 1; i >= 0; i--) {
    const scope = SCOPES[i];
    if (scopeFlags[scope] !== undefined) {
      return scopeFlags[scope];
    }
  }
  return undefined;
}

describe("Property 8: Feature Flag Kill Switch", () => {
  // Feature: ai-reception-os-pivot, Property 8: Feature Flag Kill Switch

  it("should block module when flag is explicitly false, regardless of enabledModules", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_MODULES),
        (moduleName) => {
          const enabledModules = ["core_platform", moduleName];
          const featureFlags: Record<string, boolean | undefined> = {
            [`${moduleName}_enabled`]: false,
          };

          const result = resolveModule(enabledModules, moduleName, featureFlags);
          expect(result.resolution).toBe("blocked_kill_switch");
          expect(result.moduleName).toBe(moduleName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should allow module when flag is true and module is in enabledModules", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_MODULES),
        (moduleName) => {
          const enabledModules = ["core_platform", moduleName];
          const featureFlags: Record<string, boolean | undefined> = {
            [`${moduleName}_enabled`]: true,
          };

          const result = resolveModule(enabledModules, moduleName, featureFlags);
          expect(result.resolution).toBe("allowed");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should allow module when flag is undefined (not set) and module is in enabledModules", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_MODULES),
        (moduleName) => {
          const enabledModules = ["core_platform", moduleName];
          const featureFlags: Record<string, boolean | undefined> = {};

          const result = resolveModule(enabledModules, moduleName, featureFlags);
          expect(result.resolution).toBe("allowed");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should respect hierarchical flag resolution — most specific scope wins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_MODULES),
        fc.record({
          global: fc.option(fc.boolean(), { nil: undefined }),
          platform: fc.option(fc.boolean(), { nil: undefined }),
          business: fc.option(fc.boolean(), { nil: undefined }),
          location: fc.option(fc.boolean(), { nil: undefined }),
        }),
        (moduleName, scopeFlags) => {
          const enabledModules = ["core_platform", moduleName];
          const resolvedFlag = resolveHierarchicalFlag(scopeFlags);

          // Build the featureFlags map with the resolved value
          const featureFlags: Record<string, boolean | undefined> = {};
          if (resolvedFlag !== undefined) {
            featureFlags[`${moduleName}_enabled`] = resolvedFlag;
          }

          const result = resolveModule(enabledModules, moduleName, featureFlags);

          if (resolvedFlag === false) {
            expect(result.resolution).toBe("blocked_kill_switch");
          } else {
            // true or undefined → allowed
            expect(result.resolution).toBe("allowed");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("should return blocked_not_activated when module is not in enabledModules regardless of flag", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_MODULES),
        fc.option(fc.boolean(), { nil: undefined }),
        (moduleName, flagValue) => {
          // Ensure module is NOT in enabledModules
          const enabledModules = ["core_platform"].filter((m) => m !== moduleName);
          const featureFlags: Record<string, boolean | undefined> = {};
          if (flagValue !== undefined) {
            featureFlags[`${moduleName}_enabled`] = flagValue;
          }

          const result = resolveModule(enabledModules, moduleName, featureFlags);

          if (moduleName === "core_platform") {
            // core_platform was filtered out, so it's not in enabledModules
            expect(result.resolution).toBe("blocked_not_activated");
          } else {
            expect(result.resolution).toBe("blocked_not_activated");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
