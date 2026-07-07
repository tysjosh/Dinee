/**
 * Messaging Actions for Convex
 * 
 * Provides server-side actions for triggering messaging operations.
 * These actions can be called from mutations or scheduled to run asynchronously.
 * 
 * @module convex/messaging
 * @requirements 11.2 - Send WhatsApp confirmation when order is placed and customer has opted in
 * @requirements 11.5 - Retry up to 3 times with exponential backoff
 * @requirements 11.6 - Fall back to SMS if WhatsApp fails
 * @requirements 12.1 - Send WhatsApp message when status changes to "preparing"
 * @requirements 12.2 - Send WhatsApp message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send WhatsApp message when status changes to "delivered"
 * @requirements 12.4 - Send WhatsApp message when order is cancelled with reason
 */

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a message send operation
 */
interface MessageSendResult {
  success: boolean;
  messageId?: string;
  channel?: "whatsapp" | "sms";
  status?: string;
  error?: string;
}

/**
 * Valid status values that trigger messages
 */
type MessageTriggerStatus = "preparing" | "dispatched" | "delivered" | "cancelled";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate exponential backoff delay
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the base URL for messaging API
 */
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 
         process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
         "http://localhost:3000";
}

/**
 * Get the order confirmation messaging API URL
 */
function getMessagingApiUrl(): string {
  return `${getBaseUrl()}/client/api/v1/messaging/order-confirmation`;
}

/**
 * Get the status update messaging API URL
 */
function getStatusUpdateApiUrl(): string {
  return `${getBaseUrl()}/client/api/v1/messaging/status-update`;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Send order confirmation message
 * 
 * This action calls the messaging API endpoint to send an order confirmation.
 * It handles retry logic with exponential backoff.
 * 
 * @requirements 11.2 - Send WhatsApp confirmation when order is placed
 * @requirements 11.5 - Retry up to 3 times with exponential backoff
 * @requirements 11.6 - Fall back to SMS if WhatsApp fails
 */
export const sendOrderConfirmation = action({
  args: {
    orderId: v.string(),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MessageSendResult> => {
    const { orderId, restaurantName, estimatedDeliveryMinutes } = args;
    
    const maxRetries = 3;
    let lastError: string | undefined;
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const apiUrl = getMessagingApiUrl();
        
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_API_KEY ? { "x-api-key": process.env.INTERNAL_API_KEY } : {}),
          },
          body: JSON.stringify({
            orderId,
            restaurantName,
            estimatedDeliveryMinutes,
          }),
        });

        const result = await response.json();

        if (result.success) {
          console.log(
            `[Messaging] Order confirmation sent successfully for order ${orderId} ` +
            `via ${result.channel} (attempt ${attempt + 1})`
          );
          return {
            success: true,
            messageId: result.messageId,
            channel: result.channel,
            status: result.status,
          };
        }

        // If the error is non-retryable, break out of the loop
        if (isNonRetryableError(result.error)) {
          console.warn(
            `[Messaging] Non-retryable error for order ${orderId}: ${result.error}`
          );
          return {
            success: false,
            error: result.error,
            channel: result.channel,
          };
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[Messaging] Attempt ${attempt + 1} failed for order ${orderId}: ${lastError}`
        );
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        console.log(
          `[Messaging] Retrying order ${orderId} in ${delay}ms (attempt ${attempt + 2}/${maxRetries})`
        );
        await sleep(delay);
      }
    }

    // All retries exhausted
    console.error(
      `[Messaging] All ${maxRetries} attempts failed for order ${orderId}. Last error: ${lastError}`
    );
    
    return {
      success: false,
      error: lastError || "All retry attempts failed",
    };
  },
});

/**
 * Internal action for sending order confirmation (can be scheduled)
 * 
 * This is an internal action that can be scheduled from mutations.
 * It provides the same functionality as sendOrderConfirmation but
 * can be called via ctx.scheduler.runAfter().
 */
export const sendOrderConfirmationInternal = internalAction({
  args: {
    orderId: v.string(),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MessageSendResult> => {
    const { orderId, restaurantName, estimatedDeliveryMinutes } = args;
    
    const maxRetries = 3;
    let lastError: string | undefined;
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const apiUrl = getMessagingApiUrl();
        
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_API_KEY ? { "x-api-key": process.env.INTERNAL_API_KEY } : {}),
          },
          body: JSON.stringify({
            orderId,
            restaurantName,
            estimatedDeliveryMinutes,
          }),
        });

        const result = await response.json();

        if (result.success) {
          console.log(
            `[Messaging] Order confirmation sent successfully for order ${orderId} ` +
            `via ${result.channel} (attempt ${attempt + 1})`
          );
          return {
            success: true,
            messageId: result.messageId,
            channel: result.channel,
            status: result.status,
          };
        }

        // If the error is non-retryable, break out of the loop
        if (isNonRetryableError(result.error)) {
          console.warn(
            `[Messaging] Non-retryable error for order ${orderId}: ${result.error}`
          );
          return {
            success: false,
            error: result.error,
            channel: result.channel,
          };
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[Messaging] Attempt ${attempt + 1} failed for order ${orderId}: ${lastError}`
        );
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        console.log(
          `[Messaging] Retrying order ${orderId} in ${delay}ms (attempt ${attempt + 2}/${maxRetries})`
        );
        await sleep(delay);
      }
    }

    // All retries exhausted
    console.error(
      `[Messaging] All ${maxRetries} attempts failed for order ${orderId}. Last error: ${lastError}`
    );
    
    return {
      success: false,
      error: lastError || "All retry attempts failed",
    };
  },
});

/**
 * Check if an error is non-retryable
 * Non-retryable errors include:
 * - Order not found
 * - No phone number
 * - Customer not opted in
 */
function isNonRetryableError(error?: string): boolean {
  if (!error) return false;
  
  const nonRetryablePatterns = [
    "not found",
    "no phone number",
    "not opted in",
    "invalid",
    "configuration error",
  ];
  
  const lowerError = error.toLowerCase();
  return nonRetryablePatterns.some(pattern => lowerError.includes(pattern));
}


// ============================================================================
// Status Update Actions
// ============================================================================

/**
 * Send order status update message
 * 
 * This action calls the messaging API endpoint to send a status update message.
 * It handles retry logic with exponential backoff.
 * 
 * @requirements 12.1 - Send WhatsApp message when status changes to "preparing"
 * @requirements 12.2 - Send WhatsApp message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send WhatsApp message when status changes to "delivered"
 * @requirements 12.4 - Send WhatsApp message when order is cancelled with reason
 */
export const sendStatusUpdate = action({
  args: {
    orderId: v.string(),
    status: v.union(
      v.literal("preparing"),
      v.literal("dispatched"),
      v.literal("delivered"),
      v.literal("cancelled")
    ),
    restaurantName: v.optional(v.string()),
    riderName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MessageSendResult> => {
    const { 
      orderId, 
      status, 
      restaurantName, 
      riderName, 
      estimatedDeliveryMinutes,
      cancellationReason 
    } = args;
    
    const maxRetries = 3;
    let lastError: string | undefined;
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const apiUrl = getStatusUpdateApiUrl();
        
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_API_KEY ? { "x-api-key": process.env.INTERNAL_API_KEY } : {}),
          },
          body: JSON.stringify({
            orderId,
            status,
            restaurantName,
            riderName,
            estimatedDeliveryMinutes,
            cancellationReason,
          }),
        });

        const result = await response.json();

        if (result.success) {
          console.log(
            `[Messaging] Status update (${status}) sent successfully for order ${orderId} ` +
            `via ${result.channel} (attempt ${attempt + 1})`
          );
          return {
            success: true,
            messageId: result.messageId,
            channel: result.channel,
            status: result.status,
          };
        }

        // If the error is non-retryable, break out of the loop
        if (isNonRetryableError(result.error)) {
          console.warn(
            `[Messaging] Non-retryable error for order ${orderId} status ${status}: ${result.error}`
          );
          return {
            success: false,
            error: result.error,
            channel: result.channel,
          };
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[Messaging] Attempt ${attempt + 1} failed for order ${orderId} status ${status}: ${lastError}`
        );
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        console.log(
          `[Messaging] Retrying order ${orderId} status ${status} in ${delay}ms (attempt ${attempt + 2}/${maxRetries})`
        );
        await sleep(delay);
      }
    }

    // All retries exhausted
    console.error(
      `[Messaging] All ${maxRetries} attempts failed for order ${orderId} status ${status}. Last error: ${lastError}`
    );
    
    return {
      success: false,
      error: lastError || "All retry attempts failed",
    };
  },
});

/**
 * Internal action for sending status update (can be scheduled)
 * 
 * This is an internal action that can be scheduled from mutations.
 * It provides the same functionality as sendStatusUpdate but
 * can be called via ctx.scheduler.runAfter().
 * 
 * @requirements 12.1 - Send WhatsApp message when status changes to "preparing"
 * @requirements 12.2 - Send WhatsApp message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send WhatsApp message when status changes to "delivered"
 * @requirements 12.4 - Send WhatsApp message when order is cancelled with reason
 */
export const sendStatusUpdateInternal = internalAction({
  args: {
    orderId: v.string(),
    status: v.union(
      v.literal("preparing"),
      v.literal("dispatched"),
      v.literal("delivered"),
      v.literal("cancelled")
    ),
    restaurantName: v.optional(v.string()),
    riderName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MessageSendResult> => {
    const { 
      orderId, 
      status, 
      restaurantName, 
      riderName, 
      estimatedDeliveryMinutes,
      cancellationReason 
    } = args;
    
    const maxRetries = 3;
    let lastError: string | undefined;
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const apiUrl = getStatusUpdateApiUrl();
        
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_API_KEY ? { "x-api-key": process.env.INTERNAL_API_KEY } : {}),
          },
          body: JSON.stringify({
            orderId,
            status,
            restaurantName,
            riderName,
            estimatedDeliveryMinutes,
            cancellationReason,
          }),
        });

        const result = await response.json();

        if (result.success) {
          console.log(
            `[Messaging] Status update (${status}) sent successfully for order ${orderId} ` +
            `via ${result.channel} (attempt ${attempt + 1})`
          );
          return {
            success: true,
            messageId: result.messageId,
            channel: result.channel,
            status: result.status,
          };
        }

        // If the error is non-retryable, break out of the loop
        if (isNonRetryableError(result.error)) {
          console.warn(
            `[Messaging] Non-retryable error for order ${orderId} status ${status}: ${result.error}`
          );
          return {
            success: false,
            error: result.error,
            channel: result.channel,
          };
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[Messaging] Attempt ${attempt + 1} failed for order ${orderId} status ${status}: ${lastError}`
        );
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        console.log(
          `[Messaging] Retrying order ${orderId} status ${status} in ${delay}ms (attempt ${attempt + 2}/${maxRetries})`
        );
        await sleep(delay);
      }
    }

    // All retries exhausted
    console.error(
      `[Messaging] All ${maxRetries} attempts failed for order ${orderId} status ${status}. Last error: ${lastError}`
    );
    
    return {
      success: false,
      error: lastError || "All retry attempts failed",
    };
  },
});
