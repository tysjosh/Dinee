/**
 * Voice Runtime — pack-driven session driver.
 *
 * Owns a single call's lifecycle on top of the generic runtime primitives:
 * the {@link resolvePackByConversationType} / {@link resolveToolSet} /
 * {@link isToolCallPermitted} registry functions, the {@link buildSessionConfig}
 * builder, the generic {@link nextPhase} phase engine, the {@link executeTool}
 * tool executor, and the {@link TranscriptBuffer} side-effect. `index.ts`
 * (transport) delegates to this module.
 *
 * Responsibilities:
 *
 * 1. **prepareSession (Req 1.9, 1.10, 1.11, 3.1, 3.2, 3.5, 4.5, 4.6).** Resolve
 *    the pack that owns the call's conversation type BEFORE any OpenAI session
 *    init. Return a `start` decision carrying the fully-resolved
 *    {@link SessionInit} (integration-gated tool set, prompt, initial phase), or
 *    a `terminate` decision (`no_mapping` when the number did not resolve to a
 *    conversation route, `no_pack` when no registered pack owns the resolved
 *    conversation type) with an audit record. A terminated call never opens the
 *    OpenAI socket.
 *
 * 2. **Tool-call gating dispatch (Req 3.6, 3.7, 3.8).** On a model function-call
 *    event, consult {@link isToolCallPermitted}. On `not_in_set` / `not_in_phase`
 *    return a rejection result to the model, do NOT execute the tool, preserve
 *    the active phase, and write an audit entry (tool, phase, callId). On a
 *    permitted call, execute via {@link executeTool} and apply the declared
 *    phase transition.
 *
 * 3. **Unconfirmed-submission fail-safe (Req 6.8, 6.9, 6.10).** While the call is
 *    active and `runsheet_queue_dispatch_review` placement is unconfirmed, retain
 *    the transient in-session draft for retry and NEVER persist it as a Dinee
 *    order-of-record. If placement is still unconfirmed when the call ends,
 *    escalate/transfer per the configured `Escalation_Target` rather than
 *    discarding the draft.
 *
 * Requirements: 1.9, 1.10, 1.11, 3.1, 3.2, 3.5, 3.7, 3.8, 4.5, 4.6, 6.8, 6.9, 6.10
 */

import type {
  ConversationTypeDefinition,
  EscalationRule,
  EscalationTarget,
  VoiceDomainPack,
  VoiceToolDefinition,
} from "@/lib/modules/voiceDomainPack";
import {
  isToolCallPermitted,
  resolvePackByConversationType,
  resolveToolSet,
  type ToolCallRejectionReason,
} from "@/lib/modules/voiceDomainPackRegistry";
import { nextPhase } from "./phaseEngine";
import {
  executeTool,
  type ToolExecContext,
  type ToolOutcome,
} from "./toolExecutor";
import { TranscriptBuffer, type TranscriptTurn } from "./transcriptBuffer";

/** The tool whose confirmed placement gates the unconfirmed-submission fail-safe. */
export const DISPATCH_REVIEW_TOOL = "runsheet_queue_dispatch_review";

/** The tool whose successful execution produces the transient in-session draft. */
export const CREATE_ORDER_DRAFT_TOOL = "runsheet_create_order_draft";

/**
 * The already-resolved routing context for a single inbound call. The called
 * number is looked up upstream (`resolvePhoneToRoute`) within the SLA (Req 1.9);
 * `conversationType` is the resolved route (empty when the number did not map to
 * a route — Req 4.6).
 */
export interface ResolvedCallContext {
  /** Twilio call identifier. */
  callSid: string;
  /** Calling party number. */
  fromNumber: string;
  /** Called (Dinee-managed) number the caller dialed. */
  toNumber: string;
  /** The tenant the number resolved to. */
  tenantId: string;
  /** The resolved conversation route; empty when the number mapped to no route. */
  conversationType: string;
  /** Integrations enabled for the tenant, used for tool-set gating (Req 4.4). */
  enabledIntegrations: string[];
}

/** Everything the runtime needs to open a Realtime session for a resolved call. */
export interface SessionInit {
  /** The resolved pack that owns the conversation type. */
  pack: VoiceDomainPack;
  /** The conversation-type definition within the pack. */
  conversation: ConversationTypeDefinition;
  /** The integration-gated tool set exposed for this tenant (Req 4.4). */
  toolSet: VoiceToolDefinition[];
  /** The system prompt (conversation override or pack default). */
  prompt: string;
  /** The phase the session starts in. */
  initialPhase: string;
}

/** Why a call was terminated before any Realtime session was opened. */
export type TerminationReason = "no_pack" | "no_mapping";

/** A single audit entry written by the session driver. */
export interface AuditRecord {
  /** The kind of event being recorded. */
  event:
    | "route_terminated"
    | "tool_rejected"
    | "tool_timeout"
    | "tool_error"
    | "dispatch_unconfirmed"
    | "call_end_escalation";
  /** The call identifier the entry pertains to (Req 3.5, 3.7, 3.8, 4.6). */
  callId: string;
  /** Epoch milliseconds when the entry was created. */
  at: number;
  /** The tool name, when the entry concerns a tool call. */
  tool?: string;
  /** The active call phase, when relevant (Req 3.8). */
  phase?: string;
  /** The unresolved conversation type, for `no_pack` termination (Req 3.5). */
  conversationType?: string;
  /** The called number, for `no_mapping` termination (Req 4.6). */
  toNumber?: string;
  /** The termination reason, for `route_terminated` entries. */
  reason?: TerminationReason | ToolCallRejectionReason;
  /** A free-form detail (error/timeout description, escalation target kind). */
  detail?: string;
}

/** The outcome of {@link prepareSession}. */
export type PrepareSessionResult =
  | { kind: "start"; init: SessionInit }
  | { kind: "terminate"; reason: TerminationReason; audit: AuditRecord };

/**
 * Resolves the pack for a routed call and builds the session init, or returns a
 * termination decision. Resolution precedes any OpenAI session init (Req 3.2):
 * a `terminate` result means the runtime must NOT open the Realtime socket — it
 * plays an audio message and hangs up, having recorded the audit entry.
 *
 * - **no_mapping (Req 1.11, 4.6):** the called number did not resolve to a
 *   conversation route (empty `conversationType`). Audit records the called
 *   number and the call id.
 * - **no_pack (Req 3.5):** the resolved conversation type is owned by no
 *   registered pack. Audit records the unresolved conversation type and the
 *   call id.
 * - **start (Req 3.1, 3.3, 3.4, 4.5):** the single owning pack is resolved and
 *   the integration-gated tool set + prompt + initial phase are returned for the
 *   runtime to apply before the first spoken response.
 *
 * @param ctx The resolved routing context for the call.
 * @returns A `start` decision with {@link SessionInit}, or a `terminate`
 *   decision with the reason and an {@link AuditRecord}.
 */
export function prepareSession(ctx: ResolvedCallContext): PrepareSessionResult {
  // No conversation route mapped to the called number (Req 1.11, 4.6).
  if (!ctx.conversationType) {
    return {
      kind: "terminate",
      reason: "no_mapping",
      audit: {
        event: "route_terminated",
        callId: ctx.callSid,
        at: Date.now(),
        toNumber: ctx.toNumber,
        reason: "no_mapping",
      },
    };
  }

  // No registered pack owns the resolved conversation type (Req 3.1, 3.5).
  const pack = resolvePackByConversationType(ctx.conversationType);
  if (!pack) {
    return {
      kind: "terminate",
      reason: "no_pack",
      audit: {
        event: "route_terminated",
        callId: ctx.callSid,
        at: Date.now(),
        conversationType: ctx.conversationType,
        reason: "no_pack",
      },
    };
  }

  // The conversation type is owned by the pack (resolution guarantees it exists).
  const conversation = pack.conversationTypes.find(
    (candidate) => candidate.type === ctx.conversationType
  );
  if (!conversation) {
    // Defensive: a pack resolved for a type it does not actually own is a
    // programming error, but treat it as no_pack rather than crashing the call.
    return {
      kind: "terminate",
      reason: "no_pack",
      audit: {
        event: "route_terminated",
        callId: ctx.callSid,
        at: Date.now(),
        conversationType: ctx.conversationType,
        reason: "no_pack",
      },
    };
  }

  const toolSet = resolveToolSet(pack, ctx.enabledIntegrations);
  const prompt = conversation.prompt ?? pack.defaultPrompt;

  return {
    kind: "start",
    init: {
      pack,
      conversation,
      toolSet,
      prompt,
      initialPhase: conversation.initialPhase,
    },
  };
}

/** A model-emitted function-call event (`response.function_call_arguments.done`). */
export interface FunctionCallEvent {
  /** The OpenAI call id for this function call, echoed back in the output. */
  callId: string;
  /** The tool name the model requested. */
  name: string;
  /** The parsed tool arguments. */
  args: unknown;
}

/** The `function_call_output` payload the runtime returns to the model. */
export interface ToolCallOutput {
  /** Echoes the model's function `callId`. */
  callId: string;
  /** JSON-encoded result/rejection payload sent back to the model. */
  output: string;
}

/** The result of dispatching one function-call event. */
export type ToolDispatchResult =
  | {
      /** The call was rejected by gating and NOT executed (Req 3.7, 3.8). */
      kind: "rejected";
      /** Why the call was rejected. */
      reason: ToolCallRejectionReason;
      /** The active phase, preserved unchanged (Req 3.7, 3.8). */
      phase: string;
      /** The rejection payload to return to the model. */
      output: ToolCallOutput;
      /** The audit entry recorded for the rejection (Req 3.7, 3.8). */
      audit: AuditRecord;
    }
  | {
      /** The call was permitted and executed via the tool executor. */
      kind: "executed";
      /** The normalized executor outcome. */
      outcome: ToolOutcome;
      /** The phase before applying any transition. */
      phaseBefore: string;
      /** The phase after applying the declared transition (may equal `phaseBefore`). */
      phaseAfter: string;
      /** The result payload to return to the model. */
      output: ToolCallOutput;
      /** An audit entry, present on timeout / backend error / unconfirmed dispatch. */
      audit?: AuditRecord;
    };

/** The outcome of ending a call, after applying the unconfirmed-submission fail-safe. */
export type CallEndResult =
  | {
      /** Placement was unconfirmed with a retained draft — escalate/transfer (Req 6.9). */
      kind: "escalate";
      /** The configured escalation target to route to. */
      target: EscalationTarget;
      /** The transient draft that must not be discarded (Req 6.9). */
      draft: unknown;
      /** The audit entry recorded for the escalation. */
      audit: AuditRecord;
    }
  | {
      /** Nothing to escalate: no draft, or placement was confirmed. */
      kind: "none";
    };

/** Optional collaborators / overrides for a {@link SessionDriver}. */
export interface SessionDriverOptions {
  /** Sink invoked for every audit entry the driver records. */
  onAudit?: (record: AuditRecord) => void;
  /** Transcript buffer for confirmed turns; a fresh one is created when omitted. */
  transcriptBuffer?: TranscriptBuffer;
  /** Per-invocation tool deadline in milliseconds; defaults to the executor's 5s. */
  toolTimeoutMs?: number;
  /**
   * Resolves the phase-transition event to apply after a permitted tool executes
   * successfully. Defaults to reading a `phaseEvent` string off the outcome
   * result object; return `undefined` to leave the phase unchanged.
   */
  resolvePhaseEvent?: (toolName: string, outcome: ToolOutcome) => string | undefined;
}

/** Reads a `phaseEvent` string from a tool's successful result, when present. */
function defaultPhaseEvent(
  _toolName: string,
  outcome: ToolOutcome
): string | undefined {
  if (outcome.status !== "ok") {
    return undefined;
  }
  const result = outcome.result;
  if (result && typeof result === "object") {
    const event = (result as Record<string, unknown>).phaseEvent;
    if (typeof event === "string" && event.length > 0) {
      return event;
    }
  }
  return undefined;
}

/**
 * Determines whether a dispatch-review outcome confirmed placement in the
 * Dispatcher_Review_Queue. Placement is confirmed iff the tool resolved `ok`
 * and its result does not explicitly report `placed: false` / `confirmed: false`
 * (timeout and error outcomes are always unconfirmed — Req 6.9).
 */
function isPlacementConfirmed(outcome: ToolOutcome): boolean {
  if (outcome.status !== "ok") {
    return false;
  }
  const result = outcome.result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.placed === false || record.confirmed === false) {
      return false;
    }
  }
  return true;
}

/** Extracts a transient draft from a create-order-draft result, when present. */
function extractDraft(outcome: ToolOutcome): unknown {
  if (outcome.status !== "ok") {
    return undefined;
  }
  const result = outcome.result;
  if (result && typeof result === "object" && "draft" in result) {
    return (result as Record<string, unknown>).draft;
  }
  return result;
}

/**
 * Selects the escalation target for the unconfirmed-submission fail-safe.
 * Prefers a rule triggered by `tool_failure`, then `explicit_request`, then the
 * first configured rule. Returns `null` when the pack declares no escalation.
 */
function selectEscalationTarget(
  rules: EscalationRule[]
): EscalationTarget | null {
  const byTrigger =
    rules.find((rule) => rule.trigger === "tool_failure") ??
    rules.find((rule) => rule.trigger === "explicit_request") ??
    rules[0];
  return byTrigger ? byTrigger.target : null;
}

/**
 * Drives a single call after {@link prepareSession} returns `start`. Holds the
 * live per-call state (active phase, transient draft, dispatch-review
 * confirmation) and enforces tool-call gating and the unconfirmed-submission
 * fail-safe.
 */
export class SessionDriver {
  private readonly ctx: ResolvedCallContext;
  private readonly init: SessionInit;
  private readonly options: SessionDriverOptions;
  private readonly transcript: TranscriptBuffer;

  /** The active call phase (Req 3.7, 3.8 — preserved across rejected calls). */
  private currentPhase: string;
  /** The transient in-session draft; never persisted as an order-of-record (Req 6.10). */
  private transientDraft: unknown = undefined;
  /** True once a dispatch-review call confirmed placement (Req 6.9). */
  private dispatchConfirmed = false;

  constructor(
    ctx: ResolvedCallContext,
    init: SessionInit,
    options: SessionDriverOptions = {}
  ) {
    this.ctx = ctx;
    this.init = init;
    this.options = options;
    this.transcript = options.transcriptBuffer ?? new TranscriptBuffer();
    this.currentPhase = init.initialPhase;
  }

  /** The active call phase. */
  get phase(): string {
    return this.currentPhase;
  }

  /** The transient in-session draft, if one has been produced. */
  get draft(): unknown {
    return this.transientDraft;
  }

  /** Whether dispatch-review placement has been confirmed. */
  get placementConfirmed(): boolean {
    return this.dispatchConfirmed;
  }

  /**
   * Appends a confirmed dialogue turn to the call's transcript. Transcript
   * capture is a runtime side-effect, not a model tool (Req 18.1); the runtime
   * calls this as it observes confirmed turns.
   */
  appendTranscript(turn: TranscriptTurn): Promise<{ persisted: boolean; error?: string }> {
    return this.transcript.append(this.ctx.callSid, turn);
  }

  /**
   * Dispatches a model function-call event through gating and, when permitted,
   * the tool executor.
   *
   * - **not_in_set (Req 3.7):** reject, do not execute, preserve the phase, audit
   *   `{tool, callId}`, return a rejection result to the model.
   * - **not_in_phase (Req 3.8):** reject, do not execute, preserve the phase,
   *   audit `{tool, phase, callId}`, return a rejection result to the model.
   * - **permitted:** execute via {@link executeTool}; on `ok` apply the declared
   *   phase transition; on `timeout`/`error` audit and leave the phase unchanged
   *   so the driver can continue with the conversation-type fallback (Req 6.5,
   *   6.6). For the dispatch-review tool, update the placement/draft fail-safe
   *   state (Req 6.8, 6.10).
   */
  async handleFunctionCall(
    event: FunctionCallEvent
  ): Promise<ToolDispatchResult> {
    const permission = isToolCallPermitted(
      this.init.toolSet,
      event.name,
      this.currentPhase
    );

    if (!permission.permitted) {
      const reason = permission.reason ?? "not_in_set";
      // not_in_set omits the phase from the audit; not_in_phase records it (Req 3.7, 3.8).
      const audit = this.record({
        event: "tool_rejected",
        callId: this.ctx.callSid,
        at: Date.now(),
        tool: event.name,
        phase: reason === "not_in_phase" ? this.currentPhase : undefined,
        reason,
      });
      return {
        kind: "rejected",
        reason,
        phase: this.currentPhase, // state preserved (Req 3.7, 3.8)
        output: rejectionOutput(event.callId, reason),
        audit,
      };
    }

    const execCtx: ToolExecContext = {
      callSid: this.ctx.callSid,
      tenantId: this.ctx.tenantId,
      conversationType: this.ctx.conversationType,
      toolName: event.name,
      enabledIntegrations: this.ctx.enabledIntegrations,
    };

    const tool = this.init.toolSet.find(
      (candidate) => candidate.name === event.name
    );
    const handlerKey = tool ? tool.handler : event.name;

    const outcome = await executeTool(
      handlerKey,
      event.args,
      execCtx,
      this.options.toolTimeoutMs
    );

    const phaseBefore = this.currentPhase;
    let audit: AuditRecord | undefined;

    // Capture the transient draft produced by a successful create-order-draft
    // call so the fail-safe can retain it (Req 6.10).
    if (event.name === CREATE_ORDER_DRAFT_TOOL && outcome.status === "ok") {
      this.transientDraft = extractDraft(outcome);
    }

    if (event.name === DISPATCH_REVIEW_TOOL) {
      if (isPlacementConfirmed(outcome)) {
        this.dispatchConfirmed = true;
      } else {
        // Placement unconfirmed: retain the draft for retry and audit it. The
        // draft is NOT persisted as a Dinee order-of-record (Req 6.8, 6.10).
        this.dispatchConfirmed = false;
        audit = this.record({
          event: "dispatch_unconfirmed",
          callId: this.ctx.callSid,
          at: Date.now(),
          tool: event.name,
          phase: phaseBefore,
          detail: outcome.error ?? "placement not confirmed",
        });
      }
    }

    if (outcome.status === "timeout") {
      audit = this.record({
        event: "tool_timeout",
        callId: this.ctx.callSid,
        at: Date.now(),
        tool: event.name,
        phase: phaseBefore,
        detail: outcome.error,
      });
    } else if (outcome.status === "error") {
      audit = this.record({
        event: "tool_error",
        callId: this.ctx.callSid,
        at: Date.now(),
        tool: event.name,
        phase: phaseBefore,
        detail: outcome.error,
      });
    }

    // Apply the declared phase transition only on a successful execution
    // (Req 3.6). Timeout/error leaves the phase unchanged for the fallback.
    let phaseAfter = phaseBefore;
    if (outcome.status === "ok") {
      const resolveEvent =
        this.options.resolvePhaseEvent ?? defaultPhaseEvent;
      const transitionEvent = resolveEvent(event.name, outcome);
      if (transitionEvent) {
        phaseAfter = nextPhase(
          this.init.pack.phases,
          phaseBefore,
          transitionEvent
        );
        this.currentPhase = phaseAfter;
      }
    }

    return {
      kind: "executed",
      outcome,
      phaseBefore,
      phaseAfter,
      output: executionOutput(event.callId, outcome),
      audit,
    };
  }

  /**
   * Applies the unconfirmed-submission fail-safe at call end (Req 6.9). If a
   * transient draft exists and dispatch-review placement was never confirmed,
   * escalate/transfer per the configured `Escalation_Target` and hand back the
   * retained draft so it is never silently discarded. Otherwise no action.
   *
   * This never persists the draft as a Dinee order-of-record; the Runsheet
   * backend is the system of record once placement is confirmed (Req 6.10).
   */
  handleCallEnd(): CallEndResult {
    const draftPending =
      this.transientDraft !== undefined && !this.dispatchConfirmed;

    if (!draftPending) {
      return { kind: "none" };
    }

    const target = selectEscalationTarget(this.init.pack.escalationRules);
    const audit = this.record({
      event: "call_end_escalation",
      callId: this.ctx.callSid,
      at: Date.now(),
      tool: DISPATCH_REVIEW_TOOL,
      phase: this.currentPhase,
      detail: target ? target.kind : "no_escalation_target",
    });

    if (!target) {
      // No configured target: still surface the unconfirmed draft rather than
      // discarding it, so the caller of this driver can decide how to handle it.
      return { kind: "none" };
    }

    return { kind: "escalate", target, draft: this.transientDraft, audit };
  }

  /** Records an audit entry via the sink (when configured) and returns it. */
  private record(entry: AuditRecord): AuditRecord {
    this.options.onAudit?.(entry);
    return entry;
  }
}

/** Builds the rejection payload returned to the model for a gated tool call. */
function rejectionOutput(
  callId: string,
  reason: ToolCallRejectionReason
): ToolCallOutput {
  return {
    callId,
    output: JSON.stringify({ error: "tool_call_rejected", reason }),
  };
}

/** Builds the result payload returned to the model for an executed tool call. */
function executionOutput(callId: string, outcome: ToolOutcome): ToolCallOutput {
  if (outcome.status === "ok") {
    return { callId, output: JSON.stringify(outcome.result ?? null) };
  }
  return {
    callId,
    output: JSON.stringify({ error: outcome.status, detail: outcome.error }),
  };
}
