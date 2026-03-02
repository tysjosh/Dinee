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
    console.error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
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
    console.error("PAYSTACK_SECRET_KEY environment variable is not set");
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
    console.error("Paystack webhook: Invalid JSON body");
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
    console.error("Paystack webhook: Failed to initialize Paystack provider");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    console.error("Paystack webhook: Failed to initialize Convex client");
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

  // Log the webhook event (even if signature is invalid, for audit purposes)
  try {
    // Check if event was already processed (idempotency check)
    const existingEvent = await convexClient.query(
      api.webhookEvents.getWebhookEventByEventId,
      { eventId }
    );

    if (existingEvent?.processed) {
      console.log(`Paystack webhook: Event ${eventId} already processed, skipping`);
      return NextResponse.json(
        { message: "Event already processed" },
        { status: 200 }
      );
    }

    // Log the webhook event
    await convexClient.mutation(api.webhookEvents.createWebhookEvent, {
      eventId,
      provider: "paystack",
      eventType: payload.event,
      payload: rawBody,
      signature: signature || undefined,
      verified: isValidSignature,
      processed: false,
      orderId: payload.data.metadata?.orderId,
    });
  } catch (error) {
    console.error("Paystack webhook: Failed to log webhook event:", error);
    // Continue processing even if logging fails
  }

  // Reject invalid signatures
  if (!isValidSignature) {
    console.warn(`Paystack webhook: Invalid signature for event ${eventId}`);
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 422 }
    );
  }

  // Extract order ID from metadata
  const orderId = payload.data.metadata?.orderId;
  
  if (!orderId) {
    console.warn(`Paystack webhook: No orderId in metadata for event ${eventId}`);
    // Mark as processed since we can't do anything without an order ID
    try {
      await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
        eventId,
      });
    } catch (error) {
      console.error("Paystack webhook: Failed to mark event as processed:", error);
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
        console.log(`Paystack webhook: Unhandled event type: ${payload.event}`);
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
    console.error(`Paystack webhook: Error processing event ${eventId}:`, error);
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
  console.log(`Paystack webhook: Processing payment success for order ${orderId}`);

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

    console.log(`Paystack webhook: Order ${orderId} payment status updated to "paid"`);
  } catch (error) {
    console.error(`Paystack webhook: Failed to update payment status for order ${orderId}:`, error);
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
  console.log(`Paystack webhook: Processing payment failure for order ${orderId}`);

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

    console.log(`Paystack webhook: Order ${orderId} payment status updated to "failed"`);

    // TODO: Implement branch notification
    // This could be done via:
    // 1. Real-time notification through Convex subscriptions (already handled by UI)
    // 2. WhatsApp/SMS notification to branch manager
    // 3. Email notification
    // For now, the real-time update through Convex will notify the branch dashboard
    
    console.log(`Paystack webhook: Branch notification pending for order ${orderId} payment failure`);
  } catch (error) {
    console.error(`Paystack webhook: Failed to update payment status for order ${orderId}:`, error);
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
  console.log(`Paystack webhook: Processing refund for order ${orderId}`);

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

    console.log(`Paystack webhook: Order ${orderId} payment status updated to "refunded"`);
  } catch (error) {
    console.error(`Paystack webhook: Failed to update payment status for order ${orderId}:`, error);
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
