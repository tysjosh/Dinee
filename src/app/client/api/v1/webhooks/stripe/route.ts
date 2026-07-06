/**
 * Stripe Webhook Handler (United States market) — recurring subscriptions.
 *
 * Verifies the signature with the signing secret, logs each event idempotently
 * (keyed by the Stripe event id), and drives the recurring subscription
 * lifecycle:
 *   - `checkout.session.completed` (mode=subscription) → link the Stripe
 *     subscription + customer to our record and activate it.
 *   - `invoice.paid` → renewal: extend the period and set active, record invoice.
 *   - `invoice.payment_failed` → set past_due, record a failed invoice.
 *   - `customer.subscription.deleted` → cancel our subscription.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { createStripeProvider } from "@/lib/payment/StripeProvider";
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

/**
 * Extracts the Stripe subscription id from an invoice across SDK/API versions.
 * Older APIs expose `invoice.subscription`; newer ones move it to
 * `invoice.parent.subscription_details.subscription` or the line item.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | null } | null } | null;
    lines?: {
      data?: Array<{
        subscription?: string | null;
        parent?: { subscription_item_details?: { subscription?: string | null } | null } | null;
      }>;
    };
  };
  if (typeof inv.subscription === "string") return inv.subscription;
  if (inv.subscription && typeof inv.subscription === "object" && inv.subscription.id) {
    return inv.subscription.id;
  }
  const parentSub = inv.parent?.subscription_details?.subscription;
  if (typeof parentSub === "string") return parentSub;
  const line = inv.lines?.data?.[0];
  if (line && typeof line.subscription === "string") return line.subscription;
  const lineParentSub = line?.parent?.subscription_item_details?.subscription;
  if (typeof lineParentSub === "string") return lineParentSub;
  return undefined;
}

/** Reads the recurring period end (ms) from an invoice's first line, if present. */
function invoicePeriod(invoice: Stripe.Invoice): { start: number; end: number } | null {
  const line = invoice.lines?.data?.[0];
  if (line?.period?.start && line?.period?.end) {
    return { start: line.period.start * 1000, end: line.period.end * 1000 };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  const stripe = createStripeProvider();
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const event = stripe.constructEvent(rawBody, signature);
  if (!event) {
    logger.warn("Stripe webhook: invalid signature or missing secret");
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 422 });
  }

  // Idempotency: Stripe event ids are globally unique.
  const eventId = `stripe_${event.id}`;
  try {
    const insertResult = await convexClient.mutation(
      api.webhookEvents.atomicInsertWebhookEvent,
      {
        eventId,
        provider: "stripe",
        eventType: event.type,
        payload: rawBody,
        signature: signature || undefined,
        verified: true,
        processed: false,
      }
    );
    if (!insertResult.inserted) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }
  } catch {
    logger.error("Stripe webhook: failed to log event", { eventId });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const ourSubscriptionId = session.metadata?.subscriptionId;
        const stripeSubscriptionId =
          typeof session.subscription === "string" ? session.subscription : undefined;
        if (ourSubscriptionId && stripeSubscriptionId) {
          await convexClient.mutation(api.subscriptions.linkStripeSubscription, {
            subscriptionId: ourSubscriptionId,
            stripeSubscriptionId,
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : undefined,
          });
          logger.info("Stripe webhook: subscription linked + activated", { eventId });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubscriptionId = invoiceSubscriptionId(invoice);
        if (!stripeSubscriptionId) break;
        const sub = await convexClient.query(
          api.subscriptions.getSubscriptionByStripeSubscriptionId,
          { stripeSubscriptionId }
        );
        if (!sub) break;
        const period = invoicePeriod(invoice);
        const now = Date.now();
        await convexClient.mutation(api.subscriptions.updateSubscriptionStatus, {
          subscriptionId: sub.subscriptionId,
          status: "active",
          paymentReference: invoice.id ?? undefined,
          failedPaymentCount: 0,
          lastPaymentAttempt: now,
          ...(period && {
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
          }),
        });
        await convexClient.mutation(api.subscriptions.createInvoice, {
          invoiceId: `inv_${invoice.id}`,
          subscriptionId: sub.subscriptionId,
          restaurantId: sub.restaurantId,
          amount: (invoice.amount_paid ?? 0) / 100,
          currency: (invoice.currency ?? "usd").toUpperCase(),
          status: "paid",
          paymentProvider: "stripe",
          paymentReference: invoice.id ?? undefined,
          periodStart: period?.start ?? sub.currentPeriodStart,
          periodEnd: period?.end ?? sub.currentPeriodEnd,
          description: `Stripe subscription payment — ${sub.billingCycle} billing`,
        });
        logger.info("Stripe webhook: subscription renewed", { eventId });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubscriptionId = invoiceSubscriptionId(invoice);
        if (!stripeSubscriptionId) break;
        const sub = await convexClient.query(
          api.subscriptions.getSubscriptionByStripeSubscriptionId,
          { stripeSubscriptionId }
        );
        if (!sub) break;
        await convexClient.mutation(api.subscriptions.updateSubscriptionStatus, {
          subscriptionId: sub.subscriptionId,
          status: "past_due",
          lastPaymentAttempt: Date.now(),
          lastPaymentError: "Stripe invoice payment failed",
          failedPaymentCount: (sub.failedPaymentCount ?? 0) + 1,
        });
        logger.warn("Stripe webhook: subscription past_due", { eventId });
        break;
      }

      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const sub = await convexClient.query(
          api.subscriptions.getSubscriptionByStripeSubscriptionId,
          { stripeSubscriptionId: stripeSub.id }
        );
        if (!sub) break;
        await convexClient.mutation(api.subscriptions.cancelSubscription, {
          subscriptionId: sub.subscriptionId,
          cancelImmediately: true,
          reason: "Stripe subscription deleted",
        });
        logger.info("Stripe webhook: subscription cancelled", { eventId });
        break;
      }

      default:
        logger.info(`Stripe webhook: unhandled event ${event.type}`, { eventId });
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
