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

/** All application roles. */
export type AppRole =
  | "platform_admin"
  | "restaurant_owner"
  | "business_owner"
  | "branch_manager"
  | "supervisor"
  | "partner";

/**
 * Roles that fully control a tenant (billing, integrations, staff, tenant-wide
 * config). Branch managers and supervisors are operational and excluded.
 */
export const TENANT_OWNER_ROLES: AppRole[] = ["restaurant_owner", "business_owner"];

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

/**
 * Require tenant access AND that the caller holds one of `allowedRoles`.
 * Platform admins always pass. Use for owner-only actions within a tenant
 * (billing, integrations, staff invitations, tenant-wide config) so branch
 * managers / supervisors — who legitimately have tenant access for day-to-day
 * operations — cannot perform them.
 */
export async function requireRole(
  ctx: AnyCtx,
  restaurantId: string,
  allowedRoles: AppRole[]
): Promise<Doc<"users">> {
  const user = await requireTenantAccess(ctx, restaurantId);
  if (isPlatformAdmin(user)) return user;
  if (!user.role || !allowedRoles.includes(user.role as AppRole)) {
    throw new Error("Forbidden: your role may not perform this action");
  }
  return user;
}

/**
 * Require that the caller may act on the given BRANCH. Resolves the branch to
 * its owning tenant and enforces tenant access, then — for branch-scoped roles
 * (branch_manager / supervisor) that have an explicit `assignedBranchIds` list —
 * restricts them to their assigned branches. Owners, business owners, and
 * platform admins are not branch-restricted. A branch-scoped user with no
 * assignment set is treated as unrestricted within their tenant (backward
 * compatible) until an owner assigns branches.
 */
export async function requireBranchAccess(
  ctx: AnyCtx,
  branchId: string
): Promise<Doc<"users">> {
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();
  const user = await requireTenantAccess(ctx, branch?.restaurantId ?? "");
  if (isPlatformAdmin(user)) return user;

  const branchScoped =
    user.role === "branch_manager" || user.role === "supervisor";
  const assigned = user.assignedBranchIds;
  if (branchScoped && Array.isArray(assigned) && assigned.length > 0) {
    if (!assigned.includes(branchId)) {
      throw new Error("Forbidden: this branch is outside your assignment");
    }
  }
  return user;
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
 * secret) OR from a session user with tenant access to `restaurantId` who ALSO
 * holds one of `allowedRoles`. Throws "Forbidden" otherwise.
 *
 * Use for tenant-structural operations that a trusted server route may perform
 * (e.g. partner-API branch provisioning forwards the internal secret) but that
 * an operational session role (branch_manager / supervisor) must not — the
 * session path is held to owner roles while the server path is unrestricted.
 */
export async function requireRoleOrInternal(
  ctx: AnyCtx,
  restaurantId: string,
  allowedRoles: AppRole[],
  internalSecret: string | undefined
): Promise<void> {
  if (hasValidInternalSecret(internalSecret)) return;
  await requireRole(ctx, restaurantId, allowedRoles);
}

/**
 * Allow the call when it comes from a trusted server caller (valid internal
 * secret) OR from a session user who may act on the given BRANCH.
 *
 * Server-to-server callers (Voice_Runtime, webhooks) forwarding the internal
 * secret are unrestricted — they resolve the branch themselves and are not
 * subject to per-user branch assignment. Session callers go through
 * `requireBranchAccess`, which enforces tenant ownership AND restricts
 * branch-scoped roles (branch_manager / supervisor) with a populated
 * `assignedBranchIds` to their assigned branches. Owners / platform admins and
 * branch-scoped users with no assignment set remain unrestricted within their
 * tenant (backward compatible).
 */
export async function requireBranchAccessOrInternal(
  ctx: AnyCtx,
  branchId: string,
  internalSecret: string | undefined
): Promise<void> {
  if (hasValidInternalSecret(internalSecret)) return;
  await requireBranchAccess(ctx, branchId);
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
