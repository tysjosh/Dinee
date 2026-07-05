/**
 * Runsheet integration configuration — persistence + validation (Dinee-owned).
 *
 * This module holds the Convex query/mutation surface for the
 * `runsheetIntegrations` table. It runs in the default Convex runtime and is
 * driven by the node-runtime actions in `./integrations.ts`, which perform the
 * AES-256-GCM encryption (via `encryptionService`) and the outbound credential
 * test that the default runtime cannot do.
 *
 * Ownership boundary: this is integration *configuration* Dinee owns, never
 * order-of-record data (that lives in the Runsheet backend).
 *
 * Validation guarantees (Req 8.6, 8.7): a configuration is only persisted when
 * its review mode is one of the two allowed values and its base URL, tenant
 * identifier, and API key are all present. On any validation failure the
 * stored integration is left unchanged (the mutation throws before any write).
 *
 * Secret handling (Req 8.3): audit entries reference secrets by name only
 * (`api_key`, `webhook_secret`) and never reproduce the secret value.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7 (dinee-voice-platform)
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";

/** The two review modes a Runsheet integration may declare (Req 8.4). */
export const REVIEW_MODES = ["always_review", "auto_submit_low_risk"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

const reviewModeValidator = v.union(
  v.literal("always_review"),
  v.literal("auto_submit_low_risk")
);

const escalationTargetValidator = v.object({
  kind: v.union(v.literal("phone"), v.literal("email"), v.literal("webhook")),
  value: v.string(),
});

/**
 * The result of validating a Runsheet integration configuration.
 * When invalid, `field` names the offending field so the caller can surface it
 * (Req 8.6, 8.7) and no persistence is attempted.
 */
export type IntegrationValidation =
  | { ok: true }
  | { ok: false; field: string; message: string };

/**
 * Pure validator for the review mode and required identity fields
 * (Req 8.4, 8.6, 8.7). Shared by the node-runtime action (pre-validation, so a
 * rejected save never encrypts or writes) and the persistence mutation
 * (defense in depth, so the table is never written with invalid data).
 */
export function validateIntegrationConfig(input: {
  baseUrl: string;
  runsheetTenantId: string;
  apiKey: string;
  defaultReviewMode: string;
}): IntegrationValidation {
  // Review mode must be exactly one of the two allowed values (Req 8.4, 8.6).
  if (!REVIEW_MODES.includes(input.defaultReviewMode as ReviewMode)) {
    return {
      ok: false,
      field: "defaultReviewMode",
      message: `Review mode must be one of ${REVIEW_MODES.join(", ")}; got "${input.defaultReviewMode}"`,
    };
  }

  // Required identity fields must all be present (Req 8.7).
  if (!input.baseUrl || input.baseUrl.trim().length === 0) {
    return { ok: false, field: "baseUrl", message: "Base URL is required" };
  }
  if (!input.runsheetTenantId || input.runsheetTenantId.trim().length === 0) {
    return {
      ok: false,
      field: "runsheetTenantId",
      message: "Tenant identifier is required",
    };
  }
  if (!input.apiKey || input.apiKey.trim().length === 0) {
    return { ok: false, field: "apiKey", message: "API key is required" };
  }

  return { ok: true };
}

/**
 * Builds the audit-log `details` string for a Runsheet integration write.
 *
 * Pure and side-effect free so it can be property-tested in isolation. The
 * returned string references stored secrets BY NAME ONLY — `api_key` (with at
 * most a masked last-4 preview) and `webhook_secret` — and never reproduces
 * the raw API key or webhook secret value (Req 8.3).
 *
 * @param existing - whether an integration already existed (update vs create)
 * @param apiKeyLast4 - the last 4 chars of the API key, safe for display
 * @returns the audit detail string, containing only secret names + last-4
 */
export function buildIntegrationAuditDetail(
  existing: boolean,
  apiKeyLast4: string
): string {
  return `Runsheet integration ${existing ? "updated" : "created"}; encrypted secrets stored by reference: api_key (last4 ${apiKeyLast4}), webhook_secret`;
}

/**
 * Reads the stored integration for a tenant (internal — exposes the encrypted
 * secrets so the node action can decrypt them for a credential test).
 */
export const getIntegrationByTenantInternal = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .unique();
  },
});

/**
 * Public, masked view of a tenant's Runsheet integration for the admin UI.
 * Never returns the encrypted secrets — only the last 4 of the API key
 * (Req 8.3).
 */
export const getIntegration = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .unique();

    if (!row) {
      return null;
    }

    return {
      tenantId: row.tenantId,
      baseUrl: row.baseUrl,
      runsheetTenantId: row.runsheetTenantId,
      apiKeyLast4: row.apiKeyLast4,
      defaultReviewMode: row.defaultReviewMode,
      allowedConversationTypes: row.allowedConversationTypes,
      autoSubmitEnabled: row.autoSubmitEnabled,
      confidenceThreshold: row.confidenceThreshold,
      requiresPurchaseOrder: row.requiresPurchaseOrder,
      escalationTarget: row.escalationTarget,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * The runtime credential shape the standalone Voice_Runtime needs to construct
 * its per-call Runsheet clients — including the ENCRYPTED secrets (ciphertext)
 * for the API key and webhook secret. Explicitly named so both the internal
 * query and its fronting action can annotate their return type, breaking the
 * Convex circular type-inference cycle (action → internal.* → this module).
 */
export type RuntimeIntegrationConfig = {
  baseUrl: string;
  runsheetTenantId: string;
  apiKeyEncrypted: string;
  webhookSecretEncrypted: string;
  allowedConversationTypes: string[];
  autoSubmitEnabled: boolean;
  confidenceThreshold?: number;
  requiresPurchaseOrder?: boolean;
  defaultReviewMode: ReviewMode;
  status: "connected" | "disconnected" | "error";
};

/**
 * Runtime credential-retrieval seam — INTERNAL query.
 *
 * Returns the encrypted secrets (ciphertext) + config the Voice_Runtime needs.
 * This is `internalQuery`, so it is NOT reachable directly from a client; it is
 * only callable from the {@link getIntegrationForRuntime} action below, which
 * enforces the service-token check (Finding 3). The ws-server decrypts the
 * ciphertext LOCALLY via the shared `encryptionService`.
 *
 * SECURITY: `apiKeyEncrypted` / `webhookSecretEncrypted` are AES-256-GCM
 * ciphertext, useless without the INTEGRATION_ENCRYPTION_KEY held by the
 * ws-server. Never returns plaintext secrets. Returns `null` when the tenant
 * has no configured integration.
 *
 * Requirements: 5.6, 8.1, 8.2, 8.3 (dinee-voice-platform)
 */
export const getIntegrationForRuntimeInternal = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, args): Promise<RuntimeIntegrationConfig | null> => {
    const row = await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .unique();

    if (!row) {
      return null;
    }

    return {
      baseUrl: row.baseUrl,
      runsheetTenantId: row.runsheetTenantId,
      apiKeyEncrypted: row.apiKeyEncrypted,
      webhookSecretEncrypted: row.webhookSecretEncrypted,
      allowedConversationTypes: row.allowedConversationTypes,
      autoSubmitEnabled: row.autoSubmitEnabled,
      confidenceThreshold: row.confidenceThreshold,
      requiresPurchaseOrder: row.requiresPurchaseOrder,
      defaultReviewMode: row.defaultReviewMode,
      status: row.status,
    };
  },
});

/**
 * Public, service-token-guarded action fronting
 * {@link getIntegrationForRuntimeInternal} (Finding 3).
 *
 * The standalone ws-server calls this action with the shared
 * `RUNSHEET_RUNTIME_SERVICE_TOKEN`. Only a caller presenting a token that
 * matches the value configured on the Convex deployment can retrieve a
 * tenant's ciphertext + config — closing the previous hole where any client
 * could enumerate arbitrary tenants' integration configuration via a public
 * query.
 *
 * Fail-closed: if the deployment has no `RUNSHEET_RUNTIME_SERVICE_TOKEN`
 * configured, or the presented token does not match, the action throws and no
 * config is returned.
 *
 * Requirements: 5.6, 8.1, 8.2, 8.3 (dinee-voice-platform)
 */
export const getIntegrationForRuntime = action({
  args: { tenantId: v.string(), serviceToken: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<RuntimeIntegrationConfig | null> => {
    const expected = process.env.RUNSHEET_RUNTIME_SERVICE_TOKEN;
    // Fail closed: reject when the deployment has no token configured, or the
    // presented token is empty / does not match.
    if (
      !expected ||
      expected.length === 0 ||
      args.serviceToken.length === 0 ||
      args.serviceToken !== expected
    ) {
      throw new Error("Unauthorized: invalid runtime service token");
    }

    return await ctx.runQuery(
      internal.runsheet.integrationsData.getIntegrationForRuntimeInternal,
      { tenantId: args.tenantId }
    );
  },
});

/**
 * Persists an integration configuration (create or update, keyed by tenant).
 *
 * Receives already-encrypted secrets and the derived `apiKeyLast4` from the
 * node-runtime action. Re-validates review mode and required fields as defense
 * in depth; on any validation failure it throws BEFORE writing so the stored
 * integration is left unchanged (Req 8.6, 8.7). Writes an audit entry that
 * references the stored secrets by name only (Req 8.3).
 */
export const upsertIntegration = internalMutation({
  args: {
    tenantId: v.string(),
    baseUrl: v.string(),
    runsheetTenantId: v.string(),
    apiKeyEncrypted: v.string(),
    apiKeyLast4: v.string(),
    webhookSecretEncrypted: v.string(),
    defaultReviewMode: reviewModeValidator,
    allowedConversationTypes: v.array(v.string()),
    autoSubmitEnabled: v.boolean(),
    confidenceThreshold: v.optional(v.number()),
    requiresPurchaseOrder: v.optional(v.boolean()),
    escalationTarget: v.optional(escalationTargetValidator),
    actorUserId: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Defense-in-depth validation. The encrypted-secret presence check guards
    // against an empty ciphertext slipping through; the review-mode check is
    // enforced by the arg validator too, but we keep it explicit for parity
    // with the action-level error semantics (Req 8.6, 8.7).
    if (!REVIEW_MODES.includes(args.defaultReviewMode)) {
      throw new Error(
        `Invalid review mode: ${args.defaultReviewMode}. Stored integration unchanged.`
      );
    }
    if (!args.baseUrl.trim() || !args.runsheetTenantId.trim()) {
      throw new Error(
        "Missing base URL or tenant identifier. Stored integration unchanged."
      );
    }
    if (!args.apiKeyEncrypted || !args.apiKeyLast4) {
      throw new Error(
        "Missing encrypted API key. Stored integration unchanged."
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        baseUrl: args.baseUrl,
        runsheetTenantId: args.runsheetTenantId,
        apiKeyEncrypted: args.apiKeyEncrypted,
        apiKeyLast4: args.apiKeyLast4,
        webhookSecretEncrypted: args.webhookSecretEncrypted,
        defaultReviewMode: args.defaultReviewMode,
        allowedConversationTypes: args.allowedConversationTypes,
        autoSubmitEnabled: args.autoSubmitEnabled,
        confidenceThreshold: args.confidenceThreshold,
        requiresPurchaseOrder: args.requiresPurchaseOrder,
        escalationTarget: args.escalationTarget,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("runsheetIntegrations", {
        tenantId: args.tenantId,
        baseUrl: args.baseUrl,
        runsheetTenantId: args.runsheetTenantId,
        apiKeyEncrypted: args.apiKeyEncrypted,
        apiKeyLast4: args.apiKeyLast4,
        webhookSecretEncrypted: args.webhookSecretEncrypted,
        defaultReviewMode: args.defaultReviewMode,
        allowedConversationTypes: args.allowedConversationTypes,
        autoSubmitEnabled: args.autoSubmitEnabled,
        confidenceThreshold: args.confidenceThreshold,
        requiresPurchaseOrder: args.requiresPurchaseOrder,
        escalationTarget: args.escalationTarget,
        status: "disconnected",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Audit entry referencing secrets BY NAME ONLY — never the value (Req 8.3).
    await ctx.db.insert("integrationAuditLog", {
      entryId: crypto.randomUUID(),
      businessId: args.tenantId,
      integrationName: "runsheet",
      actionType: existing ? "rotate" : "create",
      actorUserId: args.actorUserId ?? "system",
      actorRole: args.actorRole ?? "platform_admin",
      details: buildIntegrationAuditDetail(Boolean(existing), args.apiKeyLast4),
      createdAt: now,
    });

    return { success: true };
  },
});

/**
 * Records the outcome of a credential test on the stored integration's status
 * (Req 8.5). Called by the node-runtime `testCredential` action.
 */
export const setIntegrationStatus = internalMutation({
  args: {
    tenantId: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error")
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        updatedAt: Date.now(),
      });
    }
  },
});
