/**
 * AnalyticsService - Service for calculating dashboard metrics
 * 
 * This service provides methods to calculate and aggregate analytics data
 * for the platform dashboard, including:
 * - Total calls and orders
 * - Missed calls tracking
 * - Conversion rates
 * - Average order value
 * 
 * @module analytics/AnalyticsService
 * @see Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Filter options for analytics queries
 */
export interface AnalyticsFilter {
  /** Platform ID for platform-level filtering */
  platformId?: string;
  /** Restaurant ID for restaurant-level filtering */
  restaurantId?: string;
  /** Branch ID for branch-level filtering */
  branchId?: string;
  /** Start date for date range filtering (timestamp) */
  startDate?: number;
  /** End date for date range filtering (timestamp) */
  endDate?: number;
}

/**
 * Dashboard metrics result
 * 
 * @see Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export interface DashboardMetrics {
  /** Total number of calls in the period */
  totalCalls: number;
  /** Total number of orders in the period */
  totalOrders: number;
  /** Number of missed/unanswered calls */
  missedCalls: number;
  /** Conversion rate (orders / calls * 100) */
  conversionRate: number;
  /** Average order value in Naira */
  averageOrderValue: number;
  /** Total revenue in Naira */
  totalRevenue: number;
  /** Number of completed orders */
  completedOrders: number;
  /** Number of cancelled orders */
  cancelledOrders: number;
  /** Average call duration in seconds */
  averageCallDuration: number;
}

/**
 * Trend data for metrics comparison
 */
export interface MetricsTrend {
  /** Current period metrics */
  current: DashboardMetrics;
  /** Previous period metrics (for comparison) */
  previous: DashboardMetrics;
  /** Percentage changes */
  changes: {
    totalCalls: number;
    totalOrders: number;
    missedCalls: number;
    conversionRate: number;
    averageOrderValue: number;
    totalRevenue: number;
  };
}

/**
 * Call data for analytics calculation
 */
export interface CallData {
  callId: string;
  restaurantId?: string;
  branchId?: string;
  status?: 'active' | 'completed';
  duration?: number;
  callStartTime?: number;
  callEndTime?: number;
  orderId?: string;
}

/**
 * Order data for analytics calculation
 */
export interface OrderData {
  orderId: string;
  restaurantId: string;
  branchId?: string;
  callId?: string;
  status: 'active' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  totalAmount?: number;
  orderPlacementTime?: number;
  paymentMethod?: 'paystack' | 'flutterwave' | 'cod';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentTimestamp?: number;
  deliveryStatus?: 'pending' | 'assigned' | 'dispatched' | 'in_transit' | 'delivered' | 'failed';
  deliveredAt?: number;
}

/**
 * Funnel stage names for order tracking
 * 
 * @see Requirements: 22.1
 */
export type FunnelStageName = 
  | 'call_started'
  | 'order_initiated'
  | 'payment_started'
  | 'payment_completed'
  | 'delivery_completed';

/**
 * Funnel stage data for analytics
 * 
 * @see Requirements: 22.1, 22.2, 22.3
 */
export interface FunnelStage {
  /** Name of the funnel stage */
  name: FunnelStageName;
  /** Count of items at this stage */
  count: number;
  /** Conversion rate from previous stage (percentage) */
  conversionRate: number;
  /** Number of drop-offs at this stage */
  dropOffCount: number;
  /** Average time spent at this stage in seconds */
  averageTimeSeconds: number;
}

/**
 * Extended order data with funnel timestamps for tracking
 */
export interface OrderWithFunnelData extends OrderData {
  /** Timestamp when the associated call started */
  callStartTime?: number;
}

/**
 * Time period presets
 */
export type TimePeriod = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get date range for a time period preset
 * 
 * @param period - The time period preset
 * @returns Object with startDate and endDate timestamps
 */
export function getDateRange(period: TimePeriod): { startDate: number; endDate: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = now.getTime();

  switch (period) {
    case 'today':
      return { startDate: today.getTime(), endDate };
    
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { startDate: yesterday.getTime(), endDate: today.getTime() };
    }
    
    case 'last7days': {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { startDate: weekAgo.getTime(), endDate };
    }
    
    case 'last30days': {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { startDate: monthAgo.getTime(), endDate };
    }
    
    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: monthStart.getTime(), endDate };
    }
    
    case 'lastMonth': {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: lastMonthStart.getTime(), endDate: lastMonthEnd.getTime() };
    }
    
    default:
      return { startDate: today.getTime(), endDate };
  }
}

/**
 * Calculate percentage change between two values
 * 
 * @param current - Current value
 * @param previous - Previous value
 * @returns Percentage change (positive or negative)
 */
export function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

// ============================================================================
// AnalyticsService Class
// ============================================================================

/**
 * AnalyticsService - Calculates dashboard metrics with tenant filtering
 * 
 * @example
 * ```typescript
 * const service = new AnalyticsService();
 * 
 * // Get metrics for a specific restaurant
 * const metrics = service.calculateMetrics(calls, orders, {
 *   restaurantId: 'rest_123',
 *   startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   endDate: Date.now(),
 * });
 * ```
 */
export class AnalyticsService {
  /**
   * Calculate dashboard metrics from calls and orders data
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param filter - Optional filter for tenant and date range
   * @returns DashboardMetrics object
   * 
   * @see Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
   */
  calculateMetrics(
    calls: CallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter
  ): DashboardMetrics {
    // Apply filters
    const filteredCalls = this.filterCalls(calls, filter);
    const filteredOrders = this.filterOrders(orders, filter);

    // Calculate call metrics
    const totalCalls = filteredCalls.length;
    const completedCalls = filteredCalls.filter(c => c.status === 'completed');
    const callsWithOrders = filteredCalls.filter(c => c.orderId);
    const missedCalls = totalCalls - completedCalls.length;

    // Calculate order metrics
    const totalOrders = filteredOrders.length;
    const completedOrders = filteredOrders.filter(
      o => o.status === 'completed'
    ).length;
    const cancelledOrders = filteredOrders.filter(
      o => o.status === 'cancelled'
    ).length;

    // Calculate revenue metrics
    const paidOrders = filteredOrders.filter(
      o => o.paymentStatus === 'paid' || o.status === 'completed'
    );
    const totalRevenue = paidOrders.reduce(
      (sum, o) => sum + (o.totalAmount || 0),
      0
    );
    const averageOrderValue = paidOrders.length > 0
      ? totalRevenue / paidOrders.length
      : 0;

    // Calculate conversion rate
    const conversionRate = totalCalls > 0
      ? (callsWithOrders.length / totalCalls) * 100
      : 0;

    // Calculate average call duration
    const callsWithDuration = completedCalls.filter(c => c.duration !== undefined);
    const averageCallDuration = callsWithDuration.length > 0
      ? callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / callsWithDuration.length
      : 0;

    return {
      totalCalls,
      totalOrders,
      missedCalls,
      conversionRate: Math.round(conversionRate * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      completedOrders,
      cancelledOrders,
      averageCallDuration: Math.round(averageCallDuration),
    };
  }

  /**
   * Calculate metrics with trend comparison
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param currentFilter - Filter for current period
   * @param previousFilter - Filter for previous period (for comparison)
   * @returns MetricsTrend with current, previous, and changes
   */
  calculateMetricsWithTrend(
    calls: CallData[],
    orders: OrderData[],
    currentFilter: AnalyticsFilter,
    previousFilter: AnalyticsFilter
  ): MetricsTrend {
    const current = this.calculateMetrics(calls, orders, currentFilter);
    const previous = this.calculateMetrics(calls, orders, previousFilter);

    return {
      current,
      previous,
      changes: {
        totalCalls: calculatePercentageChange(current.totalCalls, previous.totalCalls),
        totalOrders: calculatePercentageChange(current.totalOrders, previous.totalOrders),
        missedCalls: calculatePercentageChange(current.missedCalls, previous.missedCalls),
        conversionRate: calculatePercentageChange(current.conversionRate, previous.conversionRate),
        averageOrderValue: calculatePercentageChange(current.averageOrderValue, previous.averageOrderValue),
        totalRevenue: calculatePercentageChange(current.totalRevenue, previous.totalRevenue),
      },
    };
  }

  /**
   * Get metrics for a specific time period with automatic previous period comparison
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param period - Time period preset
   * @param tenantFilter - Optional tenant filter (platformId, restaurantId, branchId)
   * @returns MetricsTrend with current and previous period comparison
   */
  getMetricsForPeriod(
    calls: CallData[],
    orders: OrderData[],
    period: TimePeriod,
    tenantFilter?: Pick<AnalyticsFilter, 'platformId' | 'restaurantId' | 'branchId'>
  ): MetricsTrend {
    const currentRange = getDateRange(period);
    const periodLength = currentRange.endDate - currentRange.startDate;

    const currentFilter: AnalyticsFilter = {
      ...tenantFilter,
      ...currentRange,
    };

    const previousFilter: AnalyticsFilter = {
      ...tenantFilter,
      startDate: currentRange.startDate - periodLength,
      endDate: currentRange.startDate,
    };

    return this.calculateMetricsWithTrend(calls, orders, currentFilter, previousFilter);
  }

  // ==========================================================================
  // Order Funnel Analytics
  // ==========================================================================

  /**
   * Calculate order funnel stages with conversion rates and drop-off counts
   * 
   * Funnel stages:
   * 1. call_started - Customer initiated a call
   * 2. order_initiated - Order was created from the call
   * 3. payment_started - Payment process was initiated (has paymentMethod)
   * 4. payment_completed - Payment was successfully completed
   * 5. delivery_completed - Order was delivered to customer
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data with funnel timestamps
   * @param filter - Optional filter for tenant and date range
   * @returns Array of FunnelStage objects
   * 
   * @see Requirements: 22.1, 22.2, 22.3
   * 
   * @example
   * ```typescript
   * const service = new AnalyticsService();
   * const funnel = service.getOrderFunnel(calls, orders, {
   *   restaurantId: 'rest_123',
   *   startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
   *   endDate: Date.now(),
   * });
   * // Returns: [
   * //   { name: 'call_started', count: 100, conversionRate: 100, dropOffCount: 0, averageTimeSeconds: 0 },
   * //   { name: 'order_initiated', count: 75, conversionRate: 75, dropOffCount: 25, averageTimeSeconds: 120 },
   * //   ...
   * // ]
   * ```
   */
  getOrderFunnel(
    calls: CallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter
  ): FunnelStage[] {
    // Apply filters
    const filteredCalls = this.filterCalls(calls, filter);
    const filteredOrders = this.filterOrders(orders, filter);

    // Build a map of callId to call data for quick lookup
    const callMap = new Map<string, CallData>();
    for (const call of filteredCalls) {
      callMap.set(call.callId, call);
    }

    // Calculate counts for each funnel stage
    const callStartedCount = filteredCalls.length;
    
    // Orders that were initiated (have an orderId and orderPlacementTime)
    const ordersInitiated = filteredOrders.filter(o => o.orderPlacementTime);
    const orderInitiatedCount = ordersInitiated.length;
    
    // Orders where payment was started (have a paymentMethod set)
    const ordersWithPaymentStarted = ordersInitiated.filter(o => o.paymentMethod);
    const paymentStartedCount = ordersWithPaymentStarted.length;
    
    // Orders where payment was completed (paymentStatus is 'paid')
    const ordersWithPaymentCompleted = ordersWithPaymentStarted.filter(
      o => o.paymentStatus === 'paid'
    );
    const paymentCompletedCount = ordersWithPaymentCompleted.length;
    
    // Orders where delivery was completed (deliveryStatus is 'delivered')
    const ordersWithDeliveryCompleted = ordersWithPaymentCompleted.filter(
      o => o.deliveryStatus === 'delivered'
    );
    const deliveryCompletedCount = ordersWithDeliveryCompleted.length;

    // Calculate average times between stages
    const avgTimeCallToOrder = this.calculateAverageTimeBetweenStages(
      filteredOrders,
      callMap,
      'call_to_order'
    );
    
    const avgTimeOrderToPaymentStart = this.calculateAverageTimeBetweenStages(
      ordersWithPaymentStarted,
      callMap,
      'order_to_payment_start'
    );
    
    const avgTimePaymentStartToComplete = this.calculateAverageTimeBetweenStages(
      ordersWithPaymentCompleted,
      callMap,
      'payment_start_to_complete'
    );
    
    const avgTimePaymentToDelivery = this.calculateAverageTimeBetweenStages(
      ordersWithDeliveryCompleted,
      callMap,
      'payment_to_delivery'
    );

    // Build funnel stages array
    const stages: FunnelStage[] = [
      {
        name: 'call_started',
        count: callStartedCount,
        conversionRate: 100, // First stage is always 100%
        dropOffCount: 0, // No drop-off at first stage
        averageTimeSeconds: 0, // No time measurement for first stage
      },
      {
        name: 'order_initiated',
        count: orderInitiatedCount,
        conversionRate: this.calculateConversionRate(orderInitiatedCount, callStartedCount),
        dropOffCount: callStartedCount - orderInitiatedCount,
        averageTimeSeconds: avgTimeCallToOrder,
      },
      {
        name: 'payment_started',
        count: paymentStartedCount,
        conversionRate: this.calculateConversionRate(paymentStartedCount, orderInitiatedCount),
        dropOffCount: orderInitiatedCount - paymentStartedCount,
        averageTimeSeconds: avgTimeOrderToPaymentStart,
      },
      {
        name: 'payment_completed',
        count: paymentCompletedCount,
        conversionRate: this.calculateConversionRate(paymentCompletedCount, paymentStartedCount),
        dropOffCount: paymentStartedCount - paymentCompletedCount,
        averageTimeSeconds: avgTimePaymentStartToComplete,
      },
      {
        name: 'delivery_completed',
        count: deliveryCompletedCount,
        conversionRate: this.calculateConversionRate(deliveryCompletedCount, paymentCompletedCount),
        dropOffCount: paymentCompletedCount - deliveryCompletedCount,
        averageTimeSeconds: avgTimePaymentToDelivery,
      },
    ];

    return stages;
  }

  /**
   * Get order funnel for a specific time period
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param period - Time period preset
   * @param tenantFilter - Optional tenant filter
   * @returns Array of FunnelStage objects
   */
  getOrderFunnelForPeriod(
    calls: CallData[],
    orders: OrderData[],
    period: TimePeriod,
    tenantFilter?: Pick<AnalyticsFilter, 'platformId' | 'restaurantId' | 'branchId'>
  ): FunnelStage[] {
    const dateRange = getDateRange(period);
    const filter: AnalyticsFilter = {
      ...tenantFilter,
      ...dateRange,
    };
    return this.getOrderFunnel(calls, orders, filter);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Calculate conversion rate between two stages
   * 
   * @param currentCount - Count at current stage
   * @param previousCount - Count at previous stage
   * @returns Conversion rate as percentage (0-100)
   */
  private calculateConversionRate(currentCount: number, previousCount: number): number {
    if (previousCount === 0) {
      return currentCount > 0 ? 100 : 0;
    }
    const rate = (currentCount / previousCount) * 100;
    return Math.round(rate * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate average time between funnel stages
   * 
   * @param orders - Orders to calculate time for
   * @param callMap - Map of callId to call data
   * @param stageTransition - The stage transition to calculate
   * @returns Average time in seconds
   */
  private calculateAverageTimeBetweenStages(
    orders: OrderData[],
    callMap: Map<string, CallData>,
    stageTransition: 'call_to_order' | 'order_to_payment_start' | 'payment_start_to_complete' | 'payment_to_delivery'
  ): number {
    const times: number[] = [];

    for (const order of orders) {
      let timeDiff: number | null = null;

      switch (stageTransition) {
        case 'call_to_order': {
          // Time from call start to order placement
          if (order.callId && order.orderPlacementTime) {
            const call = callMap.get(order.callId);
            if (call?.callStartTime) {
              timeDiff = order.orderPlacementTime - call.callStartTime;
            }
          }
          break;
        }
        case 'order_to_payment_start': {
          // Time from order placement to payment initiation
          // Since we don't have a specific paymentStartedAt timestamp,
          // we estimate this as a minimal time (order placement to when payment method was set)
          // For now, we'll use a default estimate or 0 if not trackable
          if (order.orderPlacementTime && order.paymentMethod) {
            // If paymentTimestamp exists and is after orderPlacementTime, use that
            if (order.paymentTimestamp && order.paymentTimestamp > order.orderPlacementTime) {
              // This is actually payment completion time, so we estimate start as halfway
              timeDiff = (order.paymentTimestamp - order.orderPlacementTime) / 2;
            } else {
              // Default estimate: assume payment starts shortly after order
              timeDiff = 0;
            }
          }
          break;
        }
        case 'payment_start_to_complete': {
          // Time from payment start to payment completion
          // We estimate payment start as halfway between order and payment completion
          if (order.orderPlacementTime && order.paymentTimestamp) {
            const estimatedPaymentStart = order.orderPlacementTime + 
              (order.paymentTimestamp - order.orderPlacementTime) / 2;
            timeDiff = order.paymentTimestamp - estimatedPaymentStart;
          }
          break;
        }
        case 'payment_to_delivery': {
          // Time from payment completion to delivery
          if (order.paymentTimestamp && order.deliveredAt) {
            timeDiff = order.deliveredAt - order.paymentTimestamp;
          }
          break;
        }
      }

      if (timeDiff !== null && timeDiff >= 0) {
        // Convert to seconds
        times.push(timeDiff / 1000);
      }
    }

    if (times.length === 0) {
      return 0;
    }

    const average = times.reduce((sum, t) => sum + t, 0) / times.length;
    return Math.round(average);
  }

  /**
   * Filter calls based on tenant and date range
   */
  private filterCalls(calls: CallData[], filter?: AnalyticsFilter): CallData[] {
    if (!filter) return calls;

    return calls.filter(call => {
      // Tenant filtering
      if (filter.restaurantId && call.restaurantId !== filter.restaurantId) {
        return false;
      }
      if (filter.branchId && call.branchId !== filter.branchId) {
        return false;
      }

      // Date range filtering
      const callTime = call.callStartTime || 0;
      if (filter.startDate && callTime < filter.startDate) {
        return false;
      }
      if (filter.endDate && callTime > filter.endDate) {
        return false;
      }

      return true;
    });
  }

  /**
   * Filter orders based on tenant and date range
   */
  private filterOrders(orders: OrderData[], filter?: AnalyticsFilter): OrderData[] {
    if (!filter) return orders;

    return orders.filter(order => {
      // Tenant filtering
      if (filter.restaurantId && order.restaurantId !== filter.restaurantId) {
        return false;
      }
      if (filter.branchId && order.branchId !== filter.branchId) {
        return false;
      }

      // Date range filtering
      const orderTime = order.orderPlacementTime || 0;
      if (filter.startDate && orderTime < filter.startDate) {
        return false;
      }
      if (filter.endDate && orderTime > filter.endDate) {
        return false;
      }

      return true;
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new AnalyticsService instance
 * 
 * @returns A new AnalyticsService instance
 */
export function createAnalyticsService(): AnalyticsService {
  return new AnalyticsService();
}

// ============================================================================
// Default Export
// ============================================================================

export default AnalyticsService;
