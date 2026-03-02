/**
 * Flutterwave Webhook Handler
 * 
 * Handles incoming webhook events from Flutterwave payment gateway.
 * Verifies webhooks using Flutterwave's verification endpoint, logs events,
 * and processes payment status updates.
 * 
 * @module api/webhooks/flutterwave
 * @requirements 9.2 - Implement webhook endpoint to receive Flutterwave payment notifications
 * @requirements 9.3 - Verify webhook using Flutterwave verification endpoint
 * @requirements 9.4 - Update order paymentStatus to "paid" on successful payment
 * @requirements 9.5 - Update order paymentStatus to "failed" on failed payment and notify branch
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { FlutterwaveProvider } from "@/lib/payment/FlutterwaveProvider";
import { createLogger } from "@/lib/logger";

const logger = createLogger("webhook-flutterwave");

// ============================================================================
// Types
// ============================================================================

/**
 * Flutterwave webhook event payload structure
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique event ID for idempotency tracking
 * Uses the Flutterwave transaction ID and event type to create a unique identifier
 */
function generateEventId(payload: FlutterwaveWebhookPayload): string {
  return `flutterwave_${payload.event}_${payload.data.tx_ref}_${payload.data.id}`;
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
 * Get the Flutterwave provider instance
 */
function getFlutterwaveProvider(): FlutterwaveProvider | null {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) {
    logger.error("FLUTTERWAVE_SECRET_KEY environment variable is not set");
    return null;
  }
  return new FlutterwaveProvider({ secretKey });
}

/**
 * Validate that the webhook payload has the expected structure
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
// Webhook Handler
// ============================================================================

/**
 * POST handler for Flutterwave webhooks
 * 
 * Flow:
 * 1. Receive POST request from Flutterwave
 * 2. Validate payload structure
 * 3. Verify webhook using verif-hash header (optional) and verification endpoint
 * 4. Check if event was already processed (idempotency)
 * 5. Log the webhook event to webhookEvents table
 * 6. Process payment success/failure events
 * 7. Update order payment status accordingly
 * 
 * @requirements 9.3 - Verify webhook using Flutterwave verification endpoint
 */
export async function POST(request: NextRequest) {
  // Get the raw body for logging
  let rawBody: string;
  let payload: FlutterwaveWebhookPayload;
  
  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    logger.error("Flutterwave webhook: Invalid JSON body");
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate payload structure
  if (!isValidWebhookPayload(payload)) {
    logger.error("Flutterwave webhook: Invalid payload structure");
    return NextResponse.json(
      { error: "Invalid payload structure" },
      { status: 400 }
    );
  }

  // Get the verif-hash from headers (Flutterwave's webhook signature)
  const verifHash = request.headers.get("verif-hash") || "";

  // Initialize Flutterwave provider for verification
  const flutterwaveProvider = getFlutterwaveProvider();
  if (!flutterwaveProvider) {
    logger.error("Flutterwave webhook: Failed to initialize Flutterwave provider");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    logger.error("Flutterwave webhook: Failed to initialize Convex client");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // Generate event ID for idempotency
  const eventId = generateEventId(payload);

  // Verify webhook signature using verif-hash header (if configured)
  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  let signatureValid = true;
  
  if (webhookSecret) {
    signatureValid = flutterwaveProvider.verifyWebhookSignature(verifHash);
    if (!signatureValid) {
      logger.warn(`Flutterwave webhook: Invalid verif-hash signature for event ${eventId}`, { eventId });
    }
  }

  // Atomic idempotency check — insert-first strategy eliminates TOCTOU race
  try {
    const insertResult = await convexClient.mutation(
      api.webhookEvents.atomicInsertWebhookEvent,
      {
        eventId,
        provider: "flutterwave",
        eventType: payload.event,
        payload: rawBody,
        signature: verifHash || undefined,
        verified: false, // Will be updated after verification endpoint check
        processed: false,
        orderId: payload.data.meta?.orderId,
      }
    );

    if (!insertResult.inserted) {
      logger.info(`Flutterwave webhook: Event ${eventId} already processed, skipping`, { eventId });
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }
  } catch (error) {
    logger.error("Flutterwave webhook: Failed to log webhook event", { eventId });
    // Continue processing even if logging fails
  }

  // Reject if signature verification failed (when webhook secret is configured)
  if (webhookSecret && !signatureValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 422 }
    );
  }

  // Verify the webhook by calling Flutterwave's verification endpoint
  // This is the primary verification method for Flutterwave webhooks
  const transactionId = payload.data.id.toString();
  let verificationResult;
  
  try {
    verificationResult = await flutterwaveProvider.verifyTransaction(transactionId);
    
    // Update webhook event verification status
    await convexClient.mutation(api.webhookEvents.updateWebhookEventVerification, {
      eventId,
      verified: verificationResult.success || verificationResult.status !== "failed",
    });
  } catch (error) {
    logger.error(`Flutterwave webhook: Verification failed for transaction ${transactionId}`, { eventId });
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 422 }
    );
  }

  // Check if verification indicates the webhook is invalid
  const metadata = verificationResult.metadata as Record<string, unknown> | undefined;
  if (!verificationResult.success && metadata?.error && 
      typeof metadata.error === "string" && 
      metadata.error.includes("Verification failed")) {
    logger.warn(`Flutterwave webhook: Transaction verification failed for ${transactionId}`, { eventId });
    return NextResponse.json(
      { error: "Transaction verification failed" },
      { status: 422 }
    );
  }

  // Extract order ID from metadata
  const orderId = payload.data.meta?.orderId;
  
  if (!orderId) {
    logger.warn(`Flutterwave webhook: No orderId in metadata for event ${eventId}`, { eventId });
    // Mark as processed since we can't do anything without an order ID
    try {
      await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
        eventId,
      });
    } catch (error) {
      logger.error("Flutterwave webhook: Failed to mark event as processed", { eventId });
    }
    return NextResponse.json(
      { message: "Webhook received but no orderId in metadata" },
      { status: 200 }
    );
  }

  // Process the webhook event based on event type and payment status
  try {
    const paymentStatus = payload.data.status;
    
    switch (payload.event) {
      case "charge.completed":
        if (paymentStatus === "successful") {
          await handlePaymentSuccess(convexClient, orderId, payload);
        } else if (paymentStatus === "failed") {
          await handlePaymentFailure(convexClient, orderId, payload);
        }
        break;
      
      case "transfer.completed":
        if (paymentStatus === "successful") {
          await handlePaymentSuccess(convexClient, orderId, payload);
        } else if (paymentStatus === "failed") {
          await handlePaymentFailure(convexClient, orderId, payload);
        }
        break;
      
      default:
        // For other events, process based on status
        if (paymentStatus === "successful") {
          await handlePaymentSuccess(convexClient, orderId, payload);
        } else if (paymentStatus === "failed") {
          await handlePaymentFailure(convexClient, orderId, payload);
        } else {
          logger.info(`Flutterwave webhook: Unhandled event type: ${payload.event} with status: ${paymentStatus}`, { eventId, orderId });
        }
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
    logger.error(`Flutterwave webhook: Error processing event ${eventId}`, { eventId, orderId });
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
 * @requirements 9.4 - Update order paymentStatus to "paid" on successful payment
 */
async function handlePaymentSuccess(
  convexClient: ConvexHttpClient,
  orderId: string,
  payload: FlutterwaveWebhookPayload
): Promise<void> {
  logger.info(`Flutterwave webhook: Processing payment success for order ${orderId}`, { orderId });

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
      paymentReference: payload.data.flw_ref || payload.data.tx_ref,
      paymentTimestamp: Date.now(),
    });

    logger.info(`Flutterwave webhook: Order ${orderId} payment status updated to "paid"`, { orderId });
  } catch (error) {
    logger.error(`Flutterwave webhook: Failed to update payment status for order ${orderId}`, { orderId });
    throw error;
  }
}

/**
 * Handle failed payment events
 * Updates order paymentStatus to "failed" and notifies the branch
 * 
 * @requirements 9.5 - Update order paymentStatus to "failed" on failed payment and notify branch
 */
async function handlePaymentFailure(
  convexClient: ConvexHttpClient,
  orderId: string,
  payload: FlutterwaveWebhookPayload
): Promise<void> {
  logger.info(`Flutterwave webhook: Processing payment failure for order ${orderId}`, { orderId });

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
      paymentReference: payload.data.flw_ref || payload.data.tx_ref,
      paymentTimestamp: Date.now(),
    });

    logger.info(`Flutterwave webhook: Order ${orderId} payment status updated to "failed"`, { orderId });

    // TODO: Implement branch notification
    // This could be done via:
    // 1. Real-time notification through Convex subscriptions (already handled by UI)
    // 2. WhatsApp/SMS notification to branch manager
    // 3. Email notification
    // For now, the real-time update through Convex will notify the branch dashboard
    
    logger.info(`Flutterwave webhook: Branch notification pending for order ${orderId} payment failure`, { orderId });
  } catch (error) {
    logger.error(`Flutterwave webhook: Failed to update payment status for order ${orderId}`, { orderId });
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
    { message: "Flutterwave webhook endpoint is active" },
    { status: 200 }
  );
}
