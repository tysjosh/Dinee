// Feature: dinee-campus, Property 14: Call-link slugs are unique and round-trip to their agent
/**
 * Property 14: Call-link slugs are unique and round-trip to their agent
 *
 * Validates: Requirements 6.8, 7.1
 *
 * For any set of published agents, the generated Call_Link slugs are pairwise
 * unique, and for each agent, resolving its slug (and its built Call_Link)
 * returns that same agent. Exercises the pure slug core:
 * assignSlugs, generateUniqueSlug, resolveSlug, and buildCallLink.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  assignSlugs,
  generateUniqueSlug,
  resolveSlug,
  buildCallLink,
  CAMPUS_AGENT_PATH_PREFIX,
  type AgentSlugInput,
} from "../../../convex/campus/logic/share";

// --- Arbitraries ---

/**
 * Agent names spanning clean names, names that slugify to identical bases
 * (forcing collisions), punctuation-only names (empty base -> fallback), and
 * unicode. This deliberately stresses the collision-disambiguation path.
 */
const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom(
    "Study Buddy",
    "study buddy",
    "STUDY  BUDDY",
    "Study-Buddy!!!",
    "!!!",
    "...",
    "   ",
    "café ☕",
    "北京 guide",
    "Ada",
    "ada",
    "ADA"
  )
);

/**
 * A set of agents with pairwise-unique agent ids (a Campus_Agent's public id is
 * unique). Names may freely collide so slug disambiguation is exercised.
 */
const agentsArb: fc.Arbitrary<AgentSlugInput[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
    minLength: 1,
    maxLength: 25,
    selector: (id) => id,
  })
  .chain((ids) =>
    fc.tuple(...ids.map(() => nameArb)).map((names) =>
      ids.map((agentId, i) => ({ agentId, name: names[i] }))
    )
  );

const baseUrlArb = fc.constantFrom(
  "https://dinee.app",
  "https://dinee.app/",
  "https://dinee.app///",
  "http://localhost:3000"
);

describe("Property 14: Call-link slugs are unique and round-trip to their agent", () => {
  it("assigns pairwise-unique slugs across the agent set", () => {
    fc.assert(
      fc.property(agentsArb, (agents) => {
        const assigned = assignSlugs(agents);

        // One slug produced per agent, preserving agent ids.
        expect(assigned.length).toBe(agents.length);
        expect(assigned.map((a) => a.agentId)).toEqual(agents.map((a) => a.agentId));

        // Slugs are pairwise unique (Req 7.1).
        const slugs = assigned.map((a) => a.slug);
        expect(new Set(slugs).size).toBe(slugs.length);

        // No slug is empty.
        for (const slug of slugs) {
          expect(slug.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("round-trips: resolving each assigned slug returns that same agent", () => {
    fc.assert(
      fc.property(agentsArb, (agents) => {
        const assigned = assignSlugs(agents);

        for (const entry of assigned) {
          const resolved = resolveSlug(entry.slug, assigned);
          expect(resolved).toBeDefined();
          // Slug maps back to exactly its owning agent (Req 6.8).
          expect(resolved!.agentId).toBe(entry.agentId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("round-trips through the built Call_Link URL back to the owning agent", () => {
    fc.assert(
      fc.property(agentsArb, baseUrlArb, (agents, baseUrl) => {
        const assigned = assignSlugs(agents);

        for (const entry of assigned) {
          const callLink = buildCallLink(entry.slug, baseUrl);

          // The Call_Link embeds the agent's slug under the campus profile path.
          expect(callLink.endsWith(`${CAMPUS_AGENT_PATH_PREFIX}${entry.slug}`)).toBe(true);

          // Extracting the slug from the Call_Link resolves to the same agent (Req 7.1, 6.8).
          const extractedSlug = callLink.slice(
            callLink.indexOf(CAMPUS_AGENT_PATH_PREFIX) + CAMPUS_AGENT_PATH_PREFIX.length
          );
          expect(extractedSlug).toBe(entry.slug);
          expect(resolveSlug(extractedSlug, assigned)!.agentId).toBe(entry.agentId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("generateUniqueSlug never returns a slug already in the used set", () => {
    fc.assert(
      fc.property(
        fc.record({ agentId: fc.string({ minLength: 1, maxLength: 12 }), name: nameArb }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 30 }),
        (agent, existing) => {
          const used = new Set(existing);
          const slug = generateUniqueSlug(agent, used);
          expect(used.has(slug)).toBe(false);
          expect(slug.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("is deterministic — assigning the same agent set twice yields identical slugs", () => {
    fc.assert(
      fc.property(agentsArb, (agents) => {
        expect(assignSlugs(agents)).toEqual(assignSlugs(agents));
      }),
      { numRuns: 100 }
    );
  });
});
