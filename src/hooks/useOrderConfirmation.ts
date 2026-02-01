/**
 * Hook for sending order confirmation messages
 * 
 * Provides a convenient interface for triggering order confirmation
 * messages from React components.
 * 
 * @module hooks/useOrderConfirmation
 * @requirements 11.2 - Send WhatsApp confirmation when order is placed
 * @requirements 11.3 - Include order ID, restaurant name, items, total, estimated time
 */

import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCallback, useState } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for sending order confirmation
 */
export interface SendConfirmationOptions {
  orderId: string;
  restaurantName?: string;
  estimatedDeliveryMinutes?: number;
}

/**
 * Result of sending order confirmation
 */
export interface SendConfirmationResult {
  success: boolean;
  messageId?: string;
  channel?: "whatsapp" | "sms";
  status?: string;
  error?: string;
}

/**
 * State of the order confirmation hook
 */
export interface UseOrderConfirmationState {
  isLoading: boolean;
  error: string | null;
  lastResult: SendConfirmationResult | null;
}

/**
 * Return type of the useOrderConfirmation hook
 */
export interface UseOrderConfirmationReturn extends UseOrderConfirmationState {
  sendConfirmation: (options: SendConfirmationOptions) => Promise<SendConfirmationResult>;
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for sending order confirmation messages
 * 
 * @example
 * ```tsx
 * const { sendConfirmation, isLoading, error } = useOrderConfirmation();
 * 
 * const handleSendConfirmation = async () => {
 *   const result = await sendConfirmation({
 *     orderId: "ORD-123",
 *     restaurantName: "My Restaurant",
 *     estimatedDeliveryMinutes: 45,
 *   });
 *   
 *   if (result.success) {
 *     toast.success("Confirmation sent!");
 *   } else {
 *     toast.error(result.error || "Failed to send confirmation");
 *   }
 * };
 * ```
 */
export function useOrderConfirmation(): UseOrderConfirmationReturn {
  const [state, setState] = useState<UseOrderConfirmationState>({
    isLoading: false,
    error: null,
    lastResult: null,
  });

  // Get the Convex action for sending order confirmation
  const sendOrderConfirmationAction = useAction(api.messaging.sendOrderConfirmation);

  /**
   * Send order confirmation message
   */
  const sendConfirmation = useCallback(
    async (options: SendConfirmationOptions): Promise<SendConfirmationResult> => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      try {
        const result = await sendOrderConfirmationAction({
          orderId: options.orderId,
          restaurantName: options.restaurantName,
          estimatedDeliveryMinutes: options.estimatedDeliveryMinutes,
        });

        const sendResult: SendConfirmationResult = {
          success: result.success,
          messageId: result.messageId,
          channel: result.channel,
          status: result.status,
          error: result.error,
        };

        setState({
          isLoading: false,
          error: result.success ? null : result.error || "Failed to send confirmation",
          lastResult: sendResult,
        });

        return sendResult;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        const sendResult: SendConfirmationResult = {
          success: false,
          error: errorMessage,
        };

        setState({
          isLoading: false,
          error: errorMessage,
          lastResult: sendResult,
        });

        return sendResult;
      }
    },
    [sendOrderConfirmationAction]
  );

  /**
   * Reset the hook state
   */
  const reset = useCallback(() => {
    setState({
      isLoading: false,
      error: null,
      lastResult: null,
    });
  }, []);

  return {
    ...state,
    sendConfirmation,
    reset,
  };
}

export default useOrderConfirmation;
