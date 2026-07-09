// Feature: dinee-campus, Property 3: Contact email and monetization link validation
/**
 * Feature: dinee-campus, Property 3: Contact email and monetization link
 * validation
 *
 * Validates: Requirements 2.7
 *
 * Requirement 2.7: IF a Student_Creator enters a contact email or monetization
 * link that is not a valid value for its field, THEN the Onboarding_Flow SHALL
 * block completion and identify the invalid field.
 *
 * The pure validators under test live in `convex/campus/logic/validation.ts`:
 *   - `isValidContactEmail(value)`   — well-formedness of a contact email
 *   - `isValidMonetizationLink(value)` — well-formedness of an http(s) URL
 *   - `validateOptionalValues(input)` — returns the EXACT set of invalid
 *     optional value-bearing fields (`contactEmail`, `monetizationLink`),
 *     treating absent/null/empty values as "not provided" (these fields are
 *     optional per Req 2.4) so they never fail.
 *
 * These properties assert, across many generated inputs (min 100 runs):
 *   1. `validateOptionalValues` flags a field iff a non-empty value is present
 *      AND that value is malformed for its field — i.e. it agrees exactly with
 *      the per-field well-formedness checkers.
 *   2. Absent / null / empty values are never flagged (optional fields).
 *   3. Well-formed values are never flagged; malformed values are always
 *      flagged, and the returned set identifies exactly the invalid field(s).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateOptionalValues,
  isValidContactEmail,
  isValidMonetizationLink,
  type OptionalValueFieldName,
} from "../../../convex/campus/logic/validation";

// ─── Generators ───────────────────────────────────────────────────────────────

/** Well-formed contact emails: non-empty local, @, domain label, dot, TLD≥2. */
const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9._%+-]{1,20}$/),
    fc.stringMatching(/^[a-zA-Z0-9-]{1,20}$/),
    fc.stringMatching(/^[a-zA-Z]{2,10}$/)
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Malformed emails: missing @, missing domain/TLD, embedded whitespace, etc. */
const invalidEmailArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant("plainaddress"),
  fc.constant("missing-at.example.com"),
  fc.constant("@no-local.com"),
  fc.constant("no-domain@"),
  fc.constant("no-tld@example"),
  fc.constant("no-dot@examplecom"),
  fc.constant("spaces in@example.com"),
  fc.constant("trailing@space.com "),
  fc.constant("two@@at.com"),
  fc.constant("short@tld.c"),
  // arbitrary non-empty strings that don't match the email pattern
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !isValidContactEmail(s))
);

/** Well-formed http(s) URLs with a non-empty host. */
const validLinkArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("http", "https"),
    fc.stringMatching(/^[a-z0-9-]{1,20}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.stringMatching(/^[a-zA-Z0-9/_-]{0,20}$/)
  )
  .map(([scheme, host, tld, path]) => `${scheme}://${host}.${tld}/${path}`);

/** Malformed monetization links: non-web schemes, bare schemes, junk. */
const invalidLinkArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant("not a url"),
  fc.constant("ftp://example.com"),
  fc.constant("mailto:someone@example.com"),
  fc.constant("javascript:alert(1)"),
  fc.constant("http://"),
  fc.constant("https://"),
  fc.constant("://missing-scheme.com"),
  fc.constant("example.com"),
  // arbitrary non-empty strings that don't parse as valid http(s) URLs
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !isValidMonetizationLink(s))
);

/** An "absent" value for an optional field: undefined, null, or empty string. */
const absentArb: fc.Arbitrary<string | null | undefined> = fc.constantFrom(
  undefined,
  null,
  ""
);

// ─── Property tests ─────────────────────────────────────────────────────────

describe("Feature: dinee-campus, Property 3: Contact email and monetization link validation", () => {
  it("flags a field iff a non-empty value is present and malformed (agrees with per-field checkers)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.oneof(validEmailArb, invalidEmailArb), { nil: undefined }),
        fc.option(fc.oneof(validLinkArb, invalidLinkArb), { nil: undefined }),
        (contactEmail, monetizationLink) => {
          const failing = validateOptionalValues({ contactEmail, monetizationLink });

          const emailProvided =
            typeof contactEmail === "string" && contactEmail.length > 0;
          const linkProvided =
            typeof monetizationLink === "string" && monetizationLink.length > 0;

          const expected: OptionalValueFieldName[] = [];
          if (emailProvided && !isValidContactEmail(contactEmail as string)) {
            expected.push("contactEmail");
          }
          if (linkProvided && !isValidMonetizationLink(monetizationLink as string)) {
            expected.push("monetizationLink");
          }

          // The failing set is exactly the set of provided-and-malformed fields,
          // in deterministic declaration order.
          expect(failing).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never flags absent, null, or empty optional values", () => {
    fc.assert(
      fc.property(absentArb, absentArb, (contactEmail, monetizationLink) => {
        const failing = validateOptionalValues({ contactEmail, monetizationLink });
        expect(failing).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it("never flags well-formed values", () => {
    fc.assert(
      fc.property(validEmailArb, validLinkArb, (contactEmail, monetizationLink) => {
        const failing = validateOptionalValues({ contactEmail, monetizationLink });
        expect(failing).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it("always flags a provided malformed contact email and identifies the field", () => {
    fc.assert(
      fc.property(invalidEmailArb, (contactEmail) => {
        // guard: the generator can only be trusted if it truly is invalid
        fc.pre(!isValidContactEmail(contactEmail) && contactEmail.length > 0);
        const failing = validateOptionalValues({ contactEmail });
        expect(failing).toContain("contactEmail");
        expect(failing).not.toContain("monetizationLink");
      }),
      { numRuns: 100 }
    );
  });

  it("always flags a provided malformed monetization link and identifies the field", () => {
    fc.assert(
      fc.property(invalidLinkArb, (monetizationLink) => {
        fc.pre(!isValidMonetizationLink(monetizationLink) && monetizationLink.length > 0);
        const failing = validateOptionalValues({ monetizationLink });
        expect(failing).toContain("monetizationLink");
        expect(failing).not.toContain("contactEmail");
      }),
      { numRuns: 100 }
    );
  });

  it("flags both fields when both provided values are malformed", () => {
    fc.assert(
      fc.property(invalidEmailArb, invalidLinkArb, (contactEmail, monetizationLink) => {
        fc.pre(!isValidContactEmail(contactEmail) && contactEmail.length > 0);
        fc.pre(!isValidMonetizationLink(monetizationLink) && monetizationLink.length > 0);
        const failing = validateOptionalValues({ contactEmail, monetizationLink });
        expect(failing).toEqual(["contactEmail", "monetizationLink"]);
      }),
      { numRuns: 100 }
    );
  });
});
