/**
 * Paystack Payment Provider
 * 
 * Implements the PaymentProvider interface for Paystack payment gateway integration.
 * Supports card payments, bank transfers, and USSD payments in Nigeria.
 * 
 * @module payment/PaystackProvider
 * @requirements 8.3 - Paystack transaction initialization and verification
 * @requirements 8.5 - Webhook signature verification using Paystack secret key
 * @requirements 8.8 - Support for Paystack test mode
 */

import type { Order } from "@/types/global.d";
import type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerifyResult,
  WebhookResult,
  PaymentStatus,
} from "./types";
import crypto from "crypto";

// ============================================================================
// Constants
// ============================================================================

const PAYSTACK_API_BASE_URL = "https://api.paystack.co";
const PAYSTACK_INITIALIZE_ENDPOINT = `${PAYSTACK_API_BASE_URL}/transaction/initialize`;
const PAYSTACK_VERIFY_ENDPOINT = `${PAYSTACK_API_BASE_URL}/transaction/verify`;

// ============================================================================
// Types
// ============================================================================

/**
 * Paystack API response for transaction initialization
 */
interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

/**
 * Paystack API response for transaction verification
 */
interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: {
    id: number;
    domain: string;
    status: "success" | "failed" | "abandoned" | "pending";
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    gateway_response: string;
    paid_at?: string;
    created_at: string;
    metadata?: Record<string, unknown>;
    customer: {
      id: number;
      email: string;
      customer_code: string;
      phone?: string;
    };
  };
}

/**
 * Paystack webhook event payload
 */
interface PaystackWebhookPayload {
  event: string;
  data: {
    id: number;
    domain: string;
    status: "success" | "failed" | "abandoned" | "pending";
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    gateway_response: string;
    paid_at?: string;
    created_at: string;
    metadata?: {
      orderId?: string;
      [key: string]: unknown;
    };
    customer: {
      id: number;
      email: string;
      customer_code: string;
      phone?: string;
    };
  };
}

/**
 * Configuration options for PaystackProvider
 */
interface PaystackProviderConfig {
  /** Paystack secret key (required) */
  secretKey: string;
  /** Whether to use test mode (defaults to checking if key starts with 'sk_test_') */
  testMode?: boolean;
  /** Callback URL for payment completion */
  callbackUrl?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a unique payment reference
 * Format: PSK_{timestamp}_{random}
 */
function generateReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PSK_${timestamp}_${random}`.toUpperCase();
}

/**
 * Converts Paystack status to our PaymentStatus type
 */
function mapPaystackStatus(status: string): PaymentStatus {
  switch (status) {
    case "success":
      return "paid";
    case "failed":
    case "abandoned":
      return "failed";
    case "pending":
    default:
      return "pending";
  }
}

/**
 * Validates that the webhook payload has the expected structure
 */
function isValidWebhookPayload(payload: unknown): payload is PaystackWebhookPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  
  const p = payload as Record<string, unknown>;
  
  if (typeof p.event !== "string") {
    return false;
  }
  
  if (!p.data || typeof p.data !== "object") {
    return false;
  }
  
  const data = p.data as Record<string, unknown>;
  
  return (
    typeof data.reference === "string" &&
    typeof data.status === "string" &&
    typeof data.amount === "number"
  );
}

// ============================================================================
// PaystackProvider Class
// ============================================================================

/**
 * Paystack payment provider implementation
 * 
 * @example
 * ```typescript
 * const paystack = new PaystackProvider({
 *   secretKey: process.env.PAYSTACK_SECRET_KEY!,
 *   callbackUrl: 'https://myapp.com/payment/callback'
 * });
 * 
 * // Initialize a transaction
 * const result = await paystack.initializeTransaction(order);
 * if (result.success) {
 *   // Redirect customer to result.paymentUrl
 * }
 * 
 * // Verify a transaction
 * const verification = await paystack.verifyTransaction(reference);
 * if (verification.success && verification.status === 'paid') {
 *   // Payment successful
 * }
 * ```
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack" as const;
  
  private readonly secretKey: string;
  private readonly testMode: boolean;
  private readonly callbackUrl?: string;
  
  constructor(config: PaystackProviderConfig) {
    if (!config.secretKey) {
      throw new Error(
        "PaystackProvider: secretKey is required. " +
        "Set the PAYSTACK_SECRET_KEY environment variable with your Paystack secret key. " +
        "Get your API key from https://dashboard.paystack.com/#/settings/developers"
      );
    }

    if (!config.secretKey.startsWith("sk_test_") && !config.secretKey.startsWith("sk_live_")) {
      throw new Error(
        "PaystackProvider: secretKey has an invalid format. " +
        "Expected a key starting with 'sk_test_' (test mode) or 'sk_live_' (live mode). " +
        "Check your PAYSTACK_SECRET_KEY environment variable."
      );
    }
    
    this.secretKey = config.secretKey;
    this.testMode = config.testMode ?? config.secretKey.startsWith("sk_test_");
    this.callbackUrl = config.callbackUrl;
    
    // Warn when running in test mode so developers are aware
    if (this.testMode) {
      console.warn(
        "⚠️ PaystackProvider is running in TEST mode. " +
        "Transactions will not be charged. " +
        "Use a live key (sk_live_*) for production."
      );
    }
  }
  
  /**
   * Initialize a payment transaction for an order
   * 
   * @param order - The order to create a payment for
   * @returns Promise resolving to the initialization result with payment URL
   * 
   * @requirements 8.3 - Initialize Paystack transaction and return payment URL
   */
  async initializeTransaction(order: Order): Promise<PaymentInitResult> {
    const reference = generateReference();
    
    // Convert amount to kobo (smallest currency unit)
    // Paystack expects amount in kobo (1 Naira = 100 kobo)
    const amountInKobo = Math.round(order.totalAmount * 100);
    
    // Build the request payload
    const payload = {
      email: this.getCustomerEmail(order),
      amount: amountInKobo,
      reference,
      currency: "NGN",
      callback_url: this.callbackUrl,
      metadata: {
        orderId: order.id,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        itemCount: order.items.length,
        custom_fields: [
          {
            display_name: "Order ID",
            variable_name: "order_id",
            value: order.id,
          },
          {
            display_name: "Customer Name",
            variable_name: "customer_name",
            value: order.customerName,
          },
        ],
      },
    };
    
    try {
      const response = await fetch(PAYSTACK_INITIALIZE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      
      const data: PaystackInitializeResponse = await response.json();
      
      if (!response.ok || !data.status || !data.data) {
        return {
          success: false,
          reference,
          error: data.message || "Failed to initialize Paystack transaction",
        };
      }
      
      return {
        success: true,
        reference: data.data.reference,
        paymentUrl: data.data.authorization_url,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("PaystackProvider.initializeTransaction error:", errorMessage);
      
      return {
        success: false,
        reference,
        error: `Failed to initialize payment: ${errorMessage}`,
      };
    }
  }
  
  /**
   * Verify a payment transaction by its reference
   * 
   * @param reference - The payment reference to verify
   * @returns Promise resolving to the verification result
   * 
   * @requirements 8.3 - Verify Paystack transaction for payment verification
   */
  async verifyTransaction(reference: string): Promise<PaymentVerifyResult> {
    if (!reference) {
      return {
        success: false,
        status: "failed",
        amount: 0,
        currency: "NGN",
        metadata: { error: "Reference is required" },
      };
    }
    
    try {
      const url = `${PAYSTACK_VERIFY_ENDPOINT}/${encodeURIComponent(reference)}`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
      });
      
      const data: PaystackVerifyResponse = await response.json();
      
      if (!response.ok || !data.status || !data.data) {
        return {
          success: false,
          status: "failed",
          amount: 0,
          currency: "NGN",
          metadata: { error: data.message || "Verification failed" },
        };
      }
      
      const paymentData = data.data;
      
      return {
        success: paymentData.status === "success",
        status: mapPaystackStatus(paymentData.status),
        // Convert back from kobo to Naira
        amount: paymentData.amount / 100,
        currency: paymentData.currency,
        metadata: {
          reference: paymentData.reference,
          channel: paymentData.channel,
          gatewayResponse: paymentData.gateway_response,
          paidAt: paymentData.paid_at,
          customer: paymentData.customer,
          ...paymentData.metadata,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("PaystackProvider.verifyTransaction error:", errorMessage);
      
      return {
        success: false,
        status: "failed",
        amount: 0,
        currency: "NGN",
        metadata: { error: `Verification failed: ${errorMessage}` },
      };
    }
  }
  
  /**
   * Handle an incoming webhook from Paystack
   * 
   * @param payload - The webhook payload
   * @param signature - The webhook signature for verification (x-paystack-signature header)
   * @returns Promise resolving to the webhook processing result
   * 
   * @requirements 8.5 - Verify webhook signature using Paystack secret key
   * @requirements 8.9 - Log and reject invalid webhook signatures
   */
  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    // Verify the webhook signature
    if (!this.verifyWebhookSignature(payload, signature)) {
      console.warn("PaystackProvider.handleWebhook: Invalid signature");
      return {
        valid: false,
        event: "unknown",
      };
    }
    
    // Validate payload structure
    if (!isValidWebhookPayload(payload)) {
      console.warn("PaystackProvider.handleWebhook: Invalid payload structure");
      return {
        valid: false,
        event: "unknown",
      };
    }
    
    const { event, data } = payload;
    
    // Extract order ID from metadata if available
    const orderId = data.metadata?.orderId as string | undefined;
    
    // Map the event to our payment status
    let status: PaymentStatus | undefined;
    
    switch (event) {
      case "charge.success":
        status = "paid";
        break;
      case "charge.failed":
        status = "failed";
        break;
      case "transfer.success":
        status = "paid";
        break;
      case "transfer.failed":
        status = "failed";
        break;
      case "refund.processed":
        status = "refunded";
        break;
      default:
        // For other events, derive status from data
        status = mapPaystackStatus(data.status);
    }
    
    return {
      valid: true,
      event,
      orderId,
      status,
    };
  }
  
  /**
   * Verify the webhook signature using HMAC SHA512
   * 
   * @param payload - The webhook payload
   * @param signature - The signature from the x-paystack-signature header
   * @returns Whether the signature is valid
   * 
   * @requirements 8.5 - Verify webhook signature using HMAC SHA512
   */
  verifyWebhookSignature(payload: unknown, signature: string): boolean {
    if (!signature) {
      return false;
    }
    
    try {
      // Convert payload to string if it's an object
      const payloadString = typeof payload === "string" 
        ? payload 
        : JSON.stringify(payload);
      
      // Create HMAC SHA512 hash
      const hash = crypto
        .createHmac("sha512", this.secretKey)
        .update(payloadString)
        .digest("hex");
      
      // Compare signatures using timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(signature)
      );
    } catch (error) {
      console.error("PaystackProvider.verifyWebhookSignature error:", error);
      return false;
    }
  }
  
  /**
   * Get or generate a customer email for the transaction
   * Paystack requires an email for all transactions
   */
  private getCustomerEmail(order: Order): string {
    // If we have a phone number, create a placeholder email
    // This is a common pattern for Nigerian businesses where customers
    // may not have email addresses
    if (order.phoneNumber) {
      // Remove any non-numeric characters and create email
      const cleanPhone = order.phoneNumber.replace(/\D/g, "");
      return `${cleanPhone}@customer.placeholder.com`;
    }
    
    // Fallback to a generic customer email with order ID
    return `order-${order.id}@customer.placeholder.com`;
  }
  
  /**
   * Check if the provider is in test mode
   */
  isTestMode(): boolean {
    return this.testMode;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PaystackProvider instance using environment variables
 * 
 * Reads PAYSTACK_SECRET_KEY and validates PAYSTACK_PUBLIC_KEY from the environment.
 * Fails gracefully with clear error messages if either key is missing.
 * 
 * @param callbackUrl - Optional callback URL for payment completion
 * @returns PaystackProvider instance
 * @throws Error if required environment variables are not set
 * 
 * @requirements 8.2 - Fails gracefully with a clear error if env vars are missing
 * @requirements 8.3 - Test mode is auto-detected from the key prefix
 * 
 * @example
 * ```typescript
 * const paystack = createPaystackProvider('https://myapp.com/payment/callback');
 * ```
 */
export function createPaystackProvider(callbackUrl?: string): PaystackProvider {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY;

  if (!secretKey || !publicKey) {
    const missingVars: string[] = [];
    if (!secretKey) missingVars.push("PAYSTACK_SECRET_KEY");
    if (!publicKey) missingVars.push("PAYSTACK_PUBLIC_KEY");

    throw new Error(
      `Missing required Paystack environment variable(s): ${missingVars.join(", ")}. ` +
      "Add them to your .env.local file. " +
      "Get your API keys from https://dashboard.paystack.com/#/settings/developers"
    );
  }
  
  return new PaystackProvider({
    secretKey,
    callbackUrl,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default PaystackProvider;
