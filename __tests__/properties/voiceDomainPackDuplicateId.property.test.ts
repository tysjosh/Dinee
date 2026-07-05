/**
 * Feature: dinee-voice-platform, Property 2: Duplicate identifier rejection leaves the registry unchanged
 *
 * Validates: Requirements 2.3
 *
 * Registering a second, otherwise-valid pack whose identifier already exists
 * SHALL be rejected with a `duplicate_id` error whose detail records the
 * conflicting identifier, and the registry snapshot after the attempt SHALL
 * equal the snapshot taken before it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  VoiceDomainPack,
  ConversationTypeDefinition,
} from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  resolvePackByConversationType,
  clearRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";

/** Builds a fully-valid pack with the given id and a single owned conversation type. */
function validPack(id: string, convType: string, name: string): VoiceDomainPack {
  const conversationTypes: ConversationTypeDefinition[] = [
    {
      type: convType,
      initialPhase: "phase_0",
      transcriptMetadata: { fields: {} },
      fallbackBehavior: { kind: "apologize_and_end" },
    },
  ];
  return {
    id,
    name,
    description: "a valid pack",
    conversationTypes,
    tools: [
      {
        name: "tool_a",
        description: "d",
        parameters: { type: "object" },
        allowedPhases: ["phase_0"],
        readOnly: true,
        handler: "handler_a",
      },
    ],
    phases: [{ id: "phase_0", transitions: [] }],
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
  };
}

// id: 1–64 valid chars so the duplicate check (step 2) is what fires, not invalid_id.
const idArb = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((value) => value.length >= 1 && value.length <= 64);
const nameArb = fc.string({ minLength: 1, maxLength: 128 });

describe("Property 2: Duplicate identifier rejection leaves the registry unchanged", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("rejects a duplicate id with the conflicting id in detail and an unchanged registry", () => {
    fc.assert(
      fc.property(idArb, nameArb, nameArb, (id, firstName, secondName) => {
        clearRegistry();

        const firstConv = "first_conv";
        const secondConv = "second_conv";

        // Register the first pack — this is the pre-attempt snapshot.
        const first = validPack(id, firstConv, firstName);
        expect(registerVoiceDomainPack(first).ok).toBe(true);
        expect(resolvePackByConversationType(firstConv)).toBe(first);

        // Attempt a second, otherwise-valid pack that reuses the same id.
        const second = validPack(id, secondConv, secondName);
        const result = registerVoiceDomainPack(second);

        // Rejected as duplicate_id, detail records the conflicting id.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("duplicate_id");
          expect(result.error.detail).toBe(id);
        }

        // Registry snapshot equals before: the original pack (by reference)
        // still owns its conversation type, and the second pack was never added.
        expect(resolvePackByConversationType(firstConv)).toBe(first);
        expect(resolvePackByConversationType(secondConv)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
