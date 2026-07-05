"use node";

/**
 * Runtime_Credential_Service — the generic, multi-platform analogue of the
 * Runsheet-specific `runsheet.integrationsData.getIntegrationForRuntime`.
 *
 * A per-platform, service-token-guarded Convex **action** fronting the internal
 * query `integrations.configStore.getConfigForRuntimeInternal`. The standalone
 * Voice_Runtime (ws-server) calls this at bind time to retrieve the ENCRYPTED
 * credentials (ciphertext) + config for a `(platformId, tenantId)` pair; it
 * then decrypts locally via the shared `encryptionService`. Plaintext
 * credentials are NEVER returned from here (Req 3.5).
 *
 * This runs in the Node runtime (`"use node"`) because it uses `process.env`
 * for the per-platform service token and `node:crypto`'s `timingSafeEqual` for
 * a constant-time token comparison — mirroring `convex/runsheet/integrations.ts`.
 * The `integrationAuditLog` write for a denied retrieval is delegated to the
 * default-runtime internal mutation `recordUnauthorizedRuntimeAccess` (a
 * `"use node"` module cannot itself define queries/mutations).
 *
 * Security posture (mirrors the reference, generalized per-platform):
 *   - Each platform declares its OWN token env var
 *     (`PlatformDefinition.runtimeServiceTokenEnvVar`), so a token valid for one
 *     platform cannot retrieve another platform's credentials (Req 12.5) — this
 *     falls out naturally because a different platform reads a different env var.
 *   - Fail closed: missing / empty / whitespace args (Req 3.4), an unregistered
 *     platform or an unset / empty platform token (Req 3.3), or a token that is
 *     not byte-for-byte equal (Req 3.2) all return `unauthorized` with NO
 *     credentials and a name-only audit entry (Req 3.7).
 *   - Constant-time comparison avoids leaking token length/content via timing.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 12.1, 12.5
 *   (multi-platform-voice-integrations)
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { resolvePlatform } from "../../src/lib/integrations/platform/registry";
import type { RuntimeIntegrationConfig } from "./configStore";
import { authorizeRuntimeCredentialAccess } from "./runtimeCredentialGuard";
import type { RuntimeCredentialResult } from "./runtimeCredentialGuard";

// The decision logic lives in the dependency-injected pure guard
// (`runtimeCredentialGuard.ts`) so the full authorization matrix can be
// property-tested without a Convex runtime or DB. This action stays a thin
// wrapper: it supplies the live dependencies (`resolvePlatform`, `process.env`,
// the internal config query) and performs the audit-log side effect.
export type {
  RuntimeCredentialConfig,
  RuntimeCredentialResult,
} from "./runtimeCredentialGuard";

/**
 * Service-token-guarded runtime credential retrieval.
 *
 * Resolves within 2s (Req 3.1) — the fronted internal query is a single indexed
 * lookup and there is no artificial delay. See the module doc for the full
 * fail-closed matrix.
 */
export const getCredentialsForRuntime = action({
  args: {
    platformId: v.string(),
    tenantId: v.string(),
    serviceToken: v.string(),
  },
  handler: async (ctx, args): Promise<RuntimeCredentialResult> => {
    // Token/argument authorization is decided by the pure guard against live
    // dependencies: the in-process registry and this platform's OWN service
    // token env var. Fails closed on missing/empty/whitespace args (Req 3.4),
    // an unregistered platform or unset/empty token (Req 3.3), or a token that
    // is not byte-for-byte equal — including a cross-platform token (Req 3.2, 12.5).
    const auth = authorizeRuntimeCredentialAccess(args, {
      resolvePlatform,
      getEnvToken: (envVar) => process.env[envVar],
    });

    if (!auth.authorized) {
      // Deny path: write a name-only audit entry (supplied platformId +
      // tenantId + timestamp, never the token or any credential value) then
      // report `unauthorized` with NO credentials (Req 3.7).
      await ctx.runMutation(
        internal.integrations.configStore.recordUnauthorizedRuntimeAccess,
        { platformId: args.platformId, tenantId: args.tenantId }
      );
      return { resolution: "unauthorized" };
    }

    // Authorized. Fetch ciphertext + config for the EXACT pair (Req 12.1) via
    // the internal query. Annotated explicitly to break circular inference.
    const config: RuntimeIntegrationConfig | null = await ctx.runQuery(
      internal.integrations.configStore.getConfigForRuntimeInternal,
      { platformId: args.platformId, tenantId: args.tenantId }
    );

    // Req 3.6: valid token but no stored config → unresolved, no throw.
    if (config === null) {
      return { resolution: "unresolved" };
    }

    // Req 3.1, 3.5, 12.1: ciphertext + config only, never plaintext.
    return { resolution: "resolved", config };
  },
});
