import crypto from "crypto";

import {
  canonicalizeIntake,
  deserializeIntake,
  signIntake,
  type CanonicalizationMode,
  type IntakeClient,
  type IntakeResult,
  type VoiceIntakePayload,
} from "./voiceIntakeClient";

/**
 * Dinee-side test double for the Runsheet Voice_Intake_Adapter (Req 20.6).
 *
 * The {@link MockIntakeClient} implements {@link IntakeClient} so it is
 * interchangeable with the real {@link VoiceIntakeClient} in tests, and it
 * mirrors the Runsheet-backend verification order **for Dinee-side testing
 * only** so submission behavior can be verified without the live backend:
 *
 *   1. HMAC verification over the Canonical_Payload (Req 11.1, 11.2) → `401`
 *   2. Replay-window freshness on the timestamp (Req 11.5)            → `400`
 *   3. Tenant match against the authenticated integration (Req 11.4)  → `403`
 *   4. Idempotency: a repeat of an accepted key returns the original
 *      stored result and creates no duplicate (Req 11.3)             → `200`
 *   5. Required fields `callId`, `callerPhone`, `extractedSlots`
 *      (Req 10.5)                                                     → `400`
 *
 * It records the received Canonical_Payload bytes and the transmitted
 * signature for every attempt so Dinee-side tests can assert HMAC correctness,
 * replay rejection, tenant mismatch, idempotent replay, and round-trip fidelity
 * (Req 11.6). It is never used in production; the real client talks to the
 * Runsheet backend.
 */

/** Default freshness half-window: a timestamp may be at most this far from now. */
const DEFAULT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** A recorded intake attempt, retained in memory for test assertions. */
export interface MockIntakeReceipt {
  /** The exact Canonical_Payload bytes the mock received and verified against. */
  canonical: string;
  /** The HMAC signature the client transmitted (hex), recomputed by the mock. */
  signature: string;
  /** The tenant id carried in the payload. */
  tenantId: string;
  /** The idempotency key carried in the payload. */
  idempotencyKey: string;
  /** The client timestamp (epoch ms) carried in the payload. */
  timestamp: number;
  /** The clock value the mock evaluated freshness against (epoch ms). */
  receivedAt: number;
  /** The payload reconstructed from the canonical bytes (Req 11.6). */
  deserialized: VoiceIntakePayload;
  /** Whether this attempt returned a previously stored idempotent result. */
  idempotentReplay: boolean;
  /** The outcome the mock returned for this attempt. */
  result: IntakeResult;
}

export interface MockIntakeClientConfig {
  /**
   * The shared HMAC secret the authenticated integration is bound to. The mock
   * verifies the transmitted signature against this secret; when a client signs
   * with a different secret (a forged or altered request) verification fails
   * (Req 11.1, 11.2).
   */
  secret: string;
  /** The tenant id the authenticated integration is bound to (Req 11.4). */
  expectedTenantId: string;
  /**
   * Half-width of the accepted freshness window in ms. A payload whose
   * timestamp differs from the current clock by more than this is rejected as a
   * replay (Req 11.5). Defaults to five minutes.
   */
  freshnessWindowMs?: number;
  /**
   * Canonicalization method for the signature input. Must match the method the
   * client used. Defaults to `"raw"`.
   */
  canonicalization?: CanonicalizationMode;
  /** Injectable clock for deterministic replay-window tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Reference (placed-order id) generator for accepted results. Defaults to a random hex id. */
  referenceFactory?: () => string;
}

/** Constant-time comparison of two hex signature strings. */
function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export class MockIntakeClient implements IntakeClient {
  private readonly secret: string;
  private readonly expectedTenantId: string;
  private readonly freshnessWindowMs: number;
  private readonly canonicalization: CanonicalizationMode;
  private readonly now: () => number;
  private readonly referenceFactory: () => string;

  /** Accepted results keyed by `${tenantId}:${idempotencyKey}` (Req 11.3). */
  private readonly acceptedByKey = new Map<string, IntakeResult>();
  /** Every received attempt, in order, for test assertions. */
  private readonly receipts: MockIntakeReceipt[] = [];
  /** Count of distinct orders created; a replay must not increment this. */
  private ordersCreated = 0;

  constructor(config: MockIntakeClientConfig) {
    this.secret = config.secret;
    this.expectedTenantId = config.expectedTenantId;
    this.freshnessWindowMs = config.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
    this.canonicalization = config.canonicalization ?? "raw";
    this.now = config.now ?? (() => Date.now());
    this.referenceFactory =
      config.referenceFactory ?? (() => `mock_order_${crypto.randomBytes(8).toString("hex")}`);
  }

  submit(payload: VoiceIntakePayload, secret: string): Promise<IntakeResult> {
    const canonical = canonicalizeIntake(payload, this.canonicalization);
    // The signature the client would have transmitted over the wire, computed
    // with the client's signing secret.
    const transmittedSignature = signIntake(canonical, secret);
    // Round-trip the canonical bytes exactly as the backend would (Req 11.6).
    const deserialized = deserializeIntake(canonical);
    const receivedAt = this.now();
    const idempotencyStoreKey = `${payload.tenantId}:${payload.idempotencyKey}`;

    const record = (result: IntakeResult, idempotentReplay = false): IntakeResult => {
      this.receipts.push({
        canonical,
        signature: transmittedSignature,
        tenantId: payload.tenantId,
        idempotencyKey: payload.idempotencyKey,
        timestamp: payload.timestamp,
        receivedAt,
        deserialized,
        idempotentReplay,
        result,
      });
      return result;
    };

    // 1. HMAC verification over the Canonical_Payload (Req 11.1, 11.2).
    const expectedSignature = signIntake(canonical, this.secret);
    if (!signaturesEqual(transmittedSignature, expectedSignature)) {
      return Promise.resolve(
        record({ status: "rejected", httpStatus: 401, error: "Invalid signature" })
      );
    }

    // 2. Replay-window freshness on the client timestamp (Req 11.5).
    if (Math.abs(receivedAt - payload.timestamp) > this.freshnessWindowMs) {
      return Promise.resolve(
        record({
          status: "rejected",
          httpStatus: 400,
          error: "Timestamp outside freshness window (replay)",
        })
      );
    }

    // 3. Tenant match against the authenticated integration (Req 11.4).
    if (payload.tenantId !== this.expectedTenantId) {
      return Promise.resolve(
        record({ status: "rejected", httpStatus: 403, error: "Tenant mismatch" })
      );
    }

    // 4. Idempotency: a repeat of an accepted key returns the original stored
    //    result and creates no duplicate order (Req 11.3).
    const stored = this.acceptedByKey.get(idempotencyStoreKey);
    if (stored) {
      return Promise.resolve(record(stored, true));
    }

    // 5. Required fields present (Req 10.5).
    const missingField = this.firstMissingRequiredField(payload);
    if (missingField) {
      return Promise.resolve(
        record({
          status: "rejected",
          httpStatus: 400,
          error: `Missing required field: ${missingField}`,
        })
      );
    }

    // Accept: create exactly one order and store the result for idempotent replay.
    this.ordersCreated += 1;
    const result: IntakeResult = {
      status: "accepted",
      httpStatus: 200,
      reference: this.referenceFactory(),
      disposition: "placed",
    };
    this.acceptedByKey.set(idempotencyStoreKey, result);
    return Promise.resolve(record(result));
  }

  /** Returns the name of the first missing required field, or `null` if all present. */
  private firstMissingRequiredField(payload: VoiceIntakePayload): string | null {
    if (typeof payload.callId !== "string" || payload.callId.length === 0) {
      return "callId";
    }
    if (typeof payload.callerPhone !== "string" || payload.callerPhone.length === 0) {
      return "callerPhone";
    }
    if (
      payload.extractedSlots === null ||
      typeof payload.extractedSlots !== "object" ||
      Array.isArray(payload.extractedSlots)
    ) {
      return "extractedSlots";
    }
    return null;
  }

  /** All recorded intake attempts, in the order they were received. */
  getReceipts(): readonly MockIntakeReceipt[] {
    return this.receipts;
  }

  /** The most recent recorded intake attempt, or `undefined` if none. */
  getLastReceipt(): MockIntakeReceipt | undefined {
    return this.receipts[this.receipts.length - 1];
  }

  /** Number of distinct orders the mock has created (never incremented by a replay). */
  getOrdersCreated(): number {
    return this.ordersCreated;
  }

  /** Clears all in-memory idempotency, receipt, and order state. */
  reset(): void {
    this.acceptedByKey.clear();
    this.receipts.length = 0;
    this.ordersCreated = 0;
  }
}
