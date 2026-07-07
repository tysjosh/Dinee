/**
 * Control-Plane authorization core (platform-control-plane).
 *
 * A single reusable module that resolves the calling actor's role and
 * Authorization_Scope and exposes pure, property-testable predicates for
 * scope membership. Every Control-Plane read/list/management surface calls
 * `requireActor(ctx)` FIRST and returns no integration data on failure.
 *
 * Two-tier model:
 *   - `platform_admin` → unrestricted (all platforms, all tenants) (Req 5.1).
 *   - `partner`        → bound to its own `tenantId` (all platforms under that
 *                        tenant), OR an explicit `(platformId, tenantId)` pair
 *                        set carried on the user's `authorizationScope`
 *                        override (Req 5.2).
 *
 * Any other/absent role is not a recognized Control-Plane actor and is denied
 * (Req 5.6). A partner whose scope cannot be derived (no override and no
 * tenantId) is denied as `scope_undeterminable` (Req 4.5, 5.6).
 *
 * Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.6
 */

import { api } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import {
  getCurrentUserRecord,
  isPlatformAdmin,
  TENANT_OWNER_ROLES,
  type AppRole,
} from "../shared/ownership";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The recognized Control-Plane actor roles (Req 5.1, 5.2). */
export type ActorRole = "platform_admin" | "partner";

/** A partner's permitted set of `(platformId, tenantId)` pairs, or unrestricted. */
export type AuthorizationScope =
  | { kind: "unrestricted" } // platform_admin (Req 5.1)
  | { kind: "tenant"; tenantId: string } // partner bound to a tenant (Req 5.2)
  | { kind: "pairs"; pairs: { platformId: string; tenantId: string }[] }; // explicit override

/** The outcome of resolving an actor: success (role + scope) or a typed failure. */
export type ActorResolution =
  | { ok: true; role: ActorRole; scope: AuthorizationScope }
  | {
      ok: false;
      reason: "unauthenticated" | "unrecognized_role" | "scope_undeterminable";
    };

/** The minimal user shape the pure resolver needs (structural subset of `users`). */
export interface ActorUserRecord {
  role?: string;
  tenantId?: string;
  authorizationScope?: { platformId: string; tenantId: string }[];
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Pure: derives the actor role + Authorization_Scope from a user record.
 *
 * - `platform_admin` → `{ kind: "unrestricted" }` (Req 5.1).
 * - `partner` → `{ kind: "pairs" }` when the user carries a non-empty explicit
 *   `authorizationScope` override, otherwise `{ kind: "tenant", tenantId }` when
 *   a non-empty `tenantId` is present (Req 5.2).
 * - Any other/absent role → `unrecognized_role` (Req 5.6).
 * - A partner with neither a usable override nor a `tenantId` →
 *   `scope_undeterminable` (Req 4.5, 5.6).
 *
 * Never throws; a `null` user resolves to `unrecognized_role`.
 */
export function resolveActorFromUser(
  user: ActorUserRecord | null
): ActorResolution {
  const role = user?.role;

  if (role === "platform_admin") {
    return { ok: true, role: "platform_admin", scope: { kind: "unrestricted" } };
  }

  if (role === "partner") {
    // Explicit override takes precedence when it carries at least one pair.
    const override = user?.authorizationScope;
    if (Array.isArray(override) && override.length > 0) {
      return {
        ok: true,
        role: "partner",
        scope: {
          kind: "pairs",
          pairs: override.map((p) => ({
            platformId: p.platformId,
            tenantId: p.tenantId,
          })),
        },
      };
    }

    // Otherwise derive from the partner's tenantId (all platforms under it).
    const tenantId = user?.tenantId;
    if (typeof tenantId === "string" && tenantId.length > 0) {
      return { ok: true, role: "partner", scope: { kind: "tenant", tenantId } };
    }

    // No override, no tenantId → scope cannot be determined (Req 4.5, 5.6).
    return { ok: false, reason: "scope_undeterminable" };
  }

  // No recognized Control-Plane actor role (Req 5.6).
  return { ok: false, reason: "unrecognized_role" };
}

/**
 * Pure: membership test for a single `(platformId, tenantId)` pair against a
 * scope. An `unrestricted` scope contains every pair; a `tenant` scope contains
 * exactly the pairs whose `tenantId` matches (case-sensitive exact, any
 * platform); a `pairs` scope contains exactly the enumerated pairs
 * (case-sensitive exact on both components) (Req 5.2, 5.4, 5.7).
 */
export function isPairInScope(
  scope: AuthorizationScope,
  platformId: string,
  tenantId: string
): boolean {
  switch (scope.kind) {
    case "unrestricted":
      return true;
    case "tenant":
      return tenantId === scope.tenantId;
    case "pairs":
      return scope.pairs.some(
        (p) => p.platformId === platformId && p.tenantId === tenantId
      );
    default: {
      // Exhaustiveness guard.
      const _never: never = scope;
      return _never;
    }
  }
}

/**
 * Pure: keeps only the rows whose `(platformId, tenantId)` is within the scope
 * (Req 4.4, 5.3). An `unrestricted` scope returns every row (a fresh array).
 */
export function filterToScope<T extends { platformId: string; tenantId: string }>(
  scope: AuthorizationScope,
  rows: T[]
): T[] {
  if (scope.kind === "unrestricted") {
    return [...rows];
  }
  return rows.filter((row) => isPairInScope(scope, row.platformId, row.tenantId));
}

// ---------------------------------------------------------------------------
// Convex boundary
// ---------------------------------------------------------------------------

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

/**
 * Convex helper: resolves the caller from `ctx.auth.getUserIdentity()` + the
 * `users` table into a role + scope, or a typed failure. Every Control-Plane
 * surface calls this FIRST and returns no integration data on failure.
 *
 * - No identity (or no email on the identity) → `unauthenticated`.
 * - Identity present but no recognized actor role → `unrecognized_role`.
 * - Partner whose scope cannot be derived → `scope_undeterminable`.
 *
 * Works from query/mutation contexts (direct `ctx.db` lookup by the `email`
 * index) and from action contexts (delegates to the `users.currentUser` query,
 * which resolves the same identity server-side).
 */
export async function requireActor(ctx: AnyCtx): Promise<ActorResolution> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) {
    return { ok: false, reason: "unauthenticated" };
  }

  const email = identity.email;
  let user: ActorUserRecord | null;

  if ("db" in ctx) {
    user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
  } else {
    // Action context has no direct db access; resolve via the identity-aware
    // query, which runs with the same auth context.
    user = await ctx.runQuery(api.users.currentUser, {});
  }

  return resolveActorFromUser(user);
}

/**
 * Authorize a session caller to read or write the Integration_Config for a
 * `(platformId, tenantId)` pair. Throws "Forbidden"/"Unauthorized" on denial so
 * the caller fails closed and performs NO read/write.
 *
 * This is the single authorization gate the base Integration_Admin entry points
 * enforce so they are safe even when invoked DIRECTLY (bypassing the scoped
 * Control-Plane wrappers). It admits three principals:
 *
 *   1. `platform_admin` — unrestricted across all tenants.
 *   2. a tenant owner (`restaurant_owner` / `business_owner`) whose own
 *      `tenantId` equals the target `tenantId` — the per-tenant admin surface
 *      (`PlatformIntegrationAdmin`) that calls these entry points directly.
 *   3. a `partner` whose Authorization_Scope (explicit pair override, else
 *      derived from `tenantId`) contains the target pair — matching the scope
 *      the Control-Plane wrappers enforce, so the wrapper→base delegation path
 *      (which propagates the caller's identity) still passes.
 *
 * Branch managers / supervisors and any other role are denied: integration
 * credentials are an owner/admin surface, not an operational one.
 *
 * Works from query/mutation contexts directly; the node-runtime actions call it
 * through a thin `internalQuery` wrapper (they lack `ctx.db`), which runs with
 * the same propagated auth identity.
 */
export async function authorizeIntegrationConfigAccess(
  ctx: QueryCtx | MutationCtx,
  platformId: string,
  tenantId: string
): Promise<void> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    throw new Error("Unauthorized: authentication required");
  }

  // 1. Platform admin — unrestricted.
  if (isPlatformAdmin(user)) return;

  // 2. Tenant owner acting on their OWN tenant.
  if (
    user.role &&
    TENANT_OWNER_ROLES.includes(user.role as AppRole) &&
    user.tenantId === tenantId
  ) {
    return;
  }

  // 3. Partner whose Authorization_Scope contains the target pair.
  if (user.role === "partner") {
    const resolution = resolveActorFromUser({
      role: user.role,
      tenantId: user.tenantId,
      authorizationScope: user.authorizationScope,
    });
    if (
      resolution.ok &&
      isPairInScope(resolution.scope, platformId, tenantId)
    ) {
      return;
    }
  }

  throw new Error(
    "Forbidden: you do not have access to this integration configuration"
  );
}
