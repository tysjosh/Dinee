"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Feature: dinee-campus (Task 30.1) — `ShareSheet`.
 *
 * The share surface for a published Campus_Agent, opened from the
 * Agent_Profile_Page share button (Req 6.2, 6.8). It presents every share
 * format the Share_Service assembles (Req 7.3, 7.4):
 *   - copy-link action with an inline confirmation (Req 7.5);
 *   - a QR code encoding the Call_Link (Req 7.3);
 *   - an SMS / iMessage share (Req 7.3);
 *   - Instagram / TikTok / Snapchat social captions (Req 7.3);
 *   - an embeddable visual card (Req 7.4);
 *   - and the Instagram/TikTok/Snapchat Share_Card previews carrying the agent
 *     name, campus tag, agent type, the "AI voice agent" label, and the
 *     Call_Link (Req 15.14).
 *
 * All formats come from `Share_Service.getShareFormats` and the Share_Card from
 * `Share_Service.getShareCard`, both access-gated by the same slug (+ optional
 * Private_Link token) as the profile, so the sheet never discloses content for
 * an agent the caller cannot see. Each successful share action records a `share`
 * analytics event via `Share_Service.recordShare` (Req 9.1).
 *
 * Rendered as a mobile-first bottom sheet: it never scrolls horizontally at
 * 360px and every interactive control meets the 44×44 CSS-pixel touch target.
 */

interface ShareSheetProps {
  /** The agent's Call_Link slug (Req 6.8). */
  readonly slug: string;
  /** Optional Private_Link token, forwarded so a private agent stays shareable. */
  readonly token?: string;
  /** The public agent id, used to record share analytics events (Req 9.1). */
  readonly agentId?: string;
  /** Display name for headings / QR alt text. */
  readonly agentName: string;
  /** Closes the sheet. */
  readonly onClose: () => void;
}

/** A copy-to-clipboard button that shows an inline "Copied" confirmation. */
function CopyButton({
  value,
  label,
  onCopied,
  testId,
}: {
  value: string;
  label: string;
  onCopied?: () => void;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); the value stays
      // visible on screen so the caller can still copy it manually.
    }
    setCopied(true);
    onCopied?.();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [value, onCopied]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="btn btn-outline btn-sm min-h-[44px] min-w-[44px] shrink-0"
      data-testid={testId}
      aria-live="polite"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** The three social platforms the share formats and Share_Card cover. */
const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "snapchat", label: "Snapchat" },
] as const;

export function ShareSheet({
  slug,
  token,
  agentId,
  agentName,
  onClose,
}: ShareSheetProps) {
  const formatsResult = useQuery(api.campus.share.getShareFormats, {
    slug,
    token,
  });
  const cardResult = useQuery(api.campus.share.getShareCard, { slug, token });
  const recordShare = useMutation(api.campus.share.recordShare);

  /** Records a share analytics event (best-effort; never blocks the UI). */
  const noteShare = useCallback(() => {
    if (!agentId) return;
    void recordShare({ agentId }).catch(() => {
      // Analytics are best-effort — a failed record must not break sharing.
    });
  }, [agentId, recordShare]);

  const loading = formatsResult === undefined;
  const unavailable = formatsResult !== undefined && !formatsResult.available;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${agentName}`}
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close share sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      {/* Sheet */}
      <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-t-2xl border border-[var(--color-border-default)] bg-[var(--color-background-surface)] p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Share this agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-3 py-8 text-white/70">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span className="text-sm">Loading share options…</span>
          </div>
        )}

        {unavailable && (
          <p className="py-8 text-center text-sm text-white/60">
            Sharing isn&apos;t available for this agent right now.
          </p>
        )}

        {formatsResult?.available && (
          <div className="space-y-6">
            {/* Copy link + confirmation (Req 7.5) */}
            <section>
              <p className="mb-1.5 text-sm font-medium text-white/80">
                Call link
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={formatsResult.formats.callLink}
                  className="input w-full min-h-[44px]"
                  aria-label="Call link"
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="share-call-link"
                />
                <CopyButton
                  value={formatsResult.formats.callLink}
                  label="Copy"
                  onCopied={noteShare}
                  testId="share-copy-link"
                />
              </div>
            </section>

            {/* QR code (Req 7.3) — encodes the Call_Link payload. */}
            <section>
              <p className="mb-1.5 text-sm font-medium text-white/80">QR code</p>
              <div className="flex flex-col items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white p-4">
                {/* The QR image is rendered from the public Call_Link payload.
                    The raw payload is shown below as a fallback so the link is
                    always available even if the image fails to load. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    formatsResult.formats.qr.payload
                  )}`}
                  alt={`QR code that opens ${agentName}`}
                  width={180}
                  height={180}
                  className="h-[180px] w-[180px]"
                />
              </div>
              <p className="mt-1 break-all text-center text-[11px] text-white/40">
                {formatsResult.formats.qr.payload}
              </p>
            </section>

            {/* SMS / iMessage (Req 7.3) */}
            <section>
              <p className="mb-1.5 text-sm font-medium text-white/80">
                Text a friend
              </p>
              <div className="flex items-center gap-2">
                <a
                  href={`sms:?&body=${encodeURIComponent(
                    formatsResult.formats.sms.body
                  )}`}
                  onClick={noteShare}
                  className="btn btn-primary btn-md min-h-[44px] flex-1"
                  data-testid="share-sms"
                >
                  Share via SMS
                </a>
                <CopyButton
                  value={formatsResult.formats.sms.body}
                  label="Copy text"
                  onCopied={noteShare}
                />
              </div>
            </section>

            {/* Social captions (Req 7.3) */}
            <section>
              <p className="mb-1.5 text-sm font-medium text-white/80">
                Social captions
              </p>
              <div className="space-y-2">
                {SOCIAL_PLATFORMS.map(({ key, label }) => {
                  const format = formatsResult.formats[key];
                  return (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-2 rounded-lg border border-[var(--color-border-default)] p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="mt-0.5 break-words text-xs text-white/50">
                          {format.caption}
                        </p>
                      </div>
                      <CopyButton
                        value={format.caption}
                        label="Copy"
                        onCopied={noteShare}
                        testId={`share-social-${key}`}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Embeddable card (Req 7.4) */}
            <section>
              <p className="mb-1.5 text-sm font-medium text-white/80">
                Embed card
              </p>
              <textarea
                readOnly
                value={formatsResult.formats.embedCard.html}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-h-[72px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-background-muted)] px-3 py-2 font-mono text-[11px] text-white/80"
                aria-label="Embed card HTML"
                data-testid="share-embed"
              />
              <div className="mt-2 flex justify-end">
                <CopyButton
                  value={formatsResult.formats.embedCard.html}
                  label="Copy embed code"
                  onCopied={noteShare}
                />
              </div>
            </section>

            {/* Share_Card previews (Req 15.14) */}
            {cardResult?.available && (
              <section>
                <p className="mb-1.5 text-sm font-medium text-white/80">
                  Share card
                </p>
                <div className="space-y-3" data-testid="share-card">
                  {SOCIAL_PLATFORMS.map(({ key, label }) => {
                    const variant = cardResult.card[key];
                    return (
                      <div
                        key={key}
                        className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-accent)]/10 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="badge badge-accent">
                            {variant.label}
                          </span>
                          <span className="text-[11px] uppercase tracking-wide text-white/50">
                            {label}
                          </span>
                        </div>
                        <p className="mt-3 text-lg font-bold text-white">
                          {variant.agentName}
                        </p>
                        <p className="mt-0.5 text-xs text-white/60">
                          {variant.campusTag} · {variant.agentType}
                        </p>
                        <p className="mt-2 break-all text-[11px] text-white/40">
                          {variant.callLink}
                        </p>
                        <div className="mt-3 flex justify-end">
                          <CopyButton
                            value={variant.caption}
                            label="Copy caption"
                            onCopied={noteShare}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareSheet;
