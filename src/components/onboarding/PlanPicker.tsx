"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import {
  SUBSCRIPTION_PLANS,
  formatNairaPrice,
  calculateYearlySavings,
  isUnlimited,
} from "@/lib/billing/SubscriptionService";
import type { SubscriptionPlan } from "@/lib/billing/types";
import type { BillingCycle } from "@/lib/billing/types";

export interface PlanPickerProps {
  onSelectPlan: (planId: string, billingCycle: BillingCycle) => void;
  onSkip: () => void;
  isLoading?: boolean;
}

function formatLimit(value: number): string {
  return isUnlimited(value) ? "Unlimited" : value.toLocaleString();
}

const LIMIT_LABELS: { key: keyof SubscriptionPlan["limits"]; label: string; icon: string }[] = [
  { key: "maxBranches", label: "Branches", icon: "🏪" },
  { key: "maxCallsPerMonth", label: "Calls/month", icon: "📞" },
  { key: "maxOrdersPerMonth", label: "Orders/month", icon: "📦" },
  { key: "maxCatalogItems", label: "Catalog items", icon: "📋" },
  { key: "maxTeamMembers", label: "Team members", icon: "👥" },
];

/**
 * PlanPicker — subscription plan selection step for onboarding.
 * Displays the three plans from SUBSCRIPTION_PLANS with a monthly/yearly toggle,
 * "Recommended" badge on Growth, and a Skip option defaulting to Starter trial.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */
const PlanPicker: React.FC<PlanPickerProps> = ({ onSelectPlan, onSkip, isLoading }) => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  const activePlans = SUBSCRIPTION_PLANS.filter((p) => p.isActive).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  const displayPrice = (plan: SubscriptionPlan) =>
    billingCycle === "yearly"
      ? formatNairaPrice(Math.round(plan.priceYearly / 12))
      : formatNairaPrice(plan.priceMonthly);

  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="max-w-4xl w-full space-y-8"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-center space-y-3"
        >
          <h1 className="text-3xl text-white mb-3 text-minimal">
            Choose Your Plan
          </h1>
          <p className="text-white/70 text-minimal">
            Start with a 14-day free trial on any plan. No payment required.
          </p>
        </motion.div>

        {/* Billing Cycle Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="flex items-center justify-center gap-3"
        >
          <span
            className={`text-sm font-medium transition-colors ${
              billingCycle === "monthly" ? "text-white" : "text-white/50"
            }`}
          >
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={billingCycle === "yearly"}
            aria-label="Toggle yearly billing"
            onClick={() =>
              setBillingCycle((c) => (c === "monthly" ? "yearly" : "monthly"))
            }
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black ${
              billingCycle === "yearly" ? "bg-emerald-500" : "bg-white/20"
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                billingCycle === "yearly" ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium transition-colors ${
              billingCycle === "yearly" ? "text-white" : "text-white/50"
            }`}
          >
            Yearly
          </span>
          {billingCycle === "yearly" && (
            <span className="ml-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              Save 2 months
            </span>
          )}
        </motion.div>

        {/* Plan Cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-5"
          role="radiogroup"
          aria-label="Subscription plans"
        >
          {activePlans.map((plan, index) => {
            const yearlySavings = calculateYearlySavings(plan);

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + index * 0.08 }}
                className="relative"
              >
                {/* Recommended Badge */}
                {plan.isRecommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-emerald-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg">
                      Recommended
                    </span>
                  </div>
                )}

                <div
                  role="radio"
                  aria-checked={false}
                  aria-label={`${plan.name} plan — ${displayPrice(plan)} per month`}
                  tabIndex={0}
                  className={`card-minimal rounded-xl p-6 h-full flex flex-col transition-all duration-200 cursor-pointer hover:ring-1 hover:ring-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black ${
                    plan.isRecommended
                      ? "ring-1 ring-emerald-500/30 border-emerald-500/20"
                      : ""
                  }`}
                  onClick={() => !isLoading && onSelectPlan(plan.id, billingCycle)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !isLoading) {
                      e.preventDefault();
                      onSelectPlan(plan.id, billingCycle);
                    }
                  }}
                >
                  {/* Plan Name & Price */}
                  <div className="mb-5">
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {plan.name}
                    </h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-white">
                        {displayPrice(plan)}
                      </span>
                      <span className="text-white/50 text-sm">/month</span>
                    </div>
                    {billingCycle === "yearly" && yearlySavings > 0 && (
                      <p className="text-emerald-400 text-xs mt-1">
                        Save {formatNairaPrice(yearlySavings)}/year
                      </p>
                    )}
                    <p className="text-white/50 text-sm mt-2 line-clamp-2">
                      {plan.description}
                    </p>
                  </div>

                  {/* Feature Limits */}
                  <ul className="space-y-2.5 flex-1 mb-5" aria-label={`${plan.name} plan limits`}>
                    {LIMIT_LABELS.map(({ key, label, icon }) => (
                      <li
                        key={key}
                        className="flex items-center gap-2 text-sm text-white/70"
                      >
                        <span className="text-base" aria-hidden="true">{icon}</span>
                        <span>
                          <span className="text-white font-medium">
                            {formatLimit(plan.limits[key])}
                          </span>{" "}
                          {label}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Select Button */}
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPlan(plan.id, billingCycle);
                    }}
                    className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed ${
                      plan.isRecommended
                        ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                        : "bg-white/10 hover:bg-white/15 text-white"
                    }`}
                  >
                    {isLoading ? "Setting up…" : "Start Free Trial"}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Skip Option */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="text-center"
        >
          <button
            type="button"
            disabled={isLoading}
            onClick={onSkip}
            className="text-white/50 hover:text-white text-sm font-medium transition-colors min-h-[44px] px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg disabled:opacity-50"
          >
            Skip — start with Starter plan (14-day trial)
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default PlanPicker;
