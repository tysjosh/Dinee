/**
 * Feature: dinee-voice-platform, Property 22: Intake payload serialization round-trip
 * (deterministic, byte-identical, cross-language)
 *
 * Validates: Requirements 10.2, 10.3, 10.9, 11.6, 11.7
 *
 * `deserializeIntake(canonicalizeIntake(payload))` reconstructs the extracted slots and
 * intake metadata — including the FULL confirmed transcript content (every confirmed turn,
 * its role, text, and timestamp) and the transcript identifier — equivalent to the submitted
 * values, and re-canonicalizing the reconstructed values is byte-identical to the transmitted
 * canonical bytes. The shared cross-language vectors from task 8.3 are also exercised so the
 * TypeScript client reproduces the exact `canonical` bytes and `signature` the Runsheet
 * Python adapter verifies against.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canonicalizeIntake,
  deserializeIntake,
  signIntake,
  type VoiceIntakePayload,
  type TranscriptTurn,
} from "../../src/lib/integrations/runsheet/voiceIntakeClient";
import intakeVectors from "../fixtures/intakeVectors.json";

// --- Shared cross-language fixture typing (task 8.3) ---

interface IntakeVector {
  name: string;
  description: string;
  secret: string;
  payload: VoiceIntakePayload;
  canonical: string;
  signature: string;
}

const vectors = (intakeVectors as { vectors: IntakeVector[] }).vectors;

// --- Arbitraries: awkward but JSON-round-trip-stable values ---

/** Finite double with -0 normalized to 0 so JSON round-trip is bit-stable. */
const boundedDouble = fc
  .double({ min: -1_000_000, max: 1_000_000, noNaN: true })
  .map((n) => (Object.is(n, -0) ? 0 : n));

/** Strings covering unicode, emoji, empty, whitespace, and numbers-as-strings. */
const awkwardStringArb = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "",
    " ",
    "  spaced  ",
    "0",
    "007",
    "123",
    "-45.6",
    "1e5",
    "+2348012345678",
    "café ☕",
    "naïve façade — 北京 🏙️",
    "Δοκιμή 日本語 🚚",
    "line\nbreak\ttab",
    'quote " and \\ backslash'
  )
);

/** Object keys, excluding the prototype-poisoning key to keep deep-equality clean. */
const safeKeyArb = fc.string().filter((k) => k !== "__proto__");

/** Recursive JSON value: leaves plus nested objects/arrays with permuted key orders. */
const jsonValueArb = fc.letrec<{ leaf: unknown; node: unknown }>((tie) => ({
  leaf: fc.oneof(
    awkwardStringArb,
    fc.integer(),
    boundedDouble,
    fc.boolean(),
    fc.constant(null)
  ),
  node: fc.oneof(
    { maxDepth: 3, depthSize: "small" },
    tie("leaf"),
    fc.array(tie("node"), { maxLength: 4 }),
    fc.dictionary(safeKeyArb, tie("node"), { maxKeys: 4 })
  ),
})).node;

const extractedSlotsArb = fc.dictionary(
  safeKeyArb,
  jsonValueArb,
  { maxKeys: 6 }
) as fc.Arbitrary<Record<string, unknown>>;

const transcriptTurnArb: fc.Arbitrary<TranscriptTurn> = fc.record({
  role: fc.constantFrom<TranscriptTurn["role"]>("caller", "agent"),
  text: awkwardStringArb,
  at: fc.integer({ min: 0, max: 4_000_000_000_000 }),
});

const payloadArb: fc.Arbitrary<VoiceIntakePayload> = fc.record({
  schemaVersion: fc.constantFrom("1.0.0", "1.2.0", "2.0.0-beta", ""),
  tenantId: awkwardStringArb,
  idempotencyKey: awkwardStringArb,
  timestamp: fc.integer({ min: 0, max: 4_000_000_000_000 }),
  callId: awkwardStringArb,
  transcriptId: awkwardStringArb,
  transcript: fc.array(transcriptTurnArb, { maxLength: 8 }),
  recordingRef: fc.option(awkwardStringArb, { nil: null }),
  confidenceScore: fc.double({ min: 0, max: 1, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
  agentId: awkwardStringArb,
  sessionId: awkwardStringArb,
  callerPhone: awkwardStringArb,
  reviewRequired: fc.boolean(),
  extractedSlots: extractedSlotsArb,
});

describe("Property 22: Intake payload serialization round-trip", () => {
  it("reconstructs equivalent slots, metadata, and full transcript, and re-canonicalizes byte-identically", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const canonical = canonicalizeIntake(payload);
        const reconstructed = deserializeIntake(canonical);

        // Re-canonicalizing the reconstructed payload is byte-identical to the wire bytes.
        expect(canonicalizeIntake(reconstructed)).toBe(canonical);

        // Full transcript content survives: every turn, its role, text, and timestamp, in order.
        expect(reconstructed.transcript).toEqual(payload.transcript);
        expect(reconstructed.transcript.length).toBe(payload.transcript.length);
        reconstructed.transcript.forEach((turn, i) => {
          expect(turn.role).toBe(payload.transcript[i].role);
          expect(turn.text).toBe(payload.transcript[i].text);
          expect(turn.at).toBe(payload.transcript[i].at);
        });

        // The transcript identifier reference is preserved.
        expect(reconstructed.transcriptId).toBe(payload.transcriptId);

        // Extracted slots and all intake metadata are equivalent to the submitted values.
        expect(reconstructed.extractedSlots).toEqual(payload.extractedSlots);
        expect(reconstructed).toEqual(payload);
      }),
      { numRuns: 100 }
    );
  });

  it("is deterministic — canonicalization is stable across repeated calls", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        expect(canonicalizeIntake(payload)).toBe(canonicalizeIntake(payload));
      }),
      { numRuns: 100 }
    );
  });

  describe("shared cross-language vectors (task 8.3)", () => {
    it("has vectors to run", () => {
      expect(vectors.length).toBeGreaterThan(0);
    });

    for (const vector of vectors) {
      it(`reproduces canonical bytes and signature for vector "${vector.name}"`, () => {
        // Canonical bytes match the shared fixture exactly (Req 11.6, 11.7).
        expect(canonicalizeIntake(vector.payload)).toBe(vector.canonical);

        // Signature over the canonical bytes matches (Req 11.7).
        expect(signIntake(vector.canonical, vector.secret)).toBe(vector.signature);

        // Round-trip from the shared canonical bytes reconstructs an equivalent payload
        // whose re-canonicalization is byte-identical (Req 10.2, 10.3, 10.9, 11.6).
        const reconstructed = deserializeIntake(vector.canonical);
        expect(canonicalizeIntake(reconstructed)).toBe(vector.canonical);
        expect(reconstructed.transcript).toEqual(vector.payload.transcript);
        expect(reconstructed.transcriptId).toBe(vector.payload.transcriptId);
        expect(reconstructed.extractedSlots).toEqual(vector.payload.extractedSlots);
      });
    }
  });
});
