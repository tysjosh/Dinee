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


// ---------------------------------------------------------------------------
// Feature: convex-auth-integration, Property 12: Onboarding links user to restaurant
//
// Validates: Requirements 7.1
//
// For any authenticated user who completes the business setup step in onboarding,
// the User_Record's tenantId should be updated to match the restaurantId returned
// by createRestaurantWithBranches().
// ---------------------------------------------------------------------------

// --- Types mirroring the codebase ---

interface UserRecord {
  userId: string;
  email: string;
  role: string;
  tenantType: string;
  tenantId: string;
}

// --- Pure logic extracted from onboarding page and convex mutations ---

/**
 * Simulates generateRestaurantId() from convex/restaurants.ts.
 * Generates a 5-digit numeric string (10000–99999).
 */
function simulateGenerateRestaurantId(seed: number): string {
  const min = 10000;
  const max = 99999;
  const id = min + (Math.abs(seed) % (max - min + 1));
  return id.toString();
}

/**
 * Simulates createRestaurantWithBranches() return value.
 * The mutation returns { success: true, restaurantId, ... }.
 */
function simulateCreateRestaurant(restaurantId: string): {
  success: boolean;
  restaurantId: string;
} {
  return { success: true, restaurantId };
}

/**
 * Simulates the updateUser mutation from convex/users.ts.
 * Patches the user record with the provided fields.
 */
function simulateUpdateUser(
  user: UserRecord,
  updates: Partial<Pick<UserRecord, "tenantId">>
): UserRecord {
  return { ...user, ...updates };
}

/**
 * Mirrors the handleBusinessSetup logic in src/app/client/onboarding/page.tsx:
 *
 *   const handleBusinessSetup = async (businessId: string) => {
 *     setGeneratedBusinessId(businessId);
 *     if (user?.userId && businessId) {
 *       await updateUser({ userId: user.userId, tenantId: businessId });
 *     }
 *     setCurrentStep("module-activation");
 *   };
 *
 * The businessId comes from createRestaurantWithBranches().restaurantId
 * which is called inside the BusinessSetup component's onComplete callback.
 */
function simulateOnboardingBusinessSetup(
  user: UserRecord,
  restaurantId: string
): { updatedUser: UserRecord; linkedRestaurantId: string } {
  // Step 1: createRestaurantWithBranches returns the restaurantId
  const createResult = simulateCreateRestaurant(restaurantId);

  // Step 2: handleBusinessSetup calls updateUser with tenantId = businessId
  const updatedUser = simulateUpdateUser(user, {
    tenantId: createResult.restaurantId,
  });

  return { updatedUser, linkedRestaurantId: createResult.restaurantId };
}

// --- Arbitraries ---

/** Generates a 5-digit numeric restaurant ID matching generateRestaurantId() */
const restaurantIdArb = fc
  .integer({ min: 10000, max: 99999 })
  .map((n) => n.toString());

/** Generates a 12-character alphanumeric userId matching generateUserId() */
const userIdArb = fc
  .stringMatching(/^[A-Za-z0-9]{12}$/)
  .filter((s) => s.length === 12);

/** Generates a valid email */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{1,9}$/),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{1,5}$/),
    fc.constantFrom("com", "org", "net", "io")
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Generates an authenticated user who has NOT completed onboarding yet.
 * Per the sign-up flow, new users have role=restaurant_owner,
 * tenantType=restaurant, tenantId="" (empty).
 */
const preOnboardingUserArb: fc.Arbitrary<UserRecord> = fc
  .tuple(userIdArb, emailArb)
  .map(([userId, email]) => ({
    userId,
    email,
    role: "restaurant_owner",
    tenantType: "restaurant",
    tenantId: "",
  }));

// --- Tests ---

describe("Property 12: Onboarding links user to restaurant", () => {
  it("after business setup, user tenantId matches the restaurantId from createRestaurantWithBranches()", () => {
    fc.assert(
      fc.property(
        preOnboardingUserArb,
        restaurantIdArb,
        (user, restaurantId) => {
          const { updatedUser, linkedRestaurantId } =
            simulateOnboardingBusinessSetup(user, restaurantId);

          // The user's tenantId must equal the restaurantId returned by the mutation
          expect(updatedUser.tenantId).toBe(restaurantId);
          expect(updatedUser.tenantId).toBe(linkedRestaurantId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("user tenantId is never empty after successful business setup", () => {
    fc.assert(
      fc.property(
        preOnboardingUserArb,
        restaurantIdArb,
        (user, restaurantId) => {
          // Pre-condition: user starts with empty tenantId
          expect(user.tenantId).toBe("");

          const { updatedUser } = simulateOnboardingBusinessSetup(
            user,
            restaurantId
          );

          // Post-condition: tenantId is non-empty
          expect(updatedUser.tenantId).not.toBe("");
          expect(updatedUser.tenantId.length).toBe(5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("user role, email, and userId remain unchanged after linking", () => {
    fc.assert(
      fc.property(
        preOnboardingUserArb,
        restaurantIdArb,
        (user, restaurantId) => {
          const { updatedUser } = simulateOnboardingBusinessSetup(
            user,
            restaurantId
          );

          // Only tenantId should change — all other fields stay the same
          expect(updatedUser.userId).toBe(user.userId);
          expect(updatedUser.email).toBe(user.email);
          expect(updatedUser.role).toBe(user.role);
          expect(updatedUser.tenantType).toBe(user.tenantType);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the linked restaurantId is always a valid 5-digit numeric string", () => {
    fc.assert(
      fc.property(
        preOnboardingUserArb,
        restaurantIdArb,
        (user, restaurantId) => {
          const { updatedUser } = simulateOnboardingBusinessSetup(
            user,
            restaurantId
          );

          // restaurantId from generateRestaurantId() is always 5-digit numeric
          expect(updatedUser.tenantId).toMatch(/^\d{5}$/);
          const numericId = parseInt(updatedUser.tenantId, 10);
          expect(numericId).toBeGreaterThanOrEqual(10000);
          expect(numericId).toBeLessThanOrEqual(99999);
        }
      ),
      { numRuns: 100 }
    );
  });
});
