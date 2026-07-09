// Feature: dinee-campus, Property 7: Knowledge-source acceptance matches type limits
/**
 * Property 7: Knowledge-source acceptance matches type limits
 *
 * Validates: Requirements 5.1, 5.6, 13.1
 *
 * THE Knowledge_Store SHALL accept a submitted Knowledge_Source iff its type
 * limits hold:
 *   - instructions: ≤ 10,000 characters
 *   - FAQ: ≤ 500 entries, each answer ≤ 2,000 characters
 *   - document: a supported MIME type AND a size within the layered
 *     document-size limits
 *   - link / event / club / course: no defined size or count bound
 *
 * The document-size limits are LAYERED and evaluated in a strict order:
 *   1. platform maximum (20 MB) — checked FIRST; a document over this is
 *      rejected as `document_too_large_platform` regardless of tier.
 *   2. per-tier per-document limit (free tier: 10 MB) — checked only when the
 *      platform maximum is satisfied; rejected as `document_too_large_tier`.
 *
 * On rejection the specific violated-limit reason is returned and the
 * previously stored source list is left unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateKnowledgeSource,
  submitKnowledgeSource,
  MAX_INSTRUCTIONS_CHARS,
  MAX_FAQ_ENTRIES,
  MAX_FAQ_ANSWER_CHARS,
  PLATFORM_MAX_DOCUMENT_BYTES,
  PER_TIER_DOCUMENT_LIMIT_BYTES,
  SUPPORTED_DOCUMENT_MIME_TYPES,
  type AccountTier,
  type KnowledgeSubmission,
  type StoredKnowledgeSource,
} from "../../../convex/campus/logic/knowledge";

// --- Arbitraries -----------------------------------------------------------

const tierArb: fc.Arbitrary<AccountTier> = fc.constantFrom("free", "paid");

const supportedMimeArb = fc.constantFrom(...SUPPORTED_DOCUMENT_MIME_TYPES);

/** MIME strings that are guaranteed NOT in the supported set. */
const unsupportedMimeArb = fc
  .oneof(
    fc.string(),
    fc.constantFrom(
      "image/png",
      "image/jpeg",
      "application/zip",
      "application/octet-stream",
      "video/mp4",
      "",
      "text/csv"
    )
  )
  .filter((m) => !SUPPORTED_DOCUMENT_MIME_TYPES.includes(m));

const sourceIdArb = fc.string({ minLength: 1, maxLength: 12 });

// --- Property 7 ------------------------------------------------------------

describe("Property 7: Knowledge-source acceptance matches type limits", () => {
  // --- instructions (Req 5.1) ---
  it("accepts instructions iff length ≤ MAX_INSTRUCTIONS_CHARS", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        fc.integer({ min: 0, max: MAX_INSTRUCTIONS_CHARS * 2 }),
        (sourceId, length) => {
          const submission: KnowledgeSubmission = {
            sourceId,
            kind: "instructions",
            textContent: "a".repeat(length),
          };
          const result = evaluateKnowledgeSource(submission);
          if (length <= MAX_INSTRUCTIONS_CHARS) {
            expect(result.accepted).toBe(true);
          } else {
            expect(result).toEqual({
              accepted: false,
              reason: "instructions_too_long",
            });
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- FAQ entry count + answer length (Req 5.1) ---
  it("accepts FAQ iff entries ≤ MAX_FAQ_ENTRIES and every answer ≤ MAX_FAQ_ANSWER_CHARS", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        // entry count around the boundary
        fc.integer({ min: 0, max: MAX_FAQ_ENTRIES + 5 }),
        // one answer's length around the boundary
        fc.integer({ min: 0, max: MAX_FAQ_ANSWER_CHARS + 50 }),
        (sourceId, entryCount, longAnswerLen) => {
          const faqEntries = Array.from({ length: entryCount }, (_, i) => ({
            question: `q${i}`,
            // make the first answer the potentially-oversized one
            answer: "a".repeat(i === 0 ? longAnswerLen : 1),
          }));
          const submission: KnowledgeSubmission = {
            sourceId,
            kind: "faq",
            faqEntries,
          };
          const result = evaluateKnowledgeSource(submission);

          const tooManyEntries = entryCount > MAX_FAQ_ENTRIES;
          const answerTooLong =
            entryCount > 0 && longAnswerLen > MAX_FAQ_ANSWER_CHARS;

          if (tooManyEntries) {
            // entry-count is checked before answer length
            expect(result).toEqual({
              accepted: false,
              reason: "faq_too_many_entries",
            });
          } else if (answerTooLong) {
            expect(result).toEqual({
              accepted: false,
              reason: "faq_answer_too_long",
            });
          } else {
            expect(result.accepted).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- document: missing meta (Req 5.6) ---
  it("rejects a document submission with no file metadata", () => {
    fc.assert(
      fc.property(sourceIdArb, (sourceId) => {
        const result = evaluateKnowledgeSource({ sourceId, kind: "document" });
        expect(result).toEqual({
          accepted: false,
          reason: "missing_document_meta",
        });
      }),
      { numRuns: 100 }
    );
  });

  // --- document: unsupported type is rejected before size (Req 5.6) ---
  it("rejects an unsupported document type regardless of size", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        unsupportedMimeArb,
        fc.integer({ min: 0, max: PLATFORM_MAX_DOCUMENT_BYTES * 2 }),
        tierArb,
        (sourceId, mimeType, sizeBytes, tier) => {
          const result = evaluateKnowledgeSource(
            {
              sourceId,
              kind: "document",
              fileMeta: { fileName: "f", sizeBytes, mimeType },
            },
            tier
          );
          expect(result).toEqual({
            accepted: false,
            reason: "unsupported_document_type",
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- document: LAYERED size limits, platform before tier (Req 5.6, 13.1) ---
  it("evaluates the 20 MB platform maximum before the per-tier limit", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        supportedMimeArb,
        fc.integer({ min: 0, max: PLATFORM_MAX_DOCUMENT_BYTES * 2 }),
        tierArb,
        (sourceId, mimeType, sizeBytes, tier) => {
          const result = evaluateKnowledgeSource(
            {
              sourceId,
              kind: "document",
              fileMeta: { fileName: "f", sizeBytes, mimeType },
            },
            tier
          );
          const tierLimit = PER_TIER_DOCUMENT_LIMIT_BYTES[tier];

          if (sizeBytes > PLATFORM_MAX_DOCUMENT_BYTES) {
            // Layer 1: platform maximum wins regardless of tier.
            expect(result).toEqual({
              accepted: false,
              reason: "document_too_large_platform",
              limitBytes: PLATFORM_MAX_DOCUMENT_BYTES,
            });
          } else if (sizeBytes > tierLimit) {
            // Layer 2: only reached when the platform maximum is satisfied.
            expect(result).toEqual({
              accepted: false,
              reason: "document_too_large_tier",
              limitBytes: tierLimit,
            });
          } else {
            expect(result.accepted).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- document over 20 MB is always platform-rejected even on the paid tier ---
  it("rejects a document over 20 MB as platform-too-large for every tier", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        supportedMimeArb,
        // strictly above the platform maximum
        fc.integer({
          min: PLATFORM_MAX_DOCUMENT_BYTES + 1,
          max: PLATFORM_MAX_DOCUMENT_BYTES * 3,
        }),
        tierArb,
        (sourceId, mimeType, sizeBytes, tier) => {
          const result = evaluateKnowledgeSource(
            {
              sourceId,
              kind: "document",
              fileMeta: { fileName: "f", sizeBytes, mimeType },
            },
            tier
          );
          expect(result).toEqual({
            accepted: false,
            reason: "document_too_large_platform",
            limitBytes: PLATFORM_MAX_DOCUMENT_BYTES,
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- a free-tier document in (10 MB, 20 MB] is tier-rejected ---
  it("rejects a free-tier document above 10 MB but within 20 MB as tier-too-large", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        supportedMimeArb,
        fc.integer({
          min: PER_TIER_DOCUMENT_LIMIT_BYTES.free + 1,
          max: PLATFORM_MAX_DOCUMENT_BYTES,
        }),
        (sourceId, mimeType, sizeBytes) => {
          const result = evaluateKnowledgeSource(
            {
              sourceId,
              kind: "document",
              fileMeta: { fileName: "f", sizeBytes, mimeType },
            },
            "free"
          );
          expect(result).toEqual({
            accepted: false,
            reason: "document_too_large_tier",
            limitBytes: PER_TIER_DOCUMENT_LIMIT_BYTES.free,
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- unbounded kinds are always accepted (Req 5.1) ---
  it("always accepts link/event/club/course sources", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        fc.constantFrom("link", "event", "club", "course") as fc.Arbitrary<
          KnowledgeSubmission["kind"]
        >,
        fc.string(),
        (sourceId, kind, textContent) => {
          const result = evaluateKnowledgeSource({
            sourceId,
            kind,
            textContent,
          });
          expect(result.accepted).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- rejection leaves the prior source list unchanged (Req 5.6) ---
  it("leaves the prior source list unchanged on rejection and appends on acceptance", () => {
    fc.assert(
      fc.property(
        sourceIdArb,
        supportedMimeArb,
        fc.integer({ min: 0, max: PLATFORM_MAX_DOCUMENT_BYTES * 2 }),
        (sourceId, mimeType, sizeBytes) => {
          const existing: StoredKnowledgeSource[] = [
            { sourceId: "existing-1", agentId: "agent-A", kind: "instructions" },
          ];
          const submission: KnowledgeSubmission = {
            sourceId,
            kind: "document",
            fileMeta: { fileName: "f", sizeBytes, mimeType },
          };
          const { sources, result } = submitKnowledgeSource(
            existing,
            "agent-A",
            submission,
            "free"
          );
          if (result.accepted) {
            expect(sources).toHaveLength(existing.length + 1);
            expect(sources[sources.length - 1]).toMatchObject({
              sourceId,
              agentId: "agent-A",
              kind: "document",
            });
          } else {
            // Prior content is returned unchanged (by reference).
            expect(sources).toBe(existing);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
