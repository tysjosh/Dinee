/**
 * Control-Plane scoped management wrappers (platform-control-plane).
 *
 * Thin, authorized wrappers that gate the preserved single-pair base entry
 * points behind the two-tier authorization model. Each wrapper:
 *
 *   1. resolves the calling actor via `requireActor(ctx)` FIRST — on failure it
 *      returns a typed authorization error and performs NO write (Req 5.6);
 *   2. verifies the target `(platformId, tenantId)` pair is within the actor's
 *      Authorization_Scope via the pure `isPairInScope` predicate — a
 *      `platform_admin` is unrestricted and always passes (Req 5.1); a partner
 *      whose target pair is out of scope is denied and the target is left
 *      byte-for-byte unchanged (Req 5.5, 5.7, 7.6);
 *   3. only then DELEGATES to the preserved base entry point unchanged, via
 *      `ctx.runAction` / `ctx.runMutation` against the generated `api`.
 *
 * These wrappers are ADDITIVE. They never alter the signatures (name, params,
 * types, return type) of the base `saveIntegrationConfig` /
 * `testIntegrationCredential` actions or the `savePhoneRoute` mutation — they
 * accept the identical argument shapes and forward them verbatim after the
 * scope gate (Req 12.2).
 *
 * They are declared as Convex **actions** because delegation to another action
 * (`saveIntegrationConfig`, `testIntegrationCredential`) or a mutation
 * (`savePhoneRoute`) requires an action context (`ctx.runAction` /
 * `ctx.runMutation`); `requireActor` supports action contexts by resolving
 * identity through the `users.currentUser` query. They run in the DEFAULT
 * runtime (no `"use node"`) — the base node-runtime actions still perform all
 * encryption/adapter work in their own isolate.
 *
 * Requirements: 5.1, 5.5, 5.7, 7.3, 7.6
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { isPairInScope, requireActor } from "./authorization";
import type { ActorResolution } from "./authorization";
import type { ConnectionStatus } from "./configStore";

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

/**
 * A denial returned by a scoped wrapper. `reason` distinguishes an
 * authentication/role failure from an in-scope violation so the console can
 * render an accurate message. On any denial NO write is performed and the
 * target Integration is left unchanged (Req 5.5, 5.7, 7.6).
 */
export type ScopedAuthzError = {
  ok: false;
  code: "unauthorized";
  reason:
    | "unauthenticated"
    | "unrecognized_role"
    | "scope_undeterminable"
    | "out_of_scope";
};

/** Mirrors the base `saveIntegrationConfig` action's typed result. */
type BaseSaveResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "missing_field" | "unknown_platform"; field: string };

/** The scoped save wrapper's result: the base result, or an authz denial. */
export type ScopedSaveResult = BaseSaveResult | ScopedAuthzError;

/** The scoped credential-test wrapper's result. */
export type ScopedCredentialTestResult =
  | { ok: true; status: ConnectionStatus; error?: string }
  | ScopedAuthzError;

/** The scoped phone-route wrapper's result. */
export type ScopedRouteResult =
  | { ok: true; routeId: Id<"phoneRoutes">; updated: boolean }
  | ScopedAuthzError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a failed `requireActor` resolution to a `ScopedAuthzError`, preserving
 * the specific failure reason. Never returns integration data.
 */
function denyFromActor(
  resolution: Extract<ActorResolution, { ok: false }>
): ScopedAuthzError {
  return { ok: false, code: "unauthorized", reason: resolution.reason };
}

// ---------------------------------------------------------------------------
// Scoped management wrappers (delegate, never duplicate)
// ---------------------------------------------------------------------------

/**
 * Scope-checked wrapper around the base `saveIntegrationConfig` action.
 *
 * Resolves the actor, verifies the target `(platformId, tenantId)` pair is in
 * scope (admin: always), then delegates the identical arguments to the base
 * action which performs encryption + validate-before-write + audit. An
 * out-of-scope partner is denied BEFORE delegation, so the target Integration
 * is left byte-for-byte unchanged (Req 5.5, 5.7, 7.6). A `platform_admin` is
 * unrestricted and always in scope (Req 5.1).
 *
 * Requirements: 5.1, 5.5, 5.7, 7.6
 */
export const saveIntegrationConfigScoped = action({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    baseUrl: v.string(),
    platformTenantId: v.string(),
    credentials: v.record(v.string(), v.string()),
    allowedConversationTypes: v.array(v.string()),
    config: v.any(),
    actorUserId: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ScopedSaveResult> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      return denyFromActor(actor);
    }
    if (!isPairInScope(actor.scope, args.platformId, args.tenantId)) {
      return { ok: false, code: "unauthorized", reason: "out_of_scope" };
    }

    // In scope — delegate to the preserved base action unchanged.
    return await ctx.runAction(
      api.integrations.adminConfig.saveIntegrationConfig,
      {
        platformId: args.platformId,
        tenantId: args.tenantId,
        baseUrl: args.baseUrl,
        platformTenantId: args.platformTenantId,
        credentials: args.credentials,
        allowedConversationTypes: args.allowedConversationTypes,
        config: args.config,
        actorUserId: args.actorUserId,
        actorRole: args.actorRole,
      }
    );
  },
});

/**
 * Scope-checked wrapper around the base `savePhoneRoute` mutation.
 *
 * Resolves the actor, verifies the target `(platformId, tenantId)` pair is in
 * scope, then delegates the identical arguments to the base mutation. An
 * out-of-scope partner is denied BEFORE delegation, leaving all routes
 * unchanged (Req 7.3, 7.6).
 *
 * Requirements: 5.1, 5.5, 5.7, 7.3, 7.6
 */
export const savePhoneRouteScoped = action({
  args: {
    phoneNumber: v.string(),
    platformId: v.string(),
    tenantId: v.string(),
    conversationType: v.string(),
  },
  handler: async (ctx, args): Promise<ScopedRouteResult> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      return denyFromActor(actor);
    }
    if (!isPairInScope(actor.scope, args.platformId, args.tenantId)) {
      return { ok: false, code: "unauthorized", reason: "out_of_scope" };
    }

    // In scope — delegate to the preserved base mutation unchanged.
    const result = await ctx.runMutation(
      api.integrations.phoneRoutes.savePhoneRoute,
      {
        phoneNumber: args.phoneNumber,
        platformId: args.platformId,
        tenantId: args.tenantId,
        conversationType: args.conversationType,
      }
    );

    return { ok: true, routeId: result.routeId, updated: result.updated };
  },
});

/**
 * Scope-checked wrapper around the base `testIntegrationCredential` action.
 *
 * Resolves the actor, verifies the target `(platformId, tenantId)` pair is in
 * scope, then delegates to the base action which decrypts locally, probes the
 * platform adapter, and records the resulting Connection_Status. An
 * out-of-scope partner is denied BEFORE delegation (Req 5.5, 5.7).
 *
 * Requirements: 5.1, 5.5, 5.7
 */
export const testIntegrationCredentialScoped = action({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
  },
  handler: async (ctx, args): Promise<ScopedCredentialTestResult> => {
    const actor = await requireActor(ctx);
    if (!actor.ok) {
      return denyFromActor(actor);
    }
    if (!isPairInScope(actor.scope, args.platformId, args.tenantId)) {
      return { ok: false, code: "unauthorized", reason: "out_of_scope" };
    }

    // In scope — delegate to the preserved base action unchanged.
    const result = await ctx.runAction(
      api.integrations.adminConfig.testIntegrationCredential,
      { platformId: args.platformId, tenantId: args.tenantId }
    );

    return { ok: true, status: result.status, error: result.error };
  },
});
