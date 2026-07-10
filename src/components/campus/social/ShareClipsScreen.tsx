"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Share Clips screen (`/campus/social/clips`). Presents the Clip_Suggestion for
 * a completed call via the reused `onCallComplete` hook — a recorded, consented
 * call ≥ 20 s yields a suggestion, a call without Recording_Consent surfaces the
 * "recorded calls only" indication (Req 3.1, 3.3, 3.9) — and drives the
 * consent-gated discard path (Req 3.11) while retaining the source recording
 * unchanged. Sharing_Consent is captured here as the prerequisite for producing
 * the shareable clip (Req 3.4); the excerpt-to-clip generation
 * (`generateShareClip`) runs from the recorded excerpt supplied here — the
 * excerpt is uploaded to Convex storage via `generateClipUploadUrl`, then
 * `generateShareClip` enforces Sharing_Consent, builds the clip through the
 * reused Call_Clip pipeline, screens it fail-closed, and surfaces only a clean
 * clip through the share formats (Task 20.1; Req 3.2, 3.4–3.8, 3.10, 8.2). Every
 * withheld/discard path retains the source recording unchanged (Req 7.9).
 *
 * Task 20.1: a Share_Clip comes from a recorded call and is then shared, so both
 * the applicable Recording_Consent and Sharing_Consent prompts are presented via
 * `useSocial` and both are required before a clip is generated; without either
 * nothing is produced and the source recording is retained unchanged
 * (Req 7.8, 7.9).
 */

import React, { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSocial } from "./SocialContext";
import {
  Card,
  ConsentPrompt,
  Field,
  SocialButton,
  SocialInput,
  StatusNotice,
} from "./ui";

type Notice = { tone: "warning" | "danger" | "neutral"; title: string; body?: string };

interface Suggestion {
  shareClipId: string;
  sourceCallId: string;
  agentId: string;
}

export function ShareClipsScreen() {
  const { hasConsent, setConsent } = useSocial();
  const onCallComplete = useAction(api.campus.social.clips.onCallComplete);
  const discardClipSuggestion = useMutation(api.campus.social.clips.discardClipSuggestion);
  const generateClipUploadUrl = useMutation(api.campus.social.clips.generateClipUploadUrl);
  const generateShareClip = useAction(api.campus.social.clips.generateShareClip);

  const [callId, setCallId] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const excerptInputRef = useRef<HTMLInputElement | null>(null);

  async function handleCheck() {
    setNotice(null);
    setSuggestion(null);
    setBusy(true);
    try {
      const res = await onCallComplete({ callId: callId.trim() });
      if (res.suggested) {
        setSuggestion({ shareClipId: res.shareClipId, sourceCallId: res.sourceCallId, agentId: res.agentId });
        setNotice({ tone: "neutral", title: "Clip suggestion ready", body: "Grant sharing consent to turn it into a ready-to-post clip." });
      } else if (res.reason === "no_recording_consent") {
        setNotice({ tone: "warning", title: "A clip is available only for recorded calls", body: res.message });
      } else {
        setNotice({ tone: "warning", title: "No clip suggested", body: res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!suggestion) return;
    setNotice(null);
    setBusy(true);
    try {
      await discardClipSuggestion({ shareClipId: suggestion.shareClipId });
      setSuggestion(null);
      setNotice({ tone: "neutral", title: "Suggestion discarded", body: "No clip was generated. The source recording is unchanged." });
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!suggestion) return;
    // A Share_Clip is generated from a recorded call, then shared, so BOTH the
    // applicable Recording_Consent and Sharing_Consent must be granted before it
    // is generated (Req 7.8). Without either, nothing is produced and the source
    // recording is retained unchanged (Req 7.9). This mirrors the server-side
    // gate in `generateShareClip`.
    if (!hasConsent("recording")) {
      setNotice({ tone: "warning", title: "Recording consent required", body: "Confirm the source call was recorded with consent before generating a clip." });
      return;
    }
    if (!hasConsent("sharing")) {
      setNotice({ tone: "warning", title: "Sharing consent required", body: "Grant sharing consent before generating a clip." });
      return;
    }
    const excerpt = excerptInputRef.current?.files?.[0];
    if (!excerpt) {
      setNotice({ tone: "warning", title: "Attach the recorded excerpt", body: "Choose the recorded clip excerpt to turn it into a shareable clip." });
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      // Upload the recorded excerpt to Convex storage (owner-gated), then hand
      // its storageId to the consent-gated, fail-closed `generateShareClip`.
      const uploadUrl = await generateClipUploadUrl({ agentId: suggestion.agentId });
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": excerpt.type || "application/octet-stream" },
        body: excerpt,
      });
      if (!uploaded.ok) {
        throw new Error("upload_failed");
      }
      const { storageId } = (await uploaded.json()) as { storageId: string };

      const res = await generateShareClip({
        callId: suggestion.sourceCallId,
        storageId: storageId as unknown as never,
        sharingConsent: hasConsent("sharing"),
        content: caption.trim(),
      });

      if (res.status === "available") {
        setSuggestion(null);
        setNotice({ tone: "neutral", title: "Clip ready to post", body: "Your captioned clip is available to share to TikTok, Reels, and Snap." });
      } else if (res.status === "withheld_policy") {
        setNotice({ tone: "danger", title: "Clip violated content policy", body: res.message });
      } else if (res.status === "withheld_screening_error") {
        setNotice({ tone: "warning", title: "Screening could not complete", body: res.message });
      } else if (res.status === "withheld_consent") {
        setNotice({ tone: "warning", title: "Sharing consent required", body: res.message });
      } else {
        // clip_unavailable — the source call was not recorded.
        setNotice({ tone: "warning", title: "A clip is available only for recorded calls", body: res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {notice ? <StatusNotice tone={notice.tone} title={notice.title} body={notice.body} testId="clip-notice" /> : null}

      {!hasConsent("recording") ? (
        <ConsentPrompt
          kind="recording"
          title="Recording consent"
          body="A clip can only come from a call recorded with consent. Confirm recording consent for the source call."
          onGrant={() => setConsent("recording", true)}
          onDecline={() => setConsent("recording", false)}
        />
      ) : null}

      {!hasConsent("sharing") ? (
        <ConsentPrompt
          kind="sharing"
          title="Sharing consent"
          body="Before a clip is generated or shared, you must consent to sharing this interaction."
          onGrant={() => setConsent("sharing", true)}
          onDecline={() => setConsent("sharing", false)}
        />
      ) : (
        <StatusNotice tone="neutral" title="Sharing consent granted" body="A suggested clip can be turned into a ready-to-post clip." testId="clip-consent-granted" />
      )}

      <Card>
        <h2 className="text-lg font-semibold text-white">Turn a call into a clip</h2>
        <p className="mt-1 text-sm text-white/70">
          Recorded calls of 20 seconds or more can become a 10–20 second captioned clip, labeled &ldquo;AI voice agent&rdquo;.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Call ID" htmlFor="clip-call">
            <SocialInput id="clip-call" value={callId} onChange={(e) => setCallId(e.target.value)} placeholder="call id" data-testid="clip-call" />
          </Field>
          <SocialButton onClick={handleCheck} disabled={busy || callId.trim().length === 0} data-testid="clip-check">
            {busy ? "Checking…" : "Check for a clip"}
          </SocialButton>
        </div>
      </Card>

      {suggestion ? (
        <Card className="space-y-3">
          <div data-testid="clip-suggestion">
            <h2 className="text-lg font-semibold text-white">Clip suggestion</h2>
            <p className="mt-1 text-sm text-white/70">From call {suggestion.sourceCallId}, attributed to {suggestion.agentId}.</p>
          </div>
          <Field label="Recorded excerpt" htmlFor="clip-excerpt">
            <input
              ref={excerptInputRef}
              id="clip-excerpt"
              type="file"
              accept="audio/*,video/*"
              className="input"
              data-testid="clip-excerpt"
            />
          </Field>
          <Field label="Caption" htmlFor="clip-caption">
            <SocialInput
              id="clip-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption for the clip"
              data-testid="clip-caption"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SocialButton
              onClick={handleGenerate}
              disabled={busy || !hasConsent("recording") || !hasConsent("sharing")}
              data-testid="clip-generate"
              title={hasConsent("recording") && hasConsent("sharing") ? undefined : "Grant recording and sharing consent first"}
            >
              Make shareable clip
            </SocialButton>
            <SocialButton variant="outline" onClick={handleDiscard} disabled={busy} data-testid="clip-discard">
              Discard
            </SocialButton>
          </div>
          {!hasConsent("recording") || !hasConsent("sharing") ? (
            <p className="text-xs text-white/60">Grant recording and sharing consent above to enable clip generation.</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

export default ShareClipsScreen;
