/**
 * DeliveryStatusUI - Component for displaying orders grouped by delivery status
 * 
 * This component displays:
 * - Orders grouped by delivery status (pending, assigned, dispatched, in_transit, delivered, failed)
 * - Count and visual indicators for each status group
 * - Average delivery time metrics for the branch
 * 
 * @see Requirements: 14.6, 14.7
 */

import React, { useMemo } from 'react';
import {
  Clock,
  User,
  Truck,
  Package,
  CheckCircle,
  XCircle,
  Timer,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import type { Order, DeliveryStatus } from '@/types/global';
import type { BranchDeliveryMetrics } from '@/lib/delivery/types';

// ============================================================================
// Types
// ============================================================================

export interface DeliveryStatusUIProps {
  /** Orders to display grouped by delivery status */
  orders: Order[];
  /** Branch delivery metrics for average time display */
  metrics?: BranchDeliveryMetrics;
  /** Optional class name */
  className?: string;
  /** Callback when an order is clicked */
  onOrderClick?: (order: Order) => void;
  /** Whether to show the metrics panel */
  showMetrics?: boolean;
}

interface StatusConfig {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  badgeVariant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Configuration for each delivery status
 * Defines visual styling and labels for status groups
 */
const STATUS_CONFIG: Record<DeliveryStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    badgeVariant: 'warning',
    description: 'Awaiting rider assignment',
  },
  assigned: {
    label: 'Assigned',
    icon: User,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    badgeVariant: 'info',
    description: 'Rider assigned, awaiting dispatch',
  },
  dispatched: {
    label: 'Dispatched',
    icon: Package,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    badgeVariant: 'default',
    description: 'Order dispatched for delivery',
  },
  in_transit: {
    label: 'In Transit',
    icon: Truck,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
    badgeVariant: 'info',
    description: 'Currently being delivered',
  },
  delivered: {
    label: 'Delivered',
    icon: CheckCircle,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    badgeVariant: 'success',
    description: 'Successfully delivered',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    badgeVariant: 'error',
    description: 'Delivery failed',
  },
};

/**
 * Order of status groups for display
 * Active statuses first, then completed/failed
 */
const STATUS_ORDER: DeliveryStatus[] = [
  'pending',
  'assigned',
  'dispatched',
  'in_transit',
  'delivered',
  'failed',
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group orders by their delivery status
 */
function groupOrdersByStatus(orders: Order[]): Record<DeliveryStatus, Order[]> {
  const groups: Record<DeliveryStatus, Order[]> = {
    pending: [],
    assigned: [],
    dispatched: [],
    in_transit: [],
    delivered: [],
    failed: [],
  };

  for (const order of orders) {
    const status = order.deliveryStatus || 'pending';
    if (groups[status]) {
      groups[status].push(order);
    }
  }

  return groups;
}

/**
 * Format time in minutes to a human-readable string
 */
function formatDeliveryTime(minutes: number): string {
  if (minutes === 0) return 'N/A';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format currency in Naira
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amount);
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp: Date | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Delivery metrics panel showing average times and success rates
 * @requirements 14.7 - Display average delivery time metrics
 */
function DeliveryMetricsPanel({ metrics }: { metrics?: BranchDeliveryMetrics }) {
  if (!metrics) {
    return (
      <div className="bg-black border border-white/10 rounded-xl p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-white/5 rounded-lg border border-white/10">
            <Timer className="w-5 h-5 text-white/60" />
          </div>
          <h3 className="text-base font-semibold text-white">Delivery Metrics</h3>
        </div>
        <p className="text-white/60 text-sm">No delivery data available yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-black border border-white/10 rounded-xl p-6">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
          <Timer className="w-5 h-5 text-emerald-400" />
        </div>
        <h3 className="text-base font-semibold text-white">Delivery Metrics</h3>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Average Delivery Time */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-white/60">Avg Time</span>
          </div>
          <p className="text-xl font-semibold text-white">
            {formatDeliveryTime(metrics.averageDeliveryTime)}
          </p>
        </div>

        {/* Total Deliveries */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Package className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-white/60">Total</span>
          </div>
          <p className="text-xl font-semibold text-white">
            {metrics.totalDeliveries}
          </p>
        </div>

        {/* Success Rate */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-white/60">Success Rate</span>
          </div>
          <p className="text-xl font-semibold text-white">
            {metrics.successRate}%
          </p>
        </div>

        {/* Failed Deliveries */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-white/60">Failed</span>
          </div>
          <p className="text-xl font-semibold text-white">
            {metrics.failedDeliveries}
          </p>
        </div>
      </div>

      {/* Additional metrics row */}
      {(metrics.fastestDelivery || metrics.slowestDelivery) && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          {metrics.fastestDelivery && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-400">Fastest</span>
                <span className="text-sm font-medium text-emerald-400">
                  {formatDeliveryTime(metrics.fastestDelivery)}
                </span>
              </div>
            </div>
          )}
          {metrics.slowestDelivery && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400">Slowest</span>
                <span className="text-sm font-medium text-amber-400">
                  {formatDeliveryTime(metrics.slowestDelivery)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual order card within a status group
 */
function OrderCard({
  order,
  statusConfig,
  onClick,
}: {
  order: Order;
  statusConfig: StatusConfig;
  onClick?: (order: Order) => void;
}) {
  return (
    <div
      className={cn(
        "bg-black border rounded-lg p-4 transition-all duration-200",
        "hover:bg-white/5 cursor-pointer",
        statusConfig.borderColor
      )}
      onClick={() => onClick?.(order)}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-white">Order #{order.id}</p>
          <p className="text-xs text-white/60">{order.customerName}</p>
        </div>
        <Badge variant={statusConfig.badgeVariant} className="text-xs">
          {statusConfig.label}
        </Badge>
      </div>

      <div className="space-y-2">
        {/* Order amount */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Amount</span>
          <span className="text-white font-medium">
            {formatCurrency(order.totalAmount)}
          </span>
        </div>

        {/* Rider info (if assigned) */}
        {order.riderName && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">Rider</span>
            <span className="text-white">{order.riderName}</span>
          </div>
        )}

        {/* Time info */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">
            {order.deliveryStatus === 'delivered' ? 'Delivered' : 'Ordered'}
          </span>
          <span className="text-white/80">
            {formatRelativeTime(
              order.deliveredAt || order.dispatchedAt || order.timestamp
            )}
          </span>
        </div>

        {/* Failure reason (if failed) */}
        {order.deliveryStatus === 'failed' && order.deliveryFailureReason && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
            <p className="text-xs text-red-400">
              {order.deliveryFailureReason}
            </p>
          </div>
        )}
      </div>

      {/* Click indicator */}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-white/10">
        <span className="text-xs text-white/40 flex items-center">
          View details
          <ChevronRight className="w-3 h-3 ml-1" />
        </span>
      </div>
    </div>
  );
}

/**
 * Status group section showing orders with a specific delivery status
 * @requirements 14.6 - Display orders grouped by delivery status
 */
function StatusGroup({
  status,
  orders,
  onOrderClick,
  isExpanded = true,
}: {
  status: DeliveryStatus;
  orders: Order[];
  onOrderClick?: (order: Order) => void;
  isExpanded?: boolean;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  if (orders.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-xl overflow-hidden bg-black", config.borderColor, "border")}>
      {/* Group header */}
      <div className="p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={cn("p-2 rounded-lg", config.bgColor, config.borderColor, "border")}>
              <Icon className={cn("w-5 h-5", config.color)} />
            </div>
            <div>
              <h3 className={cn("text-sm font-semibold", config.color)}>
                {config.label}
              </h3>
              <p className="text-xs text-white/50">{config.description}</p>
            </div>
          </div>
          <div className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium",
            config.bgColor,
            config.color
          )}>
            {orders.length} order{orders.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Orders grid */}
      {isExpanded && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                statusConfig={config}
                onClick={onOrderClick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Status summary bar showing counts for all statuses
 */
function StatusSummaryBar({
  groupedOrders,
}: {
  groupedOrders: Record<DeliveryStatus, Order[]>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_ORDER.map((status) => {
        const config = STATUS_CONFIG[status];
        const count = groupedOrders[status].length;
        const Icon = config.icon;

        return (
          <div
            key={status}
            className={cn(
              "flex items-center space-x-2 px-3 py-2 rounded-lg",
              config.bgColor,
              config.borderColor,
              "border"
            )}
          >
            <Icon className={cn("w-4 h-4", config.color)} />
            <span className={cn("text-sm font-medium", config.color)}>
              {count}
            </span>
            <span className="text-xs text-white/50">{config.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * DeliveryStatusUI - Main component for delivery status display
 * 
 * Groups orders by delivery status and displays metrics for the branch.
 * 
 * @requirements 14.6 - Display orders grouped by delivery status
 * @requirements 14.7 - Display average delivery time metrics
 */
export function DeliveryStatusUI({
  orders,
  metrics,
  className,
  onOrderClick,
  showMetrics = true,
}: DeliveryStatusUIProps) {
  // Group orders by delivery status
  const groupedOrders = useMemo(() => groupOrdersByStatus(orders), [orders]);

  // Calculate total active deliveries (not delivered or failed)
  const activeDeliveries = useMemo(() => {
    return (
      groupedOrders.pending.length +
      groupedOrders.assigned.length +
      groupedOrders.dispatched.length +
      groupedOrders.in_transit.length
    );
  }, [groupedOrders]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-white/5 rounded-lg border border-white/10">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Delivery Status</h2>
            <p className="text-xs text-white/60">
              Track orders by delivery progress
            </p>
          </div>
        </div>
        
        {activeDeliveries > 0 && (
          <div className="flex items-center space-x-2 bg-cyan-500/10 px-4 py-2 rounded-lg border border-cyan-500/20">
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-cyan-400">
              {activeDeliveries} Active Deliver{activeDeliveries !== 1 ? 'ies' : 'y'}
            </span>
          </div>
        )}
      </div>

      {/* Status summary bar */}
      <StatusSummaryBar groupedOrders={groupedOrders} />

      {/* Metrics panel */}
      {showMetrics && <DeliveryMetricsPanel metrics={metrics} />}

      {/* Status groups */}
      <div className="space-y-4">
        {STATUS_ORDER.map((status) => (
          <StatusGroup
            key={status}
            status={status}
            orders={groupedOrders[status]}
            onOrderClick={onOrderClick}
          />
        ))}
      </div>

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="bg-black border border-white/10 rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <MapPin className="w-8 h-8 text-white/40" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            No Deliveries
          </h3>
          <p className="text-white/60 text-sm max-w-md mx-auto">
            Orders with delivery tracking will appear here once they are ready for dispatch.
          </p>
        </div>
      )}
    </div>
  );
}

export default DeliveryStatusUI;
