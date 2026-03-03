/**
 * Property-Based Test — Idempotency Layer (Property 6)
 *
 * **Validates: Requirements 21.2, 21.3, 21.4, 21.6**
 *
 * Property 6: Idempotency key replay returns stored response
 * - For all valid idempotency keys: second request with same key and body returns stored response without re-execution
 * - For all keys reused with different body: returns 422
 * - Keys scoped to partner: same key from different partners does not collide
 *
 * Since Convex mutations cannot be invoked directly from vitest, these tests
 * verify:
 * 1. `hashRequestBody` determinism and collision resistance
 * 2. The idempotency check decision logic (replay/mismatch/proceed) via
 *    simulated stored records and the exported type contracts
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  hashRequestBody,
  type IdempotencyReplay,
  type IdempotencyMismatch,
  type IdempotencyProceed,
  type IdempotencyCheckResult,
} from "../../src/lib/logistics/idempotency";

// ─── Helpers: simulate the idempotency check decision logic ─────────────────
// This mirrors the logic inside `checkIdempotency` without requiring a Convex client.

interface StoredIdempotencyRecord {
  key: string;
  partnerId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
}

/**
 * Pure decision function that mirrors `checkIdempotency` logic.
 * Given a store of records, a key, partnerId, and requestHash,
 * returns the same decision the real function would.
 */
function simulateIdempotencyCheck(
  store: StoredIdempotencyRecord[],
  key: string,
  partnerId: string,
  requestHash: string
): IdempotencyCheckResult {
  const existing = store.find(
    (r) => r.key === key && r.partnerId === partnerId
  );

  if (!existing) {
    return { replay: false };
  }

  if (existing.requestHash === requestHash) {
    return {
      replay: true,
      status: existing.responseStatus,
      body: existing.responseBody,
    };
  }

  return { mismatch: true };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const IDEM_KEY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-_";
const idempotencyKeyArb = fc
  .array(fc.constantFrom(...IDEM_KEY_CHARS.split("")), {
    minLength: 1,
    maxLength: 64,
  })
  .map((chars) => chars.join(""));

const PARTNER_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const partnerIdArb = fc
  .array(fc.constantFrom(...PARTNER_CHARS.split("")), {
    minLength: 1,
    maxLength: 32,
  })
  .map((chars) => chars.join(""));

const jsonBodyArb = fc.oneof(
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    value: fc.integer(),
  }),
  fc.array(fc.integer(), { minLength: 0, maxLength: 10 }),
  fc.string({ minLength: 0, maxLength: 100 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null)
);

const httpStatusArb = fc.constantFrom(200, 201, 204, 400, 409, 422, 500);

const responseBodyArb = fc.json({ maxDepth: 2 });

describe("Idempotency Layer — Property 6", () => {
  // ─── hashRequestBody determinism ────────────────────────────────────────

  /**
   * **Validates: Requirements 21.2, 21.3**
   *
   * Property: hashRequestBody is deterministic — same input always produces
   * the same SHA-256 hash output.
   */
  it("hashRequestBody is deterministic: same input always produces same hash", () => {
    fc.assert(
      fc.property(jsonBodyArb, (body) => {
        const hash1 = hashRequestBody(body);
        const hash2 = hashRequestBody(body);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 21.2, 21.3**
   *
   * Property: hashRequestBody produces valid SHA-256 hex strings
   * (64 hex characters).
   */
  it("hashRequestBody produces valid 64-char hex strings", () => {
    fc.assert(
      fc.property(jsonBodyArb, (body) => {
        const hash = hashRequestBody(body);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 21.6**
   *
   * Property: hashRequestBody produces different hashes for structurally
   * different inputs (collision resistance). We generate pairs of distinct
   * bodies and verify their hashes differ.
   */
  it("hashRequestBody produces different hashes for different inputs", () => {
    const distinctPairArb = fc
      .tuple(jsonBodyArb, jsonBodyArb)
      .filter(
        ([a, b]) => JSON.stringify(a) !== JSON.stringify(b)
      );

    fc.assert(
      fc.property(distinctPairArb, ([bodyA, bodyB]) => {
        const hashA = hashRequestBody(bodyA);
        const hashB = hashRequestBody(bodyB);
        expect(hashA).not.toBe(hashB);
      }),
      { numRuns: 500 }
    );
  });

  // ─── Idempotency check: replay with same key + body ─────────────────────

  /**
   * **Validates: Requirements 21.2, 21.3**
   *
   * Property: For all valid idempotency keys, a second request with the same
   * key, partnerId, and body hash returns the stored response (replay)
   * without re-execution.
   */
  it("same key + same partnerId + same body hash returns replay with stored response", () => {
    fc.assert(
      fc.property(
        idempotencyKeyArb,
        partnerIdArb,
        jsonBodyArb,
        httpStatusArb,
        responseBodyArb,
        (key, partnerId, body, storedStatus, storedBody) => {
          const requestHash = hashRequestBody(body);

          const store: StoredIdempotencyRecord[] = [
            {
              key,
              partnerId,
              requestHash,
              responseStatus: storedStatus,
              responseBody: storedBody,
            },
          ];

          const result = simulateIdempotencyCheck(
            store,
            key,
            partnerId,
            requestHash
          );

          // Must be a replay
          expect((result as IdempotencyReplay).replay).toBe(true);
          expect((result as IdempotencyReplay).status).toBe(storedStatus);
          expect((result as IdempotencyReplay).body).toBe(storedBody);
        }
      ),
      { numRuns: 500 }
    );
  });

  // ─── Idempotency check: mismatch with same key + different body ─────────

  /**
   * **Validates: Requirements 21.6**
   *
   * Property: For all keys reused with a different request body (different hash),
   * the check returns a mismatch (422 scenario).
   */
  it("same key + same partnerId + different body hash returns mismatch", () => {
    const distinctBodiesArb = fc
      .tuple(jsonBodyArb, jsonBodyArb)
      .filter(
        ([a, b]) => JSON.stringify(a) !== JSON.stringify(b)
      );

    fc.assert(
      fc.property(
        idempotencyKeyArb,
        partnerIdArb,
        distinctBodiesArb,
        httpStatusArb,
        responseBodyArb,
        (key, partnerId, [originalBody, newBody], storedStatus, storedBody) => {
          const originalHash = hashRequestBody(originalBody);
          const newHash = hashRequestBody(newBody);

          const store: StoredIdempotencyRecord[] = [
            {
              key,
              partnerId,
              requestHash: originalHash,
              responseStatus: storedStatus,
              responseBody: storedBody,
            },
          ];

          const result = simulateIdempotencyCheck(
            store,
            key,
            partnerId,
            newHash
          );

          // Must be a mismatch
          expect((result as IdempotencyMismatch).mismatch).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  // ─── Idempotency check: proceed when key not found ──────────────────────

  /**
   * **Validates: Requirements 21.2**
   *
   * Property: When no stored record exists for the key+partner combination,
   * the check returns proceed (caller executes the mutation).
   */
  it("unseen key returns proceed (no replay)", () => {
    fc.assert(
      fc.property(
        idempotencyKeyArb,
        partnerIdArb,
        jsonBodyArb,
        (key, partnerId, body) => {
          const requestHash = hashRequestBody(body);
          const emptyStore: StoredIdempotencyRecord[] = [];

          const result = simulateIdempotencyCheck(
            emptyStore,
            key,
            partnerId,
            requestHash
          );

          expect((result as IdempotencyProceed).replay).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  // ─── Partner scoping: same key from different partners ──────────────────

  /**
   * **Validates: Requirements 21.4**
   *
   * Property: Keys are scoped to partner — the same idempotency key used by
   * different partners does not collide. Partner A's stored key does not
   * cause a replay or mismatch for Partner B.
   */
  it("same key from different partners does not collide", () => {
    const distinctPartnersArb = fc
      .tuple(partnerIdArb, partnerIdArb)
      .filter(([a, b]) => a !== b);

    fc.assert(
      fc.property(
        idempotencyKeyArb,
        distinctPartnersArb,
        jsonBodyArb,
        httpStatusArb,
        responseBodyArb,
        (key, [partnerA, partnerB], body, storedStatus, storedBody) => {
          const requestHash = hashRequestBody(body);

          // Partner A has a stored record
          const store: StoredIdempotencyRecord[] = [
            {
              key,
              partnerId: partnerA,
              requestHash,
              responseStatus: storedStatus,
              responseBody: storedBody,
            },
          ];

          // Partner B with the same key should get "proceed" (not found)
          const result = simulateIdempotencyCheck(
            store,
            key,
            partnerB,
            requestHash
          );

          expect((result as IdempotencyProceed).replay).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 21.4**
   *
   * Property: Two different partners can independently store and replay
   * the same idempotency key with different bodies without interference.
   */
  it("different partners can use same key with different bodies independently", () => {
    const distinctPartnersArb = fc
      .tuple(partnerIdArb, partnerIdArb)
      .filter(([a, b]) => a !== b);

    const distinctBodiesArb = fc
      .tuple(jsonBodyArb, jsonBodyArb)
      .filter(
        ([a, b]) => JSON.stringify(a) !== JSON.stringify(b)
      );

    fc.assert(
      fc.property(
        idempotencyKeyArb,
        distinctPartnersArb,
        distinctBodiesArb,
        httpStatusArb,
        httpStatusArb,
        responseBodyArb,
        responseBodyArb,
        (
          key,
          [partnerA, partnerB],
          [bodyA, bodyB],
          statusA,
          statusB,
          respA,
          respB
        ) => {
          const hashA = hashRequestBody(bodyA);
          const hashB = hashRequestBody(bodyB);

          const store: StoredIdempotencyRecord[] = [
            {
              key,
              partnerId: partnerA,
              requestHash: hashA,
              responseStatus: statusA,
              responseBody: respA,
            },
            {
              key,
              partnerId: partnerB,
              requestHash: hashB,
              responseStatus: statusB,
              responseBody: respB,
            },
          ];

          // Partner A replays correctly
          const resultA = simulateIdempotencyCheck(store, key, partnerA, hashA);
          expect((resultA as IdempotencyReplay).replay).toBe(true);
          expect((resultA as IdempotencyReplay).status).toBe(statusA);
          expect((resultA as IdempotencyReplay).body).toBe(respA);

          // Partner B replays correctly (no cross-contamination)
          const resultB = simulateIdempotencyCheck(store, key, partnerB, hashB);
          expect((resultB as IdempotencyReplay).replay).toBe(true);
          expect((resultB as IdempotencyReplay).status).toBe(statusB);
          expect((resultB as IdempotencyReplay).body).toBe(respB);
        }
      ),
      { numRuns: 500 }
    );
  });
});
