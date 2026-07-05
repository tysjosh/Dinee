/**
 * Feature: dinee-voice-platform, Property 14: Secrets are referenced by name, never by value, in audit records
 *
 * Validates: Requirements 8.3
 *
 * The audit-detail string written when a Runsheet integration is created or
 * updated (via `upsertIntegration` in `convex/runsheet/integrationsData.ts`)
 * references stored secrets by name only. For any raw API key or webhook
 * secret, the generated audit detail — built by the pure
 * `buildIntegrationAuditDetail` helper — never reproduces the full secret
 * value; it contains only the secret names (`api_key`, `webhook_secret`) and
 * at most a masked last-4 preview of the API key.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildIntegrationAuditDetail } from "../../convex/runsheet/integrationsData";
import { extractLast4 } from "../../src/lib/integrations/encryptionService";

// Arbitrary secret values: realistic credentials plus awkward inputs.
const secretArb = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9._-]{5,128}$/),
  fc.string({ minLength: 5, maxLength: 256 })
);

describe("Property 14: Secret masking in audit records", () => {
  it("audit detail references secrets by name, never the raw value", () => {
    fc.assert(
      fc.property(
        secretArb,
        secretArb,
        fc.boolean(),
        (apiKey, webhookSecret, existing) => {
          const last4 = extractLast4(apiKey);
          const detail = buildIntegrationAuditDetail(existing, last4);

          // Names are present so the record is meaningful.
          expect(detail).toContain("api_key");
          expect(detail).toContain("webhook_secret");

          // The full secret values must never appear in the audit detail.
          // (When the key is <= 4 chars the last-4 equals the whole key, which
          // is an intentionally-masked preview, not a leak of a longer secret.)
          if (apiKey.length > 4) {
            expect(detail).not.toContain(apiKey);
          }
          expect(detail).not.toContain(webhookSecret);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("audit detail exposes at most the masked last-4 of the API key", () => {
    fc.assert(
      fc.property(secretArb, fc.boolean(), (apiKey, existing) => {
        const last4 = extractLast4(apiKey);
        const detail = buildIntegrationAuditDetail(existing, last4);

        // Only the masked last-4 preview is embedded for the API key.
        expect(detail).toContain(`api_key (last4 ${last4})`);
        // The webhook secret is referenced purely by name — no value preview.
        expect(detail).toContain("webhook_secret");
        expect(detail).not.toMatch(/webhook_secret \(/);
      }),
      { numRuns: 100 }
    );
  });
});
