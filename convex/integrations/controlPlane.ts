/**
 * Control-Plane cross-platform read surfaces (Task 3.1).
 *
 * New AUTHORIZED Convex queries layered additively on top of the preserved
 * single-pair primitives. They read the generic `integrations` table and
 * project every row through the pure masking guard so no ciphertext or
 * plaintext credential value is ever returned.
 *
 * Every surface calls `requireActor(ctx)` FIRST and returns NO integration
 * data on an authorization failure (Req 2.9, 3.5, 4.5, 5.1–5.4). Reads apply
 * the pure `applyIntegrationFilter` / `sortIntegrations` / `filterToScope`
 * helpers so ordering is deterministic (Req 2.1) and scoping is enforced
 * uniformly (Req 4, 5).
 *
 * Surfaces:
 *   - `listIntegrations`      — admin-only cross-platform list (Req 2).
 *   - `listForPartner`        — partner-scoped list (Req 4).
 *   - `getIntegrationDetail`  — single-pair masked detail, role/scope-gated (Req 3).
 *
 * Requirements: 2.1–2.10, 3.1–3.6, 4.1–4.5, 5.1–5.4
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import {
  filterToScope,
  isPairInScope,
  requireActor,
} from "./authorization";
import {
  applyIntegrationFilter,
  isValidConnectionStatus,
  sortIntegrations,
  toMaskedSummary,
  type IntegrationFilter,
} from "./controlPlane.logic";
import type {
  ConnectionStatus,
  MaskedIntegrationConfig,
} from "./configStore";

export type { ConnectionStatus, MaskedIntegrationConfig, IntegrationFilter };

/** The permitted Connection_Status filter values (Req 2.4). */
const connectionStatusValidator = v.union(
  v.literal("connected"),
  v.literal("disconnected"),
  v.literal("error")
);

// ---------------------------------------------------------------------------
// Authorization-error helpers
// ---------------------------------------------------------------------------

/**
 * Maps an actor-resolution failure to a thrown authorization/authentication
 * error. Throwing (rather than returning) guarantees the surface returns NO
 * integration data on failure (Req 2.9, 3.5, 4.5, 5.4, 5.6).
 */
function denyFromResolution(resolution: {
  ok: false;
  reason: "unauthenticated" | "unrecognized_role" | "scope_undeterminable";
}): never {
  switch (resolution.reason) {
    case "unauthenticated":
      throw new Error("Unauthenticated: no authenticated actor for this request");
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
// Query helpers (row loading)
// ---------------------------------------------------------------------------

/**
 * Loads `integrations` rows using the most selective available index for the
 * supplied filter (Req 2.1 indexing note): `by_platform_tenant` when a platform
 * (± tenant) is supplied, `by_tenant_id` when only a tenant is supplied, else a
 * full scan. Status is applied in-memory by {@link applyIntegrationFilter}.
 */
async function loadRowsForFilter(ctx: QueryCtx, filter: IntegrationFilter) {
  if (filter.platform !== undefined) {
    return ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) => {
        const scoped = q.eq("platformId", filter.platform as string);
        return filter.tenant !== undefined
          ? scoped.eq("tenantId", filter.tenant)
          : scoped;
      })
      .collect();
  }

  if (filter.tenant !== undefined) {
    return ctx.db
      .query("integrations")
      .withIndex("by_tenant_id", (q) =>
        q.eq("tenantId", filter.tenant as string)
      )
      .collect();
  }

  return ctx.db.query("integrations").collect();
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Admin-only cross-platform integration list (Req 2).
 *
 * Denies any non-admin caller with an authorization error and no data
 * (Req 2.9). Rejects a malformed/empty filter value (empty/whitespace platform
 * or tenant, or an unrecognized status) with an error, leaving all integration
 * data unchanged (Req 2.10). Applies all supplied filters together with
 * AND-semantics using exact case-sensitive equality (Req 2.2, 2.3, 2.4, 2.5);
 * no match → empty list, not an error (Req 2.8). Returns
 * `MaskedIntegrationConfig[]` in deterministic `(platformId, tenantId)` order,
 * identical across repeated identical requests (Req 2.1), exposing at most the
 * last-4 preview and never ciphertext/plaintext (Req 2.6, 2.7).
 */
export const listIntegrations = query({
  args: {
    platform: v.optional(v.string()),
    tenant: v.optional(v.string()),
    status: v.optional(connectionStatusValidator),
  },
  handler: async (ctx, args): Promise<MaskedIntegrationConfig[]> => {
    // Authorize FIRST; admin-only surface (Req 2.9, 5.1).
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }
    if (actor.role !== "platform_admin") {
      throw new Error(
        "Forbidden: cross-platform listing requires the platform_admin role"
      );
    }

    // Reject malformed/empty filter values BEFORE reading, leaving data
    // unchanged (Req 2.10). A query never mutates, but validating up front and
    // throwing guarantees no data is returned for a malformed request.
    if (args.platform !== undefined && args.platform.trim().length === 0) {
      throw new Error("Invalid filter: platform must not be empty");
    }
    if (args.tenant !== undefined && args.tenant.trim().length === 0) {
      throw new Error("Invalid filter: tenant must not be empty");
    }
    if (args.status !== undefined && !isValidConnectionStatus(args.status)) {
      throw new Error("Invalid filter: unrecognized connection status");
    }

    const filter: IntegrationFilter = {
      platform: args.platform,
      tenant: args.tenant,
      status: args.status,
    };

    const rows = await loadRowsForFilter(ctx, filter);
    const filtered = applyIntegrationFilter(rows, filter);
    const sorted = sortIntegrations(filtered);
    return sorted.map((row) => toMaskedSummary(row));
  },
});

/**
 * Partner-scoped integration list (Req 4).
 *
 * Returns exactly one `MaskedIntegrationConfig` for each integration whose
 * `(platformId, tenantId)` pair is within the caller's Authorization_Scope
 * (Req 4.1, 4.4), masked (Req 4.2), in deterministic order. When the scope
 * contains no integration the list is empty (Req 4.3). A caller whose scope
 * cannot be determined (or who carries no recognized role / is unauthenticated)
 * is denied with an authorization error and no data (Req 4.5, 5.6).
 *
 * A `platform_admin` (unrestricted scope) receives every integration, so this
 * surface is safe for both tiers.
 */
export const listForPartner = query({
  args: {},
  handler: async (ctx): Promise<MaskedIntegrationConfig[]> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }

    const scope = actor.scope;

    // Load the narrowest candidate set the scope allows, then apply the pure
    // scope filter for exact membership semantics (Req 4.1, 4.4).
    let rows;
    if (scope.kind === "tenant") {
      rows = await ctx.db
        .query("integrations")
        .withIndex("by_tenant_id", (q) => q.eq("tenantId", scope.tenantId))
        .collect();
    } else {
      // unrestricted (admin) or explicit pairs → scan then filter.
      rows = await ctx.db.query("integrations").collect();
    }

    const scoped = filterToScope(scope, rows);
    const sorted = sortIntegrations(scoped);
    return sorted.map((row) => toMaskedSummary(row));
  },
});

/** Result of a detail lookup: the masked config, or an absence indication. */
export type IntegrationDetailResult =
  | { found: true; config: MaskedIntegrationConfig }
  | { found: false };

/**
 * Masked detail for a single `(platformId, tenantId)` pair, authorized by the
 * caller's role/scope (Req 3, 5).
 *
 * An unauthenticated / unrecognized caller, or a partner requesting a pair
 * outside scope, is denied with an authorization error and no detail
 * (Req 3.5, 5.4). When the caller is authorized but no record exists for the
 * pair, an empty `{ found: false }` result is returned — this is absence, NOT
 * an error (Req 3.3). Any retrieval failure other than absence propagates as an
 * error with no partial detail (Req 3.6). The returned config is masked-only,
 * exposing at most the last-4 preview and never ciphertext/plaintext
 * (Req 3.2, 3.4).
 */
export const getIntegrationDetail = query({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
  },
  handler: async (ctx, args): Promise<IntegrationDetailResult> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      denyFromResolution(actor);
    }

    // Scope gate: a pair outside the caller's scope is denied with an
    // authorization error and no detail (Req 3.5, 5.4). Admin scope is
    // unrestricted, so this always passes for a platform_admin (Req 5.1).
    if (!isPairInScope(actor.scope, args.platformId, args.tenantId)) {
      throw new Error(
        "Forbidden: requested integration is outside the caller's authorization scope"
      );
    }

    // A retrieval failure other than absence (e.g. an index error) propagates
    // naturally, returning no partial detail (Req 3.6).
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();

    // Absence is a normal empty result, not an error (Req 3.3).
    if (!row) {
      return { found: false };
    }

    return { found: true, config: toMaskedSummary(row) };
  },
});
