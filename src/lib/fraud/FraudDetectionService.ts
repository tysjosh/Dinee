/**
 * Fraud Detection Service Implementation
 * 
 * Detects and flags suspicious customer behavior patterns including:
 * - Repeated failed payments (e.g., 3+ failed payments in 24 hours)
 * - High cancellation rate (e.g., >50% cancellation rate with 5+ orders)
 * - Unusual order patterns (e.g., multiple orders from same phone in short time)
 * 
 * Supports configurable thresholds for each signal type.
 * 
 * @module fraud/FraudDetectionService
 * @see Requirements: 25.2, 25.8
 */

import type {
  FraudDetectionService,
  FraudDetectionThresholds,
  FraudDetectionResult,
  CustomerFraudAnalysis,
  FraudOrderData,
  FraudSignal,
  FraudSignalType,
} from './types';
import { DEFAULT_FRAUD_THRESHOLDS } from './types';

// ============================================================================
// FraudDetectionServiceImpl Class
// ============================================================================

/**
 * Implementation of the FraudDetectionService interface
 * 
 * Provides fraud signal detection with configurable thresholds.
 * 
 * @example
 * ```typescript
 * const service = new FraudDetectionServiceImpl();
 * 
 * // Analyze a customer
 * const analysis = service.analyzeCustomer('+2348012345678', orders);
 * 
 * if (analysis.recommendation === 'block') {
 *   // Record fraud signal and block the customer
 * }
 * 
 * // Customize thresholds
 * service.updateThresholds({
 *   failedPaymentCount: 5,
 *   cancellationRateThreshold: 60,
 * });
 * ```
 * 
 * @see Requirements: 25.2, 25.8
 */
export class FraudDetectionServiceImpl implements FraudDetectionService {
  private thresholds: FraudDetectionThresholds;

  /**
   * Create a new FraudDetectionServiceImpl instance
   * 
   * @param thresholds - Optional custom thresholds (defaults will be used for unspecified values)
   */
  constructor(thresholds?: Partial<FraudDetectionThresholds>) {
    this.thresholds = {
      ...DEFAULT_FRAUD_THRESHOLDS,
      ...thresholds,
    };
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Detect repeated failed payments for a phone number
   * 
   * Checks if the customer has had multiple failed payment attempts
   * within the configured time window.
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result indicating if signal was detected
   * 
   * @see Requirements: 25.2
   * 
   * @example
   * ```typescript
   * const result = service.detectRepeatedFailedPayments('+2348012345678', orders);
   * if (result.detected) {
   *   console.log(`Detected: ${result.reason}`);
   *   // result.metrics.count = number of failed payments
   * }
   * ```
   */
  detectRepeatedFailedPayments(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult {
    const now = Date.now();
    const windowStart = now - this.thresholds.failedPaymentWindowMs;

    // Filter orders for this phone number with failed payments within the window
    const failedPayments = orders.filter(order => {
      const isMatchingPhone = order.customerPhone === phoneNumber;
      const isFailedPayment = order.paymentStatus === 'failed';
      const isWithinWindow = order.orderPlacementTime 
        ? order.orderPlacementTime >= windowStart 
        : false;
      
      return isMatchingPhone && isFailedPayment && isWithinWindow;
    });

    const failedCount = failedPayments.length;
    const detected = failedCount >= this.thresholds.failedPaymentCount;

    return {
      detected,
      signalType: 'repeated_failed_payments',
      reason: detected
        ? `${failedCount} failed payments detected within ${this.formatDuration(this.thresholds.failedPaymentWindowMs)} (threshold: ${this.thresholds.failedPaymentCount})`
        : `${failedCount} failed payments within ${this.formatDuration(this.thresholds.failedPaymentWindowMs)} (below threshold of ${this.thresholds.failedPaymentCount})`,
      metrics: {
        count: failedCount,
        windowMs: this.thresholds.failedPaymentWindowMs,
        threshold: this.thresholds.failedPaymentCount,
      },
    };
  }

  /**
   * Detect high cancellation rate for a phone number
   * 
   * Checks if the customer has a cancellation rate above the configured
   * threshold, with a minimum number of orders required.
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result indicating if signal was detected
   * 
   * @see Requirements: 25.2
   * 
   * @example
   * ```typescript
   * const result = service.detectHighCancellationRate('+2348012345678', orders);
   * if (result.detected) {
   *   console.log(`Cancellation rate: ${result.metrics.rate}%`);
   * }
   * ```
   */
  detectHighCancellationRate(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult {
    // Filter orders for this phone number
    const customerOrders = orders.filter(
      order => order.customerPhone === phoneNumber
    );

    const totalOrders = customerOrders.length;
    const cancelledOrders = customerOrders.filter(
      order => order.status === 'cancelled'
    ).length;

    // Check if we have enough orders to evaluate
    const hasEnoughOrders = totalOrders >= this.thresholds.minOrdersForCancellationCheck;
    
    // Calculate cancellation rate
    const cancellationRate = totalOrders > 0 
      ? (cancelledOrders / totalOrders) * 100 
      : 0;

    // Only flag if we have enough orders AND rate exceeds threshold
    const detected = hasEnoughOrders && 
      cancellationRate > this.thresholds.cancellationRateThreshold;

    let reason: string;
    if (!hasEnoughOrders) {
      reason = `Insufficient orders (${totalOrders}) to evaluate cancellation rate (minimum: ${this.thresholds.minOrdersForCancellationCheck})`;
    } else if (detected) {
      reason = `Cancellation rate of ${cancellationRate.toFixed(1)}% exceeds threshold of ${this.thresholds.cancellationRateThreshold}% (${cancelledOrders}/${totalOrders} orders cancelled)`;
    } else {
      reason = `Cancellation rate of ${cancellationRate.toFixed(1)}% is below threshold of ${this.thresholds.cancellationRateThreshold}% (${cancelledOrders}/${totalOrders} orders cancelled)`;
    }

    return {
      detected,
      signalType: 'high_cancellation_rate',
      reason,
      metrics: {
        count: cancelledOrders,
        rate: Math.round(cancellationRate * 100) / 100,
        windowMs: 0, // Not time-based
        threshold: this.thresholds.cancellationRateThreshold,
      },
    };
  }

  /**
   * Detect unusual order patterns for a phone number
   * 
   * Checks if the customer has placed an unusually high number of orders
   * within a short time window, which may indicate automated abuse.
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result indicating if signal was detected
   * 
   * @see Requirements: 25.2
   * 
   * @example
   * ```typescript
   * const result = service.detectUnusualOrderPattern('+2348012345678', orders);
   * if (result.detected) {
   *   console.log(`${result.metrics.count} orders in ${result.metrics.windowMs}ms`);
   * }
   * ```
   */
  detectUnusualOrderPattern(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult {
    const now = Date.now();
    const windowStart = now - this.thresholds.unusualOrderWindowMs;

    // Filter orders for this phone number within the time window
    const recentOrders = orders.filter(order => {
      const isMatchingPhone = order.customerPhone === phoneNumber;
      const isWithinWindow = order.orderPlacementTime 
        ? order.orderPlacementTime >= windowStart 
        : false;
      
      return isMatchingPhone && isWithinWindow;
    });

    const orderCount = recentOrders.length;
    const detected = orderCount >= this.thresholds.unusualOrderCount;

    return {
      detected,
      signalType: 'unusual_order_pattern',
      reason: detected
        ? `${orderCount} orders placed within ${this.formatDuration(this.thresholds.unusualOrderWindowMs)} (threshold: ${this.thresholds.unusualOrderCount})`
        : `${orderCount} orders within ${this.formatDuration(this.thresholds.unusualOrderWindowMs)} (below threshold of ${this.thresholds.unusualOrderCount})`,
      metrics: {
        count: orderCount,
        windowMs: this.thresholds.unusualOrderWindowMs,
        threshold: this.thresholds.unusualOrderCount,
      },
    };
  }

  /**
   * Run all fraud detection checks for a customer
   * 
   * Performs comprehensive fraud analysis by running all detection checks
   * and providing a recommendation based on the results.
   * 
   * @param phoneNumber - Customer phone number to analyze
   * @param orders - Order history to analyze
   * @param existingSignals - Optional existing fraud signals for the customer
   * @returns Comprehensive fraud analysis with recommendation
   * 
   * @see Requirements: 25.2
   * 
   * @example
   * ```typescript
   * const analysis = service.analyzeCustomer('+2348012345678', orders);
   * 
   * switch (analysis.recommendation) {
   *   case 'block':
   *     // Block the customer
   *     break;
   *   case 'require_verification':
   *     // Require human verification
   *     break;
   *   case 'monitor':
   *     // Add to monitoring list
   *     break;
   *   case 'allow':
   *     // Allow normal operation
   *     break;
   * }
   * ```
   */
  analyzeCustomer(
    phoneNumber: string,
    orders: FraudOrderData[],
    existingSignals?: FraudSignal[]
  ): CustomerFraudAnalysis {
    const now = Date.now();

    // Run all detection checks
    const detectionResults: FraudDetectionResult[] = [
      this.detectRepeatedFailedPayments(phoneNumber, orders),
      this.detectHighCancellationRate(phoneNumber, orders),
      this.detectUnusualOrderPattern(phoneNumber, orders),
    ];

    // Collect detected signals
    const detectedSignals: FraudSignalType[] = detectionResults
      .filter(result => result.detected)
      .map(result => result.signalType);

    // Check if customer is already blocked
    const isBlocked = existingSignals?.some(signal => signal.isBlocked) ?? false;

    // Determine recommendation based on analysis
    const recommendation = this.determineRecommendation(
      detectedSignals,
      isBlocked,
      existingSignals
    );

    return {
      phoneNumber,
      analyzedAt: now,
      hasSignals: detectedSignals.length > 0,
      isBlocked,
      detectionResults,
      detectedSignals,
      recommendation,
    };
  }

  /**
   * Update detection thresholds
   * 
   * Allows runtime configuration of fraud detection thresholds.
   * 
   * @param thresholds - Partial threshold configuration to update
   * 
   * @see Requirements: 25.8
   * 
   * @example
   * ```typescript
   * // Make detection more strict
   * service.updateThresholds({
   *   failedPaymentCount: 2,
   *   cancellationRateThreshold: 40,
   * });
   * 
   * // Make detection more lenient
   * service.updateThresholds({
   *   failedPaymentCount: 5,
   *   cancellationRateThreshold: 70,
   * });
   * ```
   */
  updateThresholds(thresholds: Partial<FraudDetectionThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }

  /**
   * Get current detection thresholds
   * 
   * @returns Current threshold configuration
   * 
   * @see Requirements: 25.8
   */
  getThresholds(): FraudDetectionThresholds {
    return { ...this.thresholds };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Determine recommendation based on fraud analysis
   * 
   * @param detectedSignals - List of detected fraud signal types
   * @param isBlocked - Whether customer is already blocked
   * @param existingSignals - Existing fraud signals for context
   * @returns Recommendation for how to handle the customer
   */
  private determineRecommendation(
    detectedSignals: FraudSignalType[],
    isBlocked: boolean,
    existingSignals?: FraudSignal[]
  ): CustomerFraudAnalysis['recommendation'] {
    // If already blocked, maintain block status
    if (isBlocked) {
      return 'block';
    }

    // Count total signal occurrences (including historical)
    const totalSignalCount = existingSignals?.reduce(
      (sum, signal) => sum + signal.signalCount,
      0
    ) ?? 0;

    // Multiple new signals detected - recommend blocking
    if (detectedSignals.length >= 2) {
      return 'block';
    }

    // Single new signal with history - require verification
    if (detectedSignals.length === 1 && totalSignalCount > 0) {
      return 'require_verification';
    }

    // Single new signal without history - monitor
    if (detectedSignals.length === 1) {
      return 'monitor';
    }

    // High historical signal count - require verification
    if (totalSignalCount >= 3) {
      return 'require_verification';
    }

    // Some historical signals - monitor
    if (totalSignalCount > 0) {
      return 'monitor';
    }

    // No signals - allow
    return 'allow';
  }

  /**
   * Format duration in milliseconds to human-readable string
   * 
   * @param ms - Duration in milliseconds
   * @returns Human-readable duration string
   */
  private formatDuration(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0 && minutes > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `${ms}ms`;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new FraudDetectionService instance
 * 
 * @param thresholds - Optional custom thresholds
 * @returns A new FraudDetectionServiceImpl instance
 * 
 * @example
 * ```typescript
 * // With default thresholds
 * const service = createFraudDetectionService();
 * 
 * // With custom thresholds
 * const service = createFraudDetectionService({
 *   failedPaymentCount: 5,
 *   cancellationRateThreshold: 60,
 * });
 * ```
 */
export function createFraudDetectionService(
  thresholds?: Partial<FraudDetectionThresholds>
): FraudDetectionServiceImpl {
  return new FraudDetectionServiceImpl(thresholds);
}

// ============================================================================
// Default Export
// ============================================================================

export default FraudDetectionServiceImpl;
