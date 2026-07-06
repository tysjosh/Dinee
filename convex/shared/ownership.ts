/**
 * Tenant ownership / authorization helpers for session-authenticated Convex
 * functions (the dashboard path, which uses Convex Auth).
 *
 * Ownership model: onboarding sets the authenticated user's `tenantId` to the
 * id of the business they created (`restaurantId`). So a non-admin user owns
 * exactly the tenant whose `restaurantId === user.tenantId`. Platform admins
 * (`role === "platform_admin"`) may access any tenant.
 *
 * These helpers throw on failure so callers fail closed. They require a valid
 * Convex Auth identity, so they only work when the caller forwards their
 * session (client `useMutation`/`useQuery`, or a server client with
 * `setAuth(token)`).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type AnyCtx = QueryCtx | MutationCtx;

/**
 * Resolve the authenticated user's app record (with role/tenantId), or null
 * when the request carries no valid identity.
 */
export async function getCurrentUserRecord(
  ctx: AnyCtx
): Promise<Doc<"users"> | null> {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;
  return await ctx.db.get(authUserId);
}

/** Require an authenticated user; throws otherwise. */
export async function requireUser(ctx: AnyCtx): Promise<Doc<"users">> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    throw new Error("Unauthorized: authentication required");
  }
  return user;
}

/** True when the user is a platform admin (may access any tenant). */
export function isPlatformAdmin(user: Doc<"users">): boolean {
  return user.role === "platform_admin";
}

/**
 * Require that the authenticated caller may act on the given restaurant/tenant
 * id — i.e. they are a platform admin, or their own `tenantId` matches.
 * Returns the resolved user record on success; throws "Forbidden" otherwise.
 */
export async function requireTenantAccess(
  ctx: AnyCtx,
  restaurantId: string
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (isPlatformAdmin(user)) return user;
  if (user.tenantId && user.tenantId === restaurantId) return user;
  throw new Error("Forbidden: you do not have access to this resource");
}
