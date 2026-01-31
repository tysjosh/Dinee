import { MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = MutationCtx | QueryCtx;

export async function getUserById(ctx: AuthCtx, userId: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .first();

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

export function assertRole(
  role: string,
  allowedRoles: Array<
    "platform_admin" | "restaurant_owner" | "branch_manager" | "supervisor"
  >
) {
  if (!allowedRoles.includes(role as typeof allowedRoles[number])) {
    throw new Error("User does not have permission for this action");
  }
}

export function assertPlatformAccess(user: { platformId?: string }, platformId: string) {
  if (!user.platformId || user.platformId !== platformId) {
    throw new Error("User does not have access to this platform");
  }
}
