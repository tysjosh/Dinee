/**
 * Subscription Service
 * 
 * Manages subscription billing for businesses, including plan management,
 * payment processing, and usage limit checking.
 * 
 * @module billing/SubscriptionService
 * @requirements 26.3 - Subscription plans with feature tiers
 * @requirements 26.4 - Integration with Paystack/Flutterwave for billing
 */

import type {
  SubscriptionPlan,
  Subscription,
  SubscriptionStatus,
  BillingCycle,
  SubscriptionPaymentProvider,
  SubscriptionInitResult,
  SubscriptionPaymentResult,
  SubscriptionLimitsResult,
  CreateSubscriptionOptions,
  SubscriptionUsage,
  PlanLimits,
  PlanFeatures,
} from './types';
import { createPaystackProvider } from '../payment/PaystackProvider';
import { createFlutterwaveProvider } from '../payment/FlutterwaveProvider';
import type { PaymentProvider } from '../payment/types';
import type { Order } from '@/types/global.d';

// ============================================================================
// Subscription Plans
// ============================================================================

/**
 * Subscription plans for Nigerian market
 * Prices are in Nigerian Naira (₦)
 * 
 * @requirements 26.3 - Define subscription plans with feature tiers
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for small businesses just getting started with AI-powered communication',
    priceMonthly: 15000, // ₦15,000/month
    priceYearly: 150000, // ₦150,000/year (2 months free)
    currency: 'NGN',
    limits: {
      maxBranches: 1,
      maxCallsPerMonth: 500,
      maxOrdersPerMonth: 300,
      maxCatalogItems: 50,
      maxTeamMembers: 3,
    },
    features: {
      whatsappMessaging: true,
      smsMessaging: false,
      advancedAnalytics: false,
      apiAccess: false,
      prioritySupport: false,
      customAgentVoice: false,
      multiLanguageSupport: true,
      upsellPrompts: false,
      fraudDetection: false,
      csvExport: true,
    },
    isRecommended: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'Ideal for growing businesses with multiple locations and higher volumes',
    priceMonthly: 35000, // ₦35,000/month
    priceYearly: 350000, // ₦350,000/year (2 months free)
    currency: 'NGN',
    limits: {
      maxBranches: 3,
      maxCallsPerMonth: 2000,
      maxOrdersPerMonth: 1500,
      maxCatalogItems: 150,
      maxTeamMembers: 10,
    },
    features: {
      whatsappMessaging: true,
      smsMessaging: true,
      advancedAnalytics: true,
      apiAccess: false,
      prioritySupport: true,
      customAgentVoice: false,
      multiLanguageSupport: true,
      upsellPrompts: true,
      fraudDetection: true,
      csvExport: true,
    },
    isRecommended: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations requiring unlimited capacity and premium features',
    priceMonthly: 75000, // ₦75,000/month
    priceYearly: 750000, // ₦750,000/year (2 months free)
    currency: 'NGN',
    limits: {
      maxBranches: -1, // Unlimited
      maxCallsPerMonth: -1, // Unlimited
      maxOrdersPerMonth: -1, // Unlimited
      maxCatalogItems: -1, // Unlimited
      maxTeamMembers: -1, // Unlimited
    },
    features: {
      whatsappMessaging: true,
      smsMessaging: true,
      advancedAnalytics: true,
      apiAccess: true,
      prioritySupport: true,
      customAgentVoice: true,
      multiLanguageSupport: true,
      upsellPrompts: true,
      fraudDetection: true,
      csvExport: true,
    },
    isRecommended: false,
    isActive: true,
    sortOrder: 3,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a subscription plan by ID
 */
export function getPlanById(planId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find(plan => plan.id === planId);
}

/**
 * Get all active subscription plans
 */
export function getActivePlans(): SubscriptionPlan[] {
  return SUBSCRIPTION_PLANS
    .filter(plan => plan.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Calculate the price for a plan based on billing cycle
 */
export function calculatePlanPrice(plan: SubscriptionPlan, billingCycle: BillingCycle): number {
  return billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
}

/**
 * Calculate the monthly equivalent price (for display purposes)
 */
export function calculateMonthlyEquivalent(plan: SubscriptionPlan, billingCycle: BillingCycle): number {
  if (billingCycle === 'yearly') {
    return Math.round(plan.priceYearly / 12);
  }
  return plan.priceMonthly;
}

/**
 * Calculate savings for yearly billing
 */
export function calculateYearlySavings(plan: SubscriptionPlan): number {
  const yearlyIfMonthly = plan.priceMonthly * 12;
  return yearlyIfMonthly - plan.priceYearly;
}

/**
 * Generate a unique subscription ID
 */
function generateSubscriptionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `SUB_${timestamp}_${random}`.toUpperCase();
}

/**
 * Generate a unique invoice ID
 */
export function generateInvoiceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `INV_${timestamp}_${random}`.toUpperCase();
}

/**
 * Calculate the end of a billing period
 */
function calculatePeriodEnd(startDate: number, billingCycle: BillingCycle): number {
  const date = new Date(startDate);
  if (billingCycle === 'yearly') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date.getTime();
}

/**
 * Check if a limit is unlimited (-1 means unlimited)
 */
export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

/**
 * Check if usage is within a limit
 */
export function isWithinLimit(usage: number, limit: number): boolean {
  return isUnlimited(limit) || usage <= limit;
}

// ============================================================================
// Subscription Service Class
// ============================================================================

/**
 * Service for managing subscription billing
 */
export class SubscriptionService {
  private paystackProvider: PaymentProvider | null = null;
  private flutterwaveProvider: PaymentProvider | null = null;

  constructor(
    private readonly callbackUrl?: string
  ) {}

  /**
   * Get the payment provider instance
   */
  private getPaymentProvider(provider: SubscriptionPaymentProvider): PaymentProvider {
    if (provider === 'paystack') {
      if (!this.paystackProvider) {
        this.paystackProvider = createPaystackProvider(this.callbackUrl);
      }
      return this.paystackProvider;
    } else {
      if (!this.flutterwaveProvider) {
        this.flutterwaveProvider = createFlutterwaveProvider(this.callbackUrl);
      }
      return this.flutterwaveProvider;
    }
  }

  /**
   * Initialize a new subscription for a business
   * 
   * @requirements 26.3 - Define subscription plans with feature tiers
   * @requirements 26.4 - Integrate with Paystack/Flutterwave for billing
   */
  async initializeSubscription(
    options: CreateSubscriptionOptions
  ): Promise<SubscriptionInitResult> {
    const { restaurantId, planId, paymentProvider, billingCycle, startTrial, trialDays = 14 } = options;

    // Validate plan exists
    const plan = getPlanById(planId);
    if (!plan) {
      return {
        success: false,
        error: `Invalid plan ID: ${planId}`,
      };
    }

    if (!plan.isActive) {
      return {
        success: false,
        error: `Plan ${plan.name} is not available for new subscriptions`,
      };
    }

    const now = Date.now();
    const subscriptionId = generateSubscriptionId();

    // Calculate period dates
    let currentPeriodStart = now;
    let currentPeriodEnd: number;
    let status: SubscriptionStatus;
    let trialEndsAt: number | undefined;

    if (startTrial) {
      // Start with trial period
      status = 'trialing';
      trialEndsAt = now + (trialDays * 24 * 60 * 60 * 1000);
      currentPeriodEnd = trialEndsAt;
    } else {
      // Start as pending — only activated after payment is confirmed
      status = 'pending';
      currentPeriodEnd = calculatePeriodEnd(currentPeriodStart, billingCycle);
    }

    // Create subscription object
    const subscription: Subscription = {
      subscriptionId,
      restaurantId,
      planId,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      paymentProvider,
      billingCycle,
      createdAt: now,
      trialEndsAt,
    };

    // If not starting with trial, initialize payment
    if (!startTrial) {
      const price = calculatePlanPrice(plan, billingCycle);
      
      try {
        const provider = this.getPaymentProvider(paymentProvider);
        
        // Create a mock order object for payment initialization
        const paymentOrder: Order = {
          id: subscriptionId,
          restaurantId,
          customerName: `Subscription: ${plan.name}`,
          phoneNumber: '',
          items: [{
            id: `item_${subscriptionId}`,
            name: `${plan.name} Plan (${billingCycle})`,
            quantity: 1,
            price,
          }],
          totalAmount: price,
          status: 'active' as const,
          timestamp: new Date(),
        };

        const paymentResult = await provider.initializeTransaction(paymentOrder);

        if (!paymentResult.success) {
          return {
            success: false,
            error: paymentResult.error || 'Failed to initialize payment',
          };
        }

        subscription.paymentReference = paymentResult.reference;

        return {
          success: true,
          subscription,
          paymentUrl: paymentResult.paymentUrl,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `Payment initialization failed: ${errorMessage}`,
        };
      }
    }

    // For trial subscriptions, no payment needed initially
    return {
      success: true,
      subscription,
    };
  }

  /**
   * Process a subscription payment (for renewals or after trial)
   * 
   * @requirements 26.4 - Integrate with Paystack/Flutterwave for billing
   */
  async processSubscriptionPayment(
    subscription: Subscription,
    callbackUrl?: string
  ): Promise<SubscriptionPaymentResult> {
    const plan = getPlanById(subscription.planId);
    if (!plan) {
      return {
        success: false,
        status: subscription.status,
        error: `Invalid plan ID: ${subscription.planId}`,
      };
    }

    const price = calculatePlanPrice(plan, subscription.billingCycle);

    // A trial subscription has no payment method on file — it cannot be charged
    // until the tenant adds one via checkout.
    if (!subscription.paymentProvider) {
      return {
        success: false,
        status: subscription.status,
        error: "No payment method on file (trial subscription)",
      };
    }

    try {
      const provider = this.getPaymentProvider(subscription.paymentProvider);

      // Create payment order
      const paymentOrder: Order = {
        id: subscription.subscriptionId,
        restaurantId: subscription.restaurantId,
        customerName: `Subscription Renewal: ${plan.name}`,
        phoneNumber: '',
        items: [{
          id: `item_${subscription.subscriptionId}`,
          name: `${plan.name} Plan (${subscription.billingCycle})`,
          quantity: 1,
          price,
        }],
        totalAmount: price,
        status: 'active' as const,
        timestamp: new Date(),
      };

      const paymentResult = await provider.initializeTransaction(paymentOrder);

      if (!paymentResult.success) {
        return {
          success: false,
          status: 'past_due',
          error: paymentResult.error || 'Payment failed',
        };
      }

      const invoiceId = generateInvoiceId();

      return {
        success: true,
        status: 'active',
        invoiceId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        status: 'past_due',
        error: `Payment processing failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if a business is within its subscription limits
   * 
   * @requirements 26.3 - Define subscription plans with feature tiers
   */
  checkSubscriptionLimits(
    subscription: Subscription,
    usage: SubscriptionUsage
  ): SubscriptionLimitsResult {
    const plan = getPlanById(subscription.planId);
    
    if (!plan) {
      return {
        withinLimits: false,
        usage: {
          branches: usage.branchCount,
          callsThisMonth: usage.callsThisPeriod,
          ordersThisMonth: usage.ordersThisPeriod,
          catalogItems: usage.catalogItemCount,
          teamMembers: usage.teamMemberCount,
        },
        limits: {
          maxBranches: 0,
          maxCallsPerMonth: 0,
          maxOrdersPerMonth: 0,
          maxCatalogItems: 0,
          maxTeamMembers: 0,
        },
        exceededLimits: ['Invalid subscription plan'],
      };
    }

    const exceededLimits: string[] = [];

    // Check each limit
    if (!isWithinLimit(usage.branchCount, plan.limits.maxBranches)) {
      exceededLimits.push('branches');
    }
    if (!isWithinLimit(usage.callsThisPeriod, plan.limits.maxCallsPerMonth)) {
      exceededLimits.push('calls');
    }
    if (!isWithinLimit(usage.ordersThisPeriod, plan.limits.maxOrdersPerMonth)) {
      exceededLimits.push('orders');
    }
    if (!isWithinLimit(usage.catalogItemCount, plan.limits.maxCatalogItems)) {
      exceededLimits.push('catalogItems');
    }
    if (!isWithinLimit(usage.teamMemberCount, plan.limits.maxTeamMembers)) {
      exceededLimits.push('teamMembers');
    }

    return {
      withinLimits: exceededLimits.length === 0,
      usage: {
        branches: usage.branchCount,
        callsThisMonth: usage.callsThisPeriod,
        ordersThisMonth: usage.ordersThisPeriod,
        catalogItems: usage.catalogItemCount,
        teamMembers: usage.teamMemberCount,
      },
      limits: plan.limits,
      exceededLimits,
    };
  }

  /**
   * Check if a specific feature is available for a subscription
   */
  hasFeature(subscription: Subscription, feature: keyof PlanFeatures): boolean {
    const plan = getPlanById(subscription.planId);
    if (!plan) return false;
    return plan.features[feature];
  }

  /**
   * Get the plan limits for a subscription
   */
  getPlanLimits(subscription: Subscription): PlanLimits | null {
    const plan = getPlanById(subscription.planId);
    return plan?.limits ?? null;
  }

  /**
   * Get the plan features for a subscription
   */
  getPlanFeatures(subscription: Subscription): PlanFeatures | null {
    const plan = getPlanById(subscription.planId);
    return plan?.features ?? null;
  }

  /**
   * Check if subscription is in good standing (active or trialing)
   */
  isSubscriptionActive(subscription: Subscription): boolean {
    return subscription.status === 'active' || subscription.status === 'trialing';
  }

  /**
   * Check if subscription trial has ended
   */
  isTrialEnded(subscription: Subscription): boolean {
    if (subscription.status !== 'trialing' || !subscription.trialEndsAt) {
      return true;
    }
    return Date.now() > subscription.trialEndsAt;
  }

  /**
   * Get days remaining in trial
   */
  getTrialDaysRemaining(subscription: Subscription): number {
    if (subscription.status !== 'trialing' || !subscription.trialEndsAt) {
      return 0;
    }
    const remaining = subscription.trialEndsAt - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  /**
   * Get days until subscription renewal
   */
  getDaysUntilRenewal(subscription: Subscription): number {
    const remaining = subscription.currentPeriodEnd - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a SubscriptionService instance
 */
export function createSubscriptionService(callbackUrl?: string): SubscriptionService {
  return new SubscriptionService(callbackUrl);
}

// ============================================================================
// Utility Functions for External Use
// ============================================================================

/**
 * Format price in Naira
 */
export function formatNairaPrice(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}

/**
 * Get plan comparison data for display
 */
export function getPlanComparisonData(): Array<{
  feature: string;
  starter: string | boolean;
  growth: string | boolean;
  enterprise: string | boolean;
}> {
  const starter = SUBSCRIPTION_PLANS.find(p => p.id === 'starter')!;
  const growth = SUBSCRIPTION_PLANS.find(p => p.id === 'growth')!;
  const enterprise = SUBSCRIPTION_PLANS.find(p => p.id === 'enterprise')!;

  const formatLimit = (limit: number): string => {
    return isUnlimited(limit) ? 'Unlimited' : limit.toString();
  };

  return [
    {
      feature: 'Branches',
      starter: formatLimit(starter.limits.maxBranches),
      growth: formatLimit(growth.limits.maxBranches),
      enterprise: formatLimit(enterprise.limits.maxBranches),
    },
    {
      feature: 'Calls per month',
      starter: formatLimit(starter.limits.maxCallsPerMonth),
      growth: formatLimit(growth.limits.maxCallsPerMonth),
      enterprise: formatLimit(enterprise.limits.maxCallsPerMonth),
    },
    {
      feature: 'Orders per month',
      starter: formatLimit(starter.limits.maxOrdersPerMonth),
      growth: formatLimit(growth.limits.maxOrdersPerMonth),
      enterprise: formatLimit(enterprise.limits.maxOrdersPerMonth),
    },
    {
      feature: 'Catalog items',
      starter: formatLimit(starter.limits.maxCatalogItems),
      growth: formatLimit(growth.limits.maxCatalogItems),
      enterprise: formatLimit(enterprise.limits.maxCatalogItems),
    },
    {
      feature: 'Team members',
      starter: formatLimit(starter.limits.maxTeamMembers),
      growth: formatLimit(growth.limits.maxTeamMembers),
      enterprise: formatLimit(enterprise.limits.maxTeamMembers),
    },
    {
      feature: 'WhatsApp messaging',
      starter: starter.features.whatsappMessaging,
      growth: growth.features.whatsappMessaging,
      enterprise: enterprise.features.whatsappMessaging,
    },
    {
      feature: 'SMS messaging',
      starter: starter.features.smsMessaging,
      growth: growth.features.smsMessaging,
      enterprise: enterprise.features.smsMessaging,
    },
    {
      feature: 'Advanced analytics',
      starter: starter.features.advancedAnalytics,
      growth: growth.features.advancedAnalytics,
      enterprise: enterprise.features.advancedAnalytics,
    },
    {
      feature: 'API access',
      starter: starter.features.apiAccess,
      growth: growth.features.apiAccess,
      enterprise: enterprise.features.apiAccess,
    },
    {
      feature: 'Priority support',
      starter: starter.features.prioritySupport,
      growth: growth.features.prioritySupport,
      enterprise: enterprise.features.prioritySupport,
    },
    {
      feature: 'Custom AI voice',
      starter: starter.features.customAgentVoice,
      growth: growth.features.customAgentVoice,
      enterprise: enterprise.features.customAgentVoice,
    },
    {
      feature: 'Upsell prompts',
      starter: starter.features.upsellPrompts,
      growth: growth.features.upsellPrompts,
      enterprise: enterprise.features.upsellPrompts,
    },
    {
      feature: 'Fraud detection',
      starter: starter.features.fraudDetection,
      growth: growth.features.fraudDetection,
      enterprise: enterprise.features.fraudDetection,
    },
  ];
}
