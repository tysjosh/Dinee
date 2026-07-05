"use node";

/**
 * Runsheet integration configuration — save/validate + credential test (Dinee).
 *
 * These are Convex **actions** because they need capabilities the default
 * Convex mutation runtime does not provide:
 *   - AES-256-GCM encryption via the existing Node `encryptionService`
 *     (`src/lib/integrations/encryptionService.ts`), which imports `node:crypto`.
 *   - An outbound authenticated HTTP request for the credential test.
 *
 * Persistence and the pure validation logic live in `./integrationsData.ts`
 * (default runtime); these actions validate first, encrypt, then delegate the
 * write to the internal mutation so a rejected save never touches the table.
 *
 * Reused primitives (per design): the AES-256-GCM `encryptionService`, the
 * `runsheetIntegrations` table, the `integrationAuditLog` (secrets by name),
 * and the `RunsheetApiClient` credential test.
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7 (dinee-voice-platform)
 */

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  encrypt,
  decrypt,
  extractLast4,
} from "../../src/lib/integrations/encryptionService";
import { RunsheetApiClient } from "../../src/lib/integrations/runsheet/apiClient";
import { validateIntegrationConfig } from "./integrationsData";

const reviewModeArg = v.union(
  v.literal("always_review"),
  v.literal("auto_submit_low_risk")
);

const escalationTargetArg = v.object({
  kind: v.union(v.literal("phone"), v.literal("email"), v.literal("webhook")),
  value: v.string(),
});

/**
 * Result of a save attempt. `success: false` carries the offending `field`
 * (Req 8.6, 8.7) so the admin UI can point at the exact input; on failure the
 * stored integration is left unchanged.
 */
type SaveResult =
  | { success: true }
  | { success: false; field: string; error: string };

/**
 * Validates, encrypts, and persists a Runsheet integration configuration.
 *
 * Order of operations (so an invalid config never mutates state, Req 8.6/8.7):
 *   1. Validate review mode + required base URL / tenant id / API key.
 *   2. Encrypt the API key and webhook secret with AES-256-GCM (Req 8.2).
 *   3. Derive `apiKeyLast4` for masked display (Req 8.3).
 *   4. Persist via the internal mutation, which also writes an audit entry
 *      that references the secrets by name only (Req 8.3).
 */
export const saveIntegration = action({
  args: {
    tenantId: v.string(),
    baseUrl: v.string(),
    runsheetTenantId: v.string(),
    apiKey: v.string(),
    webhookSecret: v.string(),
    defaultReviewMode: reviewModeArg,
    allowedConversationTypes: v.array(v.string()),
    autoSubmitEnabled: v.optional(v.boolean()),
    confidenceThreshold: v.optional(v.number()),
    requiresPurchaseOrder: v.optional(v.boolean()),
    escalationTarget: v.optional(escalationTargetArg),
    actorUserId: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SaveResult> => {
    // 1. Validate BEFORE any encryption or write (Req 8.6, 8.7). On failure the
    //    stored integration is left unchanged because nothing is persisted.
    const validation = validateIntegrationConfig({
      baseUrl: args.baseUrl,
      runsheetTenantId: args.runsheetTenantId,
      apiKey: args.apiKey,
      defaultReviewMode: args.defaultReviewMode,
    });
    if (!validation.ok) {
      return {
        success: false,
        field: validation.field,
        error: validation.message,
      };
    }

    // 2. Encrypt secrets with AES-256-GCM (Req 8.2). The webhook secret is
    //    optional at the caller level but always stored encrypted; an empty
    //    string encrypts to a valid non-empty ciphertext.
    const apiKeyEncrypted = encrypt(args.apiKey);
    const webhookSecretEncrypted = encrypt(args.webhookSecret);

    // 3. Masked preview of the API key for the admin UI (Req 8.3).
    const apiKeyLast4 = extractLast4(args.apiKey);

    // 4. Persist through the internal mutation (writes the row + audit entry).
    await ctx.runMutation(internal.runsheet.integrationsData.upsertIntegration, {
      tenantId: args.tenantId,
      baseUrl: args.baseUrl.trim(),
      runsheetTenantId: args.runsheetTenantId.trim(),
      apiKeyEncrypted,
      apiKeyLast4,
      webhookSecretEncrypted,
      defaultReviewMode: args.defaultReviewMode,
      allowedConversationTypes: args.allowedConversationTypes,
      autoSubmitEnabled: args.autoSubmitEnabled ?? false,
      confidenceThreshold: args.confidenceThreshold,
      requiresPurchaseOrder: args.requiresPurchaseOrder,
      escalationTarget: args.escalationTarget,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
    });

    return { success: true };
  },
});

/**
 * Result of a credential test (Req 8.5). Reports validity within 5 seconds;
 * network errors, non-2xx responses, and timeouts are reported as invalid.
 */
type CredentialTestResult = { valid: boolean; error?: string };

/**
 * Attempts an authenticated request against a Runsheet base URL and reports,
 * within 5 seconds, whether the credential is valid (Req 8.5).
 *
 * Two modes:
 *   - Ad-hoc: pass `baseUrl`, `runsheetTenantId`, and `apiKey` directly (used
 *     from the admin form before the config is saved).
 *   - Stored: pass only `tenantId`; the stored integration is read and its API
 *     key decrypted for the test. The integration's `status` is updated to
 *     reflect the result.
 */
export const testCredential = action({
  args: {
    tenantId: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    runsheetTenantId: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CredentialTestResult> => {
    let baseUrl = args.baseUrl;
    let runsheetTenantId = args.runsheetTenantId;
    let apiKey = args.apiKey;

    // Stored mode: load and decrypt the configured credential.
    if ((!baseUrl || !runsheetTenantId || !apiKey) && args.tenantId) {
      const stored = await ctx.runQuery(
        internal.runsheet.integrationsData.getIntegrationByTenantInternal,
        { tenantId: args.tenantId }
      );
      if (!stored) {
        return {
          valid: false,
          error: "No Runsheet integration configured for this tenant",
        };
      }
      baseUrl = baseUrl ?? stored.baseUrl;
      runsheetTenantId = runsheetTenantId ?? stored.runsheetTenantId;
      apiKey = apiKey ?? decrypt(stored.apiKeyEncrypted);
    }

    if (!baseUrl || !runsheetTenantId || !apiKey) {
      return {
        valid: false,
        error:
          "Credential test requires a base URL, tenant identifier, and API key",
      };
    }

    const client = new RunsheetApiClient({
      baseUrl,
      apiKey,
      tenantId: runsheetTenantId,
    });

    const { valid } = await client.testCredential();

    // Reflect the result on the stored integration's status when testing a
    // saved configuration (Req 8.5).
    if (args.tenantId) {
      await ctx.runMutation(
        internal.runsheet.integrationsData.setIntegrationStatus,
        { tenantId: args.tenantId, status: valid ? "connected" : "error" }
      );
    }

    return { valid };
  },
});
