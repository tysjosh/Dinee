// Feature: dinee-campus, Property 4: Template library has exactly one well-formed template per type
//
// Validates: Requirements 3.1, 3.2
//
// Req 3.1: THE Template_Library SHALL provide exactly one template for each of
// the seven Agent_Types: AI Twin, Study Agent, Club Agent, Campus Guide, Funny
// Character, Tutor Agent, and Advice Agent.
// Req 3.2: THE Template_Library SHALL populate each template with a preset
// personality/tone value, at least 3 preset preview prompt examples, and at
// least 1 Knowledge_Source guidance entry that references only concepts defined
// for that template's Agent_Type.
//
// This property exercises the pure Template_Library core: for every Agent_Type
// (drawn from the canonical AGENT_TYPES list, including advice_agent) exactly one
// well-formed template must exist, where "well-formed" means a non-empty
// personality/tone, >=3 preview prompts, and >=1 knowledge-guidance entry.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CAMPUS_TEMPLATES,
  AGENT_TYPES,
  getTemplate,
  listTemplates,
  type AgentType,
  type CampusTemplate,
} from "../../../convex/campus/logic/templates";

/** An Agent_Type drawn from the canonical seven (Req 3.1). */
const agentTypeArb: fc.Arbitrary<AgentType> = fc.constantFrom(...AGENT_TYPES);

/** Asserts a template is well-formed per Req 3.2. */
function expectWellFormed(template: CampusTemplate, agentType: AgentType): void {
  // Exactly the requested type.
  expect(template.agentType).toBe(agentType);
  // Non-empty personality/tone.
  expect(typeof template.personalityTone).toBe("string");
  expect(template.personalityTone.trim().length).toBeGreaterThan(0);
  // At least 3 preview prompts, each a non-empty string.
  expect(Array.isArray(template.previewPrompts)).toBe(true);
  expect(template.previewPrompts.length).toBeGreaterThanOrEqual(3);
  for (const prompt of template.previewPrompts) {
    expect(typeof prompt).toBe("string");
    expect(prompt.trim().length).toBeGreaterThan(0);
  }
  // At least 1 knowledge-guidance entry, each a non-empty string.
  expect(Array.isArray(template.knowledgeGuidance)).toBe(true);
  expect(template.knowledgeGuidance.length).toBeGreaterThanOrEqual(1);
  for (const guidance of template.knowledgeGuidance) {
    expect(typeof guidance).toBe("string");
    expect(guidance.trim().length).toBeGreaterThan(0);
  }
}

describe("Property 4: Template library has exactly one well-formed template per type", () => {
  it("exactly one well-formed template exists for every Agent_Type", () => {
    fc.assert(
      fc.property(agentTypeArb, (agentType) => {
        // getTemplate resolves to a single entry for the type (Req 3.1)...
        const template = getTemplate(agentType);
        expect(template).toBeDefined();

        // ...and listTemplates contains exactly one template for this type.
        const matches = listTemplates().filter((t) => t.agentType === agentType);
        expect(matches.length).toBe(1);
        expect(matches[0]).toEqual(template);

        // The single template is well-formed (Req 3.2).
        expectWellFormed(template, agentType);
      }),
      { numRuns: 100 }
    );
  });

  it("the library covers all seven Agent_Types with exactly seven templates", () => {
    // Req 3.1: exactly one template per type across all seven types, no more.
    expect(AGENT_TYPES.length).toBe(7);
    expect(AGENT_TYPES).toContain("advice_agent" as AgentType);

    const all = listTemplates();
    expect(all.length).toBe(7);

    // Every canonical type is represented exactly once and every template's
    // type is one of the canonical seven (no stray or duplicate entries).
    const typeCounts = new Map<AgentType, number>();
    for (const template of all) {
      expect(AGENT_TYPES).toContain(template.agentType);
      typeCounts.set(
        template.agentType,
        (typeCounts.get(template.agentType) ?? 0) + 1
      );
    }
    for (const type of AGENT_TYPES) {
      expect(typeCounts.get(type)).toBe(1);
    }

    // The record keys match the canonical type set exactly.
    expect(Object.keys(CAMPUS_TEMPLATES).sort()).toEqual([...AGENT_TYPES].sort());
  });

  it("every template in the record is well-formed, including advice_agent", () => {
    // Exhaustive cross-check complementing the randomized property (Req 3.2).
    for (const type of AGENT_TYPES) {
      expectWellFormed(CAMPUS_TEMPLATES[type], type);
    }
    // advice_agent explicitly called out by the task.
    expectWellFormed(CAMPUS_TEMPLATES.advice_agent, "advice_agent");
  });
});
