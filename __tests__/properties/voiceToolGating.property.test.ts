/**
 * Feature: dinee-voice-platform, Property 6: Tool-call gating (membership ∧ phase)
 *
 * Validates: Requirements 3.6, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4
 *
 * `isToolCallPermitted(toolSet, toolName, phaseId)` SHALL report a tool call as
 * permitted if and only if the tool is present in the resolved tool set AND the
 * active call phase is one of that tool's `allowedPhases`. Additionally, when a
 * call is rejected by the gate, the runtime dispatch:
 *   - does NOT execute the tool (Req 3.7, 3.8, 7.4),
 *   - returns a rejection result to the Realtime_Agent (Req 3.7, 3.8),
 *   - preserves the active call phase (Req 3.7, 3.8, 7.4), and
 *   - records an audit entry containing the tool, phase, and call identifier
 *     (Req 3.7, 3.8, 7.4).
 *
 * The pure `isToolCallPermitted` invariant is tested directly. The
 * "not executed / rejection result / preserves phase / audit" behavior is
 * exercised via a small dispatch harness that mirrors the pack-driven session
 * driver's gating decision (see design "Tool-call gating at dispatch time");
 * the runtime `session.ts` is being implemented concurrently (task 3.5), so the
 * harness models the same decision against `isToolCallPermitted`.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { VoiceToolDefinition } from "../../src/lib/modules/voiceDomainPack";
import { isToolCallPermitted } from "../../src/lib/modules/voiceDomainPackRegistry";

// --- Dispatch harness (mirrors runtime/session.ts tool-call gating) ---

interface AuditRecord {
  tool: string;
  phase: string;
  callId: string;
  reason: "not_in_set" | "not_in_phase";
}

interface DispatchState {
  phase: string;
  audit: AuditRecord[];
  executed: string[];
}

interface DispatchResult {
  rejected: boolean;
  reason?: "not_in_set" | "not_in_phase";
}

/**
 * Models the driver's dispatch on a function-call event: consult the gate,
 * and on rejection do not execute, return a rejection result, preserve the
 * phase, and write an audit entry (tool, phase, callId). On permitted, invoke
 * the executor. Returns the rejection outcome for assertions.
 */
function dispatchToolCall(
  toolSet: VoiceToolDefinition[],
  toolName: string,
  callId: string,
  state: DispatchState,
  executor: (name: string) => void
): DispatchResult {
  const permission = isToolCallPermitted(toolSet, toolName, state.phase);
  if (!permission.permitted) {
    // Rejection path: do not execute, preserve phase, audit the rejection.
    state.audit.push({
      tool: toolName,
      phase: state.phase,
      callId,
      reason: permission.reason!,
    });
    return { rejected: true, reason: permission.reason };
  }
  // Permitted path: execute via the tool executor.
  executor(toolName);
  state.executed.push(toolName);
  return { rejected: false };
}

// --- Arbitraries ---

const PHASE_POOL = [
  "customer_identification",
  "order_building",
  "order_finalized",
  "unknown_phase",
];

/** A tool with a name and a subset of phase ids in which it is permitted. */
const toolArb: fc.Arbitrary<VoiceToolDefinition> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 12 }),
  description: fc.constant("desc"),
  parameters: fc.constant({ type: "object" }),
  allowedPhases: fc.subarray(PHASE_POOL, { minLength: 0 }),
  readOnly: fc.boolean(),
  handler: fc.constant("handler/key"),
});

/** A tool set with distinct names (a resolved tool set has unique tool names). */
const toolSetArb: fc.Arbitrary<VoiceToolDefinition[]> = fc
  .uniqueArray(toolArb, {
    minLength: 0,
    maxLength: 6,
    selector: (tool) => tool.name,
  });

/** A phase id: usually a known phase, sometimes an arbitrary string. */
const phaseArb = fc.oneof(
  fc.constantFrom(...PHASE_POOL),
  fc.string({ minLength: 1, maxLength: 12 })
);

/** A tool name: usually one from the set, sometimes an arbitrary string. */
function toolNameArb(toolSet: VoiceToolDefinition[]) {
  const names = toolSet.map((t) => t.name);
  if (names.length === 0) {
    return fc.string({ minLength: 1, maxLength: 12 });
  }
  return fc.oneof(
    fc.constantFrom(...names),
    fc.string({ minLength: 1, maxLength: 12 })
  );
}

describe("Property 6: Tool-call gating (membership ∧ phase)", () => {
  it("isToolCallPermitted is permitted iff tool ∈ set AND phase ∈ allowedPhases", () => {
    fc.assert(
      fc.property(
        toolSetArb.chain((toolSet) =>
          fc.tuple(
            fc.constant(toolSet),
            toolNameArb(toolSet),
            phaseArb
          )
        ),
        ([toolSet, toolName, phaseId]) => {
          const tool = toolSet.find((t) => t.name === toolName);
          const inSet = tool !== undefined;
          const inPhase = inSet && tool!.allowedPhases.includes(phaseId);
          const expectedPermitted = inSet && inPhase;

          const result = isToolCallPermitted(toolSet, toolName, phaseId);

          expect(result.permitted).toBe(expectedPermitted);
          if (expectedPermitted) {
            expect(result.reason).toBeUndefined();
          } else if (!inSet) {
            expect(result.reason).toBe("not_in_set");
          } else {
            expect(result.reason).toBe("not_in_phase");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a rejected call is not executed, returns a rejection, preserves the phase, and records an audit entry", () => {
    fc.assert(
      fc.property(
        toolSetArb.chain((toolSet) =>
          fc.tuple(
            fc.constant(toolSet),
            toolNameArb(toolSet),
            phaseArb,
            fc.string({ minLength: 1, maxLength: 16 })
          )
        ),
        ([toolSet, toolName, phaseId, callId]) => {
          const permission = isToolCallPermitted(toolSet, toolName, phaseId);

          const state: DispatchState = {
            phase: phaseId,
            audit: [],
            executed: [],
          };
          let executorCalls = 0;
          const executor = () => {
            executorCalls += 1;
          };

          const result = dispatchToolCall(
            toolSet,
            toolName,
            callId,
            state,
            executor
          );

          if (!permission.permitted) {
            // Rejection contract (Req 3.7, 3.8, 7.4).
            expect(result.rejected).toBe(true);
            expect(result.reason).toBe(permission.reason);
            // Not executed.
            expect(executorCalls).toBe(0);
            expect(state.executed).toEqual([]);
            // Phase preserved.
            expect(state.phase).toBe(phaseId);
            // Audit entry with tool, phase, callId.
            expect(state.audit).toHaveLength(1);
            expect(state.audit[0]).toEqual({
              tool: toolName,
              phase: phaseId,
              callId,
              reason: permission.reason,
            });
          } else {
            // Permitted calls execute and write no rejection audit.
            expect(result.rejected).toBe(false);
            expect(executorCalls).toBe(1);
            expect(state.executed).toEqual([toolName]);
            expect(state.audit).toEqual([]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
