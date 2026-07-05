"use node";

/**
 * Generic multi-platform Integration Admin entry points (Dinee-owned).
 *
 * These are the thin, PUBLIC Convex **actions** the Integration_Admin_UI drives
 * for any registered platform. They exist because:
 *   - `configStore.upsertIntegrationConfig` is an `internalMutation` and the
 *     credential ciphertext must be produced with AES-256-GCM (`node:crypto`)
 *     BEFORE the write — capabilities only the Node runtime provides; and
 *   - the credential test must construct the platform's Integration_Adapter
 *     (from decrypted credentials) and probe its read surface.
 *
 * They run in the Node runtime (`"use node"`) because they use the shared
 * `encryptionService` (`node:crypto`) and build the platform adapter. They
 * mirror the Runsheet reference (`convex/runsheet/integrations.ts`): validate/
 * encrypt in the action, then delegate persistence to the internal mutation so
 * a rejected save never touches the table, and secrets are stored by name only.
 *
 * Security posture (per design):
 *   - Credentials are encrypted with the platform's Transport_Contract key salt
 *     so one platform's ciphertext cannot be decrypted with another's (Req 12.2).
 *   - Only ciphertext + last-4 previews reach persistence — never plaintext.
 *   - The credential test decrypts locally, holds plaintext only for the probe,
 *     and records the resulting Connection_Status via `setConnectionStatus`.
 *
 * Requirements: 9.1, 9.3 (multi-platform-voice-integrations)
 */

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  encrypt,
  decrypt,
  extractLast4,
} from "../../src/lib/integrations/encryptionService";
import { resolvePlatform } from "../../src/lib/integrations/platform/registry";
import { registerRunsheetPlatform } from "../../src/lib/integrations/runsheet/platform";
import { runCredentialTest } from "../../src/lib/integrations/platform/credentialTest";
import {
  statusToOutcome,
  truncateToSecondUtc,
} from "./credentialTestHistory.logic";
import type { AdapterConstructionContext } from "../../src/lib/integrations/platform/types";
import type {
  ConnectionStatus,
  RuntimeIntegrationConfig,
} from "./configStore";

// Ensure built-in platforms (Runsheet — the first adapter) are registered in
// THIS action's runtime so the platform's Transport_Contract (key salt) and
// adapter factory are resolvable for encryption and credential testing. Safe to
// call on every module load: registration is idempotent.
registerRunsheetPlatform();

/**
 * The result of a save attempt. On failure `field` names the offending input so
 * the admin UI can point at the exact field (Req 9.5); on failure nothing is
 * persisted so any existing record is left unchanged.
 */
type SaveResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "missing_field" | "unknown_platform"; field: string };

/**
 * Encrypts and persists an Integration_Config for a `(platformId, tenantId)`
 * pair (Req 9.1).
 *
 * Order of operations (so an invalid save never mutates state):
 *   1. Resolve the platform's Transport_Contract key salt (Req 12.2).
 *   2. Encrypt each supplied credential value with AES-256-GCM and derive a
 *      last-4 preview for masked display (Req 2.2, 2.8).
 *   3. Delegate to the internal `upsertIntegrationConfig` mutation, which
 *      validates BEFORE writing (empty base URL, plus the platform-registration
 *      decision resolved HERE and forwarded as `platformRegistered` — the
 *      default-runtime mutation cannot see this isolate's registry) and writes a
 *      name-only audit entry. Its typed `SaveResult` is returned unchanged so
 *      the UI can surface the offending field.
 *
 * Only credential entries with a non-empty value are encrypted and stored, so
 * an optional credential left blank is simply omitted rather than stored as an
 * empty secret. Required-field enforcement happens in the UI (Req 9.5) and the
 * base-URL / platform checks happen in the mutation.
 */
export const saveIntegrationConfig = action({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    baseUrl: v.string(),
    platformTenantId: v.string(),
    /** Plaintext credential values keyed by credential name (never stored). */
    credentials: v.record(v.string(), v.string()),
    allowedConversationTypes: v.array(v.string()),
    config: v.any(),
    actorUserId: v.optional(v.string()),
    actorRole: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SaveResult> => {
    // 1. Resolve the platform in THIS action's runtime — the isolate where the
    //    Integration_Registry is populated (`registerRunsheetPlatform()` above).
    //    The default-runtime mutation cannot see that registration, so the
    //    unknown-platform gate (Req 2.4) is decided here and forwarded to the
    //    mutation as `platformRegistered`. Also resolve the platform's optional
    //    per-platform key salt so credentials are encrypted under an isolated
    //    key (Req 12.2).
    const resolved = resolvePlatform(args.platformId);
    const platformRegistered = resolved.resolved;
    const keySalt = resolved.resolved
      ? resolved.definition.contract.keySalt
      : undefined;

    // 2. Encrypt every supplied (non-empty) credential and derive last-4.
    const credentialsEncrypted: Record<string, string> = {};
    const credentialsLast4: Record<string, string> = {};
    for (const [name, rawValue] of Object.entries(args.credentials)) {
      const value = rawValue.trim();
      if (value.length === 0) {
        continue;
      }
      credentialsEncrypted[name] = encrypt(value, keySalt);
      credentialsLast4[name] = extractLast4(value);
    }

    // 3. Persist through the internal mutation (validate-before-write + audit).
    const result: SaveResult = await ctx.runMutation(
      internal.integrations.configStore.upsertIntegrationConfig,
      {
        platformId: args.platformId,
        tenantId: args.tenantId,
        baseUrl: args.baseUrl.trim(),
        platformTenantId: args.platformTenantId.trim(),
        credentialsEncrypted,
        credentialsLast4,
        allowedConversationTypes: args.allowedConversationTypes,
        config: args.config,
        platformRegistered,
        actorUserId: args.actorUserId,
        actorRole: args.actorRole,
      }
    );

    return result;
  },
});

/**
 * The result of a credential test surfaced to the admin UI (Req 9.3). Carries
 * the recorded Connection_Status and, when the probe could not be attempted
 * (no config, unregistered platform, decrypt/adapter failure), a human-readable
 * reason. The returned `status` is always one of `connected` | `disconnected`
 * | `error` so the UI can render a consistent badge.
 */
type CredentialTestResult = { status: ConnectionStatus; error?: string };

/**
 * Runs the Credential_Test_Service for a stored Integration_Config and returns
 * the resulting Connection_Status for the UI to display (Req 9.3).
 *
 * Loads the stored ciphertext + config via the internal runtime query, resolves
 * the platform, decrypts each credential LOCALLY with the platform's key salt
 * (held only for the probe), builds the platform's Integration_Adapter via its
 * factory, then delegates to `runCredentialTest` — which probes the adapter's
 * read client against a 5s deadline and records the outcome through
 * `setConnectionStatus` (success → `connected`, failure/timeout → `error`).
 */
export const testIntegrationCredential = action({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
  },
  handler: async (ctx, args): Promise<CredentialTestResult> => {
    // Load the stored ciphertext + config for the exact pair.
    const config: RuntimeIntegrationConfig | null = await ctx.runQuery(
      internal.integrations.configStore.getConfigForRuntimeInternal,
      { platformId: args.platformId, tenantId: args.tenantId }
    );
    if (config === null) {
      return {
        status: "error",
        error: "No integration is configured for this platform and tenant.",
      };
    }

    // Resolve the platform so we have its adapter factory + Transport_Contract.
    const resolved = resolvePlatform(args.platformId);
    if (!resolved.resolved) {
      return {
        status: "error",
        error: `Platform "${args.platformId}" is not registered.`,
      };
    }
    const definition = resolved.definition;
    const keySalt = definition.contract.keySalt;

    // Decrypt each stored credential locally for the probe (volatile). A
    // decryption failure (wrong key/salt, tampered data) is reported as an
    // error without probing.
    const credentials: Record<string, string> = {};
    try {
      for (const [name, ciphertext] of Object.entries(
        config.credentialsEncrypted
      )) {
        credentials[name] = decrypt(ciphertext, keySalt);
      }
    } catch {
      return {
        status: "error",
        error: "Failed to decrypt the stored credentials.",
      };
    }

    // Build the platform's Integration_Adapter from the decrypted materials.
    const adapterCtx: AdapterConstructionContext = {
      baseUrl: config.baseUrl,
      platformTenantId: config.platformTenantId,
      credentials,
      config: (config.config ?? {}) as Record<string, unknown>,
      contract: definition.contract,
    };

    let adapter;
    try {
      adapter = definition.adapterFactory(adapterCtx);
    } catch {
      return {
        status: "error",
        error: "Failed to construct the integration adapter.",
      };
    }

    // Probe via the adapter read client and record the resulting status onto
    // the stored record via `setConnectionStatus` (Req 8.2, 8.3, 8.4).
    //
    // Additively, append an immutable Credential_Test outcome to the
    // append-only history alongside the status write (Req 8.2, 12.2). The
    // outcome maps from the Connection_Status via `statusToOutcome`
    // (connected → success, otherwise failure) and carries a whole-second UTC
    // `completedAt`. The append is a pure side effect: it references the
    // Integration by `(platformId, tenantId)` only, never a credential value,
    // and a history-append failure must not alter this action's return
    // contract, so it is guarded independently of the status write.
    const status = await runCredentialTest(adapter, async (nextStatus) => {
      await ctx.runMutation(
        internal.integrations.configStore.setConnectionStatus,
        {
          platformId: args.platformId,
          tenantId: args.tenantId,
          status: nextStatus,
        }
      );

      try {
        await ctx.runMutation(
          internal.integrations.credentialTestHistory
            .appendCredentialTestOutcome,
          {
            platformId: args.platformId,
            tenantId: args.tenantId,
            outcome: statusToOutcome(nextStatus),
            completedAt: truncateToSecondUtc(Date.now()),
          }
        );
      } catch {
        // Swallow: recording history is additive observability and must never
        // change the credential-test result the UI receives.
      }
    });

    return { status };
  },
});
