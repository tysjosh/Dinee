"use client";

/**
 * BillingDashboardContainer — Wrapper that resolves the restaurantId
 * from business storage and passes it (along with action callbacks)
 * to the presentational BillingDashboard component.
 *
 * @requirements 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4
 */

import React, { useCallback, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { BillingDashboard } from "./BillingDashboard";
import { useBusinessStorage } from "@/hooks/useBusinessStorage";
import { useShowToast } from "@/hooks/useShowToast";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getPlanById } from "@/lib/billing/SubscriptionService";
import type { BillingCycle } from "@/lib/billing/types";
import { getSubscriptionProvidersForCountry } from "@/lib/region";

/** Human labels for the payment rails offered at checkout. */
const PROVIDER_LABELS: Record<string, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  stripe: "Card (Stripe)",
};

export interface BillingDashboardContainerProps {
  tabId?: "billing";
}

const BillingDashboardContainer: React.FC<BillingDashboardContainerProps> = () => {
  const { businessId: restaurantId, loading } = useBusinessStorage();
  const { showToast } = useShowToast();
  const authToken = useAuthToken();
  const [isProcessing, setIsProcessing] = useState(false);

  // Convex queries & mutations
  const subscription = useQuery(
    api.subscriptions.getSubscriptionByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const restaurant = useQuery(
    api.restaurants.getRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const schedulePlanChange = useMutation(api.subscriptions.schedulePlanChange);
  const setCancelAtPeriodEnd = useMutation(api.subscriptions.setCancelAtPeriodEnd);

  // Payment rails available for the tenant's country. Nigeria offers a choice
  // (Paystack / Flutterwave); the US has a single rail (Stripe), so no selector
  // is shown there.
  const providers = getSubscriptionProvidersForCountry(
    (restaurant as { country?: string } | null | undefined)?.country
  );
  const [selectedProvider, setSelectedProvider] = useState<string>(providers[0]);

  // Keep the selection valid once the tenant's country resolves.
  React.useEffect(() => {
    if (!providers.includes(selectedProvider)) {
      setSelectedProvider(providers[0]);
    }
  }, [providers, selectedProvider]);

  /**
   * Initiate checkout — calls the billing checkout API and redirects to Paystack.
   * Used for both initial plan selection and upgrades.
   */
  const initiateCheckout = useCallback(
    async (planId: string, billingCycle: BillingCycle) => {
      if (!restaurantId || isProcessing) return;

      setIsProcessing(true);

      try {
        const response = await fetch("/client/api/v1/billing/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            planId,
            billingCycle,
            restaurantId,
            paymentProvider: selectedProvider,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to initiate checkout");
        }

        const { checkoutUrl } = await response.json();

        if (!checkoutUrl) {
          throw new Error("No checkout URL returned");
        }

        showToast({ type: "success", message: "Redirecting to payment…" });
        window.location.href = checkoutUrl;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Something went wrong";
        showToast({ type: "error", message });
      } finally {
        setIsProcessing(false);
      }
    },
    [restaurantId, isProcessing, showToast, selectedProvider, authToken]
  );

  /**
   * Handle plan change — upgrade via checkout API, downgrade via schedulePlanChange mutation.
   * For new users (no subscription), goes directly to checkout.
   * Uses sortOrder from plan definitions to determine upgrade vs downgrade.
   */
  const handleChangePlan = useCallback(
    async (planId: string, billingCycle: BillingCycle) => {
      if (!restaurantId || isProcessing) return;

      const newPlan = getPlanById(planId);
      if (!newPlan) {
        showToast({ type: "error", message: "Invalid plan selected." });
        return;
      }

      // No existing subscription or pending payment — go to checkout
      if (!subscription || subscription.status === "pending" || subscription.status === "cancelled") {
        await initiateCheckout(planId, billingCycle);
        return;
      }

      const currentPlan = getPlanById(subscription.planId);

      if (!currentPlan) {
        await initiateCheckout(planId, billingCycle);
        return;
      }

      if (newPlan.id === currentPlan.id) {
        showToast({ type: "error", message: "You are already on this plan." });
        return;
      }

      setIsProcessing(true);

      try {
        // Active subscription — schedule plan change for end of current period
        await schedulePlanChange({
          subscriptionId: subscription.subscriptionId,
          newPlanId: planId,
        });

        const direction = newPlan.sortOrder > currentPlan.sortOrder ? "Upgrade" : "Downgrade";
        showToast({
          type: "success",
          message: `${direction} to ${newPlan.name} scheduled for end of billing period.`,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Something went wrong";
        showToast({ type: "error", message });
      } finally {
        setIsProcessing(false);
      }
    },
    [restaurantId, subscription, isProcessing, initiateCheckout, schedulePlanChange, showToast]
  );

  /**
   * Handle subscription cancellation — sets cancelAtPeriodEnd so the subscription
   * stays active until the current billing period ends, then won't renew.
   */
  const handleCancelSubscription = useCallback(async () => {
    if (!subscription || isProcessing) return;

    setIsProcessing(true);

    try {
      await setCancelAtPeriodEnd({
        subscriptionId: subscription.subscriptionId,
        cancelAtPeriodEnd: true,
      });

      showToast({
        type: "success",
        message: "Subscription will be cancelled at the end of your billing period.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel subscription";
      showToast({ type: "error", message });
    } finally {
      setIsProcessing(false);
    }
  }, [subscription, isProcessing, setCancelAtPeriodEnd, showToast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-500" />
          <p className="text-white/60 text-sm">Loading billing information…</p>
        </div>
      </div>
    );
  }

  if (!restaurantId) {
    return (
      <div className="text-center py-16">
        <p className="text-white/60 text-sm">
          No restaurant selected. Please complete onboarding first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {providers.length > 1 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <fieldset className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <legend className="sr-only">Payment method</legend>
            <span className="text-sm text-white/60">Pay with</span>
            {providers.map((provider) => (
              <label
                key={provider}
                className="flex items-center gap-2 text-sm text-white cursor-pointer"
              >
                <input
                  type="radio"
                  name="payment-provider"
                  value={provider}
                  checked={selectedProvider === provider}
                  onChange={() => setSelectedProvider(provider)}
                  className="accent-emerald-500"
                />
                {PROVIDER_LABELS[provider] ?? provider}
              </label>
            ))}
          </fieldset>
        </div>
      )}

      <BillingDashboard
        restaurantId={restaurantId}
        onChangePlan={handleChangePlan}
        onCancelSubscription={handleCancelSubscription}
      />
    </div>
  );
};

export default BillingDashboardContainer;
