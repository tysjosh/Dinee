/**
 * Control-Plane scoped Integration_Audit_Log views (Task 3.4).
 *
 * New AUTHORIZED Convex queries layered additively over the existing
 * `integrationAuditLog` table (indexes `by_business_id` = tenant,
 * `by_integration` = platform). Every entry is already name-only by
 * construction, so no credential value/secret is ever exposed (Req 9.4).
 *
 * Every surface calls `requireActor(ctx)` FIRST and returns NO audit entries on
 * any authorization/authentication failure (Req 9.5, 9.6). Entries are ordered
 * by event timestamp DESCENDING and paged at most 100 per response via the pure
 * `scopeOrderPageAuditEntries` helper (Req 9.1–9.3). An authorized request with
 * no in-scope entries returns an empty result — not an error (Req 9.7).
 *
 * The existing `callerRole`-parameter functions in
 * `convex/integrationAuditLog.ts` are intentionally left untouched; these
 * identity-resolved surfaces are the Control-Plane replacements.
 *
 * Surfaces:
 *   - `getAuditLogByTenant`    — admin, entries for a Tenant_Id (Req 9.1).
 *   - `getAuditLogByPlatform`  — admin, entries for a Platform_Id across tenants (Req 9.2).
 *   - `getAuditLogForPartner`  — partner scope-bound entries (Req 9.3).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { requireActor } from "./authorization";
import {
  AUDIT_LOG_PAGE_LIMIT,
  scopeOrderPageAuditEntries,
} from "./controlPlaneAudit.logic";
import type { AuditEntryView, RawAuditRow } from "./controlPlaneAudit.logic";

export type { AuditEntryView };

// ---------------------------------------------------------------------------
// Authorization-error helpers
// ---------------------------------------------------------------------------

/**
 * Maps an actor-resolution failure to a thrown authentication/authorization
 * error. Throwing (rather than returning) guarantees the surface returns NO
 * audit entries on failure: an unauthenticated caller receives an
 * authentication error (Req 9.6); any other resolution failure receives an
 * authorization error (Req 9.5).
 */
function denyFromResolution(resolution: {
  ok: false;
  reason: "unauthenticated" | "unrecognized_role" | "scope_undeterminable";
}): never {
  switch (resolution.reason) {
    case "unauthenticated":
      throw new Error(
        "Unauthenticated: no authenticated actor for this audit request"
      );
    case "unrecognized_role":
      throw new Error(
        "Forbidden: caller has no recognized Control-Plane actor role"
      );
    case "scope_undeterminable":
      throw new Error(
        "Forbidden: caller's authorization scope cannot be determined"
      );
    default: {
      const _never: never = resolution.reason;
      return _never;
    }
  }
}

// ---------------------------------------------------------------------------
// Row loading
// ---------------------------------------------------------------------------

/** Loads the ≤100 most-recently-created audit rows for a Tenant_Id. */
async function loadRowsByTenant(
  ctx: QueryCtx,
  tenantId: string
): Promise<RawAuditRow[]> {
  return ctx.db
    .query("integrationAuditLog")
    .withIndex("by_business_id", (q) => q.eq("businessId", tenantId))
    .order("desc")
    .take(AUDIT_LOG_PAGE_LIMIT);
}

/** Loads the ≤100 most-recently-created audit rows for a Platform_Id. */
async function loadRowsByPlatform(
  ctx: QueryCtx,
  platformId: string
): Promise<RawAuditRow[]> {
  return ctx.db
    .query("integrationAuditLog")
    .withIndex("by_integration", (q) => q.eq("integrationName", platformId))
    .order("desc")
    .take(AUDIT_LOG_PAGE_LIMIT);
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Admin: audit entries scoped to a single Tenant_Id (Req 9.1).
 *
 * Requires the caller to resolve as a `platform_admin`; a non-admin (or
 * unresolved) caller is denied with an authentication/authorization error and
 * no entries (Req 9.5, 9.6). Entries are ordered by event timestamp descending,
 * paged at most 100 (Req 9.1), and name-only (Req 9.4). No matching entries →
 * empty result, not an error (Req 9.7).
 */
export const getAuditLogByTenant = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args): Promise<AuditEntryView[]> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }
    if (actor.role !== "platform_admin") {
      throw new Error(
        "Forbidden: tenant-scoped audit log requires the platform_admin role"
      );
    }

    const rows = await loadRowsByTenant(ctx, args.tenantId);
    // Admin scope is unrestricted, so scoping is a no-op here; the tenant
    // restriction is applied by the index query above.
    return scopeOrderPageAuditEntries(rows, actor.scope, AUDIT_LOG_PAGE_LIMIT);
  },
});

/**
 * Admin: audit entries for a single Platform_Id across all tenants (Req 9.2).
 *
 * Requires the caller to resolve as a `platform_admin`; a non-admin request
 * spans tenants outside a partner's scope and is denied with an authentication/
 * authorization error and no entries (Req 9.5, 9.6). Entries are ordered by
 * event timestamp descending, paged at most 100 (Req 9.2), and name-only
 * (Req 9.4). No matching entries → empty result, not an error (Req 9.7).
 */
export const getAuditLogByPlatform = query({
  args: { platformId: v.string() },
  handler: async (ctx, args): Promise<AuditEntryView[]> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }
    if (actor.role !== "platform_admin") {
      throw new Error(
        "Forbidden: platform-scoped audit log requires the platform_admin role"
      );
    }

    const rows = await loadRowsByPlatform(ctx, args.platformId);
    return scopeOrderPageAuditEntries(rows, actor.scope, AUDIT_LOG_PAGE_LIMIT);
  },
});

/**
 * Partner: audit entries restricted to the caller's Authorization_Scope
 * (Req 9.3).
 *
 * Resolves the caller via `requireActor`; an unauthenticated caller receives an
 * authentication error and no entries (Req 9.6), and a caller whose scope
 * cannot be determined (or who carries no recognized role) receives an
 * authorization error and no entries (Req 9.5). Loads the narrowest candidate
 * set the scope allows, then applies the pure scope filter for exact membership
 * — entries outside scope are excluded (Req 9.3, 9.5). Ordered by event
 * timestamp descending, paged at most 100 (Req 9.3), name-only (Req 9.4). No
 * in-scope entries → empty result, not an error (Req 9.7).
 *
 * A `platform_admin` (unrestricted scope) receives every entry, so this surface
 * is safe for both tiers.
 */
export const getAuditLogForPartner = query({
  args: {},
  handler: async (ctx): Promise<AuditEntryView[]> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }

    const scope = actor.scope;
    let rows: RawAuditRow[];

    if (scope.kind === "tenant") {
      // Every entry for the partner's tenant is in scope (any platform).
      rows = await loadRowsByTenant(ctx, scope.tenantId);
    } else if (scope.kind === "pairs") {
      // Collect all entries for each tenant referenced by the scope's pairs,
      // then let the pure scope filter keep only the exact in-scope pairs.
      const tenantIds = Array.from(
        new Set(scope.pairs.map((p) => p.tenantId))
      );
      const perTenant = await Promise.all(
        tenantIds.map((tenantId) =>
          ctx.db
            .query("integrationAuditLog")
            .withIndex("by_business_id", (q) => q.eq("businessId", tenantId))
            .collect()
        )
      );
      rows = perTenant.flat();
    } else {
      // Unrestricted (a platform_admin using the partner surface) → the ≤100
      // most-recently-created entries across all tenants and platforms.
      rows = await ctx.db
        .query("integrationAuditLog")
        .order("desc")
        .take(AUDIT_LOG_PAGE_LIMIT);
    }

    return scopeOrderPageAuditEntries(rows, scope, AUDIT_LOG_PAGE_LIMIT);
  },
});
