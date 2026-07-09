"use client";

import React from "react";
import Link from "next/link";
import { campusCopy } from "@/lib/campus/copy";

/**
 * Feature: dinee-campus (Task 28.1) — `CampusLanding`.
 *
 * The student landing page at `/campus`. It renders the exact promise text and
 * a single primary call-to-action that begins the Onboarding_Flow, sourcing all
 * strings from the shared `campusCopy` corpus so the copy has one source of
 * truth and is guaranteed free of the Business_Terminology_Exclusion_List while
 * including the student/campus language (Req 1.1, 1.6).
 *
 * The single CTA is a client-side `Link` to `/campus/create`, so activating it
 * starts the Onboarding_Flow effectively instantly (Req 1.3). Authentication is
 * required only to *complete* the flow and is handled there (Req 1.4, 1.5).
 *
 * Layout is mobile-first: the outer container hides horizontal overflow and the
 * content is width-constrained with fluid padding so the page renders without
 * horizontal scrolling at a 360px viewport, and every interactive control meets
 * the 44×44 CSS-pixel minimum touch-target size (Req 1.2, 14.1, 14.2).
 */
export function CampusLanding() {
  const { promise, subtext, primaryCta } = campusCopy.landing;

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-8 px-5 py-16 text-center sm:px-8">
        {/* Product mark / eyebrow — reinforces the student + campus framing */}
        <span className="badge badge-accent inline-flex min-h-[28px] items-center">
          Dinee Campus
        </span>

        {/* The exact promise text required by Req 1.1 */}
        <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {promise}
        </h1>

        {/* Supporting subtext — carries the student/campus language */}
        <p className="max-w-xl text-pretty text-base leading-relaxed text-white/70 sm:text-lg">
          {subtext}
        </p>

        {/* The single primary CTA that begins the Onboarding_Flow (Req 1.1, 1.3).
            btn-lg is 48px tall (≥44px); min-w keeps the target ≥44px wide. */}
        <Link
          href="/campus/create"
          className="btn btn-primary btn-lg min-h-[44px] min-w-[44px] w-full max-w-sm"
          data-testid="campus-landing-cta"
        >
          {primaryCta}
        </Link>

        {/* Lightweight reassurance of what happens next — no business terms. */}
        <p className="text-sm text-white/50">
          Free to start. Build it in minutes, then share your call link across
          campus.
        </p>
      </div>
    </main>
  );
}

export default CampusLanding;
