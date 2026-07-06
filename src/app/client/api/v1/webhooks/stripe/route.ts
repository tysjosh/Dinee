/**
 * Stripe Webhook Handler (United States market)
 *
 * Receives Stripe webhook events, verifies the signature with the signing
 * secret, logs the event (idempotent), and processes payment outcomes:
 *   - `checkout.session.completed` → activate the matching subscription
 *     (by the Checkout Session id, which we persist as paymentReference), or
 *     update an order's payment status when the session carries an orderId.
 *
 * Mirrors the Paystack webhook's posture: raw-body signature verification,
 * insert-first idempotency, and never trusts an unverified payload.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { StripeProvider } from "@/lib/payment/StripeProvider";
import { createLogger } from "@/lib/logger";

const logger = createLogger("webhook-stripe");

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    logger.error("NEXT_PUBLIC_CONVEX_URL is not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

function getStripeProvider(): StripeProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    logger.error("STRIPE_SECRET_KEY is not set");
    return null;
  }
  return new StripeProvider({
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  const stripe = getStripeProvider();
  const convexClient = getConvexClient();
  if (!stripe || !convexClient) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Verify + parse the event via the provider (uses the signing secret).
  const result = await stripe.handleWebhook(rawBody, signature);

  if (!result.valid) {
    logger.warn("Stripe webhook: invalid signature");
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 422 });
  }

  // Idempotency: the Checkout Session id + event type make a stable key.
  const eventId = `stripe_${result.event}_${result.reference ?? "unknown"}`;
  try {
    const insertResult = await convexClient.mutation(
      api.webhookEvents.atomicInsertWebhookEvent,
      {
        eventId,
        provider: "stripe",
        eventType: result.event,
        payload: rawBody,
        signature: signature || undefined,
        verified: true,
        processed: false,
        orderId: result.orderId,
      }
    );
    if (!insertResult.inserted) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }
  } catch {
    logger.error("Stripe webhook: failed to log event", { eventId });
    // Continue processing even if logging fails.
  }

  try {
    if (result.event === "checkout.session.completed" && result.status === "paid") {
      // Prefer activating the subscription by its stored paymentReference
      // (the Checkout Session id).
      if (result.reference) {
        const sub = await convexClient.query(
          api.subscriptions.getSubscriptionByPaymentReference,
          { paymentReference: result.reference }
        );
        if (sub) {
          await convexClient.mutation(api.subscriptions.activateSubscription, {
            paymentReference: result.reference,
          });
          logger.info("Stripe webhook: subscription activated", { eventId });
        } else if (result.orderId) {
          // Fall back to an order payment when this session is for an order.
          const order = await convexClient.query(api.orders.getOrderByOrderIdOnly, {
            orderId: result.orderId,
          });
          if (order) {
            await convexClient.mutation(api.orders.updatePaymentStatus, {
              orderId: result.orderId,
              restaurantId: order.restaurantId,
              paymentStatus: "paid",
              paymentReference: result.reference,
              paymentTimestamp: Date.now(),
            });
          }
        }
      }
    }

    await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
      eventId,
    });
    return NextResponse.json({ message: "processed" }, { status: 200 });
  } catch (error) {
    logger.error("Stripe webhook: processing error", { eventId });
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { message: "Stripe webhook endpoint is active" },
    { status: 200 }
  );
}
