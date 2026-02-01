/**
 * Flutterwave Payment Provider
 * 
 * Implements the PaymentProvider interface for Flutterwave payment gateway integration.
 * Supports card payments, bank transfers, mobile money, and USSD payments in Nigeria.
 * 
 * @module payment/FlutterwaveProvider
 * @requirements 9.1 - Flutterwave transaction initialization and verification
 * @requirements 9.3 - Webhook verification using Flutterwave verification endpoint
 * @requirements 9.6 - Support for Flutterwave sandbox mode
 */

import type { Order } from "@/types/global.d";
import type {
  PaymentProvider,
  PaymentInitResult,
  PaymentVerifyResult,
  WebhookResult,
  PaymentStatus,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const FLUTTERWAVE_API_BASE_URL = "https://api.flutterwave.com/v3";
const FLUTTERWAVE_INITIALIZE_ENDPOINT = `${FLUTTERWAVE_API_BASE_URL}/payments`;
const FLUTTERWAVE_VERIFY_ENDPOINT = `${FLUTTERWAVE_API_BASE_URL}/transactions`;

// ============================================================================
// Types
// ============================================================================

/**
 * Flutterwave API response for payment initialization
 */
interface FlutterwaveInitializeResponse {
  status: "success" | "error";
  message: string;
  data?: {
    link: string;
  };
}

/**
 * Flutterwave API response for transaction verification
 */
interface FlutterwaveVerifyResponse {
  status: "success" | "error";
  message: string;
  data?: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    device_fingerprint: string;
    amount: number;
    currency: string;
    charged_amount: number;
    app_fee: number;
    merchant_fee: number;
    processor_response: string;
    auth_model: string;
    ip: string;
    narration: string;
    status: "successful" | "failed" | "pending";
    payment_type: string;
    created_at: string;
    account_id: number;
    customer: {
      id: number;
      name: string;
      phone_number: string;
      email: string;
      created_at: string;
    };
    meta?: Record<string, unknown>;
  };
}

/**
 * Flutterwave webhook event payload
 */
interface FlutterwaveWebhookPayload {
  event: string;
  "event.type"?: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: "successful" | "failed" | "pending";
    payment_type: string;
    created_at: string;
    customer: {
      id: number;
      name: string;
      phone_number: string;
      email: string;
    };
    meta?: {
      orderId?: string;
      [key: string]: unknown;
    };
  };
}

/**
 * Configuration options for FlutterwaveProvider
 */
interface FlutterwaveProviderConfig {
  /** Flutterwave secret key (required) */
  secretKey: string;
  /** Whether to use sandbox mode (defaults to checking if key starts with 'FLWSECK_TEST') */
  sandboxMode?: boolean;
  /** Redirect URL for payment completion */
  redirectUrl?: string;
  /** Logo URL to display on payment page */
  logoUrl?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a unique transaction reference
 * Format: FLW_{timestamp}_{random}
 */
function generateReference(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `FLW_${timestamp}_${random}`.toUpperCase();
}

/**
 * Converts Flutterwave status to our PaymentStatus type
 */
function mapFlutterwaveStatus(status: string): PaymentStatus {
  switch (status) {
    case "successful":
      return "paid";
    case "failed":
      return "failed";
    case "pending":
    default:
      return "pending";
  }
}

/**
 * Validates that the webhook payload has the expected structure
 */
function isValidWebhookPayload(payload: unknown): payload is FlutterwaveWebhookPayload {
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
    typeof data.tx_ref === "string" &&
    typeof data.status === "string" &&
    typeof data.amount === "number" &&
    typeof data.id === "number"
  );
}

// ============================================================================
// FlutterwaveProvider Class
// ============================================================================

/**
 * Flutterwave payment provider implementation
 * 
 * @example
 * ```typescript
 * const flutterwave = new FlutterwaveProvider({
 *   secretKey: process.env.FLUTTERWAVE_SECRET_KEY!,
 *   redirectUrl: 'https://myapp.com/payment/callback'
 * });
 * 
 * // Initialize a transaction
 * const result = await flutterwave.initializeTransaction(order);
 * if (result.success) {
 *   // Redirect customer to result.paymentUrl
 * }
 * 
 * // Verify a transaction
 * const verification = await flutterwave.verifyTransaction(transactionId);
 * if (verification.success && verification.status === 'paid') {
 *   // Payment successful
 * }
 * ```
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave" as const;
  
  private readonly secretKey: string;
  private readonly sandboxMode: boolean;
  private readonly redirectUrl?: string;
  private readonly logoUrl?: string;
  
  constructor(config: FlutterwaveProviderConfig) {
    if (!config.secretKey) {
      throw new Error("FlutterwaveProvider: secretKey is required");
    }
    
    this.secretKey = config.secretKey;
    this.sandboxMode = config.sandboxMode ?? config.secretKey.startsWith("FLWSECK_TEST");
    this.redirectUrl = config.redirectUrl;
    this.logoUrl = config.logoUrl;
    
    // Log mode for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
      console.log(`FlutterwaveProvider initialized in ${this.sandboxMode ? "SANDBOX" : "LIVE"} mode`);
    }
  }
  
  /**
   * Initialize a payment transaction for an order
   * 
   * @param order - The order to create a payment for
   * @returns Promise resolving to the initialization result with payment URL
   * 
   * @requirements 9.1 - Initialize Flutterwave transaction and return payment URL
   */
  async initializeTransaction(order: Order): Promise<PaymentInitResult> {
    const reference = generateReference();
    
    // Build the request payload
    const payload = {
      tx_ref: reference,
      amount: order.totalAmount,
      currency: "NGN",
      redirect_url: this.redirectUrl,
      customer: {
        email: this.getCustomerEmail(order),
        phonenumber: order.phoneNumber || "",
        name: order.customerName,
      },
      customizations: {
        title: "Order Payment",
        description: `Payment for order ${order.id}`,
        logo: this.logoUrl,
      },
      meta: {
        orderId: order.id,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        itemCount: order.items.length,
      },
    };
    
    try {
      const response = await fetch(FLUTTERWAVE_INITIALIZE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      
      const data: FlutterwaveInitializeResponse = await response.json();
      
      if (!response.ok || data.status !== "success" || !data.data) {
        return {
          success: false,
          reference,
          error: data.message || "Failed to initialize Flutterwave transaction",
        };
      }
      
      return {
        success: true,
        reference,
        paymentUrl: data.data.link,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("FlutterwaveProvider.initializeTransaction error:", errorMessage);
      
      return {
        success: false,
        reference,
        error: `Failed to initialize payment: ${errorMessage}`,
      };
    }
  }
  
  /**
   * Verify a payment transaction by its transaction ID
   * 
   * Flutterwave uses the transaction ID (not tx_ref) for verification.
   * The transaction ID is returned in the webhook payload as `data.id`.
   * 
   * @param transactionId - The Flutterwave transaction ID to verify
   * @returns Promise resolving to the verification result
   * 
   * @requirements 9.1 - Verify Flutterwave transaction for payment verification
   */
  async verifyTransaction(transactionId: string): Promise<PaymentVerifyResult> {
    if (!transactionId) {
      return {
        success: false,
        status: "failed",
        amount: 0,
        currency: "NGN",
        metadata: { error: "Transaction ID is required" },
      };
    }
    
    try {
      const url = `${FLUTTERWAVE_VERIFY_ENDPOINT}/${encodeURIComponent(transactionId)}/verify`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
      });
      
      const data: FlutterwaveVerifyResponse = await response.json();
      
      if (!response.ok || data.status !== "success" || !data.data) {
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
        success: paymentData.status === "successful",
        status: mapFlutterwaveStatus(paymentData.status),
        amount: paymentData.amount,
        currency: paymentData.currency,
        metadata: {
          transactionId: paymentData.id,
          txRef: paymentData.tx_ref,
          flwRef: paymentData.flw_ref,
          paymentType: paymentData.payment_type,
          processorResponse: paymentData.processor_response,
          createdAt: paymentData.created_at,
          customer: paymentData.customer,
          ...paymentData.meta,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("FlutterwaveProvider.verifyTransaction error:", errorMessage);
      
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
   * Handle an incoming webhook from Flutterwave
   * 
   * Flutterwave webhooks are verified by calling the verification endpoint
   * with the transaction ID from the webhook payload.
   * 
   * @param payload - The webhook payload
   * @param signature - The webhook signature (verif-hash header)
   * @returns Promise resolving to the webhook processing result
   * 
   * @requirements 9.3 - Verify webhook using Flutterwave verification endpoint
   */
  async handleWebhook(payload: unknown, signature: string): Promise<WebhookResult> {
    // Validate payload structure first
    if (!isValidWebhookPayload(payload)) {
      console.warn("FlutterwaveProvider.handleWebhook: Invalid payload structure");
      return {
        valid: false,
        event: "unknown",
      };
    }
    
    const { event, data } = payload;
    
    // Verify the webhook by calling the verification endpoint
    // This is Flutterwave's recommended approach for webhook verification
    const verificationResult = await this.verifyTransaction(data.id.toString());
    
    if (!verificationResult.success && verificationResult.status === "failed") {
      // If verification fails completely (not just payment failed), the webhook is invalid
      const metadata = verificationResult.metadata as Record<string, unknown> | undefined;
      if (metadata?.error && typeof metadata.error === "string" && metadata.error.includes("Verification failed")) {
        console.warn("FlutterwaveProvider.handleWebhook: Webhook verification failed");
        return {
          valid: false,
          event,
        };
      }
    }
    
    // Extract order ID from metadata if available
    const orderId = data.meta?.orderId as string | undefined;
    
    // Map the event to our payment status
    let status: PaymentStatus | undefined;
    
    // Flutterwave webhook events
    switch (event) {
      case "charge.completed":
        status = mapFlutterwaveStatus(data.status);
        break;
      case "transfer.completed":
        status = mapFlutterwaveStatus(data.status);
        break;
      default:
        // For other events, derive status from data
        status = mapFlutterwaveStatus(data.status);
    }
    
    return {
      valid: true,
      event,
      orderId,
      status,
    };
  }
  
  /**
   * Verify webhook signature using the verif-hash header
   * 
   * Flutterwave sends a secret hash in the verif-hash header that should
   * match the FLUTTERWAVE_WEBHOOK_SECRET environment variable.
   * 
   * Note: This is an additional verification method. The primary verification
   * is done by calling the verification endpoint in handleWebhook.
   * 
   * @param signature - The signature from the verif-hash header
   * @returns Whether the signature matches the webhook secret
   */
  verifyWebhookSignature(signature: string): boolean {
    const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    
    if (!webhookSecret || !signature) {
      return false;
    }
    
    return signature === webhookSecret;
  }
  
  /**
   * Get or generate a customer email for the transaction
   * Flutterwave requires an email for all transactions
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
   * Check if the provider is in sandbox mode
   */
  isSandboxMode(): boolean {
    return this.sandboxMode;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a FlutterwaveProvider instance using environment variables
 * 
 * @param redirectUrl - Optional redirect URL for payment completion
 * @returns FlutterwaveProvider instance
 * @throws Error if FLUTTERWAVE_SECRET_KEY environment variable is not set
 * 
 * @example
 * ```typescript
 * const flutterwave = createFlutterwaveProvider('https://myapp.com/payment/callback');
 * ```
 */
export function createFlutterwaveProvider(redirectUrl?: string): FlutterwaveProvider {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  
  if (!secretKey) {
    throw new Error(
      "FLUTTERWAVE_SECRET_KEY environment variable is required. " +
      "Get your API key from https://dashboard.flutterwave.com/settings/apis"
    );
  }
  
  return new FlutterwaveProvider({
    secretKey,
    redirectUrl,
    logoUrl: process.env.FLUTTERWAVE_LOGO_URL,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default FlutterwaveProvider;
