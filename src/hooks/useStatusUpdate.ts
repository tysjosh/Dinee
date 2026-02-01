/**
 * Hook for sending order status update messages
 * 
 * Provides a convenient interface for triggering status update messages
 * via WhatsApp with SMS fallback.
 * 
 * @module hooks/useStatusUpdate
 * @requirements 12.1 - Send WhatsApp message when status changes to "preparing"
 * @requirements 12.2 - Send WhatsApp message when status changes to "dispatched" with rider info
 * @requirements 12.3 - Send WhatsApp message when status changes to "delivered"
 * @requirements 12.4 - Send WhatsApp message when order is cancelled with reason
 */

import { useCallback, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

/**
 * Valid status values that trigger messages
 */
export type MessageTriggerStatus = "preparing" | "dispatched" | "delivered" | "cancelled";

/**
 * Options for sending a status update message
 */
export interface StatusUpdateOptions {
  orderId: string;
  status: MessageTriggerStatus;
  restaurantName?: string;
  riderName?: string;
  estimatedDeliveryMinutes?: number;
  cancellationReason?: string;
}

/**
 * Options for updating order status
 */
export interface OrderStatusUpdateOptions {
  orderId: string;
  status: "active" | "preparing" | "ready" | "completed" | "cancelled";
  restaurantName?: string;
  riderName?: string;
  riderId?: string;
  estimatedDeliveryMinutes?: number;
  cancellationReason?: string;
}

/**
 * Result of a status update operation
 */
export interface StatusUpdateResult {
  success: boolean;
  messageId?: string;
  channel?: "whatsapp" | "sms";
  status?: string;
  error?: string;
}

/**
 * Return type for the useStatusUpdate hook
 */
export interface UseStatusUpdateReturn {
  /** Send a status update message */
  sendStatusUpdate: (options: StatusUpdateOptions) => Promise<StatusUpdateResult>;
  /** Update order status and send message */
  updateOrderStatus: (options: OrderStatusUpdateOptions) => Promise<void>;
  /** Update delivery status and send message */
  updateDeliveryStatus: (options: Omit<StatusUpdateOptions, "status"> & { 
    deliveryStatus: "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";
    riderId?: string;
    deliveryFailureReason?: string;
  }) => Promise<void>;
  /** Whether a status update is in progress */
  isLoading: boolean;
  /** Error from the last operation */
  error: string | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for sending order status update messages
 * 
 * @example
 * ```tsx
 * const { sendStatusUpdate, updateOrderStatus, isLoading, error } = useStatusUpdate();
 * 
 * // Send a status update message directly
 * const result = await sendStatusUpdate({
 *   orderId: "order-123",
 *   status: "preparing",
 *   restaurantName: "My Restaurant",
 * });
 * 
 * // Update order status and send message
 * await updateOrderStatus({
 *   orderId: "order-123",
 *   status: "dispatched",
 *   riderName: "John Doe",
 *   estimatedDeliveryMinutes: 30,
 * });
 * ```
 */
export function useStatusUpdate(): UseStatusUpdateReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get the Convex action for sending status updates
  const sendStatusUpdateAction = useAction(api.messaging.sendStatusUpdate);
  
  // Get the Convex mutations for updating order status
  const updateOrderStatusMutation = useMutation(api.orders.updateOrderStatus);
  const updateDeliveryStatusMutation = useMutation(api.orders.updateDeliveryStatus);

  /**
   * Send a status update message
   */
  const sendStatusUpdate = useCallback(
    async (options: StatusUpdateOptions): Promise<StatusUpdateResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await sendStatusUpdateAction({
          orderId: options.orderId,
          status: options.status,
          restaurantName: options.restaurantName,
          riderName: options.riderName,
          estimatedDeliveryMinutes: options.estimatedDeliveryMinutes,
          cancellationReason: options.cancellationReason,
        });

        if (!result.success) {
          setError(result.error || "Failed to send status update");
        }

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        return {
          success: false,
          error: errorMessage,
        };
      } finally {
        setIsLoading(false);
      }
    },
    [sendStatusUpdateAction]
  );

  /**
   * Update order status and send message
   */
  const updateOrderStatus = useCallback(
    async (options: OrderStatusUpdateOptions): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await updateOrderStatusMutation({
          orderId: options.orderId,
          status: options.status,
          cancellationReason: options.cancellationReason,
          riderName: options.riderName,
          riderId: options.riderId,
          sendStatusMessage: true,
          restaurantName: options.restaurantName,
          estimatedDeliveryMinutes: options.estimatedDeliveryMinutes,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [updateOrderStatusMutation]
  );

  /**
   * Update delivery status and send message
   */
  const updateDeliveryStatus = useCallback(
    async (options: Omit<StatusUpdateOptions, "status"> & { 
      deliveryStatus: "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";
      riderId?: string;
      deliveryFailureReason?: string;
    }): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await updateDeliveryStatusMutation({
          orderId: options.orderId,
          deliveryStatus: options.deliveryStatus,
          riderId: options.riderId,
          riderName: options.riderName,
          deliveryFailureReason: options.deliveryFailureReason,
          sendStatusMessage: true,
          restaurantName: options.restaurantName,
          estimatedDeliveryMinutes: options.estimatedDeliveryMinutes,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [updateDeliveryStatusMutation]
  );

  return {
    sendStatusUpdate,
    updateOrderStatus,
    updateDeliveryStatus,
    isLoading,
    error,
  };
}

export default useStatusUpdate;
