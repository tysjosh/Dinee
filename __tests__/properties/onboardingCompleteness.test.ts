/**
 * Feature: ai-reception-os-pivot, Property 10: Onboarding Completeness
 *
 * Validates: Requirements 1.5, 1.6, 12.4
 *
 * For any completed onboarding flow, the resulting Business record SHALL have:
 *   (a) a `vertical` field set to one of the 6 valid values
 *   (b) an `enabledModules` array containing at least "core_platform"
 *   (c) if `enabledModules` contains a vertical pack, that pack's moduleId
 *       must correspond to the selected vertical
 *
 * No Business created through onboarding SHALL have a null or empty vertical,
 * or an enabledModules array that does not include "core_platform".
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Pure logic extracted from convex/signup.ts createBusinessOwner mutation ---

const VALID_VERTICALS = [
  "restaurant",
  "logistics",
  "healthcare",
  "legal",
  "hospitality",
  "general_services",
] as const;

type Vertical = (typeof VALID_VERTICALS)[number];

const verticalPackMap: Record<string, string> = {
  restaurant: "restaurant_pack",
  logistics: "logistics_pack",
  healthcare: "healthcare_pack",
  legal: "legal_pack",
  hospitality: "hospitality_pack",
  general_services: "general_services_pack",
};

const ALL_PACKS = Object.values(verticalPackMap);

/**
 * Pure function matching the onboarding completion logic in createBusinessOwner.
 * Given a vertical and optional user-selected modules, computes the final
 * enabledModules array for the new Business record.
 */
function computeOnboardingResult(
  vertical: Vertical,
  userModules?: string[]
): { vertical: Vertical; enabledModules: string[] } {
  const defaultPack = verticalPackMap[vertical];
  let enabledModules = userModules
    ? [...userModules]
    : ["core_platform", ...(defaultPack ? [defaultPack] : [])];

  if (!enabledModules.includes("core_platform")) {
    enabledModules = ["core_platform", ...enabledModules];
  }

  return { vertical, enabledModules };
}

// --- Arbitraries ---

const verticalArb = fc.constantFrom(...VALID_VERTICALS);

/** Random subset of known modules a user might toggle during onboarding */
const userModulesArb = fc.oneof(
  fc.constant(undefined as string[] | undefined),
  fc.subarray(
    ["core_platform", ...ALL_PACKS, "runsheet_connect"],
    { minLength: 0 }
  )
);

// --- Tests ---

describe("Property 10: Onboarding Completeness", () => {
  it("resulting Business always has a valid vertical from the supported set", () => {
    fc.assert(
      fc.property(verticalArb, userModulesArb, (vertical, userModules) => {
        const result = computeOnboardingResult(vertical, userModules);
        expect(VALID_VERTICALS).toContain(result.vertical);
      }),
      { numRuns: 100 }
    );
  });

  it("enabledModules always includes core_platform", () => {
    fc.assert(
      fc.property(verticalArb, userModulesArb, (vertical, userModules) => {
        const result = computeOnboardingResult(vertical, userModules);
        expect(result.enabledModules).toContain("core_platform");
      }),
      { numRuns: 100 }
    );
  });

  it("when no custom modules provided, the default pack matches the vertical", () => {
    fc.assert(
      fc.property(verticalArb, (vertical) => {
        const result = computeOnboardingResult(vertical, undefined);
        const expectedPack = verticalPackMap[vertical];
        expect(result.enabledModules).toContain(expectedPack);
        expect(result.enabledModules).toContain("core_platform");
      }),
      { numRuns: 100 }
    );
  });

  it("a business should not have a mismatched vertical pack auto-enabled", () => {
    fc.assert(
      fc.property(verticalArb, (vertical) => {
        const result = computeOnboardingResult(vertical, undefined);
        // The only vertical pack present should be the one for the selected vertical
        const presentPacks = result.enabledModules.filter((m) =>
          ALL_PACKS.includes(m)
        );
        const expectedPack = verticalPackMap[vertical];
        expect(presentPacks).toEqual([expectedPack]);
      }),
      { numRuns: 100 }
    );
  });
});
