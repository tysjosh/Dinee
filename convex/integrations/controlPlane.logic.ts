/**
 * Control-Plane pure logic helpers (Task 2.6).
 *
 * These are PURE functions with no Convex `ctx` dependency, so they are
 * directly property-testable and reusable by the Control-Plane read surfaces
 * (`listIntegrations` / `getIntegrationDetail` / `listForPartner`).
 *
 * Responsibilities:
 *  - `applyIntegrationFilter` — AND-semantics, exact case-sensitive matching
 *    (Req 2.2, 2.3, 2.4, 2.5, 2.8).
 *  - `sortIntegrations` — total, request-stable `(platformId, tenantId)` order
 *    (Req 2.1).
 *  - `toLast4Preview` / `toMaskedSummary` — masking guard that reveals zero
 *    characters for credentials shorter than 4 and never emits ciphertext or
 *    plaintext (Req 2.6, 2.7, 11.3, 11.4).
 */

// Type-only imports keep this module pure — no Convex server runtime is pulled
// in, so the helpers can run inside property tests without a Convex context.
import type {
  ConnectionStatus,
  MaskedIntegrationConfig,
} from "./configStore";

export type { ConnectionStatus, MaskedIntegrationConfig };

/**
 * Filter criteria for the cross-platform integration list (Req 2.2–2.5).
 * Every supplied field is applied together with AND-semantics; absent fields
 * impose no constraint.
 */
export interface IntegrationFilter {
  /** Exact, case-sensitive Platform_Id match (Req 2.2). */
  platform?: string;
  /** Exact, case-sensitive Tenant_Id match (Req 2.3). */
  tenant?: string;
  /** Exact Connection_Status match, one of connected/disconnected/error (Req 2.4). */
  status?: ConnectionStatus;
}

/**
 * The stored `integrations` row shape this module projects from. Declared
 * locally (rather than importing a Convex `Doc`) to keep the helpers pure and
 * runtime-free. Convex system fields (`_id`, `_creationTime`) are intentionally
 * omitted — they are never part of the masked summary.
 */
export interface StoredIntegrationRow {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  /** AES-256-GCM ciphertext keyed by credential name — never exposed. */
  credentialsEncrypted: Record<string, string>;
  /** Last-4 preview per credential name as stored at save time. */
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: ConnectionStatus;
  createdAt: number;
  updatedAt: number;
}

/** The permitted Connection_Status filter values (Req 2.4). */
const VALID_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  "connected",
  "disconnected",
  "error",
]);

/**
 * Applies all supplied filters together (AND-semantics) using exact,
 * case-sensitive equality for platform and tenant, and exact equality for
 * status (Req 2.2, 2.3, 2.4, 2.5). A row is retained only when it satisfies
 * every constraint that was supplied; absent filter fields impose no
 * constraint. When nothing matches, an empty array is returned — this is a
 * normal empty result, not an error (Req 2.8).
 *
 * Pure and non-mutating: the input array is not modified.
 */
export function applyIntegrationFilter<
  T extends { platformId: string; tenantId: string; status: ConnectionStatus },
>(rows: readonly T[], filter: IntegrationFilter): T[] {
  return rows.filter((row) => {
    if (filter.platform !== undefined && row.platformId !== filter.platform) {
      return false;
    }
    if (filter.tenant !== undefined && row.tenantId !== filter.tenant) {
      return false;
    }
    if (filter.status !== undefined && row.status !== filter.status) {
      return false;
    }
    return true;
  });
}

/**
 * Returns a new array ordered by `(platformId, tenantId)` ascending, giving a
 * total, request-stable order that is identical across repeated identical
 * requests and independent of the input row order (Req 2.1).
 *
 * Pure and non-mutating: sorting is performed on a copy.
 */
export function sortIntegrations<
  T extends { platformId: string; tenantId: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.platformId < b.platformId) return -1;
    if (a.platformId > b.platformId) return 1;
    if (a.tenantId < b.tenantId) return -1;
    if (a.tenantId > b.tenantId) return 1;
    return 0;
  });
}

/**
 * Masking guard for a stored last-4 preview (Req 2.7, 11.3, 11.4).
 *
 * Returns the preview only when it is exactly 4 characters; otherwise returns
 * `""`. A genuine long credential always yields exactly 4 characters at save
 * time, so only short (<4-character) credentials produce a shorter stored
 * preview — for those this reveals zero unmasked characters, closing the
 * `extractLast4` gap, while never truncating a legitimate 4-character preview.
 */
export function toLast4Preview(stored: string): string {
  return stored.length === 4 ? stored : "";
}

/**
 * Projects a stored integration row into a `MaskedIntegrationConfig`, routing
 * every `credentialsLast4` entry through {@link toLast4Preview} and never
 * copying `credentialsEncrypted` (ciphertext) or any plaintext credential value
 * (Req 2.6, 2.7, 11.1, 11.2, 11.3, 11.4).
 *
 * Pure and non-mutating: a fresh preview map and summary object are returned.
 */
export function toMaskedSummary(
  row: StoredIntegrationRow,
): MaskedIntegrationConfig {
  const credentialsLast4: Record<string, string> = {};
  for (const [name, stored] of Object.entries(row.credentialsLast4)) {
    credentialsLast4[name] = toLast4Preview(stored);
  }

  return {
    platformId: row.platformId,
    tenantId: row.tenantId,
    baseUrl: row.baseUrl,
    platformTenantId: row.platformTenantId,
    credentialsLast4,
    allowedConversationTypes: row.allowedConversationTypes,
    config: row.config,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Re-exported for callers that need to validate a status filter value. */
export function isValidConnectionStatus(
  value: string,
): value is ConnectionStatus {
  return VALID_STATUSES.has(value as ConnectionStatus);
}
