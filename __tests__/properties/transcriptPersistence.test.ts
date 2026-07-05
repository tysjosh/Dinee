/**
 * Feature: dinee-voice-platform — Transcript association + append persistence.
 *
 * Exercises the pure helpers behind `convex/runsheet/transcripts.ts`. The
 * Convex mutation/query themselves need a Convex DB and are covered by the
 * runtime wiring; here we pin the deterministic association (`transcriptId`),
 * the role<->speaker mapping used to reuse the existing `transcripts` table,
 * and the row builder that shapes each confirmed turn for persistence.
 *
 * Validates: Requirements 18.2, 18.3
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  deriveTranscriptId,
  callIdFromTranscriptId,
  roleToSpeaker,
  speakerToRole,
  buildTranscriptRow,
  type TranscriptRole,
} from "../../convex/runsheet/transcripts";

const roleArb: fc.Arbitrary<TranscriptRole> = fc.constantFrom(
  "caller",
  "agent"
);

describe("deriveTranscriptId / callIdFromTranscriptId (Req 18.2 association)", () => {
  it("is deterministic for a given call id", () => {
    fc.assert(
      fc.property(fc.string(), (callId) => {
        expect(deriveTranscriptId(callId)).toBe(deriveTranscriptId(callId));
      }),
      { numRuns: 100 }
    );
  });

  it("round-trips: callIdFromTranscriptId(deriveTranscriptId(id)) === id", () => {
    fc.assert(
      fc.property(fc.string(), (callId) => {
        expect(callIdFromTranscriptId(deriveTranscriptId(callId))).toBe(callId);
      }),
      { numRuns: 100 }
    );
  });

  it("distinct call ids produce distinct transcript ids", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(deriveTranscriptId(a)).not.toBe(deriveTranscriptId(b));
      }),
      { numRuns: 100 }
    );
  });

  it("returns null for values that are not transcript ids", () => {
    expect(callIdFromTranscriptId("not-a-transcript-id")).toBeNull();
    expect(callIdFromTranscriptId("")).toBeNull();
  });
});

describe("role <-> speaker mapping (reuse of the transcripts table)", () => {
  it("maps caller->human and agent->ai", () => {
    expect(roleToSpeaker("caller")).toBe("human");
    expect(roleToSpeaker("agent")).toBe("ai");
  });

  it("round-trips role -> speaker -> role", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        expect(speakerToRole(roleToSpeaker(role))).toBe(role);
      }),
      { numRuns: 100 }
    );
  });
});

describe("buildTranscriptRow (Req 18.1 append persistence shape)", () => {
  it("shapes a confirmed turn into a transcripts-table row", () => {
    fc.assert(
      fc.property(fc.string(), roleArb, fc.string(), (callId, role, text) => {
        const row = buildTranscriptRow(callId, { role, text });
        expect(row.callId).toBe(callId);
        expect(row.dialogue).toBe(text);
        expect(row.speaker).toBe(roleToSpeaker(role));
        // No correlationId supplied -> the optional field is absent, matching
        // the existing table's backward-compatible optional column.
        expect(row.correlationId).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("carries the correlationId when provided", () => {
    fc.assert(
      fc.property(
        fc.string(),
        roleArb,
        fc.string(),
        fc.string({ minLength: 1 }),
        (callId, role, text, correlationId) => {
          const row = buildTranscriptRow(callId, { role, text }, correlationId);
          expect(row.correlationId).toBe(correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
