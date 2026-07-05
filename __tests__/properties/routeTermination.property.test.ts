// Feature: dinee-voice-platform, Property 5: Unresolved route terminates the call without a session
//
// Validates: Requirements 1.11, 3.5, 4.6
//
// When a call cannot be routed to a registered VoiceDomainPack, prepareSession
// must return a `terminate` decision (never `start`) and record an audit entry:
//   - an empty conversation type (the called number mapped to no route) yields
//     `no_mapping` with an audit carrying the called number (toNumber) + call id
//     (Req 1.11, 4.6);
//   - a conversation type owned by no registered pack yields `no_pack` with an
//     audit carrying the unresolved conversation type + call id (Req 3.5).
// In neither case is a Realtime session started.
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { VoiceDomainPack } from "../../src/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  clearRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import {
  prepareSession,
  type ResolvedCallContext,
} from "../../src/app/ws-server/runtime/session";

// A round-robin partition guarantees each pack owns at least one conversation
// type (Req 2.1 lower bound) and the owned sets are pairwise disjoint.
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

// Generated conversation types are <= 12 chars, so this sentinel is never
// generated and is therefore owned by no registered pack.
const UNOWNED_TYPE = "zzz_unowned_conversation_type_never_registered_zzz";

// A context with a non-empty conversation type; the caller fields are arbitrary.
const ctxArb = (conversationType: string): fc.Arbitrary<ResolvedCallContext> =>
  fc.record({
    callSid: fc.string({ minLength: 1, maxLength: 24 }),
    fromNumber: fc.string({ maxLength: 16 }),
    toNumber: fc.string({ minLength: 1, maxLength: 16 }),
    tenantId: fc.string({ maxLength: 16 }),
    conversationType: fc.constant(conversationType),
    enabledIntegrations: fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
  });

describe("Property 5: Unresolved route terminates the call without a session", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("empty conversation type terminates with no_mapping (toNumber + callId), never start", () => {
    fc.assert(
      fc.property(ctxArb(""), (base) => {
        clearRegistry();
        const ctx: ResolvedCallContext = { ...base, conversationType: "" };

        const result = prepareSession(ctx);

        // Never starts a session (Req 1.11, 4.6).
        expect(result.kind).toBe("terminate");
        if (result.kind !== "terminate") return;

        expect(result.reason).toBe("no_mapping");
        expect(result.audit.event).toBe("route_terminated");
        expect(result.audit.reason).toBe("no_mapping");
        // Audit carries the called number and the call id (Req 4.6).
        expect(result.audit.toNumber).toBe(ctx.toNumber);
        expect(result.audit.callId).toBe(ctx.callSid);
      }),
      { numRuns: 100 }
    );
  });

  it("conversation type owned by no pack terminates with no_pack (conversationType + callId), never start", () => {
    const scenarioArb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 0,
        maxLength: 10,
      })
      .chain((ownedTypes) =>
        fc
          .integer({ min: 1, max: Math.max(1, Math.min(4, ownedTypes.length || 1)) })
          .chain((numPacks) =>
            ctxArb(UNOWNED_TYPE).map((ctx) => ({ ownedTypes, numPacks, ctx }))
          )
      );

    fc.assert(
      fc.property(scenarioArb, ({ ownedTypes, numPacks, ctx }) => {
        clearRegistry();

        // Register packs that own disjoint conversation types, none of which is
        // the sentinel unowned type the call is routed to.
        const groups = partition(ownedTypes, numPacks).filter(
          (group) => group.length > 0
        );
        groups.forEach((types, index) => {
          const registered = registerVoiceDomainPack(
            buildPack(`pack_${index}`, types)
          );
          expect(registered.ok).toBe(true);
        });

        const result = prepareSession(ctx);

        // Never starts a session for an unowned conversation type (Req 3.5).
        expect(result.kind).toBe("terminate");
        if (result.kind !== "terminate") return;

        expect(result.reason).toBe("no_pack");
        expect(result.audit.event).toBe("route_terminated");
        expect(result.audit.reason).toBe("no_pack");
        // Audit carries the unresolved conversation type and the call id (Req 3.5).
        expect(result.audit.conversationType).toBe(ctx.conversationType);
        expect(result.audit.callId).toBe(ctx.callSid);
      }),
      { numRuns: 100 }
    );
  });
});
