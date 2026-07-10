"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Shared, accessible UI primitives for the Campus Social Loops surface. Every
 * interactive control on the six social screens is built from these primitives
 * (never a raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<a>`), which is
 * what lets the accessibility tests (Tasks 19.2–19.5) guarantee, transitively,
 * that every control on every screen satisfies the WCAG-AA obligations from
 * Requirements 8.7–8.10:
 *
 *   - ≥ 44×44 CSS px touch target on every control ({@link TOUCH_TARGET}, Req 8.8)
 *   - a visible keyboard focus indicator on every control ({@link FOCUS_RING} or
 *     the design system `btn` `:focus-visible` ring, Req 8.10)
 *   - reduced-motion honoured on every transition ({@link MOTION_SAFE_TRANSITION}, Req 8.10)
 *
 * Everything is composed from the established design system (`btn`, `card`,
 * `input`, `badge`) and Tailwind v4 CSS-first tokens, matching the rest of
 * Campus.
 */

import React from "react";
import Link from "next/link";
import {
  TOUCH_TARGET,
  FOCUS_RING,
  MOTION_SAFE_TRANSITION,
  NO_X_SCROLL_CONTAINER,
} from "./a11y";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type BtnSize = "sm" | "md" | "lg";

export interface SocialButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
}

/**
 * A design-system button that always meets the 44×44 touch-target floor and
 * carries the `btn` `:focus-visible` ring. `type` defaults to `button` so it is
 * never an accidental form submit.
 */
export function SocialButton({
  variant = "primary",
  size = "md",
  className,
  type,
  children,
  ...rest
}: SocialButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "btn",
        `btn-${variant}`,
        `btn-${size}`,
        TOUCH_TARGET,
        MOTION_SAFE_TRANSITION,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SocialLinkButtonProps
  extends Omit<React.ComponentProps<typeof Link>, "className"> {
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
}

/** A `next/link` styled as a design-system button with the same a11y contract. */
export function SocialLinkButton({
  variant = "outline",
  size = "md",
  className,
  children,
  ...rest
}: SocialLinkButtonProps) {
  return (
    <Link
      className={cx(
        "btn",
        `btn-${variant}`,
        `btn-${size}`,
        TOUCH_TARGET,
        MOTION_SAFE_TRANSITION,
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

export interface SocialCardLinkProps
  extends Omit<React.ComponentProps<typeof Link>, "className"> {
  className?: string;
}

/** A `next/link` rendered as a selectable card, with an explicit focus ring. */
export function SocialCardLink({
  className,
  children,
  ...rest
}: SocialCardLinkProps) {
  return (
    <Link
      className={cx(
        "card card-content block",
        TOUCH_TARGET,
        FOCUS_RING,
        MOTION_SAFE_TRANSITION,
        "hover:border-[var(--color-primary)]",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

export interface SocialInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** A design-system text input; the `input` utility ships a `:focus` ring. */
export function SocialInput({
  className,
  invalid,
  ...rest
}: SocialInputProps) {
  return (
    <input
      className={cx("input", TOUCH_TARGET, invalid && "input-error", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SocialTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function SocialTextarea({
  className,
  invalid,
  ...rest
}: SocialTextareaProps) {
  return (
    <textarea
      className={cx(
        "input min-h-[88px] py-2",
        TOUCH_TARGET,
        invalid && "input-error",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SocialSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export function SocialSelect({
  className,
  children,
  ...rest
}: SocialSelectProps) {
  return (
    <select className={cx("input", TOUCH_TARGET, className)} {...rest}>
      {children}
    </select>
  );
}

/** A labelled field wrapper for inputs/selects/textareas. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-xs font-medium text-white/70">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-white/60">{hint}</span> : null}
    </label>
  );
}

type BadgeTone = "primary" | "accent" | "success" | "warning" | "danger" | "neutral";

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

/** Card scaffold built from the `card` utility. */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cx("card card-content", className)}>{children}</div>;
}

/**
 * The screen shell shared by all six social screens. It clips horizontal
 * overflow and constrains width fluidly (Req 8.7) and provides consistent
 * back-navigation chrome built from the accessible primitives.
 */
export function SocialShell({
  title,
  subtitle,
  backHref = "/campus/social",
  backLabel = "Back",
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cx(
        "relative min-h-screen bg-black text-white",
        NO_X_SCROLL_CONTAINER,
      )}
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <SocialLinkButton
            href={backHref}
            variant="ghost"
            size="sm"
            aria-label={backLabel}
          >
            ← {backLabel}
          </SocialLinkButton>
          <Chip tone="accent">Campus Social</Chip>
        </header>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-white/70">{subtitle}</p>
        ) : null}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

/** A neutral empty-state block (Req 2.10 empty challenge, generic empties). */
export function EmptyState({
  title,
  body,
  testId,
}: {
  title: string;
  body: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5 px-5 py-10 text-center"
      data-testid={testId}
    >
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-white/70">{body}</p>
    </div>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-white/70">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * A "temporarily unavailable" / access-denied / policy notice. Used for the
 * reused Usage_Meter "temporarily unavailable" state (Req 8.5), the access-gate
 * denial (Req 4.7 / 8.6), and withheld-for-policy indications (Req 4.6, 7.2).
 * Discloses no protected content — only the reason.
 */
export function StatusNotice({
  tone = "warning",
  title,
  body,
  testId,
}: {
  tone?: "warning" | "danger" | "neutral";
  title: string;
  body?: string;
  testId?: string;
}) {
  const border =
    tone === "danger"
      ? "border-[var(--color-danger)]/40"
      : tone === "warning"
        ? "border-[var(--color-warning)]/40"
        : "border-white/10";
  return (
    <div
      role="status"
      className={cx("rounded-xl border bg-white/5 px-4 py-3", border)}
      data-testid={testId}
    >
      <p className="text-sm font-semibold text-white">{title}</p>
      {body ? <p className="mt-1 text-sm text-white/70">{body}</p> : null}
    </div>
  );
}

export { cx };

// ---------------------------------------------------------------------------
// Safety / consent presentational pieces (Req 7.4, 7.5, 7.8, 7.9)
// ---------------------------------------------------------------------------

/**
 * The AI-identity reminder presented for companion-style agents at session
 * start and every 30 minutes thereafter (Req 7.4). Shown when the reused
 * companion core flags `identityReminder`.
 */
export function AiIdentityReminder({ agentName }: { agentName?: string }) {
  return (
    <div
      role="note"
      className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
      data-testid="ai-identity-reminder"
    >
      <p className="text-sm text-white/80">
        Reminder: {agentName ? `${agentName} is ` : "this is "} an AI voice
        agent, not a real person.
      </p>
    </div>
  );
}

/**
 * The take-a-break notice presented at each 60-minute mark of gapless
 * companion interaction (Req 7.5).
 */
export function TakeABreakNotice() {
  return (
    <div
      role="note"
      className="rounded-xl border border-[var(--color-warning)]/40 bg-white/5 px-4 py-3"
      data-testid="take-a-break-notice"
    >
      <p className="text-sm text-white/80">
        You&apos;ve been chatting for a while. Consider taking a break.
      </p>
    </div>
  );
}

/**
 * A consent prompt for recording or sharing. The applicable consent must be
 * granted before recording, generating a Share_Clip, or sharing an interaction
 * (Req 7.8, 7.9); declining retains the underlying data unchanged.
 */
export function ConsentPrompt({
  kind,
  title,
  body,
  onGrant,
  onDecline,
  testId,
}: {
  kind: "recording" | "sharing";
  title: string;
  body: string;
  onGrant: () => void;
  onDecline: () => void;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`${kind} consent`}
      className="rounded-xl border border-white/10 bg-white/5 px-4 py-4"
      data-testid={testId ?? `consent-${kind}`}
    >
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-white/70">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SocialButton
          size="sm"
          variant="primary"
          onClick={onGrant}
          data-testid={`consent-${kind}-grant`}
        >
          I consent
        </SocialButton>
        <SocialButton
          size="sm"
          variant="outline"
          onClick={onDecline}
          data-testid={`consent-${kind}-decline`}
        >
          Not now
        </SocialButton>
      </div>
    </div>
  );
}
