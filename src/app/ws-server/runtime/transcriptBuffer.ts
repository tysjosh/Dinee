/**
 * Transcript buffer — a Voice_Runtime side-effect (NOT a model tool).
 *
 * While a call is in progress the session driver observes confirmed dialogue
 * turns and appends them here, keyed by `callSid`, in append order. There is no
 * model-invoked transcript-capture tool; the runtime appends turns without any
 * agent action (Req 18.1).
 *
 * Each turn is also handed to an optional persister that writes it to the
 * Dinee-owned transcript store. If persistence fails, the failure is recorded
 * and the unpersisted turn is retained in an in-memory buffer for retry, so no
 * confirmed turn is silently lost (Req 18.3).
 *
 * The buffer never acts as a system of record: it holds transcript turns
 * transiently for the duration of a call and is cleared once the call ends.
 *
 * Requirements: 18.1, 18.3
 */

import type { TranscriptTurn } from "@/lib/integrations/runsheet/voiceIntakeClient";

export type { TranscriptTurn };

/**
 * Persists a single confirmed turn to the Dinee-owned transcript store.
 * Rejecting (throwing) signals a persistence failure; the buffer then retains
 * the turn for retry (Req 18.3).
 */
export type TranscriptPersister = (
  callSid: string,
  turn: TranscriptTurn
) => Promise<void>;

/**
 * Invoked whenever a turn fails to persist, so the runtime can record the
 * failure (Req 18.3). Errors thrown by this callback are ignored — recording a
 * failure must never mask the original persistence failure.
 */
export type TranscriptErrorRecorder = (
  callSid: string,
  turn: TranscriptTurn,
  error: string
) => void;

/** The outcome of appending or retrying a single turn. */
export interface AppendResult {
  /** true when the turn was written to the Dinee-owned transcript store. */
  persisted: boolean;
  /** Present when persistence failed; the turn is retained for retry. */
  error?: string;
}

/** The outcome of retrying all retained turns for a call. */
export interface RetryResult {
  /** Number of retained turns that were persisted on this retry. */
  persisted: number;
  /** Number of turns still retained (unpersisted) after this retry. */
  remaining: number;
}

/** Normalizes a thrown value into a stable error string without leaking objects. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "transcript persistence failed";
}

/**
 * In-memory, per-call transcript buffer.
 *
 * Keeps the full ordered sequence of appended turns for each `callSid` (the
 * transcript the runtime is building) alongside a separate queue of turns that
 * failed to persist and are awaiting retry.
 */
export class TranscriptBuffer {
  /** All appended turns per call, in append order (Req 18.1). */
  private readonly transcripts = new Map<string, TranscriptTurn[]>();
  /** Turns that failed to persist, per call, in append order (Req 18.3). */
  private readonly pending = new Map<string, TranscriptTurn[]>();

  private readonly persister?: TranscriptPersister;
  private readonly recordError?: TranscriptErrorRecorder;

  constructor(options?: {
    persister?: TranscriptPersister;
    recordError?: TranscriptErrorRecorder;
  }) {
    this.persister = options?.persister;
    this.recordError = options?.recordError;
  }

  /**
   * Appends a confirmed dialogue turn to the transcript for `callSid` and
   * attempts to persist it. The turn is always recorded in append order in the
   * in-memory transcript; on persistence failure it is additionally retained in
   * the pending buffer for later retry (Req 18.1, 18.3).
   */
  async append(callSid: string, turn: TranscriptTurn): Promise<AppendResult> {
    const transcript = this.transcripts.get(callSid);
    if (transcript) {
      transcript.push(turn);
    } else {
      this.transcripts.set(callSid, [turn]);
    }

    return this.persistTurn(callSid, turn);
  }

  /**
   * Retries persistence of every retained turn for `callSid`, in append order.
   * Stops at the first turn that still fails so that ordering is preserved for
   * the next retry (an earlier turn is never persisted after a later one).
   */
  async retry(callSid: string): Promise<RetryResult> {
    const queue = this.pending.get(callSid);
    if (!queue || queue.length === 0) {
      return { persisted: 0, remaining: 0 };
    }

    let persisted = 0;
    while (queue.length > 0) {
      const turn = queue[0];
      const result = await this.tryPersist(callSid, turn);
      if (!result.persisted) {
        break;
      }
      queue.shift();
      persisted += 1;
    }

    if (queue.length === 0) {
      this.pending.delete(callSid);
    }

    return { persisted, remaining: queue.length };
  }

  /** Returns the ordered transcript for `callSid` (Req 18.1). */
  getTranscript(callSid: string): readonly TranscriptTurn[] {
    return this.transcripts.get(callSid) ?? [];
  }

  /** Returns the turns retained for retry for `callSid` (Req 18.3). */
  getPending(callSid: string): readonly TranscriptTurn[] {
    return this.pending.get(callSid) ?? [];
  }

  /** True when `callSid` has one or more turns awaiting retry. */
  hasPending(callSid: string): boolean {
    const queue = this.pending.get(callSid);
    return queue !== undefined && queue.length > 0;
  }

  /**
   * Releases all buffered state for `callSid`. Call this once the call ends and
   * any pending turns have been drained, so the buffer never accumulates
   * transcripts beyond the life of a call.
   */
  clear(callSid: string): void {
    this.transcripts.delete(callSid);
    this.pending.delete(callSid);
  }

  private async persistTurn(
    callSid: string,
    turn: TranscriptTurn
  ): Promise<AppendResult> {
    const result = await this.tryPersist(callSid, turn);
    if (!result.persisted) {
      this.retain(callSid, turn);
    }
    return result;
  }

  private async tryPersist(
    callSid: string,
    turn: TranscriptTurn
  ): Promise<AppendResult> {
    if (!this.persister) {
      // No persister configured: the turn is buffered in memory only and is
      // treated as awaiting persistence so it can be flushed later via retry.
      return { persisted: false, error: "no transcript persister configured" };
    }

    try {
      await this.persister(callSid, turn);
      return { persisted: true };
    } catch (error) {
      const message = toErrorMessage(error);
      this.record(callSid, turn, message);
      return { persisted: false, error: message };
    }
  }

  private retain(callSid: string, turn: TranscriptTurn): void {
    const queue = this.pending.get(callSid);
    if (queue) {
      queue.push(turn);
    } else {
      this.pending.set(callSid, [turn]);
    }
  }

  private record(callSid: string, turn: TranscriptTurn, error: string): void {
    if (!this.recordError) {
      return;
    }
    try {
      this.recordError(callSid, turn, error);
    } catch {
      // Recording the failure must never mask the original persistence failure.
    }
  }
}
