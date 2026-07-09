// Feature: dinee-campus, Property 10: Session configuration and prompt reflect the agent
/**
 * Feature: dinee-campus, Property 10: Session configuration and prompt reflect the agent
 *
 * Validates: Requirements 8.3, 8.4
 *
 * Req 8.3: WHILE a voice conversation is active, THE Voice_Runtime SHALL respond
 * to the Caller in the Campus_Agent's selected voice — the assembled session
 * config's `voiceId` is exactly the agent's `voiceId`.
 *
 * Req 8.4: THE Voice_Runtime SHALL constrain the Campus_Agent's responses to its
 * configured name, purpose, Knowledge_Store content, and boundaries — the
 * assembled system prompt reflects the agent's name, its purpose, an
 * approved-knowledge summary, and a boundary instruction.
 *
 * The pure functions under test are {@link buildSessionConfig},
 * {@link assembleSystemPrompt}, and {@link summarizeKnowledge}. The generators
 * produce arbitrary agent configurations and approved-knowledge sets, and the
 * properties assert that the assembled config carries the agent's voice and
 * that the prompt embeds the agent's identity, purpose, knowledge summary, and
 * boundary instruction across all inputs.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildSessionConfig,
  assembleSystemPrompt,
  summarizeKnowledge,
  BOUNDARY_INSTRUCTION,
  type CampusAgentRuntimeConfig,
  type GroundingEntry,
} from "../../../convex/campus/logic/session";

/** A non-empty free-text arbitrary (trimmed to guarantee visible content). */
const nonEmptyTextArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 60 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** An arbitrary approved-knowledge entry. */
const groundingEntryArb: fc.Arbitrary<GroundingEntry> = fc.record(
  {
    sourceId: fc.uuid(),
    content: nonEmptyTextArb,
    keywords: fc.option(fc.array(nonEmptyTextArb, { minLength: 1, maxLength: 4 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ["sourceId", "content"] }
);

/** An arbitrary per-call Campus_Agent runtime configuration. */
const agentConfigArb: fc.Arbitrary<CampusAgentRuntimeConfig> = fc.record(
  {
    agentId: fc.uuid(),
    name: nonEmptyTextArb,
    voiceId: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.length > 0),
    purpose: nonEmptyTextArb,
    personalityTone: fc.option(nonEmptyTextArb, { nil: undefined }),
    boundaries: fc.option(nonEmptyTextArb, { nil: undefined }),
    creatorContactLink: fc.option(nonEmptyTextArb, { nil: undefined }),
  },
  { requiredKeys: ["agentId", "name", "voiceId", "purpose"] }
);

const entriesArb: fc.Arbitrary<GroundingEntry[]> = fc.array(groundingEntryArb, {
  minLength: 0,
  maxLength: 8,
});

describe("Property 10: Session configuration and prompt reflect the agent", () => {
  it("session config voice is exactly the agent's selected voice (Req 8.3)", () => {
    fc.assert(
      fc.property(agentConfigArb, entriesArb, (agent, entries) => {
        const config = buildSessionConfig(agent, entries);
        expect(config.voiceId).toBe(agent.voiceId);
        expect(config.agentId).toBe(agent.agentId);
      }),
      { numRuns: 100 }
    );
  });

  it("system prompt reflects the agent's name, purpose, knowledge summary, and boundary (Req 8.4)", () => {
    fc.assert(
      fc.property(agentConfigArb, entriesArb, (agent, entries) => {
        const config = buildSessionConfig(agent, entries);
        const prompt = config.systemPrompt;

        // Name and purpose are embedded verbatim.
        expect(prompt).toContain(agent.name);
        expect(prompt).toContain(agent.purpose);

        // The approved-knowledge summary is embedded.
        expect(prompt).toContain(summarizeKnowledge(entries));

        // The boundary instruction constraining responses is always present.
        expect(prompt).toContain(BOUNDARY_INSTRUCTION);

        // buildSessionConfig and assembleSystemPrompt agree.
        expect(prompt).toBe(assembleSystemPrompt(agent, entries));
      }),
      { numRuns: 100 }
    );
  });

  it("prompt includes every approved-knowledge entry's content when present (Req 8.4)", () => {
    fc.assert(
      fc.property(
        agentConfigArb,
        fc.array(groundingEntryArb, { minLength: 1, maxLength: 8 }),
        (agent, entries) => {
          const prompt = assembleSystemPrompt(agent, entries);
          for (const entry of entries) {
            expect(prompt).toContain(entry.content);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
