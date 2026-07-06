/**
 * Stripe Payment Provider (United States market)
 *
 * Implements the PaymentProvider interface for Stripe, the US payment rail —
 * mirroring PaystackProvider so the billing/checkout code can select a provider
 * by the tenant's country without special-casing. Uses Stripe Checkout Sessions
 * for a hosted payment page (like Paystack's authorization_url).
 *
 * Amounts are handled in the smallest currency unit (cents for USD), matching
 * how Paystack uses kobo.
 *
 * Env: STRIPE_SECRET_KEY (sk_test_* / sk_live_*), STRIPE_WEBHOOK_SECRET.
 */

import Stripe from "stripe";
import type { Order } from "@/types/global.d";
import type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerifyResult,
  WebhookResult,
  PaymentStatus,
} from "./types";

interface StripeProviderConfig {
  secretKey: string;
  webhookSecret?: string;
  /** Success/return URL for the hosted checkout. */
  callbackUrl?: string;
}

/** Maps a Stripe Checkout Session payment_status to our PaymentStatus. */
function mapStripeStatus(status: string | null): PaymentStatus {
  switch (status) {
    case "paid":
    case "no_payment_required":
      return "paid";
    case "unpaid":
    default:
      return "pending";
  }
}

function getCustomerEmail(order: Order): string {
  // Stripe requires a customer email for receipts; fall back to a placeholder
  // domain when the order carries none (voice orders often have only a phone).
  const email = (order as { customerEmail?: string }).customerEmail;
  return email && email.includes("@") ? email : "customer@dinee.app";
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  private readonly stripe: Stripe;
  private readonly testMode: boolean;
  private readonly webhookSecret?: string;
  private readonly callbackUrl?: string;

  constructor(config: StripeProviderConfig) {
    if (!config.secretKey) {
      throw new Error(
        "StripeProvider: secretKey is required. Set STRIPE_SECRET_KEY " +
          "(get it from https://dashboard.stripe.com/apikeys)."
      );
    }
    if (
      !config.secretKey.startsWith("sk_test_") &&
      !config.secretKey.startsWith("sk_live_")
    ) {
      throw new Error(
        "StripeProvider: secretKey must start with 'sk_test_' or 'sk_live_'."
      );
    }
    this.stripe = new Stripe(config.secretKey);
    this.testMode = config.secretKey.startsWith("sk_test_");
    this.webhookSecret = config.webhookSecret;
    this.callbackUrl = config.callbackUrl;

    if (this.testMode) {
      console.warn(
        "⚠️ StripeProvider is running in TEST mode. Transactions will not be charged."
      );
    }
  }

  /** Create a Stripe Checkout Session and return its hosted URL. */
  async initializeTransaction(order: Order): Promise<PaymentInitResult> {
    // Stripe expects the amount in cents.
    const amountInCents = Math.round(order.totalAmount * 100);
    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: getCustomerEmail(order),
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `Order ${order.id}` },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          orderId: order.id,
          customerName: order.customerName ?? "",
        },
        success_url: this.callbackUrl
          ? `${this.callbackUrl}?session_id={CHECKOUT_SESSION_ID}`
          : "https://app.dinee.com/billing/verify?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: this.callbackUrl ?? "https://app.dinee.com/billing",
      });

      if (!session.url) {
        return {
          success: false,
          reference: session.id,
          error: "Stripe did not return a checkout URL",
        };
      }
      return { success: true, reference: session.id, paymentUrl: session.url };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Stripe error";
      return { success: false, reference: "", error: message };
    }
  }

  /**
   * Create a RECURRING subscription-mode Checkout Session (Stripe Billing).
   * Uses inline `price_data` with a recurring interval so no pre-provisioned
   * Price objects are needed. `referenceId` (our subscription id) is attached to
   * both the session and the Stripe Subscription metadata for correlation.
   */
  async createSubscriptionCheckout(params: {
    planName: string;
    /** Amount in the smallest currency unit (cents). */
    amountMinor: number;
    /** ISO currency, e.g. "usd". */
    currency: string;
    interval: "month" | "year";
    referenceId: string;
    customerEmail?: string;
  }): Promise<PaymentInitResult> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: params.customerEmail,
        line_items: [
          {
            price_data: {
              currency: params.currency,
              product_data: { name: params.planName },
              unit_amount: params.amountMinor,
              recurring: { interval: params.interval },
            },
            quantity: 1,
          },
        ],
        metadata: { subscriptionId: params.referenceId },
        subscription_data: {
          metadata: { subscriptionId: params.referenceId },
        },
        success_url: this.callbackUrl
          ? `${this.callbackUrl}?session_id={CHECKOUT_SESSION_ID}`
          : "https://app.dinee.com/billing/verify?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: this.callbackUrl ?? "https://app.dinee.com/billing",
      });
      if (!session.url) {
        return {
          success: false,
          reference: session.id,
          error: "Stripe did not return a checkout URL",
        };
      }
      return { success: true, reference: session.id, paymentUrl: session.url };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Stripe error";
      return { success: false, reference: "", error: message };
    }
  }

  /**
   * Verify + parse a raw webhook into a typed Stripe.Event using the signing
   * secret. Returns null when the secret is missing or verification fails.
   */
  constructEvent(rawBody: string, signature: string): Stripe.Event | null {
    if (!this.webhookSecret) return null;
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret
      );
    } catch {
      return null;
    }
  }

  /** Verify a checkout session by its id (the reference). */
  async verifyTransaction(reference: string): Promise<PaymentVerifyResult> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(reference);
      return {
        success: true,
        status: mapStripeStatus(session.payment_status),
        amount: session.amount_total ?? 0,
        currency: (session.currency ?? "usd").toUpperCase(),
        metadata: (session.metadata ?? undefined) as
          | Record<string, unknown>
          | undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Stripe error";
      return { success: false, status: "failed", amount: 0, currency: "USD", metadata: { error: message } };
    }
  }

  /** Verify + parse a Stripe webhook using the signing secret. */
  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    if (!this.webhookSecret) {
      return { valid: false, event: "", status: undefined };
    }
    try {
      const raw =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      const event = this.stripe.webhooks.constructEvent(
        raw,
        signature,
        this.webhookSecret
      );
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        valid: true,
        event: event.type,
        orderId:
          typeof session.metadata?.orderId === "string"
            ? session.metadata.orderId
            : undefined,
        // The Checkout Session id is the reference we persisted on the
        // subscription, so the webhook route can activate it.
        reference: session.id,
        status:
          event.type === "checkout.session.completed"
            ? mapStripeStatus(session.payment_status)
            : undefined,
      };
    } catch {
      return { valid: false, event: "", status: undefined };
    }
  }
}

/** Factory reading STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET from the env. */
export function createStripeProvider(callbackUrl?: string): StripeProvider {
  return new StripeProvider({
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    callbackUrl,
  });
}
