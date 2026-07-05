// Feature: dinee-voice-platform, Property 4: Conversation-type resolution is unique
//
// Validates: Requirements 3.1
//
// When packs each own a disjoint set of conversation types, resolving any
// conversation type returns exactly the single pack that owns it, and resolving
// a conversation type owned by no registered pack returns null.
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { VoiceDomainPack } from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  resolvePackByConversationType,
  clearRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";

// Guaranteed to never be generated (generated types are <= 10 chars).
const UNKNOWN_TYPE = "zzz_unknown_conversation_type_never_registered_zzz";

interface Scenario {
  allTypes: string[];
  numPacks: number;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 10 }), {
    minLength: 1,
    maxLength: 12,
  })
  .chain((allTypes) =>
    fc
      .integer({ min: 1, max: Math.min(5, allTypes.length) })
      .map((numPacks) => ({ allTypes, numPacks }))
  );

// Round-robin partition. With numPacks <= allTypes.length every group is
// non-empty, so each pack owns at least one conversation type (Req 2.1 bound)
// and the sets are pairwise disjoint.
function partition<T>(items: T[], groups: number): T[][] {
  const buckets: T[][] = Array.from({ length: groups }, () => []);
  items.forEach((item, index) => buckets[index % groups].push(item));
  return buckets;
}

function buildPack(id: string, types: string[]): VoiceDomainPack {
  return {
    id,
    name: id,
    description: "",
    conversationTypes: types.map((type) => ({
      type,
      initialPhase: "p0",
      transcriptMetadata: { fields: {} },
      fallbackBehavior: { kind: "apologize_and_end" },
    })),
    tools: [],
    phases: [{ id: "p0", transitions: [] }],
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
  };
}

describe("Property 4: Conversation-type resolution is unique", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("resolves each conversation type to its single owning pack, and null for unknown types", () => {
    fc.assert(
      fc.property(scenarioArb, ({ allTypes, numPacks }) => {
        clearRegistry();

        const groups = partition(allTypes, numPacks).filter(
          (group) => group.length > 0
        );

        groups.forEach((types, index) => {
          const result = registerVoiceDomainPack(
            buildPack(`pack_${index}`, types)
          );
          expect(result.ok).toBe(true);
        });

        // Every conversation type resolves to exactly its owning pack.
        groups.forEach((types, index) => {
          for (const type of types) {
            const resolved = resolvePackByConversationType(type);
            expect(resolved).not.toBeNull();
            expect(resolved?.id).toBe(`pack_${index}`);
          }
        });

        // A conversation type owned by no pack resolves to null.
        expect(resolvePackByConversationType(UNKNOWN_TYPE)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
