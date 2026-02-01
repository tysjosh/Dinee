/**
 * Order Confirmation Messaging API Route
 * 
 * Handles sending order confirmation messages via WhatsApp with SMS fallback.
 * Implements retry logic with exponential backoff.
 * 
 * @module api/messaging/order-confirmation
 * @requirements 11.2 - Send WhatsApp confirmation when order is placed and customer has opted in
 * @requirements 11.3 - Include order ID, restaurant name, items, total, estimated delivery time
 * @requirements 11.5 - Retry up to 3 times with exponential backoff
 * @requirements 11.6 - Fall back to SMS if WhatsApp fails
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import {
  createMessagingServiceFromEnv,
  formatOrderItems,
  formatNaira,
} from "@/lib/messaging/MessagingService";
import type { Order } from "@/types/global.d";
import type { OptInStatus, MessageResult } from "@/lib/messaging/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Request body for order confirmation endpoint
 */
interface OrderConfirmationRequest {
  orderId: string;
  restaurantName?: string;
  estimatedDeliveryMinutes?: number;
}

/**
 * Response body for order confirmation endpoint
 */
interface OrderConfirmationResponse {
  success: boolean;
  messageId?: string;
  channel?: "whatsapp" | "sms";
  status?: string;
  error?: string;
  orderId: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Fetch order details from Convex
 */
async function fetchOrder(
  convexClient: ConvexHttpClient,
  orderId: string
): Promise<Order | null> {
  try {
    const orderDoc = await convexClient.query(api.orders.getOrderByOrderId, {
      orderId,
    });

    if (!orderDoc) {
      return null;
    }

    // Transform Convex document to Order type
    const order: Order = {
      id: orderDoc.orderId,
      callId: orderDoc.callId,
      phoneNumber: orderDoc.customerPhone || "",
      customerName: orderDoc.customerName,
      items: orderDoc.items.map((item, index) => ({
        id: `item-${index}`,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        specialInstructions: undefined,
      })),
      totalAmount: orderDoc.totalAmount || 0,
      specialInstructions: orderDoc.specialInstructions,
      status: orderDoc.status,
      timestamp: new Date(orderDoc.orderPlacementTime || Date.now()),
      cancellationReason: orderDoc.cancellationReason,
      branchId: orderDoc.branchId,
      restaurantId: orderDoc.restaurantId,
      paymentMethod: orderDoc.paymentMethod,
      paymentStatus: orderDoc.paymentStatus,
      paymentReference: orderDoc.paymentReference,
      paymentTimestamp: orderDoc.paymentTimestamp,
      deliveryStatus: orderDoc.deliveryStatus,
      riderId: orderDoc.riderId,
      riderName: orderDoc.riderName,
      dispatchedAt: orderDoc.dispatchedAt,
      deliveredAt: orderDoc.deliveredAt,
      deliveryFailureReason: orderDoc.deliveryFailureReason,
      whatsappOptIn: orderDoc.whatsappOptIn,
      whatsappMessageIds: orderDoc.whatsappMessageIds,
    };

    return order;
  } catch (error) {
    console.error(`Failed to fetch order ${orderId}:`, error);
    return null;
  }
}

/**
 * Fetch customer opt-in preferences from Convex
 */
async function fetchOptInStatus(
  convexClient: ConvexHttpClient,
  phoneNumber: string
): Promise<OptInStatus> {
  try {
    const preferences = await convexClient.query(
      api.customerPreferences.getByPhoneNumber,
      { phoneNumber }
    );

    if (preferences) {
      return {
        phoneNumber,
        whatsappOptIn: preferences.whatsappOptIn,
        smsOptIn: preferences.smsOptIn,
        updatedAt: preferences.updatedAt,
      };
    }
  } catch (error) {
    console.error(`Failed to fetch opt-in status for ${phoneNumber}:`, error);
  }

  // Default: no opt-in
  return {
    phoneNumber,
    whatsappOptIn: false,
    smsOptIn: false,
    updatedAt: Date.now(),
  };
}

/**
 * Update order with WhatsApp message ID
 */
async function updateOrderWithMessageId(
  convexClient: ConvexHttpClient,
  orderId: string,
  messageId: string
): Promise<void> {
  try {
    // First get the order to get its _id
    const orderDoc = await convexClient.query(api.orders.getOrderByOrderId, {
      orderId,
    });

    if (orderDoc) {
      const existingMessageIds = orderDoc.whatsappMessageIds || [];
      await convexClient.mutation(api.orders.updateOrder, {
        orderId: orderDoc._id,
        whatsappMessageIds: [...existingMessageIds, messageId],
      });
    }
  } catch (error) {
    console.error(`Failed to update order ${orderId} with message ID:`, error);
  }
}

/**
 * Log message delivery failure
 * @requirements 11.6 - Log the failure when all retries fail
 */
function logMessageFailure(
  orderId: string,
  phoneNumber: string,
  error: string,
  channel: "whatsapp" | "sms"
): void {
  console.error(
    `[OrderConfirmation] Message delivery failed - ` +
    `Order: ${orderId}, Phone: ${phoneNumber}, Channel: ${channel}, Error: ${error}`
  );
}

// ============================================================================
// POST Handler
// ============================================================================

/**
 * POST handler for sending order confirmation messages
 * 
 * Flow:
 * 1. Receive order ID and optional configuration
 * 2. Fetch order details from Convex
 * 3. Check customer opt-in preferences
 * 4. Send WhatsApp message (with retry and exponential backoff)
 * 5. Fall back to SMS if WhatsApp fails
 * 6. Update order with message ID
 * 7. Return result
 */
export async function POST(request: NextRequest) {
  let body: OrderConfirmationRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body", orderId: "" },
      { status: 400 }
    );
  }

  const { orderId, restaurantName, estimatedDeliveryMinutes } = body;

  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "orderId is required", orderId: "" },
      { status: 400 }
    );
  }

  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { success: false, error: "Server configuration error", orderId },
      { status: 500 }
    );
  }

  // Fetch order details
  const order = await fetchOrder(convexClient, orderId);
  if (!order) {
    return NextResponse.json(
      { success: false, error: `Order not found: ${orderId}`, orderId },
      { status: 404 }
    );
  }

  // Check if order has a phone number
  if (!order.phoneNumber) {
    return NextResponse.json(
      { success: false, error: "Order has no phone number", orderId },
      { status: 400 }
    );
  }

  // Create messaging service with opt-in check function
  const messagingService = createMessagingServiceFromEnv({
    defaultRestaurantName: restaurantName || "Restaurant",
    defaultEstimatedDeliveryMinutes: estimatedDeliveryMinutes || 45,
    checkOptInFn: async (phoneNumber: string) => {
      return fetchOptInStatus(convexClient, phoneNumber);
    },
  });

  // Check if messaging is available
  if (!messagingService.isWhatsAppAvailable() && !messagingService.isSMSAvailable()) {
    console.warn(
      `[OrderConfirmation] No messaging channels configured for order ${orderId}`
    );
    return NextResponse.json(
      {
        success: false,
        error: "No messaging channels configured",
        orderId,
      },
      { status: 503 }
    );
  }

  // Send order confirmation
  // The MessagingService handles:
  // - Opt-in checking (Requirement 11.2)
  // - Message content (Requirement 11.3)
  // - Retry with exponential backoff (Requirement 11.5)
  // - SMS fallback (Requirement 11.6)
  const result: MessageResult = await messagingService.sendOrderConfirmation(order);

  // Log failure if message was not sent successfully
  if (!result.success) {
    logMessageFailure(orderId, order.phoneNumber, result.error || "Unknown error", result.channel);
  }

  // Update order with message ID if successful
  if (result.success && result.messageId) {
    await updateOrderWithMessageId(convexClient, orderId, result.messageId);
  }

  const response: OrderConfirmationResponse = {
    success: result.success,
    messageId: result.messageId,
    channel: result.channel,
    status: result.status,
    error: result.error,
    orderId,
  };

  return NextResponse.json(response, {
    status: result.success ? 200 : 500,
  });
}

// ============================================================================
// GET Handler
// ============================================================================

/**
 * GET handler for endpoint health check
 */
export async function GET() {
  return NextResponse.json(
    { message: "Order confirmation messaging endpoint is active" },
    { status: 200 }
  );
}
