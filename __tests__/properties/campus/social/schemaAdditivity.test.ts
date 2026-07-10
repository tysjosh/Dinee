/**
 * Feature: campus-social-loops, Schema-additivity regression test
 *
 * Validates: Requirements 8.1, 8.3
 *
 * Task 1 of campus-social-loops adds seventeen NEW `campus*` social tables to
 * convex/schema.ts (battles/votes/rivalries, challenges/entries/votes, share
 * clips, group sessions/participants/questions/responses, streaks/activity
 * counters/badges, quests/progress, and companion interactions) plus a SINGLE
 * additive optional field `users.ageBand`. Everything is purely additive — no
 * existing table is modified except that one optional field — so no pre-existing
 * row may be invalidated (Req 8.1 reuse guarantee, Req 8.3 exclusion invariants
 * build on unchanged base tables).
 *
 * This regression test validates arbitrary rows against the ACTUAL Convex
 * validators exported from convex/schema.ts (walking the real validator AST,
 * `schema.tables.<t>.validator`, not a hand-copied mirror) and asserts:
 *   1. The new `campus*` social tables do not alter validation of any existing
 *      table: legacy `users` / `calls` / `orders` / `transcripts` rows carrying
 *      only pre-social fields still validate, and the base tables still reject
 *      unknown keys and out-of-union values.
 *   2. Existing `users` rows WITHOUT `ageBand` still validate (absence is treated
 *      as "unknown" by app logic), and rows WITH `ageBand` "minor" / "adult"
 *      validate, while any other `ageBand` value is rejected.
 *   3. Every new social table exposes an object validator that accepts a
 *      representative row and rejects rows that drop a required field or add an
 *      unknown key.
 *
 * Because the walker uses the real validator AST, a future non-additive change
 * (e.g. making a social field required on an existing table, or making
 * `users.ageBand` required) would break this test.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import schema from "../../../../convex/schema";

// ─── Minimal Convex validator walker ────────────────────────────────────────
// Mirrors Convex object-validation semantics: exact field set (no unknown keys),
// required fields must be present, optional fields may be absent/undefined.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Validator = any;

function validate(validator: Validator, value: unknown): boolean {
  switch (validator.kind) {
    case "any":
      return true;
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "float64":
      return typeof value === "number";
    case "int64":
      return typeof value === "bigint";
    case "boolean":
      return typeof value === "boolean";
    case "bytes":
      return value instanceof ArrayBuffer;
    case "id":
      return typeof value === "string";
    case "literal":
      return value === validator.value;
    case "union":
      return (validator.members as Validator[]).some((m) => validate(m, value));
    case "array":
      return (
        Array.isArray(value) &&
        value.every((el) => validate(validator.element, el))
      );
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      const fields = validator.fields as Record<string, Validator>;
      // Reject unknown keys — Convex object validators are exact.
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!(key in fields)) return false;
      }
      for (const [key, fieldValidator] of Object.entries(fields)) {
        const has = key in (value as Record<string, unknown>);
        const inner = (value as Record<string, unknown>)[key];
        if (!has || inner === undefined) {
          if (fieldValidator.isOptional !== "optional") return false;
          continue;
        }
        if (!validate(fieldValidator, inner)) return false;
      }
      return true;
    }
    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }
      return Object.entries(value as Record<string, unknown>).every(
        ([k, val]) => validate(validator.key, k) && validate(validator.value, val)
      );
    }
    default:
      throw new Error(`Unhandled validator kind: ${validator.kind}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tables = (schema as any).tables;
const usersValidator = tables.users.validator;
const callsValidator = tables.calls.validator;
const ordersValidator = tables.orders.validator;
const transcriptsValidator = tables.transcripts.validator;

// The seventeen NEW social tables (Task 1.1). Each must be present and additive.
const NEW_SOCIAL_TABLES = [
  "campusBattles",
  "campusBattleVotes",
  "campusRivalries",
  "campusChallenges",
  "campusChallengeEntries",
  "campusChallengeVotes",
  "campusShareClips",
  "campusGroupSessions",
  "campusGroupParticipants",
  "campusGroupQuestions",
  "campusGroupResponses",
  "campusStreaks",
  "campusActivityCounters",
  "campusBadges",
  "campusQuests",
  "campusQuestProgress",
  "campusCompanionInteractions",
] as const;

// The single additive field this layer adds to an existing table.
const SOCIAL_USER_FIELD = "ageBand";

// ─── Arbitraries for LEGACY rows (no social additions) ──────────────────────

const idArb = fc.string({ minLength: 1, maxLength: 40 });
const optNum = fc.option(fc.integer({ min: 0, max: 2_000_000_000 }), { nil: undefined });
const optStr = fc.option(fc.string({ maxLength: 40 }), { nil: undefined });

/**
 * A users row as it existed before the social-loops addition (never sets
 * `ageBand`). Includes the dinee-campus fields since those already shipped;
 * the point is that the social-loops change did not disturb them.
 */
const legacyUserArb = fc.record(
  {
    name: optStr,
    email: optStr,
    phone: optStr,
    isAnonymous: fc.option(fc.boolean(), { nil: undefined }),
    userId: optStr,
    role: fc.option(
      fc.constantFrom(
        "platform_admin",
        "restaurant_owner",
        "business_owner",
        "branch_manager",
        "supervisor",
        "partner",
        "student_creator"
      ),
      { nil: undefined }
    ),
    tenantType: fc.option(
      fc.constantFrom("platform", "restaurant", "business", "branch"),
      { nil: undefined }
    ),
    tenantId: optStr,
    lastLoginAt: optNum,
    createdAt: optNum,
  },
  { requiredKeys: [] }
);

const callStatusArb = fc.option(fc.constantFrom("active", "completed"), { nil: undefined });

/** A calls row (callId required); social loops adds no calls fields. */
const legacyCallArb = fc.record(
  {
    callId: idArb,
    orderId: optStr,
    restaurantId: optStr,
    branchId: optStr,
    phoneNumber: optStr,
    callStartTime: optNum,
    callEndTime: optNum,
    duration: optNum,
    status: callStatusArb,
  },
  { requiredKeys: ["callId"] }
);

/** A minimal transcripts row; social loops adds no transcripts fields. */
const legacyTranscriptArb = fc.record(
  {
    callId: idArb,
    dialogue: fc.string({ maxLength: 200 }),
    speaker: fc.constantFrom("human", "ai"),
  },
  { requiredKeys: ["callId", "dialogue", "speaker"] }
);

/** A minimal orders row; social loops adds no orders fields. */
const legacyOrderArb = fc.record(
  {
    orderId: idArb,
    restaurantId: idArb,
    customerName: fc.string({ maxLength: 40 }),
    items: fc.array(
      fc.record({
        name: fc.string({ maxLength: 30 }),
        quantity: fc.integer({ min: 1, max: 20 }),
        price: fc.integer({ min: 0, max: 100000 }),
      }),
      { maxLength: 5 }
    ),
    status: fc.constantFrom("active", "preparing", "ready", "completed", "cancelled"),
  },
  { requiredKeys: ["orderId", "restaurantId", "customerName", "items", "status"] }
);

// ─── Representative rows for each NEW social table ──────────────────────────
// Minimal valid rows (required fields only, optionals omitted). Kept as a map so
// each is validated against its own real table validator.

const REPRESENTATIVE_SOCIAL_ROWS: Record<string, Record<string, unknown>> = {
  campusBattles: {
    battleId: "b1",
    campusTag: "mit",
    format: "roast_battle",
    participants: [
      { agentId: "a1", ownerId: "o1" },
      { agentId: "a2", ownerId: "o2" },
    ],
    status: "open",
    ageAppropriateFor: ["adult"],
    createdAt: 1_700_000_000_000,
  },
  campusBattleVotes: {
    battleId: "b1",
    voterKey: "hash-v1",
    choiceAgentId: "a1",
    updatedAt: 1_700_000_000_000,
  },
  campusRivalries: {
    pairKey: "a1|a2",
    agentAId: "a1",
    agentBId: "a2",
    aWins: 2,
    bWins: 1,
    ties: 0,
    battleCount: 3,
    updatedAt: 1_700_000_000_000,
  },
  campusChallenges: {
    challengeId: "c1",
    campusTag: "mit",
    day: "2024-01-15",
    prompt: "best freshman advice",
    submissionOpensAt: 1_700_000_000_000,
    submissionClosesAt: 1_700_086_400_000,
    votingOpensAt: 1_700_086_400_000,
    votingClosesAt: 1_700_172_800_000,
    status: "submitting",
    ageAppropriateFor: ["minor", "adult"],
    createdAt: 1_700_000_000_000,
  },
  campusChallengeEntries: {
    entryId: "e1",
    challengeId: "c1",
    agentId: "a1",
    ownerId: "o1",
    submittedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
  },
  campusChallengeVotes: {
    challengeId: "c1",
    voterKey: "hash-v1",
    entryId: "e1",
    updatedAt: 1_700_000_000_000,
  },
  campusShareClips: {
    shareClipId: "sc1",
    sourceCallId: "call1",
    agentId: "a1",
    ownerId: "o1",
    durationSec: 15,
    hasCaptions: true,
    formats: ["tiktok", "reels", "snap"],
    label: "AI voice agent",
    status: "available",
    createdAt: 1_700_000_000_000,
  },
  campusGroupSessions: {
    sessionId: "s1",
    agentId: "a1",
    ownerId: "o1",
    token: "high-entropy-token",
    status: "open",
    participantCount: 0,
    createdAt: 1_700_000_000_000,
  },
  campusGroupParticipants: {
    sessionId: "s1",
    participantKey: "hash-p1",
    joinedAt: 1_700_000_000_000,
  },
  campusGroupQuestions: {
    questionId: "q1",
    sessionId: "s1",
    participantKey: "hash-p1",
    body: "what events are happening this week?",
    status: "accepted",
    createdAt: 1_700_000_000_000,
  },
  campusGroupResponses: {
    responseId: "r1",
    questionId: "q1",
    sessionId: "s1",
    agentId: "a1",
    kind: "voice_note",
    createdAt: 1_700_000_000_000,
  },
  campusStreaks: {
    userId: "u1",
    kind: "creator",
    count: 5,
    updatedAt: 1_700_000_000_000,
  },
  campusActivityCounters: {
    userId: "u1",
    activityType: "calls_received",
    count: 12,
    updatedAt: 1_700_000_000_000,
  },
  campusBadges: {
    userId: "u1",
    badgeKey: "first_battle_win",
    category: "creator",
    awardedAt: 1_700_000_000_000,
  },
  campusQuests: {
    questId: "quest1",
    offeringAgentId: "a1",
    title: "Find the best study spot",
    steps: [
      { stepId: "st1", order: 0, description: "Ask a campus guide agent" },
    ],
    ageAppropriateFor: ["minor", "adult"],
    createdAt: 1_700_000_000_000,
  },
  campusQuestProgress: {
    progressId: "qp1",
    questId: "quest1",
    userId: "u1",
    steps: [{ stepId: "st1", complete: false }],
    completed: false,
    createdAt: 1_700_000_000_000,
  },
  campusCompanionInteractions: {
    userId: "u1",
    agentId: "a1",
    cumulativeMs: 0,
    breaksShown: 0,
    updatedAt: 1_700_000_000_000,
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("campus-social-loops schema additivity — existing tables unchanged", () => {
  it("sanity: existing tables still expose object validators", () => {
    expect(usersValidator.kind).toBe("object");
    expect(callsValidator.kind).toBe("object");
    expect(ordersValidator.kind).toBe("object");
    expect(transcriptsValidator.kind).toBe("object");
  });

  it("legacy users rows (no ageBand) still validate", () => {
    fc.assert(
      fc.property(legacyUserArb, (row) => {
        // Guard: the generated legacy row carries none of the social additions.
        expect(SOCIAL_USER_FIELD in row).toBe(false);
        expect(validate(usersValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("legacy calls rows still validate (social loops adds no calls fields)", () => {
    fc.assert(
      fc.property(legacyCallArb, (row) => {
        expect(validate(callsValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("legacy orders rows still validate (social loops adds no orders fields)", () => {
    fc.assert(
      fc.property(legacyOrderArb, (row) => {
        expect(validate(ordersValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("legacy transcripts rows still validate (social loops adds no transcripts fields)", () => {
    fc.assert(
      fc.property(legacyTranscriptArb, (row) => {
        expect(validate(transcriptsValidator, row)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("base tables still reject unknown keys (validators did not turn permissive)", () => {
    expect(validate(usersValidator, { userId: "u1", notAField: true })).toBe(false);
    expect(validate(callsValidator, { callId: "c1", notAField: 1 })).toBe(false);
  });
});

describe("campus-social-loops schema additivity — users.ageBand is additive", () => {
  const ageBandValidator = usersValidator.fields.ageBand;

  it("ageBand is present on users and is an optional union", () => {
    expect(ageBandValidator).toBeDefined();
    expect(ageBandValidator.isOptional).toBe("optional");
  });

  it("a users row omitting ageBand validates (absence treated as unknown)", () => {
    expect(validate(usersValidator, { userId: "u1" })).toBe(true);
    // undefined is also accepted for an optional field.
    expect(validate(usersValidator, { userId: "u1", ageBand: undefined })).toBe(true);
  });

  it("ageBand accepts exactly 'minor' and 'adult'", () => {
    expect(validate(ageBandValidator, "minor")).toBe(true);
    expect(validate(ageBandValidator, "adult")).toBe(true);
    expect(validate(usersValidator, { userId: "u1", ageBand: "minor" })).toBe(true);
    expect(validate(usersValidator, { userId: "u1", ageBand: "adult" })).toBe(true);
  });

  it("any other ageBand value is rejected (union is not permissive)", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => s !== "minor" && s !== "adult"),
        (badBand) => {
          expect(validate(ageBandValidator, badBand)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("campus-social-loops schema additivity — new social tables are present & valid", () => {
  it("all seventeen new social tables are defined with object validators", () => {
    for (const name of NEW_SOCIAL_TABLES) {
      expect(tables[name], `table ${name} should be defined`).toBeDefined();
      expect(tables[name].validator.kind, `table ${name} should be an object`).toBe(
        "object"
      );
    }
  });

  it("every new social table accepts its representative row", () => {
    for (const name of NEW_SOCIAL_TABLES) {
      const row = REPRESENTATIVE_SOCIAL_ROWS[name];
      expect(row, `missing representative row for ${name}`).toBeDefined();
      expect(validate(tables[name].validator, row), `${name} rejected a valid row`).toBe(
        true
      );
    }
  });

  it("new social tables reject an unknown key (validators are exact)", () => {
    for (const name of NEW_SOCIAL_TABLES) {
      const row = { ...REPRESENTATIVE_SOCIAL_ROWS[name], notAField: "x" };
      expect(validate(tables[name].validator, row), `${name} accepted unknown key`).toBe(
        false
      );
    }
  });

  it("new social tables reject a row missing a required field", () => {
    for (const name of NEW_SOCIAL_TABLES) {
      const validator = tables[name].validator;
      const requiredKeys = Object.entries(validator.fields as Record<string, Validator>)
        .filter(([, f]) => (f as Validator).isOptional !== "optional")
        .map(([k]) => k);
      // Only meaningful if the table has at least one required field.
      if (requiredKeys.length === 0) continue;
      const dropKey = requiredKeys[0];
      const row = { ...REPRESENTATIVE_SOCIAL_ROWS[name] };
      delete row[dropKey];
      expect(
        validate(validator, row),
        `${name} accepted a row missing required '${dropKey}'`
      ).toBe(false);
    }
  });
});
