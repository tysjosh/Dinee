import { nanoid } from "nanoid";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("ws-server-tools");

const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";

// Type definitions for API calls
interface CallData {
  callId: string | null;
  restaurantId?: string;
  phoneNumber?: string | null;
  status?: "active" | "completed";
  orderId?: string;
  /** Req 11.3: Conversation type for call routing */
  conversationType?: string;
  /** Req 17.7: Voice session correlation ID */
  correlationId?: string;
}

interface TranscriptData {
  callId: string | null;
  dialogue: string;
  speaker: "ai" | "human";
  /** Req 17.9: Voice session correlation ID */
  correlationId?: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface OrderData {
  orderId: string;
  restaurantId: string;
  callId?: string | null;
  customerName: string;
  items: OrderItem[];
  specialInstructions?: string;
  status: "active" | "completed" | "cancelled";
}

/**
 * Fetches restaurant details from the API
 */
export async function wrapperGetRestaurantDetails(restaurantId: string): Promise<unknown> {
  if (!restaurantId) {
    return { success: false, error: "Restaurant ID is required" };
  }
  const response = await fetch(`${NEXT_APP_URL}/api/v1/get-restaurant-data/${restaurantId}`, {
    headers: {
      "x-api-key": process.env.INTERNAL_API_KEY || ""
    }
  });
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates call data in the database
 */
export async function wrapperUpsertCallData(callData: CallData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || ""
    },
    body: JSON.stringify(callData)
  });
  const data = await response.json();
  return data;
}

/**
 * Add dialogues for the final transcript
 */
export async function wrapperAddTranscriptDialogues(dialogueData: TranscriptData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/add-transcript-dialogue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || ""
    },
    body: JSON.stringify(dialogueData)
  });
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates order data in the database
 */
export async function wrapperUpsertOrders(orderData: OrderData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || ""
    },
    body: JSON.stringify(orderData)
  });
  const data = await response.json();
  return data;
}

/**
 * Generates a high-entropy internal order ID using nanoid
 */
export function generateOrderId(): string {
  return `ord_${nanoid(16)}`;
}

const PUBLIC_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

/**
 * Generates a 6-char uppercase alphanumeric public order code
 * for customer-facing references (voice readback, dashboard display)
 */
export function generatePublicOrderCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PUBLIC_CODE_CHARS[Math.floor(Math.random() * PUBLIC_CODE_CHARS.length)];
  }
  return code;
}

// ============================================================================
// Upsell/Cross-sell Prompt Tools
// Requirements: 24.3, 24.6
// ============================================================================

interface OrderContext {
  orderTotal?: number;
  itemCategories?: string[];
  currentHour?: number;
  customerOrderCount?: number;
}

interface MatchPromptsRequest {
  restaurantId: string;
  branchId?: string;
  orderId: string;
  callId?: string;
  orderTotal?: number;
  itemCategories?: string[];
  currentHour?: number;
  customerOrderCount?: number;
}

interface PromptDelivery {
  deliveryId: string;
  promptId: string;
  promptText: string;
  triggerCondition: string;
}

interface MatchPromptsResponse {
  success: boolean;
  matchedCount?: number;
  prompts?: Array<{
    promptId: string;
    promptText: string;
    triggerCondition: string;
    triggerValue: string;
  }>;
  deliveries?: PromptDelivery[];
  error?: string;
}

interface RecordAcceptanceResponse {
  success: boolean;
  deliveryId?: string;
  error?: string;
}

/**
 * Fetches matching upsell/cross-sell prompts based on order context
 * and records the delivery for tracking purposes.
 * 
 * This function should be called by the AI agent when building an order
 * to get relevant upsell suggestions to offer the customer.
 * 
 * Requirements: 24.3, 24.6
 * 
 * @param restaurantId - The restaurant ID
 * @param orderId - The current order ID
 * @param orderContext - Context about the current order (total, categories, etc.)
 * @param callId - Optional call ID for tracking
 * @param branchId - Optional branch ID for branch-specific prompts
 * @returns Matching prompts with their delivery IDs for acceptance tracking
 */
export async function wrapperMatchUpsellPrompts(
  restaurantId: string,
  orderId: string,
  orderContext: OrderContext,
  callId?: string,
  branchId?: string
): Promise<MatchPromptsResponse> {
  if (!restaurantId || !orderId) {
    return { success: false, error: "Restaurant ID and Order ID are required" };
  }

  const requestBody: MatchPromptsRequest = {
    restaurantId,
    orderId,
    callId,
    branchId,
    orderTotal: orderContext.orderTotal,
    itemCategories: orderContext.itemCategories,
    currentHour: orderContext.currentHour ?? new Date().getHours(),
    customerOrderCount: orderContext.customerOrderCount,
  };

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/match-prompts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || ""
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error matching upsell prompts", {});
    return { success: false, error: "Failed to fetch upsell prompts" };
  }
}

/**
 * Records whether a customer accepted or declined an upsell prompt.
 * 
 * This function should be called by the AI agent after delivering a prompt
 * to track whether the customer accepted the upsell suggestion.
 * 
 * Requirements: 24.6
 * 
 * @param deliveryId - The delivery ID returned from wrapperMatchUpsellPrompts
 * @param accepted - Whether the customer accepted the upsell
 * @returns Success status
 */
export async function wrapperRecordPromptAcceptance(
  deliveryId: string,
  accepted: boolean
): Promise<RecordAcceptanceResponse> {
  if (!deliveryId) {
    return { success: false, error: "Delivery ID is required" };
  }

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/record-prompt-acceptance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || ""
      },
      body: JSON.stringify({ deliveryId, accepted })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error recording prompt acceptance", {});
    return { success: false, error: "Failed to record prompt acceptance" };
  }
}

/**
 * Helper function to extract item categories from order items.
 * This can be used to build the orderContext for prompt matching.
 * 
 * @param items - Array of order items
 * @param menuItems - Array of menu items with category information
 * @returns Array of unique category names
 */
export function extractItemCategories(
  items: OrderItem[],
  menuItems: Array<{ name: string; category?: string }>
): string[] {
  const categories = new Set<string>();
  
  for (const item of items) {
    const menuItem = menuItems.find(
      (mi) => mi.name.toLowerCase() === item.name.toLowerCase()
    );
    if (menuItem?.category) {
      categories.add(menuItem.category);
    }
  }
  
  return Array.from(categories);
}

/**
 * Helper function to calculate order total from items.
 * 
 * @param items - Array of order items
 * @returns Total order amount
 */
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((total, item) => total + (item.price * item.quantity), 0);
}


// ============================================================================
// Call Blocking Tools
// Requirements: 25.4
// ============================================================================

interface CheckBlockedResponse {
  success: boolean;
  data?: {
    action: 'allow' | 'block' | 'require_verification';
    isBlocked: boolean;
    hasActiveSignals: boolean;
    reason: string;
    signals: Array<{
      signalType: string;
      signalCount: number;
      lastOccurrence: number;
      disposition?: string;
    }>;
  };
  error?: string;
}

/**
 * Checks if a phone number is blocked or requires verification
 * based on fraud signals in the system.
 * 
 * This function should be called at the start of a call to determine
 * if the call should be:
 * - 'allow': Process normally
 * - 'block': Reject the call
 * - 'require_verification': Transfer to human agent for verification
 * 
 * Requirements: 25.4
 * 
 * @param phoneNumber - The phone number to check
 * @returns CheckBlockedResponse with action and details
 */
export async function wrapperCheckBlocked(
  phoneNumber: string
): Promise<CheckBlockedResponse> {
  if (!phoneNumber?.trim()) {
    return { success: false, error: "Phone number is required" };
  }

  try {
    const response = await fetch(`${NEXT_APP_URL}/api/v1/check-blocked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.INTERNAL_API_KEY || ""
      },
      body: JSON.stringify({ phoneNumber })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error checking blocked status", {});
    return { success: false, error: "Failed to check blocked status" };
  }
}

/**
 * Generates a TwiML response to reject a blocked call
 * 
 * @param reason - Optional reason for rejection to include in the message
 * @returns TwiML string to reject the call
 */
export function generateBlockedCallTwiML(reason?: string): string {
  const message = reason || "We're sorry, but we cannot process your call at this time. Please contact the restaurant directly.";
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice">${message}</Say>
      <Hangup/>
    </Response>`;
}

/**
 * Generates a TwiML response to transfer a call for verification
 * 
 * @param verificationNumber - The phone number to transfer to for verification
 * @returns TwiML string to transfer the call
 */
export function generateVerificationTransferTwiML(verificationNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice">Please hold while we connect you with a team member for verification.</Say>
      <Dial>${verificationNumber}</Dial>
    </Response>`;
}
