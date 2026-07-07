/**
 * WhatsApp Webhook Handler
 * 
 * Handles incoming webhook events from WhatsApp Business API.
 * Processes incoming messages for STOP/START keywords to manage
 * customer opt-in/opt-out preferences.
 * 
 * @module api/webhooks/whatsapp
 * @requirements 13.3 - Provide WhatsApp keyword command "STOP" to opt out of messages
 * @requirements 13.4 - Update whatsappOptIn to false when "STOP" is received and send confirmation
 * @requirements 13.5 - Provide WhatsApp keyword command "START" to opt back in
 * @requirements 13.6 - Update whatsappOptIn to true when "START" is received and send confirmation
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { formatPhoneNumber } from "@/lib/messaging/MessagingService";
import { internalSecretArg } from "@/lib/internal-auth";

// ============================================================================
// Types
// ============================================================================

/**
 * WhatsApp webhook verification query parameters
 */
interface WhatsAppVerificationParams {
  "hub.mode": string;
  "hub.verify_token": string;
  "hub.challenge": string;
}

/**
 * WhatsApp webhook payload structure for incoming messages
 */
interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppEntry[];
}

interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: string;
}

interface WhatsAppChangeValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "contacts" | "interactive" | "button" | "reaction";
  text?: {
    body: string;
  };
  button?: {
    text: string;
    payload: string;
  };
  interactive?: {
    type: string;
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
}

interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

/**
 * Keyword action types
 */
type KeywordAction = "STOP" | "START" | null;

/**
 * Confirmation message templates
 */
const CONFIRMATION_MESSAGES = {
  STOP: "You have been unsubscribed from WhatsApp notifications. Reply START to re-subscribe at any time.",
  START: "You have been subscribed to WhatsApp notifications. You will now receive order updates and confirmations. Reply STOP to unsubscribe.",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique event ID for idempotency tracking
 */
function generateEventId(messageId: string): string {
  return `whatsapp_message_${messageId}`;
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
 * Parse message text for STOP/START keywords
 * Keywords are case-insensitive and can be surrounded by whitespace
 * 
 * @param text - The message text to parse
 * @returns The detected keyword action or null if no keyword found
 */
function parseKeyword(text: string): KeywordAction {
  const normalizedText = text.trim().toUpperCase();
  
  // Check for exact match or common variations
  if (normalizedText === "STOP" || normalizedText === "UNSUBSCRIBE" || normalizedText === "OPTOUT" || normalizedText === "OPT OUT" || normalizedText === "OPT-OUT") {
    return "STOP";
  }
  
  if (normalizedText === "START" || normalizedText === "SUBSCRIBE" || normalizedText === "OPTIN" || normalizedText === "OPT IN" || normalizedText === "OPT-IN") {
    return "START";
  }
  
  return null;
}

/**
 * Normalize phone number to consistent format
 * WhatsApp sends numbers without + prefix
 */
function normalizePhoneNumber(phoneNumber: string): string {
  // Remove any non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, "");
  
  // Ensure it starts with country code (add + for storage consistency)
  if (!cleaned.startsWith("+")) {
    cleaned = `+${cleaned}`;
  }
  
  return cleaned;
}

/**
 * Send a text message via WhatsApp Business API
 * Used for sending confirmation messages after opt-in/opt-out
 */
async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v18.0";
  
  if (!phoneNumberId || !accessToken) {
    console.error("WhatsApp webhook: Missing WhatsApp API configuration");
    return false;
  }
  
  const formattedPhone = formatPhoneNumber(phoneNumber);
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone,
        type: "text",
        text: {
          body: message,
          preview_url: false,
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error("WhatsApp webhook: Failed to send confirmation message:", errorData);
      return false;
    }
    
    console.log(`WhatsApp webhook: Confirmation message sent to ${formattedPhone}`);
    return true;
  } catch (error) {
    console.error("WhatsApp webhook: Error sending confirmation message:", error);
    return false;
  }
}

/**
 * Validate the webhook payload structure
 */
function isValidWebhookPayload(payload: unknown): payload is WhatsAppWebhookPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  
  const p = payload as Record<string, unknown>;
  
  return (
    p.object === "whatsapp_business_account" &&
    Array.isArray(p.entry)
  );
}

// ============================================================================
// Webhook Handlers
// ============================================================================

/**
 * GET handler for WhatsApp webhook verification
 * 
 * WhatsApp sends a GET request to verify the webhook endpoint during setup.
 * We must respond with the hub.challenge value if the verify token matches.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  
  // Check if this is a verification request
  if (mode === "subscribe") {
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    
    if (!verifyToken) {
      console.error("WhatsApp webhook: WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured");
      return NextResponse.json(
        { error: "Webhook verification not configured" },
        { status: 500 }
      );
    }
    
    if (token === verifyToken) {
      console.log("WhatsApp webhook: Verification successful");
      // Return the challenge as plain text (required by WhatsApp)
      return new NextResponse(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    } else {
      console.warn("WhatsApp webhook: Verification failed - token mismatch");
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 403 }
      );
    }
  }
  
  // If not a verification request, return endpoint status
  return NextResponse.json(
    { message: "WhatsApp webhook endpoint is active" },
    { status: 200 }
  );
}

/**
 * POST handler for WhatsApp webhooks
 * 
 * Processes incoming messages and handles STOP/START keywords
 * to manage customer opt-in/opt-out preferences.
 * 
 * Flow:
 * 1. Receive POST request from WhatsApp
 * 2. Validate payload structure
 * 3. Extract messages from the payload
 * 4. For each message, check for STOP/START keywords
 * 5. Update customer preferences accordingly
 * 6. Send confirmation message
 * 7. Log the webhook event
 * 
 * @requirements 13.3 - Handle "STOP" keyword to opt out
 * @requirements 13.4 - Update whatsappOptIn to false and send confirmation
 * @requirements 13.5 - Handle "START" keyword to opt back in
 * @requirements 13.6 - Update whatsappOptIn to true and send confirmation
 */
export async function POST(request: NextRequest) {
  // Parse the request body
  let rawBody: string;
  let payload: WhatsAppWebhookPayload;
  
  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    console.error("WhatsApp webhook: Invalid JSON body");
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  
  // Validate payload structure
  if (!isValidWebhookPayload(payload)) {
    console.error("WhatsApp webhook: Invalid payload structure");
    return NextResponse.json(
      { error: "Invalid payload structure" },
      { status: 400 }
    );
  }
  
  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    console.error("WhatsApp webhook: Failed to initialize Convex client");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  
  // Process each entry in the webhook payload
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      // Only process message events
      if (change.field !== "messages") {
        continue;
      }
      
      const value = change.value;
      
      // Process status updates (for tracking message delivery)
      if (value.statuses) {
        for (const status of value.statuses) {
          console.log(`WhatsApp webhook: Message ${status.id} status: ${status.status}`);
          // Status updates can be logged for analytics but don't require action
        }
      }
      
      // Process incoming messages
      if (value.messages) {
        for (const message of value.messages) {
          await processIncomingMessage(convexClient, message, rawBody);
        }
      }
    }
  }
  
  // WhatsApp requires a 200 response to acknowledge receipt
  return NextResponse.json(
    { message: "Webhook received" },
    { status: 200 }
  );
}

/**
 * Process an incoming WhatsApp message
 * Checks for STOP/START keywords and updates preferences accordingly
 */
async function processIncomingMessage(
  convexClient: ConvexHttpClient,
  message: WhatsAppMessage,
  rawPayload: string
): Promise<void> {
  const eventId = generateEventId(message.id);
  const phoneNumber = normalizePhoneNumber(message.from);
  
  // Check if this message was already processed (idempotency)
  try {
    const existingEvent = await convexClient.query(
      api.webhookEvents.getWebhookEventByEventId,
      { eventId }
    );
    
    if (existingEvent?.processed) {
      console.log(`WhatsApp webhook: Message ${message.id} already processed, skipping`);
      return;
    }
  } catch (error) {
    console.error("WhatsApp webhook: Error checking existing event:", error);
    // Continue processing even if check fails
  }
  
  // Log the webhook event
  try {
    await convexClient.mutation(api.webhookEvents.createWebhookEvent, {
      eventId,
      provider: "whatsapp",
      eventType: `message.${message.type}`,
      payload: rawPayload,
      verified: true, // WhatsApp webhooks are verified by the platform
      processed: false,
    });
  } catch (error) {
    console.error("WhatsApp webhook: Failed to log webhook event:", error);
    // Continue processing even if logging fails
  }
  
  // Extract message text based on message type
  let messageText: string | null = null;
  
  if (message.type === "text" && message.text) {
    messageText = message.text.body;
  } else if (message.type === "button" && message.button) {
    messageText = message.button.text;
  } else if (message.type === "interactive" && message.interactive) {
    if (message.interactive.button_reply) {
      messageText = message.interactive.button_reply.title;
    } else if (message.interactive.list_reply) {
      messageText = message.interactive.list_reply.title;
    }
  }
  
  // If no text content, skip keyword processing
  if (!messageText) {
    console.log(`WhatsApp webhook: Message ${message.id} has no text content, skipping keyword check`);
    await markEventProcessed(convexClient, eventId);
    return;
  }
  
  // Parse for STOP/START keywords
  const keyword = parseKeyword(messageText);
  
  if (!keyword) {
    console.log(`WhatsApp webhook: Message ${message.id} does not contain STOP/START keyword`);
    await markEventProcessed(convexClient, eventId);
    return;
  }
  
  console.log(`WhatsApp webhook: Processing ${keyword} keyword from ${phoneNumber}`);
  
  // Update customer preferences based on keyword
  const optIn = keyword === "START";
  
  try {
    await convexClient.mutation(api.customerPreferences.updateWhatsAppOptIn, {
      phoneNumber,
      optIn,
      ...internalSecretArg(),
    });
    
    console.log(`WhatsApp webhook: Updated whatsappOptIn to ${optIn} for ${phoneNumber}`);
    
    // Send confirmation message
    const confirmationMessage = CONFIRMATION_MESSAGES[keyword];
    const messageSent = await sendWhatsAppMessage(phoneNumber, confirmationMessage);
    
    if (messageSent) {
      console.log(`WhatsApp webhook: Confirmation sent for ${keyword} to ${phoneNumber}`);
    } else {
      console.warn(`WhatsApp webhook: Failed to send confirmation for ${keyword} to ${phoneNumber}`);
    }
  } catch (error) {
    console.error(`WhatsApp webhook: Failed to update preferences for ${phoneNumber}:`, error);
  }
  
  // Mark the event as processed
  await markEventProcessed(convexClient, eventId);
}

/**
 * Mark a webhook event as processed
 */
async function markEventProcessed(
  convexClient: ConvexHttpClient,
  eventId: string
): Promise<void> {
  try {
    await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
      eventId,
    });
  } catch (error) {
    console.error(`WhatsApp webhook: Failed to mark event ${eventId} as processed:`, error);
  }
}
