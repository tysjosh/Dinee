/**
 * Order Status Update Messaging API Route
 * 
 * Handles sending order status update messages via WhatsApp with SMS fallback.
 * Sends messages when order status changes to: preparing, dispatched, delivered, cancelled.
 * 
 * @module api/messaging/status-update
 * @requirements 12.1 - Send WhatsApp message when status changes to "preparing"
 * @requirements 12.2 - Send WhatsApp message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send WhatsApp message when status changes to "delivered"
 * @requirements 12.4 - Send WhatsApp message when order is cancelled with reason
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { createMessagingServiceFromEnv } from "@/lib/messaging/MessagingService";
import type { Order } from "@/types/global.d";
import type { OptInStatus, MessageResult } from "@/lib/messaging/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Valid status values that trigger messages
 */
type MessageTriggerStatus = "preparing" | "dispatched" | "delivered" | "cancelled";

/**
 * Request body for status update endpoint
 */
interface StatusUpdateRequest {
  orderId: string;
  status: MessageTriggerStatus;
  restaurantName?: string;
  riderName?: string;
  estimatedDeliveryMinutes?: number;
  cancellationReason?: string;
}

/**
 * Response body for status update endpoint
 */
interface StatusUpdateResponse {
  success: boolean;
  messageId?: string;
  channel?: "whatsapp" | "sms";
  status?: string;
  error?: string;
  orderId: string;
  orderStatus: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid status values that trigger messages
 */
const VALID_STATUSES: MessageTriggerStatus[] = ["preparing", "dispatched", "delivered", "cancelled"];

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
 */
function logMessageFailure(
  orderId: string,
  phoneNumber: string,
  status: string,
  error: string,
  channel: "whatsapp" | "sms"
): void {
  console.error(
    `[StatusUpdate] Message delivery failed - ` +
    `Order: ${orderId}, Status: ${status}, Phone: ${phoneNumber}, Channel: ${channel}, Error: ${error}`
  );
}

/**
 * Validate that the status is a valid message trigger status
 */
function isValidStatus(status: string): status is MessageTriggerStatus {
  return VALID_STATUSES.includes(status as MessageTriggerStatus);
}

// ============================================================================
// POST Handler
// ============================================================================

/**
 * POST handler for sending order status update messages
 * 
 * Flow:
 * 1. Receive order ID and status
 * 2. Validate status is a message-triggering status
 * 3. Fetch order details from Convex
 * 4. Check customer opt-in preferences
 * 5. Send WhatsApp message (with retry and exponential backoff)
 * 6. Fall back to SMS if WhatsApp fails
 * 7. Update order with message ID
 * 8. Return result
 * 
 * @requirements 12.1 - Send message when status changes to "preparing"
 * @requirements 12.2 - Send message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send message when status changes to "delivered"
 * @requirements 12.4 - Send message when order is cancelled with reason
 */
export async function POST(request: NextRequest) {
  let body: StatusUpdateRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body", orderId: "", orderStatus: "" },
      { status: 400 }
    );
  }

  const { 
    orderId, 
    status, 
    restaurantName, 
    riderName, 
    estimatedDeliveryMinutes,
    cancellationReason 
  } = body;

  // Validate required fields
  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "orderId is required", orderId: "", orderStatus: "" },
      { status: 400 }
    );
  }

  if (!status) {
    return NextResponse.json(
      { success: false, error: "status is required", orderId, orderStatus: "" },
      { status: 400 }
    );
  }

  // Validate status is a valid message trigger
  if (!isValidStatus(status)) {
    return NextResponse.json(
      { 
        success: false, 
        error: `Invalid status: ${status}. Valid statuses are: ${VALID_STATUSES.join(", ")}`, 
        orderId, 
        orderStatus: status 
      },
      { status: 400 }
    );
  }

  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { success: false, error: "Server configuration error", orderId, orderStatus: status },
      { status: 500 }
    );
  }

  // Fetch order details
  const order = await fetchOrder(convexClient, orderId);
  if (!order) {
    return NextResponse.json(
      { success: false, error: `Order not found: ${orderId}`, orderId, orderStatus: status },
      { status: 404 }
    );
  }

  // Check if order has a phone number
  if (!order.phoneNumber) {
    return NextResponse.json(
      { success: false, error: "Order has no phone number", orderId, orderStatus: status },
      { status: 400 }
    );
  }

  // Override order properties with request parameters if provided
  // This allows the caller to provide updated information
  const orderWithOverrides: Order = {
    ...order,
    riderName: riderName || order.riderName,
    cancellationReason: cancellationReason || order.cancellationReason,
  };

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
      `[StatusUpdate] No messaging channels configured for order ${orderId}`
    );
    return NextResponse.json(
      {
        success: false,
        error: "No messaging channels configured",
        orderId,
        orderStatus: status,
      },
      { status: 503 }
    );
  }

  // Send status update message
  // The MessagingService handles:
  // - Opt-in checking (Requirement 12.6)
  // - Message content based on status
  // - Retry with exponential backoff
  // - SMS fallback
  const result: MessageResult = await messagingService.sendStatusUpdate(orderWithOverrides, status);

  // Log failure if message was not sent successfully
  if (!result.success) {
    logMessageFailure(orderId, order.phoneNumber, status, result.error || "Unknown error", result.channel);
  }

  // Update order with message ID if successful
  if (result.success && result.messageId) {
    await updateOrderWithMessageId(convexClient, orderId, result.messageId);
  }

  const response: StatusUpdateResponse = {
    success: result.success,
    messageId: result.messageId,
    channel: result.channel,
    status: result.status,
    error: result.error,
    orderId,
    orderStatus: status,
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
    { 
      message: "Order status update messaging endpoint is active",
      validStatuses: VALID_STATUSES,
    },
    { status: 200 }
  );
}
