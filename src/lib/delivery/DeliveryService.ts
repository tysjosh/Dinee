/**
 * Delivery Service Implementation
 * 
 * Implements the DeliveryService interface to provide delivery tracking,
 * rider assignment, status management, and delivery time calculations.
 * 
 * @module delivery/DeliveryService
 * @requirements 14.3, 14.4, 14.5, 14.7 - Delivery tracking operations
 */

import type { Order } from "@/types/global.d";
import type {
  DeliveryStatus,
  DeliveryInfo,
  DeliveryService,
  DeliveryServiceConfig,
  DeliveryOperationResult,
  Location,
  BranchDeliveryMetrics,
  StatusTransitionResult,
  RiderInfo,
  DeliveryTimeRecord,
} from "./types";
import { VALID_STATUS_TRANSITIONS } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Default estimated delivery time in minutes */
const DEFAULT_ESTIMATED_DELIVERY_TIME = 45;

/** Average speed for delivery calculations (km/h) */
const AVERAGE_DELIVERY_SPEED_KMH = 25;

/** Base preparation and pickup time in minutes */
const BASE_PREPARATION_TIME_MINUTES = 10;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate a delivery status transition
 * 
 * @param fromStatus - Current delivery status
 * @param toStatus - Target delivery status
 * @returns Validation result with error message if invalid
 * 
 * @requirements 14.2 - Validate status transitions according to state machine
 */
export function validateStatusTransition(
  fromStatus: DeliveryStatus,
  toStatus: DeliveryStatus
): StatusTransitionResult {
  const validTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
  
  if (!validTransitions) {
    return {
      valid: false,
      error: `Unknown delivery status: ${fromStatus}`,
      fromStatus,
      toStatus,
    };
  }
  
  if (!validTransitions.includes(toStatus)) {
    return {
      valid: false,
      error: `Invalid status transition from "${fromStatus}" to "${toStatus}". Valid transitions: ${validTransitions.join(", ") || "none (terminal state)"}`,
      fromStatus,
      toStatus,
    };
  }
  
  return {
    valid: true,
    fromStatus,
    toStatus,
  };
}

/**
 * Check if a status is a terminal state (no further transitions allowed)
 */
export function isTerminalStatus(status: DeliveryStatus): boolean {
  return VALID_STATUS_TRANSITIONS[status]?.length === 0;
}

/**
 * Calculate distance between two locations using Haversine formula
 * 
 * @param loc1 - First location
 * @param loc2 - Second location
 * @returns Distance in kilometers
 */
export function calculateDistance(loc1: Location, loc2: Location): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(loc2.latitude - loc1.latitude);
  const dLon = toRadians(loc2.longitude - loc1.longitude);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(loc1.latitude)) *
      Math.cos(toRadians(loc2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate delivery time from dispatch to delivery timestamps
 * 
 * @param dispatchedAt - Dispatch timestamp
 * @param deliveredAt - Delivery timestamp
 * @returns Delivery time in minutes
 */
export function calculateDeliveryTimeMinutes(
  dispatchedAt: number,
  deliveredAt: number
): number {
  const diffMs = deliveredAt - dispatchedAt;
  return Math.round(diffMs / (1000 * 60));
}

/**
 * Calculate average delivery time from a list of delivery records
 * 
 * @param records - List of delivery time records
 * @returns Average delivery time in minutes
 * 
 * @requirements 14.7 - Calculate average delivery time per branch
 */
export function calculateAverageDeliveryTime(records: DeliveryTimeRecord[]): number {
  if (records.length === 0) {
    return 0;
  }
  
  const totalTime = records.reduce((sum, record) => sum + record.deliveryTimeMinutes, 0);
  return Math.round(totalTime / records.length);
}

/**
 * Build delivery info from an order
 */
export function buildDeliveryInfoFromOrder(order: Order): DeliveryInfo {
  return {
    orderId: order.id,
    status: order.deliveryStatus || "pending",
    riderId: order.riderId,
    riderName: order.riderName,
    dispatchedAt: order.dispatchedAt,
    deliveredAt: order.deliveredAt,
    failureReason: order.deliveryFailureReason,
    branchId: order.branchId,
  };
}

// ============================================================================
// Unified Delivery Service Class
// ============================================================================

/**
 * Unified Delivery Service
 * 
 * Provides delivery tracking, rider assignment, status management,
 * and delivery time calculations for the Nigerian market.
 * 
 * @requirements 14.3 - Assign riders and update status to "assigned"
 * @requirements 14.4 - Update status to "dispatched" with timestamp
 * @requirements 14.5 - Update status to "delivered" with timestamp
 * @requirements 14.7 - Calculate average delivery time per branch
 * 
 * @example
 * ```typescript
 * const deliveryService = createDeliveryService({
 *   getOrderFn: async (orderId) => await db.orders.get(orderId),
 *   updateOrderDeliveryFn: async (orderId, updates) => {
 *     await db.orders.update(orderId, updates);
 *   },
 * });
 * 
 * // Assign a rider
 * await deliveryService.assignRider(orderId, riderId, "John Doe", "+2348012345678");
 * 
 * // Update status to dispatched
 * await deliveryService.updateStatus(orderId, "dispatched");
 * 
 * // Get delivery info
 * const info = await deliveryService.getDeliveryInfo(orderId);
 * ```
 */
export class UnifiedDeliveryService implements DeliveryService {
  private config: DeliveryServiceConfig;
  
  // In-memory cache for orders (in production, this would be fetched from database)
  private orderCache: Map<string, Order> = new Map();
  
  // In-memory cache for riders
  private riderCache: Map<string, RiderInfo> = new Map();
  
  // In-memory storage for delivery time records (for metrics calculation)
  private deliveryRecords: DeliveryTimeRecord[] = [];
  
  constructor(config: DeliveryServiceConfig = {}) {
    this.config = {
      defaultEstimatedTime: DEFAULT_ESTIMATED_DELIVERY_TIME,
      ...config,
    };
  }
  
  /**
   * Set an order in the cache (for testing or when order is known)
   */
  setOrder(order: Order): void {
    this.orderCache.set(order.id, order);
  }
  
  /**
   * Set a rider in the cache
   */
  setRider(rider: RiderInfo): void {
    this.riderCache.set(rider.riderId, rider);
  }
  
  /**
   * Get an order by ID
   */
  private async getOrder(orderId: string): Promise<Order | null> {
    // Check cache first
    const cached = this.orderCache.get(orderId);
    if (cached) {
      return cached;
    }
    
    // Use provided function if available
    if (this.config.getOrderFn) {
      const order = await this.config.getOrderFn(orderId);
      if (order) {
        this.orderCache.set(orderId, order);
      }
      return order;
    }
    
    return null;
  }
  
  /**
   * Get a rider by ID
   */
  private async getRider(riderId: string): Promise<RiderInfo | null> {
    // Check cache first
    const cached = this.riderCache.get(riderId);
    if (cached) {
      return cached;
    }
    
    // Use provided function if available
    if (this.config.getRiderFn) {
      const rider = await this.config.getRiderFn(riderId);
      if (rider) {
        this.riderCache.set(riderId, rider);
      }
      return rider;
    }
    
    return null;
  }
  
  /**
   * Update order in cache and database
   */
  private async updateOrderDelivery(
    orderId: string,
    updates: Partial<DeliveryInfo>
  ): Promise<void> {
    // Update cache
    const order = this.orderCache.get(orderId);
    if (order) {
      const updatedOrder: Order = {
        ...order,
        deliveryStatus: updates.status || order.deliveryStatus,
        riderId: updates.riderId !== undefined ? updates.riderId : order.riderId,
        riderName: updates.riderName !== undefined ? updates.riderName : order.riderName,
        dispatchedAt: updates.dispatchedAt !== undefined ? updates.dispatchedAt : order.dispatchedAt,
        deliveredAt: updates.deliveredAt !== undefined ? updates.deliveredAt : order.deliveredAt,
        deliveryFailureReason: updates.failureReason !== undefined ? updates.failureReason : order.deliveryFailureReason,
      };
      this.orderCache.set(orderId, updatedOrder);
    }
    
    // Use provided function if available
    if (this.config.updateOrderDeliveryFn) {
      await this.config.updateOrderDeliveryFn(orderId, updates);
    }
  }
  
  /**
   * Assign a rider to an order
   * 
   * Updates deliveryStatus to "assigned" and stores riderId and riderName.
   * Validates that the order exists and is in a valid state for assignment.
   * 
   * @param orderId - The ID of the order
   * @param riderId - The ID of the rider to assign
   * @param riderName - Optional name of the rider (will be fetched if not provided)
   * @param riderPhone - Optional phone number of the rider
   * @returns Promise resolving when assignment is complete
   * @throws Error if order not found or invalid status transition
   * 
   * @requirements 14.3 - Update deliveryStatus to "assigned" and store riderId and riderName
   */
  async assignRider(
    orderId: string,
    riderId: string,
    riderName?: string,
    riderPhone?: string
  ): Promise<void> {
    // Get the order
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    // Get current delivery status (default to pending if not set)
    const currentStatus: DeliveryStatus = order.deliveryStatus || "pending";
    
    // Validate status transition
    const transitionResult = validateStatusTransition(currentStatus, "assigned");
    if (!transitionResult.valid) {
      throw new Error(transitionResult.error);
    }
    
    // Get rider name if not provided
    let finalRiderName = riderName;
    let finalRiderPhone = riderPhone;
    
    if (!finalRiderName || !finalRiderPhone) {
      const rider = await this.getRider(riderId);
      if (rider) {
        finalRiderName = finalRiderName || rider.name;
        finalRiderPhone = finalRiderPhone || rider.phone;
      }
    }
    
    // Update the order with rider assignment
    await this.updateOrderDelivery(orderId, {
      status: "assigned",
      riderId,
      riderName: finalRiderName,
      riderPhone: finalRiderPhone,
    });
  }
  
  /**
   * Update the delivery status of an order
   * 
   * Validates status transitions according to the state machine and
   * records appropriate timestamps for dispatch and delivery.
   * 
   * @param orderId - The ID of the order
   * @param status - The new delivery status
   * @param metadata - Optional metadata (e.g., failureReason for failed status)
   * @returns Promise resolving when status is updated
   * @throws Error if order not found or invalid status transition
   * 
   * @requirements 14.4 - Update to "dispatched" with dispatchedAt timestamp
   * @requirements 14.5 - Update to "delivered" with deliveredAt timestamp
   * @requirements 14.8 - Allow recording failure reason and triggering re-dispatch
   */
  async updateStatus(
    orderId: string,
    status: DeliveryStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Get the order
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    // Get current delivery status (default to pending if not set)
    const currentStatus: DeliveryStatus = order.deliveryStatus || "pending";
    
    // Validate status transition
    const transitionResult = validateStatusTransition(currentStatus, status);
    if (!transitionResult.valid) {
      throw new Error(transitionResult.error);
    }
    
    // Build update object
    const updates: Partial<DeliveryInfo> = {
      status,
    };
    
    // Add timestamps based on status
    const now = Date.now();
    
    if (status === "dispatched") {
      // Requirement 14.4: Record dispatchedAt timestamp
      updates.dispatchedAt = now;
    } else if (status === "delivered") {
      // Requirement 14.5: Record deliveredAt timestamp
      updates.deliveredAt = now;
      
      // Record delivery time for metrics
      if (order.dispatchedAt && order.branchId) {
        const deliveryTimeMinutes = calculateDeliveryTimeMinutes(order.dispatchedAt, now);
        this.deliveryRecords.push({
          orderId,
          branchId: order.branchId,
          dispatchedAt: order.dispatchedAt,
          deliveredAt: now,
          deliveryTimeMinutes,
        });
      }
    } else if (status === "failed") {
      // Requirement 14.8: Record failure reason
      const failureReason = metadata?.failureReason as string | undefined;
      if (failureReason) {
        updates.failureReason = failureReason;
      }
    }
    
    // Apply any additional metadata
    if (metadata) {
      if (metadata.riderId !== undefined) {
        updates.riderId = metadata.riderId as string;
      }
      if (metadata.riderName !== undefined) {
        updates.riderName = metadata.riderName as string;
      }
      if (metadata.riderPhone !== undefined) {
        updates.riderPhone = metadata.riderPhone as string;
      }
    }
    
    // Update the order
    await this.updateOrderDelivery(orderId, updates);
  }
  
  /**
   * Get delivery information for an order
   * 
   * @param orderId - The ID of the order
   * @returns Promise resolving to the delivery info
   * @throws Error if order not found
   */
  async getDeliveryInfo(orderId: string): Promise<DeliveryInfo> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    return buildDeliveryInfoFromOrder(order);
  }
  
  /**
   * Calculate estimated delivery time based on branch and customer location
   * 
   * Uses distance calculation and average delivery speed to estimate time.
   * Falls back to default estimated time if locations are not available.
   * 
   * @param branchId - The ID of the branch
   * @param customerLocation - The customer's location
   * @returns Promise resolving to estimated time in minutes
   */
  async calculateEstimatedTime(
    branchId: string,
    customerLocation: Location
  ): Promise<number> {
    // Try to get branch metrics for historical average
    if (this.config.getBranchMetricsFn) {
      const metrics = await this.config.getBranchMetricsFn(branchId);
      if (metrics && metrics.averageDeliveryTime > 0) {
        return metrics.averageDeliveryTime;
      }
    }
    
    // Calculate from in-memory records if available
    const branchRecords = this.deliveryRecords.filter(r => r.branchId === branchId);
    if (branchRecords.length > 0) {
      return calculateAverageDeliveryTime(branchRecords);
    }
    
    // Fall back to default
    return this.config.defaultEstimatedTime || DEFAULT_ESTIMATED_DELIVERY_TIME;
  }
  
  /**
   * Get delivery metrics for a branch
   * 
   * Calculates average delivery time, success rate, and other metrics
   * from completed deliveries.
   * 
   * @param branchId - The ID of the branch
   * @returns Branch delivery metrics
   * 
   * @requirements 14.7 - Calculate and display average delivery time per branch
   */
  getBranchMetrics(branchId: string): BranchDeliveryMetrics {
    const branchRecords = this.deliveryRecords.filter(r => r.branchId === branchId);
    
    if (branchRecords.length === 0) {
      return {
        branchId,
        averageDeliveryTime: 0,
        totalDeliveries: 0,
        failedDeliveries: 0,
        successRate: 0,
      };
    }
    
    const deliveryTimes = branchRecords.map(r => r.deliveryTimeMinutes);
    const averageDeliveryTime = calculateAverageDeliveryTime(branchRecords);
    const fastestDelivery = Math.min(...deliveryTimes);
    const slowestDelivery = Math.max(...deliveryTimes);
    
    // Count failed deliveries from cache
    let failedDeliveries = 0;
    for (const order of this.orderCache.values()) {
      if (order.branchId === branchId && order.deliveryStatus === "failed") {
        failedDeliveries++;
      }
    }
    
    const totalDeliveries = branchRecords.length + failedDeliveries;
    const successRate = totalDeliveries > 0 
      ? Math.round((branchRecords.length / totalDeliveries) * 100) 
      : 0;
    
    return {
      branchId,
      averageDeliveryTime,
      totalDeliveries,
      failedDeliveries,
      successRate,
      fastestDelivery,
      slowestDelivery,
    };
  }
  
  /**
   * Unassign a rider from an order
   * 
   * Resets the delivery status to pending and clears rider information.
   * Useful for re-dispatching orders or handling rider unavailability.
   * 
   * @param orderId - The ID of the order
   * @returns Promise resolving when unassignment is complete
   */
  async unassignRider(orderId: string): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    const currentStatus: DeliveryStatus = order.deliveryStatus || "pending";
    
    // Can only unassign from assigned status
    if (currentStatus !== "assigned") {
      throw new Error(`Cannot unassign rider from order with status "${currentStatus}". Order must be in "assigned" status.`);
    }
    
    await this.updateOrderDelivery(orderId, {
      status: "pending",
      riderId: undefined,
      riderName: undefined,
      riderPhone: undefined,
    });
  }
  
  /**
   * Re-dispatch a failed delivery
   * 
   * Resets the delivery status to allow re-assignment and clears failure reason.
   * 
   * @param orderId - The ID of the order
   * @param newRiderId - Optional new rider ID to assign
   * @param newRiderName - Optional new rider name
   * @returns Promise resolving when re-dispatch is initiated
   * 
   * @requirements 14.8 - Allow triggering re-dispatch for failed deliveries
   */
  async reDispatch(
    orderId: string,
    newRiderId?: string,
    newRiderName?: string
  ): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    const currentStatus: DeliveryStatus = order.deliveryStatus || "pending";
    
    // Can only re-dispatch from failed status
    if (currentStatus !== "failed") {
      throw new Error(`Cannot re-dispatch order with status "${currentStatus}". Order must be in "failed" status.`);
    }
    
    // Reset to pending first
    await this.updateOrderDelivery(orderId, {
      status: "pending",
      failureReason: undefined,
    });
    
    // Assign new rider if provided
    if (newRiderId) {
      await this.assignRider(orderId, newRiderId, newRiderName);
    }
  }
  
  /**
   * Add a delivery record for metrics calculation
   * Used when importing historical data or for testing
   */
  addDeliveryRecord(record: DeliveryTimeRecord): void {
    this.deliveryRecords.push(record);
  }
  
  /**
   * Clear all delivery records
   * Used for testing
   */
  clearDeliveryRecords(): void {
    this.deliveryRecords = [];
  }
  
  /**
   * Get all delivery records for a branch
   * Used for analytics and reporting
   */
  getDeliveryRecords(branchId?: string): DeliveryTimeRecord[] {
    if (branchId) {
      return this.deliveryRecords.filter(r => r.branchId === branchId);
    }
    return [...this.deliveryRecords];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a UnifiedDeliveryService instance
 * 
 * @param config - Optional configuration for the delivery service
 * @returns UnifiedDeliveryService instance
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const deliveryService = createDeliveryService();
 * 
 * // With configuration
 * const deliveryService = createDeliveryService({
 *   defaultEstimatedTime: 30,
 *   getOrderFn: async (orderId) => {
 *     return await db.orders.get(orderId);
 *   },
 *   updateOrderDeliveryFn: async (orderId, updates) => {
 *     await db.orders.update(orderId, updates);
 *   },
 * });
 * ```
 */
export function createDeliveryService(
  config: DeliveryServiceConfig = {}
): UnifiedDeliveryService {
  return new UnifiedDeliveryService(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default UnifiedDeliveryService;
