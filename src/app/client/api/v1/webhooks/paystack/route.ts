/**
 * Paystack Webhook Handler
 * 
 * Handles incoming webhook events from Paystack payment gateway.
 * Verifies webhook signatures, logs events, and processes payment status updates.
 * 
 * @module api/webhooks/paystack
 * @requirements 8.4 - Implement webhook endpoint to receive Paystack payment notifications
 * @requirements 8.5 - Verify webhook signature using Paystack secret key
 * @requirements 8.6 - Update order paymentStatus to "paid" on successful payment
 * @requirements 8.7 - Update order paymentStatus to "failed" on failed payment and notify branch
 * @requirements 8.9 - Log and reject invalid webhook signatures
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { PaystackProvider } from "@/lib/payment/PaystackProvider";
import { createLogger } from "@/lib/logger";

const logger = createLogger("webhook-paystack");

// ============================================================================
// Types
// ============================================================================

/**
 * Paystack webhook event payload structure
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique event ID for idempotency tracking
 * Uses the Paystack reference and event type to create a unique identifier
 */
function generateEventId(payload: PaystackWebhookPayload): string {
  return `paystack_${payload.event}_${payload.data.reference}_${payload.data.id}`;
}

/**
 * Get the Convex client instance
 */
function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    logger.error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Get the Paystack provider instance
 */
function getPaystackProvider(): PaystackProvider | null {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    logger.error("PAYSTACK_SECRET_KEY environment variable is not set");
    return null;
  }
  return new PaystackProvider({ secretKey });
}

// ============================================================================
// Webhook Handler
// ============================================================================

/**
 * POST handler for Paystack webhooks
 * 
 * Flow:
 * 1. Receive POST request from Paystack
 * 2. Verify the webhook signature using x-paystack-signature header
 * 3. Check if event was already processed (idempotency)
 * 4. Log the webhook event to webhookEvents table
 * 5. Process payment success/failure events
 * 6. Update order payment status accordingly
 */
export async function POST(request: NextRequest) {
  // Get the raw body for signature verification
  let rawBody: string;
  let payload: PaystackWebhookPayload;
  
  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    logger.error("Paystack webhook: Invalid JSON body");
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Get the signature from headers
  const signature = request.headers.get("x-paystack-signature") || "";

  // Initialize Paystack provider for signature verification
  const paystackProvider = getPaystackProvider();
  if (!paystackProvider) {
    logger.error("Paystack webhook: Failed to initialize Paystack provider");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    logger.error("Paystack webhook: Failed to initialize Convex client");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Generate event ID for idempotency
  const eventId = generateEventId(payload);

  // Verify the webhook signature
  // Note: We need to verify using the raw body string, not the parsed object
  const isValidSignature = paystackProvider.verifyWebhookSignature(rawBody, signature);

  // Atomic idempotency check — insert-first strategy eliminates TOCTOU race
  try {
    const insertResult = await convexClient.mutation(
      api.webhookEvents.atomicInsertWebhookEvent,
      {
        eventId,
        provider: "paystack",
        eventType: payload.event,
        payload: rawBody,
        signature: signature || undefined,
        verified: isValidSignature,
        processed: false,
        orderId: payload.data.metadata?.orderId,
      }
    );

    if (!insertResult.inserted) {
      logger.info(`Paystack webhook: Event ${eventId} already processed, skipping`, { eventId });
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }
  } catch (error) {
    logger.error("Paystack webhook: Failed to log webhook event", { eventId });
    // Continue processing even if logging fails
  }

  // Reject invalid signatures
  if (!isValidSignature) {
    logger.warn(`Paystack webhook: Invalid signature for event ${eventId}`, { eventId });
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 422 }
    );
  }

  // Extract order ID from metadata
  const orderId = payload.data.metadata?.orderId;
  
  if (!orderId) {
    logger.warn(`Paystack webhook: No orderId in metadata for event ${eventId}`, { eventId });
    // Mark as processed since we can't do anything without an order ID
    try {
      await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
        eventId,
      });
    } catch (error) {
      logger.error("Paystack webhook: Failed to mark event as processed", { eventId });
    }
    return NextResponse.json(
      { message: "Webhook received but no orderId in metadata" },
      { status: 200 }
    );
  }

  // Process the webhook event based on event type
  try {
    switch (payload.event) {
      case "charge.success":
        await handlePaymentSuccess(convexClient, orderId, payload);
        break;
      
      case "charge.failed":
        await handlePaymentFailure(convexClient, orderId, payload);
        break;
      
      case "transfer.success":
        await handlePaymentSuccess(convexClient, orderId, payload);
        break;
      
      case "transfer.failed":
        await handlePaymentFailure(convexClient, orderId, payload);
        break;
      
      case "refund.processed":
        await handleRefund(convexClient, orderId, payload);
        break;
      
      default:
        logger.info(`Paystack webhook: Unhandled event type: ${payload.event}`, { eventId });
    }

    // Mark the webhook event as processed
    await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
      eventId,
      orderId,
    });

    return NextResponse.json(
      { message: "Webhook processed successfully" },
      { status: 200 }
    );
  } catch (error) {
    logger.error(`Paystack webhook: Error processing event ${eventId}`, { eventId, orderId });
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle successful payment events
 * Updates order paymentStatus to "paid"
 * 
 * @requirements 8.6 - Update order paymentStatus to "paid" on successful payment
 */
async function handlePaymentSuccess(
  convexClient: ConvexHttpClient,
  orderId: string,
  payload: PaystackWebhookPayload
): Promise<void> {
  logger.info(`Paystack webhook: Processing payment success for order ${orderId}`, { orderId });

  try {
    // Look up order to get restaurantId
    const order = await convexClient.query(api.orders.getOrderByOrderIdOnly, { orderId });
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    await convexClient.mutation(api.orders.updatePaymentStatus, {
      orderId,
      restaurantId: order.restaurantId,
      paymentStatus: "paid",
      paymentReference: payload.data.reference,
      paymentTimestamp: Date.now(),
    });

    logger.info(`Paystack webhook: Order ${orderId} payment status updated to "paid"`, { orderId });
  } catch (error) {
    logger.error(`Paystack webhook: Failed to update payment status for order ${orderId}`, { orderId });
    throw error;
  }
}

/**
 * Handle failed payment events
 * Updates order paymentStatus to "failed" and notifies the branch
 * 
 * @requirements 8.7 - Update order paymentStatus to "failed" on failed payment and notify branch
 */
async function handlePaymentFailure(
  convexClient: ConvexHttpClient,
  orderId: string,
  payload: PaystackWebhookPayload
): Promise<void> {
  logger.info(`Paystack webhook: Processing payment failure for order ${orderId}`, { orderId });

  try {
    // Look up order to get restaurantId
    const order = await convexClient.query(api.orders.getOrderByOrderIdOnly, { orderId });
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    await convexClient.mutation(api.orders.updatePaymentStatus, {
      orderId,
      restaurantId: order.restaurantId,
      paymentStatus: "failed",
      paymentReference: payload.data.reference,
      paymentTimestamp: Date.now(),
    });

    logger.info(`Paystack webhook: Order ${orderId} payment status updated to "failed"`, { orderId });

    // TODO: Implement branch notification
    // This could be done via:
    // 1. Real-time notification through Convex subscriptions (already handled by UI)
    // 2. WhatsApp/SMS notification to branch manager
    // 3. Email notification
    // For now, the real-time update through Convex will notify the branch dashboard
    
    logger.info(`Paystack webhook: Branch notification pending for order ${orderId} payment failure`, { orderId });
  } catch (error) {
    logger.error(`Paystack webhook: Failed to update payment status for order ${orderId}`, { orderId });
    throw error;
  }
}

/**
 * Handle refund events
 * Updates order paymentStatus to "refunded"
 */
async function handleRefund(
  convexClient: ConvexHttpClient,
  orderId: string,
  payload: PaystackWebhookPayload
): Promise<void> {
  logger.info(`Paystack webhook: Processing refund for order ${orderId}`, { orderId });

  try {
    // Look up order to get restaurantId
    const order = await convexClient.query(api.orders.getOrderByOrderIdOnly, { orderId });
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    await convexClient.mutation(api.orders.updatePaymentStatus, {
      orderId,
      restaurantId: order.restaurantId,
      paymentStatus: "refunded",
      paymentReference: payload.data.reference,
      paymentTimestamp: Date.now(),
    });

    logger.info(`Paystack webhook: Order ${orderId} payment status updated to "refunded"`, { orderId });
  } catch (error) {
    logger.error(`Paystack webhook: Failed to update payment status for order ${orderId}`, { orderId });
    throw error;
  }
}

// ============================================================================
// GET Handler (for webhook verification)
// ============================================================================

/**
 * GET handler for webhook endpoint verification
 * Some payment providers may send a GET request to verify the endpoint exists
 */
export async function GET() {
  return NextResponse.json(
    { message: "Paystack webhook endpoint is active" },
    { status: 200 }
  );
}
