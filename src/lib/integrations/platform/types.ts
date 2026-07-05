// src/lib/integrations/platform/types.ts
//
// Generic platform contracts for the multi-platform voice integration system.
// These types describe how an external platform (e.g. Runsheet) is declared,
// registered, and resolved as a first-class Platform_Definition, mirroring the
// patterns of the existing voiceDomainPackRegistry (validate-before-mutate,
// resolve-by-key, explicit unresolved results).

import type { IntegrationAdapter } from "./adapter";

/** Auth scheme a platform's read surface uses (Req 5.4, 5.5). */
export type AuthScheme = "bearer" | "hmac";

/** How the intake timestamp header is formatted (Req 5.5, 11.2). */
export type TimestampFormat = "iso-8601" | "epoch-seconds" | "epoch-millis";

/**
 * Per-platform descriptor of auth + transport details consumed by the adapter.
 * Mirrors the Runsheet wire contract: Bearer reads under a path prefix, and an
 * HMAC-signed intake POST with timestamp/schema-version headers.
 */
export interface TransportContract {
  /** Read-surface auth scheme (Runsheet: "bearer"). */
  authScheme: AuthScheme;
  /** Path prefix for the read/validate surface (Runsheet: "/voice"). */
  readPathPrefix: string;
  /** Path suffix for the signed intake POST (Runsheet: "/voice-intake"). */
  intakePath: string;
  /** Timestamp header format for signed intake (Runsheet: "iso-8601"). */
  timestampFormat: TimestampFormat;
  /** Schema version transmitted as X-Schema-Version (Runsheet: "1.0"). */
  schemaVersion: string;
  /** Header name carrying the tenant id (Runsheet: "X-Runsheet-Tenant"). */
  tenantHeader: string;
  /**
   * Optional per-platform key salt applied by the Encryption_Service so one
   * platform's credentials cannot be decrypted with another's salt (Req 12.2).
   * When absent, the shared INTEGRATION_ENCRYPTION_KEY is used unchanged so
   * Runsheet ciphertext migrated as-is still decrypts (Req 10.3, 10.5).
   */
  keySalt?: string;
}

/** Decrypted materials handed to an adapter factory at bind time (Req 5.3). */
export interface AdapterConstructionContext {
  baseUrl: string;
  /** Platform-scoped tenant identifier (e.g. Runsheet-side tenant id). */
  platformTenantId: string;
  /** Decrypted credential values keyed by credential name (volatile). */
  credentials: Record<string, string>;
  /** Arbitrary stored platform config (allowedConversationTypes, flags, etc.). */
  config: Record<string, unknown>;
  contract: TransportContract;
}

/** Factory that builds a per-call adapter from decrypted materials (Req 5.3). */
export type AdapterFactory = (
  ctx: AdapterConstructionContext,
) => IntegrationAdapter;

/**
 * A registered external platform. Declares which credential fields it needs so
 * the admin UI can render a platform-driven form (Req 9), and optionally which
 * extra per-call sub-session a conversation type binds (generalizes the
 * Runsheet driver-exception sub-session, Req 7.8, 11.4).
 */
export interface PlatformDefinition {
  /** Stable unique id, 1–64 chars (e.g. "runsheet") (Req 1.1, 1.3). */
  platformId: string;
  displayName: string;
  /** Credential field descriptors driving the admin form + encryption set. */
  credentialFields: CredentialFieldSpec[];
  adapterFactory: AdapterFactory;
  contract: TransportContract;
  /**
   * Sub-sessions this platform binds for specific conversation types, declared
   * as data rather than a hardcoded conversation-type check (Req 7.8).
   */
  subSessions?: SubSessionBinding[];
  /** Runtime service token env var name for this platform (Req 3, 12.5). */
  runtimeServiceTokenEnvVar: string;
  /**
   * Conversation types this platform supports, surfaced in the Platform_Catalog
   * (Control_Plane Req 1.3, 1.4). Additive and optional: when absent, the
   * catalog emits an empty conversation-types list for this platform. This
   * changes no existing behavior and is not one of the seven preserved
   * single-pair integration entry points.
   */
  supportedConversationTypes?: string[];
}

/** A credential the platform needs; drives the admin form + encryption (Req 9.1). */
export interface CredentialFieldSpec {
  /** Machine name used as the map key and audit reference (e.g. "api_key"). */
  name: string;
  label: string;
  /** Whether the field is required for a valid save (Req 2.3, 9.5). */
  required: boolean;
}

/** Declares a per-call sub-session bound for a set of conversation types (Req 7.8). */
export interface SubSessionBinding {
  /** Conversation types that trigger this sub-session (e.g. driver-exception). */
  conversationTypes: string[];
  /** Opaque binder key the runtime resolves to a bind/release pair. */
  binderKey: string;
}

export type RegisterPlatformResult =
  | { ok: true }
  | { ok: false; error: PlatformRegistrationError };

export interface PlatformRegistrationError {
  code: "duplicate_id" | "invalid_id" | "missing_field";
  /** Names the conflicting id or omitted field (Req 1.2, 1.3, 1.4). */
  detail: string;
}

export type ResolvePlatformResult =
  | { resolved: true; definition: PlatformDefinition }
  | { resolved: false };
