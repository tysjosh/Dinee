/**
 * Billing Module
 * 
 * This module provides subscription billing functionality for the Nigerian market,
 * supporting tiered subscription plans with Paystack and Flutterwave integration.
 * 
 * @module billing
 * @requirements 26.3 - Subscription plans with feature tiers
 * @requirements 26.4 - Integration with Paystack/Flutterwave for billing
 */

// Export all types and interfaces
export type {
  // Status and cycle types
  SubscriptionStatus,
  BillingCycle,
  SubscriptionPaymentProvider,
  
  // Plan types
  PlanLimits,
  PlanFeatures,
  SubscriptionPlan,
  
  // Subscription types
  Subscription,
  SubscriptionInvoice,
  
  // Result types
  SubscriptionInitResult,
  SubscriptionPaymentResult,
  SubscriptionLimitsResult,
  
  // Options types
  CreateSubscriptionOptions,
  CancelSubscriptionOptions,
  
  // Usage and reminder types
  SubscriptionUsage,
  BillingReminder,
} from './types';

// Export subscription plans constant
export { SUBSCRIPTION_PLANS } from './SubscriptionService';

// Export SubscriptionService class and factory
export {
  SubscriptionService,
  createSubscriptionService,
} from './SubscriptionService';

// Export utility functions
export {
  // Plan utilities
  getPlanById,
  getActivePlans,
  calculatePlanPrice,
  calculateMonthlyEquivalent,
  calculateYearlySavings,
  getPlanComparisonData,
  
  // Limit utilities
  isUnlimited,
  isWithinLimit,
  
  // ID generation
  generateInvoiceId,
  
  // Formatting
  formatNairaPrice,
} from './SubscriptionService';

// Export PaymentRetryService types
export type {
  PaymentRetryConfig,
  PaymentRetryResult,
  ScheduleRetryResult,
  PersistentFailureResult,
  PaymentFailureRecord,
  SubscriptionWithFailure,
} from './PaymentRetryService';

// Export PaymentRetryService class and factory
export {
  PaymentRetryService,
  createPaymentRetryService,
  DEFAULT_RETRY_CONFIG,
} from './PaymentRetryService';

// Export PaymentRetryService utility functions
export {
  calculateNextRetryTime,
  isRetryDue,
  getDowngradePlan,
} from './PaymentRetryService';
