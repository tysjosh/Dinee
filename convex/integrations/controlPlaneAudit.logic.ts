/**
 * Feature: platform-control-plane (Task 3.4)
 *
 * Pure, property-testable core for the scoped Integration_Audit_Log views
 * (Requirement 9). These functions carry NO Convex `ctx` and perform no I/O, so
 * they can be exercised directly by unit and property tests. The Convex query
 * module (`controlPlaneAudit.ts`) delegates row loading to Convex and then hands
 * the raw rows to `scopeOrderPageAuditEntries` for scoping, mapping, ordering,
 * and pagination.
 *
 * Covered behaviors:
 *   - 9.1/9.2/9.3: entries ordered by event timestamp DESCENDING, in a page of
 *     at most 100 entries.
 *   - 9.3/9.5: entries restricted to the actor's Authorization_Scope; anything
 *     outside scope is excluded from the returned set.
 *   - 9.4: each returned entry references credentials by NAME only (`details` is
 *     already name-only by construction) and carries no credential value.
 *   - 9.7: an empty in-scope set yields an empty result (the surface treats this
 *     as a normal empty result, not an error).
 */

import type { AuthorizationScope } from "./authorization";
import { filterToScope } from "./authorization";

/** The maximum number of audit entries returned in a single page (Req 9.1–9.3). */
export const AUDIT_LOG_PAGE_LIMIT = 100;

/** The credential-lifecycle action recorded on an audit entry. */
export type AuditActionType =
  | "create"
  | "rotate"
  | "revoke"
  | "expire"
  | "connect"
  | "disconnect";

/**
 * A Control-Plane audit entry projection (Req 9). `tenantId`/`platformId` are
 * the Control-Plane names for the stored `businessId`/`integrationName`. The
 * `details` field is name-only by construction and never carries a credential
 * value (Req 9.4).
 */
export interface AuditEntryView {
  entryId: string;
  tenantId: string;
  platformId: string;
  actionType: AuditActionType;
  actorUserId: string;
  actorRole: string;
  details?: string;
  createdAt: number;
}

/**
 * The stored `integrationAuditLog` row shape this module projects from.
 * Declared locally (rather than importing a Convex `Doc`) so the helpers stay
 * pure and runtime-free; Convex system fields (`_id`, `_creationTime`) are
 * ignored. A `Doc<"integrationAuditLog">` is structurally assignable to this
 * type.
 */
export interface RawAuditRow {
  entryId: string;
  businessId: string;
  integrationName: string;
  actionType: AuditActionType;
  actorUserId: string;
  actorRole: string;
  details?: string;
  createdAt: number;
}

/**
 * Maps a stored audit row to its Control-Plane view, renaming `businessId →
 * tenantId` and `integrationName → platformId` and copying only the name-only
 * `details` (never a credential value) (Req 9.4). Pure and non-mutating.
 */
export function toAuditEntryView(row: RawAuditRow): AuditEntryView {
  const view: AuditEntryView = {
    entryId: row.entryId,
    tenantId: row.businessId,
    platformId: row.integrationName,
    actionType: row.actionType,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    createdAt: row.createdAt,
  };
  // Preserve an absent `details` as absent (never coerce to `undefined`),
  // keeping the projection faithful to the stored, name-only value.
  if (row.details !== undefined) {
    view.details = row.details;
  }
  return view;
}

/**
 * Orders audit views by event timestamp DESCENDING (Req 9.1–9.3). The order is
 * total and deterministic: ties on `createdAt` are broken by `entryId`
 * ascending so repeated identical requests return an identical page. Pure and
 * non-mutating: sorting is performed on a copy.
 */
export function orderAuditEntries(views: readonly AuditEntryView[]): AuditEntryView[] {
  return [...views].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    if (a.entryId !== b.entryId) return a.entryId < b.entryId ? -1 : 1;
    return 0;
  });
}

/**
 * Scopes, maps, orders, and paginates raw audit rows in one pure step (Req 9).
 *
 * 1. Projects each raw row to its name-only {@link AuditEntryView} (Req 9.4).
 * 2. Keeps only the entries whose `(platformId, tenantId)` is within the
 *    actor's Authorization_Scope; everything outside scope is excluded
 *    (Req 9.3, 9.5). An `unrestricted` (platform_admin) scope keeps every row.
 * 3. Orders the survivors by event timestamp descending (Req 9.1–9.3).
 * 4. Returns a page of at most `limit` (default 100) entries; an empty in-scope
 *    set yields an empty array (Req 9.7).
 *
 * Pure and non-mutating.
 */
export function scopeOrderPageAuditEntries(
  rows: readonly RawAuditRow[],
  scope: AuthorizationScope,
  limit: number = AUDIT_LOG_PAGE_LIMIT
): AuditEntryView[] {
  const cap = Math.max(0, Math.min(limit, AUDIT_LOG_PAGE_LIMIT));
  const views = rows.map(toAuditEntryView);
  const scoped = filterToScope(scope, views);
  return orderAuditEntries(scoped).slice(0, cap);
}
