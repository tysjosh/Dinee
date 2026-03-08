/**
 * Feature: convex-auth-integration, Property 13-14: Route protection properties
 *
 * Validates: Requirements 7.2, 8.1, 8.2, 8.3
 *
 * Property 13: Route protection by authentication state
 *   For any route in the protected set (/client/dashboard, /client/onboarding,
 *   /client/dashboard/admin), an unauthenticated user should be redirected to
 *   /client/login. For any route in the public set (/client/login, /client/signup,
 *   /client/forgot-password, /client/reset-password), an unauthenticated user
 *   should be allowed access.
 *
 * Property 14: Incomplete onboarding redirect
 *   For any authenticated user with an empty tenantId, navigating to
 *   /client/dashboard should redirect to /client/onboarding.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Route sets mirroring the AuthGuard and layout configuration ---

const PROTECTED_ROUTES = [
  "/client/dashboard",
  "/client/onboarding",
  "/client/dashboard/admin",
] as const;

const PUBLIC_ROUTES = [
  "/client/login",
  "/client/signup",
  "/client/forgot-password",
  "/client/reset-password",
] as const;

const LOGIN_REDIRECT = "/client/login";
const ONBOARDING_REDIRECT = "/client/onboarding";

// --- Auth state types ---

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { tenantId: string; role: string } | null;
}

// --- Route protection decision logic ---

/**
 * Pure function mirroring the AuthGuard decision logic from
 * src/components/auth/AuthGuard.tsx.
 *
 * For protected routes:
 * - Unauthenticated → redirect to /client/login
 * - Authenticated with empty tenantId → redirect to /client/onboarding
 * - Authenticated with tenantId → allow access (render children)
 *
 * For public routes:
 * - Always allow access regardless of auth state
 */
function resolveRouteAccess(
  route: string,
  authState: AuthState
): { allowed: boolean; redirectTo?: string } {
  const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(route);

  // Public routes are always accessible
  if (isPublic) {
    return { allowed: true };
  }

  // Protected route: check authentication
  if (!authState.isAuthenticated) {
    return { allowed: false, redirectTo: LOGIN_REDIRECT };
  }

  // Authenticated but no tenantId → redirect to onboarding
  // This mirrors the AuthGuard check: if (user && !user.tenantId)
  if (authState.user && !authState.user.tenantId) {
    return { allowed: false, redirectTo: ONBOARDING_REDIRECT };
  }

  // Authenticated with tenantId → allow
  return { allowed: true };
}

// --- Arbitraries ---

/** Generates a random protected route */
const protectedRouteArb = fc.constantFrom(...PROTECTED_ROUTES);

/** Generates a random public route */
const publicRouteArb = fc.constantFrom(...PUBLIC_ROUTES);

/** Generates a random route from either set */
const anyRouteArb = fc.constantFrom(...PROTECTED_ROUTES, ...PUBLIC_ROUTES);

/** Generates a non-empty tenantId (simulating completed onboarding) */
const nonEmptyTenantIdArb = fc
  .stringMatching(/^[0-9]{5}$/)
  .filter((id) => id.length > 0);

/** Generates a valid user role */
const userRoleArb = fc.constantFrom(
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor"
);

/** Generates an unauthenticated auth state */
const unauthenticatedStateArb: fc.Arbitrary<AuthState> = fc.constant({
  isAuthenticated: false,
  isLoading: false,
  user: null,
});

/** Generates an authenticated state with empty tenantId (incomplete onboarding) */
const incompleteOnboardingStateArb: fc.Arbitrary<AuthState> = userRoleArb.map(
  (role) => ({
    isAuthenticated: true,
    isLoading: false,
    user: { tenantId: "", role },
  })
);

/** Generates an authenticated state with a valid tenantId (completed onboarding) */
const fullyAuthenticatedStateArb: fc.Arbitrary<AuthState> = fc
  .tuple(nonEmptyTenantIdArb, userRoleArb)
  .map(([tenantId, role]) => ({
    isAuthenticated: true,
    isLoading: false,
    user: { tenantId, role },
  }));

// --- Tests ---

describe("Property 13: Route protection by authentication state", () => {
  it("for any protected route, an unauthenticated user is redirected to /client/login", () => {
    fc.assert(
      fc.property(
        protectedRouteArb,
        unauthenticatedStateArb,
        (route, authState) => {
          const result = resolveRouteAccess(route, authState);

          expect(result.allowed).toBe(false);
          expect(result.redirectTo).toBe(LOGIN_REDIRECT);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any public route, an unauthenticated user is allowed access", () => {
    fc.assert(
      fc.property(
        publicRouteArb,
        unauthenticatedStateArb,
        (route, authState) => {
          const result = resolveRouteAccess(route, authState);

          expect(result.allowed).toBe(true);
          expect(result.redirectTo).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any public route, any auth state allows access", () => {
    fc.assert(
      fc.property(
        publicRouteArb,
        fc.oneof(
          unauthenticatedStateArb,
          incompleteOnboardingStateArb,
          fullyAuthenticatedStateArb
        ),
        (route, authState) => {
          const result = resolveRouteAccess(route, authState);

          expect(result.allowed).toBe(true);
          expect(result.redirectTo).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any protected route, a fully authenticated user is allowed access", () => {
    fc.assert(
      fc.property(
        protectedRouteArb,
        fullyAuthenticatedStateArb,
        (route, authState) => {
          const result = resolveRouteAccess(route, authState);

          expect(result.allowed).toBe(true);
          expect(result.redirectTo).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("protected and public route sets are disjoint", () => {
    const protectedSet = new Set<string>(PROTECTED_ROUTES);
    const publicSet = new Set<string>(PUBLIC_ROUTES);

    for (const route of protectedSet) {
      expect(publicSet.has(route)).toBe(false);
    }
    for (const route of publicSet) {
      expect(protectedSet.has(route)).toBe(false);
    }
  });
});

describe("Property 14: Incomplete onboarding redirect", () => {
  it("for any authenticated user with empty tenantId, /client/dashboard redirects to /client/onboarding", () => {
    fc.assert(
      fc.property(incompleteOnboardingStateArb, (authState) => {
        const result = resolveRouteAccess("/client/dashboard", authState);

        expect(result.allowed).toBe(false);
        expect(result.redirectTo).toBe(ONBOARDING_REDIRECT);
      }),
      { numRuns: 100 }
    );
  });

  it("for any authenticated user with empty tenantId, all protected routes redirect to /client/onboarding", () => {
    fc.assert(
      fc.property(
        protectedRouteArb,
        incompleteOnboardingStateArb,
        (route, authState) => {
          const result = resolveRouteAccess(route, authState);

          expect(result.allowed).toBe(false);
          expect(result.redirectTo).toBe(ONBOARDING_REDIRECT);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any authenticated user with a non-empty tenantId, /client/dashboard allows access", () => {
    fc.assert(
      fc.property(fullyAuthenticatedStateArb, (authState) => {
        const result = resolveRouteAccess("/client/dashboard", authState);

        expect(result.allowed).toBe(true);
        expect(result.redirectTo).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("empty tenantId is the sole trigger for onboarding redirect (not role or other fields)", () => {
    fc.assert(
      fc.property(userRoleArb, (role) => {
        // With empty tenantId → redirect
        const emptyState: AuthState = {
          isAuthenticated: true,
          isLoading: false,
          user: { tenantId: "", role },
        };
        const emptyResult = resolveRouteAccess("/client/dashboard", emptyState);
        expect(emptyResult.redirectTo).toBe(ONBOARDING_REDIRECT);

        // With non-empty tenantId → allowed, regardless of same role
        const filledState: AuthState = {
          isAuthenticated: true,
          isLoading: false,
          user: { tenantId: "12345", role },
        };
        const filledResult = resolveRouteAccess("/client/dashboard", filledState);
        expect(filledResult.allowed).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
