/**
 * Unified Payment Service Implementation
 * 
 * Implements the PaymentService interface to provide a unified API for all payment methods:
 * - Paystack: Card and bank transfer payments
 * - Flutterwave: Multiple payment methods
 * - COD (Cash-on-Delivery): Payment collected upon delivery
 * 
 * @module payment/PaymentServiceImpl
 * @requirements 10.1 - COD payment method with paymentStatus set to "pending"
 */

import type { Order } from "@/types/global.d";
import type {
  PaymentMethod,
  PaymentService,
  PaymentInitResult,
  PaymentVerifyResult,
  CODCollection,
} from "./types";
import { PaystackProvider, createPaystackProvider } from "./PaystackProvider";
import { FlutterwaveProvider, createFlutterwaveProvider } from "./FlutterwaveProvider";

// ============================================================================
// COD Payment Types
// ============================================================================

/**
 * Result of initializing a COD payment
 * COD payments don't require external payment gateway initialization
 */
export interface CODPaymentResult extends PaymentInitResult {
  /** COD-specific: indicates this is a cash payment */
  isCOD: true;
  /** COD-specific: the order is ready for processing immediately */
  readyForProcessing: true;
}

// ============================================================================
// COD Payment Helper Functions
// ============================================================================

/**
 * Generates a unique COD payment reference
 * Format: COD_{timestamp}_{random}
 */
function generateCODReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `COD_${timestamp}_${random}`.toUpperCase();
}

/**
 * Initialize a COD payment for an order
 * 
 * COD payments are initialized immediately with status "pending".
 * No external payment gateway is involved - payment is collected upon delivery.
 * 
 * @param order - The order to create a COD payment for
 * @returns COD payment initialization result
 * 
 * @requirements 10.1 - Set paymentMethod to 'cod' and paymentStatus to 'pending'
 * 
 * @example
 * ```typescript
 * const result = initializeCODPayment(order);
 * // result.success === true
 * // result.isCOD === true
 * // result.readyForProcessing === true
 * // Order should be updated with:
 * //   paymentMethod: 'cod'
 * //   paymentStatus: 'pending'
 * ```
 */
export function initializeCODPayment(order: Order): CODPaymentResult {
  const reference = generateCODReference();
  
  return {
    success: true,
    reference,
    isCOD: true,
    readyForProcessing: true,
    // No paymentUrl for COD - payment is collected on delivery
  };
}

// ============================================================================
// Unified Payment Service Class
// ============================================================================

/**
 * Configuration for UnifiedPaymentService
 */
interface PaymentServiceConfig {
  /** Paystack provider instance (optional - will be created from env if not provided) */
  paystackProvider?: PaystackProvider;
  /** Flutterwave provider instance (optional - will be created from env if not provided) */
  flutterwaveProvider?: FlutterwaveProvider;
  /** Callback URL for Paystack payments */
  paystackCallbackUrl?: string;
  /** Redirect URL for Flutterwave payments */
  flutterwaveRedirectUrl?: string;
  /** Function to update order payment status in the database */
  updateOrderPayment?: (
    orderId: string,
    paymentMethod: PaymentMethod,
    paymentStatus: "pending" | "paid" | "failed" | "refunded",
    paymentReference: string,
    paymentTimestamp?: number
  ) => Promise<void>;
  /** Function to record COD collection */
  recordCODCollectionFn?: (collection: CODCollection) => Promise<void>;
}

/**
 * Unified Payment Service
 * 
 * Provides a single interface for all payment methods (Paystack, Flutterwave, COD).
 * Handles payment initialization, verification, webhook processing, and COD collection.
 * 
 * @example
 * ```typescript
 * const paymentService = createPaymentService({
 *   paystackCallbackUrl: 'https://myapp.com/payment/callback',
 *   flutterwaveRedirectUrl: 'https://myapp.com/payment/callback',
 * });
 * 
 * // Initialize payment based on method
 * const result = await paymentService.initializePayment(orderId, 'cod');
 * // For COD: immediately returns success with pending status
 * 
 * const result = await paymentService.initializePayment(orderId, 'paystack');
 * // For Paystack: returns payment URL for customer redirect
 * ```
 */
export class UnifiedPaymentService implements PaymentService {
  private paystackProvider?: PaystackProvider;
  private flutterwaveProvider?: FlutterwaveProvider;
  private updateOrderPayment?: PaymentServiceConfig["updateOrderPayment"];
  private recordCODCollectionFn?: PaymentServiceConfig["recordCODCollectionFn"];
  private paystackCallbackUrl?: string;
  private flutterwaveRedirectUrl?: string;
  
  // Store for orders (in production, this would be fetched from database)
  private orderCache: Map<string, Order> = new Map();
  
  constructor(config: PaymentServiceConfig = {}) {
    this.paystackProvider = config.paystackProvider;
    this.flutterwaveProvider = config.flutterwaveProvider;
    this.updateOrderPayment = config.updateOrderPayment;
    this.recordCODCollectionFn = config.recordCODCollectionFn;
    this.paystackCallbackUrl = config.paystackCallbackUrl;
    this.flutterwaveRedirectUrl = config.flutterwaveRedirectUrl;
  }
  
  /**
   * Get or create Paystack provider
   */
  private getPaystackProvider(): PaystackProvider {
    if (!this.paystackProvider) {
      this.paystackProvider = createPaystackProvider(this.paystackCallbackUrl);
    }
    return this.paystackProvider;
  }
  
  /**
   * Get or create Flutterwave provider
   */
  private getFlutterwaveProvider(): FlutterwaveProvider {
    if (!this.flutterwaveProvider) {
      this.flutterwaveProvider = createFlutterwaveProvider(this.flutterwaveRedirectUrl);
    }
    return this.flutterwaveProvider;
  }
  
  /**
   * Set an order in the cache (for testing or when order is known)
   */
  setOrder(order: Order): void {
    this.orderCache.set(order.id, order);
  }
  
  /**
   * Initialize a payment for an order using the specified payment method
   * 
   * For COD orders:
   * - Sets paymentMethod to 'cod'
   * - Sets paymentStatus to 'pending'
   * - Returns immediately without external gateway call
   * 
   * For Paystack/Flutterwave:
   * - Initializes transaction with the payment gateway
   * - Returns payment URL for customer redirect
   * 
   * @param orderId - The ID of the order to pay for
   * @param method - The payment method to use ('paystack', 'flutterwave', or 'cod')
   * @returns Promise resolving to the initialization result
   * 
   * @requirements 10.1 - COD orders set paymentMethod to 'cod' and paymentStatus to 'pending'
   */
  async initializePayment(orderId: string, method: PaymentMethod): Promise<PaymentInitResult> {
    // Get order from cache or throw error
    const order = this.orderCache.get(orderId);
    
    if (!order) {
      return {
        success: false,
        reference: "",
        error: `Order not found: ${orderId}. Please set the order using setOrder() first.`,
      };
    }
    
    // Handle COD payment method
    if (method === "cod") {
      const result = initializeCODPayment(order);
      
      // Update order payment status if callback is provided
      if (this.updateOrderPayment) {
        try {
          await this.updateOrderPayment(
            orderId,
            "cod",
            "pending", // COD orders start with pending status
            result.reference,
            Date.now()
          );
        } catch (error) {
          console.error("Failed to update order payment status:", error);
          // Still return success - the COD initialization itself succeeded
        }
      }
      
      return result;
    }
    
    // Handle Paystack payment method
    if (method === "paystack") {
      try {
        const provider = this.getPaystackProvider();
        const result = await provider.initializeTransaction(order);
        
        if (result.success && this.updateOrderPayment) {
          await this.updateOrderPayment(
            orderId,
            "paystack",
            "pending",
            result.reference,
            Date.now()
          );
        }
        
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          reference: "",
          error: `Paystack initialization failed: ${errorMessage}`,
        };
      }
    }
    
    // Handle Flutterwave payment method
    if (method === "flutterwave") {
      try {
        const provider = this.getFlutterwaveProvider();
        const result = await provider.initializeTransaction(order);
        
        if (result.success && this.updateOrderPayment) {
          await this.updateOrderPayment(
            orderId,
            "flutterwave",
            "pending",
            result.reference,
            Date.now()
          );
        }
        
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          reference: "",
          error: `Flutterwave initialization failed: ${errorMessage}`,
        };
      }
    }
    
    // Unknown payment method
    return {
      success: false,
      reference: "",
      error: `Unsupported payment method: ${method}`,
    };
  }
  
  /**
   * Verify a payment transaction
   * 
   * Note: COD payments cannot be verified through this method as they
   * don't go through an external payment gateway. Use recordCODCollection
   * to mark COD payments as collected.
   * 
   * @param reference - The payment reference to verify
   * @param provider - The payment provider that processed the payment
   * @returns Promise resolving to the verification result
   */
  async verifyPayment(reference: string, provider: PaymentMethod): Promise<PaymentVerifyResult> {
    // COD payments cannot be verified through external gateway
    if (provider === "cod") {
      return {
        success: false,
        status: "pending",
        amount: 0,
        currency: "NGN",
        metadata: {
          error: "COD payments cannot be verified through payment gateway. Use recordCODCollection to mark as paid.",
          isCOD: true,
        },
      };
    }
    
    // Verify with Paystack
    if (provider === "paystack") {
      try {
        const paystackProvider = this.getPaystackProvider();
        return await paystackProvider.verifyTransaction(reference);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          status: "failed",
          amount: 0,
          currency: "NGN",
          metadata: { error: `Paystack verification failed: ${errorMessage}` },
        };
      }
    }
    
    // Verify with Flutterwave
    if (provider === "flutterwave") {
      try {
        const flutterwaveProvider = this.getFlutterwaveProvider();
        return await flutterwaveProvider.verifyTransaction(reference);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          status: "failed",
          amount: 0,
          currency: "NGN",
          metadata: { error: `Flutterwave verification failed: ${errorMessage}` },
        };
      }
    }
    
    return {
      success: false,
      status: "failed",
      amount: 0,
      currency: "NGN",
      metadata: { error: `Unsupported payment provider: ${provider}` },
    };
  }
  
  /**
   * Process an incoming webhook from a payment provider
   * 
   * Note: COD does not use webhooks as payments are collected manually.
   * 
   * @param provider - The payment provider sending the webhook
   * @param payload - The webhook payload
   * @param signature - The webhook signature for verification
   */
  async processWebhook(provider: PaymentMethod, payload: unknown, signature: string): Promise<void> {
    // COD doesn't use webhooks
    if (provider === "cod") {
      console.warn("COD payment method does not support webhooks");
      return;
    }
    
    // Process Paystack webhook
    if (provider === "paystack") {
      const paystackProvider = this.getPaystackProvider();
      const result = await paystackProvider.handleWebhook(payload, signature);
      
      if (!result.valid) {
        throw new Error("Invalid Paystack webhook signature");
      }
      
      // Update order payment status if we have the callback and order ID
      if (result.orderId && result.status && this.updateOrderPayment) {
        await this.updateOrderPayment(
          result.orderId,
          "paystack",
          result.status,
          "", // Reference should already be stored
          Date.now()
        );
      }
      
      return;
    }
    
    // Process Flutterwave webhook
    if (provider === "flutterwave") {
      const flutterwaveProvider = this.getFlutterwaveProvider();
      const result = await flutterwaveProvider.handleWebhook(payload, signature);
      
      if (!result.valid) {
        throw new Error("Invalid Flutterwave webhook");
      }
      
      // Update order payment status if we have the callback and order ID
      if (result.orderId && result.status && this.updateOrderPayment) {
        await this.updateOrderPayment(
          result.orderId,
          "flutterwave",
          result.status,
          "", // Reference should already be stored
          Date.now()
        );
      }
      
      return;
    }
    
    throw new Error(`Unsupported payment provider for webhook: ${provider}`);
  }
  
  /**
   * Record a cash-on-delivery payment collection
   * 
   * This method is called when a rider or staff member collects cash payment
   * from a customer upon delivery. It updates the order's payment status to "paid".
   * 
   * @param orderId - The ID of the order
   * @param collectedBy - The ID or name of the person who collected the payment
   * 
   * @requirements 10.4 - Update paymentStatus to "paid" when collection is confirmed
   * @requirements 10.6 - Track COD collection amounts for daily reconciliation
   */
  async recordCODCollection(orderId: string, collectedBy: string): Promise<void> {
    // Get order from cache
    const order = this.orderCache.get(orderId);
    
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    // Verify this is a COD order
    // Note: In production, this would check the order's paymentMethod from the database
    
    // Update order payment status to paid
    if (this.updateOrderPayment) {
      await this.updateOrderPayment(
        orderId,
        "cod",
        "paid",
        order.id, // Use order ID as reference for COD
        Date.now()
      );
    }
    
    // Record the collection for reconciliation
    if (this.recordCODCollectionFn) {
      const collection: CODCollection = {
        orderId,
        amount: order.totalAmount,
        collectedBy,
        collectedAt: Date.now(),
        branchId: order.branchId || "",
      };
      
      await this.recordCODCollectionFn(collection);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a UnifiedPaymentService instance
 * 
 * @param config - Optional configuration for the payment service
 * @returns UnifiedPaymentService instance
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const paymentService = createPaymentService();
 * 
 * // With configuration
 * const paymentService = createPaymentService({
 *   paystackCallbackUrl: 'https://myapp.com/payment/paystack/callback',
 *   flutterwaveRedirectUrl: 'https://myapp.com/payment/flutterwave/callback',
 *   updateOrderPayment: async (orderId, method, status, ref, timestamp) => {
 *     // Update order in database
 *   },
 * });
 * ```
 */
export function createPaymentService(config: PaymentServiceConfig = {}): UnifiedPaymentService {
  return new UnifiedPaymentService(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default UnifiedPaymentService;
