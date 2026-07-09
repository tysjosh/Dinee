// Feature: dinee-campus, Property 6: Draft persistence round-trip
/**
 * Property 6: Draft persistence round-trip
 *
 * Validates: Requirements 4.3
 *
 * WHILE the Agent_Creation_Flow is in progress, THE Agent_Creation_Flow SHALL
 * persist each entered field value and SHALL retain the persisted values so
 * that a Student_Creator who leaves and returns resumes with previously entered
 * values retained.
 *
 * The pure draft logic realizes this as a lossless serialize/deserialize pair
 * over the normalized domain:
 *   - deserializeDraft(serializeDraft(d)) === normalizeDraft(d)   (no entered value is lost)
 *   - serializeDraft(deserializeDraft(s)) === s                   (stored form is a fixed point)
 *   - normalization is value-preserving: every entered value survives unchanged.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  serializeDraft,
  deserializeDraft,
  normalizeDraft,
  type CreationDraft,
  type AgentType,
  type Visibility,
  type DraftKnowledgeSource,
  type DraftOptionalFields,
} from "../../../convex/campus/logic/draft";

// --- Arbitraries: constrain to the entered-value input space ---

const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent"
);

const visibilityArb: fc.Arbitrary<Visibility> = fc.constantFrom(
  "public",
  "private"
);

/** Strings covering unicode, emoji, empty, whitespace, and awkward values. */
const awkwardStringArb = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "",
    " ",
    "  spaced  ",
    "0",
    "007",
    "café ☕",
    "naïve façade — 北京 🏙️",
    "line\nbreak\ttab",
    'quote " and \\ backslash'
  )
);

const knowledgeSourceArb: fc.Arbitrary<DraftKnowledgeSource> = fc.record(
  {
    kind: fc.constantFrom(
      "instructions",
      "faq",
      "document",
      "link",
      "event",
      "club",
      "course"
    ),
    textContent: awkwardStringArb,
    faqEntries: fc.array(
      fc.record({ question: awkwardStringArb, answer: awkwardStringArb }),
      { maxLength: 4 }
    ),
    storageId: awkwardStringArb,
    fileMeta: fc.record({
      fileName: awkwardStringArb,
      sizeBytes: fc.integer({ min: 0, max: 20_000_000 }),
      mimeType: awkwardStringArb,
    }),
  },
  // Every field except `kind` is optional — model a partially-entered source.
  {
    requiredKeys: ["kind"],
  }
);

const optionalFieldsArb: fc.Arbitrary<DraftOptionalFields> = fc.record(
  {
    socialLink: awkwardStringArb,
    clubName: awkwardStringArb,
    courseCode: awkwardStringArb,
    eventDate: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    contactEmail: awkwardStringArb,
  },
  { requiredKeys: [] }
);

/**
 * A partially-entered creation field set. `fc.record` with `requiredKeys: []`
 * omits each key independently, so drafts range from empty to fully populated —
 * exactly the space a save-at-any-point flow produces.
 */
const draftArb: fc.Arbitrary<CreationDraft> = fc.record(
  {
    name: awkwardStringArb,
    agentType: agentTypeArb,
    campusTag: awkwardStringArb,
    voiceId: awkwardStringArb,
    personalityTone: awkwardStringArb,
    description: awkwardStringArb,
    creatorDisplayName: awkwardStringArb,
    previewPrompts: fc.array(awkwardStringArb, { maxLength: 5 }),
    visibility: visibilityArb,
    representsRealPerson: fc.boolean(),
    remixEnabled: fc.boolean(),
    recordingEnabled: fc.boolean(),
    summariesEnabled: fc.boolean(),
    creatorContactLink: awkwardStringArb,
    monetizationLink: awkwardStringArb,
    optional: optionalFieldsArb,
    knowledgeSources: fc.array(knowledgeSourceArb, { maxLength: 4 }),
  },
  { requiredKeys: [] }
);

describe("Property 6: Draft persistence round-trip", () => {
  it("deserialize(serialize(draft)) equals the normalized draft — no entered value is lost", () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const roundTripped = deserializeDraft(serializeDraft(draft));
        expect(roundTripped).toEqual(normalizeDraft(draft));
      }),
      { numRuns: 100 }
    );
  });

  it("the stored form is a fixed point: serialize(deserialize(stored)) equals stored", () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const stored = serializeDraft(draft);
        expect(serializeDraft(deserializeDraft(stored))).toEqual(stored);
      }),
      { numRuns: 100 }
    );
  });

  it("every entered value is retained exactly (value-preserving normalization)", () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const stored = serializeDraft(draft);
        // Each entered (non-undefined) scalar field survives unchanged.
        for (const key of [
          "name",
          "agentType",
          "campusTag",
          "voiceId",
          "personalityTone",
          "description",
          "creatorDisplayName",
          "visibility",
          "representsRealPerson",
          "remixEnabled",
          "recordingEnabled",
          "summariesEnabled",
          "creatorContactLink",
          "monetizationLink",
        ] as const) {
          if (draft[key] !== undefined) {
            expect(stored[key]).toEqual(draft[key]);
          }
        }
        // Array/nested values survive by deep equality when entered.
        if (draft.previewPrompts !== undefined) {
          expect(stored.previewPrompts).toEqual(draft.previewPrompts);
        }
        if (draft.knowledgeSources !== undefined) {
          expect(stored.knowledgeSources).toEqual(draft.knowledgeSources);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("round-trip is idempotent on already-stored drafts", () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const once = serializeDraft(draft);
        const twice = serializeDraft(deserializeDraft(once));
        expect(twice).toEqual(once);
        // Applying the round-trip a third time changes nothing further.
        expect(deserializeDraft(twice)).toEqual(deserializeDraft(once));
      }),
      { numRuns: 100 }
    );
  });
});
