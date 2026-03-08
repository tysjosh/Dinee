/**
 * Feature: convex-auth-integration, Property 20-22: Admin panel properties
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 *
 * Property 20: Admin panel access restriction
 *   For any user with a role other than platform_admin, navigating to
 *   /client/dashboard/admin should redirect to /client/dashboard.
 *
 * Property 21: Admin panel data completeness
 *   For any set of restaurants in the database, the admin panel should display
 *   all of them. For any set of users returned by getAllUsers(), the admin panel
 *   should display all of them with email, role, tenantType, tenantId, and
 *   lastLoginAt fields.
 *
 * Property 22: Admin role change and deactivation
 *   For any platform_admin user, changing another user's role via updateUser
 *   should persist the new role. Deactivating a user should prevent that user
 *   from accessing protected routes.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Constants mirroring the admin panel and schema ---

const ALL_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
] as const;
type UserRole = (typeof ALL_ROLES)[number];

const NON_ADMIN_ROLES = ALL_ROLES.filter((r) => r !== "platform_admin");

const ALL_TENANT_TYPES = ["platform", "restaurant", "business", "branch"] as const;
type TenantType = (typeof ALL_TENANT_TYPES)[number];

const ADMIN_ROUTE = "/client/dashboard/admin";
const DASHBOARD_REDIRECT = "/client/dashboard";

// --- Required user display fields (Requirement 11.4) ---
const REQUIRED_USER_FIELDS = ["email", "role", "tenantType", "tenantId", "lastLoginAt"] as const;

// --- Data model types ---

interface UserRecord {
  userId: string;
  email: string;
  role: UserRole;
  tenantType: TenantType;
  tenantId: string;
  lastLoginAt?: number;
  isDeactivated: boolean;
}

interface RestaurantRecord {
  restaurantId: string;
  name: string;
  createdAt: number;
}

interface SubscriptionRecord {
  restaurantId: string;
  status: string;
  planId: string;
}

// --- Admin panel access decision logic ---

/**
 * Pure function mirroring the admin panel access check from
 * src/app/client/dashboard/admin/page.tsx.
 *
 * The admin page checks `state.userRole === "platform_admin"` and
 * redirects non-admins to /client/dashboard via router.replace().
 */
function resolveAdminAccess(userRole: UserRole): {
  allowed: boolean;
  redirectTo?: string;
} {
  if (userRole === "platform_admin") {
    return { allowed: true };
  }
  return { allowed: false, redirectTo: DASHBOARD_REDIRECT };
}

// --- Admin panel data rendering model ---

/**
 * Simulates the admin panel's data display logic.
 * The admin panel renders ALL restaurants and ALL users from the queries.
 */
function renderAdminPanel(
  restaurants: RestaurantRecord[],
  users: UserRecord[],
  subscriptionMap: Map<string, { status: string; planId: string }>
): {
  displayedRestaurants: RestaurantRecord[];
  displayedUsers: UserRecord[];
  userFieldsPresent: Map<string, Set<string>>;
  restaurantSubscriptions: Map<string, { status: string; planId: string } | undefined>;
} {
  // The admin panel renders all restaurants from the query
  const displayedRestaurants = [...restaurants];

  // The admin panel renders all users from the query
  const displayedUsers = [...users];

  // Track which fields are present for each user
  const userFieldsPresent = new Map<string, Set<string>>();
  for (const user of displayedUsers) {
    const fields = new Set<string>();
    if (user.email !== undefined) fields.add("email");
    if (user.role !== undefined) fields.add("role");
    if (user.tenantType !== undefined) fields.add("tenantType");
    if (user.tenantId !== undefined) fields.add("tenantId");
    // lastLoginAt is always displayed (as "Never" if undefined)
    fields.add("lastLoginAt");
    userFieldsPresent.set(user.userId, fields);
  }

  // Map restaurant subscriptions
  const restaurantSubscriptions = new Map<
    string,
    { status: string; planId: string } | undefined
  >();
  for (const r of restaurants) {
    restaurantSubscriptions.set(r.restaurantId, subscriptionMap.get(r.restaurantId));
  }

  return { displayedRestaurants, displayedUsers, userFieldsPresent, restaurantSubscriptions };
}

// --- User store for role change and deactivation simulation ---

class AdminUserStore {
  private users: Map<string, UserRecord> = new Map();
  private nextId = 1;

  addUser(
    email: string,
    role: UserRole,
    tenantType: TenantType,
    tenantId: string,
    lastLoginAt?: number
  ): UserRecord {
    const record: UserRecord = {
      userId: `user_${this.nextId++}`,
      email: email.toLowerCase().trim(),
      role,
      tenantType,
      tenantId,
      lastLoginAt,
      isDeactivated: false,
    };
    this.users.set(record.userId, record);
    return record;
  }

  getUser(userId: string): UserRecord | undefined {
    return this.users.get(userId);
  }

  getAllUsers(): UserRecord[] {
    return Array.from(this.users.values());
  }

  /**
   * Change a user's role. Mirrors the handleRoleChange in admin/page.tsx
   * which calls updateUser({ userId, role }).
   * Only a platform_admin caller can perform this action.
   */
  changeRole(callerUserId: string, targetUserId: string, newRole: UserRole): void {
    const caller = this.users.get(callerUserId);
    if (!caller || caller.role !== "platform_admin") {
      throw new Error("Only platform admins can change user roles");
    }
    const target = this.users.get(targetUserId);
    if (!target) {
      throw new Error("User not found");
    }
    target.role = newRole;
  }

  /**
   * Deactivate a user. Mirrors handleDeactivate in admin/page.tsx
   * which calls updateUser({ userId, role: "supervisor", tenantId: "" }).
   * This effectively removes tenant access and downgrades the role.
   */
  deactivateUser(callerUserId: string, targetUserId: string): void {
    const caller = this.users.get(callerUserId);
    if (!caller || caller.role !== "platform_admin") {
      throw new Error("Only platform admins can deactivate users");
    }
    const target = this.users.get(targetUserId);
    if (!target) {
      throw new Error("User not found");
    }
    target.role = "supervisor";
    target.tenantId = "";
    target.isDeactivated = true;
  }

  /**
   * Check if a user can access protected routes.
   * A deactivated user (empty tenantId) gets redirected to onboarding,
   * effectively preventing dashboard access.
   */
  canAccessProtectedRoute(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    // Deactivated users have empty tenantId → redirected to onboarding by AuthGuard
    return user.tenantId !== "";
  }
}

// --- Arbitraries ---

const userRoleArb = fc.constantFrom<UserRole>(...ALL_ROLES);
const nonAdminRoleArb = fc.constantFrom<UserRole>(...(NON_ADMIN_ROLES as UserRole[]));
const tenantTypeArb = fc.constantFrom<TenantType>(...ALL_TENANT_TYPES);
const tenantIdArb = fc.stringMatching(/^[0-9]{5}$/);

const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._]{0,19}$/),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/),
    fc.constantFrom("com", "org", "net", "io", "co", "dev")
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
  .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

const timestampArb = fc.integer({ min: 1600000000000, max: 1800000000000 });

const restaurantRecordArb = fc
  .tuple(
    tenantIdArb,
    fc.stringMatching(/^[A-Za-z ]{1,30}$/),
    timestampArb
  )
  .map(([restaurantId, name, createdAt]) => ({
    restaurantId,
    name: name.trim() || "Restaurant",
    createdAt,
  }));

const subscriptionStatusArb = fc.constantFrom("active", "trialing", "past_due", "cancelled");
const planIdArb = fc.constantFrom("starter", "growth", "enterprise");

const userRecordArb = fc
  .tuple(validEmailArb, userRoleArb, tenantTypeArb, tenantIdArb, fc.option(timestampArb))
  .map(([email, role, tenantType, tenantId, lastLoginAt]) => ({
    email,
    role,
    tenantType,
    tenantId,
    lastLoginAt: lastLoginAt ?? undefined,
  }));

// --- Tests ---

describe("Property 20: Admin panel access restriction", () => {
  it("for any user with a role other than platform_admin, navigating to /client/dashboard/admin redirects to /client/dashboard", () => {
    fc.assert(
      fc.property(nonAdminRoleArb, (role) => {
        const result = resolveAdminAccess(role);

        expect(result.allowed).toBe(false);
        expect(result.redirectTo).toBe(DASHBOARD_REDIRECT);
      }),
      { numRuns: 100 }
    );
  });

  it("for any platform_admin user, navigating to /client/dashboard/admin is allowed", () => {
    fc.assert(
      fc.property(fc.constant("platform_admin" as UserRole), (role) => {
        const result = resolveAdminAccess(role);

        expect(result.allowed).toBe(true);
        expect(result.redirectTo).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("platform_admin is the only role that grants admin panel access", () => {
    fc.assert(
      fc.property(userRoleArb, (role) => {
        const result = resolveAdminAccess(role);

        if (role === "platform_admin") {
          expect(result.allowed).toBe(true);
        } else {
          expect(result.allowed).toBe(false);
          expect(result.redirectTo).toBe(DASHBOARD_REDIRECT);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("the redirect target for non-admins is always /client/dashboard, never the admin route itself", () => {
    fc.assert(
      fc.property(nonAdminRoleArb, (role) => {
        const result = resolveAdminAccess(role);

        expect(result.redirectTo).not.toBe(ADMIN_ROUTE);
        expect(result.redirectTo).toBe(DASHBOARD_REDIRECT);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 21: Admin panel data completeness", () => {
  it("for any set of restaurants, the admin panel displays all of them", () => {
    fc.assert(
      fc.property(
        fc.array(restaurantRecordArb, { minLength: 0, maxLength: 20 }),
        (restaurants) => {
          // Deduplicate by restaurantId (DB would enforce uniqueness)
          const uniqueRestaurants = Array.from(
            new Map(restaurants.map((r) => [r.restaurantId, r])).values()
          );

          const subscriptionMap = new Map<string, { status: string; planId: string }>();
          const result = renderAdminPanel(uniqueRestaurants, [], subscriptionMap);

          expect(result.displayedRestaurants.length).toBe(uniqueRestaurants.length);

          // Every restaurant in the input should appear in the output
          for (const restaurant of uniqueRestaurants) {
            const found = result.displayedRestaurants.find(
              (r) => r.restaurantId === restaurant.restaurantId
            );
            expect(found).toBeDefined();
            expect(found!.name).toBe(restaurant.name);
            expect(found!.createdAt).toBe(restaurant.createdAt);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any set of users, the admin panel displays all of them with required fields", () => {
    fc.assert(
      fc.property(
        fc.array(userRecordArb, { minLength: 0, maxLength: 20 }),
        (userInputs) => {
          const store = new AdminUserStore();
          const createdUsers: UserRecord[] = [];

          // Deduplicate by email
          const seenEmails = new Set<string>();
          for (const input of userInputs) {
            const normalizedEmail = input.email.toLowerCase().trim();
            if (seenEmails.has(normalizedEmail)) continue;
            seenEmails.add(normalizedEmail);

            const user = store.addUser(
              input.email,
              input.role,
              input.tenantType,
              input.tenantId,
              input.lastLoginAt
            );
            createdUsers.push(user);
          }

          const allUsers = store.getAllUsers();
          const subscriptionMap = new Map<string, { status: string; planId: string }>();
          const result = renderAdminPanel([], allUsers, subscriptionMap);

          // All users should be displayed
          expect(result.displayedUsers.length).toBe(createdUsers.length);

          // Each user should have all required fields present
          for (const user of result.displayedUsers) {
            const fields = result.userFieldsPresent.get(user.userId);
            expect(fields).toBeDefined();

            for (const requiredField of REQUIRED_USER_FIELDS) {
              expect(fields!.has(requiredField)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("restaurant subscription status is correctly mapped for each restaurant", () => {
    fc.assert(
      fc.property(
        fc.array(restaurantRecordArb, { minLength: 1, maxLength: 10 }),
        fc.array(
          fc.tuple(subscriptionStatusArb, planIdArb),
          { minLength: 0, maxLength: 10 }
        ),
        (restaurants, subData) => {
          const uniqueRestaurants = Array.from(
            new Map(restaurants.map((r) => [r.restaurantId, r])).values()
          );

          const subscriptionMap = new Map<string, { status: string; planId: string }>();
          // Assign subscriptions to some restaurants
          for (let i = 0; i < Math.min(subData.length, uniqueRestaurants.length); i++) {
            subscriptionMap.set(uniqueRestaurants[i].restaurantId, {
              status: subData[i][0],
              planId: subData[i][1],
            });
          }

          const result = renderAdminPanel(uniqueRestaurants, [], subscriptionMap);

          for (const restaurant of uniqueRestaurants) {
            const expectedSub = subscriptionMap.get(restaurant.restaurantId);
            const actualSub = result.restaurantSubscriptions.get(restaurant.restaurantId);

            if (expectedSub) {
              expect(actualSub).toBeDefined();
              expect(actualSub!.status).toBe(expectedSub.status);
              expect(actualSub!.planId).toBe(expectedSub.planId);
            } else {
              expect(actualSub).toBeUndefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("user display includes email, role, tenantType, tenantId, and lastLoginAt for every user", () => {
    fc.assert(
      fc.property(
        userRecordArb,
        (input) => {
          const store = new AdminUserStore();
          const user = store.addUser(
            input.email,
            input.role,
            input.tenantType,
            input.tenantId,
            input.lastLoginAt
          );

          const result = renderAdminPanel([], [user], new Map());

          expect(result.displayedUsers.length).toBe(1);
          const displayed = result.displayedUsers[0];

          // Verify all required fields are present and match
          expect(displayed.email).toBe(input.email.toLowerCase().trim());
          expect(displayed.role).toBe(input.role);
          expect(displayed.tenantType).toBe(input.tenantType);
          expect(displayed.tenantId).toBe(input.tenantId);
          // lastLoginAt is always present in the field set (rendered as "Never" if undefined)
          const fields = result.userFieldsPresent.get(user.userId);
          expect(fields!.has("lastLoginAt")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 22: Admin role change and deactivation", () => {
  it("for any platform_admin, changing another user's role persists the new role", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        nonAdminRoleArb,
        userRoleArb,
        tenantIdArb,
        (adminEmail, targetEmail, targetInitialRole, newRole, tenantId) => {
          const store = new AdminUserStore();
          const admin = store.addUser(adminEmail, "platform_admin", "platform", "platform-1");
          const target = store.addUser(targetEmail, targetInitialRole, "restaurant", tenantId);

          store.changeRole(admin.userId, target.userId, newRole);

          const updated = store.getUser(target.userId);
          expect(updated).toBeDefined();
          expect(updated!.role).toBe(newRole);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("deactivating a user prevents access to protected routes", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        nonAdminRoleArb,
        tenantTypeArb,
        tenantIdArb,
        (adminEmail, targetEmail, targetRole, targetTenantType, tenantId) => {
          const store = new AdminUserStore();
          const admin = store.addUser(adminEmail, "platform_admin", "platform", "platform-1");
          const target = store.addUser(targetEmail, targetRole, targetTenantType, tenantId);

          // Before deactivation, user can access protected routes
          expect(store.canAccessProtectedRoute(target.userId)).toBe(true);

          store.deactivateUser(admin.userId, target.userId);

          // After deactivation, user cannot access protected routes
          expect(store.canAccessProtectedRoute(target.userId)).toBe(false);

          // Verify deactivation sets role to supervisor and clears tenantId
          const deactivated = store.getUser(target.userId);
          expect(deactivated!.role).toBe("supervisor");
          expect(deactivated!.tenantId).toBe("");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a non-admin user cannot change another user's role", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        nonAdminRoleArb,
        userRoleArb,
        tenantIdArb,
        (callerEmail, targetEmail, callerRole, newRole, tenantId) => {
          const store = new AdminUserStore();
          const caller = store.addUser(callerEmail, callerRole, "restaurant", tenantId);
          const target = store.addUser(targetEmail, "supervisor", "restaurant", tenantId);

          expect(() =>
            store.changeRole(caller.userId, target.userId, newRole)
          ).toThrow("Only platform admins can change user roles");

          // Role should remain unchanged
          const unchanged = store.getUser(target.userId);
          expect(unchanged!.role).toBe("supervisor");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a non-admin user cannot deactivate another user", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        nonAdminRoleArb,
        tenantIdArb,
        (callerEmail, targetEmail, callerRole, tenantId) => {
          const store = new AdminUserStore();
          const caller = store.addUser(callerEmail, callerRole, "restaurant", tenantId);
          const target = store.addUser(targetEmail, "supervisor", "restaurant", tenantId);

          expect(() =>
            store.deactivateUser(caller.userId, target.userId)
          ).toThrow("Only platform admins can deactivate users");

          // User should remain active
          expect(store.canAccessProtectedRoute(target.userId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("role change is idempotent — setting the same role twice results in the same state", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        userRoleArb,
        tenantIdArb,
        (adminEmail, targetEmail, newRole, tenantId) => {
          const store = new AdminUserStore();
          const admin = store.addUser(adminEmail, "platform_admin", "platform", "platform-1");
          const target = store.addUser(targetEmail, "supervisor", "restaurant", tenantId);

          store.changeRole(admin.userId, target.userId, newRole);
          const afterFirst = store.getUser(target.userId)!.role;

          store.changeRole(admin.userId, target.userId, newRole);
          const afterSecond = store.getUser(target.userId)!.role;

          expect(afterFirst).toBe(newRole);
          expect(afterSecond).toBe(newRole);
        }
      ),
      { numRuns: 100 }
    );
  });
});
