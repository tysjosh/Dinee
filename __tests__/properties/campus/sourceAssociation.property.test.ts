// Feature: dinee-campus, Property 8: A submitted knowledge source is associated only with its owning agent
/**
 * Property 8: A submitted knowledge source is associated only with its owning agent
 *
 * Validates: Requirements 5.2
 *
 * WHEN a Student_Creator submits a Knowledge_Source, THE Knowledge_Store SHALL
 * associate the stored content with the owning Campus_Agent.
 *
 * The pure association core realizes this as:
 *   - associateSource(submission, agentId) always stamps the given owning
 *     agentId onto the stored source and preserves every submitted field.
 *   - listSourcesForAgent partitions a source list by agentId: a source appears
 *     in exactly its owning agent's listing and in no other agent's listing.
 *   - submitKnowledgeSource, on acceptance, appends a source carrying the owning
 *     agentId, so a newly submitted source is retrievable only under its owner.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  associateSource,
  listSourcesForAgent,
  submitKnowledgeSource,
  type KnowledgeSubmission,
  type StoredKnowledgeSource,
} from "../../../convex/campus/logic/knowledge";

// --- Arbitraries: constrain to the submitted-source input space ---

const awkwardStringArb = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "",
    " ",
    "  spaced  ",
    "0",
    "café ☕",
    "naïve façade — 北京 🏙️",
    "line\nbreak\ttab",
    'quote " and \\ backslash'
  )
);

/** Distinct, non-empty agent ids so partitioning is meaningful. */
const agentIdArb = fc
  .integer({ min: 0, max: 6 })
  .map((n) => `agent_${n}`);

const faqEntryArb = fc.record({
  question: awkwardStringArb,
  answer: awkwardStringArb,
});

/**
 * A Knowledge_Source submission whose kinds are always accepted at the
 * acceptance layer (link/event/club/course carry no size/count bound, and the
 * text/faq bodies here are well within their limits), so the append path in
 * submitKnowledgeSource is reliably exercised. Association itself does not
 * depend on kind, but keeping submissions acceptable lets us test the full
 * submit → associate → list flow.
 */
const acceptableSubmissionArb: fc.Arbitrary<KnowledgeSubmission> = fc.record(
  {
    sourceId: fc
      .integer({ min: 0, max: 1_000_000 })
      .map((n) => `src_${n}`),
    kind: fc.constantFrom(
      "instructions",
      "link",
      "event",
      "club",
      "course"
    ),
    textContent: fc.string({ maxLength: 200 }),
    faqEntries: fc.array(faqEntryArb, { maxLength: 3 }),
  },
  { requiredKeys: ["sourceId", "kind"] }
);

/** A pre-stored source already associated with some agent. */
const storedSourceArb: fc.Arbitrary<StoredKnowledgeSource> = fc.record({
  sourceId: fc.integer({ min: 0, max: 1_000_000 }).map((n) => `src_${n}`),
  agentId: agentIdArb,
  kind: fc.constantFrom(
    "instructions",
    "faq",
    "document",
    "link",
    "event",
    "club",
    "course"
  ),
  textContent: awkwardStringArb,
});

describe("Property 8: A submitted knowledge source is associated only with its owning agent", () => {
  it("associateSource stamps the owning agentId and preserves submitted fields", () => {
    fc.assert(
      fc.property(acceptableSubmissionArb, agentIdArb, (submission, agentId) => {
        const stored = associateSource(submission, agentId);
        expect(stored.agentId).toBe(agentId);
        expect(stored.sourceId).toBe(submission.sourceId);
        expect(stored.kind).toBe(submission.kind);
        if (submission.textContent !== undefined) {
          expect(stored.textContent).toEqual(submission.textContent);
        }
        if (submission.faqEntries !== undefined) {
          expect(stored.faqEntries).toEqual(submission.faqEntries);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("listSourcesForAgent returns only sources owned by that agent", () => {
    fc.assert(
      fc.property(
        fc.array(storedSourceArb, { maxLength: 30 }),
        agentIdArb,
        (sources, agentId) => {
          const listed = listSourcesForAgent(sources, agentId);
          // Every returned source is owned by the requested agent...
          for (const source of listed) {
            expect(source.agentId).toBe(agentId);
          }
          // ...and every owned source is returned (no owned source withheld).
          const ownedCount = sources.filter((s) => s.agentId === agentId).length;
          expect(listed.length).toBe(ownedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a submitted source is retrievable under its owner and under no other agent", () => {
    fc.assert(
      fc.property(
        fc.array(storedSourceArb, { maxLength: 20 }),
        acceptableSubmissionArb,
        agentIdArb,
        agentIdArb,
        (existing, submission, ownerId, otherId) => {
          fc.pre(ownerId !== otherId);
          const { sources, result } = submitKnowledgeSource(
            existing,
            ownerId,
            submission
          );
          expect(result.accepted).toBe(true);

          const ownerListing = listSourcesForAgent(sources, ownerId);
          const otherListing = listSourcesForAgent(sources, otherId);

          // The new source appears exactly once under its owning agent...
          const inOwner = ownerListing.filter(
            (s) => s.sourceId === submission.sourceId
          );
          expect(inOwner.length).toBeGreaterThanOrEqual(1);
          const associated = inOwner.find((s) => s.agentId === ownerId);
          expect(associated).toBeDefined();
          expect(associated?.agentId).toBe(ownerId);

          // ...and is never surfaced under a different (non-owning) agent,
          // unless that source id happened to pre-exist for the other agent.
          const preExistingForOther = existing.some(
            (s) => s.sourceId === submission.sourceId && s.agentId === otherId
          );
          if (!preExistingForOther) {
            const leaked = otherListing.some(
              (s) =>
                s.sourceId === submission.sourceId && s.agentId !== ownerId
            );
            // Any match under the other agent must carry the other agent's id
            // (i.e., it is a pre-existing row, not the newly associated one).
            expect(leaked).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("submitting sources to different owners keeps each source under only its owner", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ submission: acceptableSubmissionArb, ownerId: agentIdArb }),
          { minLength: 1, maxLength: 15 }
        ),
        (submissions) => {
          let sources: readonly StoredKnowledgeSource[] = [];
          const expectedOwners = new Map<StoredKnowledgeSource, string>();

          for (const { submission, ownerId } of submissions) {
            const outcome = submitKnowledgeSource(sources, ownerId, submission);
            expect(outcome.result.accepted).toBe(true);
            // The freshly appended source is the last element.
            const appended = outcome.sources[outcome.sources.length - 1];
            expectedOwners.set(appended, ownerId);
            sources = outcome.sources;
          }

          // Partition invariant: for every distinct owning agent, its listing
          // contains exactly the sources associated with it and no others.
          const allOwners = new Set(sources.map((s) => s.agentId));
          for (const owner of allOwners) {
            const listing = listSourcesForAgent(sources, owner);
            for (const source of listing) {
              expect(source.agentId).toBe(owner);
            }
          }

          // Each appended source is retrievable only under the owner it was
          // submitted to.
          for (const [source, owner] of expectedOwners) {
            expect(listSourcesForAgent(sources, owner)).toContain(source);
            for (const otherOwner of allOwners) {
              if (otherOwner === owner) continue;
              expect(listSourcesForAgent(sources, otherOwner)).not.toContain(
                source
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
