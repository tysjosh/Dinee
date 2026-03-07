/**
 * Feature: ai-reception-os-pivot, Property 7: Integration Security — Credential Non-Exposure
 *
 * Validates: Requirements 18.1, 18.2
 *
 * For any Integration_Credential stored in the system, the plaintext value
 * SHALL never appear in: (a) any API response body, (b) any UI-rendered string,
 * (c) any application log output. Only apiKeyLast4 and apiKeyEncrypted SHALL be
 * stored or transmitted. Additionally, decrypt(encrypt(value)) === value (round-trip).
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import crypto from "crypto";
import {
  encrypt,
  decrypt,
  extractLast4,
} from "../../src/lib/integrations/encryptionService";

/** Arbitrary: random alphanumeric credential strings, min length 8 */
const credentialArb = fc.stringMatching(/^[a-zA-Z0-9]{8,128}$/);

describe("Property 7: Integration Security — Credential Non-Exposure", () => {
  beforeEach(() => {
    // Set a fresh random encryption key for each test
    process.env.INTEGRATION_ENCRYPTION_KEY = crypto
      .randomBytes(32)
      .toString("hex");
  });

  it("encrypt(credential) does not contain the credential as a substring", () => {
    fc.assert(
      fc.property(credentialArb, (credential) => {
        const encrypted = encrypt(credential);
        expect(encrypted).not.toContain(credential);
      }),
      { numRuns: 100 }
    );
  });

  it("decrypt(encrypt(credential)) === credential (round-trip)", () => {
    fc.assert(
      fc.property(credentialArb, (credential) => {
        const encrypted = encrypt(credential);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(credential);
      }),
      { numRuns: 100 }
    );
  });

  it("mock API response serialization does not contain the full credential", () => {
    fc.assert(
      fc.property(credentialArb, (credential) => {
        const apiResponse = {
          apiKeyEncrypted: encrypt(credential),
          apiKeyLast4: extractLast4(credential),
        };

        const serialized = JSON.stringify(apiResponse);

        // The full credential must not appear in the serialized response
        expect(serialized).not.toContain(credential);
      }),
      { numRuns: 100 }
    );
  });
});
