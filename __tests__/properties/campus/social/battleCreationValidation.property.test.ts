// Feature: campus-social-loops, Property 1: Battle creation requires exactly two distinct published participants and a valid format
/**
 * Feature: campus-social-loops, Property 1: Battle creation requires exactly two
 * distinct published participants and a valid format
 *
 * Validates: Requirements 1.1, 1.2
 *
 * Req 1.1: WHEN a Student_Creator creates an Agent_Battle, THE Battle_Service
 * SHALL require exactly two distinct published Battle_Participants and a
 * Battle_Format that is one of roast_battle, debate, trivia_showdown,
 * advice_showdown, or club_pitch_battle.
 * Req 1.2: IF a Student_Creator attempts to create an Agent_Battle with fewer
 * than two, more than two, the same agent twice, a non-published participant, or
 * a Battle_Format outside the defined set, THEN THE Battle_Service SHALL reject
 * creation and present an indication identifying the invalid field.
 *
 * The pure function under test is {@link validateBattleCreation}. The property
 * asserts creation is accepted iff there are exactly two distinct published
 * participants and a valid format, and that on rejection the reported
 * `invalidField` matches the first failing dimension in the order
 * count → duplicate → not-published → format.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateBattleCreation,
  BATTLE_FORMATS,
} from "../../../../convex/campus/social/logic/battles";
import {
  battleCreationInputArb,
  validParticipantPairArb,
  battleFormatArb,
  invalidBattleFormatArb,
  invalidParticipantsArb,
  type ParticipantView,
} from "./arbitraries";

/**
 * Independently derives the expected create result from the raw inputs, using
 * the same check order specified by the design (count → duplicate →
 * not-published → format).
 */
function expectedResult(
  participants: readonly ParticipantView[],
  format: string
): "valid" | "participant_count" | "duplicate_participant" | "participant_not_published" | "format" {
  if (participants.length !== 2) return "participant_count";
  const distinct = new Set(participants.map((p) => p.agentId));
  if (distinct.size !== participants.length) return "duplicate_participant";
  if (participants.some((p) => p.status !== "published"))
    return "participant_not_published";
  if (!(BATTLE_FORMATS as readonly string[]).includes(format)) return "format";
  return "valid";
}

describe("Property 1: Battle creation requires exactly two distinct published participants and a valid format", () => {
  it("accepts iff exactly two distinct published participants and a valid format, else names the first failing field", () => {
    fc.assert(
      fc.property(battleCreationInputArb, ({ participants, format }) => {
        const result = validateBattleCreation(participants, format);
        const expected = expectedResult(participants, format);

        if (expected === "valid") {
          expect(result.valid).toBe(true);
        } else {
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.invalidField).toBe(expected);
            expect(typeof result.message).toBe("string");
            expect(result.message.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("always accepts two distinct published participants with a valid format", () => {
    fc.assert(
      fc.property(validParticipantPairArb, battleFormatArb, (pair, format) => {
        const result = validateBattleCreation([...pair], format);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a valid participant pair paired with a format outside the defined set", () => {
    fc.assert(
      fc.property(
        validParticipantPairArb,
        invalidBattleFormatArb,
        (pair, format) => {
          const result = validateBattleCreation([...pair], format);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.invalidField).toBe("format");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects every invalid participant dimension with the matching invalidField, even with a valid format", () => {
    fc.assert(
      fc.property(
        invalidParticipantsArb,
        battleFormatArb,
        ({ dimension, participants }, format) => {
          const result = validateBattleCreation(participants, format);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.invalidField).toBe(dimension);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
