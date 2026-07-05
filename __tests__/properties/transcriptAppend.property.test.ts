/**
 * Feature: dinee-voice-platform, Property 23: Transcript append preserves all turns in order
 *
 * **Validates: Requirements 18.1**
 *
 * Req 18.1: WHILE a Runsheet call is in progress, THE Voice_Runtime SHALL, as a
 * runtime side-effect and without a model tool call, append each confirmed
 * dialogue turn to the Dinee-owned transcript identified by the call identifier.
 *
 * Property: for any sequence of appended turns — interleaved across one or more
 * call ids — the stored transcript for each call id contains exactly the turns
 * appended for that call id, in append order, with none dropped, duplicated, or
 * reordered.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  TranscriptBuffer,
  type TranscriptTurn,
} from "../../src/app/ws-server/runtime/transcriptBuffer";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Call ids drawn from a small pool so sequences interleave across calls. */
const callSidArb = fc.constantFrom(
  "CA_call_1",
  "CA_call_2",
  "CA_call_3",
  "CA_call_4"
);

const roleArb = fc.constantFrom<TranscriptTurn["role"]>("caller", "agent");

/** Text includes unicode, empty strings, and whitespace to stress ordering. */
const textArb = fc.oneof(
  fc.string(),
  fc.constant(""),
  fc.constantFrom("hello", "  spaced  ", "café ☕", "line1\nline2", "123")
);

const atArb = fc.integer({ min: 0, max: 2_000_000_000_000 });

const turnArb: fc.Arbitrary<TranscriptTurn> = fc.record({
  role: roleArb,
  text: textArb,
  at: atArb,
});

/** A single append operation: which call the turn belongs to, plus the turn. */
interface AppendOp {
  callSid: string;
  turn: TranscriptTurn;
}

const appendOpArb: fc.Arbitrary<AppendOp> = fc.record({
  callSid: callSidArb,
  turn: turnArb,
});

/** A sequence of appends interleaved across one or more call ids. */
const appendSequenceArb = fc.array(appendOpArb, { minLength: 0, maxLength: 60 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A buffer with no persister still records every appended turn in the in-memory
 * transcript (persistence failure only affects the pending-retry queue, not the
 * ordered transcript that Property 23 asserts on).
 */
function newBuffer(): TranscriptBuffer {
  return new TranscriptBuffer();
}

/** Groups the expected turns per call id, preserving append order. */
function expectedByCall(ops: AppendOp[]): Map<string, TranscriptTurn[]> {
  const expected = new Map<string, TranscriptTurn[]>();
  for (const op of ops) {
    const list = expected.get(op.callSid);
    if (list) {
      list.push(op.turn);
    } else {
      expected.set(op.callSid, [op.turn]);
    }
  }
  return expected;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 23: Transcript append preserves all turns in order", () => {
  it("stored transcript contains all appended turns in append order per call id", async () => {
    await fc.assert(
      fc.asyncProperty(appendSequenceArb, async (ops) => {
        const buffer = newBuffer();

        for (const op of ops) {
          await buffer.append(op.callSid, op.turn);
        }

        const expected = expectedByCall(ops);
        for (const [callSid, turns] of expected) {
          expect(buffer.getTranscript(callSid)).toEqual(turns);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("preserves order and count for a single call id (no drops, no dupes, no reorder)", async () => {
    await fc.assert(
      fc.asyncProperty(
        callSidArb,
        fc.array(turnArb, { minLength: 0, maxLength: 40 }),
        async (callSid, turns) => {
          const buffer = newBuffer();

          for (const turn of turns) {
            await buffer.append(callSid, turn);
          }

          const stored = buffer.getTranscript(callSid);
          expect(stored.length).toBe(turns.length);
          expect(stored).toEqual(turns);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("keeps transcripts isolated across call ids (no cross-contamination)", async () => {
    await fc.assert(
      fc.asyncProperty(appendSequenceArb, async (ops) => {
        const buffer = newBuffer();

        for (const op of ops) {
          await buffer.append(op.callSid, op.turn);
        }

        const expected = expectedByCall(ops);

        // Every call that received turns has exactly those turns.
        for (const [callSid, turns] of expected) {
          expect(buffer.getTranscript(callSid)).toEqual(turns);
        }

        // The total count across all calls equals the number of appends.
        const totalStored = [...expected.keys()].reduce(
          (sum, callSid) => sum + buffer.getTranscript(callSid).length,
          0
        );
        expect(totalStored).toBe(ops.length);
      }),
      { numRuns: 100 }
    );
  });

  it("append order equals the observed call-scoped subsequence of the global sequence", async () => {
    await fc.assert(
      fc.asyncProperty(appendSequenceArb, callSidArb, async (ops, focusCall) => {
        const buffer = newBuffer();

        for (const op of ops) {
          await buffer.append(op.callSid, op.turn);
        }

        // The transcript for the focused call is precisely the turns whose op
        // targeted that call, in the same relative order as the global sequence.
        const expectedForFocus = ops
          .filter((op) => op.callSid === focusCall)
          .map((op) => op.turn);

        expect(buffer.getTranscript(focusCall)).toEqual(expectedForFocus);
      }),
      { numRuns: 100 }
    );
  });

  it("returns an empty transcript for a call id that was never appended to", () => {
    const buffer = newBuffer();
    expect(buffer.getTranscript("CA_never_seen")).toEqual([]);
  });
});
