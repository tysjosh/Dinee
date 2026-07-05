// Feature: dinee-voice-platform, Property 16: Escalation-target validation — a target is accepted iff it is a valid phone (E.164), email, or webhook URL; an invalid target is rejected naming the invalid value and leaves the existing target unchanged
//
// Validates: Requirements 9.4, 9.7
//
// Req 9.4: THE Dinee_Platform SHALL provide an interface for a Runsheet_Admin to
// configure an Escalation_Target as exactly one of a phone number, an email
// address, or a webhook URL.
//
// Req 9.7: IF a Runsheet_Admin configures an Escalation_Target that is not a
// valid phone number, email address, or webhook URL, THEN THE Dinee_Platform
// SHALL reject the Escalation_Target, return an error indicating the invalid
// value, and leave the existing Escalation_Target unchanged.
//
// This property exercises the pure validators `validateEscalationTarget` and
// `applyEscalationTarget`: an escalation target is accepted iff its value is a
// valid phone/email/webhook for its declared kind; when rejected the error
// names the invalid value and `applyEscalationTarget` leaves the existing
// target unchanged.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateEscalationTarget,
  applyEscalationTarget,
  isValidPhoneValue,
  isValidEmailValue,
  isValidWebhookValue,
  type EscalationTargetKind,
} from "../../src/lib/integrations/runsheet/configValidation";
import type { EscalationTarget } from "../../src/lib/modules/voiceDomainPack";

// ---------------------------------------------------------------------------
// Generators for VALID values of each kind.
// ---------------------------------------------------------------------------

/** Valid E.164: `+`, a non-zero leading digit, then 1–14 more digits. */
const validPhoneArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 14 })
  )
  .map(([lead, rest]) => `+${lead}${rest.join("")}`);

/** Valid single email: non-empty local part, single `@`, dotted domain, no `..`. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9_%+-]{1,20}$/),
    fc.stringMatching(/^[a-zA-Z0-9-]{1,15}$/),
    fc.constantFrom("com", "org", "io", "co", "net", "dev")
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Valid webhook URL: absolute http/https URL with a non-empty host. */
const validWebhookArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
    fc.constantFrom("com", "org", "io", "dev"),
    fc.stringMatching(/^[a-z0-9/_-]{0,20}$/)
  )
  .map(([scheme, host, tld, path]) => `${scheme}://${host}.${tld}/${path}`);

const validValueByKind: Record<EscalationTargetKind, fc.Arbitrary<string>> = {
  phone: validPhoneArb,
  email: validEmailArb,
  webhook: validWebhookArb,
};

/** A well-formed, valid escalation target of a random kind. */
const validTargetArb: fc.Arbitrary<EscalationTarget> = fc
  .constantFrom<EscalationTargetKind>("phone", "email", "webhook")
  .chain((kind) =>
    validValueByKind[kind].map((value) => ({ kind, value }) as EscalationTarget)
  );

// ---------------------------------------------------------------------------
// Generators for INVALID values (leaning toward things each validator rejects).
// ---------------------------------------------------------------------------

/** Values that tend to fail every kind's validator. */
const invalidLeaningValueArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constantFrom(
    "not-a-phone",
    "12345", // missing leading +
    "+0123", // leading zero after +
    "+", // no digits
    "plainaddress", // no @
    "a@b", // domain missing dot
    "a@@b.com", // double @
    "user@domain..com", // consecutive dots
    "ftp://example.com", // wrong scheme
    "example.com", // no scheme
    "http://", // empty host
    "://nohost.com",
    "hello world"
  ),
  fc.string()
);

/** A candidate of a specific kind whose value fails that kind's validator. */
const invalidTargetArb: fc.Arbitrary<{ kind: EscalationTargetKind; value: string }> =
  fc
    .constantFrom<EscalationTargetKind>("phone", "email", "webhook")
    .chain((kind) => invalidLeaningValueArb.map((value) => ({ kind, value })));

/** True iff `value` is valid for `kind` — the reference oracle for the property. */
function isValidForKind(kind: EscalationTargetKind, value: string): boolean {
  if (kind === "phone") return isValidPhoneValue(value);
  if (kind === "email") return isValidEmailValue(value);
  return isValidWebhookValue(value);
}

describe("Property 16: Escalation-target validation", () => {
  it("accepts a target iff its value is valid for its kind (phone/email/webhook)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<EscalationTargetKind>("phone", "email", "webhook"),
        fc.oneof(invalidLeaningValueArb, validPhoneArb, validEmailArb, validWebhookArb),
        (kind, value) => {
          const result = validateEscalationTarget({ kind, value });
          const expectedValid = value.length > 0 && isValidForKind(kind, value);

          expect(result.ok).toBe(expectedValid);

          if (result.ok) {
            // The accepted target round-trips exactly what was submitted.
            expect(result.target).toEqual({ kind, value });
          } else {
            // Rejection names the invalid value (Req 9.7).
            expect(result.error.code).toBe("invalid_escalation_target");
            expect(result.error.invalidValue).toBe(value);
            expect(result.error.detail).toContain(value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts every well-formed valid target of each kind", () => {
    fc.assert(
      fc.property(validTargetArb, (target) => {
        const result = validateEscalationTarget(target);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.target).toEqual(target);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a kind-mismatched value (e.g. an email in a phone target)", () => {
    // A value valid for one kind is not valid for a different kind, so declaring
    // the wrong kind must be rejected.
    fc.assert(
      fc.property(
        fc.constantFrom<EscalationTargetKind>("phone", "email", "webhook"),
        validEmailArb,
        (kind, email) => {
          // Only assert when the email is genuinely invalid for the chosen kind.
          fc.pre(!isValidForKind(kind, email));
          const result = validateEscalationTarget({ kind, value: email });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.invalidValue).toBe(email);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("leaves the existing target unchanged when an invalid candidate is applied (Req 9.7)", () => {
    fc.assert(
      fc.property(
        fc.option(validTargetArb, { nil: undefined }),
        invalidTargetArb,
        (existing, candidate) => {
          // Precondition on the candidate actually being invalid.
          fc.pre(!validateEscalationTarget(candidate).ok);

          const outcome = applyEscalationTarget(existing, candidate);

          // The candidate is rejected and the existing target is preserved.
          expect(outcome.accepted).toBe(false);
          expect(outcome.target).toEqual(existing);
          expect(outcome.error).toBeDefined();
          expect(outcome.error?.invalidValue).toBe(candidate.value);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("adopts a valid candidate, replacing the existing target", () => {
    fc.assert(
      fc.property(
        fc.option(validTargetArb, { nil: undefined }),
        validTargetArb,
        (existing, candidate) => {
          const outcome = applyEscalationTarget(existing, candidate);
          expect(outcome.accepted).toBe(true);
          expect(outcome.target).toEqual(candidate);
          expect(outcome.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects non-object / null candidates and preserves the existing target", () => {
    fc.assert(
      fc.property(
        fc.option(validTargetArb, { nil: undefined }),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.string(),
          fc.integer(),
          fc.boolean()
        ),
        (existing, candidate) => {
          const outcome = applyEscalationTarget(existing, candidate);
          expect(outcome.accepted).toBe(false);
          expect(outcome.target).toEqual(existing);
        }
      ),
      { numRuns: 100 }
    );
  });
});
