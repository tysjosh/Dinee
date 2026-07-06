/**
 * Convex Subscriptions Functions
 * 
 * Provides mutations and queries for managing restaurant subscriptions.
 * 
 * @module convex/subscriptions
 * @requirements 26.3 - Subscription plans with feature tiers
 * @requirements 26.4 - Integration with Paystack/Flutterwave for billing
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// ============================================================================
// Subscription Status and Billing Cycle Validators
// ============================================================================

const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("cancelled"),
  v.literal("past_due"),
  v.literal("trialing")
);

const billingCycleValidator = v.union(
  v.literal("monthly"),
  v.literal("yearly")
);

const paymentProviderValidator = v.union(
  v.literal("paystack"),
  v.literal("flutterwave"),
  v.literal("stripe")
);

const invoiceStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("refunded")
);

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a subscription by ID
 */
export const getSubscription = query({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    return subscription;
  },
});

/**
 * Get subscription by restaurant ID
 */
export const getSubscriptionByRestaurant = query({
  args: {
    restaurantId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();
    
    return subscription;
  },
});

/**
 * Get all subscriptions with a specific status
 */
export const getSubscriptionsByStatus = query({
  args: {
    status: subscriptionStatusValidator,
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
    
    return subscriptions;
  },
});
/**
 * Get all subscriptions (for admin panel)
 */
export const getAllSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const subscriptions = await ctx.db.query("subscriptions").collect();
    return subscriptions;
  },
});

/**
 * Get subscription by payment reference
 * Used by the verify endpoint to find the subscription created during checkout.
 */
export const getSubscriptionByPaymentReference = query({
  args: {
    paymentReference: v.string(),
  },
  handler: async (ctx, args) => {
    // No dedicated index on paymentReference, so scan all and filter.
    // This is acceptable because the table is small (one subscription per restaurant).
    const allSubs = await ctx.db.query("subscriptions").collect();
    return allSubs.find((sub) => sub.paymentReference === args.paymentReference) ?? null;
  },
});


/**
 * Get subscription invoices for a restaurant
 */
export const getInvoicesByRestaurant = query({
  args: {
    restaurantId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    
    const invoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .order("desc")
      .take(limit);
    
    return invoices;
  },
});

/**
 * Get subscription invoices by subscription ID
 */
export const getInvoicesBySubscription = query({
  args: {
    subscriptionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    
    const invoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .order("desc")
      .take(limit);
    
    return invoices;
  },
});

/**
 * Get a specific invoice by ID
 */
export const getInvoice = query({
  args: {
    invoiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_invoice_id", (q) => q.eq("invoiceId", args.invoiceId))
      .first();
    
    return invoice;
  },
});

/**
 * Get subscriptions expiring soon (for billing reminders)
 * @requirements 26.6 - Send billing reminders before subscription renewal
 */
export const getExpiringSubscriptions = query({
  args: {
    daysUntilExpiry: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiryThreshold = now + (args.daysUntilExpiry * 24 * 60 * 60 * 1000);
    
    // Get all active subscriptions
    const activeSubscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    
    // Filter to those expiring within the threshold
    const expiringSubscriptions = activeSubscriptions.filter(
      (sub) => sub.currentPeriodEnd <= expiryThreshold && sub.currentPeriodEnd > now
    );
    
    return expiringSubscriptions;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new subscription
 * @requirements 26.3 - Define subscription plans with feature tiers
 */
export const createSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    restaurantId: v.string(),
    planId: v.string(),
    status: subscriptionStatusValidator,
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    // Optional: omitted for a free trial with no card on file (Option A).
    paymentProvider: v.optional(paymentProviderValidator),
    paymentReference: v.optional(v.string()),
    billingCycle: billingCycleValidator,
    trialEndsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if restaurant already has a subscription — update it instead of rejecting
    const existingSubscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    if (existingSubscription) {
      await ctx.db.patch(existingSubscription._id, {
        subscriptionId: args.subscriptionId,
        planId: args.planId,
        status: args.status,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        paymentProvider: args.paymentProvider,
        paymentReference: args.paymentReference,
        billingCycle: args.billingCycle,
        trialEndsAt: args.trialEndsAt,
      });
      return existingSubscription._id;
    }

    const subscriptionId = await ctx.db.insert("subscriptions", {
      subscriptionId: args.subscriptionId,
      restaurantId: args.restaurantId,
      planId: args.planId,
      status: args.status,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      paymentProvider: args.paymentProvider,
      paymentReference: args.paymentReference,
      billingCycle: args.billingCycle,
      trialEndsAt: args.trialEndsAt,
      createdAt: now,
    });

    return subscriptionId;
  },
});

/**
 * Start a free trial subscription with NO payment method (Option A:
 * free-trial-first).
 *
 * This is the honest onboarding path: the tenant picks a plan and gets a
 * time-boxed `trialing` subscription with NO `paymentProvider` and NO
 * `paymentReference` — no charge is implied. Payment is collected later through
 * the dashboard checkout (which sets a real provider + reference). Dates and the
 * subscription id are computed server-side. Idempotent per restaurant: an
 * existing subscription is updated rather than duplicated.
 */
export const startTrialSubscription = mutation({
  args: {
    restaurantId: v.string(),
    planId: v.string(),
    billingCycle: billingCycleValidator,
    trialDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const trialDays = args.trialDays ?? 14;
    const trialEndsAt = now + trialDays * 24 * 60 * 60 * 1000;
    const subscriptionId = `SUB_${crypto.randomUUID()}`;

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_restaurant_id", (q) =>
        q.eq("restaurantId", args.restaurantId)
      )
      .first();

    if (existing) {
      // Don't clobber an already-paid subscription with a trial.
      if (existing.paymentReference || existing.status === "active") {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        planId: args.planId,
        status: "trialing",
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        billingCycle: args.billingCycle,
        trialEndsAt,
        // Explicitly no payment provider/reference for a trial.
        paymentProvider: undefined,
        paymentReference: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("subscriptions", {
      subscriptionId,
      restaurantId: args.restaurantId,
      planId: args.planId,
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      billingCycle: args.billingCycle,
      trialEndsAt,
      createdAt: now,
    });
  },
});

/**
 * Activate a pending subscription after payment is confirmed.
 * Sets status to active and records the period start from now.
 */
export const activateSubscription = mutation({
  args: {
    paymentReference: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .filter((q) => q.eq(q.field("paymentReference"), args.paymentReference))
      .first();

    if (!subscription) {
      throw new Error(`No subscription found for reference ${args.paymentReference}`);
    }

    if (subscription.status === "active") {
      // Already activated (e.g. duplicate callback) — no-op
      return subscription._id;
    }

    const now = Date.now();
    let periodEnd = subscription.currentPeriodEnd;

    // Recalculate period from now (payment confirmation time)
    if (subscription.billingCycle === "yearly") {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() + 1);
      periodEnd = d.getTime();
    } else {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
      periodEnd = d.getTime();
    }

    await ctx.db.patch(subscription._id, {
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    return subscription._id;
  },
});

/**
 * Update subscription status
 * @requirements 26.7 - Retry failed payments
 * @requirements 26.8 - Downgrade on persistent failure
 */
export const updateSubscriptionStatus = mutation({
  args: {
    subscriptionId: v.string(),
    status: subscriptionStatusValidator,
    paymentReference: v.optional(v.string()),
    failedPaymentCount: v.optional(v.number()),
    lastPaymentAttempt: v.optional(v.number()),
    lastPaymentError: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    const updates: Record<string, unknown> = {
      status: args.status,
    };
    
    if (args.paymentReference !== undefined) {
      updates.paymentReference = args.paymentReference;
    }
    if (args.failedPaymentCount !== undefined) {
      updates.failedPaymentCount = args.failedPaymentCount;
    }
    if (args.lastPaymentAttempt !== undefined) {
      updates.lastPaymentAttempt = args.lastPaymentAttempt;
    }
    if (args.lastPaymentError !== undefined) {
      updates.lastPaymentError = args.lastPaymentError;
    }
    if (args.currentPeriodStart !== undefined) {
      updates.currentPeriodStart = args.currentPeriodStart;
    }
    if (args.currentPeriodEnd !== undefined) {
      updates.currentPeriodEnd = args.currentPeriodEnd;
    }
    
    await ctx.db.patch(subscription._id, updates);
    
    return subscription._id;
  },
});

/**
 * Cancel a subscription
 */
export const cancelSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    cancelImmediately: v.optional(v.boolean()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    const now = Date.now();
    
    if (args.cancelImmediately) {
      // Cancel immediately
      await ctx.db.patch(subscription._id, {
        status: "cancelled",
        cancelledAt: now,
        currentPeriodEnd: now,
      });
    } else {
      // Cancel at end of period
      await ctx.db.patch(subscription._id, {
        status: "cancelled",
        cancelledAt: now,
        // Keep currentPeriodEnd as is - subscription remains active until then
      });
    }
    
    return subscription._id;
  },
});

/**
 * Upgrade or downgrade subscription plan
 */
export const changePlan = mutation({
  args: {
    subscriptionId: v.string(),
    newPlanId: v.string(),
    effectiveImmediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    if (subscription.status === "cancelled") {
      throw new Error("Cannot change plan for a cancelled subscription");
    }
    
    await ctx.db.patch(subscription._id, {
      planId: args.newPlanId,
    });
    
    return subscription._id;
  },
});

/**
 * Renew subscription (extend period)
 */
export const renewSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    newPeriodStart: v.number(),
    newPeriodEnd: v.number(),
    paymentReference: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    await ctx.db.patch(subscription._id, {
      status: "active",
      currentPeriodStart: args.newPeriodStart,
      currentPeriodEnd: args.newPeriodEnd,
      paymentReference: args.paymentReference,
      failedPaymentCount: 0,
      lastPaymentError: undefined,
    });
    
    return subscription._id;
  },
});

// ============================================================================
// Invoice Mutations
// ============================================================================

/**
 * Create a subscription invoice
 * @requirements 26.5 - Display billing history
 */
export const createInvoice = mutation({
  args: {
    invoiceId: v.string(),
    subscriptionId: v.string(),
    restaurantId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: invoiceStatusValidator,
    paymentProvider: paymentProviderValidator,
    paymentReference: v.optional(v.string()),
    periodStart: v.number(),
    periodEnd: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const invoiceId = await ctx.db.insert("subscriptionInvoices", {
      invoiceId: args.invoiceId,
      subscriptionId: args.subscriptionId,
      restaurantId: args.restaurantId,
      amount: args.amount,
      currency: args.currency,
      status: args.status,
      paymentProvider: args.paymentProvider,
      paymentReference: args.paymentReference,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      description: args.description,
      createdAt: now,
    });
    
    return invoiceId;
  },
});

/**
 * Update invoice status (e.g., when payment completes)
 */
export const updateInvoiceStatus = mutation({
  args: {
    invoiceId: v.string(),
    status: invoiceStatusValidator,
    paymentReference: v.optional(v.string()),
    paidAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_invoice_id", (q) => q.eq("invoiceId", args.invoiceId))
      .first();
    
    if (!invoice) {
      throw new Error(`Invoice ${args.invoiceId} not found`);
    }
    
    const updates: Record<string, unknown> = {
      status: args.status,
    };
    
    if (args.paymentReference !== undefined) {
      updates.paymentReference = args.paymentReference;
    }
    if (args.paidAt !== undefined) {
      updates.paidAt = args.paidAt;
    }
    
    await ctx.db.patch(invoice._id, updates);
    
    return invoice._id;
  },
});

// ============================================================================
// Payment Failure Handling
// ============================================================================

/**
 * Record a payment failure for a subscription
 * Increments failure count and records error details
 * 
 * @requirements 26.7 - Retry failed payments
 */
export const recordPaymentFailure = mutation({
  args: {
    subscriptionId: v.string(),
    errorMessage: v.string(),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    const now = Date.now();
    const currentFailedCount = subscription.failedPaymentCount ?? 0;
    const newFailedCount = currentFailedCount + 1;
    
    // Update subscription with failure info
    await ctx.db.patch(subscription._id, {
      status: "past_due",
      failedPaymentCount: newFailedCount,
      lastPaymentAttempt: now,
      lastPaymentError: args.errorMessage,
    });
    
    // Log the failure for audit
    console.log(
      `Payment failure recorded for subscription ${args.subscriptionId}:`,
      `Attempt ${newFailedCount}, Error: ${args.errorMessage}`
    );
    
    return {
      subscriptionId: args.subscriptionId,
      failedPaymentCount: newFailedCount,
      lastPaymentAttempt: now,
    };
  },
});

/**
 * Get subscriptions with failed payments that need retry
 * Returns subscriptions that are past_due and haven't exceeded max retries
 * 
 * @requirements 26.7 - Retry failed payments
 */
export const getSubscriptionsWithFailedPayments = query({
  args: {
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries ?? 3;
    
    // Get all past_due subscriptions
    const pastDueSubscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();
    
    // Filter to those that haven't exceeded max retries
    const subscriptionsNeedingRetry = pastDueSubscriptions.filter(
      (sub) => (sub.failedPaymentCount ?? 0) < maxRetries
    );
    
    return subscriptionsNeedingRetry;
  },
});

/**
 * Get subscriptions that have exceeded max retries and need downgrade
 * 
 * @requirements 26.8 - Downgrade on persistent failure
 */
export const getSubscriptionsNeedingDowngrade = query({
  args: {
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries ?? 3;
    
    // Get all past_due subscriptions
    const pastDueSubscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();
    
    // Filter to those that have exceeded max retries
    const subscriptionsNeedingDowngrade = pastDueSubscriptions.filter(
      (sub) => (sub.failedPaymentCount ?? 0) >= maxRetries
    );
    
    return subscriptionsNeedingDowngrade;
  },
});

/**
 * Downgrade a subscription to a lower plan due to persistent payment failure
 * 
 * @requirements 26.8 - Downgrade on persistent failure
 */
export const downgradeSubscription = mutation({
  args: {
    subscriptionId: v.string(),
    newPlanId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    const now = Date.now();
    const previousPlanId = subscription.planId;
    
    // Update subscription with new plan and reset failure count
    await ctx.db.patch(subscription._id, {
      planId: args.newPlanId,
      status: "active", // Reactivate on downgrade
      failedPaymentCount: 0,
      lastPaymentError: args.reason ?? `Downgraded from ${previousPlanId} due to payment failure`,
    });
    
    // Log the downgrade for audit
    console.log(
      `Subscription ${args.subscriptionId} downgraded:`,
      `From ${previousPlanId} to ${args.newPlanId}`,
      `Reason: ${args.reason ?? 'Persistent payment failure'}`
    );
    
    return {
      subscriptionId: args.subscriptionId,
      previousPlanId,
      newPlanId: args.newPlanId,
      downgradedAt: now,
    };
  },
});

/**
 * Reset payment failure count after successful payment
 * 
 * @requirements 26.7 - Retry failed payments
 */
export const resetPaymentFailures = mutation({
  args: {
    subscriptionId: v.string(),
    paymentReference: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    
    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }
    
    // Reset failure tracking and update status
    await ctx.db.patch(subscription._id, {
      status: "active",
      failedPaymentCount: 0,
      lastPaymentError: undefined,
      paymentReference: args.paymentReference,
    });
    
    console.log(
      `Payment failures reset for subscription ${args.subscriptionId}`,
      `New payment reference: ${args.paymentReference}`
    );
    
    return subscription._id;
  },
});

/**
 * Get payment failure history for a subscription
 * Returns recent invoices with failed status
 */
export const getPaymentFailureHistory = query({
  args: {
    subscriptionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    
    // Get failed invoices for this subscription
    const allInvoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .order("desc")
      .take(limit * 2); // Get more to filter
    
    // Filter to failed invoices
    const failedInvoices = allInvoices
      .filter((invoice) => invoice.status === "failed")
      .slice(0, limit);
    
    return failedInvoices;
  },
});

// ============================================================================
// Usage Tracking Queries
// ============================================================================

/**
 * Get subscription usage for a restaurant
 * Used for checking against plan limits
 */
export const getSubscriptionUsage = query({
  args: {
    restaurantId: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    // Get branch count
    const branches = await ctx.db
      .query("branches")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    
    // Get calls in period
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    
    const callsInPeriod = calls.filter(
      (call) => call.callStartTime && 
        call.callStartTime >= args.periodStart && 
        call.callStartTime <= args.periodEnd
    );
    
    // Get orders in period
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    
    const ordersInPeriod = orders.filter(
      (order) => order.orderPlacementTime && 
        order.orderPlacementTime >= args.periodStart && 
        order.orderPlacementTime <= args.periodEnd
    );
    
    // Get menu items count
    const menuItems = await ctx.db
      .query("menuItems")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();
    
    // Get team members count
    const users = await ctx.db
      .query("users")
      .withIndex("by_tenant", (q) => q.eq("tenantType", "restaurant").eq("tenantId", args.restaurantId))
      .collect();
    
    return {
      restaurantId: args.restaurantId,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      branchCount: branches.length,
      callsThisPeriod: callsInPeriod.length,
      ordersThisPeriod: ordersInPeriod.length,
      catalogItemCount: menuItems.length,
      teamMemberCount: users.length,
    };
  },
});


// ============================================================================
// Internal Mutations (for cron jobs)
// ============================================================================

/**
 * Check for expired trials and transition them to past_due.
 * Called daily by the check-trial-expiry cron job.
 *
 * @requirements 4.1 - Cron checks subscriptions where trialEndsAt < now and status === "trialing"
 * @requirements 4.2 - Expired trials are changed to past_due
 */
export const checkTrialExpiry = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const trialingSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "trialing"))
      .collect();

    const expired = trialingSubs.filter(
      (sub) => sub.trialEndsAt !== undefined && sub.trialEndsAt < now
    );

    for (const sub of expired) {
      await ctx.db.patch(sub._id, { status: "past_due" });
    }

    if (expired.length > 0) {
      console.log(`checkTrialExpiry: transitioned ${expired.length} trialing subscription(s) to past_due`);
    }

    return { processed: expired.length };
  },
});

/**
 * Enforce past_due subscriptions that have been unpaid for more than 7 days.
 * Downgrades them to cancelled and sets the plan to the free/starter tier.
 * Called daily by the enforce-past-due cron job.
 *
 * @requirements 4.5 - After 7 days in past_due with no payment, downgrade to cancelled
 */
export const enforcePastDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const pastDueSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();

    const overdue = pastDueSubs.filter((sub) => {
      // Use lastPaymentAttempt if available, otherwise fall back to the period end
      // to determine how long the subscription has been past_due
      const pastDueSince = sub.lastPaymentAttempt ?? sub.currentPeriodEnd;
      return now - pastDueSince >= sevenDaysMs;
    });

    for (const sub of overdue) {
      await ctx.db.patch(sub._id, {
        status: "cancelled",
        planId: "starter",
        cancelledAt: now,
      });
    }

    if (overdue.length > 0) {
      console.log(`enforcePastDue: cancelled ${overdue.length} subscription(s) past_due for 7+ days`);
    }

    return { processed: overdue.length };
  },
});

/**
 * Apply pending plan changes for subscriptions whose current period has ended.
 * Called daily by the apply-pending-plan-changes cron job.
 *
 * @requirements 6.5 - On the next renewal, the cron job applies the pending plan change
 */
export const applyPendingPlanChanges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all active subscriptions and filter for those with a pending plan change
    // whose billing period has ended
    const activeSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const pending = activeSubs.filter(
      (sub) => sub.pendingPlanId !== undefined && sub.currentPeriodEnd <= now
    );

    for (const sub of pending) {
      await ctx.db.patch(sub._id, {
        planId: sub.pendingPlanId!,
        pendingPlanId: undefined,
      });
    }

    if (pending.length > 0) {
      console.log(`applyPendingPlanChanges: applied plan changes for ${pending.length} subscription(s)`);
    }

    return { processed: pending.length };
  },
});

// ============================================================================
// Scheduled Plan Change (frontend-callable)
// ============================================================================

/**
 * Schedule a plan change (downgrade) to take effect at the end of the current billing period.
 * Sets pendingPlanId on the subscription so the daily cron can apply it on renewal.
 *
 * @requirements 6.4 - Subscription record is updated with pendingPlanId for scheduled downgrades
 */
export const schedulePlanChange = mutation({
  args: {
    subscriptionId: v.string(),
    newPlanId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();

    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }

    if (subscription.status === "cancelled") {
      throw new Error("Cannot schedule a plan change for a cancelled subscription");
    }

    await ctx.db.patch(subscription._id, {
      pendingPlanId: args.newPlanId,
    });

    return {
      subscriptionId: args.subscriptionId,
      pendingPlanId: args.newPlanId,
      effectiveAt: subscription.currentPeriodEnd,
    };
  },
});

/**
 * Set cancelAtPeriodEnd on a subscription.
 * The subscription remains active until the current period ends, then will not renew.
 *
 * @requirements 6.3 - Cancel takes effect at end of billing period
 */
export const setCancelAtPeriodEnd = mutation({
  args: {
    subscriptionId: v.string(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription_id", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();

    if (!subscription) {
      throw new Error(`Subscription ${args.subscriptionId} not found`);
    }

    await ctx.db.patch(subscription._id, {
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    });

    return {
      subscriptionId: args.subscriptionId,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    };
  },
});


