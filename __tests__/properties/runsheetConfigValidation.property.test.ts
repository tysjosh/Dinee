// Feature: dinee-voice-platform, Property: config validation
/**
 * Property 15: Review-mode and required-field configuration validation.
 *
 * **Validates: Requirements 8.4, 8.6, 8.7**
 *
 * For any candidate Runsheet integration configuration:
 * - Req 8.4: the review mode must be exactly one of
 *   {always_review, auto_submit_low_risk}.
 * - Req 8.6: an invalid review mode is rejected, naming `defaultReviewMode`.
 * - Req 8.7: a missing/blank base URL, tenant id, or API key is rejected,
 *   naming the offending field; the stored integration is left unchanged.
 *
 * The property asserts that `validateIntegrationConfig` returns `ok: true`
 * iff the review mode is valid AND all required fields are non-empty, and that
 * on failure `field` names the offending field following the validator's
 * documented precedence order:
 *   defaultReviewMode → baseUrl → runsheetTenantId → apiKey.
 *
 * `validateIntegrationConfig` is a pure function, so "stored integration
 * unchanged" is verified structurally: a rejected input yields no accepting
 * result and never mutates its input (it only reads and returns a verdict).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateIntegrationConfig,
  REVIEW_MODES,
} from "../../convex/runsheet/integrationsData";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A valid review mode drawn from the two allowed values (Req 8.4). */
const validReviewModeArb = fc.constantFrom(...REVIEW_MODES);

/** An invalid review mode: any string that is not one of REVIEW_MODES. */
const invalidReviewModeArb = fc
  .string()
  .filter((s) => !(REVIEW_MODES as readonly string[]).includes(s));

/** Any review mode — valid or invalid, weighted to hit both branches. */
const anyReviewModeArb = fc.oneof(validReviewModeArb, invalidReviewModeArb);

/** A non-empty required-field value (has at least one non-whitespace char). */
const presentFieldArb = fc
  .string()
  .filter((s) => s.trim().length > 0);

/** A blank/absent required-field value: empty or whitespace-only. */
const blankFieldArb = fc.constantFrom("", " ", "   ", "\t", "\n", "  \t\n ");

/** Any required-field value — present or blank, hitting both branches. */
const anyFieldArb = fc.oneof(presentFieldArb, blankFieldArb);

/** A full candidate config with each dimension independently mutated. */
const configArb = fc.record({
  baseUrl: anyFieldArb,
  runsheetTenantId: anyFieldArb,
  apiKey: anyFieldArb,
  defaultReviewMode: anyReviewModeArb,
});

// ─── Oracle ──────────────────────────────────────────────────────────────────

const isBlank = (s: string) => !s || s.trim().length === 0;

/** Independent reference for the offending field, matching the documented order. */
function expectedOffendingField(input: {
  baseUrl: string;
  runsheetTenantId: string;
  apiKey: string;
  defaultReviewMode: string;
}): string | null {
  if (!(REVIEW_MODES as readonly string[]).includes(input.defaultReviewMode)) {
    return "defaultReviewMode";
  }
  if (isBlank(input.baseUrl)) return "baseUrl";
  if (isBlank(input.runsheetTenantId)) return "runsheetTenantId";
  if (isBlank(input.apiKey)) return "apiKey";
  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 15: Review-mode and required-field configuration validation", () => {
  it("accepts iff review mode is valid AND all required fields are non-empty (Req 8.4, 8.6, 8.7)", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = validateIntegrationConfig(config);

        const reviewModeValid = (REVIEW_MODES as readonly string[]).includes(
          config.defaultReviewMode
        );
        const allFieldsPresent =
          !isBlank(config.baseUrl) &&
          !isBlank(config.runsheetTenantId) &&
          !isBlank(config.apiKey);
        const shouldAccept = reviewModeValid && allFieldsPresent;

        expect(result.ok).toBe(shouldAccept);
      }),
      { numRuns: 100 }
    );
  });

  it("on failure, `field` names the offending field per documented precedence (Req 8.6, 8.7)", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = validateIntegrationConfig(config);
        const expectedField = expectedOffendingField(config);

        if (expectedField === null) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (result.ok === false) {
            expect(result.field).toBe(expectedField);
            expect(typeof result.message).toBe("string");
            expect(result.message.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects every invalid review mode, naming defaultReviewMode first (Req 8.4, 8.6)", () => {
    fc.assert(
      fc.property(
        invalidReviewModeArb,
        presentFieldArb,
        presentFieldArb,
        presentFieldArb,
        (defaultReviewMode, baseUrl, runsheetTenantId, apiKey) => {
          const result = validateIntegrationConfig({
            baseUrl,
            runsheetTenantId,
            apiKey,
            defaultReviewMode,
          });

          expect(result.ok).toBe(false);
          if (result.ok === false) {
            expect(result.field).toBe("defaultReviewMode");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects a blank required field even when review mode is valid (Req 8.7)", () => {
    fc.assert(
      fc.property(
        validReviewModeArb,
        anyFieldArb,
        anyFieldArb,
        anyFieldArb,
        (defaultReviewMode, baseUrl, runsheetTenantId, apiKey) => {
          // Force at least one required field blank so a rejection is expected.
          fc.pre(
            isBlank(baseUrl) || isBlank(runsheetTenantId) || isBlank(apiKey)
          );

          const result = validateIntegrationConfig({
            baseUrl,
            runsheetTenantId,
            apiKey,
            defaultReviewMode,
          });

          expect(result.ok).toBe(false);
          if (result.ok === false) {
            // First blank field in documented order.
            const expected = isBlank(baseUrl)
              ? "baseUrl"
              : isBlank(runsheetTenantId)
                ? "runsheetTenantId"
                : "apiKey";
            expect(result.field).toBe(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts a fully valid config (valid review mode + all fields present)", () => {
    fc.assert(
      fc.property(
        validReviewModeArb,
        presentFieldArb,
        presentFieldArb,
        presentFieldArb,
        (defaultReviewMode, baseUrl, runsheetTenantId, apiKey) => {
          const result = validateIntegrationConfig({
            baseUrl,
            runsheetTenantId,
            apiKey,
            defaultReviewMode,
          });

          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not mutate its input regardless of validity (stored config unchanged, Req 8.7)", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const snapshot = { ...config };
        validateIntegrationConfig(config);
        expect(config).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});
