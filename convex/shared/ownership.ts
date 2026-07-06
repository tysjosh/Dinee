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
 * Require the authenticated caller to be a platform admin. Returns the user
 * record on success; throws "Forbidden" otherwise. Use for platform-wide
 * reads/writes (all-users, all-restaurants, role changes, deletions).
 */
export async function requirePlatformAdmin(
  ctx: AnyCtx
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!isPlatformAdmin(user)) {
    throw new Error("Forbidden: platform admin access required");
  }
  return user;
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

// ─────────────────────────────────────────────────────────────────────────
// Mixed-context guards (session OR trusted server-to-server caller)
//
// Some restaurant functions are called from BOTH the session-authenticated
// dashboard AND server routes that authenticate by other means (partner API
// key, the internal x-api-key, or the module guard) using a ConvexHttpClient
// with no Convex Auth session. Those trusted server callers forward the shared
// INTERNAL_API_KEY secret (see `convex/shared/internalAuth.ts` /
// `src/lib/internal-auth.ts#internalSecretArg`), which these guards accept in
// lieu of a session — while still holding real browser clients to tenant
// ownership.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Boolean form of the internal-caller check. Matches `assertInternalCaller`:
 * when `INTERNAL_API_KEY` is not configured (local dev) it returns true so the
 * dev workflow is unaffected; production deployments MUST set the key.
 */
export function hasValidInternalSecret(secret: string | undefined): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return true; // local dev bypass (mirrors assertInternalCaller)
  return Boolean(secret) && secret === expected;
}

/**
 * Allow the call when it comes from a trusted server caller (valid internal
 * secret) OR from a session user with tenant access to `restaurantId`.
 * Throws "Forbidden" otherwise.
 */
export async function requireTenantAccessOrInternal(
  ctx: AnyCtx,
  restaurantId: string,
  internalSecret: string | undefined
): Promise<void> {
  if (hasValidInternalSecret(internalSecret)) return;
  await requireTenantAccess(ctx, restaurantId);
}

/**
 * Allow the call when it comes from a trusted server caller (valid internal
 * secret) OR from any authenticated session user. Returns the session user
 * record when present (server callers return null). Used for creation, where
 * an onboarding user does not yet own a tenant.
 */
export async function requireUserOrInternal(
  ctx: AnyCtx,
  internalSecret: string | undefined
): Promise<Doc<"users"> | null> {
  if (hasValidInternalSecret(internalSecret)) {
    // Trusted server caller — still return a session user if one happens to be
    // attached (harmless), else null.
    return await getCurrentUserRecord(ctx);
  }
  return await requireUser(ctx);
}

/**
 * Allow the call when it comes from a trusted server caller (valid internal
 * secret) OR from a platform admin session. Throws "Forbidden" otherwise. Used
 * for platform-scoped reads invoked only by server routes today.
 */
export async function requirePlatformAdminOrInternal(
  ctx: AnyCtx,
  internalSecret: string | undefined
): Promise<void> {
  if (hasValidInternalSecret(internalSecret)) return;
  await requirePlatformAdmin(ctx);
}
