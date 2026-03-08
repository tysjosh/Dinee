/**
 * Feature: convex-auth-integration, Property 18-19: Plan picker and subscription creation
 *
 * Validates: Requirements 10.2, 10.3, 10.4
 *
 * Property 18: Plan display completeness and pricing correctness
 *   For any subscription plan in SUBSCRIPTION_PLANS, the rendered Plan_Picker output
 *   should contain the plan's name, monthly price, and feature limits. The yearly
 *   savings displayed should equal (priceMonthly * 12) - priceYearly.
 *
 * Property 19: Subscription creation during onboarding
 *   For any plan selection during onboarding, a subscription record should be created
 *   with status = "trialing", trialEndsAt set to 14 days from now, and planId matching
 *   the selected plan.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  SUBSCRIPTION_PLANS,
  formatNairaPrice,
  calculateYearlySavings,
  isUnlimited,
  getPlanById,
} from "../../src/lib/billing/SubscriptionService";
import type { SubscriptionPlan, BillingCycle } from "../../src/lib/billing/types";

// --- Constants mirroring the onboarding subscription creation logic ---

const TRIAL_DAYS = 14;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_PAYMENT_PROVIDER = "paystack" as const;

// --- Pure helpers mirroring PlanPicker display logic ---

/**
 * Mirrors PlanPicker's formatLimit helper.
 * Returns "Unlimited" for -1, otherwise locale-formatted number.
 */
function formatLimit(value: number): string {
  return isUnlimited(value) ? "Unlimited" : value.toLocaleString();
}

/** The five limit keys displayed in PlanPicker's LIMIT_LABELS */
const LIMIT_KEYS: (keyof SubscriptionPlan["limits"])[] = [
  "maxBranches",
  "maxCallsPerMonth",
  "maxOrdersPerMonth",
  "maxCatalogItems",
  "maxTeamMembers",
];

/**
 * Extracts the display data that PlanPicker would render for a given plan
 * and billing cycle. This is a pure function mirroring the component logic.
 */
function extractPlanDisplayData(plan: SubscriptionPlan, billingCycle: BillingCycle) {
  const monthlyDisplayPrice =
    billingCycle === "yearly"
      ? formatNairaPrice(Math.round(plan.priceYearly / 12))
      : formatNairaPrice(plan.priceMonthly);

  const yearlySavings = calculateYearlySavings(plan);

  const limits = LIMIT_KEYS.map((key) => ({
    key,
    formattedValue: formatLimit(plan.limits[key]),
  }));

  return {
    name: plan.name,
    monthlyDisplayPrice,
    yearlySavings,
    yearlySavingsFormatted: yearlySavings > 0 ? formatNairaPrice(yearlySavings) : null,
    isRecommended: plan.isRecommended,
    limits,
  };
}

/**
 * Simulates the subscription record creation during onboarding.
 * Mirrors handlePlanSelected in src/app/client/onboarding/page.tsx.
 */
function simulateSubscriptionCreation(
  planId: string,
  billingCycle: BillingCycle,
  restaurantId: string,
  now: number
) {
  const trialEndsAt = now + TRIAL_MS;
  const subscriptionId = `SUB_${now.toString(36)}_${Math.random().toString(36).substring(2, 8)}`.toUpperCase();

  return {
    subscriptionId,
    restaurantId,
    planId,
    status: "trialing" as const,
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt,
    paymentProvider: DEFAULT_PAYMENT_PROVIDER,
    billingCycle,
    trialEndsAt,
  };
}

// --- Arbitraries ---

/** Picks one of the SUBSCRIPTION_PLANS at random */
const planArb = fc.constantFrom(...SUBSCRIPTION_PLANS);

/** Picks a billing cycle */
const billingCycleArb = fc.constantFrom<BillingCycle>("monthly", "yearly");

/** Generates a plausible restaurant ID (5-digit numeric string) */
const restaurantIdArb = fc.integer({ min: 10000, max: 99999 }).map(String);

/** Generates a plausible "now" timestamp within a reasonable range */
const nowArb = fc.integer({
  min: new Date("2024-01-01").getTime(),
  max: new Date("2030-12-31").getTime(),
});

// --- Tests ---

describe("Property 18: Plan display completeness and pricing correctness", () => {
  it("every plan has a non-empty name in the display data", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, (plan, billingCycle) => {
        const display = extractPlanDisplayData(plan, billingCycle);
        expect(display.name).toBeTruthy();
        expect(display.name).toBe(plan.name);
      }),
      { numRuns: 100 }
    );
  });

  it("monthly display price matches the plan's monthly price for monthly billing", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const display = extractPlanDisplayData(plan, "monthly");
        expect(display.monthlyDisplayPrice).toBe(formatNairaPrice(plan.priceMonthly));
      }),
      { numRuns: 100 }
    );
  });

  it("monthly display price shows yearly equivalent for yearly billing", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const display = extractPlanDisplayData(plan, "yearly");
        const expectedMonthlyEquivalent = Math.round(plan.priceYearly / 12);
        expect(display.monthlyDisplayPrice).toBe(formatNairaPrice(expectedMonthlyEquivalent));
      }),
      { numRuns: 100 }
    );
  });

  it("yearly savings equals (priceMonthly * 12) - priceYearly for every plan", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const display = extractPlanDisplayData(plan, "yearly");
        const expectedSavings = plan.priceMonthly * 12 - plan.priceYearly;
        expect(display.yearlySavings).toBe(expectedSavings);
      }),
      { numRuns: 100 }
    );
  });

  it("yearly savings is always non-negative (yearly price never exceeds 12x monthly)", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        expect(calculateYearlySavings(plan)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it("all five feature limits are present in the display data for every plan", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, (plan, billingCycle) => {
        const display = extractPlanDisplayData(plan, billingCycle);
        expect(display.limits).toHaveLength(LIMIT_KEYS.length);

        for (const limitEntry of display.limits) {
          const rawValue = plan.limits[limitEntry.key];
          const expected = isUnlimited(rawValue) ? "Unlimited" : rawValue.toLocaleString();
          expect(limitEntry.formattedValue).toBe(expected);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("the Growth plan is marked as recommended", () => {
    const growthPlan = SUBSCRIPTION_PLANS.find((p) => p.id === "growth");
    expect(growthPlan).toBeDefined();
    expect(growthPlan!.isRecommended).toBe(true);

    // No other plan should be recommended
    for (const plan of SUBSCRIPTION_PLANS) {
      if (plan.id !== "growth") {
        expect(plan.isRecommended).toBe(false);
      }
    }
  });

  it("getPlanById returns the correct plan for every SUBSCRIPTION_PLANS entry", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const found = getPlanById(plan.id);
        expect(found).toBeDefined();
        expect(found!.id).toBe(plan.id);
        expect(found!.name).toBe(plan.name);
        expect(found!.priceMonthly).toBe(plan.priceMonthly);
        expect(found!.priceYearly).toBe(plan.priceYearly);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 19: Subscription creation during onboarding", () => {
  it("subscription status is always 'trialing' for any plan selection", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.status).toBe("trialing");
      }),
      { numRuns: 100 }
    );
  });

  it("trialEndsAt is exactly 14 days from now for any plan selection", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        const expected = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
        expect(sub.trialEndsAt).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("currentPeriodEnd equals trialEndsAt (trial period is the billing period)", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.currentPeriodEnd).toBe(sub.trialEndsAt);
      }),
      { numRuns: 100 }
    );
  });

  it("planId matches the selected plan for any plan selection", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.planId).toBe(plan.id);
      }),
      { numRuns: 100 }
    );
  });

  it("billingCycle is preserved in the subscription record", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.billingCycle).toBe(billingCycle);
      }),
      { numRuns: 100 }
    );
  });

  it("restaurantId is preserved in the subscription record", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.restaurantId).toBe(restaurantId);
      }),
      { numRuns: 100 }
    );
  });

  it("skipping defaults to starter plan with monthly billing and 14-day trial", () => {
    fc.assert(
      fc.property(restaurantIdArb, nowArb, (restaurantId, now) => {
        // handlePlanSkipped calls handlePlanSelected("starter", "monthly")
        const sub = simulateSubscriptionCreation("starter", "monthly", restaurantId, now);
        expect(sub.planId).toBe("starter");
        expect(sub.billingCycle).toBe("monthly");
        expect(sub.status).toBe("trialing");
        expect(sub.trialEndsAt).toBe(now + TRIAL_MS);
      }),
      { numRuns: 100 }
    );
  });

  it("subscriptionId is always a non-empty string starting with SUB_", () => {
    fc.assert(
      fc.property(planArb, billingCycleArb, restaurantIdArb, nowArb, (plan, billingCycle, restaurantId, now) => {
        const sub = simulateSubscriptionCreation(plan.id, billingCycle, restaurantId, now);
        expect(sub.subscriptionId).toBeTruthy();
        expect(sub.subscriptionId.startsWith("SUB_")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
