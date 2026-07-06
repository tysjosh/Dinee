/**
 * Subscription Billing Types and Interfaces
 * 
 * This module defines the types and interfaces for the subscription billing system,
 * supporting tiered subscription plans with Nigerian Naira pricing.
 * 
 * @module billing/types
 * @requirements 26.3 - Subscription plans with feature tiers
 * @requirements 26.4 - Integration with Paystack/Flutterwave for billing
 */

import type { PaymentMethod } from '../payment/types';

// ============================================================================
// Subscription Status and Billing Cycle Types
// ============================================================================

/**
 * Subscription status values
 * - active: Subscription is active and in good standing
 * - cancelled: Subscription has been cancelled
 * - past_due: Payment is overdue
 * - trialing: Subscription is in trial period
 */
export type SubscriptionStatus = 'active' | 'pending' | 'cancelled' | 'past_due' | 'trialing';

/**
 * Billing cycle options
 * - monthly: Billed every month
 * - yearly: Billed annually (with discount)
 */
export type BillingCycle = 'monthly' | 'yearly';

/**
 * Payment providers supported for subscription billing
 */
export type SubscriptionPaymentProvider = Extract<PaymentMethod, 'paystack' | 'flutterwave'>;

// ============================================================================
// Subscription Plan Types
// ============================================================================

/**
 * Feature limits for a subscription plan
 */
export interface PlanLimits {
  /** Maximum number of branches allowed */
  maxBranches: number;
  /** Maximum calls per month (-1 for unlimited) */
  maxCallsPerMonth: number;
  /** Maximum orders per month (-1 for unlimited) */
  maxOrdersPerMonth: number;
  /** Maximum catalog items per branch (-1 for unlimited) */
  maxCatalogItems: number;
  /** Maximum team members (-1 for unlimited) */
  maxTeamMembers: number;
}

/**
 * Features included in a subscription plan
 */
export interface PlanFeatures {
  /** WhatsApp messaging enabled */
  whatsappMessaging: boolean;
  /** SMS messaging enabled */
  smsMessaging: boolean;
  /** Advanced analytics enabled */
  advancedAnalytics: boolean;
  /** API access enabled */
  apiAccess: boolean;
  /** Priority support enabled */
  prioritySupport: boolean;
  /** Custom AI agent voice enabled */
  customAgentVoice: boolean;
  /** Multi-language support enabled */
  multiLanguageSupport: boolean;
  /** Upsell prompts enabled */
  upsellPrompts: boolean;
  /** Fraud detection enabled */
  fraudDetection: boolean;
  /** CSV export enabled */
  csvExport: boolean;
}

/**
 * Subscription plan definition
 */
export interface SubscriptionPlan {
  /** Unique plan identifier */
  id: string;
  /** Display name of the plan */
  name: string;
  /** Plan description */
  description: string;
  /** Monthly price in Naira */
  priceMonthly: number;
  /** Yearly price in Naira (typically discounted) */
  priceYearly: number;
  /** Currency code */
  currency: string;
  /** Plan limits */
  limits: PlanLimits;
  /** Plan features */
  features: PlanFeatures;
  /** Whether this plan is recommended */
  isRecommended: boolean;
  /** Whether this plan is available for new subscriptions */
  isActive: boolean;
  /** Sort order for display */
  sortOrder: number;
}

// ============================================================================
// Subscription Types
// ============================================================================

/**
 * Subscription record
 */
export interface Subscription {
  /** Unique subscription identifier */
  subscriptionId: string;
  /** Restaurant ID this subscription belongs to */
  restaurantId: string;
  /** Plan ID */
  planId: string;
  /** Current subscription status */
  status: SubscriptionStatus;
  /** Start of current billing period */
  currentPeriodStart: number;
  /** End of current billing period */
  currentPeriodEnd: number;
  /**
   * Payment provider used for billing. Optional: a free trial started at
   * onboarding has no provider until the tenant adds payment via checkout.
   */
  paymentProvider?: SubscriptionPaymentProvider;
  /** Payment reference from provider */
  paymentReference?: string;
  /** When the subscription was created */
  createdAt: number;
  /** When the subscription was cancelled (if applicable) */
  cancelledAt?: number;
  /** Whether the subscription is set to cancel at the end of the current period (set via setCancelAtPeriodEnd) */
  cancelAtPeriodEnd?: boolean;
  /** Billing cycle */
  billingCycle: BillingCycle;
  /** When trial ends (if applicable) */
  trialEndsAt?: number;
  /** Number of failed payment attempts */
  failedPaymentCount?: number;
  /** Last payment attempt timestamp */
  lastPaymentAttempt?: number;
  /** Last payment error message */
  lastPaymentError?: string;
}

/**
 * Subscription invoice record
 */
export interface SubscriptionInvoice {
  /** Unique invoice identifier */
  invoiceId: string;
  /** Subscription ID */
  subscriptionId: string;
  /** Restaurant ID */
  restaurantId: string;
  /** Invoice amount in smallest currency unit */
  amount: number;
  /** Currency code */
  currency: string;
  /** Invoice status */
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  /** Payment provider */
  paymentProvider: SubscriptionPaymentProvider;
  /** Payment reference */
  paymentReference?: string;
  /** Billing period start */
  periodStart: number;
  /** Billing period end */
  periodEnd: number;
  /** When invoice was created */
  createdAt: number;
  /** When invoice was paid */
  paidAt?: number;
  /** Invoice description */
  description?: string;
}

// ============================================================================
// Subscription Service Types
// ============================================================================

/**
 * Result of initializing a subscription
 */
export interface SubscriptionInitResult {
  /** Whether initialization was successful */
  success: boolean;
  /** The created subscription (if successful) */
  subscription?: Subscription;
  /** Payment URL for completing subscription (if applicable) */
  paymentUrl?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Result of processing a subscription payment
 */
export interface SubscriptionPaymentResult {
  /** Whether payment was successful */
  success: boolean;
  /** Updated subscription status */
  status: SubscriptionStatus;
  /** Invoice ID for this payment */
  invoiceId?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Result of checking subscription limits
 */
export interface SubscriptionLimitsResult {
  /** Whether the business is within limits */
  withinLimits: boolean;
  /** Current usage */
  usage: {
    branches: number;
    callsThisMonth: number;
    ordersThisMonth: number;
    catalogItems: number;
    teamMembers: number;
  };
  /** Plan limits */
  limits: PlanLimits;
  /** Which limits are exceeded (if any) */
  exceededLimits: string[];
}

/**
 * Options for creating a subscription
 */
export interface CreateSubscriptionOptions {
  /** Restaurant ID */
  restaurantId: string;
  /** Plan ID */
  planId: string;
  /** Payment provider to use */
  paymentProvider: SubscriptionPaymentProvider;
  /** Billing cycle */
  billingCycle: BillingCycle;
  /** Whether to start with a trial */
  startTrial?: boolean;
  /** Trial duration in days (default: 14) */
  trialDays?: number;
  /** Callback URL for payment completion */
  callbackUrl?: string;
}

/**
 * Options for cancelling a subscription
 */
export interface CancelSubscriptionOptions {
  /** Subscription ID */
  subscriptionId: string;
  /** Whether to cancel immediately or at period end */
  cancelImmediately?: boolean;
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Subscription usage data for a business
 */
export interface SubscriptionUsage {
  /** Restaurant ID */
  restaurantId: string;
  /** Current billing period start */
  periodStart: number;
  /** Current billing period end */
  periodEnd: number;
  /** Number of branches */
  branchCount: number;
  /** Calls this billing period */
  callsThisPeriod: number;
  /** Orders this billing period */
  ordersThisPeriod: number;
  /** Total catalog items */
  catalogItemCount: number;
  /** Team member count */
  teamMemberCount: number;
}

/**
 * Billing reminder data
 */
export interface BillingReminder {
  /** Restaurant ID */
  restaurantId: string;
  /** Subscription ID */
  subscriptionId: string;
  /** Days until renewal */
  daysUntilRenewal: number;
  /** Amount due */
  amountDue: number;
  /** Currency */
  currency: string;
  /** Plan name */
  planName: string;
}
