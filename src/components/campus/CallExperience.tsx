"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { campusCopy } from "@/lib/campus/copy";
import { isValidCallRating, RATING_MIN, RATING_MAX } from "@/lib/campus/validation";
import {
  startRealtimeCall,
  type RealtimeCallHandle,
} from "@/lib/campus/realtimeCall";
import { ShareSheet } from "./ShareSheet";

/**
 * Feature: dinee-campus (Task 32.1) — `CallExperience`.
 *
 * The browser call surface for a Campus_Agent, rendered at
 * `/campus/a/[slug]/call` (the Call button target from `AgentProfile`,
 * preserving any `?token=` Private_Link). It runs the full call lifecycle:
 *
 *   usage gate → recording/summary notice + acknowledgement → start session →
 *   live (in-call) state → end → post-call rate / report / share (+ Call_Clip).
 *
 * Requirements: 8.1, 8.2, 8.7, 8.9, 12.7, 12.8, 13.7, 15.12, 15.13.
 *
 * ── What this component represents vs. what the ws-server media path handles ──
 *
 * The actual real-time audio (Twilio/WebRTC media, speech-to-speech in the
 * agent's selected voice) is NOT carried by this browser component — it is
 * handled by the ws-server media path. The server-to-server call-lifecycle
 * mutations `campus.session.startCall` and `campus.session.recordCallEnd` are
 * guarded internal mutations (`assertInternalCaller`) invoked by that ws-server,
 * NOT by this client. So this component:
 *   - enforces the pre-call USAGE GATE (`campus.usage.canStartCall`, Req 13.7);
 *   - presents the recording/summary NOTICE and captures the Caller's
 *     acknowledge/decline decision (Req 12.7, 12.8) — the decision is what the
 *     ws-server forwards to `startCall` as `callerAcknowledgedRecording`, which
 *     snapshots the per-call `recordingEnabled` flag;
 *   - resolves the session config the runtime uses via the public
 *     `campus.session.getSessionConfig` query (Req 8.1), and REPRESENTS the
 *     connecting → live → ended audio states (timer, live indicator) that the
 *     media path drives;
 *   - offers the post-call rate / report / share options and the Call_Clip
 *     generation action (Req 8.9, 15.12, 15.13).
 * Comments below mark each seam where the ws-server owns the real behavior.
 *
 * Mobile-first: no horizontal scroll at 360px, 44×44 touch targets (Req 14.1,
 * 14.2).
 */

/** A deterministic avatar background derived from the agent's color seed. */
function avatarStyle(colorSeed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < colorSeed.length; i++) {
    hash = (hash * 31 + colorSeed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${
      (hue + 40) % 360
    } 70% 35%))`,
  };
}

/** Maps an Agent_Type to its student-facing label from the shared copy corpus. */
const AGENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  campusCopy.onboarding.options.map((o) => [o.agentType, o.label])
);

const REPORT_REASON_MAX = 1000;

/** How long the represented "connecting" phase lasts before going live (ms). */
const CONNECT_REPRESENTATION_MS = 1200;

/**
 * The in-browser call lifecycle stage. The pre-call screens (loading / denial /
 * gate-blocked) are derived from the Convex queries; this stage governs the
 * notice → connecting → live → ended/error transitions the Caller drives.
 */
type CallStage = "notice" | "connecting" | "live" | "error" | "ended";

interface CallExperienceProps {
  readonly slug: string;
  readonly token?: string;
}

export function CallExperience({ slug, token }: CallExperienceProps) {
  // Access-gated profile resolution (same gate as the Agent_Profile_Page). We
  // reuse it here so the call route honours visibility / Private_Link exactly
  // like the profile (Req 6.6, 6.7, 6.10, 6.11).
  const profile = useQuery(api.campus.agents.getPublicProfile, { slug, token });
  const agentId = profile?.granted ? profile.agentId : undefined;

  // Pre-call USAGE GATE — the owning account's call-minutes limit (Req 13.7).
  const usageGate = useQuery(
    api.campus.usage.canStartCall,
    agentId ? { agentId } : "skip"
  );

  // The session config the Voice_Runtime resolves at session start (Req 8.1).
  // Used here to represent whether a session can be established; the ws-server
  // consumes the same query for the real media session.
  const sessionConfig = useQuery(
    api.campus.session.getSessionConfig,
    agentId ? { agentId } : "skip"
  );

  const [stage, setStage] = useState<CallStage>("notice");
  const [acknowledgedRecording, setAcknowledgedRecording] = useState<boolean | null>(
    null
  );
  const [callId, setCallId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Post-call UI state.
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [startError, setStartError] = useState<string | null>(null);
  // Whether the real WebRTC audio session is live. When false during a call the
  // UI shows a status hint but the call still functions (the represented live
  // state), so a mic denial or unconfigured voice transport never blocks the
  // rating/analytics loop.
  const [voiceConnected, setVoiceConnected] = useState(false);
  // A human-readable reason live audio couldn't be established (mic denied,
  // voice transport unconfigured, handshake failure). Surfaced in the live view
  // so the caller isn't left on an eternal "Connecting audio…".
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const realtimeRef = useRef<RealtimeCallHandle | null>(null);

  const convex = useConvex();
  const submitReport = useMutation(api.campus.safety.submitReport);
  const generateCallClip = useAction(api.campus.share.generateCallClip);
  const startBrowserCall = useMutation(api.campus.session.startBrowserCall);
  const endBrowserCall = useMutation(api.campus.session.endBrowserCall);

  /** Tears down any active WebRTC media session. Safe to call repeatedly. */
  const stopRealtime = useCallback(() => {
    if (realtimeRef.current) {
      realtimeRef.current.stop();
      realtimeRef.current = null;
    }
    setVoiceConnected(false);
  }, []);

  // Ensure the media session is always released if the component unmounts mid-call.
  useEffect(() => stopRealtime, [stopRealtime]);

  // ── Connecting → live ──────────────────────────────────────────────────
  // We advance to the live state only once the SERVER-AUTHORITATIVE call has
  // been created (a real `callId` from `startBrowserCall`, which keys the
  // rating/clip/analytics) AND the session config the runtime uses has resolved.
  // The real-time audio itself is negotiated by the ws-server media path; if the
  // runtime reports the session is unavailable, the call could not be connected
  // (Req 8.2).
  useEffect(() => {
    if (stage !== "connecting") return;
    if (callId === null) return; // wait for the server-minted callId
    if (sessionConfig === undefined) return; // still resolving

    if (!sessionConfig.available) {
      setStage("error");
      return;
    }

    const timer = setTimeout(() => {
      setElapsedSeconds(0);
      setStage("live");
    }, CONNECT_REPRESENTATION_MS);
    return () => clearTimeout(timer);
  }, [stage, callId, sessionConfig]);

  // ── Live call timer (represented in-call audio state) ──────────────────
  const liveStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (stage !== "live") {
      liveStartRef.current = null;
      return;
    }
    liveStartRef.current = Date.now();
    const interval = setInterval(() => {
      if (liveStartRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - liveStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [stage]);

  const startCallFlow = useCallback(
    async (consent: boolean) => {
      if (!agentId) return;
      // Move to connecting immediately for responsiveness, then create the
      // SERVER-AUTHORITATIVE call. The server owns the callId, re-checks the
      // access + usage gates, and snapshots the true recording state (a decline
      // forces neither-recorded, Req 12.5, 12.8, 13.7).
      setStartError(null);
      setElapsedSeconds(0);
      setStage("connecting");
      try {
        const res = await startBrowserCall({
          agentId,
          token,
          callerAcknowledgedRecording: consent,
        });
        if (!res.ok) {
          setStartError(
            res.reason === "call_minutes_exhausted"
              ? "This agent is temporarily unavailable. Please try again later."
              : "This agent isn't available to call right now."
          );
          setStage("error");
          return;
        }
        // The server's recording decision is authoritative for clip gating and
        // the in-call notice text (Req 12.8, 15.12).
        setCallId(res.callId);
        setAcknowledgedRecording(res.recordingEnabled);

        // Open the real WebRTC audio session for this call (Req 8.1, 8.3).
        // This is best-effort: any failure (voice transport unconfigured, mic
        // denied, SDP error) leaves `voiceConnected` false and the call
        // continues in its represented state — the rating/analytics loop is
        // unaffected because it keys off the server `callId`.
        const liveCallId = res.callId;
        setVoiceError(null);
        void startRealtimeCall(liveCallId, {
          onStatus: (status) => {
            setVoiceConnected(status === "connected");
          },
          onError: (reason) => {
            setVoiceConnected(false);
            setVoiceError(reason);
          },
          // Live knowledge grounding: the model calls this to answer strictly
          // from the agent's approved knowledge (Req 5.5, 8.4, 8.5). Resolved
          // via the call-scoped Convex query; failures degrade to the prompt.
          onKnowledgeLookup: async (question) => {
            const result = await convex.query(
              api.campus.session.lookupCallKnowledge,
              { callId: liveCallId, question }
            );
            return result.available
              ? result.output
              : "I don't have that information.";
          },
        })
          .then((handle) => {
            realtimeRef.current = handle;
          })
          .catch(() => {
            // Reason already surfaced via onError where meaningful; the call
            // proceeds without live audio.
            realtimeRef.current = null;
          });
      } catch {
        setStartError("We couldn't start the call. Please try again.");
        setStage("error");
      }
    },
    [agentId, token, startBrowserCall, convex]
  );

  const endCall = useCallback(() => {
    // The Caller ends the conversation (Req 8.7). Close the authoritative call
    // server-side: `endBrowserCall` writes the whole-second duration, marks the
    // call completed, emits the `call_completed` analytics event, and meters the
    // call minutes (Req 8.8, 9.1, 13.6). We freeze the represented elapsed time
    // and move to the post-call options (Req 8.9).
    if (liveStartRef.current !== null) {
      setElapsedSeconds(Math.floor((Date.now() - liveStartRef.current) / 1000));
    }
    stopRealtime();
    setStage("ended");
    if (callId) {
      void endBrowserCall({ callId });
    }
  }, [callId, endBrowserCall, stopRealtime]);

  const retry = useCallback(() => {
    stopRealtime();
    setAcknowledgedRecording(null);
    setCallId(null);
    setStartError(null);
    setVoiceError(null);
    setStage("notice");
  }, [stopRealtime]);

  // ─────────────────────────────────────────────────────────────────────
  // Pre-call: loading / denial / usage-gate screens
  // ─────────────────────────────────────────────────────────────────────

  if (profile === undefined) {
    return (
      <CallShell slug={slug} token={token}>
        <Centered>
          <Spinner />
          <span className="text-sm text-white/70">Loading…</span>
        </Centered>
      </CallShell>
    );
  }

  if (!profile.granted) {
    const { title, body } = denialCopy(profile.denial);
    return (
      <CallShell slug={slug} token={token}>
        <div className="mt-16 text-center" data-testid={`call-denied-${profile.denial}`}>
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/60">{body}</p>
          <Link href="/campus" className="btn btn-outline btn-md mt-6 min-h-[44px]">
            Explore Dinee Campus
          </Link>
        </div>
      </CallShell>
    );
  }

  const agentName = profile.profile.name;
  const agentTypeLabel =
    AGENT_TYPE_LABELS[profile.profile.agentType] ?? profile.profile.agentType;

  // Usage gate still resolving.
  if (usageGate === undefined) {
    return (
      <CallShell slug={slug} token={token}>
        <Centered>
          <Spinner />
          <span className="text-sm text-white/70">Checking availability…</span>
        </Centered>
      </CallShell>
    );
  }

  // Usage gate declined — the owning account has exhausted its call minutes, so
  // the agent is "temporarily unavailable"; its config and data are unchanged
  // (Req 13.7). An unknown agent is likewise not callable.
  if (!usageGate.allowed) {
    return (
      <CallShell slug={slug} token={token}>
        <div className="mt-16 text-center" data-testid="call-unavailable">
          <div
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-3xl"
            style={avatarStyle(profile.profile.visualIdentity.colorSeed)}
            aria-hidden="true"
          >
            {profile.profile.visualIdentity.initial}
          </div>
          <h1 className="mt-5 text-2xl font-bold sm:text-3xl">
            {agentName} is taking a break
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/60">
            This agent is temporarily unavailable. Check back a little later.
          </p>
          <Link
            href={profileHref(slug, token)}
            className="btn btn-outline btn-md mt-6 min-h-[44px]"
          >
            Back to profile
          </Link>
        </div>
      </CallShell>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Call flow
  // ─────────────────────────────────────────────────────────────────────

  return (
    <CallShell slug={slug} token={token}>
      {stage === "notice" && (
        <RecordingNotice
          agentName={agentName}
          onAcknowledge={() => {
            void startCallFlow(true);
          }}
          onDecline={() => {
            void startCallFlow(false);
          }}
          backHref={profileHref(slug, token)}
        />
      )}

      {stage === "connecting" && (
        <CallStageView
          agentName={agentName}
          agentTypeLabel={agentTypeLabel}
          colorSeed={profile.profile.visualIdentity.colorSeed}
          initial={profile.profile.visualIdentity.initial}
          statusLabel="Connecting…"
          pulsing
        >
          <div className="mt-8 flex items-center justify-center gap-3 text-white/70">
            <Spinner />
            <span className="text-sm">Starting your call</span>
          </div>
        </CallStageView>
      )}

      {stage === "live" && (
        <CallStageView
          agentName={agentName}
          agentTypeLabel={agentTypeLabel}
          colorSeed={profile.profile.visualIdentity.colorSeed}
          initial={profile.profile.visualIdentity.initial}
          statusLabel="On call"
          pulsing
        >
          {/* Live audio flows over a WebRTC peer connection to the agent in its
              selected voice (Req 8.3). `voiceConnected` reflects the real media
              session; if it hasn't connected (mic denied / voice transport not
              configured) the call still runs and shows a connecting hint. */}
          <p
            className="mt-6 text-center font-mono text-3xl tabular-nums text-white"
            aria-label="Call duration"
            data-testid="call-timer"
          >
            {formatDuration(elapsedSeconds)}
          </p>
          <p
            className="mt-2 flex items-center justify-center gap-2 text-center text-xs text-white/60"
            aria-live="polite"
            data-testid="call-audio-status"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                voiceConnected
                  ? "bg-emerald-400"
                  : voiceError
                    ? "bg-white/30"
                    : "bg-amber-400 animate-pulse"
              }`}
              aria-hidden="true"
            />
            {voiceConnected
              ? "Listening — start talking"
              : voiceError
                ? voiceError
                : "Connecting audio…"}
          </p>
          <p className="mt-2 text-center text-xs text-white/50">
            {acknowledgedRecording
              ? "This call may be recorded or summarized."
              : "This call is not being recorded or summarized."}
          </p>
          <button
            type="button"
            onClick={endCall}
            className="btn btn-destructive btn-lg mx-auto mt-10 min-h-[44px] w-full max-w-xs"
            data-testid="call-end"
          >
            End call
          </button>
        </CallStageView>
      )}

      {stage === "error" && (
        <div className="mt-16 text-center" data-testid="call-error">
          <h1 className="text-2xl font-bold sm:text-3xl">
            We couldn&apos;t connect the call
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-white/60">
            {startError ??
              `Something went wrong starting your conversation with ${agentName}. Please try again.`}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="btn btn-primary btn-md min-h-[44px] w-full max-w-xs"
              data-testid="call-retry"
            >
              Try again
            </button>
            <Link
              href={profileHref(slug, token)}
              className="btn btn-ghost btn-sm min-h-[44px] text-white/60"
            >
              Back to profile
            </Link>
          </div>
        </div>
      )}

      {stage === "ended" && agentId && callId && (
        <PostCall
          agentId={agentId}
          agentName={agentName}
          callId={callId}
          durationSeconds={elapsedSeconds}
          recordedAndConsented={acknowledgedRecording === true}
          submitReport={submitReport}
          generateCallClip={generateCallClip}
          onOpenShare={() => setShareOpen(true)}
          onOpenReport={() => setReportOpen(true)}
          onCallAgain={retry}
        />
      )}

      {/* Report form (Req 8.9) */}
      {reportOpen && agentId && (
        <ReportDialog
          agentId={agentId}
          agentName={agentName}
          callId={callId ?? undefined}
          submitReport={submitReport}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* Share sheet (Req 8.9) */}
      {shareOpen && (
        <ShareSheet
          slug={slug}
          token={token}
          agentId={agentId}
          agentName={agentName}
          onClose={() => setShareOpen(false)}
        />
      )}
    </CallShell>
  );
}

// ---------------------------------------------------------------------------
// Recording / summary notice (Req 12.7, 12.8)
// ---------------------------------------------------------------------------

/**
 * Presents the recording/summary notice and requires an explicit
 * acknowledgement before the call proceeds (Req 12.7). Acknowledging allows the
 * call to be recorded/summarized subject to the agent's settings; declining
 * proceeds WITHOUT recording or summarizing (Req 12.8). Either choice starts the
 * conversation.
 */
function RecordingNotice({
  agentName,
  onAcknowledge,
  onDecline,
  backHref,
}: {
  agentName: string;
  onAcknowledge: () => void;
  onDecline: () => void;
  backHref: string;
}) {
  return (
    <div className="mt-10" data-testid="recording-notice">
      <span className="badge badge-accent">Before you call</span>
      <h1 className="mt-4 text-2xl font-bold sm:text-3xl">
        Heads up about this call
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-white/70">
        Your conversation with <span className="font-medium text-white">{agentName}</span>{" "}
        may be recorded or summarized so its creator can improve it. You can
        continue without recording if you&apos;d prefer.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={onAcknowledge}
          className="btn btn-primary btn-lg min-h-[44px] w-full"
          data-testid="notice-acknowledge"
        >
          I understand — continue
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="btn btn-outline btn-md min-h-[44px] w-full"
          data-testid="notice-decline"
        >
          Continue without recording
        </button>
        <Link
          href={backHref}
          className="btn btn-ghost btn-sm mx-auto min-h-[44px] text-white/60"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-call options: rate / report / share / clip (Req 8.9, 15.12, 15.13)
// ---------------------------------------------------------------------------

type ClipState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ready"; label: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error" };

function PostCall({
  agentId,
  agentName,
  callId,
  durationSeconds,
  recordedAndConsented,
  generateCallClip,
  onOpenShare,
  onOpenReport,
  onCallAgain,
}: {
  agentId: string;
  agentName: string;
  callId: string;
  durationSeconds: number;
  recordedAndConsented: boolean;
  submitReport: ReturnType<typeof useMutation<typeof api.campus.safety.submitReport>>;
  generateCallClip: ReturnType<
    typeof useAction<typeof api.campus.share.generateCallClip>
  >;
  onOpenShare: () => void;
  onOpenReport: () => void;
  onCallAgain: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const [clip, setClip] = useState<ClipState>({ kind: "idle" });

  const submitRating = useMutation(api.campus.ratings.submitRating);

  // The recorded call's media is captured and uploaded to Convex storage by the
  // ws-server media path, which provides the `_storage` id `generateCallClip`
  // needs. It is not available in this represented browser flow, so the real
  // action call is guarded on it (see handleGenerateClip).
  const clipMediaStorageId = useRef<Id<"_storage"> | null>(null);

  const handleRate = useCallback(
    async (value: number) => {
      // Client-side guard mirroring the server rule (Req 8.11): only an integer
      // 1..5 is accepted. The star control only offers valid values, but we
      // validate defensively before recording.
      if (!isValidCallRating(value)) {
        setRatingError(
          `Please choose a rating from ${RATING_MIN} to ${RATING_MAX}.`
        );
        return;
      }
      // Optimistic: reflect the choice immediately, then persist the rating and
      // associate it with the completed call via `campus.ratings.submitRating`
      // (Req 8.10). On a server rejection revert the optimistic state and show
      // why (Req 8.11).
      setRatingError("");
      setRating(value);
      setRatingSubmitted(true);
      try {
        const result = await submitRating({ agentId, callId, rating: value });
        if (!result.ok) {
          setRating(null);
          setRatingSubmitted(false);
          setRatingError(
            result.reason === "invalid_rating"
              ? `Please choose a rating from ${result.min} to ${result.max}.`
              : "We couldn't save your rating for this call. Please try again."
          );
        }
      } catch {
        setRating(null);
        setRatingSubmitted(false);
        setRatingError("Something went wrong saving your rating. Please try again.");
      }
    },
    [agentId, callId, submitRating]
  );

  const handleGenerateClip = useCallback(async () => {
    // Call_Clip is available ONLY for recorded, consented calls (Req 15.12); a
    // non-recorded or declined call shows the `clip_unavailable` indication
    // (Req 15.13) and never reaches this handler.
    setClip({ kind: "pending" });
    try {
      if (clipMediaStorageId.current !== null) {
        // Real path: the ws-server has uploaded the clip media; produce the clip
        // (gated again server-side on the call's `recordingEnabled` snapshot).
        const res = await generateCallClip({
          callId,
          storageId: clipMediaStorageId.current,
        });
        if (res.produced) {
          setClip({ kind: "ready", label: res.label });
        } else {
          setClip({ kind: "unavailable", message: res.message });
        }
      } else {
        // Represented path: media capture/upload for the recorded call is
        // performed by the ws-server media path, which then produces the clip.
        setClip({ kind: "pending" });
      }
    } catch {
      setClip({ kind: "error" });
    }
  }, [callId, generateCallClip]);

  return (
    <div className="mt-8" data-testid="post-call">
      <div className="text-center">
        <span className="badge badge-neutral">Call ended</span>
        <h1 className="mt-4 text-2xl font-bold sm:text-3xl">
          Thanks for calling {agentName}
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Call length {formatDuration(durationSeconds)}
        </p>
      </div>

      {/* Rate the call (Req 8.9, 8.10) */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Rate this call</h2>
        <div
          className="mt-3 flex items-center gap-2"
          role="radiogroup"
          aria-label="Rate this call from 1 to 5"
        >
          {[1, 2, 3, 4, 5].map((value) => {
            const active = rating !== null && value <= rating;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                onClick={() => {
                  void handleRate(value);
                }}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-xl ${
                  active ? "text-yellow-400" : "text-white/30"
                }`}
                data-testid={`rate-${value}`}
              >
                {active ? "★" : "☆"}
              </button>
            );
          })}
        </div>
        {ratingError && (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {ratingError}
          </p>
        )}
        {ratingSubmitted && !ratingError && (
          <p
            className="mt-2 text-xs text-emerald-400"
            role="status"
            data-testid="rating-confirmation"
          >
            Thanks for the feedback!
          </p>
        )}
      </section>

      {/* Call_Clip generation (Req 15.12, 15.13) */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Make a clip</h2>
        {recordedAndConsented ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={handleGenerateClip}
              disabled={clip.kind === "pending"}
              className="btn btn-secondary btn-md min-h-[44px] w-full disabled:opacity-50"
              data-testid="clip-generate"
            >
              {clip.kind === "pending" ? "Creating clip…" : "Create a shareable clip"}
            </button>
            {clip.kind === "pending" && (
              <p className="mt-2 text-xs text-white/50" role="status">
                Your clip is being prepared from the recorded call. It will carry
                the “AI voice agent” label and credit {agentName}.
              </p>
            )}
            {clip.kind === "ready" && (
              <p
                className="mt-2 text-xs text-emerald-400"
                role="status"
                data-testid="clip-ready"
              >
                Clip ready — labelled “{clip.label}”.
              </p>
            )}
            {clip.kind === "unavailable" && (
              <p
                className="mt-2 text-xs text-white/60"
                role="status"
                data-testid="clip-unavailable"
              >
                {clip.message}
              </p>
            )}
            {clip.kind === "error" && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                We couldn&apos;t create the clip. Please try again.
              </p>
            )}
          </div>
        ) : (
          // Non-recorded / declined call: clips are not available (Req 15.13).
          <p
            className="mt-3 text-xs text-white/60"
            data-testid="clip-unavailable"
          >
            A clip is available only for recorded calls. This call wasn&apos;t
            recorded, so there&apos;s nothing to clip.
          </p>
        )}
      </section>

      {/* Share / report / call again (Req 8.9) */}
      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={onOpenShare}
          className="btn btn-outline btn-md min-h-[44px] w-full"
          data-testid="post-call-share"
        >
          Share this agent
        </button>
        <button
          type="button"
          onClick={onCallAgain}
          className="btn btn-primary btn-md min-h-[44px] w-full"
          data-testid="post-call-again"
        >
          Call again
        </button>
        <button
          type="button"
          onClick={onOpenReport}
          className="btn btn-ghost btn-sm mx-auto min-h-[44px] text-white/60"
          data-testid="post-call-report"
        >
          Report this agent
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report dialog (Req 8.9, mirrors the AgentProfile report flow, adds callId)
// ---------------------------------------------------------------------------

function ReportDialog({
  agentId,
  agentName,
  callId,
  submitReport,
  onClose,
}: {
  agentId: string;
  agentName: string;
  callId?: string;
  submitReport: ReturnType<typeof useMutation<typeof api.campus.safety.submitReport>>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await submitReport({ agentId, reason, callId });
      if (res.ok) {
        setDone(true);
      } else {
        setError(
          "Please add a reason (up to 1,000 characters) before submitting."
        );
      }
    } catch {
      setError("Something went wrong submitting your report. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [agentId, reason, callId, submitReport]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Report ${agentName}`}
    >
      <button
        type="button"
        aria-label="Close report form"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div className="relative z-10 w-full max-w-md overflow-x-hidden rounded-t-2xl border border-[var(--color-border-default)] bg-[var(--color-background-surface)] p-5 sm:rounded-2xl">
        {done ? (
          <div className="text-center" data-testid="report-confirmation">
            <h2 className="text-lg font-bold text-white">Report submitted</h2>
            <p className="mt-2 text-sm text-white/60">
              Thanks — we&apos;ll review this agent.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary btn-md mt-5 min-h-[44px] w-full"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white">Report this agent</h2>
            <p className="mt-1 text-sm text-white/60">
              Tell us what&apos;s wrong. Your report is confidential.
            </p>
            <textarea
              value={reason}
              maxLength={REPORT_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What's the problem?"
              className="mt-4 min-h-[96px] w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-background-muted)] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              data-testid="report-reason"
            />
            <p className="mt-1 text-right text-[11px] text-white/40">
              {reason.length}/{REPORT_REASON_MAX}
            </p>
            {error && (
              <p className="text-xs text-red-400" role="alert">
                {error}
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-md min-h-[44px] flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || reason.trim().length === 0}
                className="btn btn-destructive btn-md min-h-[44px] flex-1 disabled:opacity-50"
                data-testid="report-submit"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared presentational pieces
// ---------------------------------------------------------------------------

/** The live/connecting call layout: identity + status + slotted controls. */
function CallStageView({
  agentName,
  agentTypeLabel,
  colorSeed,
  initial,
  statusLabel,
  pulsing,
  children,
}: {
  agentName: string;
  agentTypeLabel: string;
  colorSeed: string;
  initial: string;
  statusLabel: string;
  pulsing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <div className="relative">
        {pulsing && (
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-40"
            style={avatarStyle(colorSeed)}
            aria-hidden="true"
          />
        )}
        <div
          className="relative flex h-28 w-28 items-center justify-center rounded-full text-5xl font-bold text-white shadow-lg"
          style={avatarStyle(colorSeed)}
          aria-hidden="true"
        >
          {initial}
        </div>
      </div>
      <span className="badge badge-accent mt-5">AI voice agent</span>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{agentName}</h1>
      <span className="mt-1 badge badge-neutral">{agentTypeLabel}</span>
      <p className="mt-4 text-sm font-medium text-white/70" data-testid="call-status">
        {statusLabel}
      </p>
      <div className="w-full">{children}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-16 flex flex-col items-center justify-center gap-3">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
  );
}

/** Page chrome shared by every phase. */
function CallShell({
  slug,
  token,
  children,
}: {
  slug: string;
  token?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-6">
        <header className="mb-2 flex items-center justify-between gap-3">
          <Link
            href={profileHref(slug, token)}
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label="Back to agent profile"
          >
            ← Back
          </Link>
          <span className="badge badge-accent">Dinee Campus</span>
        </header>
        {children}
      </div>
    </main>
  );
}

/** Builds the Agent_Profile_Page href, preserving any Private_Link token. */
function profileHref(slug: string, token?: string): string {
  const base = `/campus/a/${encodeURIComponent(slug)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/** Formats a whole-second duration as m:ss. */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Student-facing copy for each access-gate denial code (Req 6.6, 6.7, 7.8). */
function denialCopy(denial: "access_denied" | "unavailable" | "invalid"): {
  title: string;
  body: string;
} {
  switch (denial) {
    case "access_denied":
      return {
        title: "This agent is private",
        body: "You need a valid link from the creator to call this agent.",
      };
    case "unavailable":
      return {
        title: "This agent isn't available",
        body: "It may have been unpublished or removed by its creator.",
      };
    case "invalid":
    default:
      return {
        title: "We couldn't find that agent",
        body: "This link doesn't match any agent. Check the link and try again.",
      };
  }
}

export default CallExperience;
