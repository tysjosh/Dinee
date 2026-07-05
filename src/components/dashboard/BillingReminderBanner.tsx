"use client";

/**
 * BillingReminderBanner — Renders a warning banner in the dashboard header
 * when the subscription is `past_due` or the trial is ending within 3 days.
 * Includes a CTA button that navigates to the billing tab or triggers checkout.
 *
 * @requirements 4.3 - Banner shown when past_due or trial ending within 3 days
 * @requirements 4.4 - Banner includes CTA button that triggers Paystack checkout
 */

import React, { useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useBusinessStorage } from "@/hooks/useBusinessStorage";
import { getPlanById, formatNairaPrice } from "@/lib/billing/SubscriptionService";
import { cn } from "@/lib/utils";

interface BillingReminderBannerProps {
  onNavigateToBilling?: () => void;
}

const BillingReminderBanner: React.FC<BillingReminderBannerProps> = ({
  onNavigateToBilling,
}) => {
  const { businessId: restaurantId } = useBusinessStorage();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const subscription = useQuery(
    api.subscriptions.getSubscriptionByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );

  const handleCheckout = useCallback(async () => {
    if (!restaurantId || !subscription) return;

    setIsCheckoutLoading(true);
    try {
      const response = await fetch("/client/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: subscription.planId,
          billingCycle: subscription.billingCycle ?? "monthly",
          restaurantId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to initiate checkout");
      }

      const { checkoutUrl } = await response.json();
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      }
    } catch {
      // Fall back to navigating to billing tab
      onNavigateToBilling?.();
    } finally {
      setIsCheckoutLoading(false);
    }
  }, [restaurantId, subscription, onNavigateToBilling]);

  // Don't render while loading or if no subscription
  if (!subscription) return null;

  const isPastDue = subscription.status === "past_due";

  // Check if trial is ending within 3 days
  const isTrialEndingSoon =
    subscription.status === "trialing" &&
    subscription.trialEndsAt != null &&
    subscription.trialEndsAt - Date.now() <= 3 * 24 * 60 * 60 * 1000 &&
    subscription.trialEndsAt > Date.now();

  // Only show banner for these two conditions
  if (!isPastDue && !isTrialEndingSoon) return null;

  const plan = getPlanById(subscription.planId);
  const planName = plan?.name ?? "your plan";

  const daysLeft = isTrialEndingSoon && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((subscription.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  const price = plan?.priceMonthly ?? 0;

  return (
    <div
      className={cn(
        "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8",
      )}
      role="alert"
    >
      <div
        className={cn(
          "flex items-center gap-3 p-3 sm:p-4 rounded-lg border mt-2",
          isPastDue
            ? "bg-red-500/10 border-red-500/30"
            : "bg-amber-500/10 border-amber-500/30"
        )}
      >
        {/* Icon */}
        <div
          className={cn(
            "flex-shrink-0 p-2 rounded-lg",
            isPastDue ? "bg-red-500/20" : "bg-amber-500/20"
          )}
        >
          <svg
            className={cn(
              "w-5 h-5",
              isPastDue ? "text-red-400" : "text-amber-400"
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">
            {isPastDue
              ? "Payment Overdue"
              : `Trial Ending in ${daysLeft} Day${daysLeft !== 1 ? "s" : ""}`}
          </p>
          <p className="text-xs text-white/60 mt-0.5">
            {isPastDue
              ? `Your ${planName} subscription is past due. Update your payment to avoid service interruption.`
              : `Your ${planName} trial ends soon.${price > 0 ? ` Subscribe now for ${formatNairaPrice(price)}/month.` : ""}`}
          </p>
        </div>

        {/* CTA Button */}
        <button
          onClick={handleCheckout}
          disabled={isCheckoutLoading}
          className={cn(
            "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
            "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black",
            isPastDue
              ? "bg-red-500 hover:bg-red-600 text-white focus:ring-red-500"
              : "bg-amber-500 hover:bg-amber-600 text-black focus:ring-amber-500",
            isCheckoutLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {isCheckoutLoading ? (
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          )}
          <span>{isPastDue ? "Pay Now" : "Subscribe"}</span>
        </button>
      </div>
    </div>
  );
};

export default BillingReminderBanner;
