/**
 * Feature: platform-control-plane (Task 3.2)
 *
 * Credential-test-history and connection-status read/append surfaces.
 *
 * This module exposes the Convex boundary for Requirement 8 observability:
 *   - `appendCredentialTestOutcome` (internal mutation): the ONLY write path,
 *     an append-only insert of a `(platformId, tenantId, outcome, completedAt)`
 *     record. No update or delete mutation is exposed, keeping the
 *     `credentialTestHistory` table append-only by construction (Req 8.2, 8.4).
 *   - `getCredentialTestHistory` (authorized query): returns the ≤100
 *     most-recent outcomes for a pair, most-recent-first, scoped to the caller's
 *     Authorization_Scope (Req 8.3, 8.4, 8.6, 8.7).
 *   - `getConnectionStatus` (authorized query): the current Connection_Status
 *     for a pair, or `{ recorded: false }` when no Integration record exists
 *     (Req 8.1, 8.5, 8.7).
 *
 * Every read calls `requireActor(ctx)` FIRST and then verifies the requested
 * `(platformId, tenantId)` is within the actor's scope (admin: unrestricted)
 * via `isPairInScope`, returning NO status/history/Integration data on any
 * authorization failure (Req 8.7). No credential value is ever read or written
 * here (Req 8.4, 11).
 *
 * Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { isPairInScope, requireActor } from "./authorization";
import type { ActorResolution } from "./authorization";
import {
  CREDENTIAL_TEST_HISTORY_PAGE_LIMIT,
  mostRecentPage,
} from "./credentialTestHistory.logic";
import type {
  ConnectionStatus,
  CredentialTestRecord,
  TestOutcome,
} from "./credentialTestHistory.logic";

// ---------------------------------------------------------------------------
// Authorization helper
// ---------------------------------------------------------------------------

/**
 * Resolves the caller and verifies the requested `(platformId, tenantId)` pair
 * is within the actor's Authorization_Scope. Throws an authorization/
 * authentication error (returning no data) when the actor cannot be resolved or
 * the pair is out of scope (Req 8.7). A `platform_admin` is unrestricted, so
 * every pair is in scope for it (Req 5.1).
 */
async function authorizePair(
  resolution: ActorResolution,
  platformId: string,
  tenantId: string
): Promise<void> {
  if (!resolution.ok) {
    if (resolution.reason === "unauthenticated") {
      throw new Error("Unauthorized: authentication required.");
    }
    throw new Error("Unauthorized: not permitted to access this integration.");
  }

  if (!isPairInScope(resolution.scope, platformId, tenantId)) {
    throw new Error("Unauthorized: integration is outside your scope.");
  }
}

// ---------------------------------------------------------------------------
// Append-only write path (internal)
// ---------------------------------------------------------------------------

/**
 * Append-only insert of a credential-test outcome (Req 8.2, 8.4).
 *
 * Invoked from the credential-test record callback (wired in Task 3.3). This is
 * the sole write path to `credentialTestHistory`; no update or delete mutation
 * is exposed, so the history is immutable by construction. The record
 * references the Integration by `(platformId, tenantId)` only and carries no
 * credential value (Req 8.4). Callers pass a `completedAt` already truncated to
 * a whole UTC second (see `truncateToSecondUtc` in the pure logic module).
 */
export const appendCredentialTestOutcome = internalMutation({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    completedAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("credentialTestHistory", {
      platformId: args.platformId,
      tenantId: args.tenantId,
      outcome: args.outcome,
      completedAt: args.completedAt,
    });
  },
});

// ---------------------------------------------------------------------------
// Authorized reads
// ---------------------------------------------------------------------------

/**
 * Returns the credential-test history for an Integration within the caller's
 * Authorization_Scope (Req 8.3, 8.4, 8.6, 8.7).
 *
 * Queries `credentialTestHistory` via the `by_platform_tenant_time` index in
 * descending `completedAt` order and takes at most the 100 most-recent rows,
 * then routes them through the pure `mostRecentPage` helper for a total,
 * deterministic most-recent-first order. Each returned record references the
 * Integration by `(platformId, tenantId)` only and never a credential value
 * (Req 8.4). An Integration with no recorded outcomes yields an empty array —
 * not an error (Req 8.6). Out-of-scope / unresolved actor → authorization error
 * with no data (Req 8.7).
 */
export const getCredentialTestHistory = query({
  args: { platformId: v.string(), tenantId: v.string() },
  handler: async (ctx, args): Promise<CredentialTestRecord[]> => {
    const resolution = await requireActor(ctx);
    await authorizePair(resolution, args.platformId, args.tenantId);

    const rows = await ctx.db
      .query("credentialTestHistory")
      .withIndex("by_platform_tenant_time", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .order("desc")
      .take(CREDENTIAL_TEST_HISTORY_PAGE_LIMIT);

    const records: CredentialTestRecord[] = rows.map((row) => ({
      platformId: row.platformId,
      tenantId: row.tenantId,
      outcome: row.outcome as TestOutcome,
      completedAt: row.completedAt,
    }));

    return mostRecentPage(records, CREDENTIAL_TEST_HISTORY_PAGE_LIMIT);
  },
});

/**
 * Returns the current Connection_Status for an Integration within the caller's
 * Authorization_Scope (Req 8.1, 8.5, 8.7).
 *
 * When an Integration record exists for the pair, returns
 * `{ recorded: true, status }` with the status as exactly one of `connected`,
 * `disconnected`, or `error`. When no Integration record exists, returns
 * `{ recorded: false }` rather than an error (Req 8.5). Out-of-scope /
 * unresolved actor → authorization error with no data (Req 8.7).
 */
export const getConnectionStatus = query({
  args: { platformId: v.string(), tenantId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<
    { recorded: true; status: ConnectionStatus } | { recorded: false }
  > => {
    const resolution = await requireActor(ctx);
    await authorizePair(resolution, args.platformId, args.tenantId);

    const row = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();

    if (!row) {
      return { recorded: false };
    }

    return { recorded: true, status: row.status as ConnectionStatus };
  },
});
