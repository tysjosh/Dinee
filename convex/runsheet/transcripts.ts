import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Runsheet transcript association + append persistence (Dinee-owned).
 *
 * Dinee owns the call transcript. While a Runsheet call is in progress the
 * Voice_Runtime observes each confirmed dialogue turn and, as a runtime
 * side-effect (never a model tool call), appends it to the Dinee-owned
 * `transcripts` table keyed by the call id (Req 18.1). This module is the
 * persistence backend for that side-effect: it reuses the existing
 * `transcripts` table (`callId`, `dialogue`, `speaker`, optional
 * `correlationId`) rather than introducing a new table.
 *
 * Association (Req 18.2): the transcript a call builds is referenced by a
 * stable `transcriptId` derived deterministically from the call id
 * ({@link deriveTranscriptId}). The signed Intake_Contract payload carries that
 * same `transcriptId` (in `intakeMeta.transcriptId`) alongside the full
 * transcript content, so the Runsheet backend associates the draft with the
 * Dinee-owned transcript without any callback into Dinee.
 *
 * Retry retention (Req 18.3): {@link appendTurn} throws on a persistence
 * failure so the caller (the Voice_Runtime `TranscriptBuffer`) records the
 * failure and retains the unpersisted turn in memory for retry. It never
 * silently drops a confirmed turn.
 *
 * Requirements: 18.2, 18.3 (dinee-voice-platform)
 */

/** A confirmed dialogue turn role as emitted by the Voice_Runtime buffer. */
export type TranscriptRole = "caller" | "agent";

/** The stored `transcripts.speaker` discriminant. */
export type TranscriptSpeaker = "human" | "ai";

/** Prefix for transcript identifiers so a call id can be recovered from one. */
const TRANSCRIPT_ID_PREFIX = "transcript:";

/**
 * Derive the stable transcript identifier for a call (Req 18.2). The identifier
 * is a pure function of the call id, so the Voice_Runtime, the intake payload,
 * and any reader agree on the same reference without extra bookkeeping. This is
 * the value carried as `transcriptId` in the signed intake payload.
 */
export function deriveTranscriptId(callId: string): string {
  return `${TRANSCRIPT_ID_PREFIX}${callId}`;
}

/**
 * Recover the call id from a transcript id produced by
 * {@link deriveTranscriptId}, or `null` when the value is not a recognized
 * transcript id.
 */
export function callIdFromTranscriptId(transcriptId: string): string | null {
  return transcriptId.startsWith(TRANSCRIPT_ID_PREFIX)
    ? transcriptId.slice(TRANSCRIPT_ID_PREFIX.length)
    : null;
}

/** Map a runtime turn role to the stored `transcripts.speaker` value. */
export function roleToSpeaker(role: TranscriptRole): TranscriptSpeaker {
  return role === "caller" ? "human" : "ai";
}

/** Map a stored `transcripts.speaker` value back to a runtime turn role. */
export function speakerToRole(speaker: TranscriptSpeaker): TranscriptRole {
  return speaker === "human" ? "caller" : "agent";
}

/** A row shaped exactly like the existing `transcripts` table document. */
export interface TranscriptRow {
  callId: string;
  dialogue: string;
  speaker: TranscriptSpeaker;
  correlationId?: string;
}

/**
 * Pure builder for a `transcripts` row from a confirmed turn. Kept pure (no
 * Convex, no I/O) so it is the single source of truth shared by
 * {@link appendTurn} and the property tests that exercise the mapping.
 */
export function buildTranscriptRow(
  callId: string,
  turn: { role: TranscriptRole; text: string },
  correlationId?: string
): TranscriptRow {
  const row: TranscriptRow = {
    callId,
    dialogue: turn.text,
    speaker: roleToSpeaker(turn.role),
  };
  if (correlationId !== undefined) {
    row.correlationId = correlationId;
  }
  return row;
}

/**
 * A confirmed turn reconstructed from the stored transcript, in the
 * {@link TranscriptTurn}-compatible shape the intake payload carries.
 */
export interface StoredTranscriptTurn {
  role: TranscriptRole;
  text: string;
  /** epoch ms; sourced from the document creation time. */
  at: number;
}

/**
 * Append a single confirmed dialogue turn to the Dinee-owned transcript for
 * `callId` (Req 18.1, 18.2). Reuses the existing `transcripts` table.
 *
 * On success returns the association `transcriptId` for the call. Persistence
 * failures propagate (the handler does not swallow them) so the calling
 * Voice_Runtime `TranscriptBuffer` records the failure and retains the turn for
 * retry (Req 18.3) rather than losing it.
 */
export const appendTurn = mutation({
  args: {
    callId: v.string(),
    role: v.union(v.literal("caller"), v.literal("agent")),
    text: v.string(),
    // Confirmation time (epoch ms). Accepted for parity with the runtime turn
    // shape; ordering/timestamps are read back from the document creation time.
    at: v.optional(v.number()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert(
      "transcripts",
      buildTranscriptRow(
        args.callId,
        { role: args.role, text: args.text },
        args.correlationId
      )
    );
    return { success: true as const, transcriptId: deriveTranscriptId(args.callId) };
  },
});

/**
 * Read the Dinee-owned transcript for a call, returning both the association
 * `transcriptId` (Req 18.2) and the full ordered turn content reconstructed
 * into the runtime turn shape. `at` is sourced from each document's creation
 * time since the stored row carries no explicit turn timestamp.
 */
export const getCallTranscript = query({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("transcripts")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .order("asc")
      .collect();

    const turns: StoredTranscriptTurn[] = rows.map((row) => ({
      role: speakerToRole(row.speaker),
      text: row.dialogue,
      at: row._creationTime,
    }));

    return {
      transcriptId: deriveTranscriptId(args.callId),
      turns,
    };
  },
});
