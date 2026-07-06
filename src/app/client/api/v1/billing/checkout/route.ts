/**
 * Billing Checkout API Route
 *
 * Accepts { planId, billingCycle, restaurantId }, initializes a Paystack
 * subscription checkout via SubscriptionService, persists the subscription
 * record in Convex, and returns the hosted checkout URL to the frontend.
 *
 * @module api/billing/checkout
 * @requirements 2.1 - Paystack checkout redirect flow
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import {
  createSubscriptionService,
  getPlanById,
  getPlanPrice,
} from "@/lib/billing/SubscriptionService";
import { createStripeProvider } from "@/lib/payment/StripeProvider";
import { createLogger } from "@/lib/logger";
import type { BillingCycle, SubscriptionPaymentProvider } from "@/lib/billing/types";
import { resolveSubscriptionProvider } from "@/lib/region";
import { internalSecretArg } from "@/lib/internal-auth";

const logger = createLogger("billing-checkout");

// ============================================================================
// Types
// ============================================================================

interface CheckoutRequestBody {
  planId: string;
  billingCycle: BillingCycle;
  restaurantId: string;
  /**
   * Optional payment rail. Honored only when valid for the tenant's country
   * (e.g. "flutterwave" for Nigeria); otherwise the country default is used.
   */
  paymentProvider?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getConvexClient(authToken?: string): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    logger.error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
    return null;
  }
  const client = new ConvexHttpClient(convexUrl);
  // Forward the caller's Convex Auth session so server-side Convex calls run as
  // the authenticated user (enabling ownership checks in the mutations).
  if (authToken) client.setAuth(authToken);
  return client;
}

/** Extract the bearer token from the Authorization header, if present. */
function getBearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : undefined;
}

function buildCallbackUrl(request: NextRequest): string {
  const origin = request.nextUrl.origin;
  return `${origin}/client/billing/callback`;
}

const VALID_BILLING_CYCLES: BillingCycle[] = ["monthly", "yearly"];

function isValidBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && VALID_BILLING_CYCLES.includes(value as BillingCycle);
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  // 1. Parse & validate request body
  let body: CheckoutRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { planId, billingCycle, restaurantId, paymentProvider: requestedProvider } = body;

  if (!planId || typeof planId !== "string") {
    return NextResponse.json(
      { error: "planId is required and must be a string" },
      { status: 400 },
    );
  }

  if (!isValidBillingCycle(billingCycle)) {
    return NextResponse.json(
      { error: 'billingCycle is required and must be "monthly" or "yearly"' },
      { status: 400 },
    );
  }

  if (!restaurantId || typeof restaurantId !== "string") {
    return NextResponse.json(
      { error: "restaurantId is required and must be a string" },
      { status: 400 },
    );
  }

  // 2. Initialize Convex client with the caller's session token.
  const authToken = getBearerToken(request);
  const convexClient = getConvexClient(authToken);
  if (!convexClient) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  // 2b. Authenticate the caller and verify they own the target restaurant.
  //     Prevents a caller from passing another tenant's restaurantId to create
  //     or overwrite that tenant's subscription. Platform admins may act on any.
  try {
    const me = await convexClient.query(api.users.currentUser, {});
    if (!me) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const owns = me.role === "platform_admin" || me.tenantId === restaurantId;
    if (!owns) {
      return NextResponse.json(
        { error: "You do not have access to this restaurant's billing" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // 3. Build callback URL and create SubscriptionService
  const callbackUrl = buildCallbackUrl(request);
  const subscriptionService = createSubscriptionService(callbackUrl);

  // 3b. Resolve the payment rail from the tenant's country, honoring an
  //     explicit (validated) provider choice when the caller sends one:
  //       US       → Stripe (USD)
  //       Nigeria  → Paystack (default) or Flutterwave (if requested)
  //     Defaults to Nigeria/Paystack when the lookup fails.
  let paymentProvider: SubscriptionPaymentProvider = "paystack";
  try {
    const restaurant = await convexClient.query(api.restaurants.getRestaurant, {
      restaurantId,
      ...internalSecretArg(),
    });
    const country = (restaurant as { country?: string } | null)?.country;
    const provider = resolveSubscriptionProvider(country, requestedProvider);
    if (provider === "stripe" || provider === "paystack" || provider === "flutterwave") {
      paymentProvider = provider;
    }
  } catch {
    // Fall back to the default (paystack) if the lookup fails.
  }

  // 3c. Stripe (US) → true recurring subscription via subscription-mode Checkout.
  if (paymentProvider === "stripe") {
    const plan = getPlanById(planId);
    if (!plan || !plan.isActive) {
      return NextResponse.json(
        { error: `Plan ${planId} is not available` },
        { status: 422 },
      );
    }
    const amountMinor = Math.round(getPlanPrice(plan, "USD", billingCycle) * 100);
    const subscriptionId = `SUB_${crypto.randomUUID()}`;
    const stripe = createStripeProvider(callbackUrl);
    const init = await stripe.createSubscriptionCheckout({
      planName: `${plan.name} (${billingCycle})`,
      amountMinor,
      currency: "usd",
      interval: billingCycle === "yearly" ? "year" : "month",
      referenceId: subscriptionId,
    });
    if (!init.success || !init.paymentUrl) {
      logger.error("Stripe subscription checkout failed", { restaurantId });
      return NextResponse.json(
        { error: init.error ?? "Failed to initialize checkout" },
        { status: 422 },
      );
    }
    const now = Date.now();
    const periodEnd = new Date(now);
    if (billingCycle === "yearly") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);
    try {
      await convexClient.mutation(api.subscriptions.createSubscription, {
        subscriptionId,
        restaurantId,
        planId,
        status: "pending", // activated by the Stripe webhook on checkout completion
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.getTime(),
        paymentProvider: "stripe",
        paymentReference: init.reference,
        billingCycle,
      });
    } catch (convexError) {
      const msg = convexError instanceof Error ? convexError.message : "Unknown Convex error";
      logger.error(`Failed to save Stripe subscription record: ${msg}`, { restaurantId });
      return NextResponse.json(
        { error: "Failed to save subscription record" },
        { status: 500 },
      );
    }
    logger.info("Stripe subscription checkout created", { restaurantId, orderId: subscriptionId });
    return NextResponse.json({ checkoutUrl: init.paymentUrl }, { status: 200 });
  }

  // 4. Initialize subscription with the region-selected provider (Paystack).
  try {
    const result = await subscriptionService.initializeSubscription({
      restaurantId,
      planId,
      billingCycle,
      paymentProvider,
      startTrial: false,
    });

    if (!result.success || !result.subscription || !result.paymentUrl) {
      logger.error("Subscription initialization failed", {
        restaurantId,
        orderId: planId,
      });
      return NextResponse.json(
        { error: result.error ?? "Failed to initialize checkout" },
        { status: 422 },
      );
    }

    const { subscription, paymentUrl } = result;

    // 5. Save subscription record to Convex
    try {
      await convexClient.mutation(api.subscriptions.createSubscription, {
        subscriptionId: subscription.subscriptionId,
        restaurantId: subscription.restaurantId,
        planId: subscription.planId,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        paymentProvider: subscription.paymentProvider,
        paymentReference: subscription.paymentReference,
        billingCycle: subscription.billingCycle,
        trialEndsAt: subscription.trialEndsAt,
      });
    } catch (convexError) {
      const msg = convexError instanceof Error ? convexError.message : "Unknown Convex error";
      logger.error(`Failed to save subscription record: ${msg}`, {
        restaurantId,
      });
      return NextResponse.json(
        { error: "Failed to save subscription record" },
        { status: 500 },
      );
    }

    logger.info("Checkout session created", {
      restaurantId,
      orderId: subscription.subscriptionId,
    });

    // 6. Return checkout URL and reference
    return NextResponse.json(
      {
        checkoutUrl: paymentUrl,
        reference: subscription.paymentReference,
      },
      { status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Checkout error: ${msg}`, { restaurantId });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
