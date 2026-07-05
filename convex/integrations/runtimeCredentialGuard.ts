/**
 * Runtime_Credential_Service — PURE guard logic (dependency-injected).
 *
 * This module holds the deterministic, side-effect-free decision logic behind
 * the service-token-guarded `getCredentialsForRuntime` action
 * (`runtimeCredentials.ts`). Extracting the decision here keeps the Convex
 * action a thin wrapper (env-token lookup + audit write + DB query wiring)
 * while making the full authorization matrix testable in isolation — no Convex
 * runtime or DB required.
 *
 * The action's behavior is unchanged: it composes exactly these helpers, so the
 * fail-closed matrix (Req 3.2–3.4, 3.7), the resolved/unresolved split
 * (Req 3.1, 3.5, 3.6), and per-platform/tenant isolation (Req 12.1, 12.5) are
 * decided here and merely wired to `process.env` / `ctx.runQuery` / the audit
 * mutation there.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 12.1, 12.5
 *   (multi-platform-voice-integrations)
 */

import { timingSafeEqual } from "node:crypto";
import type { RuntimeIntegrationConfig } from "./configStore";
import type { ResolvePlatformResult } from "../../src/lib/integrations/platform/types";

/**
 * The runtime credential shape returned to the Voice_Runtime — AES-256-GCM
 * ciphertext keyed by credential name, NEVER plaintext (Req 3.5).
 */
export type RuntimeCredentialConfig = RuntimeIntegrationConfig;

/**
 * The three mutually exclusive outcomes of a runtime credential retrieval:
 *   - `resolved`     authorized + config exists → ciphertext + config (Req 3.1, 3.5).
 *   - `unresolved`   authorized + no config for the pair → no throw (Req 3.6).
 *   - `unauthorized` token/arg failure → no credentials, audited (Req 3.2–3.4, 3.7).
 */
export type RuntimeCredentialResult =
  | { resolution: "resolved"; config: RuntimeCredentialConfig }
  | { resolution: "unresolved" }
  | { resolution: "unauthorized" };

/** The arguments a runtime credential retrieval is called with. */
export interface RuntimeCredentialAccessInput {
  platformId: string;
  tenantId: string;
  serviceToken: string;
}

/**
 * Injected dependencies. The action supplies live implementations
 * (`resolvePlatform`, `process.env`, and a DB-backed config lookup); tests
 * supply in-memory models so the guard can be exercised across all inputs.
 */
export interface RuntimeCredentialAccessDeps {
  /** Resolve a platform definition by id (unresolved for unregistered). */
  resolvePlatform: (platformId: string) => ResolvePlatformResult;
  /** Read the configured service token for a platform's env var (or undefined). */
  getEnvToken: (envVar: string) => string | undefined;
  /** Fetch the stored config for the EXACT `(platformId, tenantId)` pair, or null. */
  getConfig: (
    platformId: string,
    tenantId: string,
  ) => RuntimeIntegrationConfig | null;
}

/** Outcome of the token/argument authorization step. */
export type AuthorizeResult = { authorized: true } | { authorized: false };

/**
 * Constant-time string equality guarded for equal-length buffers.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, so we compare
 * lengths first and short-circuit to `false`; a genuine byte-for-byte match is
 * then confirmed in constant time to avoid a timing side channel (Req 3.2).
 */
export function constantTimeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Pure token/argument authorization. Fails closed on:
 *   - missing / empty / whitespace-only platformId, tenantId, or serviceToken (Req 3.4);
 *   - an unregistered platform (Req 3.3);
 *   - a platform with no configured / empty runtime service token (Req 3.3);
 *   - a token that is not byte-for-byte equal to the configured one — including
 *     a different platform's token, which reads a different env var (Req 3.2, 12.5).
 *
 * No credentials or config are consulted on this path.
 */
export function authorizeRuntimeCredentialAccess(
  input: RuntimeCredentialAccessInput,
  deps: Pick<RuntimeCredentialAccessDeps, "resolvePlatform" | "getEnvToken">,
): AuthorizeResult {
  // Req 3.4: reject missing / empty / whitespace-only arguments.
  if (
    input.serviceToken.trim().length === 0 ||
    input.platformId.trim().length === 0 ||
    input.tenantId.trim().length === 0
  ) {
    return { authorized: false };
  }

  // Req 3.3 / 12.5: an unregistered platform is unauthorized. Each platform
  // declares its OWN token env var, so a cross-platform token fails naturally.
  const platform = deps.resolvePlatform(input.platformId);
  if (!platform.resolved) {
    return { authorized: false };
  }

  const envVar = platform.definition.runtimeServiceTokenEnvVar;
  const expected =
    typeof envVar === "string" && envVar.length > 0
      ? deps.getEnvToken(envVar)
      : undefined;

  // Req 3.3: no token configured for this platform → unauthorized.
  if (!expected || expected.length === 0) {
    return { authorized: false };
  }

  // Req 3.2 (+ 12.5): the presented token must be byte-for-byte equal to the
  // configured one, compared in constant time.
  if (!constantTimeEqual(input.serviceToken, expected)) {
    return { authorized: false };
  }

  return { authorized: true };
}

/**
 * Pure end-to-end guard decision. Composes {@link authorizeRuntimeCredentialAccess}
 * and, only when authorized, consults `getConfig` for the EXACT pair (Req 12.1):
 *   - authorized + config exists → `resolved` carrying ciphertext + config (Req 3.1, 3.5);
 *   - authorized + no config     → `unresolved`, no throw (Req 3.6);
 *   - not authorized             → `unauthorized`, config never consulted (Req 3.2–3.4).
 */
export function evaluateRuntimeCredentialAccess(
  input: RuntimeCredentialAccessInput,
  deps: RuntimeCredentialAccessDeps,
): RuntimeCredentialResult {
  const auth = authorizeRuntimeCredentialAccess(input, deps);
  if (!auth.authorized) {
    return { resolution: "unauthorized" };
  }

  const config = deps.getConfig(input.platformId, input.tenantId);
  if (config === null) {
    return { resolution: "unresolved" };
  }
  return { resolution: "resolved", config };
}
