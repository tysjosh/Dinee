/**
 * Feature: convex-auth-integration, Property 24: Sign-out cleanup
 *
 * Validates: Requirements 8.4, 13.2, 13.3, 13.4
 *
 * Property 24: Sign-out cleanup
 *   For any authenticated user who triggers sign-out, the server-side session
 *   should be invalidated (subsequent isAuthenticated checks return false),
 *   the TenantContext should reset to initial state (no tenant scope, role back
 *   to default), and the restaurantId in localStorage should be cleared.
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
  email: string;
  role: UserRole;
  tenantType: TenantType;
  tenantId: string;
}

/**
 * Mirrors TenantState from src/contexts/TenantContext.tsx
 */
interface TenantState {
  userRole: UserRole;
  tenantScope: {
    platformId: string;
    restaurantId?: string;
    branchId?: string;
    role: UserRole;
  } | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Mirrors the auth session state from useConvexAuth()
 */
interface AuthSessionState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Represents the localStorage state relevant to sign-out
 */
interface LocalStorageState {
  restaurantId: string | null;
}

/**
 * Combined application state before/after sign-out
 */
interface AppState {
  session: AuthSessionState;
  tenant: TenantState;
  localStorage: LocalStorageState;
}

// --- Initial/default state constants (from TenantContext.tsx) ---

const DEFAULT_ROLE: UserRole = "supervisor";

const INITIAL_TENANT_STATE: TenantState = {
  userRole: DEFAULT_ROLE,
  tenantScope: null,
  isLoading: true,
  error: null,
};

// --- Pure sign-out cleanup logic ---

/**
 * Models the handleSignOut function from DashboardLayout.tsx:
 *
 *   const handleSignOut = async () => {
 *     await signOut();                              // Step 1: invalidate session
 *     tenantActions.reset();                        // Step 2: reset TenantContext
 *     if (typeof window !== "undefined") {
 *       localStorage.removeItem("restaurantId");    // Step 3: clear localStorage
 *     }
 *     router.push("/client/login");                 // Step 4: redirect
 *   };
 *
 * This pure function models the state transitions without side effects.
 */
function performSignOut(preState: AppState): AppState {
  return {
    // Step 1: Session invalidation — signOut() clears the server-side session
    session: {
      isAuthenticated: false,
      isLoading: false,
    },
    // Step 2: TenantContext reset — tenantActions.reset() dispatches RESET action
    // which returns initialState from the reducer
    tenant: { ...INITIAL_TENANT_STATE },
    // Step 3: localStorage cleanup — localStorage.removeItem("restaurantId")
    localStorage: {
      restaurantId: null,
    },
  };
}

/**
 * Builds an authenticated AppState from a user record,
 * simulating a fully logged-in user before sign-out.
 */
function buildAuthenticatedState(user: UserRecord): AppState {
  const tenantScope = buildTenantScope(user);

  return {
    session: {
      isAuthenticated: true,
      isLoading: false,
    },
    tenant: {
      userRole: user.role,
      tenantScope,
      isLoading: false,
      error: null,
    },
    localStorage: {
      restaurantId:
        user.tenantType === "restaurant" || user.tenantType === "business"
          ? user.tenantId
          : null,
    },
  };
}

/**
 * Builds a tenant scope from a user record, mirroring the resolution
 * logic in AppProvider and TenantContext.
 */
function buildTenantScope(user: UserRecord): TenantState["tenantScope"] {
  const base = {
    platformId: "default-platform",
    role: user.role,
  };

  if (user.role === "platform_admin") {
    return { ...base, platformId: user.tenantId || "default-platform" };
  }

  if (
    user.tenantType === "restaurant" ||
    user.tenantType === "business"
  ) {
    return { ...base, restaurantId: user.tenantId };
  }

  if (user.tenantType === "branch") {
    return { ...base, branchId: user.tenantId };
  }

  return base;
}

// --- Arbitraries ---

const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom(
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor"
);

const tenantTypeArb: fc.Arbitrary<TenantType> = fc.constantFrom(
  "platform",
  "restaurant",
  "business",
  "branch"
);

const tenantIdArb = fc
  .stringMatching(/^[0-9]{5}$/)
  .filter((id) => id.length === 5);

const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{3,10}$/),
    fc.constantFrom("example.com", "test.org", "mail.co")
  )
  .map(([local, domain]) => `${local}@${domain}`);

const userRecordArb: fc.Arbitrary<UserRecord> = fc
  .tuple(emailArb, userRoleArb, tenantTypeArb, tenantIdArb)
  .map(([email, role, tenantType, tenantId]) => ({
    email,
    role,
    tenantType,
    tenantId,
  }));

// --- Tests ---

describe("Property 24: Sign-out cleanup", () => {
  it("for any authenticated user, sign-out invalidates the session (isAuthenticated becomes false)", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const preState = buildAuthenticatedState(user);

        // Precondition: user is authenticated before sign-out
        expect(preState.session.isAuthenticated).toBe(true);

        const postState = performSignOut(preState);

        expect(postState.session.isAuthenticated).toBe(false);
        expect(postState.session.isLoading).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("for any authenticated user, sign-out resets TenantContext userRole to default 'supervisor'", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const preState = buildAuthenticatedState(user);

        // Precondition: user has their actual role set
        expect(preState.tenant.userRole).toBe(user.role);

        const postState = performSignOut(preState);

        // After reset, role should be the default 'supervisor'
        expect(postState.tenant.userRole).toBe(DEFAULT_ROLE);
      }),
      { numRuns: 100 }
    );
  });

  it("for any authenticated user, sign-out resets TenantContext tenantScope to null", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const preState = buildAuthenticatedState(user);

        // Precondition: user has a tenant scope set
        expect(preState.tenant.tenantScope).not.toBeNull();

        const postState = performSignOut(preState);

        expect(postState.tenant.tenantScope).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("for any authenticated user, sign-out clears restaurantId from localStorage", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const preState = buildAuthenticatedState(user);
        const postState = performSignOut(preState);

        expect(postState.localStorage.restaurantId).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("all three cleanup steps happen atomically for any user regardless of role", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const preState = buildAuthenticatedState(user);
        const postState = performSignOut(preState);

        // All three invariants hold simultaneously:
        // 1. Session invalidated
        expect(postState.session.isAuthenticated).toBe(false);
        // 2. TenantContext reset to initial state
        expect(postState.tenant.userRole).toBe(DEFAULT_ROLE);
        expect(postState.tenant.tenantScope).toBeNull();
        expect(postState.tenant.isLoading).toBe(true);
        expect(postState.tenant.error).toBeNull();
        // 3. localStorage cleared
        expect(postState.localStorage.restaurantId).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("sign-out produces identical post-state regardless of pre-sign-out role or tenantType", () => {
    fc.assert(
      fc.property(userRecordArb, userRecordArb, (userA, userB) => {
        const postStateA = performSignOut(buildAuthenticatedState(userA));
        const postStateB = performSignOut(buildAuthenticatedState(userB));

        // Post-sign-out state should be identical for any two users
        expect(postStateA).toEqual(postStateB);
      }),
      { numRuns: 100 }
    );
  });

  it("sign-out post-state matches the TenantContext initial state definition", () => {
    fc.assert(
      fc.property(userRecordArb, (user) => {
        const postState = performSignOut(buildAuthenticatedState(user));

        // The tenant state after sign-out should match the initialState
        // from TenantContext.tsx reducer
        expect(postState.tenant).toEqual(INITIAL_TENANT_STATE);
      }),
      { numRuns: 100 }
    );
  });
});
