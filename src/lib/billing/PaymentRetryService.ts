/**
 * Payment Retry Service
 * 
 * Handles payment failure recovery for subscription billing, including
 * automatic retries with exponential backoff and downgrade on persistent failure.
 * 
 * @module billing/PaymentRetryService
 * @requirements 26.7 - Retry failed payments
 * @requirements 26.8 - Downgrade on persistent failure
 */

import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionPaymentProvider,
} from './types';
import { getPlanById, SUBSCRIPTION_PLANS } from './SubscriptionService';
import { createPaystackProvider } from '../payment/PaystackProvider';
import { createFlutterwaveProvider } from '../payment/FlutterwaveProvider';
import type { PaymentProvider } from '../payment/types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for payment retry behavior
 */
export interface PaymentRetryConfig {
  /** Maximum number of retry attempts before downgrade (default: 3) */
  maxRetries: number;
  /** Retry intervals in hours [1st retry, 2nd retry, 3rd retry] */
  retryIntervalsHours: number[];
  /** Plan to downgrade to on persistent failure (default: 'starter') */
  downgradePlanId: string;
  /** Whether to suspend instead of downgrade (default: false) */
  suspendOnFailure: boolean;
}

/**
 * Default retry configuration
 * - 1st retry: 24 hours after failure
 * - 2nd retry: 48 hours after 1st retry
 * - 3rd retry: 72 hours after 2nd retry
 * - After 3rd failure: downgrade to starter plan
 */
export const DEFAULT_RETRY_CONFIG: PaymentRetryConfig = {
  maxRetries: 3,
  retryIntervalsHours: [24, 48, 72],
  downgradePlanId: 'starter',
  suspendOnFailure: false,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a payment retry attempt
 */
export interface PaymentRetryResult {
  /** Whether the retry was successful */
  success: boolean;
  /** New subscription status after retry */
  status: SubscriptionStatus;
  /** Payment reference if successful */
  paymentReference?: string;
  /** Error message if failed */
  error?: string;
  /** Number of retry attempts made */
  attemptNumber: number;
  /** Whether max retries have been reached */
  maxRetriesReached: boolean;
  /** Next retry scheduled time (if applicable) */
  nextRetryAt?: number;
}

/**
 * Result of scheduling a retry
 */
export interface ScheduleRetryResult {
  /** Whether scheduling was successful */
  success: boolean;
  /** Scheduled retry time */
  scheduledAt?: number;
  /** Attempt number for the scheduled retry */
  attemptNumber: number;
  /** Error message if scheduling failed */
  error?: string;
}

/**
 * Result of handling persistent failure
 */
export interface PersistentFailureResult {
  /** Whether the handling was successful */
  success: boolean;
  /** Action taken (downgrade or suspend) */
  action: 'downgrade' | 'suspend';
  /** New plan ID if downgraded */
  newPlanId?: string;
  /** New subscription status */
  status: SubscriptionStatus;
  /** Error message if failed */
  error?: string;
}

/**
 * Payment failure record for tracking
 */
export interface PaymentFailureRecord {
  /** Subscription ID */
  subscriptionId: string;
  /** Restaurant ID */
  restaurantId: string;
  /** Failure timestamp */
  failedAt: number;
  /** Error message */
  errorMessage: string;
  /** Attempt number */
  attemptNumber: number;
  /** Payment provider */
  paymentProvider: SubscriptionPaymentProvider;
  /** Amount that failed */
  amount: number;
  /** Currency */
  currency: string;
}

/**
 * Subscription with failed payment info
 */
export interface SubscriptionWithFailure extends Subscription {
  /** Number of failed payment attempts */
  failedPaymentCount: number;
  /** Last payment attempt timestamp */
  lastPaymentAttempt: number;
  /** Last payment error message */
  lastPaymentError: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate the next retry time based on attempt number
 */
export function calculateNextRetryTime(
  lastAttemptTime: number,
  attemptNumber: number,
  config: PaymentRetryConfig = DEFAULT_RETRY_CONFIG
): number | null {
  // If we've exceeded max retries, no next retry
  if (attemptNumber >= config.maxRetries) {
    return null;
  }

  // Get the interval for this attempt (0-indexed)
  const intervalIndex = Math.min(attemptNumber, config.retryIntervalsHours.length - 1);
  const intervalHours = config.retryIntervalsHours[intervalIndex];
  
  // Calculate next retry time
  return lastAttemptTime + (intervalHours * 60 * 60 * 1000);
}

/**
 * Check if a subscription is due for retry
 */
export function isRetryDue(
  subscription: SubscriptionWithFailure,
  config: PaymentRetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  const now = Date.now();
  
  // Check if we've exceeded max retries
  if (subscription.failedPaymentCount >= config.maxRetries) {
    return false;
  }
  
  // Calculate when the next retry should happen
  const nextRetryTime = calculateNextRetryTime(
    subscription.lastPaymentAttempt,
    subscription.failedPaymentCount,
    config
  );
  
  if (!nextRetryTime) {
    return false;
  }
  
  return now >= nextRetryTime;
}

/**
 * Get the starter plan for downgrade
 */
export function getDowngradePlan(planId: string = 'starter') {
  return SUBSCRIPTION_PLANS.find(plan => plan.id === planId);
}

/**
 * Generate a unique failure record ID
 */
function generateFailureRecordId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `FAIL_${timestamp}_${random}`.toUpperCase();
}

// ============================================================================
// PaymentRetryService Class
// ============================================================================

/**
 * Service for handling payment failure recovery
 * 
 * @example
 * ```typescript
 * const retryService = new PaymentRetryService();
 * 
 * // Retry a failed payment
 * const result = await retryService.retryFailedPayment(subscription);
 * if (result.success) {
 *   // Payment succeeded
 * } else if (result.maxRetriesReached) {
 *   // Handle persistent failure
 *   await retryService.handlePersistentFailure(subscription);
 * }
 * ```
 */
export class PaymentRetryService {
  private readonly config: PaymentRetryConfig;
  private paystackProvider: PaymentProvider | null = null;
  private flutterwaveProvider: PaymentProvider | null = null;
  private readonly callbackUrl?: string;

  constructor(
    config: Partial<PaymentRetryConfig> = {},
    callbackUrl?: string
  ) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.callbackUrl = callbackUrl;
  }

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
   * Retry a failed payment for a subscription
   * 
   * @param subscription - The subscription with failed payment
   * @returns Promise resolving to the retry result
   * 
   * @requirements 26.7 - Retry failed payments
   */
  async retryFailedPayment(subscription: Subscription): Promise<PaymentRetryResult> {
    const attemptNumber = (subscription.failedPaymentCount ?? 0) + 1;
    const now = Date.now();

    // Check if max retries reached
    if (attemptNumber > this.config.maxRetries) {
      return {
        success: false,
        status: 'past_due',
        attemptNumber,
        maxRetriesReached: true,
        error: `Maximum retry attempts (${this.config.maxRetries}) exceeded`,
      };
    }

    // Get the plan to calculate amount
    const plan = getPlanById(subscription.planId);
    if (!plan) {
      return {
        success: false,
        status: subscription.status,
        attemptNumber,
        maxRetriesReached: false,
        error: `Invalid plan ID: ${subscription.planId}`,
      };
    }

    // Calculate the amount based on billing cycle
    const amount = subscription.billingCycle === 'yearly' 
      ? plan.priceYearly 
      : plan.priceMonthly;

    try {
      const provider = this.getPaymentProvider(subscription.paymentProvider);

      // Create a payment order for the retry
      const paymentOrder = {
        id: subscription.subscriptionId,
        orderId: subscription.subscriptionId,
        restaurantId: subscription.restaurantId,
        customerName: `Subscription Retry: ${plan.name}`,
        phoneNumber: '',
        items: [{
          id: `item_${subscription.subscriptionId}`,
          name: `${plan.name} Plan (${subscription.billingCycle}) - Retry #${attemptNumber}`,
          quantity: 1,
          price: amount,
        }],
        totalAmount: amount,
        status: 'active' as const,
        timestamp: new Date(),
      };

      const paymentResult = await provider.initializeTransaction(paymentOrder);

      if (!paymentResult.success) {
        // Calculate next retry time
        const nextRetryAt = calculateNextRetryTime(now, attemptNumber, this.config);
        const maxRetriesReached = attemptNumber >= this.config.maxRetries;

        return {
          success: false,
          status: 'past_due',
          attemptNumber,
          maxRetriesReached,
          error: paymentResult.error || 'Payment initialization failed',
          nextRetryAt: maxRetriesReached ? undefined : nextRetryAt ?? undefined,
        };
      }

      // Payment initialized successfully - in a real scenario, we'd wait for webhook
      // For now, return success with the payment reference
      return {
        success: true,
        status: 'active',
        paymentReference: paymentResult.reference,
        attemptNumber,
        maxRetriesReached: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const nextRetryAt = calculateNextRetryTime(now, attemptNumber, this.config);
      const maxRetriesReached = attemptNumber >= this.config.maxRetries;

      return {
        success: false,
        status: 'past_due',
        attemptNumber,
        maxRetriesReached,
        error: `Payment retry failed: ${errorMessage}`,
        nextRetryAt: maxRetriesReached ? undefined : nextRetryAt ?? undefined,
      };
    }
  }

  /**
   * Schedule the next retry for a subscription
   * 
   * @param subscription - The subscription to schedule retry for
   * @param attemptNumber - The current attempt number
   * @returns Schedule result with next retry time
   * 
   * @requirements 26.7 - Retry failed payments with scheduled intervals
   */
  scheduleRetry(
    subscription: Subscription,
    attemptNumber: number
  ): ScheduleRetryResult {
    const now = Date.now();

    // Check if max retries reached
    if (attemptNumber >= this.config.maxRetries) {
      return {
        success: false,
        attemptNumber,
        error: `Maximum retry attempts (${this.config.maxRetries}) reached`,
      };
    }

    // Calculate next retry time
    const scheduledAt = calculateNextRetryTime(now, attemptNumber, this.config);

    if (!scheduledAt) {
      return {
        success: false,
        attemptNumber,
        error: 'Unable to calculate next retry time',
      };
    }

    return {
      success: true,
      scheduledAt,
      attemptNumber: attemptNumber + 1,
    };
  }

  /**
   * Handle persistent payment failure by downgrading or suspending
   * 
   * @param subscription - The subscription with persistent failure
   * @returns Result of the failure handling
   * 
   * @requirements 26.8 - Downgrade on persistent failure
   */
  handlePersistentFailure(subscription: Subscription): PersistentFailureResult {
    if (this.config.suspendOnFailure) {
      // Suspend the subscription
      return {
        success: true,
        action: 'suspend',
        status: 'cancelled',
      };
    }

    // Downgrade to starter plan
    const downgradePlan = getDowngradePlan(this.config.downgradePlanId);
    
    if (!downgradePlan) {
      return {
        success: false,
        action: 'downgrade',
        status: subscription.status,
        error: `Downgrade plan '${this.config.downgradePlanId}' not found`,
      };
    }

    // If already on starter plan, suspend instead
    if (subscription.planId === this.config.downgradePlanId) {
      return {
        success: true,
        action: 'suspend',
        status: 'cancelled',
      };
    }

    return {
      success: true,
      action: 'downgrade',
      newPlanId: this.config.downgradePlanId,
      status: 'active', // Keep active but on lower plan
    };
  }

  /**
   * Create a payment failure record for audit logging
   * 
   * @param subscription - The subscription that failed
   * @param errorMessage - The error message
   * @param amount - The amount that failed
   * @returns Payment failure record
   */
  createFailureRecord(
    subscription: Subscription,
    errorMessage: string,
    amount: number
  ): PaymentFailureRecord {
    return {
      subscriptionId: subscription.subscriptionId,
      restaurantId: subscription.restaurantId,
      failedAt: Date.now(),
      errorMessage,
      attemptNumber: (subscription.failedPaymentCount ?? 0) + 1,
      paymentProvider: subscription.paymentProvider,
      amount,
      currency: 'NGN',
    };
  }

  /**
   * Get the retry configuration
   */
  getConfig(): PaymentRetryConfig {
    return { ...this.config };
  }

  /**
   * Check if a subscription should be processed for retry
   */
  shouldRetry(subscription: Subscription): boolean {
    // Only retry subscriptions that are past_due
    if (subscription.status !== 'past_due') {
      return false;
    }

    // Check if we've exceeded max retries
    const failedCount = subscription.failedPaymentCount ?? 0;
    if (failedCount >= this.config.maxRetries) {
      return false;
    }

    // Check if enough time has passed since last attempt
    const lastAttempt = subscription.lastPaymentAttempt ?? 0;
    if (lastAttempt === 0) {
      return true; // No previous attempt, should retry
    }

    const nextRetryTime = calculateNextRetryTime(lastAttempt, failedCount, this.config);
    if (!nextRetryTime) {
      return false;
    }

    return Date.now() >= nextRetryTime;
  }

  /**
   * Get human-readable retry schedule description
   */
  getRetryScheduleDescription(): string {
    const intervals = this.config.retryIntervalsHours;
    const descriptions = intervals.map((hours, index) => {
      const days = hours / 24;
      const timeStr = days >= 1 ? `${days} day(s)` : `${hours} hour(s)`;
      return `Retry ${index + 1}: ${timeStr} after ${index === 0 ? 'failure' : 'previous retry'}`;
    });

    return [
      ...descriptions,
      `After ${this.config.maxRetries} failures: ${this.config.suspendOnFailure ? 'Suspend' : `Downgrade to ${this.config.downgradePlanId} plan`}`,
    ].join('\n');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PaymentRetryService instance
 * 
 * @param config - Optional configuration overrides
 * @param callbackUrl - Optional callback URL for payment completion
 * @returns PaymentRetryService instance
 */
export function createPaymentRetryService(
  config?: Partial<PaymentRetryConfig>,
  callbackUrl?: string
): PaymentRetryService {
  return new PaymentRetryService(config, callbackUrl);
}

// ============================================================================
// Default Export
// ============================================================================

export default PaymentRetryService;
