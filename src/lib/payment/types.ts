/**
 * Payment Service Types and Interfaces
 * 
 * This module defines the types and interfaces for the payment service infrastructure,
 * supporting Paystack, Flutterwave, and Cash-on-Delivery (COD) payment methods.
 * 
 * @module payment/types
 * @requirements 8.2 - Payment status values and payment fields
 */

import type { Order } from "@/types/global.d";

// ============================================================================
// Payment Method and Status Types
// ============================================================================

/**
 * Supported payment methods for the Nigerian market
 * - paystack: Nigerian payment gateway for card and bank transfer payments
 * - flutterwave: Nigerian payment gateway supporting multiple payment methods
 * - cod: Cash-on-delivery payment method
 */
export type PaymentMethod = 'paystack' | 'flutterwave' | 'cod' | 'stripe';

/**
 * Payment status values for order payment tracking
 * - pending: Payment has been initiated but not completed
 * - paid: Payment has been successfully completed
 * - failed: Payment attempt failed
 * - refunded: Payment has been refunded to the customer
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

// ============================================================================
// Payment Provider Interface
// ============================================================================

/**
 * Result of initializing a payment transaction
 */
export interface PaymentInitResult {
  /** Whether the initialization was successful */
  success: boolean;
  /** Unique reference for the payment transaction */
  reference: string;
  /** URL to redirect customer for payment (for online payment methods) */
  paymentUrl?: string;
  /** Error message if initialization failed */
  error?: string;
}

/**
 * Result of verifying a payment transaction
 */
export interface PaymentVerifyResult {
  /** Whether the verification was successful */
  success: boolean;
  /** Current status of the payment */
  status: PaymentStatus;
  /** Amount paid in the smallest currency unit (kobo for Naira) */
  amount: number;
  /** Currency code (e.g., 'NGN' for Nigerian Naira) */
  currency: string;
  /** Additional metadata from the payment provider */
  metadata?: Record<string, unknown>;
}

/**
 * Result of processing a webhook from a payment provider
 */
export interface WebhookResult {
  /** Whether the webhook signature was valid */
  valid: boolean;
  /** Type of event (e.g., 'charge.success', 'charge.failed') */
  event: string;
  /** Associated order ID if applicable */
  orderId?: string;
  /** Payment status indicated by the webhook */
  status?: PaymentStatus;
  /** Provider payment reference (e.g. Stripe Checkout Session id) if available. */
  reference?: string;
}

/**
 * Payment provider interface for implementing payment gateway integrations
 * Each payment provider (Paystack, Flutterwave) should implement this interface
 */
export interface PaymentProvider {
  /** Name of the payment provider */
  name: PaymentMethod;
  
  /**
   * Initialize a payment transaction for an order
   * @param order - The order to create a payment for
   * @returns Promise resolving to the initialization result
   */
  initializeTransaction(order: Order): Promise<PaymentInitResult>;
  
  /**
   * Verify a payment transaction by its reference
   * @param reference - The payment reference to verify
   * @returns Promise resolving to the verification result
   */
  verifyTransaction(reference: string): Promise<PaymentVerifyResult>;
  
  /**
   * Handle an incoming webhook from the payment provider
   * @param payload - The webhook payload
   * @param signature - The webhook signature for verification
   * @returns Promise resolving to the webhook processing result
   */
  handleWebhook(payload: unknown, signature: string): Promise<WebhookResult>;
}

// ============================================================================
// Payment Service Interface
// ============================================================================

/**
 * Payment service interface for managing payment operations
 * This is the main interface for interacting with the payment system
 */
export interface PaymentService {
  /**
   * Initialize a payment for an order using the specified payment method
   * @param orderId - The ID of the order to pay for
   * @param method - The payment method to use
   * @returns Promise resolving to the initialization result
   */
  initializePayment(orderId: string, method: PaymentMethod): Promise<PaymentInitResult>;
  
  /**
   * Verify a payment transaction
   * @param reference - The payment reference to verify
   * @param provider - The payment provider that processed the payment
   * @returns Promise resolving to the verification result
   */
  verifyPayment(reference: string, provider: PaymentMethod): Promise<PaymentVerifyResult>;
  
  /**
   * Process an incoming webhook from a payment provider
   * @param provider - The payment provider sending the webhook
   * @param payload - The webhook payload
   * @param signature - The webhook signature for verification
   */
  processWebhook(provider: PaymentMethod, payload: unknown, signature: string): Promise<void>;
  
  /**
   * Record a cash-on-delivery payment collection
   * @param orderId - The ID of the order
   * @param collectedBy - The ID or name of the person who collected the payment
   */
  recordCODCollection(orderId: string, collectedBy: string): Promise<void>;
}

// ============================================================================
// Additional Payment Types
// ============================================================================

/**
 * Configuration for a payment provider
 */
export interface PaymentProviderConfig {
  /** Public key for the payment provider */
  publicKey: string;
  /** Secret key for the payment provider (server-side only) */
  secretKey: string;
  /** Whether to use test/sandbox mode */
  testMode: boolean;
  /** Webhook secret for verifying webhook signatures */
  webhookSecret?: string;
}

/**
 * Payment transaction record for storing in the database
 */
export interface PaymentTransaction {
  /** Unique transaction ID */
  transactionId: string;
  /** Associated order ID */
  orderId: string;
  /** Payment method used */
  method: PaymentMethod;
  /** Current payment status */
  status: PaymentStatus;
  /** Payment reference from the provider */
  reference: string;
  /** Amount in the smallest currency unit */
  amount: number;
  /** Currency code */
  currency: string;
  /** Timestamp when the transaction was created */
  createdAt: number;
  /** Timestamp when the transaction was last updated */
  updatedAt: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * COD collection record for tracking cash payments
 */
export interface CODCollection {
  /** Associated order ID */
  orderId: string;
  /** Amount collected */
  amount: number;
  /** ID or name of the person who collected the payment */
  collectedBy: string;
  /** Timestamp when the collection was recorded */
  collectedAt: number;
  /** Branch ID where the collection occurred */
  branchId: string;
  /** Notes about the collection */
  notes?: string;
}

/**
 * Daily COD reconciliation summary
 */
export interface CODReconciliationSummary {
  /** Date of the summary (YYYY-MM-DD format) */
  date: string;
  /** Branch ID */
  branchId: string;
  /** Total number of COD orders */
  totalOrders: number;
  /** Total amount collected */
  totalCollected: number;
  /** Number of pending COD orders */
  pendingOrders: number;
  /** Amount pending collection */
  pendingAmount: number;
  /** Collections breakdown by collector */
  collectionsByCollector: Record<string, number>;
}
