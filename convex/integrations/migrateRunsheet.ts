/**
 * Migration_Service — one-time, idempotent migration of the Runsheet-specific
 * integration + number-assignment records into the generic multi-platform
 * tables (Dinee-owned).
 *
 * This is the staged-rollout bridge that makes Runsheet the FIRST adapter of
 * the generic system WITHOUT re-encrypting or altering any credential material
 * and WITHOUT touching the live Runsheet call path. It copies:
 *
 *   - each `runsheetIntegrations` row  → an `integrations` row keyed by
 *     `("runsheet", tenantId)`, preserving `baseUrl`, the AES-256-GCM
 *     credential ciphertext BYTE-FOR-BYTE (never re-encrypted), the platform
 *     config blob, and the connection `status` (Req 10.2, 10.3);
 *   - each `runsheetNumberAssignments` row → a `phoneRoutes` row with
 *     `platformId: "runsheet"`, carrying `phoneNumber`, `tenantId`, and
 *     `conversationType` (Req 10.4).
 *
 * Design guarantees:
 *   - Idempotent: an already-migrated pair `(runsheet, tenantId)` / an
 *     already-routed `phoneNumber` is SKIPPED, never duplicated. Re-running on
 *     a fully migrated dataset performs no new writes and reports
 *     `idempotentNoop: true`.
 *   - Per-record failure isolation: a failure copying one record is caught, the
 *     ORIGINAL Runsheet row is left unchanged, the failing id + reason is
 *     recorded in the report, and migration continues with the remaining
 *     records (Req 10.6).
 *
 * The Runsheet-side tenant identifier (`runsheetTenantId`) maps to the generic
 * `platformTenantId`. The Runsheet credential columns map into the generic
 * name-keyed `credentialsEncrypted` map as `{ api_key, webhook_secret }`, with
 * the API key's last-4 preview preserved under `credentialsLast4.api_key`.
 *
 * Requirements: 10.2, 10.3, 10.4, 10.5, 10.6 (multi-platform-voice-integrations)
 */

import { internalMutation } from "../_generated/server";

/** The stable Platform_Id Runsheet is registered under (Req 10.1). */
const RUNSHEET_PLATFORM_ID = "runsheet";

/**
 * A single record that could not be migrated. The original Runsheet row is left
 * unchanged and its id + reason are reported so an operator can investigate
 * (Req 10.6).
 */
export interface MigrationFailure {
  table: "runsheetIntegrations" | "runsheetNumberAssignments";
  id: string;
  reason: string;
}

/**
 * The outcome of a migration run.
 *
 *   - `integrationsCopied` — new `integrations` rows written this run.
 *   - `routesCopied`       — new `phoneRoutes` rows written this run.
 *   - `failures`           — records left unmigrated, with their id + reason.
 *   - `idempotentNoop`     — true when the run produced no new writes and had no
 *                            failures (the idempotence marker for a re-run over
 *                            an already-migrated dataset).
 */
export interface MigrationReport {
  integrationsCopied: number;
  routesCopied: number;
  failures: MigrationFailure[];
  idempotentNoop: boolean;
}

/**
 * Copies each `runsheetIntegrations` row into `integrations` keyed by
 * `("runsheet", tenantId)`, preserving ciphertext byte-for-byte (never
 * re-encrypting), and each `runsheetNumberAssignments` row into `phoneRoutes`
 * with `platformId: "runsheet"`.
 *
 * Idempotent: an already-migrated `(runsheet, tenantId)` pair / an already
 * routed `phoneNumber` is skipped rather than duplicated. On a per-record
 * failure the original Runsheet row is left unchanged and the failing id is
 * reported while migration continues (Req 10.6). Returns a {@link MigrationReport}.
 */
export const migrateRunsheetToGeneric = internalMutation({
  args: {},
  handler: async (ctx): Promise<MigrationReport> => {
    const failures: MigrationFailure[] = [];
    let integrationsCopied = 0;
    let routesCopied = 0;

    // ---------------------------------------------------------------------
    // 1. runsheetIntegrations → integrations keyed by ("runsheet", tenantId)
    // ---------------------------------------------------------------------
    const runsheetIntegrations = await ctx.db
      .query("runsheetIntegrations")
      .collect();

    for (const row of runsheetIntegrations) {
      try {
        // Idempotence: skip a pair that has already been migrated (Req 10.2).
        const existing = await ctx.db
          .query("integrations")
          .withIndex("by_platform_tenant", (q) =>
            q.eq("platformId", RUNSHEET_PLATFORM_ID).eq("tenantId", row.tenantId)
          )
          .unique();

        if (existing) {
          continue;
        }

        const now = Date.now();

        // Insert preserving ciphertext BYTE-FOR-BYTE — never re-encrypted
        // (Req 10.3, 10.5). The Runsheet-side tenant id becomes the generic
        // platformTenantId; the Runsheet credential columns become the
        // name-keyed credential map.
        await ctx.db.insert("integrations", {
          platformId: RUNSHEET_PLATFORM_ID,
          tenantId: row.tenantId,
          baseUrl: row.baseUrl,
          platformTenantId: row.runsheetTenantId,
          credentialsEncrypted: {
            api_key: row.apiKeyEncrypted,
            webhook_secret: row.webhookSecretEncrypted,
          },
          // Only the API key carries a stored last-4 preview in the source
          // schema; preserve it (Req 10.3). The webhook secret has none.
          credentialsLast4: {
            api_key: row.apiKeyLast4,
          },
          allowedConversationTypes: row.allowedConversationTypes,
          // Preserve the Runsheet platform config in the generic config blob.
          config: {
            defaultReviewMode: row.defaultReviewMode,
            autoSubmitEnabled: row.autoSubmitEnabled,
            confidenceThreshold: row.confidenceThreshold,
            requiresPurchaseOrder: row.requiresPurchaseOrder,
            escalationTarget: row.escalationTarget,
          },
          // Preserve the original connection status (Req 10.3).
          status: row.status,
          createdAt: now,
          updatedAt: now,
        });

        integrationsCopied += 1;
      } catch (error) {
        // Per-record failure isolation: the original row is untouched (we only
        // ever insert into the target table), record the id + reason, continue
        // (Req 10.6).
        failures.push({
          table: "runsheetIntegrations",
          id: row._id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ---------------------------------------------------------------------
    // 2. runsheetNumberAssignments → phoneRoutes with platformId "runsheet"
    // ---------------------------------------------------------------------
    const numberAssignments = await ctx.db
      .query("runsheetNumberAssignments")
      .collect();

    for (const row of numberAssignments) {
      try {
        // Idempotence: a phone number resolves to exactly one route, so an
        // already-routed number is skipped rather than duplicated (Req 10.4).
        const existing = await ctx.db
          .query("phoneRoutes")
          .withIndex("by_phone_number", (q) =>
            q.eq("phoneNumber", row.phoneNumber)
          )
          .unique();

        if (existing) {
          continue;
        }

        await ctx.db.insert("phoneRoutes", {
          phoneNumber: row.phoneNumber,
          platformId: RUNSHEET_PLATFORM_ID,
          tenantId: row.tenantId,
          conversationType: row.conversationType,
          createdAt: Date.now(),
        });

        routesCopied += 1;
      } catch (error) {
        failures.push({
          table: "runsheetNumberAssignments",
          id: row._id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      integrationsCopied,
      routesCopied,
      failures,
      // A re-run over a fully migrated dataset writes nothing and fails on
      // nothing — the idempotence marker.
      idempotentNoop:
        integrationsCopied === 0 && routesCopied === 0 && failures.length === 0,
    };
  },
});
