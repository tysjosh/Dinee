/**
 * RoutingAnalytics - Dashboard component for order routing analytics
 * 
 * This component displays:
 * - Routing distribution across branches (pie/bar chart visualization)
 * - Routing reason breakdown
 * - Customer location confidence metrics
 * - Filter controls for time period and restaurant
 * 
 * @see Requirements: 27.7, 27.8
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  MapPin,
  Building2,
  Store,
  ChevronDown,
  Filter,
  TrendingUp,
  Navigation,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimePeriod, getDateRange } from '@/lib/analytics';

// ============================================================================
// Types
// ============================================================================

/**
 * Routing reason types matching the OrderRoutingService
 */
export type RoutingReason =
  | 'nearest_branch'
  | 'same_city'
  | 'same_state'
  | 'fallback_any_active'
  | 'customer_selected'
  | 'only_branch_available';

/**
 * Routing decision stored in order record
 * @see Requirements: 27.7
 */
export interface RoutingDecisionData {
  selectedBranchId: string;
  selectedBranchName: string;
  reason: RoutingReason;
  customerLocation?: {
    city?: string;
    state?: string;
    areaCode: string;
    confidence: 'high' | 'medium' | 'low';
  };
  timestamp: number;
  warnings?: string[];
}

/**
 * Order data with routing decision
 */
export interface OrderWithRouting {
  orderId: string;
  restaurantId: string;
  branchId?: string;
  orderPlacementTime?: number;
  routingDecision?: RoutingDecisionData;
}

export interface RoutingAnalyticsProps {
  /** Orders with routing decisions */
  orders: OrderWithRouting[];
  /** Available restaurants for filtering */
  restaurants?: Array<{ id: string; name: string }>;
  /** Available branches for filtering */
  branches?: Array<{ id: string; name: string; restaurantId: string }>;
  /** Optional class name */
  className?: string;
}

interface FilterState {
  restaurantId?: string;
  period: TimePeriod;
}

/**
 * Branch distribution data
 */
interface BranchDistribution {
  branchId: string;
  branchName: string;
  orderCount: number;
  percentage: number;
}

/**
 * Routing reason distribution data
 */
interface ReasonDistribution {
  reason: RoutingReason;
  count: number;
  percentage: number;
}

/**
 * Location confidence distribution
 */
interface ConfidenceDistribution {
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  count: number;
  percentage: number;
}

// ============================================================================
// Constants
// ============================================================================

const REASON_LABELS: Record<RoutingReason, string> = {
  nearest_branch: 'Nearest Branch',
  same_city: 'Same City',
  same_state: 'Same State',
  fallback_any_active: 'Fallback (Any Active)',
  customer_selected: 'Customer Selected',
  only_branch_available: 'Only Branch Available',
};

const REASON_ICONS: Record<RoutingReason, React.ElementType> = {
  nearest_branch: Navigation,
  same_city: MapPin,
  same_state: MapPin,
  fallback_any_active: AlertTriangle,
  customer_selected: CheckCircle,
  only_branch_available: Store,
};

const REASON_COLORS: Record<RoutingReason, string> = {
  nearest_branch: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  same_city: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  same_state: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  fallback_any_active: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  customer_selected: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  only_branch_available: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/20 text-emerald-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-red-500/20 text-red-400',
  unknown: 'bg-gray-500/20 text-gray-400',
};

const BRANCH_COLORS = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-orange-500',
];

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Filter dropdown component
 */
function FilterDropdown({
  label,
  value,
  options,
  onChange,
  icon: Icon,
  placeholder = 'All',
}: {
  label: string;
  value?: string;
  options: Array<{ id: string; name: string }>;
  onChange: (value?: string) => void;
  icon: React.ElementType;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <label className="block text-xs text-white/40 mb-1 text-minimal">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="input-dark w-full pl-10 pr-8 py-2 rounded-lg appearance-none cursor-pointer text-sm"
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
      </div>
    </div>
  );
}

/**
 * Period selector component
 */
function PeriodSelector({
  value,
  onChange,
}: {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
}) {
  const periods: Array<{ value: TimePeriod; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last7days', label: 'Last 7 Days' },
    { value: 'last30days', label: 'Last 30 Days' },
    { value: 'thisMonth', label: 'This Month' },
    { value: 'lastMonth', label: 'Last Month' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm transition-colors",
            value === period.value
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-white/5 text-white/60 hover:bg-white/10 border border-transparent"
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Summary metric card
 */
function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-white/60',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  iconColor?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-lg bg-white/5", iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-white/40 text-minimal">{title}</p>
          <p className="text-xl font-semibold text-white">{value}</p>
          {subtitle && (
            <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Branch distribution bar chart
 */
function BranchDistributionChart({
  distribution,
}: {
  distribution: BranchDistribution[];
}) {
  if (distribution.length === 0) {
    return (
      <div className="text-center py-8">
        <Store className="h-12 w-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/60">No routing data available</p>
      </div>
    );
  }

  const maxCount = Math.max(...distribution.map(d => d.orderCount), 1);

  return (
    <div className="space-y-3">
      {distribution.map((item, index) => (
        <div key={item.branchId} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white truncate max-w-[200px]" title={item.branchName}>
              {item.branchName}
            </span>
            <span className="text-white/60 ml-2">
              {item.orderCount.toLocaleString()} ({item.percentage.toFixed(1)}%)
            </span>
          </div>
          <div className="h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                BRANCH_COLORS[index % BRANCH_COLORS.length]
              )}
              style={{ width: `${(item.orderCount / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Routing reason breakdown
 */
function ReasonBreakdown({
  distribution,
}: {
  distribution: ReasonDistribution[];
}) {
  if (distribution.length === 0) {
    return (
      <div className="text-center py-8">
        <Navigation className="h-12 w-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/60">No routing reasons recorded</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {distribution.map((item) => {
        const Icon = REASON_ICONS[item.reason];
        const colorClass = REASON_COLORS[item.reason];
        
        return (
          <div
            key={item.reason}
            className={cn(
              "p-3 rounded-lg border flex items-center gap-3",
              colorClass
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {REASON_LABELS[item.reason]}
              </p>
              <p className="text-xs opacity-80">
                {item.count.toLocaleString()} orders ({item.percentage.toFixed(1)}%)
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Location confidence breakdown
 */
function ConfidenceBreakdown({
  distribution,
}: {
  distribution: ConfidenceDistribution[];
}) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  
  if (total === 0) {
    return (
      <div className="text-center py-8">
        <HelpCircle className="h-12 w-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/60">No location data available</p>
      </div>
    );
  }

  const confidenceLabels: Record<string, string> = {
    high: 'High Confidence',
    medium: 'Medium Confidence',
    low: 'Low Confidence',
    unknown: 'Unknown Location',
  };

  return (
    <div className="space-y-4">
      {/* Stacked bar visualization */}
      <div className="h-4 bg-white/5 rounded-full overflow-hidden flex">
        {distribution.map((item) => (
          item.count > 0 && (
            <div
              key={item.confidence}
              className={cn(
                "h-full transition-all duration-500",
                item.confidence === 'high' && "bg-emerald-500",
                item.confidence === 'medium' && "bg-amber-500",
                item.confidence === 'low' && "bg-red-500",
                item.confidence === 'unknown' && "bg-gray-500"
              )}
              style={{ width: `${item.percentage}%` }}
              title={`${confidenceLabels[item.confidence]}: ${item.count} (${item.percentage.toFixed(1)}%)`}
            />
          )
        ))}
      </div>
      
      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {distribution.map((item) => (
          <div
            key={item.confidence}
            className={cn(
              "p-2 rounded-lg text-center",
              CONFIDENCE_COLORS[item.confidence]
            )}
          >
            <p className="text-lg font-semibold">{item.count.toLocaleString()}</p>
            <p className="text-xs opacity-80">{confidenceLabels[item.confidence]}</p>
            <p className="text-xs opacity-60">{item.percentage.toFixed(1)}%</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * RoutingAnalytics - Main routing analytics dashboard component
 * 
 * Displays routing distribution across branches and stores routing decision in order record.
 * 
 * @see Requirements: 27.7, 27.8
 */
export function RoutingAnalytics({
  orders,
  restaurants = [],
  branches = [],
  className,
}: RoutingAnalyticsProps) {
  const [filters, setFilters] = useState<FilterState>({
    period: 'last7days',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Filter branches based on selected restaurant
  const filteredBranches = useMemo(() => {
    if (!filters.restaurantId) return branches;
    return branches.filter(b => b.restaurantId === filters.restaurantId);
  }, [branches, filters.restaurantId]);

  // Filter orders by time period and restaurant
  const filteredOrders = useMemo(() => {
    const { startDate, endDate } = getDateRange(filters.period);
    
    return orders.filter(order => {
      // Filter by time period
      const orderTime = order.orderPlacementTime || 0;
      if (orderTime < startDate || orderTime > endDate) {
        return false;
      }
      
      // Filter by restaurant
      if (filters.restaurantId && order.restaurantId !== filters.restaurantId) {
        return false;
      }
      
      return true;
    });
  }, [orders, filters]);

  // Orders with routing decisions
  const ordersWithRouting = useMemo(() => {
    return filteredOrders.filter(o => o.routingDecision);
  }, [filteredOrders]);

  // Calculate branch distribution
  const branchDistribution = useMemo<BranchDistribution[]>(() => {
    const branchCounts = new Map<string, { name: string; count: number }>();
    
    ordersWithRouting.forEach(order => {
      if (order.routingDecision) {
        const { selectedBranchId, selectedBranchName } = order.routingDecision;
        const existing = branchCounts.get(selectedBranchId);
        if (existing) {
          existing.count++;
        } else {
          branchCounts.set(selectedBranchId, {
            name: selectedBranchName,
            count: 1,
          });
        }
      }
    });
    
    const total = ordersWithRouting.length;
    const distribution: BranchDistribution[] = [];
    
    branchCounts.forEach((value, branchId) => {
      distribution.push({
        branchId,
        branchName: value.name,
        orderCount: value.count,
        percentage: total > 0 ? (value.count / total) * 100 : 0,
      });
    });
    
    // Sort by order count descending
    return distribution.sort((a, b) => b.orderCount - a.orderCount);
  }, [ordersWithRouting]);

  // Calculate routing reason distribution
  const reasonDistribution = useMemo<ReasonDistribution[]>(() => {
    const reasonCounts = new Map<RoutingReason, number>();
    
    ordersWithRouting.forEach(order => {
      if (order.routingDecision) {
        const reason = order.routingDecision.reason;
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
    });
    
    const total = ordersWithRouting.length;
    const distribution: ReasonDistribution[] = [];
    
    reasonCounts.forEach((count, reason) => {
      distribution.push({
        reason,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      });
    });
    
    // Sort by count descending
    return distribution.sort((a, b) => b.count - a.count);
  }, [ordersWithRouting]);

  // Calculate location confidence distribution
  const confidenceDistribution = useMemo<ConfidenceDistribution[]>(() => {
    const confidenceCounts: Record<string, number> = {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };
    
    ordersWithRouting.forEach(order => {
      if (order.routingDecision?.customerLocation) {
        const confidence = order.routingDecision.customerLocation.confidence;
        confidenceCounts[confidence]++;
      } else {
        confidenceCounts.unknown++;
      }
    });
    
    const total = ordersWithRouting.length;
    
    return (['high', 'medium', 'low', 'unknown'] as const).map(confidence => ({
      confidence,
      count: confidenceCounts[confidence],
      percentage: total > 0 ? (confidenceCounts[confidence] / total) * 100 : 0,
    }));
  }, [ordersWithRouting]);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const routedOrders = ordersWithRouting.length;
    const routingCoverage = totalOrders > 0 ? (routedOrders / totalOrders) * 100 : 0;
    
    // Count orders with warnings
    const ordersWithWarnings = ordersWithRouting.filter(
      o => o.routingDecision?.warnings && o.routingDecision.warnings.length > 0
    ).length;
    
    // Most common routing reason
    const topReason = reasonDistribution[0];
    
    return {
      totalOrders,
      routedOrders,
      routingCoverage,
      ordersWithWarnings,
      topReason,
      branchCount: branchDistribution.length,
    };
  }, [filteredOrders, ordersWithRouting, reasonDistribution, branchDistribution]);

  // Handle filter changes
  const handleFilterChange = useCallback((key: keyof FilterState, value: string | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePeriodChange = useCallback((period: TimePeriod) => {
    setFilters(prev => ({ ...prev, period }));
  }, []);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Navigation className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Routing Analytics</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Order routing distribution across branches
          </p>
        </div>
        
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
            showFilters
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-white/5 text-white/60 hover:bg-white/10"
          )}
        >
          <Filter size={16} />
          <span className="text-minimal">Filters</span>
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilterDropdown
              label="Business"
              value={filters.restaurantId}
              options={restaurants}
              onChange={(v) => handleFilterChange('restaurantId', v)}
              icon={Store}
              placeholder="All Businesses"
            />
          </div>
          
          <div>
            <label className="block text-xs text-white/40 mb-2 text-minimal">Time Period</label>
            <PeriodSelector
              value={filters.period}
              onChange={handlePeriodChange}
            />
          </div>
        </div>
      )}

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Orders"
          value={summaryMetrics.totalOrders.toLocaleString()}
          subtitle="In selected period"
          icon={BarChart3}
          iconColor="text-blue-400"
        />
        
        <MetricCard
          title="Routed Orders"
          value={summaryMetrics.routedOrders.toLocaleString()}
          subtitle={`${summaryMetrics.routingCoverage.toFixed(1)}% coverage`}
          icon={Navigation}
          iconColor="text-emerald-400"
        />
        
        <MetricCard
          title="Branches Used"
          value={summaryMetrics.branchCount}
          subtitle="Active routing destinations"
          icon={Building2}
          iconColor="text-purple-400"
        />
        
        <MetricCard
          title="Routing Warnings"
          value={summaryMetrics.ordersWithWarnings.toLocaleString()}
          subtitle="Orders with routing issues"
          icon={AlertTriangle}
          iconColor={summaryMetrics.ordersWithWarnings > 0 ? "text-amber-400" : "text-white/40"}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch Distribution */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Store className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-medium text-white">Branch Distribution</h2>
          </div>
          <p className="text-sm text-white/60 mb-4">
            Orders routed to each branch
          </p>
          <BranchDistributionChart distribution={branchDistribution} />
        </div>

        {/* Routing Reasons */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-medium text-white">Routing Reasons</h2>
          </div>
          <p className="text-sm text-white/60 mb-4">
            Why orders were routed to specific branches
          </p>
          <ReasonBreakdown distribution={reasonDistribution} />
        </div>
      </div>

      {/* Location Confidence */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-medium text-white">Location Detection Confidence</h2>
        </div>
        <p className="text-sm text-white/60 mb-4">
          Accuracy of customer location detection from phone numbers
        </p>
        <ConfidenceBreakdown distribution={confidenceDistribution} />
      </div>

      {/* Detailed Table */}
      {branchDistribution.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-medium text-white">Branch Routing Details</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Branch</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Orders</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Percentage</th>
                  <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {branchDistribution.map((item, index) => (
                  <tr 
                    key={item.branchId}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-3 h-3 rounded-full",
                          BRANCH_COLORS[index % BRANCH_COLORS.length]
                        )} />
                        <span className="text-sm text-white">{item.branchName}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="text-sm font-medium text-white">
                        {item.orderCount.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <span className="text-sm text-white/60">
                        {item.percentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            BRANCH_COLORS[index % BRANCH_COLORS.length]
                          )}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {ordersWithRouting.length === 0 && (
        <div className="card p-12 text-center">
          <Navigation className="h-16 w-16 text-white/20 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No Routing Data Available</h3>
          <p className="text-white/60 max-w-md mx-auto">
            Routing analytics will appear here once orders are processed through the multi-location routing system.
            Make sure orders include routing decisions when created.
          </p>
        </div>
      )}
    </div>
  );
}

export default RoutingAnalytics;
