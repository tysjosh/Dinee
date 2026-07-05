// src/lib/integrations/runsheet/platform.ts
//
// Runsheet Platform_Definition + startup registration.
//
// Runsheet is the first external platform onboarded onto the generic
// multi-platform integration system. This module declares Runsheet as a
// first-class Platform_Definition — capturing its exact wire contract (Bearer
// reads under "/voice", HMAC-signed "POST /voice-intake", ISO-8601 timestamps,
// schema version "1.0", "X-Runsheet-Tenant" tenant header, and NO per-platform
// keySalt so migrated ciphertext still decrypts with the shared key) — and
// registers it with the Integration_Registry at startup (Req 10.1, 12.5).
//
// The driver-exception sub-session is preserved as a data-driven
// SubSessionBinding rather than a hardcoded conversation-type check, so the
// runtime binds the Driver_Agent session for `runsheet_driver_exception`
// conversations exactly as before (Req 7.8, 11.4).
//
// Requirements: 10.1, 11.4, 12.5

import type { PlatformDefinition } from "../platform/types";
import {
  registerPlatform,
  isPlatformRegistered,
} from "../platform/registry";
import { runsheetAdapterFactory } from "./adapter";

/** Stable Platform_Id under which Runsheet registers (Req 10.1). */
export const RUNSHEET_PLATFORM_ID = "runsheet";

/**
 * The conversation type that binds the Runsheet driver-exception sub-session.
 * Matches `runsheetDriverException.type` in the Runsheet pack so the runtime's
 * data-driven binding stays in lockstep with the pack (Req 7.8, 11.4).
 */
export const RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE =
  "runsheet_driver_exception";

/**
 * The Runsheet Platform_Definition. The Transport_Contract captures Runsheet's
 * exact wire behavior so the generic call path produces byte-identical signed
 * requests: `authScheme: "bearer"`, `readPathPrefix: "/voice"`,
 * `intakePath: "/voice-intake"`, `timestampFormat: "iso-8601"`,
 * `schemaVersion: "1.0"`, `tenantHeader: "X-Runsheet-Tenant"`, and no
 * `keySalt` (so migrated ciphertext decrypts with the shared key unchanged)
 * (Req 10.1, 10.3).
 */
export const runsheetPlatformDefinition: PlatformDefinition = {
  platformId: RUNSHEET_PLATFORM_ID,
  displayName: "Runsheet",
  credentialFields: [
    { name: "api_key", label: "API Key", required: true },
    { name: "webhook_secret", label: "Webhook Secret", required: true },
  ],
  adapterFactory: runsheetAdapterFactory,
  contract: {
    authScheme: "bearer",
    readPathPrefix: "/voice",
    intakePath: "/voice-intake",
    timestampFormat: "iso-8601",
    schemaVersion: "1.0",
    tenantHeader: "X-Runsheet-Tenant",
    // No keySalt: migrated Runsheet ciphertext decrypts with the shared
    // INTEGRATION_ENCRYPTION_KEY unchanged (Req 10.3, 10.5).
  },
  subSessions: [
    {
      conversationTypes: [RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE],
      binderKey: RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE,
    },
  ],
  runtimeServiceTokenEnvVar: "RUNSHEET_RUNTIME_SERVICE_TOKEN",
  // Conversation types Runsheet supports, surfaced in the Platform_Catalog
  // (Control_Plane Req 1.3). Additive and secret-free.
  supportedConversationTypes: [
    "runsheet_inbound_order",
    RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE,
  ],
};

/**
 * Registers Runsheet as a Platform_Definition at startup (Req 10.1). Safe to
 * call more than once: if Runsheet is already registered this is a no-op, and a
 * `duplicate_id` result from a concurrent registration is tolerated rather than
 * treated as fatal, so repeated invocation never crashes the boot path.
 */
export function registerRunsheetPlatform(): void {
  if (isPlatformRegistered(RUNSHEET_PLATFORM_ID)) {
    return;
  }
  const result = registerPlatform(runsheetPlatformDefinition);
  if (!result.ok && result.error.code !== "duplicate_id") {
    throw new Error(
      `Failed to register Runsheet platform: ${result.error.code} (${result.error.detail})`,
    );
  }
}
