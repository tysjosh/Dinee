/**
 * Generic multi-platform Integration_Config_Store (Dinee-owned).
 *
 * Supersedes the Runsheet-specific `runsheetIntegrations` store
 * (`convex/runsheet/integrationsData.ts`) as the config-driven, multi-platform
 * persistence surface for integration configuration. It is kept ADDITIVELY
 * alongside the Runsheet store during the staged rollout so live Runsheet
 * traffic is never disrupted.
 *
 * Records are keyed by the pair `(platformId, tenantId)` and hold the base URL,
 * platform-side tenant id, AES-256-GCM credential ciphertext (keyed by
 * credential name), last-4 previews, allowed conversation types, an arbitrary
 * platform config blob, and a connection status. This is integration
 * CONFIGURATION Dinee owns; it is NOT order-of-record data (that lives in the
 * external platform backend).
 *
 * It mirrors the exact security posture of the reference implementation:
 *   - a masked public view that never returns decrypted OR ciphertext values,
 *     exposing at most the last 4 characters of each credential (Req 2.8, 12.4);
 *   - an internal query (behind a service-token action added in a later task)
 *     that returns the ciphertext + config the Voice_Runtime needs (Req 2.2);
 *   - validate-before-write so a rejected save leaves any existing record
 *     unchanged (Req 2.3, 2.4);
 *   - audit entries that reference credentials BY NAME ONLY, never by value
 *     (Req 12.3, 12.4), written to the reused `integrationAuditLog` table.
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 8.2, 8.3, 12.3, 12.4
 *   (multi-platform-voice-integrations)
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** The connection state of an Integration_Config (Req 2.6, 8.2, 8.3). */
export type ConnectionStatus = "connected" | "disconnected" | "error";

const connectionStatusValidator = v.union(
  v.literal("connected"),
  v.literal("disconnected"),
  v.literal("error")
);

// ---------------------------------------------------------------------------
// Pure helpers (no Convex deps — property-testable in isolation)
// ---------------------------------------------------------------------------

/**
 * The result of validating an Integration_Config save. When invalid, `field`
 * names the offending field so the caller can surface it and no persistence is
 * attempted.
 */
export type ConfigValidation =
  | { ok: true }
  | { ok: false; code: "missing_field" | "unknown_platform"; field: string };

/**
 * Pure validator for an Integration_Config save.
 *
 * Rejects an empty / whitespace-only base URL with a missing-field error naming
 * the base URL (Req 2.3), and rejects a save for a platform that is not
 * registered in the Integration_Registry with an unknown-platform error naming
 * the offending Platform_Id (Req 2.4). The `isRegistered` predicate is injected
 * so this function has no Convex or registry dependency and can be
 * property-tested in isolation.
 *
 * @param input - the `platformId` and `baseUrl` being saved
 * @param isRegistered - predicate reporting whether a Platform_Id is registered
 * @returns `{ ok: true }` when valid, otherwise a typed rejection
 */
export function validateIntegrationConfig(
  input: { platformId: string; baseUrl: string },
  isRegistered: (platformId: string) => boolean
): ConfigValidation {
  // Req 2.3: empty / whitespace base URL is rejected, naming the field.
  if (!input.baseUrl || input.baseUrl.trim().length === 0) {
    return { ok: false, code: "missing_field", field: "baseUrl" };
  }

  // Req 2.4: an unregistered platform is rejected, naming the Platform_Id.
  if (!isRegistered(input.platformId)) {
    return { ok: false, code: "unknown_platform", field: input.platformId };
  }

  return { ok: true };
}

/**
 * Builds the audit-log `details` string for an Integration_Config write.
 *
 * Pure and side-effect free so it can be property-tested in isolation. The
 * returned string references stored credentials BY NAME ONLY, with at most a
 * masked last-4 preview per credential, and NEVER reproduces any full
 * credential value (Req 12.3, 12.4).
 *
 * @param existing - whether a config already existed (update vs create)
 * @param platformId - the Platform_Id whose config was written
 * @param credentialsLast4 - last-4 previews keyed by credential name
 * @returns the audit detail string, containing only credential names + last-4
 */
export function buildIntegrationAuditDetail(
  existing: boolean,
  platformId: string,
  credentialsLast4: Record<string, string>
): string {
  const names = Object.keys(credentialsLast4).sort();
  const refs =
    names.length > 0
      ? names
          .map((name) => `${name} (last4 ${credentialsLast4[name]})`)
          .join(", ")
      : "(none)";
  return `${platformId} integration ${existing ? "updated" : "created"}; encrypted secrets stored by reference: ${refs}`;
}

// ---------------------------------------------------------------------------
// Convex surface
// ---------------------------------------------------------------------------

/** Masked view for the admin UI — never returns ciphertext or plaintext (Req 2.8). */
export type MaskedIntegrationConfig = {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  /** Last-4 preview per credential name — never a full value (Req 2.8, 9.4). */
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: ConnectionStatus;
  createdAt: number;
  updatedAt: number;
};

/**
 * The runtime credential shape the standalone Voice_Runtime needs to construct
 * its per-call adapter — including the ENCRYPTED credentials (ciphertext) keyed
 * by credential name. Explicitly named so both the internal query and its
 * fronting action (added in a later task) can annotate their return type,
 * breaking Convex's circular type-inference cycle.
 */
export type RuntimeIntegrationConfig = {
  platformId: string;
  baseUrl: string;
  platformTenantId: string;
  /** AES-256-GCM ciphertext keyed by credential name — never plaintext (Req 2.2). */
  credentialsEncrypted: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: ConnectionStatus;
};

/**
 * Upsert an Integration_Config keyed by `(platformId, tenantId)`.
 *
 * Receives already-encrypted credential ciphertext + last-4 previews (the
 * AES-256-GCM encryption happens in the node-runtime action that drives this
 * mutation, mirroring the Runsheet reference). Validates BEFORE any write: an
 * empty base URL is rejected (Req 2.3) and an unregistered platform is rejected
 * (Req 2.4), and on rejection no write occurs so any existing record is left
 * unchanged. When a record already exists for the pair it is updated rather
 * than duplicated (Req 2.5); a newly created record starts `disconnected`
 * (Req 2.6). Writes an audit entry referencing credentials by name only
 * (Req 12.3, 12.4).
 *
 * Returns a typed `SaveResult` rather than throwing on validation failure so
 * the caller can surface the offending field.
 *
 * Runtime-isolation note (Req 2.4): the Integration_Registry is an in-process
 * Map populated by `registerPlatform` at module load. This mutation runs in the
 * DEFAULT Convex runtime, a separate V8 isolate from the `"use node"` action
 * (`adminConfig.saveIntegrationConfig`) that drives it — and that action's
 * isolate is the one where `registerRunsheetPlatform()` runs. The default
 * runtime's registry is therefore empty, so this mutation must NOT consult the
 * registry directly (doing so wrongly rejected every save as
 * `unknown_platform`). Instead the caller — which runs in the isolate where the
 * registry IS populated — resolves registration and passes the decision as
 * `platformRegistered`. The mutation still performs validate-before-write for
 * BOTH the base-URL and the (caller-supplied) platform check, so a rejected
 * save never touches the table. As an `internalMutation` its sole caller is
 * that guarded action, so trusting the caller's registration decision keeps the
 * store's unknown-platform gate intact.
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 12.3, 12.4
 */
export const upsertIntegrationConfig = internalMutation({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    baseUrl: v.string(),
    platformTenantId: v.string(),
    credentialsEncrypted: v.record(v.string(), v.string()),
    credentialsLast4: v.record(v.string(), v.string()),
    allowedConversationTypes: v.array(v.string()),
    config: v.any(),
    /**
     * Whether the Platform_Id is registered in the Integration_Registry,
     * resolved by the caller in the runtime where the registry is populated
     * (see the runtime-isolation note above). Sourced here so the mutation's
     * unknown-platform gate does not depend on the default runtime's registry.
     */
    platformRegistered: v.boolean(),
    actorUserId: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true; created: boolean }
    | { ok: false; code: "missing_field" | "unknown_platform"; field: string }
  > => {
    // Validate before mutate. On rejection we return early BEFORE any write, so
    // an existing record is left unchanged (Req 2.3, 2.4). The platform-
    // registration truth comes from the caller's isolate (see note above), not
    // this runtime's (empty) registry.
    const validation = validateIntegrationConfig(
      { platformId: args.platformId, baseUrl: args.baseUrl },
      () => args.platformRegistered
    );
    if (!validation.ok) {
      return { ok: false, code: validation.code, field: validation.field };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();

    if (existing) {
      // Update the existing record for the pair rather than duplicate (Req 2.5).
      // Status is intentionally preserved on update — it is owned by the
      // credential-test flow via setConnectionStatus (Req 8.2, 8.3).
      await ctx.db.patch(existing._id, {
        baseUrl: args.baseUrl,
        platformTenantId: args.platformTenantId,
        credentialsEncrypted: args.credentialsEncrypted,
        credentialsLast4: args.credentialsLast4,
        allowedConversationTypes: args.allowedConversationTypes,
        config: args.config,
        updatedAt: now,
      });
    } else {
      // A newly created record starts `disconnected` (Req 2.6).
      await ctx.db.insert("integrations", {
        platformId: args.platformId,
        tenantId: args.tenantId,
        baseUrl: args.baseUrl,
        platformTenantId: args.platformTenantId,
        credentialsEncrypted: args.credentialsEncrypted,
        credentialsLast4: args.credentialsLast4,
        allowedConversationTypes: args.allowedConversationTypes,
        config: args.config,
        status: "disconnected",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Audit entry referencing credentials BY NAME ONLY — never the value
    // (Req 12.3, 12.4). Reuses the shared `integrationAuditLog` table.
    await ctx.db.insert("integrationAuditLog", {
      entryId: crypto.randomUUID(),
      businessId: args.tenantId,
      integrationName: args.platformId,
      actionType: existing ? "rotate" : "create",
      actorUserId: args.actorUserId ?? "system",
      actorRole: args.actorRole ?? "platform_admin",
      details: buildIntegrationAuditDetail(
        Boolean(existing),
        args.platformId,
        args.credentialsLast4
      ),
      createdAt: now,
    });

    return { ok: true, created: !existing };
  },
});

/**
 * Records a credential-test outcome on the record's connection status (Req 8.2,
 * 8.3). Called by the Credential_Test_Service. A no-op when no record exists
 * for the pair.
 */
export const setConnectionStatus = internalMutation({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    status: connectionStatusValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Records an UNAUTHORIZED runtime credential-retrieval attempt (Req 3.7).
 *
 * Called by the service-token-guarded action in `./runtimeCredentials.ts`
 * whenever a retrieval is DENIED — missing / empty / whitespace arguments
 * (Req 3.4), no token configured for the platform (Req 3.3), or a presented
 * token that is not byte-for-byte equal to the configured one, including a
 * token that is valid for a DIFFERENT platform (Req 3.2, 12.5).
 *
 * The entry captures ONLY the supplied Platform_Id (`integrationName`), tenant
 * id (`businessId`), and timestamp — it NEVER records the presented service
 * token or any credential value (Req 3.7, 12.3, 12.4). Lives in the default
 * runtime (not `"use node"`) so the node-runtime action can drive it via
 * `ctx.runMutation`. Reuses the shared `integrationAuditLog` table.
 */
export const recordUnauthorizedRuntimeAccess = internalMutation({
  args: { platformId: v.string(), tenantId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("integrationAuditLog", {
      entryId: crypto.randomUUID(),
      businessId: args.tenantId,
      integrationName: args.platformId,
      // Denied runtime retrieval — no dedicated action type is required; the
      // existing lifecycle values cover it (see design note on reuse).
      actionType: "disconnect",
      actorUserId: "voice_runtime",
      actorRole: "system",
      details:
        "Unauthorized runtime credential retrieval denied; no service token or credential value recorded",
      createdAt: Date.now(),
    });
  },
});

/**
 * Runtime credential-retrieval seam — INTERNAL query.
 *
 * Returns the encrypted credentials (ciphertext) + config the Voice_Runtime
 * needs for the `(platformId, tenantId)` pair, or `null` when no config exists.
 * This is `internalQuery`, so it is NOT reachable directly from a client; it is
 * only callable from the service-token-guarded action (added in a later task).
 * The ws-server decrypts the ciphertext LOCALLY via the shared
 * `encryptionService`. Never returns plaintext credentials (Req 2.2).
 */
export const getConfigForRuntimeInternal = internalQuery({
  args: { platformId: v.string(), tenantId: v.string() },
  handler: async (ctx, args): Promise<RuntimeIntegrationConfig | null> => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();

    if (!row) {
      return null;
    }

    return {
      platformId: row.platformId,
      baseUrl: row.baseUrl,
      platformTenantId: row.platformTenantId,
      credentialsEncrypted: row.credentialsEncrypted,
      allowedConversationTypes: row.allowedConversationTypes,
      config: row.config,
      status: row.status,
    };
  },
});

/**
 * Public, masked view of an Integration_Config for the admin UI.
 *
 * Never returns the encrypted credentials OR any decrypted value — only the
 * last-4 preview per credential name (Req 2.8, 12.4). Returns `null` when no
 * config exists for the pair.
 */
export const getMaskedConfig = query({
  args: { platformId: v.string(), tenantId: v.string() },
  handler: async (ctx, args): Promise<MaskedIntegrationConfig | null> => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .unique();

    if (!row) {
      return null;
    }

    return {
      platformId: row.platformId,
      tenantId: row.tenantId,
      baseUrl: row.baseUrl,
      platformTenantId: row.platformTenantId,
      // Last-4 preview only — never ciphertext or plaintext (Req 2.8).
      credentialsLast4: row.credentialsLast4,
      allowedConversationTypes: row.allowedConversationTypes,
      config: row.config,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});
