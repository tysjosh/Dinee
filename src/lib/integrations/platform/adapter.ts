// src/lib/integrations/platform/adapter.ts

import type { TransportContract } from "./types";

/** In-call read/validate surface + credential probe (Req 5.1, 8.1). */
export interface ReadClient {
  /**
   * Authenticated probe against the configured base URL, resolving within the
   * caller-provided deadline (default 5s), reporting credential validity.
   * Never throws (Req 8.1, 8.4). Runsheet maps this to GET {readPrefix}/auth/ping.
   */
  testCredential(timeoutMs?: number): Promise<{ valid: boolean }>;
}

/** Outbound signed submit over the platform's intake contract (Req 5.2). */
export interface IntakeClient {
  /**
   * Canonicalize, sign, and POST a voice-originated payload. The concrete
   * canonicalization + signing is the platform's (Runsheet: deterministic JSON
   * + HMAC-SHA256 hex with "sha256=" prefix) (Req 5.5, 5.6).
   */
  submit(payload: IntakePayload, secret: string): Promise<IntakeResult>;
}

export interface IntakeResult {
  status: "accepted" | "rejected";
  httpStatus: number;
  /**
   * Provider-returned identifier for the submitted item, when the platform
   * returns one. Platform-neutral: Runsheet maps its placed-order `orderId`
   * onto this field. Deliberately NOT named for a transient "draft" — the
   * submission response describes a placed item, not an in-session draft.
   */
  reference?: string;
  /** Provider-returned disposition of the submission (e.g. Runsheet's placed-order disposition). */
  disposition?: string;
  error?: string;
}

/**
 * Platform-agnostic intake payload envelope. Platform-specific fields live in
 * `fields`; transport metadata (tenant, idempotency, timestamp, schema) is
 * carried explicitly so the Transport_Contract can format headers uniformly.
 */
export interface IntakePayload {
  schemaVersion: string;
  tenantId: string;
  idempotencyKey: string;
  timestamp: number; // epoch ms
  fields: Record<string, unknown>;
}

/**
 * The common adapter shape. Constructed per call from decrypted credentials +
 * Transport_Contract; the read client and intake client are what the runtime
 * and Credential_Test_Service drive (Req 5.1, 5.2, 5.3).
 */
export interface IntegrationAdapter {
  readonly platformId: string;
  readonly contract: TransportContract;
  readClient: ReadClient;
  intakeClient: IntakeClient;
}
