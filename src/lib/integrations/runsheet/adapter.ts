// src/lib/integrations/runsheet/adapter.ts
//
// Runsheet Integration_Adapter. Runsheet is the first platform onboarded onto
// the generic multi-platform integration system, so this adapter is a thin
// wrapper around the pre-existing, battle-tested Runsheet clients:
//
//   - RunsheetApiClient  — Bearer-authenticated in-call reads + credential test
//                          under the "/voice" path prefix (Surface B).
//   - VoiceIntakeClient  — HMAC-signed voice-order submission to
//                          "{baseUrl}/voice-intake" (Surface A).
//
// The wrapper introduces NO change to either client's wire behavior: the exact
// signed bytes, ISO-8601 timestamp header, schema version, and Bearer read
// surface are all preserved so live Runsheet traffic is uninterrupted
// (Req 5.1, 5.2, 5.4, 5.5, 5.6, 11.2, 11.3).

import type {
  AdapterFactory,
  AdapterConstructionContext,
} from "../platform/types";
import type {
  IntegrationAdapter,
  IntakePayload,
  IntakeResult,
} from "../platform/adapter";
import { RunsheetApiClient } from "./apiClient";
import {
  VoiceIntakeClient,
  type IntakeClient as RunsheetIntakeClient,
  type VoiceIntakePayload,
  type TranscriptTurn,
} from "./voiceIntakeClient";

/**
 * Maps the platform-agnostic {@link IntakePayload} envelope onto the existing
 * {@link VoiceIntakePayload}. Transport metadata (schema version, tenant,
 * idempotency key, timestamp) is carried on the envelope itself; the
 * Runsheet-specific voice-order fields travel in `payload.fields`.
 *
 * The mapping is a pure field projection with no reshaping, so the resulting
 * payload canonicalizes to the exact same bytes the pre-generalization caller
 * produced — which is what the HMAC signature is computed over (Req 11.2).
 */
function toVoiceIntakePayload(payload: IntakePayload): VoiceIntakePayload {
  const fields = payload.fields;
  return {
    // Transport metadata from the generic envelope (Req 5.5, 11.2).
    schemaVersion: payload.schemaVersion,
    tenantId: payload.tenantId,
    idempotencyKey: payload.idempotencyKey,
    timestamp: payload.timestamp,
    // Runsheet-specific voice-order content carried in `fields` (Req 10.2).
    callId: fields.callId as string,
    transcriptId: fields.transcriptId as string,
    transcript: fields.transcript as TranscriptTurn[],
    recordingRef: (fields.recordingRef ?? null) as string | null,
    confidenceScore: fields.confidenceScore as number,
    agentId: fields.agentId as string,
    sessionId: fields.sessionId as string,
    callerPhone: fields.callerPhone as string,
    reviewRequired: fields.reviewRequired as boolean,
    extractedSlots: (fields.extractedSlots ?? {}) as Record<string, unknown>,
  };
}

/**
 * Adapts a generic intake submission onto the existing Runsheet
 * {@link VoiceIntakeClient}. The envelope is projected onto a
 * {@link VoiceIntakePayload} and delegated unchanged to the client's `submit`,
 * so the canonical body, ISO-8601 `X-Timestamp`, `X-Schema-Version` "1.0", and
 * HMAC `X-Signature` are all produced byte-for-byte identically to the
 * pre-generalization path (Req 5.5, 5.6, 11.2).
 */
export function submitViaRunsheet(
  intake: RunsheetIntakeClient,
  payload: IntakePayload,
  secret: string,
): Promise<IntakeResult> {
  return intake.submit(toVoiceIntakePayload(payload), secret);
}

/**
 * Builds a per-call Runsheet {@link IntegrationAdapter} from decrypted
 * credentials and the Transport_Contract (Req 5.3). Wraps the existing clients
 * without altering their wire behavior.
 */
export const runsheetAdapterFactory: AdapterFactory = (
  ctx: AdapterConstructionContext,
): IntegrationAdapter => {
  // Surface B: Bearer-authenticated reads + credential test under "/voice"
  // (Req 5.4, 11.3). The client appends the "/voice" prefix internally.
  const api = new RunsheetApiClient({
    baseUrl: ctx.baseUrl,
    apiKey: ctx.credentials.api_key,
    tenantId: ctx.platformTenantId,
  });

  // Surface A: HMAC-signed voice-order submission to "{baseUrl}/voice-intake"
  // (Req 5.5, 5.6, 11.2).
  const intake = new VoiceIntakeClient({ baseUrl: ctx.baseUrl });

  return {
    platformId: "runsheet",
    contract: ctx.contract,
    readClient: {
      // Delegates to the api client's credential test, which enforces its own
      // 5s deadline internally. Wrapped so it NEVER throws even if the
      // underlying client is ever changed to reject (Req 5.1, 8.1).
      testCredential: async () => {
        try {
          return await api.testCredential();
        } catch {
          return { valid: false };
        }
      },
    },
    intakeClient: {
      submit: (p, secret) => submitViaRunsheet(intake, p, secret),
    },
  };
};
