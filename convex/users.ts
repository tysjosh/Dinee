import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// User role validator (reusable)
const userRoleValidator = v.union(
  v.literal("platform_admin"),
  v.literal("restaurant_owner"),
  v.literal("branch_manager"),
  v.literal("supervisor")
);

// Tenant type validator (reusable)
const tenantTypeValidator = v.union(
  v.literal("platform"),
  v.literal("restaurant"),
  v.literal("branch")
);

// Type definitions
type UserRole = "platform_admin" | "restaurant_owner" | "branch_manager" | "supervisor";
type TenantType = "platform" | "restaurant" | "branch";

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
 * Create a new user
 * Requirements: 2.1, 2.2
 */
export const createUser = mutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    role: userRoleValidator,
    tenantType: tenantTypeValidator,
    tenantId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if email already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
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
      passwordHash: args.passwordHash,
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
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    return user;
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
    const users = await ctx.db.query("users").collect();
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
    passwordHash: v.optional(v.string()),
    role: v.optional(userRoleValidator),
    tenantType: v.optional(tenantTypeValidator),
    tenantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
        .withIndex("by_email", (q) => q.eq("email", newEmail))
        .first();

      if (existingUser) {
        throw new Error("User with this email already exists");
      }
    }

    // Build updates object with only provided fields
    const updates: {
      email?: string;
      passwordHash?: string;
      role?: UserRole;
      tenantType?: TenantType;
      tenantId?: string;
    } = {};

    if (args.email !== undefined) {
      updates.email = args.email;
    }
    if (args.passwordHash !== undefined) {
      updates.passwordHash = args.passwordHash;
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
    // Note: This query doesn't use an index, so it's less efficient
    // Consider adding an index on role if this query is frequently used
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), args.role))
      .collect();

    return users;
  },
});
