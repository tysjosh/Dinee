/**
 * Feature: dinee-voice-platform, Property 13: API key encryption round-trips and hides plaintext
 *
 * Validates: Requirements 8.2, 8.3
 *
 * Encrypting an API key with the AES-256-GCM encryption service and then
 * decrypting the ciphertext returns the original value; the ciphertext never
 * equals (nor contains) the plaintext; and `extractLast4` returns the last 4
 * characters of the key for safe masked display.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import crypto from "crypto";
import {
  encrypt,
  decrypt,
  extractLast4,
} from "../../src/lib/integrations/encryptionService";

// Arbitrary API-key strings: cover realistic keys plus awkward inputs
// (short, unicode, symbols) so the round-trip and masking hold across the
// full input space, not just typical alphanumeric keys.
const apiKeyArb = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9._-]{1,128}$/),
  fc.string({ minLength: 1, maxLength: 256 })
);

describe("Property 13: API key encryption round-trip", () => {
  beforeEach(() => {
    // Fresh random 256-bit key (64 hex chars) per test, matching how the
    // existing integration-security suite provisions the test key.
    process.env.INTEGRATION_ENCRYPTION_KEY = crypto
      .randomBytes(32)
      .toString("hex");
  });

  it("decrypt(encrypt(key)) === key (round-trip)", () => {
    fc.assert(
      fc.property(apiKeyArb, (key) => {
        expect(decrypt(encrypt(key))).toBe(key);
      }),
      { numRuns: 100 }
    );
  });

  it("ciphertext differs from and does not contain the plaintext", () => {
    fc.assert(
      fc.property(apiKeyArb, (key) => {
        const ciphertext = encrypt(key);
        // Ciphertext must never equal the plaintext, for any key.
        expect(ciphertext).not.toBe(key);
        // Substring non-containment is only meaningful for keys of realistic
        // length: a 1-2 char plaintext will appear in the base64 ciphertext
        // by chance (not a leak), so mirror the existing suite's min length 8.
        if (key.length >= 8) {
          expect(ciphertext).not.toContain(key);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("extractLast4(key) equals the last 4 characters of the key", () => {
    fc.assert(
      fc.property(apiKeyArb, (key) => {
        const last4 = extractLast4(key);
        if (key.length <= 4) {
          expect(last4).toBe(key);
        } else {
          expect(last4).toBe(key.slice(-4));
          expect(last4).toHaveLength(4);
        }
      }),
      { numRuns: 100 }
    );
  });
});
