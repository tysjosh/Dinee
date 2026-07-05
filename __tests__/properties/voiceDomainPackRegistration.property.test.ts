/**
 * Feature: dinee-voice-platform, Property 1: VoiceDomainPack registration validation
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.3
 *
 * Generate packs whose field bounds are independently mutated (id length,
 * name length, description length, conversation-type count, tool count, and
 * phase count). The registry SHALL accept a pack if and only if every bound
 * holds; otherwise it SHALL reject the registration, name the offending field
 * in the error, and leave the set of registered packs unchanged.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  VoiceDomainPack,
  ConversationTypeDefinition,
  VoiceToolDefinition,
  CallPhaseDefinition,
} from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  resolvePackByConversationType,
  clearRegistry,
  type RegistrationError,
} from "../../src/lib/modules/voiceDomainPackRegistry";

// Field bounds mirrored from the registry (Req 2.1, 2.4).
const ID_MAX = 64;
const NAME_MAX = 128;
const DESCRIPTION_MAX = 1024;
const CONVERSATION_TYPES_MAX = 50;
const TOOLS_MAX = 100;
const PHASES_MIN = 1;
const PHASES_MAX = 20;

// A valid sentinel pack we register first so we can assert the registry is
// left unchanged when a candidate registration is rejected.
const SENTINEL_CONV = "sentinel_conv";
const SENTINEL_ID = "sentinel_pack";

function sentinelPack(): VoiceDomainPack {
  return buildPack({
    id: SENTINEL_ID,
    convType: SENTINEL_CONV,
    idLen: SENTINEL_ID.length,
    nameLen: 4,
    descLen: 8,
    numConvTypes: 1,
    numTools: 1,
    numPhases: 1,
  });
}

interface PackShape {
  id?: string;
  convType?: string;
  idLen: number;
  nameLen: number;
  descLen: number;
  numConvTypes: number;
  numTools: number;
  numPhases: number;
}

/**
 * Builds a pack whose internal references are always consistent (tools and
 * conversation types reference `phase_0` whenever at least one phase exists),
 * so that the ONLY thing deciding validity is the bound under test.
 */
function buildPack(shape: PackShape): VoiceDomainPack {
  const phases: CallPhaseDefinition[] = Array.from(
    { length: Math.max(shape.numPhases, 0) },
    (_unused, index) => ({ id: `phase_${index}`, transitions: [] })
  );
  const referencePhase = phases.length > 0 ? phases[0].id : "phase_0";

  const tools: VoiceToolDefinition[] = Array.from(
    { length: Math.max(shape.numTools, 0) },
    (_unused, index) => ({
      name: `tool_${index}`,
      description: "d",
      parameters: { type: "object" },
      allowedPhases: [referencePhase],
      readOnly: true,
      handler: `handler_${index}`,
    })
  );

  const baseConv = shape.convType ?? "candidate_conv";
  const conversationTypes: ConversationTypeDefinition[] = Array.from(
    { length: Math.max(shape.numConvTypes, 0) },
    (_unused, index) => ({
      type: index === 0 ? baseConv : `${baseConv}_${index}`,
      initialPhase: referencePhase,
      transcriptMetadata: { fields: {} },
      fallbackBehavior: { kind: "apologize_and_end" },
    })
  );

  return {
    id: shape.id ?? "a".repeat(shape.idLen),
    name: "n".repeat(shape.nameLen),
    description: "d".repeat(shape.descLen),
    conversationTypes,
    tools,
    phases,
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
  };
}

/**
 * Computes the expected first-failing validation error following the registry's
 * documented validation order, or `null` when the pack is valid.
 */
function expectedError(shape: PackShape): RegistrationError | null {
  // 1. id present, 1–64 chars → invalid_id.
  if (shape.idLen < 1 || shape.idLen > ID_MAX) {
    return { code: "invalid_id", detail: "id" };
  }
  // (2. duplicate_id — not applicable: candidate id is unique here.)
  // 3. field bounds.
  if (shape.nameLen < 1) {
    return { code: "missing_field", detail: "name" };
  }
  if (shape.nameLen > NAME_MAX) {
    return { code: "field_out_of_bounds", detail: "name" };
  }
  if (shape.descLen > DESCRIPTION_MAX) {
    return { code: "field_out_of_bounds", detail: "description" };
  }
  if (shape.numConvTypes < 1 || shape.numConvTypes > CONVERSATION_TYPES_MAX) {
    return { code: "field_out_of_bounds", detail: "conversationTypes" };
  }
  if (shape.numTools > TOOLS_MAX) {
    return { code: "field_out_of_bounds", detail: "tools" };
  }
  if (shape.numPhases < PHASES_MIN || shape.numPhases > PHASES_MAX) {
    return { code: "field_out_of_bounds", detail: "phases" };
  }
  return null;
}

// Generators that straddle each bound (invalid-low, valid, invalid-high).
const shapeArb: fc.Arbitrary<PackShape> = fc.record({
  idLen: fc.integer({ min: 0, max: 70 }),
  nameLen: fc.integer({ min: 0, max: 135 }),
  descLen: fc.integer({ min: 0, max: 1030 }),
  numConvTypes: fc.integer({ min: 0, max: 53 }),
  numTools: fc.integer({ min: 0, max: 103 }),
  numPhases: fc.integer({ min: 0, max: 23 }),
});

describe("Property 1: VoiceDomainPack registration validation", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("accepts iff every bound holds; rejection names the offending field and leaves the registry unchanged", () => {
    fc.assert(
      fc.property(shapeArb, (shape) => {
        clearRegistry();

        // Register a valid sentinel so we can prove the registry is unchanged
        // when the candidate is rejected.
        const sentinel = sentinelPack();
        expect(registerVoiceDomainPack(sentinel).ok).toBe(true);

        const candidate = buildPack(shape);
        const expected = expectedError(shape);
        const result = registerVoiceDomainPack(candidate);

        // Accept iff all bounds hold.
        expect(result.ok).toBe(expected === null);

        if (!result.ok) {
          // Rejection names the offending field.
          expect(result.error.code).toBe(expected!.code);
          expect(result.error.detail).toBe(expected!.detail);

          // Registry unchanged: candidate not added, sentinel intact.
          expect(resolvePackByConversationType("candidate_conv")).toBeNull();
          expect(resolvePackByConversationType(SENTINEL_CONV)).toBe(sentinel);
        } else {
          // Accepted packs become resolvable by their conversation type.
          expect(resolvePackByConversationType("candidate_conv")).toBe(
            candidate
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
