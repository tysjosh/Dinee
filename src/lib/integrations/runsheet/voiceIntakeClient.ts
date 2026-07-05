import crypto from "crypto";

/**
 * Dinee → Runsheet signed Intake_Contract client.
 *
 * Dinee is never the system of record for orders. It holds an `Order_Draft`
 * transiently in-session and submits voice-originated orders to the Runsheet
 * backend over a versioned, signed HTTP contract (`POST {baseUrl}/voice-intake`).
 *
 * The payload carries the FULL confirmed transcript content (`transcript`) in
 * addition to the `transcriptId` reference so the Runsheet backend review queue
 * receives the transcript without any callback into Dinee (Req 10.9, 18.2).
 *
 * Requirements: 10.2, 10.3, 10.6, 10.9, 11.1, 11.7, 20.4
 */

/** One confirmed dialogue turn carried in the signed payload (Req 10.9, 18.1, 18.2). */
export interface TranscriptTurn {
  role: "caller" | "agent";
  text: string;
  /** epoch ms when the turn was confirmed. */
  at: number;
}

/**
 * The body Dinee transmits to the Voice_Intake_Adapter over the Intake_Contract.
 * Every field is intake metadata the Runsheet backend records (Req 10.2, 10.3).
 */
export interface VoiceIntakePayload {
  schemaVersion: string; // Req 10.3, X-Schema-Version
  tenantId: string; // Req 11.4
  idempotencyKey: string; // Req 11.3
  timestamp: number; // epoch ms, Req 11.5
  callId: string; // Req 10.2, 10.5
  transcriptId: string; // Req 10.2, 18.2 (reference to the Dinee-owned transcript store)
  transcript: TranscriptTurn[]; // Req 10.2, 10.9, 18.2 — FULL confirmed transcript content
  recordingRef: string | null; // Req 10.2
  confidenceScore: number; // Req 10.2
  agentId: string; // Req 10.2
  sessionId: string; // Req 10.2
  callerPhone: string; // Req 10.2, 10.5
  reviewRequired: boolean; // Req 10.2
  extractedSlots: Record<string, unknown>; // Req 10.2, 10.5
}

export interface IntakeResult {
  status: "accepted" | "rejected";
  httpStatus: number;
  /**
   * The Runsheet placed-order identifier returned on acceptance, surfaced on the
   * platform-neutral `reference` field. The intake response describes a PLACED
   * order (`orderId` + `disposition`) — never a transient "draft".
   */
  reference?: string;
  /** The Runsheet placed-order disposition returned on acceptance. */
  disposition?: string;
  error?: string;
}

/**
 * The Dinee-side Intake_Contract client interface. Implemented by the real
 * {@link VoiceIntakeClient} and by the Mock_Intake_Client (Req 20.6) so the two
 * are interchangeable in the runtime and in tests.
 */
export interface IntakeClient {
  submit(payload: VoiceIntakePayload, secret: string): Promise<IntakeResult>;
}

/**
 * Canonicalization method for the signature input (Canonical_Payload).
 *
 * - `"raw"` (default): sign the exact raw transmitted HTTP body. This client
 *   produces the body deterministically (recursively sorted keys, no
 *   insignificant whitespace) and signs those exact bytes, so the bytes on the
 *   wire ARE the signature input (Req 11.1).
 * - `"jcs"`: RFC 8785 JSON Canonicalization Scheme. Structurally identical
 *   output for our payloads; documented alternative when a structured
 *   canonicalization is preferred (Req 11.1, 11.7).
 */
export type CanonicalizationMode = "raw" | "jcs";

/** Minimal fetch surface used by the client, kept narrow so it is trivially mockable. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface VoiceIntakeClientConfig {
  /** Runsheet-hosted base URL; the client POSTs to `{baseUrl}/voice-intake`. */
  baseUrl: string;
  /** Canonicalization method for the signature input. Defaults to `"raw"`. */
  canonicalization?: CanonicalizationMode;
  /** Injectable fetch, primarily for tests. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

export interface SubmitVoiceIntakeOptions extends VoiceIntakeClientConfig {}

/**
 * Serializes any JSON value into a deterministic canonical string with
 * recursively sorted object keys, ES6 number formatting, and no insignificant
 * whitespace (RFC 8785 JCS structure). `undefined` object members are omitted.
 */
function canonicalizeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "number") {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new Error("Cannot canonicalize a non-finite number");
    }
    // JSON.stringify uses the ES6 Number-to-string algorithm required by RFC 8785.
    return JSON.stringify(num);
  }

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "string") {
    // JSON.stringify performs the minimal JSON string escaping JCS requires.
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalizeValue(element)).join(",")}]`;
  }

  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      // Default string sort compares by UTF-16 code units, as JCS specifies.
      .sort();
    const members = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeValue(obj[key])}`
    );
    return `{${members.join(",")}}`;
  }

  throw new Error(`Cannot canonicalize a value of type ${type}`);
}

/**
 * Produces the exact bytes transmitted AND signed. When `mode` is `"raw"`
 * (default) this is the Canonical_Payload used for raw-body signing; when
 * `"jcs"` it is the RFC 8785 canonical form. Both modes emit the same
 * deterministic, byte-reproducible serialization for a given payload, which is
 * what Runsheet verifies against (Req 11.1, 11.6, 11.7).
 */
export function canonicalizeIntake(
  payload: VoiceIntakePayload,
  mode: CanonicalizationMode = "raw"
): string {
  // Both documented methods yield the same deterministic canonical bytes for
  // this payload shape; `mode` is retained so callers can express intent and
  // future divergence stays contained here.
  void mode;
  return canonicalizeValue(payload);
}

/**
 * Inverse of {@link canonicalizeIntake}. Reconstructs a `VoiceIntakePayload`
 * from canonical bytes; used by the Mock_Intake_Client and by cross-language
 * round-trip tests (Req 11.6).
 */
export function deserializeIntake(raw: string): VoiceIntakePayload {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Intake payload must be a JSON object");
  }
  return parsed as VoiceIntakePayload;
}

/** HMAC-SHA256 over the canonical bytes, lowercase hex-encoded (Req 11.1). */
export function signIntake(canonical: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) {
    return fetchImpl;
  }
  const globalFetch = (globalThis as { fetch?: unknown }).fetch;
  if (typeof globalFetch !== "function") {
    throw new Error("No fetch implementation available; provide config.fetchImpl");
  }
  return globalFetch as unknown as FetchLike;
}

/**
 * Canonicalizes, HMAC-signs, and POSTs a voice-originated order over the
 * Intake_Contract (Req 10.6, 11.1, 11.7, 20.4).
 *
 * The signed request carries the tenant, idempotency, timestamp, signature, and
 * schema-version headers the Voice_Intake_Adapter checks. The request body is
 * the exact canonical string the signature was computed over.
 */
export async function submitVoiceIntake(
  payload: VoiceIntakePayload,
  secret: string,
  options: SubmitVoiceIntakeOptions
): Promise<IntakeResult> {
  const canonical = canonicalizeIntake(payload, options.canonicalization ?? "raw");
  const signature = signIntake(canonical, secret);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/voice-intake`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Runsheet-Tenant": payload.tenantId, // Req 11.4
        "X-Idempotency-Key": payload.idempotencyKey, // Req 11.3
        // Req 11.5: the Voice_Intake_Adapter parses X-Timestamp as ISO-8601 (or
        // epoch seconds) for its replay-window check. `payload.timestamp` is
        // epoch MILLISECONDS, which the adapter cannot parse, so transmit the
        // ISO-8601 form. This header is transport-only and NOT part of the
        // signed canonical body, so it does not affect the HMAC signature.
        "X-Timestamp": new Date(payload.timestamp).toISOString(), // Req 11.5
        "X-Signature": `sha256=${signature}`, // Req 11.1
        "X-Schema-Version": payload.schemaVersion, // Req 10.3
      },
      body: canonical,
    });
  } catch (error) {
    return {
      status: "rejected",
      httpStatus: 0,
      error: error instanceof Error ? error.message : "Network error",
    };
  }

  if (response.ok) {
    // The canonical Runsheet acceptance response is a PLACED order:
    // { orderId, disposition }. Map orderId onto the platform-neutral
    // `reference` and pass disposition through — this is a placed order, not a
    // "draft".
    let reference: string | undefined;
    let disposition: string | undefined;
    try {
      const data = (await response.json()) as {
        accepted?: boolean;
        orderId?: string;
        disposition?: string;
      };
      reference = data.orderId;
      disposition = data.disposition;
    } catch {
      // A 2xx without a parseable body is still an acceptance; reference and
      // disposition stay undefined.
    }
    return { status: "accepted", httpStatus: response.status, reference, disposition };
  }

  const errorBody = await response.text().catch(() => "");
  return {
    status: "rejected",
    httpStatus: response.status,
    error: errorBody || `Intake rejected with status ${response.status}`,
  };
}

/**
 * Real Dinee → Runsheet submit client over the Intake_Contract. Implements
 * {@link IntakeClient} so it is interchangeable with the Mock_Intake_Client.
 */
export class VoiceIntakeClient implements IntakeClient {
  private readonly config: VoiceIntakeClientConfig;

  constructor(config: VoiceIntakeClientConfig) {
    this.config = config;
  }

  submit(payload: VoiceIntakePayload, secret: string): Promise<IntakeResult> {
    return submitVoiceIntake(payload, secret, this.config);
  }
}
