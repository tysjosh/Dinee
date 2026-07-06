/**
 * CODReconciliationSummary - Component for displaying daily COD collection summary
 * 
 * This component displays:
 * - Total COD amount collected today
 * - Number of COD orders completed
 * - List of individual COD collections with timestamps
 * 
 * @see Requirements: 10.6, 10.7
 * - 10.6: Track COD collection amounts for daily reconciliation
 * - 10.7: Display daily COD collection summary in branch dashboard
 */

import React, { useState, useMemo } from 'react';
import {
  Banknote,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { formatMoney, type CurrencyCode } from '@/lib/region';

// ============================================================================
// Types
// ============================================================================

export interface CODCollection {
  orderId: string;
  amount: number;
  collectedBy: string;
  collectedAt: number;
  branchId: string;
  customerName?: string;
}

export interface CODReconciliationData {
  date: string;
  branchId: string;
  totalOrders: number;
  totalCollected: number;
  paidOrderCount: number;
  pendingOrders: number;
  pendingAmount: number;
  failedOrders: number;
  failedAmount: number;
  collections: CODCollection[];
  collectionsByCollector: Record<string, number>;
}

export interface CODReconciliationSummaryProps {
  /** COD reconciliation data from the query */
  data: CODReconciliationData | null | undefined;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Optional class name */
  className?: string;
  /** Callback when date changes */
  onDateChange?: (date: string) => void;
  /** Currently selected date */
  selectedDate?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format currency in the tenant's currency (US → USD, NG → NGN).
 */
function formatCurrency(amount: number, currency: CurrencyCode = 'NGN'): string {
  return formatMoney(amount, currency);
}

/**
 * Format timestamp to readable time
 */
function formatTime(timestamp: number): string {
  if (!timestamp) return '--:--';
  return new Date(timestamp).toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateString === today.toISOString().split('T')[0]) {
    return 'Today';
  }
  if (dateString === yesterday.toISOString().split('T')[0]) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-NG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Summary stat card
 */
function StatCard({
  title,
  value,
  subValue,
  icon: Icon,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variantStyles = {
    default: 'bg-white/5 border-white/10 text-white/60',
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    danger: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  const iconStyles = {
    default: 'text-white/40',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    danger: 'text-red-400',
  };

  return (
    <div className={cn(
      'rounded-lg border p-4 transition-colors',
      variantStyles[variant]
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-white/50 mb-1">{title}</p>
          <p className="text-xl font-semibold text-white">{value}</p>
          {subValue && (
            <p className="text-xs text-white/40 mt-1">{subValue}</p>
          )}
        </div>
        <div className={cn('p-2 rounded-lg bg-white/5', iconStyles[variant])}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

/**
 * Collection item row
 */
function CollectionRow({ collection, currency }: { collection: CODCollection; currency: CurrencyCode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10">
          <Receipt size={14} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-white">
            Order #{collection.orderId.slice(-6)}
          </p>
          <p className="text-xs text-white/50">
            {collection.customerName || 'Customer'} • {formatTime(collection.collectedAt)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-emerald-400">
          {formatCurrency(collection.amount, currency)}
        </p>
        <p className="text-xs text-white/40">
          {collection.collectedBy}
        </p>
      </div>
    </div>
  );
}

/**
 * Loading skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-white/5 rounded-lg" />
        ))}
      </div>
      <div className="h-48 bg-white/5 rounded-lg" />
    </div>
  );
}

/**
 * Empty state
 */
function EmptyState({ date }: { date: string }) {
  return (
    <div className="text-center py-8">
      <div className="p-4 rounded-full bg-white/5 w-fit mx-auto mb-4">
        <Banknote size={32} className="text-white/30" />
      </div>
      <h3 className="text-lg font-medium text-white mb-2">No COD Orders</h3>
      <p className="text-sm text-white/50">
        No cash-on-delivery orders for {formatDate(date)}
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * CODReconciliationSummary - Displays daily COD collection summary for branch dashboard
 * 
 * @see Requirements: 10.6, 10.7
 */
export function CODReconciliationSummary({
  data,
  isLoading = false,
  className,
  onDateChange,
  selectedDate,
}: CODReconciliationSummaryProps) {
  const [showCollections, setShowCollections] = useState(true);

  // Amounts follow the tenant's currency (US → USD, NG → NGN).
  const { currency } = useCurrency();

  // Get today's date as default
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentDate = selectedDate || data?.date || today;

  // Sort collections by time (most recent first)
  const sortedCollections = useMemo(() => {
    if (!data?.collections) return [];
    return [...data.collections].sort((a, b) => b.collectedAt - a.collectedAt);
  }, [data?.collections]);

  if (isLoading) {
    return (
      <div className={cn('card p-6', className)}>
        <LoadingSkeleton />
      </div>
    );
  }

  return (
    <div className={cn('card', className)}>
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Banknote size={20} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                COD Reconciliation
              </h3>
              <p className="text-xs text-white/50">
                Daily cash collection summary
              </p>
            </div>
          </div>

          {/* Date Selector */}
          {onDateChange && (
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-white/40" />
              <input
                type="date"
                value={currentDate}
                onChange={(e) => onDateChange(e.target.value)}
                max={today}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {!data || data.totalOrders === 0 ? (
          <EmptyState date={currentDate} />
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                title="Total Collected"
                value={formatCurrency(data.totalCollected, currency)}
                subValue={`${data.paidOrderCount} orders`}
                icon={TrendingUp}
                variant="success"
              />
              <StatCard
                title="Pending Collection"
                value={formatCurrency(data.pendingAmount, currency)}
                subValue={`${data.pendingOrders} orders`}
                icon={Clock}
                variant="warning"
              />
              <StatCard
                title="Failed Collections"
                value={formatCurrency(data.failedAmount, currency)}
                subValue={`${data.failedOrders} orders`}
                icon={AlertTriangle}
                variant={data.failedOrders > 0 ? 'danger' : 'default'}
              />
              <StatCard
                title="Total COD Orders"
                value={data.totalOrders}
                subValue={formatDate(data.date)}
                icon={Receipt}
                variant="default"
              />
            </div>

            {/* Collection Rate */}
            {data.totalOrders > 0 && (
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/60">Collection Rate</span>
                  <span className="text-sm font-medium text-white">
                    {Math.round((data.paidOrderCount / data.totalOrders) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${(data.paidOrderCount / data.totalOrders) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Collections List */}
            {sortedCollections.length > 0 && (
              <div className="border border-white/10 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowCollections(!showCollections)}
                  className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-sm font-medium text-white">
                      Collected Payments ({sortedCollections.length})
                    </span>
                  </div>
                  {showCollections ? (
                    <ChevronUp size={16} className="text-white/40" />
                  ) : (
                    <ChevronDown size={16} className="text-white/40" />
                  )}
                </button>

                {showCollections && (
                  <div className="p-4 max-h-64 overflow-y-auto">
                    {sortedCollections.map((collection) => (
                      <CollectionRow
                        key={collection.orderId}
                        collection={collection}
                        currency={currency}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default CODReconciliationSummary;
