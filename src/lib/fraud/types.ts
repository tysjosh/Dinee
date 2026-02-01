/**
 * Fraud Detection Types
 * 
 * Type definitions for the fraud detection system that tracks and flags
 * suspicious customer behavior patterns.
 * 
 * @module fraud/types
 * @see Requirements: 25.1, 25.2, 25.8
 */

// ============================================================================
// Signal Types
// ============================================================================

/**
 * Types of fraud signals that can be detected
 * 
 * @see Requirements: 25.1
 */
export type FraudSignalType =
  | 'repeated_failed_payments'
  | 'high_cancellation_rate'
  | 'unusual_order_pattern';

/**
 * Disposition status for reviewed fraud signals
 */
export type FraudDisposition = 'cleared' | 'blocked' | 'monitoring';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configurable thresholds for fraud detection
 * 
 * @see Requirements: 25.8
 */
export interface FraudDetectionThresholds {
  /**
   * Number of failed payments within the time window to trigger signal
   * @default 3
   */
  failedPaymentCount: number;

  /**
   * Time window in milliseconds for counting failed payments
   * @default 86400000 (24 hours)
   */
  failedPaymentWindowMs: number;

  /**
   * Cancellation rate percentage threshold (0-100) to trigger signal
   * @default 50
   */
  cancellationRateThreshold: number;

  /**
   * Minimum number of orders required before checking cancellation rate
   * @default 5
   */
  minOrdersForCancellationCheck: number;

  /**
   * Number of orders within the time window to trigger unusual pattern signal
   * @default 5
   */
  unusualOrderCount: number;

  /**
   * Time window in milliseconds for detecting unusual order patterns
   * @default 3600000 (1 hour)
   */
  unusualOrderWindowMs: number;
}

/**
 * Default thresholds for fraud detection
 */
export const DEFAULT_FRAUD_THRESHOLDS: FraudDetectionThresholds = {
  failedPaymentCount: 3,
  failedPaymentWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  cancellationRateThreshold: 50,
  minOrdersForCancellationCheck: 5,
  unusualOrderCount: 5,
  unusualOrderWindowMs: 60 * 60 * 1000, // 1 hour
};

// ============================================================================
// Data Types
// ============================================================================

/**
 * Order data required for fraud analysis
 */
export interface FraudOrderData {
  orderId: string;
  customerPhone?: string;
  status: 'active' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  orderPlacementTime?: number;
}

/**
 * Fraud signal record
 */
export interface FraudSignal {
  phoneNumber: string;
  signalType: FraudSignalType;
  signalCount: number;
  lastOccurrence: number;
  isBlocked: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  disposition?: FraudDisposition;
}

// ============================================================================
// Detection Result Types
// ============================================================================

/**
 * Result of a single fraud signal detection check
 */
export interface FraudDetectionResult {
  /** Whether a fraud signal was detected */
  detected: boolean;
  /** Type of signal detected (if any) */
  signalType: FraudSignalType;
  /** Detailed reason for the detection */
  reason: string;
  /** Relevant metrics that triggered the detection */
  metrics: {
    /** Count of relevant events (failed payments, orders, etc.) */
    count: number;
    /** Rate or percentage (for cancellation rate) */
    rate?: number;
    /** Time window used for detection */
    windowMs: number;
    /** Threshold that was exceeded */
    threshold: number;
  };
}

/**
 * Comprehensive fraud analysis result for a customer
 */
export interface CustomerFraudAnalysis {
  /** Phone number analyzed */
  phoneNumber: string;
  /** Timestamp of the analysis */
  analyzedAt: number;
  /** Whether any fraud signals were detected */
  hasSignals: boolean;
  /** Whether the customer is currently blocked */
  isBlocked: boolean;
  /** Individual detection results for each signal type */
  detectionResults: FraudDetectionResult[];
  /** Summary of all detected signals */
  detectedSignals: FraudSignalType[];
  /** Recommendation based on analysis */
  recommendation: 'allow' | 'monitor' | 'block' | 'require_verification';
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Interface for fraud detection service
 * 
 * @see Requirements: 25.2, 25.8
 */
export interface FraudDetectionService {
  /**
   * Detect repeated failed payments for a phone number
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result
   */
  detectRepeatedFailedPayments(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult;

  /**
   * Detect high cancellation rate for a phone number
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result
   */
  detectHighCancellationRate(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult;

  /**
   * Detect unusual order patterns for a phone number
   * 
   * @param phoneNumber - Customer phone number to check
   * @param orders - Order history to analyze
   * @returns Detection result
   */
  detectUnusualOrderPattern(
    phoneNumber: string,
    orders: FraudOrderData[]
  ): FraudDetectionResult;

  /**
   * Run all fraud detection checks for a customer
   * 
   * @param phoneNumber - Customer phone number to analyze
   * @param orders - Order history to analyze
   * @param existingSignals - Existing fraud signals for the customer
   * @returns Comprehensive fraud analysis
   */
  analyzeCustomer(
    phoneNumber: string,
    orders: FraudOrderData[],
    existingSignals?: FraudSignal[]
  ): CustomerFraudAnalysis;

  /**
   * Update detection thresholds
   * 
   * @param thresholds - Partial threshold configuration to update
   */
  updateThresholds(thresholds: Partial<FraudDetectionThresholds>): void;

  /**
   * Get current detection thresholds
   * 
   * @returns Current threshold configuration
   */
  getThresholds(): FraudDetectionThresholds;
}
