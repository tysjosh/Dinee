"use client";

/**
 * Feature: dinee-campus (Task 34.1) — the `/campus/upgrade` CTA target.
 *
 * The single destination every Campus upgrade prompt points at: the reached-
 * limit publish blocker in `CreationWizard` (`/campus/upgrade`), the near-limit
 * warning banner, and `useCampusAgent().goToUpgrade()`. It presents the paid
 * creator tier and starts checkout through the EXISTING checkout flow
 * (`startCampusUpgradeCheckout` → `POST /client/api/v1/billing/checkout`); on
 * payment confirmation the existing subscription webhook raises the tier and
 * `campus.usage.getUsage` reflects it within 60s (Req 13.3, 13.4, 13.5).
 *
 * See `src/lib/campus/upgrade.ts` for the documented tenant-scoping integration
 * seam. This surface surfaces the checkout endpoint's own response honestly
 * rather than faking a success.
 *
 * Mobile-first: renders without horizontal scroll at 360px and every control
 * meets the 44×44 touch-target minimum (Req 14.1, 14.2).
 */

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { BillingCycle } from "@/lib/billing/types";
import type { UsageDimension } from "../../../convex/campus/logic/usage";
import {
  useCampusAgent,
  USAGE_DIMENSION_LABELS,
} from "@/contexts/CampusAgentContext";
import { startCampusUpgradeCheckout } from "@/lib/campus/upgrade";

const DIMENSION_SET: ReadonlySet<string> = new Set<UsageDimension>([
  "agents",
  "documentUploads",
  "callMinutes",
]);

/** The paid-creator tier value props (student-facing; no business terms). */
const PAID_TIER_BENEFITS: readonly string[] = [
  "Create more AI voice agents",
  "More call minutes every month",
  "More document uploads for richer knowledge",
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-black text-white">
      <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/campus"
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
            aria-label="Back to Dinee Campus"
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

export function UpgradeView() {
  const searchParams = useSearchParams();
  const { isAuthenticated, authLoading, usage, usageLoading, goToUpgrade } =
    useCampusAgent();
  const authToken = useAuthToken();

  const currentUser = useQuery(
    api.users.currentUser,
    isAuthenticated ? {} : "skip"
  ) as Doc<"users"> | null | undefined;

  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  // The dimension that triggered the upgrade, if the CTA passed one.
  const reason = searchParams.get("reason");
  const reasonDimension: UsageDimension | null =
    reason && DIMENSION_SET.has(reason) ? (reason as UsageDimension) : null;

  const accountKey = useMemo(
    () => currentUser?.userId ?? currentUser?._id ?? currentUser?.tenantId ?? "",
    [currentUser]
  );

  const handleUpgrade = useCallback(async () => {
    if (!accountKey) {
      setCheckoutError(
        "We couldn't find your account. Please sign in again and retry."
      );
      return;
    }
    setSubmitting(true);
    setCheckoutError("");
    const result = await startCampusUpgradeCheckout({
      authToken,
      accountKey,
      billingCycle,
    });
    if (result.ok) {
      window.location.href = result.checkoutUrl;
      return;
    }
    setCheckoutError(result.error);
    setSubmitting(false);
  }, [accountKey, authToken, billingCycle]);

  // --- Auth guard --------------------------------------------------------

  if (authLoading) {
    return (
      <Shell>
        <div className="mt-10 flex items-center gap-3 text-white/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm">Loading…</span>
        </div>
      </Shell>
    );
  }

  if (!isAuthenticated) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold sm:text-3xl">Sign in to upgrade</h1>
        <p className="mt-2 text-sm text-white/60">
          You need to be signed in to upgrade your creator plan.
        </p>
        <Link
          href="/campus/create"
          className="btn btn-primary btn-lg mt-6 min-h-[44px] w-full"
        >
          Go to Dinee Campus
        </Link>
      </Shell>
    );
  }

  const alreadyPaid = usage?.tier === "paid";

  return (
    <Shell>
      <h1 className="text-2xl font-bold sm:text-3xl">Upgrade your creator plan</h1>
      <p className="mt-2 text-sm text-white/60">
        {reasonDimension
          ? `You've hit your free plan's ${USAGE_DIMENSION_LABELS[reasonDimension]} limit. Upgrade for more capacity.`
          : "Go beyond the free plan for more agents, call minutes, and uploads."}
      </p>

      {/* Current usage snapshot (Req 13.1, 13.2). */}
      {usageLoading ? (
        <div className="mt-6 h-24 animate-pulse rounded-lg border border-white/10 bg-white/5" />
      ) : usage ? (
        <section
          className="mt-6 rounded-lg border border-[var(--color-border-default)] bg-white/5 p-4"
          aria-label="Your current usage"
        >
          <p className="text-xs uppercase tracking-wide text-white/40">
            Your plan: {usage.tier === "paid" ? "Paid creator" : "Free"}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <UsageRow
              label="Agents"
              used={usage.usage.agents}
              limit={usage.limits.agents}
            />
            <UsageRow
              label="Document uploads (this month)"
              used={usage.usage.documentUploads}
              limit={usage.limits.documentUploads}
            />
            <UsageRow
              label="Call minutes (this month)"
              used={usage.usage.callMinutes}
              limit={usage.limits.callMinutes}
            />
          </dl>
        </section>
      ) : null}

      {alreadyPaid ? (
        <div
          className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
          role="status"
        >
          You&apos;re already on a paid creator plan. Enjoy the extra capacity!
        </div>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Paid creator plan</h2>
            <ul className="mt-3 space-y-2">
              {PAID_TIER_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2 text-sm text-white/80">
                  <span aria-hidden="true" className="mt-0.5 text-emerald-400">
                    ✓
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
          </section>

          {/* Billing cycle selector. */}
          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-white/80">
              Billing cycle
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(["monthly", "yearly"] as const).map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  aria-pressed={billingCycle === cycle}
                  className={`card card-content min-h-[44px] text-center text-sm font-medium capitalize transition-colors ${
                    billingCycle === cycle
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-white"
                      : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  {cycle}
                </button>
              ))}
            </div>
          </fieldset>

          {checkoutError && (
            <div
              className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
              role="alert"
            >
              {checkoutError}
            </div>
          )}

          <button
            type="button"
            onClick={handleUpgrade}
            disabled={submitting}
            className="btn btn-primary btn-lg mt-6 min-h-[44px] w-full disabled:opacity-50"
            data-testid="campus-upgrade-checkout"
          >
            {submitting ? "Starting checkout…" : "Continue to checkout"}
          </button>
          <p className="mt-3 text-center text-xs text-white/40">
            Upgrades are handled through Dinee&apos;s secure checkout.
          </p>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {reasonDimension && (
          <button
            type="button"
            onClick={() => goToUpgrade()}
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            See all plan options
          </button>
        )}
      </div>
    </Shell>
  );
}

/** Renders a single "used / limit" usage row, formatting an unbounded limit. */
function UsageRow({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const limitLabel = Number.isFinite(limit) ? String(limit) : "Unlimited";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/60">{label}</dt>
      <dd className="font-medium text-white">
        {used} / {limitLabel}
      </dd>
    </div>
  );
}

export default UpgradeView;
