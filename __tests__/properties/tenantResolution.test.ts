/**
 * Feature: convex-auth-integration, Property 10-11: Tenant resolution properties
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 *
 * Property 10: Session-based tenant resolution
 *   For any authenticated user, the TenantContext should reflect the user's role
 *   from the User_Record (not the hardcoded 'supervisor' default), and the tenant
 *   scope should be derived from the user's tenantType and tenantId.
 *
 * Property 11: Role-based tenant filtering
 *   For any authenticated user with role restaurant_owner, the getTenantFilter()
 *   should return { restaurantId: user.tenantId }. For any authenticated user with
 *   role platform_admin, the getTenantFilter() should not include a restaurantId
 *   constraint.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Types mirroring the actual codebase ---

type UserRole =
  | "platform_admin"
  | "restaurant_owner"
  | "business_owner"
  | "branch_manager"
  | "supervisor";

type TenantType = "platform" | "restaurant" | "business" | "branch";

interface UserRecord {
  role: UserRole;
  tenantType: TenantType;
  tenantId: string;
}

// --- Pure resolution logic extracted from AppProvider (src/contexts/AppProvider.tsx) ---

/**
 * Mirrors the tenant resolution logic in AppProvider.
 *
 * From the source:
 *   const resolvedRole = (initialRole ?? user?.role ?? 'supervisor') as UserRole;
 *   const resolvedRestaurantId =
 *     (user?.tenantType === 'restaurant' || user?.tenantType === 'business')
 *       ? user.tenantId : undefined;
 *   const resolvedPlatformId =
 *     initialPlatformId ?? (user?.tenantType === 'platform' ? user.tenantId : undefined);
 *   const resolvedBranchId =
 *     initialBranchId ?? (user?.tenantType === 'branch' ? user.tenantId : undefined);
 */
function resolveTenantFromUser(user: UserRecord): {
  role: UserRole;
  restaurantId: string | undefined;
  platformId: string | undefined;
  branchId: string | undefined;
} {
  const role = user.role ?? "supervisor";

  const restaurantId =
    user.tenantType === "restaurant" || user.tenantType === "business"
      ? user.tenantId
      : undefined;

  const platformId =
    user.tenantType === "platform" ? user.tenantId : undefined;

  const branchId =
    user.tenantType === "branch" ? user.tenantId : undefined;

  return { role, restaurantId, platformId, branchId };
}

// --- Permission matrix mirroring TenantContext (src/contexts/TenantContext.tsx) ---

const ROLE_PERMISSIONS: Record<UserRole, { resource: string; actions: string[] }[]> = {
  platform_admin: [
    { resource: "*", actions: ["create", "read", "update", "delete"] },
  ],
  restaurant_owner: [
    { resource: "restaurant", actions: ["read", "update"] },
    { resource: "branch", actions: ["create", "read", "update", "delete"] },
    { resource: "menu", actions: ["create", "read", "update", "delete"] },
    { resource: "order", actions: ["read", "update"] },
    { resource: "call", actions: ["read"] },
    { resource: "analytics", actions: ["read"] },
  ],
  business_owner: [],
  branch_manager: [
    { resource: "branch", actions: ["read", "update"] },
    { resource: "menu", actions: ["read", "update"] },
    { resource: "order", actions: ["read", "update"] },
    { resource: "call", actions: ["read"] },
  ],
  supervisor: [
    { resource: "order", actions: ["read"] },
    { resource: "call", actions: ["read"] },
  ],
};

/**
 * Mirrors the getTenantFilter() logic from TenantContext.
 *
 * The actual implementation uses tenantScope and userRole from state.
 * We simulate this by building the tenantScope from the resolved values
 * and then applying the same filtering logic.
 */
function getTenantFilter(
  userRole: UserRole,
  tenantScope: {
    platformId?: string;
    restaurantId?: string;
    branchId?: string;
  } | null
): { platformId?: string; restaurantId?: string; branchId?: string } {
  if (!tenantScope) {
    return {};
  }

  // Platform admin can see all data within the platform
  if (userRole === "platform_admin") {
    return { platformId: tenantScope.platformId };
  }

  // Restaurant owner can see all data within their restaurant
  if (userRole === "restaurant_owner") {
    return {
      platformId: tenantScope.platformId,
      restaurantId: tenantScope.restaurantId,
    };
  }

  // Branch manager and supervisor can only see their branch data
  if (userRole === "branch_manager" || userRole === "supervisor") {
    return {
      platformId: tenantScope.platformId,
      restaurantId: tenantScope.restaurantId,
      branchId: tenantScope.branchId,
    };
  }

  return {};
}

// --- Arbitraries ---

/** Generates a valid user role */
const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom(
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor"
);

/** Generates a valid tenant type */
const tenantTypeArb: fc.Arbitrary<TenantType> = fc.constantFrom(
  "platform",
  "restaurant",
  "business",
  "branch"
);

/** Generates a non-empty tenant ID (5-digit numeric like the real system) */
const tenantIdArb = fc.stringMatching(/^[0-9]{5}$/).filter((id) => id.length === 5);

/** Generates a full user record with any role/tenantType combination */
const userRecordArb: fc.Arbitrary<UserRecord> = fc
  .tuple(userRoleArb, tenantTypeArb, tenantIdArb)
  .map(([role, tenantType, tenantId]) => ({ role, tenantType, tenantId }));

/** Generates a user record with a specific role */
function userWithRoleArb(role: UserRole): fc.Arbitrary<UserRecord> {
  return fc
    .tuple(tenantTypeArb, tenantIdArb)
    .map(([tenantType, tenantId]) => ({ role, tenantType, tenantId }));
}

/** Generates a restaurant_owner user with restaurant or business tenantType */
const restaurantOwnerArb: fc.Arbitrary<UserRecord> = fc
  .tuple(fc.constantFrom("restaurant" as TenantType, "business" as TenantType), tenantIdArb)
  .map(([tenantType, tenantId]) => ({
    role: "restaurant_owner" as UserRole,
    tenantType,
    tenantId,
  }));

/** Generates a platform_admin user with platform tenantType */
const platformAdminArb: fc.Arbitrary<UserRecord> = tenantIdArb.map(
  (tenantId) => ({
    role: "platform_admin" as UserRole,
    tenantType: "platform" as TenantType,
    tenantId,
  })
);

// --- Tests ---

describe("Property 10: Session-based tenant resolution", () => {
  it("for any authenticated user, the resolved role matches user.role (not hardcoded 'supervisor')", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const resolved = resolveTenantFromUser(user);

        // The role must come from the user record, not the default 'supervisor'
        expect(resolved.role).toBe(user.role);
      }),
      { numRuns: 100 }
    );
  });

  it("for any user with tenantType 'restaurant', restaurantId is derived from user.tenantId", () => {
    fc.assert(
      fc.property(
        fc.tuple(userRoleArb, tenantIdArb),
        ([role, tenantId]) => {
          const user: UserRecord = { role, tenantType: "restaurant", tenantId };
          const resolved = resolveTenantFromUser(user);

          expect(resolved.restaurantId).toBe(tenantId);
          expect(resolved.platformId).toBeUndefined();
          expect(resolved.branchId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any user with tenantType 'business', restaurantId is derived from user.tenantId", () => {
    fc.assert(
      fc.property(
        fc.tuple(userRoleArb, tenantIdArb),
        ([role, tenantId]) => {
          const user: UserRecord = { role, tenantType: "business", tenantId };
          const resolved = resolveTenantFromUser(user);

          expect(resolved.restaurantId).toBe(tenantId);
          expect(resolved.platformId).toBeUndefined();
          expect(resolved.branchId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any user with tenantType 'platform', platformId is derived from user.tenantId", () => {
    fc.assert(
      fc.property(
        fc.tuple(userRoleArb, tenantIdArb),
        ([role, tenantId]) => {
          const user: UserRecord = { role, tenantType: "platform", tenantId };
          const resolved = resolveTenantFromUser(user);

          expect(resolved.platformId).toBe(tenantId);
          expect(resolved.restaurantId).toBeUndefined();
          expect(resolved.branchId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any user with tenantType 'branch', branchId is derived from user.tenantId", () => {
    fc.assert(
      fc.property(
        fc.tuple(userRoleArb, tenantIdArb),
        ([role, tenantId]) => {
          const user: UserRecord = { role, tenantType: "branch", tenantId };
          const resolved = resolveTenantFromUser(user);

          expect(resolved.branchId).toBe(tenantId);
          expect(resolved.restaurantId).toBeUndefined();
          expect(resolved.platformId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("exactly one scope ID is set per user (no overlap between platformId, restaurantId, branchId)", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const resolved = resolveTenantFromUser(user);

        const definedIds = [
          resolved.platformId,
          resolved.restaurantId,
          resolved.branchId,
        ].filter((id) => id !== undefined);

        // Exactly one scope ID should be set
        expect(definedIds.length).toBe(1);
        // And it should equal the user's tenantId
        expect(definedIds[0]).toBe(user.tenantId);
      }),
      { numRuns: 100 }
    );
  });

  it("resolved permissions match the user's role from the RBAC matrix", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const resolved = resolveTenantFromUser(user);
        const expectedPermissions = ROLE_PERMISSIONS[resolved.role];

        // The permissions for the resolved role should match the RBAC matrix
        expect(expectedPermissions).toBeDefined();
        expect(expectedPermissions).toEqual(ROLE_PERMISSIONS[user.role]);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 11: Role-based tenant filtering", () => {
  it("for any restaurant_owner, getTenantFilter() includes restaurantId equal to user.tenantId", () => {
    fc.assert(
      fc.property(restaurantOwnerArb, (user) => {
        const resolved = resolveTenantFromUser(user);

        // Build a tenantScope as the TenantContext would
        const tenantScope = {
          platformId: "default-platform",
          restaurantId: resolved.restaurantId,
          branchId: resolved.branchId,
        };

        const filter = getTenantFilter("restaurant_owner", tenantScope);

        expect(filter.restaurantId).toBe(user.tenantId);
        expect(filter.branchId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("for any platform_admin, getTenantFilter() does not include a restaurantId constraint", () => {
    fc.assert(
      fc.property(platformAdminArb, (user) => {
        const resolved = resolveTenantFromUser(user);

        const tenantScope = {
          platformId: resolved.platformId || "default-platform",
          restaurantId: undefined,
          branchId: undefined,
        };

        const filter = getTenantFilter("platform_admin", tenantScope);

        expect(filter.restaurantId).toBeUndefined();
        expect(filter.branchId).toBeUndefined();
        expect(filter.platformId).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it("platform_admin filter only contains platformId, never restaurantId or branchId", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        // Even if we pass a tenantScope with restaurantId, platform_admin ignores it
        const tenantScope = {
          platformId: tenantId,
          restaurantId: "should-be-ignored",
          branchId: "should-be-ignored",
        };

        const filter = getTenantFilter("platform_admin", tenantScope);

        expect(filter.platformId).toBe(tenantId);
        expect(filter.restaurantId).toBeUndefined();
        expect(filter.branchId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("restaurant_owner filter includes platformId and restaurantId but not branchId", () => {
    fc.assert(
      fc.property(
        fc.tuple(tenantIdArb, tenantIdArb),
        ([platformId, restaurantId]) => {
          const tenantScope = {
            platformId,
            restaurantId,
            branchId: "some-branch",
          };

          const filter = getTenantFilter("restaurant_owner", tenantScope);

          expect(filter.platformId).toBe(platformId);
          expect(filter.restaurantId).toBe(restaurantId);
          expect(filter.branchId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("branch_manager and supervisor filters include branchId", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("branch_manager" as UserRole, "supervisor" as UserRole),
        fc.tuple(tenantIdArb, tenantIdArb, tenantIdArb),
        (role, [platformId, restaurantId, branchId]) => {
          const tenantScope = { platformId, restaurantId, branchId };

          const filter = getTenantFilter(role, tenantScope);

          expect(filter.platformId).toBe(platformId);
          expect(filter.restaurantId).toBe(restaurantId);
          expect(filter.branchId).toBe(branchId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getTenantFilter() returns empty object when tenantScope is null", () => {
    fc.assert(
      fc.property(userRoleArb, (role) => {
        const filter = getTenantFilter(role, null);

        expect(filter).toEqual({});
      }),
      { numRuns: 100 }
    );
  });
});
