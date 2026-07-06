/**
 * Billing Verify API Route
 *
 * Verifies a Nigerian (Paystack or Flutterwave) transaction by reference and,
 * if successful, activates the pending subscription in Convex. The provider is
 * resolved from the subscription record so Flutterwave payments verify against
 * Flutterwave rather than always Paystack. (Stripe/US activates via webhook.)
 *
 * @module api/billing/verify
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { createPaystackProvider } from "@/lib/payment/PaystackProvider";
import { createFlutterwaveProvider } from "@/lib/payment/FlutterwaveProvider";
import { createStripeProvider } from "@/lib/payment/StripeProvider";
import type { PaymentProvider } from "@/lib/payment/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("billing-verify");

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

export async function POST(request: NextRequest) {
  let body: { reference: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { reference } = body;
  if (!reference || typeof reference !== "string") {
    return NextResponse.json(
      { error: "reference is required" },
      { status: 400 },
    );
  }

  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  try {
    // Resolve the provider that created this reference so each rail is
    // verified against itself: Stripe checkout sessions (US), Flutterwave, or
    // Paystack (default). The stored paymentReference is the Stripe session id
    // for Stripe subscriptions, so it round-trips through this lookup.
    const subscription = await convexClient.query(
      api.subscriptions.getSubscriptionByPaymentReference,
      { paymentReference: reference },
    );

    let provider: PaymentProvider;
    if (subscription?.paymentProvider === "stripe") {
      provider = createStripeProvider();
    } else if (subscription?.paymentProvider === "flutterwave") {
      provider = createFlutterwaveProvider();
    } else {
      provider = createPaystackProvider();
    }

    const verification = await provider.verifyTransaction(reference);

    if (!verification.success || verification.status !== "paid") {
      logger.error("Payment verification failed", { reference, status: verification.status });
      return NextResponse.json(
        {
          verified: false,
          status: verification.status,
          error: "Payment not confirmed",
        },
        { status: 200 },
      );
    }

    // Payment confirmed — activate the subscription
    await convexClient.mutation(api.subscriptions.activateSubscription, {
      paymentReference: reference,
    });

    logger.info("Subscription activated after payment verification", { reference });

    return NextResponse.json(
      { verified: true, status: "paid" },
      { status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Verification error: ${msg}`, { reference });
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 },
    );
  }
}
