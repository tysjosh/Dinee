/**
 * Feature: campus-social-loops (Task 13.1) — Clip_Studio Convex service.
 *
 * Thin Convex wrapper around the pure, property-tested Clip_Studio core in
 * `./logic/clips.ts`, built ON TOP OF the existing Call_Clip pipeline
 * (`decideCallClip`, `campusCallClips`, `AI_VOICE_AGENT_LABEL`) rather than a
 * new clip pipeline. Every risky decision is delegated to a pure function so
 * the rules the property tests exercise are the rules enforced at runtime — the
 * same discipline used across `convex/campus/logic/**` and `convex/campus/share.ts`.
 *
 * Reuse (design → "What is reused vs. new"):
 *   - Call_Clip pipeline: `decideCallClip` gates recording+consent and stamps the
 *     visible "AI voice agent" label + Campus_Agent attribution; produced clips
 *     are persisted to the extending `campusShareClips` table (Req 3.2, 8.2).
 *   - Safety_Service: `decideScreening` (via the reused `screenContent` action)
 *     screens every produced Share_Clip fail-closed before it is surfaced
 *     (Req 3.6, 3.7, 3.10).
 *   - Share_Service: `assembleShareFormats` surfaces a screened-clean clip
 *     through the existing TikTok/Reels/Snap formats (Req 3.8).
 *
 * Exposed functions (design → Clip_Studio):
 *   - onCallComplete       (action)   `decideClipSuggestion` presents a
 *                          Clip_Suggestion within 10s for a recorded, consented
 *                          call ≥ 20s; none for < 20s; "recorded calls only"
 *                          when consent is absent (Req 3.1, 3.3, 3.9)
 *   - generateShareClip    (action)   requires Sharing_Consent, builds the clip
 *                          through the reused Call_Clip pipeline, screens it
 *                          fail-closed, and surfaces only a clean clip through
 *                          the reused share formats; every withheld/discard path
 *                          retains the source recording unchanged
 *                          (Req 3.2, 3.4–3.8, 3.10, 3.11, 8.2)
 *   - discardClipSuggestion(mutation) discards a Clip_Suggestion without
 *                          generating a clip, retaining the source recording
 *                          unchanged (Req 3.11)
 *
 * Covered requirements: 3.1–3.11, 8.2.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { api, internal } from "../../_generated/api";
import { getCurrentUserRecord } from "../../shared/ownership";

import {
  decideClipSuggestion,
  clampClipDuration,
  decideClipAvailability,
  SHARE_CLIP_MIN_SEC,
  type ProducedShareClip,
  type ClipAvailability,
} from "./logic/clips";
import {
  decideCallClip,
  assembleShareFormats,
  AI_VOICE_AGENT_LABEL,
  CLIP_UNAVAILABLE_MESSAGE,
  type CallClipRequest,
  type ShareAgent,
  type ShareFormats,
} from "../logic/share";
import type { ScreeningDecision } from "../logic/screening";

type AnyCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Small internal helpers (mirroring convex/campus/share.ts)
// ---------------------------------------------------------------------------

/** The social formats a produced Share_Clip is prepared for (Req 3.2, 3.8). */
export const SHARE_CLIP_FORMATS = ["tiktok", "reels", "snap"] as const;

/** The default requested duration when a caller does not specify one. */
const DEFAULT_SHARE_CLIP_DURATION_SEC = SHARE_CLIP_MIN_SEC;

/** The platform base URL used to build absolute Call_Links (Req 3.8). */
function platformBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://dinee.app"
  ).replace(/\/+$/, "");
}

/** Loads a Campus_Agent by its public `agentId`, or null when absent. */
async function getAgentById(
  ctx: AnyCtx,
  agentId: string
): Promise<Doc<"campusAgents"> | null> {
  return await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
}

/** Loads a source call by its public `callId`, or null when absent. */
async function getCallById(
  ctx: AnyCtx,
  callId: string
): Promise<Doc<"calls"> | null> {
  return await ctx.db
    .query("calls")
    .withIndex("by_call_and_order_id", (q) => q.eq("callId", callId))
    .first();
}

/**
 * Resolves the authenticated caller and asserts ownership of the Campus_Agent
 * that produced the source call. Throws (fail-closed) on missing auth, unknown
 * call/agent, or a non-owner. `ownerId` may hold either the auth row id (`_id`)
 * or the app `userId`, so both are accepted (matches `convex/campus/share.ts`).
 */
async function requireOwnedAgent(
  ctx: AnyCtx,
  agentId: string
): Promise<{ user: Doc<"users">; agent: Doc<"campusAgents"> }> {
  const user = await getCurrentUserRecord(ctx);
  if (!user) {
    throw new Error("Unauthorized: authentication required");
  }
  const agent = await getAgentById(ctx, agentId);
  if (!agent) {
    throw new Error("Agent not found");
  }
  const ownsAgent =
    agent.ownerId === user._id ||
    (Boolean(user.userId) && agent.ownerId === user.userId);
  if (!ownsAgent) {
    throw new Error("Forbidden: you do not own this Campus_Agent");
  }
  return { user, agent };
}

/** Projects a stored agent row into the pure share-format identity shape. */
function agentToShareAgent(agent: Doc<"campusAgents">): ShareAgent {
  return {
    name: agent.name,
    campusTag: agent.campusTag ?? "",
    agentType: agent.agentType,
    slug: agent.slug,
  };
}

// ---------------------------------------------------------------------------
// Call_Clip pipeline bridge (Req 3.2, 8.2) — PURE, exported for the wiring test
// ---------------------------------------------------------------------------

/**
 * The result of building a Share_Clip through the reused Call_Clip pipeline.
 *
 *   - `{ produced: true; clip }`: the source call was recorded with consent, so
 *     the reused `decideCallClip` produced a labelled + attributed Call_Clip and
 *     this Share_Clip carries that same "AI voice agent" label and Campus_Agent
 *     attribution (Req 3.2, 8.2).
 *   - `{ produced: false; reason: "clip_unavailable"; message }`: the source
 *     call was not recorded / the notice was declined, so the reused pipeline
 *     declines with the "recorded calls only" indication (Req 3.3).
 */
export type BuildShareClipResult =
  | { produced: true; clip: ProducedShareClip }
  | { produced: false; reason: "clip_unavailable"; message: string };

/**
 * Builds a produced Share_Clip THROUGH the existing Call_Clip pipeline
 * (Req 3.2, 8.2). Pure and deterministic — carries no `ctx` and performs no I/O
 * — so it is exercised directly by the Task 13.2 wiring test.
 *
 * The Share_Clip is a captioned 10–20s excerpt EXTENDING the Call_Clip: the
 * recording+consent gate and the visible "AI voice agent" label + Campus_Agent
 * attribution are inherited from the reused `decideCallClip` rather than
 * recomputed, so a Share_Clip can only ever exist where a Call_Clip could, and
 * always carries the platform label + attribution.
 */
export function buildShareClip(input: {
  callClipRequest: CallClipRequest;
  requestedDurationSec: number;
}): BuildShareClipResult {
  // Reuse the existing Call_Clip pipeline for the recording+consent gate and
  // for the label + attribution (Req 8.2). No parallel clip pipeline exists.
  const decision = decideCallClip(input.callClipRequest);
  if (!decision.produced) {
    return {
      produced: false,
      reason: decision.reason,
      message: decision.message,
    };
  }

  const clip: ProducedShareClip = {
    durationSec: clampClipDuration(input.requestedDurationSec),
    captions: true,
    formats: SHARE_CLIP_FORMATS,
    // Label + attribution come straight from the Call_Clip decision (Req 8.2).
    label: decision.clip.label,
    agentId: decision.clip.attribution.agentId,
  };
  return { produced: true, clip };
}

// ---------------------------------------------------------------------------
// onCallComplete — Clip_Suggestion gate (Req 3.1, 3.3, 3.9)
// ---------------------------------------------------------------------------

/**
 * Owner-gated context for the Clip_Suggestion gate, resolved in the default
 * runtime so the `onCallComplete` action can read it via `ctx.runQuery`
 * (identity propagates). Exposes the recorded flag — `calls.recordingEnabled`
 * is the per-call snapshot that already reflects the Caller's acknowledgement of
 * the recording notice (a declined notice forces it `false`, per
 * Privacy_Controls / Recording_Consent) — and the recorded source duration.
 */
export const getClipSuggestionContext = internalQuery({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const call = await getCallById(ctx, args.callId);
    if (!call) {
      throw new Error("Call not found");
    }
    if (!call.campusAgentId) {
      throw new Error("Call is not a Campus_Agent call");
    }
    const { agent } = await requireOwnedAgent(ctx, call.campusAgentId);
    return {
      callId: call.callId,
      agentId: agent.agentId,
      agentName: agent.name,
      recordingConsent: call.recordingEnabled === true,
      sourceDurationSec: call.duration ?? 0,
    };
  },
});

/**
 * Persists a `suggested` Share_Clip placeholder row so the Clip_Suggestion is
 * durable for the Caller/Student_Creator to later accept, edit, or discard. The
 * row carries the "AI voice agent" label and Campus_Agent attribution up front
 * (Req 3.2, 8.2); no media is attached until the clip is generated.
 */
export const persistClipSuggestion = internalMutation({
  args: {
    sourceCallId: v.string(),
    agentId: v.string(),
    durationSec: v.number(),
  },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    const shareClipId = `SHARECLIP_${crypto.randomUUID()}`;
    await ctx.db.insert("campusShareClips", {
      shareClipId,
      sourceCallId: args.sourceCallId,
      agentId: agent.agentId,
      ownerId: agent.ownerId,
      durationSec: clampClipDuration(args.durationSec),
      hasCaptions: true,
      formats: [...SHARE_CLIP_FORMATS],
      label: AI_VOICE_AGENT_LABEL,
      status: "suggested",
      createdAt: Date.now(),
    });
    return { shareClipId };
  },
});

/** Discriminated outcome of `onCallComplete`. */
type OnCallCompleteResult =
  | { suggested: true; shareClipId: string; sourceCallId: string; agentId: string }
  | {
      suggested: false;
      reason: "no_recording_consent" | "source_too_short";
      message: string;
    };

/**
 * Call-completion hook: decides whether to present a Clip_Suggestion for a
 * completed call and, when it should, persists a durable `suggested` Share_Clip
 * placeholder within 10s of completion (Req 3.1). The decision is delegated to
 * the pure `decideClipSuggestion`:
 *   - recorded with Recording_Consent AND source ≥ 20s ⇒ a Clip_Suggestion is
 *     presented (Req 3.1);
 *   - recorded with consent but source < 20s ⇒ no suggestion (Req 3.9);
 *   - Recording_Consent absent ⇒ no suggestion, with the "recorded calls only"
 *     indication (Req 3.3).
 * No source recording is modified on any branch.
 */
export const onCallComplete = action({
  args: { callId: v.string() },
  handler: async (ctx, args): Promise<OnCallCompleteResult> => {
    const context = await ctx.runQuery(
      internal.campus.social.clips.getClipSuggestionContext,
      { callId: args.callId }
    );

    const decision = decideClipSuggestion({
      recordingConsent: context.recordingConsent,
      sourceDurationSec: context.sourceDurationSec,
    });

    if (!decision.suggest) {
      const message =
        decision.reason === "no_recording_consent"
          ? CLIP_UNAVAILABLE_MESSAGE
          : "The call was too short to suggest a clip.";
      return { suggested: false, reason: decision.reason, message };
    }

    const { shareClipId } = await ctx.runMutation(
      internal.campus.social.clips.persistClipSuggestion,
      {
        sourceCallId: context.callId,
        agentId: context.agentId,
        durationSec: DEFAULT_SHARE_CLIP_DURATION_SEC,
      }
    );

    return {
      suggested: true,
      shareClipId,
      sourceCallId: context.callId,
      agentId: context.agentId,
    };
  },
});

// ---------------------------------------------------------------------------
// generateShareClip — consent gate → Call_Clip → fail-closed screen → surface
// (Req 3.2, 3.4–3.8, 3.10, 8.2)
// ---------------------------------------------------------------------------

/** Owner-gated context for building a Share_Clip from a completed call. */
export const getShareClipContext = internalQuery({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const call = await getCallById(ctx, args.callId);
    if (!call) {
      throw new Error("Call not found");
    }
    if (!call.campusAgentId) {
      throw new Error("Call is not a Campus_Agent call");
    }
    const { agent } = await requireOwnedAgent(ctx, call.campusAgentId);
    return {
      callId: call.callId,
      agentId: agent.agentId,
      agentName: agent.name,
      recorded: call.recordingEnabled === true,
      shareAgent: agentToShareAgent(agent),
    };
  },
});

/**
 * Persists the final Share_Clip row with its gating outcome. A screened-clean,
 * consented clip is stored `available` with its media `storageId`; every
 * withheld/discard outcome is stored WITHOUT a `storageId` (the orphaned excerpt
 * upload is dropped by the caller) so the source recording is retained unchanged
 * (Req 3.5, 3.7, 3.10, 3.11).
 */
export const persistShareClip = internalMutation({
  args: {
    sourceCallId: v.string(),
    agentId: v.string(),
    durationSec: v.number(),
    status: v.union(
      v.literal("available"),
      v.literal("withheld_consent"),
      v.literal("withheld_policy"),
      v.literal("withheld_screening_error")
    ),
    storageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { agent } = await requireOwnedAgent(ctx, args.agentId);
    const shareClipId = `SHARECLIP_${crypto.randomUUID()}`;
    await ctx.db.insert("campusShareClips", {
      shareClipId,
      sourceCallId: args.sourceCallId,
      agentId: agent.agentId,
      ownerId: agent.ownerId,
      durationSec: clampClipDuration(args.durationSec),
      hasCaptions: true,
      formats: [...SHARE_CLIP_FORMATS],
      label: AI_VOICE_AGENT_LABEL,
      storageId: args.storageId,
      status: args.status,
      createdAt: Date.now(),
    });
    return { shareClipId };
  },
});

/** Discriminated outcome of `generateShareClip`. */
type GenerateShareClipResult =
  | {
      status: "available";
      shareClipId: string;
      clip: ProducedShareClip;
      formats: ShareFormats;
    }
  | {
      status: "withheld_consent" | "withheld_policy" | "withheld_screening_error";
      shareClipId: string;
      message: string;
    }
  | { status: "clip_unavailable"; message: string };

/** Human-readable indications for each withheld outcome. */
const WITHHELD_MESSAGES: Record<ClipAvailability["status"], string> = {
  available: "",
  withheld_consent:
    "Sharing consent is required before a clip can be generated.",
  withheld_policy: "The clip violated content policy and was withheld.",
  withheld_screening_error:
    "Screening could not complete, so the clip was withheld.",
};

/**
 * Generates a ready-to-post Share_Clip from a completed, recorded call
 * (Req 3.2, 3.4–3.8, 3.10, 8.2). The clip excerpt media must already be uploaded
 * to Convex storage; the caller passes its `storageId` and the transcript/caption
 * `content` to be screened.
 *
 * The pipeline is consent-first, then fail-closed screened:
 *   1. The clip is built THROUGH the reused Call_Clip pipeline (`buildShareClip`
 *      → `decideCallClip`): if the source was not recorded / the notice was
 *      declined, no clip is produced and the "recorded calls only" indication is
 *      returned (Req 3.3), dropping the orphaned upload.
 *   2. Sharing_Consent must be granted; when absent the clip is withheld and the
 *      source recording is retained unchanged (Req 3.4, 3.5).
 *   3. With consent granted, the reused `screenContent` action screens the clip
 *      fail-closed; `decideClipAvailability` withholds on a policy violation
 *      (Req 3.10) or on an unavailable screening dependency (Req 3.7), each
 *      retaining the source recording unchanged.
 *   4. Only a consented, screened-clean clip is surfaced through the reused
 *      `assembleShareFormats` TikTok/Reels/Snap formats (Req 3.8).
 */
export const generateShareClip = action({
  args: {
    callId: v.string(),
    storageId: v.id("_storage"),
    sharingConsent: v.boolean(),
    content: v.string(),
    requestedDurationSec: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GenerateShareClipResult> => {
    const context = await ctx.runQuery(
      internal.campus.social.clips.getShareClipContext,
      { callId: args.callId }
    );

    // (1) Build through the reused Call_Clip pipeline (Req 8.2). `recorded` is
    // the per-call snapshot: true only when recording was on AND the notice was
    // acknowledged, satisfying both conditions of the Call_Clip gate.
    const built = buildShareClip({
      callClipRequest: {
        callId: context.callId,
        agentId: context.agentId,
        agentName: context.agentName,
        recordingEnabled: context.recorded,
        callerAcknowledgedRecording: context.recorded,
      },
      requestedDurationSec:
        args.requestedDurationSec ?? DEFAULT_SHARE_CLIP_DURATION_SEC,
    });

    if (!built.produced) {
      // Not a recorded call: no clip exists. Drop the orphaned upload; the
      // source recording (there is none) is untouched (Req 3.3).
      await ctx.storage.delete(args.storageId);
      return { status: "clip_unavailable", message: built.message };
    }

    // (2)/(3) Screening runs only when consent is granted; without consent the
    // availability decision short-circuits to `withheld_consent` regardless of
    // the screen (Req 3.4, 3.5), so we avoid the screening dependency entirely.
    let screening: ScreeningDecision;
    if (args.sharingConsent) {
      screening = await ctx.runAction(api.campus.safety.screenContent, {
        content: args.content,
        sourceId: context.callId,
        internalSecret: process.env.INTERNAL_API_KEY,
      });
    } else {
      screening = {
        moderationStatus: "approved",
        flagged: false,
        withheld: false,
        violatedPolicies: [],
      };
    }

    const availability = decideClipAvailability({
      sharingConsent: args.sharingConsent,
      screening,
      clip: built.clip,
    });

    if (availability.status !== "available") {
      // Withheld: drop the orphaned excerpt upload and retain the source
      // recording unchanged (Req 3.5, 3.7, 3.10).
      await ctx.storage.delete(args.storageId);
      const { shareClipId } = await ctx.runMutation(
        internal.campus.social.clips.persistShareClip,
        {
          sourceCallId: context.callId,
          agentId: context.agentId,
          durationSec: built.clip.durationSec,
          status: availability.status,
        }
      );
      return {
        status: availability.status,
        shareClipId,
        message: WITHHELD_MESSAGES[availability.status],
      };
    }

    // (4) Consented + clean: persist available and surface through the reused
    // share formats (Req 3.8).
    const { shareClipId } = await ctx.runMutation(
      internal.campus.social.clips.persistShareClip,
      {
        sourceCallId: context.callId,
        agentId: context.agentId,
        durationSec: availability.clip.durationSec,
        status: "available",
        storageId: args.storageId,
      }
    );

    const formats = assembleShareFormats(context.shareAgent, platformBaseUrl());
    return { status: "available", shareClipId, clip: availability.clip, formats };
  },
});

// ---------------------------------------------------------------------------
// generateClipUploadUrl — owner-gated storage upload URL for the excerpt
// ---------------------------------------------------------------------------

/**
 * Mints a short-lived Convex storage upload URL for the recorded clip excerpt
 * (Task 20.1). Owner-gated: only the Student_Creator who owns the Campus_Agent
 * that produced the source call may upload an excerpt, mirroring
 * `convex/campus/knowledge.ts` `generateUploadUrl`. The client uploads the
 * excerpt to this URL and then passes the returned `storageId` to
 * {@link generateShareClip}, which enforces Sharing_Consent and screens the
 * clip fail-closed before it is surfaced. This is the upload half of the
 * consent-gated Share_Clip pipeline the Share Clips surface wires in.
 */
export const generateClipUploadUrl = mutation({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedAgent(ctx, args.agentId);
    return await ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// discardClipSuggestion — discard path (Req 3.11)
// ---------------------------------------------------------------------------

/**
 * Discards a Clip_Suggestion without generating a Share_Clip (Req 3.11). The
 * suggested placeholder row (if any) is marked `discarded`; no clip is produced
 * and the source recording is retained unchanged. Owner-gated.
 */
export const discardClipSuggestion = mutation({
  args: { shareClipId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("campusShareClips")
      .withIndex("by_share_clip_id", (q) => q.eq("shareClipId", args.shareClipId))
      .first();
    if (!row) {
      return { ok: false as const, reason: "not_found" as const };
    }
    // Owner-gate: only the owning Student_Creator may discard the suggestion.
    await requireOwnedAgent(ctx, row.agentId);
    await ctx.db.patch(row._id, { status: "discarded" });
    // The source recording is a separate entity and is left untouched.
    return { ok: true as const, shareClipId: args.shareClipId };
  },
});
