/**
 * Delivery Service Types and Interfaces
 * 
 * This module defines the types and interfaces for the delivery tracking service,
 * supporting rider assignment, status tracking, and delivery time calculations.
 * 
 * @module delivery/types
 * @requirements 14.1, 14.2 - Delivery status tracking fields and values
 */

import type { Order } from "@/types/global.d";

// ============================================================================
// Delivery Status Types
// ============================================================================

/**
 * Delivery status values for order delivery tracking
 * - pending: Order is ready for delivery assignment
 * - assigned: Rider has been assigned to the order
 * - dispatched: Order has been dispatched for delivery
 * - in_transit: Order is currently being delivered
 * - delivered: Order has been successfully delivered
 * - failed: Delivery attempt failed
 * 
 * @requirements 14.2 - Support deliveryStatus values
 */
export type DeliveryStatus = 'pending' | 'assigned' | 'dispatched' | 'in_transit' | 'delivered' | 'failed';

// ============================================================================
// Delivery Info Types
// ============================================================================

/**
 * Complete delivery information for an order
 * 
 * @requirements 14.1 - Delivery tracking fields
 */
export interface DeliveryInfo {
  /** Order ID this delivery is for */
  orderId: string;
  /** Current delivery status */
  status: DeliveryStatus;
  /** ID of the assigned rider */
  riderId?: string;
  /** Name of the assigned rider */
  riderName?: string;
  /** Phone number of the assigned rider */
  riderPhone?: string;
  /** Timestamp when order was dispatched */
  dispatchedAt?: number;
  /** Timestamp when order was delivered */
  deliveredAt?: number;
  /** Reason for delivery failure (if failed) */
  failureReason?: string;
  /** Estimated delivery time in minutes */
  estimatedDeliveryTime?: number;
  /** Branch ID the order is from */
  branchId?: string;
}

/**
 * Rider information for assignment
 */
export interface RiderInfo {
  /** Unique rider ID */
  riderId: string;
  /** Rider's display name */
  name: string;
  /** Rider's phone number */
  phone?: string;
  /** Whether rider is currently available */
  isAvailable?: boolean;
}

// ============================================================================
// Location Types
// ============================================================================

/**
 * Geographic location for delivery calculations
 */
export interface Location {
  /** Latitude coordinate */
  latitude: number;
  /** Longitude coordinate */
  longitude: number;
  /** Optional address string */
  address?: string;
}

// ============================================================================
// Status Transition Types
// ============================================================================

/**
 * Valid delivery status transitions
 * Defines the state machine for delivery status changes
 * 
 * @requirements 14.2, 14.3, 14.4, 14.5, 14.8 - Status transition rules
 */
export const VALID_STATUS_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ['assigned', 'failed'],
  assigned: ['dispatched', 'failed', 'pending'], // Can go back to pending if rider is unassigned
  dispatched: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [], // Terminal state
  failed: ['pending', 'assigned'], // Can retry from failed state
};

/**
 * Result of a status transition validation
 */
export interface StatusTransitionResult {
  /** Whether the transition is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** The from status */
  fromStatus: DeliveryStatus;
  /** The to status */
  toStatus: DeliveryStatus;
}

// ============================================================================
// Delivery Service Interface
// ============================================================================

/**
 * Delivery service interface for managing delivery operations
 * This is the main interface for interacting with the delivery system
 * 
 * @requirements 14.3, 14.4, 14.5, 14.7 - Delivery tracking operations
 */
export interface DeliveryService {
  /**
   * Assign a rider to an order
   * Updates deliveryStatus to "assigned" and stores riderId and riderName
   * 
   * @param orderId - The ID of the order
   * @param riderId - The ID of the rider to assign
   * @param riderName - Optional name of the rider
   * @param riderPhone - Optional phone number of the rider
   * @returns Promise resolving when assignment is complete
   * 
   * @requirements 14.3 - Update deliveryStatus to "assigned" and store rider info
   */
  assignRider(orderId: string, riderId: string, riderName?: string, riderPhone?: string): Promise<void>;
  
  /**
   * Update the delivery status of an order
   * Validates status transitions and records timestamps
   * 
   * @param orderId - The ID of the order
   * @param status - The new delivery status
   * @param metadata - Optional metadata (e.g., failure reason)
   * @returns Promise resolving when status is updated
   * 
   * @requirements 14.4, 14.5, 14.8 - Status updates with timestamps
   */
  updateStatus(orderId: string, status: DeliveryStatus, metadata?: Record<string, unknown>): Promise<void>;
  
  /**
   * Get delivery information for an order
   * 
   * @param orderId - The ID of the order
   * @returns Promise resolving to the delivery info
   */
  getDeliveryInfo(orderId: string): Promise<DeliveryInfo>;
  
  /**
   * Calculate estimated delivery time based on branch and customer location
   * 
   * @param branchId - The ID of the branch
   * @param customerLocation - The customer's location
   * @returns Promise resolving to estimated time in minutes
   */
  calculateEstimatedTime(branchId: string, customerLocation: Location): Promise<number>;
}

// ============================================================================
// Delivery Metrics Types
// ============================================================================

/**
 * Delivery time metrics for a branch
 * 
 * @requirements 14.7 - Calculate and display average delivery time per branch
 */
export interface BranchDeliveryMetrics {
  /** Branch ID */
  branchId: string;
  /** Average delivery time in minutes */
  averageDeliveryTime: number;
  /** Total number of completed deliveries */
  totalDeliveries: number;
  /** Number of failed deliveries */
  failedDeliveries: number;
  /** Success rate as a percentage */
  successRate: number;
  /** Fastest delivery time in minutes */
  fastestDelivery?: number;
  /** Slowest delivery time in minutes */
  slowestDelivery?: number;
}

/**
 * Individual delivery time record for metrics calculation
 */
export interface DeliveryTimeRecord {
  /** Order ID */
  orderId: string;
  /** Branch ID */
  branchId: string;
  /** Timestamp when dispatched */
  dispatchedAt: number;
  /** Timestamp when delivered */
  deliveredAt: number;
  /** Delivery time in minutes */
  deliveryTimeMinutes: number;
}

// ============================================================================
// Service Configuration Types
// ============================================================================

/**
 * Configuration for the delivery service
 */
export interface DeliveryServiceConfig {
  /** Default estimated delivery time in minutes */
  defaultEstimatedTime?: number;
  /** Function to get order by ID */
  getOrderFn?: (orderId: string) => Promise<Order | null>;
  /** Function to update order delivery status */
  updateOrderDeliveryFn?: (
    orderId: string,
    updates: Partial<DeliveryInfo>
  ) => Promise<void>;
  /** Function to get delivery metrics for a branch */
  getBranchMetricsFn?: (branchId: string) => Promise<BranchDeliveryMetrics | null>;
  /** Function to get rider info */
  getRiderFn?: (riderId: string) => Promise<RiderInfo | null>;
}

/**
 * Result of a delivery operation
 */
export interface DeliveryOperationResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Updated delivery info */
  deliveryInfo?: DeliveryInfo;
}
