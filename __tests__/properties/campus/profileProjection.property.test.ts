// Feature: dinee-campus, Property 11: Public profile projection is complete and bounded
/**
 * Feature: dinee-campus, Property 11: Public profile projection is complete and bounded
 *
 * **Validates: Requirements 6.1, 6.4**
 *
 * For any agent whose status is published and visibility is public, the public
 * profile projection SHALL include the agent name, visual identity, creator
 * display name, campus tag, agent type, and a description of at most 280
 * characters (Req 6.1), and SHALL present between 1 and 5 preview prompts — the
 * displayed count equals clamp(N, 1, 5) of the agent's prompts (Req 6.4).
 *
 * The pure functions under test are {@link projectPublicProfile},
 * {@link deriveVisualIdentity}, {@link clamp}, and the {@link DESCRIPTION_MAX},
 * {@link PREVIEW_PROMPTS_MIN}, {@link PREVIEW_PROMPTS_MAX} bounds.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  projectPublicProfile,
  deriveVisualIdentity,
  clamp,
  DESCRIPTION_MAX,
  PREVIEW_PROMPTS_MIN,
  PREVIEW_PROMPTS_MAX,
  type AgentType,
  type CampusAgentRecord,
} from "../../../convex/campus/logic/access";

// --- Arbitraries ---

/** The seven Agent_Types (Req 2.3). */
const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom<AgentType>(
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent"
);

/**
 * Descriptions spanning both sides of the 280-char bound so the truncation is
 * exercised for short (kept intact) and long (truncated) inputs.
 */
const descriptionArb: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: DESCRIPTION_MAX * 2 + 20,
});

/**
 * A published agent presents its preview prompts, so the valid input space has
 * at least one prompt (publishing sources them from a template that carries
 * ≥3). The upper bound comfortably exceeds PREVIEW_PROMPTS_MAX so the clamp at 5
 * is exercised.
 */
const previewPromptsArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 60 }),
  { minLength: 1, maxLength: 12 }
);

/**
 * A published, public Campus_Agent record — the scope of Property 11. A single
 * stored record satisfies both the access gate and the projection.
 */
const publishedPublicAgentArb: fc.Arbitrary<CampusAgentRecord> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 24 }),
  ownerId: fc.string({ minLength: 1, maxLength: 24 }),
  status: fc.constant("published" as const),
  visibility: fc.constant("public" as const),
  // Names may carry leading whitespace so the monogram derivation is exercised.
  name: fc
    .tuple(
      fc
        .array(fc.constantFrom(" ", "\t"), { maxLength: 3 })
        .map((chars) => chars.join("")),
      fc.string({ minLength: 1, maxLength: 40 })
    )
    .map(([lead, rest]) => lead + rest),
  creatorDisplayName: fc.string({ minLength: 1, maxLength: 40 }),
  campusTag: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
    nil: undefined,
  }),
  agentType: agentTypeArb,
  description: descriptionArb,
  previewPrompts: previewPromptsArb,
  remixEnabled: fc.boolean(),
});

describe("Property 11: Public profile projection is complete and bounded", () => {
  it("includes every public field and bounds description + preview prompts", () => {
    fc.assert(
      fc.property(publishedPublicAgentArb, (agent) => {
        const projection = projectPublicProfile(agent);

        // --- Completeness (Req 6.1): every public field is present ---
        expect(projection.name).toBe(agent.name);
        expect(projection.creatorDisplayName).toBe(agent.creatorDisplayName);
        expect(projection.campusTag).toBe(agent.campusTag ?? "");
        expect(projection.agentType).toBe(agent.agentType);
        expect(projection.hasRemixControl).toBe(agent.remixEnabled === true);

        // Visual identity is present and derived deterministically.
        expect(projection.visualIdentity).toEqual(deriveVisualIdentity(agent));
        expect(typeof projection.visualIdentity.initial).toBe("string");
        expect(projection.visualIdentity.colorSeed).toBe(agent.agentId);

        // --- Description bounded to at most 280 chars (Req 6.1) ---
        expect(projection.description.length).toBeLessThanOrEqual(
          DESCRIPTION_MAX
        );
        expect(projection.description).toBe(
          agent.description.slice(0, DESCRIPTION_MAX)
        );

        // --- Preview prompts: displayed count equals clamp(N, 1, 5) (Req 6.4) ---
        const expectedCount = clamp(
          agent.previewPrompts.length,
          PREVIEW_PROMPTS_MIN,
          PREVIEW_PROMPTS_MAX
        );
        expect(projection.previewPrompts.length).toBe(expectedCount);
        expect(projection.previewPrompts.length).toBeGreaterThanOrEqual(
          PREVIEW_PROMPTS_MIN
        );
        expect(projection.previewPrompts.length).toBeLessThanOrEqual(
          PREVIEW_PROMPTS_MAX
        );

        // The presented prompts are the leading prefix of the agent's prompts.
        expect(projection.previewPrompts).toEqual(
          agent.previewPrompts.slice(0, expectedCount)
        );
      }),
      { numRuns: 100 }
    );
  });
});
