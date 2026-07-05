/**
 * UpsellAnalytics - Dashboard component for upsell/cross-sell analytics
 * 
 * This component displays:
 * - Total prompts delivered vs accepted (conversion rate)
 * - Revenue attributed to upsells
 * - Performance comparison between prompts (for A/B testing)
 * - Breakdown by trigger condition
 * 
 * @see Requirements: 24.7, 24.8
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Filter,
  Building2,
  Store,
  ChevronDown,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  ShoppingCart,
  Users,
  Tag,
  Award,
  BarChart3,
  Percent,
  ArrowUpDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

// ============================================================================
// Types
// ============================================================================

export interface UpsellAnalyticsProps {
  /** Restaurant ID for filtering */
  restaurantId: string;
  /** Optional branch ID for branch-specific analytics */
  branchId?: string;
  /** Available platforms for filtering */
  platforms?: Array<{ id: string; name: string }>;
  /** Available restaurants for filtering */
  restaurants?: Array<{ id: string; name: string; platformId?: string }>;
  /** Available branches for filtering */
  branches?: Array<{ id: string; name: string; restaurantId: string }>;
  /** Optional class name */
  className?: string;
}


type TimePeriod = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';
type TriggerCondition = 'order_total_below' | 'item_category' | 'time_of_day' | 'customer_history';
type SortField = 'delivered' | 'accepted' | 'acceptanceRate' | 'totalRevenue' | 'avgOrderValue';
type SortDirection = 'asc' | 'desc';

interface FilterState {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
  period: TimePeriod;
  triggerCondition?: TriggerCondition;
}

// ============================================================================
// Constants
// ============================================================================

const TRIGGER_ICONS: Record<TriggerCondition, React.ElementType> = {
  order_total_below: ShoppingCart,
  item_category: Tag,
  time_of_day: Clock,
  customer_history: Users,
};

const TRIGGER_LABELS: Record<TriggerCondition, string> = {
  order_total_below: 'Order Total Below',
  item_category: 'Item Category',
  time_of_day: 'Time of Day',
  customer_history: 'Customer History',
};

const TRIGGER_COLORS: Record<TriggerCondition, string> = {
  order_total_below: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  item_category: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  time_of_day: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  customer_history: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get date range from period
 */
function getDateRange(period: TimePeriod): { startDate: number; endDate: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (period) {
    case 'today':
      return { startDate: today.getTime(), endDate: now.getTime() };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { startDate: yesterday.getTime(), endDate: today.getTime() - 1 };
    }
    case 'last7days': {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { startDate: weekAgo.getTime(), endDate: now.getTime() };
    }
    case 'last30days': {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return { startDate: monthAgo.getTime(), endDate: now.getTime() };
    }
    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: monthStart.getTime(), endDate: now.getTime() };
    }
    case 'lastMonth': {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: lastMonthStart.getTime(), endDate: lastMonthEnd.getTime() };
    }
    default:
      return { startDate: 0, endDate: now.getTime() };
  }
}

/**
 * Format currency in Naira
 */
function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Get color class based on acceptance rate
 */
function getAcceptanceRateColor(rate: number): string {
  if (rate >= 30) return 'text-emerald-400';
  if (rate >= 15) return 'text-amber-400';
  return 'text-red-400';
}


// ============================================================================
// Sub-components
// ============================================================================

/**
 * Summary metric card component
 */
function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-white/60',
  trend,
  trendLabel,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
}) {
  return (
    <div className="card p-4 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-white/40 text-minimal mb-1">{title}</p>
          <p className="text-xl font-semibold text-white">{value}</p>
          {subtitle && (
            <p className="text-xs text-white/40 mt-1">{subtitle}</p>
          )}
          {trend && trendLabel && (
            <div className="flex items-center gap-1 mt-2">
              {trend === 'up' ? (
                <TrendingUp size={12} className="text-emerald-400" />
              ) : trend === 'down' ? (
                <TrendingDown size={12} className="text-red-400" />
              ) : null}
              <span className={cn(
                "text-xs",
                trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-white/40'
              )}>
                {trendLabel}
              </span>
            </div>
          )}
        </div>
        <div className={cn("p-2 rounded-lg bg-white/5", iconColor)}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

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
 * Trigger condition breakdown card
 */
function TriggerBreakdownCard({
  condition,
  stats,
}: {
  condition: string;
  stats: { delivered: number; accepted: number; declined: number; acceptanceRate: number };
}) {
  const triggerCondition = condition as TriggerCondition;
  const Icon = TRIGGER_ICONS[triggerCondition] || Tag;
  const label = TRIGGER_LABELS[triggerCondition] || condition;
  const colorClass = TRIGGER_COLORS[triggerCondition] || 'bg-white/10 text-white/60 border-white/20';

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("p-2 rounded-lg border", colorClass)}>
          <Icon size={18} />
        </div>
        <div>
          <h4 className="text-sm font-medium text-white">{label}</h4>
          <p className="text-xs text-white/40">{stats.delivered} delivered</p>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-white/5">
          <div className="flex items-center justify-center gap-1 mb-1">
            <CheckCircle size={12} className="text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">{stats.accepted}</span>
          </div>
          <p className="text-xs text-white/40">Accepted</p>
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          <div className="flex items-center justify-center gap-1 mb-1">
            <XCircle size={12} className="text-red-400" />
            <span className="text-sm font-medium text-red-400">{stats.declined}</span>
          </div>
          <p className="text-xs text-white/40">Declined</p>
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Percent size={12} className={getAcceptanceRateColor(stats.acceptanceRate)} />
            <span className={cn("text-sm font-medium", getAcceptanceRateColor(stats.acceptanceRate))}>
              {stats.acceptanceRate.toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-white/40">Rate</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Sortable table header component
 */
function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  align = 'left',
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const isActive = currentSort === field;
  
  return (
    <th
      className={cn(
        "p-4 text-xs font-medium text-white/40 uppercase tracking-wider cursor-pointer hover:text-white/60 transition-colors",
        align === 'right' && "text-right",
        align === 'center' && "text-center"
      )}
      onClick={() => onSort(field)}
    >
      <div className={cn(
        "flex items-center gap-1",
        align === 'right' && "justify-end",
        align === 'center' && "justify-center"
      )}>
        <span>{label}</span>
        {isActive ? (
          currentDirection === 'asc' ? (
            <ChevronUp size={14} className="text-emerald-400" />
          ) : (
            <ChevronDown size={14} className="text-emerald-400" />
          )
        ) : (
          <ArrowUpDown size={14} className="opacity-50" />
        )}
      </div>
    </th>
  );
}


/**
 * A/B Test comparison row component
 */
function PromptComparisonRow({
  prompt,
  rank,
  isBestPerformer,
}: {
  prompt: {
    promptId: string;
    promptText: string;
    triggerCondition: string;
    triggerValue: string;
    isActive: boolean;
    metrics: {
      delivered: number;
      accepted: number;
      declined: number;
      acceptanceRate: number;
      totalRevenue: number;
      avgOrderValue: number;
    };
    isStatisticallySignificant: boolean;
  };
  rank: number;
  isBestPerformer: boolean;
}) {
  const triggerCondition = prompt.triggerCondition as TriggerCondition;
  const Icon = TRIGGER_ICONS[triggerCondition] || Tag;
  
  return (
    <tr className={cn(
      "border-b border-white/5 hover:bg-white/5 transition-colors",
      isBestPerformer && "bg-emerald-500/5"
    )}>
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border",
            rank === 1 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
            rank === 2 ? "bg-slate-400/20 text-slate-300 border-slate-400/30" :
            rank === 3 ? "bg-orange-600/20 text-orange-400 border-orange-600/30" :
            "bg-white/5 text-white/60 border-white/10"
          )}>
            {rank}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate max-w-xs" title={prompt.promptText}>
              {prompt.promptText.length > 60 
                ? `${prompt.promptText.substring(0, 60)}...` 
                : prompt.promptText}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-white/40 text-xs">
                <Icon size={10} />
                {TRIGGER_LABELS[triggerCondition] || prompt.triggerCondition}
              </span>
              {!prompt.isActive && (
                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-xs">
                  Inactive
                </span>
              )}
              {isBestPerformer && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs">
                  <Award size={10} />
                  Best
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm font-medium text-white">{prompt.metrics.delivered}</span>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm font-medium text-emerald-400">{prompt.metrics.accepted}</span>
      </td>
      <td className="p-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className={cn(
            "text-sm font-medium",
            getAcceptanceRateColor(prompt.metrics.acceptanceRate)
          )}>
            {prompt.metrics.acceptanceRate.toFixed(1)}%
          </span>
          {!prompt.isStatisticallySignificant && (
            <span className="text-xs text-white/30" title="Less than 30 deliveries - results may not be statistically significant">
              *
            </span>
          )}
        </div>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm font-medium text-white">
          {formatNaira(prompt.metrics.totalRevenue)}
        </span>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm text-white/60">
          {formatNaira(prompt.metrics.avgOrderValue)}
        </span>
      </td>
    </tr>
  );
}


// ============================================================================
// Main Component
// ============================================================================

/**
 * UpsellAnalytics - Main upsell analytics dashboard component
 * 
 * Displays upsell revenue attribution and A/B testing performance data.
 * 
 * @see Requirements: 24.7, 24.8
 */
export function UpsellAnalytics({
  restaurantId,
  branchId: initialBranchId,
  platforms = [],
  restaurants = [],
  branches = [],
  className,
}: UpsellAnalyticsProps) {
  const [filters, setFilters] = useState<FilterState>({
    period: 'last30days',
    branchId: initialBranchId,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<SortField>('acceptanceRate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Calculate date range from period
  const dateRange = useMemo(() => getDateRange(filters.period), [filters.period]);

  // Convex queries
  const promptAnalytics = useQuery(api.prompts.getPromptAnalytics, {
    restaurantId,
    branchId: filters.branchId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const revenueAttribution = useQuery(api.prompts.getUpsellRevenueAttribution, {
    restaurantId,
    branchId: filters.branchId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const abTestComparison = useQuery(api.prompts.getPromptABTestComparison, {
    restaurantId,
    branchId: filters.branchId,
    triggerCondition: filters.triggerCondition,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  // Filter restaurants based on selected platform
  const filteredRestaurants = useMemo(() => {
    if (!filters.platformId) return restaurants;
    return restaurants.filter(r => r.platformId === filters.platformId);
  }, [restaurants, filters.platformId]);

  // Filter branches based on selected restaurant
  const filteredBranches = useMemo(() => {
    return branches.filter(b => b.restaurantId === restaurantId);
  }, [branches, restaurantId]);

  // Sort comparisons
  const sortedComparisons = useMemo(() => {
    if (!abTestComparison?.comparisons) return [];
    
    return [...abTestComparison.comparisons].sort((a, b) => {
      let aValue: number;
      let bValue: number;
      
      switch (sortField) {
        case 'delivered':
          aValue = a.metrics.delivered;
          bValue = b.metrics.delivered;
          break;
        case 'accepted':
          aValue = a.metrics.accepted;
          bValue = b.metrics.accepted;
          break;
        case 'acceptanceRate':
          aValue = a.metrics.acceptanceRate;
          bValue = b.metrics.acceptanceRate;
          break;
        case 'totalRevenue':
          aValue = a.metrics.totalRevenue;
          bValue = b.metrics.totalRevenue;
          break;
        case 'avgOrderValue':
          aValue = a.metrics.avgOrderValue;
          bValue = b.metrics.avgOrderValue;
          break;
        default:
          aValue = a.metrics.acceptanceRate;
          bValue = b.metrics.acceptanceRate;
      }
      
      const multiplier = sortDirection === 'asc' ? 1 : -1;
      return (aValue - bValue) * multiplier;
    });
  }, [abTestComparison?.comparisons, sortField, sortDirection]);

  // Handle filter changes
  const handleFilterChange = useCallback((key: keyof FilterState, value: string | undefined) => {
    setFilters(prev => {
      const newFilters = { ...prev, [key]: value };
      
      // Clear dependent filters
      if (key === 'platformId') {
        newFilters.restaurantId = undefined;
        newFilters.branchId = undefined;
      } else if (key === 'restaurantId') {
        newFilters.branchId = undefined;
      }
      
      return newFilters;
    });
  }, []);

  const handlePeriodChange = useCallback((period: TimePeriod) => {
    setFilters(prev => ({ ...prev, period }));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        return field;
      }
      setSortDirection('desc');
      return field;
    });
  }, []);

  // Loading state
  const isLoading = promptAnalytics === undefined || revenueAttribution === undefined;

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-500" />
            <p className="text-white/60 text-sm">Loading analytics...</p>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Upsell Analytics</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Track upsell performance and revenue attribution
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms.length > 0 && (
              <FilterDropdown
                label="Platform"
                value={filters.platformId}
                options={platforms}
                onChange={(v) => handleFilterChange('platformId', v)}
                icon={Building2}
                placeholder="All Platforms"
              />
            )}
            
            {filteredRestaurants.length > 1 && (
              <FilterDropdown
                label="Restaurant"
                value={filters.restaurantId}
                options={filteredRestaurants}
                onChange={(v) => handleFilterChange('restaurantId', v)}
                icon={Store}
                placeholder="All Restaurants"
              />
            )}
            
            {filteredBranches.length > 0 && (
              <FilterDropdown
                label="Branch"
                value={filters.branchId}
                options={filteredBranches}
                onChange={(v) => handleFilterChange('branchId', v)}
                icon={Store}
                placeholder="All Branches"
              />
            )}
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          title="Prompts Delivered"
          value={promptAnalytics?.summary.totalDelivered || 0}
          icon={MessageSquare}
          iconColor="text-blue-400"
        />
        <MetricCard
          title="Accepted"
          value={promptAnalytics?.summary.totalAccepted || 0}
          icon={CheckCircle}
          iconColor="text-emerald-400"
        />
        <MetricCard
          title="Acceptance Rate"
          value={`${(promptAnalytics?.summary.overallAcceptanceRate || 0).toFixed(1)}%`}
          icon={Target}
          iconColor="text-purple-400"
        />
        <MetricCard
          title="Upsell Revenue"
          value={formatNaira(revenueAttribution?.summary.upsellRevenue || 0)}
          icon={DollarSign}
          iconColor="text-amber-400"
          subtitle={`${(revenueAttribution?.summary.upsellRevenuePercentage || 0).toFixed(1)}% of total`}
        />
        <MetricCard
          title="Avg Order (w/ Upsell)"
          value={formatNaira(revenueAttribution?.summary.avgOrderValueWithUpsell || 0)}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          trend={revenueAttribution?.summary.upsellImpact && revenueAttribution.summary.upsellImpact > 0 ? 'up' : 'neutral'}
          trendLabel={revenueAttribution?.summary.upsellImpact 
            ? `+${formatNaira(revenueAttribution.summary.upsellImpact)} vs without`
            : undefined}
        />
        <MetricCard
          title="Upsell Impact"
          value={`+${(revenueAttribution?.summary.upsellImpactPercentage || 0).toFixed(1)}%`}
          icon={BarChart3}
          iconColor="text-cyan-400"
          subtitle="Higher order value"
        />
      </div>

      {/* Trigger Condition Breakdown */}
      {promptAnalytics?.byTriggerCondition && Object.keys(promptAnalytics.byTriggerCondition).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Performance by Trigger Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(promptAnalytics.byTriggerCondition).map(([condition, stats]) => (
              <TriggerBreakdownCard
                key={condition}
                condition={condition}
                stats={stats as { delivered: number; accepted: number; declined: number; acceptanceRate: number }}
              />
            ))}
          </div>
        </div>
      )}


      {/* A/B Test Comparison Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium text-white">Prompt Performance Comparison</h2>
              <p className="text-sm text-white/40 mt-1">
                Compare prompt variations to identify best performers (A/B testing)
              </p>
            </div>
            
            {/* Trigger condition filter for A/B testing */}
            <div className="relative min-w-[180px]">
              <select
                value={filters.triggerCondition || ''}
                onChange={(e) => handleFilterChange('triggerCondition', e.target.value || undefined)}
                className="input-dark w-full pr-8 py-2 rounded-lg appearance-none cursor-pointer text-sm"
              >
                <option value="">All Trigger Types</option>
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
            </div>
          </div>
        </div>
        
        {sortedComparisons.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Prompt
                  </th>
                  <SortableHeader
                    label="Delivered"
                    field="delivered"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableHeader
                    label="Accepted"
                    field="accepted"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableHeader
                    label="Rate"
                    field="acceptanceRate"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableHeader
                    label="Revenue"
                    field="totalRevenue"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableHeader
                    label="Avg Order"
                    field="avgOrderValue"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedComparisons.map((prompt, index) => (
                  <PromptComparisonRow
                    key={prompt.promptId}
                    prompt={prompt}
                    rank={index + 1}
                    isBestPerformer={abTestComparison?.bestPerformer?.promptId === prompt.promptId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 text-white/20 mx-auto mb-4" />
            <p className="text-white/60">No prompt data available</p>
            <p className="text-white/40 text-sm mt-1">
              Create prompts and start delivering them to see performance data
            </p>
          </div>
        )}
        
        {/* Statistical significance note */}
        {sortedComparisons.some(p => !p.isStatisticallySignificant) && (
          <div className="p-4 border-t border-white/10 bg-white/5">
            <p className="text-xs text-white/40">
              <span className="text-white/60">*</span> Prompts with less than 30 deliveries may not have statistically significant results.
              Continue testing to gather more data for reliable comparisons.
            </p>
          </div>
        )}
      </div>


      {/* Revenue Attribution by Trigger */}
      {revenueAttribution?.revenueByTrigger && revenueAttribution.revenueByTrigger.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-medium text-white">Revenue by Trigger Type</h2>
            <p className="text-sm text-white/40 mt-1">
              See which trigger conditions generate the most revenue
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Trigger Type
                  </th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Accepted
                  </th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Total Revenue
                  </th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Avg Order Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {revenueAttribution.revenueByTrigger.map((item: { triggerCondition: string; acceptedCount: number; totalRevenue: number; avgOrderValue: number }) => {
                  const triggerCondition = item.triggerCondition as TriggerCondition;
                  const Icon = TRIGGER_ICONS[triggerCondition] || Tag;
                  const label = TRIGGER_LABELS[triggerCondition] || item.triggerCondition;
                  const colorClass = TRIGGER_COLORS[triggerCondition] || 'bg-white/10 text-white/60 border-white/20';
                  
                  return (
                    <tr key={item.triggerCondition} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg border", colorClass)}>
                            <Icon size={16} />
                          </div>
                          <span className="text-sm text-white">{label}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm font-medium text-emerald-400">{item.acceptedCount}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm font-medium text-white">{formatNaira(item.totalRevenue)}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm text-white/60">{formatNaira(item.avgOrderValue)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights Card */}
      {revenueAttribution && promptAnalytics && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-400" />
            Key Insights
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {revenueAttribution.summary.upsellImpactPercentage > 0 && (
              <div className="flex items-start gap-2">
                <TrendingUp size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <p className="text-white/60">
                  Orders with accepted upsells have{' '}
                  <span className="text-emerald-400 font-medium">
                    {revenueAttribution.summary.upsellImpactPercentage.toFixed(1)}% higher
                  </span>{' '}
                  average value
                </p>
              </div>
            )}
            {promptAnalytics.summary.overallAcceptanceRate > 0 && (
              <div className="flex items-start gap-2">
                <Target size={16} className="text-purple-400 mt-0.5 flex-shrink-0" />
                <p className="text-white/60">
                  <span className="text-purple-400 font-medium">
                    {promptAnalytics.summary.overallAcceptanceRate.toFixed(1)}%
                  </span>{' '}
                  of customers accept upsell suggestions
                </p>
              </div>
            )}
            {abTestComparison?.bestPerformer && (
              <div className="flex items-start gap-2">
                <Award size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-white/60">
                  Best performing prompt has{' '}
                  <span className="text-amber-400 font-medium">
                    {abTestComparison.bestPerformer.metrics.acceptanceRate.toFixed(1)}%
                  </span>{' '}
                  acceptance rate
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default UpsellAnalytics;
