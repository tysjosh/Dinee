/**
 * Stripe (US) billing wiring tests.
 *
 * These exercise everything that does NOT require Stripe's live API: region →
 * provider/currency selection, USD plan pricing + formatting, and the
 * StripeProvider's offline behavior (key validation, webhook secret guard).
 *
 * A full live charge test additionally needs STRIPE_SECRET_KEY + a webhook
 * (see the "Live test" note in the PR/DEPLOYMENT).
 */

import { describe, it, expect } from "vitest";
import {
  getDefaultPaymentProvider,
  getCurrencyForCountry,
  getSubscriptionProvidersForCountry,
  resolveSubscriptionProvider,
  formatMoney,
} from "../../src/lib/region";
import {
  getPlanById,
  getPlanPrice,
} from "../../src/lib/billing/SubscriptionService";
import {
  StripeProvider,
  createStripeProvider,
} from "../../src/lib/payment/StripeProvider";

describe("region → payment provider + currency", () => {
  it("routes US to Stripe/USD and Nigeria to Paystack/NGN", () => {
    expect(getDefaultPaymentProvider("US")).toBe("stripe");
    expect(getDefaultPaymentProvider("NG")).toBe("paystack");
    expect(getDefaultPaymentProvider(undefined)).toBe("paystack"); // default NG
    expect(getCurrencyForCountry("US")).toBe("USD");
    expect(getCurrencyForCountry("NG")).toBe("NGN");
  });

  it("makes Flutterwave selectable for Nigeria while excluding COD as a subscription rail", () => {
    // Nigeria offers a choice of subscription rails; COD is per-order only.
    expect(getSubscriptionProvidersForCountry("NG")).toEqual([
      "paystack",
      "flutterwave",
    ]);
    // The US has a single rail.
    expect(getSubscriptionProvidersForCountry("US")).toEqual(["stripe"]);
  });

  it("honors a valid requested provider and falls back to the country default", () => {
    // Flutterwave is now reachable at checkout for NG (previously dead).
    expect(resolveSubscriptionProvider("NG", "flutterwave")).toBe("flutterwave");
    expect(resolveSubscriptionProvider("NG", "paystack")).toBe("paystack");
    // Invalid / cross-region / missing requests fall back to the default.
    expect(resolveSubscriptionProvider("NG", "stripe")).toBe("paystack");
    expect(resolveSubscriptionProvider("NG", "cod")).toBe("paystack");
    expect(resolveSubscriptionProvider("NG", undefined)).toBe("paystack");
    expect(resolveSubscriptionProvider("US", "flutterwave")).toBe("stripe");
  });
});

describe("USD plan pricing", () => {
  it("prices the tiers in USD with 2-months-free yearly", () => {
    const starter = getPlanById("starter")!;
    const growth = getPlanById("growth")!;
    const enterprise = getPlanById("enterprise")!;

    expect(getPlanPrice(starter, "USD", "monthly")).toBe(49);
    expect(getPlanPrice(growth, "USD", "monthly")).toBe(99);
    expect(getPlanPrice(enterprise, "USD", "monthly")).toBe(249);

    // Yearly = 10 months (2 free).
    expect(getPlanPrice(starter, "USD", "yearly")).toBe(490);
    expect(getPlanPrice(growth, "USD", "yearly")).toBe(990);

    // NGN fallback unchanged.
    expect(getPlanPrice(starter, "NGN", "monthly")).toBe(15000);
  });

  it("formats money per currency", () => {
    expect(formatMoney(49, "USD")).toBe("$49.00");
    expect(formatMoney(15000, "NGN")).toBe("₦15,000");
  });
});

describe("StripeProvider offline behavior", () => {
  it("rejects a missing or malformed secret key", () => {
    expect(() => new StripeProvider({ secretKey: "" })).toThrow();
    expect(() => new StripeProvider({ secretKey: "not-a-key" })).toThrow();
  });

  it("constructs with a test-format key and reports name 'stripe'", () => {
    const provider = new StripeProvider({ secretKey: "sk_test_dummy1234" });
    expect(provider.name).toBe("stripe");
  });

  it("constructEvent returns null when no webhook secret is configured", () => {
    const provider = new StripeProvider({ secretKey: "sk_test_dummy1234" });
    expect(provider.constructEvent("{}", "sig")).toBeNull();
  });

  it("createStripeProvider throws without STRIPE_SECRET_KEY and builds with it", () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => createStripeProvider()).toThrow();

    process.env.STRIPE_SECRET_KEY = "sk_test_dummy1234";
    expect(createStripeProvider()).toBeInstanceOf(StripeProvider);

    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  });
});
