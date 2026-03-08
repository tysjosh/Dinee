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
import { createSubscriptionService } from "@/lib/billing/SubscriptionService";
import { createLogger } from "@/lib/logger";
import type { BillingCycle } from "@/lib/billing/types";

const logger = createLogger("billing-checkout");

// ============================================================================
// Types
// ============================================================================

interface CheckoutRequestBody {
  planId: string;
  billingCycle: BillingCycle;
  restaurantId: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    logger.error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
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

  const { planId, billingCycle, restaurantId } = body;

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

  // 2. Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  // 3. Build callback URL and create SubscriptionService
  const callbackUrl = buildCallbackUrl(request);
  const subscriptionService = createSubscriptionService(callbackUrl);

  // 4. Initialize subscription (calls PaystackProvider.initializeTransaction)
  try {
    const result = await subscriptionService.initializeSubscription({
      restaurantId,
      planId,
      billingCycle,
      paymentProvider: "paystack",
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
