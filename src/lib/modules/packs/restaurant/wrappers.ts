/**
 * Restaurant Pack — transport-facing API wrappers and call utilities.
 *
 * These are the real restaurant HTTP wrappers, upsell helpers, and call-guard
 * utilities moved out of the legacy `src/app/ws-server/tools.ts` module as the
 * final step of the gradual extraction (Req 1.4, 1.5, 1.6). They live here under
 * `src/lib/modules/packs/restaurant` so that all domain-specific voice logic
 * resides in the packs directory rather than the Voice_Runtime entry module.
 *
 * Two kinds of consumers use these:
 *  - The pack tool handlers (`handlers.ts`) delegate their fetch bodies to the
 *    `wrapper*` functions here so the executor path and the transport path share
 *    a single implementation.
 *  - The transport layer (`src/app/ws-server/index.ts`) calls the standalone
 *    wrappers directly for the non-tool side-effects it still owns: call-record
 *    upserts, transcript persistence, and inbound call blocking on `/incoming-call`.
 *
 * Endpoints, payload shapes, and the `x-api-key` header exactly match the legacy
 * `tools.ts` so behavior is preserved after legacy removal (task 4.8).
 *
 * Requirements: 1.4, 1.5, 1.6
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("restaurant-pack-wrappers");

/** Base URL of the Next.js app that hosts the internal restaurant API. */
const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";

// Each wrapper inlines the `x-api-key` header (rather than sharing a helper) so
// the authenticated-fetch contract is visible in every function body, matching
// the legacy `tools.ts` exactly.

// ============================================================================
// Type definitions (moved verbatim from the legacy tools.ts)
// ============================================================================

export interface CallData {
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

export interface TranscriptData {
  callId: string | null;
  dialogue: string;
  speaker: "ai" | "human";
  /** Req 17.9: Voice session correlation ID */
  correlationId?: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface OrderData {
  orderId: string;
  restaurantId: string;
  callId?: string | null;
  customerName: string;
  items: OrderItem[];
  specialInstructions?: string;
  status: "active" | "completed" | "cancelled";
}

// ============================================================================
// Core restaurant API wrappers
// ============================================================================

/**
 * Fetches restaurant details from the API.
 */
export async function wrapperGetRestaurantDetails(restaurantId: string): Promise<unknown> {
  if (!restaurantId) {
    return { success: false, error: "Restaurant ID is required" };
  }
  const response = await fetch(`${NEXT_APP_URL}/api/v1/get-restaurant-data/${restaurantId}`, {
    headers: {
      "x-api-key": process.env.INTERNAL_API_KEY || "",
    },
  });
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates call data in the database.
 */
export async function wrapperUpsertCallData(callData: CallData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || "",
    },
    body: JSON.stringify(callData),
  });
  const data = await response.json();
  return data;
}

/**
 * Adds dialogues for the final transcript.
 */
export async function wrapperAddTranscriptDialogues(dialogueData: TranscriptData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/add-transcript-dialogue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || "",
    },
    body: JSON.stringify(dialogueData),
  });
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates order data in the database.
 */
export async function wrapperUpsertOrders(orderData: OrderData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.INTERNAL_API_KEY || "",
    },
    body: JSON.stringify(orderData),
  });
  const data = await response.json();
  return data;
}

// ============================================================================
// Upsell/Cross-sell prompt wrappers (Requirements 24.3, 24.6)
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
 * Fetches matching upsell/cross-sell prompts based on order context and records
 * the delivery for tracking purposes.
 *
 * Requirements: 24.3, 24.6
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
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify(requestBody),
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
 * Requirements: 24.6
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
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify({ deliveryId, accepted }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error recording prompt acceptance", {});
    return { success: false, error: "Failed to record prompt acceptance" };
  }
}

/**
 * Extracts unique item categories from order items, using the restaurant's menu
 * items for category lookup. Used to build the orderContext for prompt matching.
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
 * Calculates the order total from its items.
 */
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

// ============================================================================
// Call blocking / verification utilities (Requirements 25.4)
// ============================================================================

interface CheckBlockedResponse {
  success: boolean;
  data?: {
    action: "allow" | "block" | "require_verification";
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
 * Checks if a phone number is blocked or requires verification based on fraud
 * signals in the system.
 *
 * Requirements: 25.4
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
        "x-api-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify({ phoneNumber }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error checking blocked status", {});
    return { success: false, error: "Failed to check blocked status" };
  }
}

/**
 * Generates a TwiML response to reject a blocked call.
 */
export function generateBlockedCallTwiML(reason?: string): string {
  const message =
    reason ||
    "We're sorry, but we cannot process your call at this time. Please contact the restaurant directly.";
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice">${message}</Say>
      <Hangup/>
    </Response>`;
}

/**
 * Generates a TwiML response to transfer a call for verification.
 */
export function generateVerificationTransferTwiML(verificationNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="alice">Please hold while we connect you with a team member for verification.</Say>
      <Dial>${verificationNumber}</Dial>
    </Response>`;
}
