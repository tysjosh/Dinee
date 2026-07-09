// Feature: dinee-campus, Property 12: Remix control presence tracks the remix flag
/**
 * Property 12: Remix control presence tracks the remix flag
 *
 * Validates: Requirements 6.5
 *
 * For any agent, the Agent_Profile_Page presents a remix control if and only if
 * the agent has the remix option enabled. Exercises the pure profile core:
 * hasRemixControl (the direct predicate) and projectPublicProfile (whose
 * hasRemixControl field the Agent_Profile_Page renders the control from).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  hasRemixControl,
  projectPublicProfile,
  type AgentProfileInput,
  type AgentType,
} from "../../../convex/campus/logic/access";

// --- Arbitraries ---

const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent"
);

/**
 * The remix flag as it can appear on a stored agent: explicitly enabled,
 * explicitly disabled, or absent (a missing flag is treated as disabled per
 * Req 6.5).
 */
const remixEnabledArb: fc.Arbitrary<boolean | undefined> = fc.constantFrom(
  true,
  false,
  undefined
);

/**
 * A full profile input, with every other field varied freely so the remix
 * conclusion is shown to depend on the remix flag alone.
 */
const agentArb: fc.Arbitrary<AgentProfileInput> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ maxLength: 40 }),
  creatorDisplayName: fc.string({ maxLength: 40 }),
  campusTag: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  agentType: agentTypeArb,
  description: fc.string({ maxLength: 400 }),
  previewPrompts: fc.array(fc.string({ maxLength: 60 }), { maxLength: 10 }),
  remixEnabled: remixEnabledArb,
});

describe("Property 12: Remix control presence tracks the remix flag", () => {
  it("hasRemixControl is true iff the remix option is enabled", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        // Presence of the control iff the flag is exactly enabled (Req 6.5).
        expect(hasRemixControl(agent)).toBe(agent.remixEnabled === true);
      }),
      { numRuns: 100 }
    );
  });

  it("the projected profile's remix control tracks the flag", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        const profile = projectPublicProfile(agent);
        // The Agent_Profile_Page renders the control from this field, so it
        // must equal the remix flag's enabled state (Req 6.5).
        expect(profile.hasRemixControl).toBe(agent.remixEnabled === true);
        expect(profile.hasRemixControl).toBe(hasRemixControl(agent));
      }),
      { numRuns: 100 }
    );
  });

  it("is a strict biconditional: enabled shows the control, disabled/absent hides it", () => {
    fc.assert(
      fc.property(agentArb, (agent) => {
        if (agent.remixEnabled === true) {
          expect(hasRemixControl(agent)).toBe(true);
        } else {
          // Both explicit `false` and an absent flag withhold the control.
          expect(hasRemixControl(agent)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
