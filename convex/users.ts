import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  requireUser,
  requirePlatformAdmin,
  requireTenantAccess,
  requireRole,
  isPlatformAdmin,
  TENANT_OWNER_ROLES,
} from "./shared/ownership";

// User role validator (reusable)
const userRoleValidator = v.union(
  v.literal("platform_admin"),
  v.literal("restaurant_owner"),
  v.literal("business_owner"),
  v.literal("branch_manager"),
  v.literal("supervisor")
);

// Tenant type validator (reusable)
const tenantTypeValidator = v.union(
  v.literal("platform"),
  v.literal("restaurant"),
  v.literal("business"),
  v.literal("branch")
);

// Type definitions
type UserRole = "platform_admin" | "restaurant_owner" | "business_owner" | "branch_manager" | "supervisor";
type TenantType = "platform" | "restaurant" | "business" | "branch";

// Generate a unique user ID (12-character alphanumeric)
function generateUserId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Populate the CURRENT authenticated user's app profile fields on their
 * Convex Auth `users` row.
 *
 * The `users` table IS the Convex Auth users table. Signup previously inserted
 * a SECOND row via `createUser`, which orphaned the app fields (the auth row —
 * the one `currentUser`/`getAuthUserId` resolves — kept `role`/`tenantId`/`userId`
 * empty). This patches the auth row in place instead, so there is exactly one
 * row per person and `currentUser` returns a fully-populated record.
 *
 * Idempotent: re-running preserves an existing app `userId` and only fills
 * missing fields, so a retried signup never creates duplicates or throws.
 */
export const upsertCurrentUserProfile = mutation({
  args: {
    role: userRoleValidator,
    tenantType: tenantTypeValidator,
    tenantId: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(authUserId);
    if (!existing) {
      throw new Error("Authenticated user row not found");
    }

    // Preserve an existing app userId; otherwise mint a unique one. The app
    // `userId` field is retained for the `by_user_id` lookups still used by
    // invitations / updateUser / updateLastLogin.
    let appUserId = existing.userId;
    if (!appUserId) {
      let clash;
      do {
        appUserId = generateUserId();
        clash = await ctx.db
          .query("users")
          .withIndex("by_user_id", (q) => q.eq("userId", appUserId!))
          .first();
      } while (clash && clash._id !== authUserId);
    }

    await ctx.db.patch(authUserId, {
      userId: appUserId,
      role: args.role,
      tenantType: args.tenantType,
      tenantId: args.tenantId,
      ...(args.email ? { email: args.email } : {}),
      createdAt: existing.createdAt ?? Date.now(),
    });

    return { userId: appUserId };
  },
});

/**
 * Link the CURRENT authenticated user to a tenant by patching their Convex Auth
 * row (resolved via `getAuthUserId`).
 *
 * Replaces the onboarding call to `updateUser({ userId, tenantId })`, which
 * depended on `user.userId` (undefined on the auth row) and therefore never
 * wrote the tenant link — leaving onboarded users stuck in the onboarding
 * redirect loop.
 */
export const setCurrentUserTenant = mutation({
  args: {
    tenantId: v.string(),
    tenantType: v.optional(tenantTypeValidator),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(authUserId);
    if (!existing) {
      throw new Error("Authenticated user row not found");
    }

    await ctx.db.patch(authUserId, {
      tenantId: args.tenantId,
      ...(args.tenantType ? { tenantType: args.tenantType } : {}),
    });

    return { success: true };
  },
});

/**
 * Create a new user
 * Requirements: 2.1, 2.2
 */
export const createUser = mutation({
  args: {
    email: v.string(),
    role: userRoleValidator,
    tenantType: tenantTypeValidator,
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if email already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    // Generate unique user ID
    let userId: string;
    let existingUserId;

    do {
      userId = generateUserId();
      existingUserId = await ctx.db
        .query("users")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .first();
    } while (existingUserId);

    const docId = await ctx.db.insert("users", {
      userId,
      email: args.email,
      role: args.role,
      tenantType: args.tenantType,
      tenantId: args.tenantId,
      createdAt: Date.now(),
    });

    return { userId, docId };
  },
});

/**
 * Get a user by userId
 */
export const getUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // A user may read their own record; platform admins may read anyone's.
    const caller = await requireUser(ctx);
    if (!isPlatformAdmin(caller) && caller.userId !== args.userId) {
      throw new Error("Forbidden: cannot read another user's record");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    return user;
  },
});

/**
 * Get a user by email
 */
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Email lookup enables account enumeration — restrict to platform admins.
    await requirePlatformAdmin(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    return user;
  },
});
/**
 * Get the current authenticated user from the session identity.
 *
 * Resolves the Convex Auth user id (the `users` table is the auth users table
 * extended with app fields) and returns that document directly. This does NOT
 * depend on `email` being present in the JWT identity — the Password provider
 * does not always populate it, which previously made this return null and left
 * post-login redirects stuck.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    return await ctx.db.get(userId);
  },
});

/**
 * Get all users for a specific tenant
 */
export const getUsersByTenant = query({
  args: {
    tenantType: tenantTypeValidator,
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    // Only members of the tenant (or a platform admin) may list its users.
    await requireTenantAccess(ctx, args.tenantId);

    const users = await ctx.db
      .query("users")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantType", args.tenantType).eq("tenantId", args.tenantId)
      )
      .collect();

    return users;
  },
});

/**
 * Get all users
 */
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    // Platform-wide read — admins only. Bounded to the newest 1000 as a safety
    // net against unbounded reads; full pagination is a follow-up if needed.
    await requirePlatformAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(1000);
    return users;
  },
});

/**
 * Update a user
 */
export const updateUser = mutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    role: v.optional(userRoleValidator),
    tenantType: v.optional(tenantTypeValidator),
    tenantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Role/tenant changes are privileged — platform admins only.
    await requirePlatformAdmin(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // If email is being updated, check for duplicates
    if (args.email !== undefined && args.email !== user.email) {
      const newEmail = args.email;
      const existingUser = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", newEmail))
        .first();

      if (existingUser) {
        throw new Error("User with this email already exists");
      }
    }

    // Build updates object with only provided fields
    const updates: {
      email?: string;
      role?: UserRole;
      tenantType?: TenantType;
      tenantId?: string;
    } = {};

    if (args.email !== undefined) {
      updates.email = args.email;
    }
    if (args.role !== undefined) {
      updates.role = args.role;
    }
    if (args.tenantType !== undefined) {
      updates.tenantType = args.tenantType;
    }
    if (args.tenantId !== undefined) {
      updates.tenantId = args.tenantId;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(user._id, updates);
    }

    return user._id;
  },
});

/**
 * Assign the set of branches a branch-scoped staff user (branch_manager /
 * supervisor) may access within the caller's tenant.
 *
 * Owner-only within the tenant (restaurant_owner / business_owner or a platform
 * admin). This is what actually POPULATES `assignedBranchIds`; until an owner
 * calls it, a branch-scoped user is unrestricted within their tenant (backward
 * compatible), so branch isolation in the `*ByBranch` readers is a no-op. After
 * assignment those readers restrict the user to exactly these branches.
 *
 * Validates before write: the target user must belong to the caller's tenant,
 * and every branchId must be a branch OWNED by that same tenant — so an owner
 * cannot grant access to another tenant's branch. Passing an empty array clears
 * the assignment (returns the user to unrestricted-within-tenant).
 */
export const setUserAssignedBranches = mutation({
  args: {
    userId: v.string(),
    branchIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!target) {
      throw new Error("User not found");
    }

    // Caller must be an owner (or platform admin) of the TARGET user's tenant.
    // A user with no tenant cannot be branch-assigned by a non-admin owner.
    await requireRole(ctx, target.tenantId ?? "", TENANT_OWNER_ROLES);

    // Every branch must be owned by the target user's tenant — prevents an
    // owner from granting cross-tenant branch access. De-duplicate.
    const uniqueBranchIds = Array.from(new Set(args.branchIds));
    for (const branchId of uniqueBranchIds) {
      const branch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
      if (!branch || branch.restaurantId !== target.tenantId) {
        throw new Error(
          `Branch "${branchId}" does not belong to this tenant`
        );
      }
    }

    await ctx.db.patch(target._id, { assignedBranchIds: uniqueBranchIds });
    return target._id;
  },
});

/**
 * Update user's last login timestamp
 */
export const updateLastLogin = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, { lastLoginAt: Date.now() });

    return user._id;
  },
});

/**
 * Delete a user
 */
export const deleteUser = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Deleting users is privileged — platform admins only.
    await requirePlatformAdmin(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.delete(user._id);

    return { success: true, userId: args.userId };
  },
});

/**
 * Get users by role
 */
export const getUsersByRole = query({
  args: { role: userRoleValidator },
  handler: async (ctx, args) => {
    // Platform-wide read — admins only.
    await requirePlatformAdmin(ctx);

    // Note: This query doesn't use an index, so it's less efficient
    // Consider adding an index on role if this query is frequently used
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), args.role))
      .collect();

    return users;
  },
});
