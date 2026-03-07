/**
 * Feature: ai-reception-os-pivot, Property 1: Module Resolution Correctness
 *
 * Validates: Requirements 6.7, 6.8, 6.9
 *
 * For any Business with any combination of enabledModules entries and any set
 * of feature flag values (including undefined), resolveModule SHALL return:
 *   - "blocked_not_activated" if the module is NOT in enabledModules
 *   - "blocked_kill_switch" if the module IS in enabledModules AND the flag is explicitly false
 *   - "allowed" if the module IS in enabledModules AND the flag is true or undefined
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveModule,
  type ModuleResolution,
} from "../../src/lib/modules/moduleResolver";

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

/** Arbitrary: a random subset of ALL_MODULES */
const enabledModulesArb = fc.subarray(ALL_MODULES, { minLength: 0 });

/** Arbitrary: a module name drawn from known modules plus random strings */
const moduleNameArb = fc.oneof(
  fc.constantFrom(...ALL_MODULES),
  fc.string({ minLength: 1, maxLength: 30 })
);

/** Arbitrary: feature flag value — true, false, or undefined */
const flagValueArb = fc.oneof(
  fc.constant(true as boolean | undefined),
  fc.constant(false as boolean | undefined),
  fc.constant(undefined as boolean | undefined)
);

/** Arbitrary: a feature flags map for a random subset of modules */
const featureFlagsArb = fc
  .array(fc.tuple(fc.constantFrom(...ALL_MODULES), flagValueArb), {
    minLength: 0,
    maxLength: ALL_MODULES.length,
  })
  .map((pairs) => {
    const flags: Record<string, boolean | undefined> = {};
    for (const [mod, val] of pairs) {
      flags[`${mod}_enabled`] = val;
    }
    return flags;
  });

describe("Property 1: Module Resolution Correctness", () => {
  it("returns the correct resolution per the precedence truth table", () => {
    fc.assert(
      fc.property(
        enabledModulesArb,
        moduleNameArb,
        featureFlagsArb,
        (enabledModules, moduleName, featureFlags) => {
          const result = resolveModule(
            enabledModules,
            moduleName,
            featureFlags
          );

          const inEnabled = enabledModules.includes(moduleName);
          const flagKey = `${moduleName}_enabled`;
          const flagValue = featureFlags[flagKey];

          let expected: ModuleResolution;
          if (!inEnabled) {
            expected = "blocked_not_activated";
          } else if (flagValue === false) {
            expected = "blocked_kill_switch";
          } else {
            expected = "allowed";
          }

          expect(result.resolution).toBe(expected);
          expect(result.moduleName).toBe(moduleName);
        }
      ),
      { numRuns: 100 }
    );
  });
});
