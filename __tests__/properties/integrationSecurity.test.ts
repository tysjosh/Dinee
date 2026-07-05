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
import { buildIntegrationAuditDetail } from "../../convex/integrations/configStore";

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

/**
 * Feature: multi-platform-voice-integrations, Property 21: Audit and log
 * details reference secrets by name only.
 *
 * Validates: Requirements 12.3, 12.4
 *
 * For any set of stored credentials (name -> full value), the audit detail
 * string produced by the pure `buildIntegrationAuditDetail` helper in
 * `convex/integrations/configStore.ts` references every credential BY NAME
 * (with at most a masked last-4 preview) and NEVER reproduces any full
 * credential value (Req 12.3: reference by name only, no plaintext in logs;
 * Req 12.4: record at most the last 4 characters, never the full value).
 */
describe("Property 21: Audit detail references secrets by name only", () => {
  // Credential names: lowercase letters only — a disjoint alphabet from the
  // full values below, so a full value can never appear as a substring of a
  // name (which would cause a false assertion failure).
  const credentialNameArb = fc.stringMatching(/^[a-z]{1,16}$/);

  // Full credential values: uppercase letters + digits, length >= 5. The
  // minimum length of 5 guarantees the last-4 preview (slice(-4), length 4) is
  // a PROPER suffix that differs from the full value, so asserting the full
  // value is absent while the last-4 preview may be present is meaningful.
  const fullValueArb = fc.stringMatching(/^[A-Z0-9]{5,40}$/);

  // Platform id: lowercase letters only — also disjoint from the full values.
  const platformIdArb = fc.stringMatching(/^[a-z]{1,32}$/);

  // name -> full value map (keys are unique by construction of fc.dictionary).
  const credentialsArb = fc.dictionary(credentialNameArb, fullValueArb);

  it("references each credential name and never the full credential value", () => {
    fc.assert(
      fc.property(
        credentialsArb,
        platformIdArb,
        fc.boolean(),
        (credentials, platformId, existing) => {
          // Derive the last-4 preview map the store actually persists/logs.
          const credentialsLast4: Record<string, string> = {};
          for (const [name, value] of Object.entries(credentials)) {
            credentialsLast4[name] = value.slice(-4);
          }

          const detail = buildIntegrationAuditDetail(
            existing,
            platformId,
            credentialsLast4
          );

          for (const [name, value] of Object.entries(credentials)) {
            // Req 12.3: every credential is referenced BY NAME.
            expect(detail).toContain(name);
            // Req 12.3/12.4: the full credential value is NEVER reproduced.
            // (Every value has length >= 5, so this is a real secret, not the
            // degenerate case where the whole value is <= the 4-char preview.)
            expect(detail).not.toContain(value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("exposes at most the masked last-4 preview for each credential", () => {
    fc.assert(
      fc.property(
        credentialsArb,
        platformIdArb,
        fc.boolean(),
        (credentials, platformId, existing) => {
          const credentialsLast4: Record<string, string> = {};
          for (const [name, value] of Object.entries(credentials)) {
            credentialsLast4[name] = value.slice(-4);
          }

          const detail = buildIntegrationAuditDetail(
            existing,
            platformId,
            credentialsLast4
          );

          for (const [name, value] of Object.entries(credentials)) {
            const last4 = value.slice(-4);
            // Req 12.4: at most the last-4 preview is embedded, keyed by name.
            expect(detail).toContain(`${name} (last4 ${last4})`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
