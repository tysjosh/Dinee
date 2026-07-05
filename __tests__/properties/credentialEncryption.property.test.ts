/**
 * Feature: multi-platform-voice-integrations, Property 4 & Property 20
 *
 * Property 4: Credential encryption round-trip
 *   Validates: Requirements 2.2, 2.7
 *   For any credential string (including empty, unicode, and long values),
 *   decrypt(encrypt(value)) === value. Also holds with a per-platform key salt:
 *   decrypt(encrypt(value, salt), salt) === value.
 *
 * Property 20: Per-platform key salt isolates decryption
 *   Validates: Requirement 12.2
 *   Encrypting with one salt and decrypting with the SAME salt reproduces the
 *   value; decrypting with a DIFFERENT salt (or no salt) fails (throws). Also,
 *   encrypting with NO salt cannot be decrypted with a salt.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { encrypt, decrypt } from "../../src/lib/integrations/encryptionService";

beforeAll(() => {
  // A valid 32-byte (64-hex-char) key so the AES-256-GCM service works in the
  // test environment, mirroring how encryptionService.test.ts provisions it.
  process.env.INTEGRATION_ENCRYPTION_KEY = "0".repeat(64);
});

// Credential values across the full input space: realistic keys, empty,
// unicode/emoji, and long strings. `fc.string()` already covers empty and
// unicode; the explicit constants pin down the edge cases the property calls
// out, and a long-string arbitrary covers large values.
const credentialArb = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "",
    "🔑",
    "clé secrète 密钥 🔐",
    "😀".repeat(50),
    "sk-test-api-key-a1b2c3d4"
  ),
  fc.string({ minLength: 500, maxLength: 2000 })
);

// Non-empty salts. An empty-string salt is treated by the service as "no salt"
// (shared key), so we require minLength 1 to keep salted/unsalted cases
// genuinely distinct.
const saltArb = fc.string({ minLength: 1, maxLength: 64 });

describe("Property 4: Credential encryption round-trip", () => {
  it("decrypt(encrypt(value)) === value (no salt)", () => {
    fc.assert(
      fc.property(credentialArb, (value) => {
        expect(decrypt(encrypt(value))).toBe(value);
      }),
      { numRuns: 100 }
    );
  });

  it("decrypt(encrypt(value, salt), salt) === value (with salt)", () => {
    fc.assert(
      fc.property(credentialArb, saltArb, (value, salt) => {
        expect(decrypt(encrypt(value, salt), salt)).toBe(value);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 20: Per-platform key salt isolates decryption", () => {
  it("same salt reproduces the value", () => {
    fc.assert(
      fc.property(credentialArb, saltArb, (value, salt) => {
        const ciphertext = encrypt(value, salt);
        expect(decrypt(ciphertext, salt)).toBe(value);
      }),
      { numRuns: 100 }
    );
  });

  it("a different salt fails to decrypt", () => {
    fc.assert(
      fc.property(
        credentialArb,
        saltArb,
        saltArb,
        (value, salt, otherSaltSeed) => {
          // Ensure the "other" salt is genuinely different from the encrypting salt.
          const otherSalt =
            otherSaltSeed === salt ? `${otherSaltSeed}-x` : otherSaltSeed;
          const ciphertext = encrypt(value, salt);
          expect(() => decrypt(ciphertext, otherSalt)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a salted ciphertext cannot be decrypted with no salt", () => {
    fc.assert(
      fc.property(credentialArb, saltArb, (value, salt) => {
        const ciphertext = encrypt(value, salt);
        expect(() => decrypt(ciphertext)).toThrow();
      }),
      { numRuns: 100 }
    );
  });

  it("an unsalted ciphertext cannot be decrypted with a salt", () => {
    fc.assert(
      fc.property(credentialArb, saltArb, (value, salt) => {
        const ciphertext = encrypt(value);
        expect(() => decrypt(ciphertext, salt)).toThrow();
      }),
      { numRuns: 100 }
    );
  });
});
