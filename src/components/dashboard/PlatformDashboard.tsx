/**
 * PlatformDashboard - Dashboard component for platform-level analytics
 * 
 * This component displays:
 * - Metrics cards with trend indicators
 * - Filter controls for platform/restaurant/branch/date
 * - Real-time data updates
 * 
 * @see Requirements: 6.6, 6.7, 6.8, 6.9
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Phone,
  ShoppingCart,
  PhoneMissed,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  Filter,
  Calendar,
  Building2,
  Store,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { formatMoney, type CurrencyCode } from '@/lib/region';
import {
  AnalyticsService,
  createAnalyticsService,
  DashboardMetrics,
  MetricsTrend,
  TimePeriod,
  CallData,
  OrderData,
  getDateRange,
} from '@/lib/analytics';

// ============================================================================
// Types
// ============================================================================

export interface PlatformDashboardProps {
  /** Call data for analytics */
  calls: CallData[];
  /** Order data for analytics */
  orders: OrderData[];
  /** Available platforms for filtering */
  platforms?: Array<{ id: string; name: string }>;
  /** Available restaurants for filtering */
  restaurants?: Array<{ id: string; name: string; platformId?: string }>;
  /** Available branches for filtering */
  branches?: Array<{ id: string; name: string; restaurantId: string }>;
  /** Optional class name */
  className?: string;
}

interface FilterState {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
  period: TimePeriod;
  customStartDate?: string;
  customEndDate?: string;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Metric card component
 */
function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  format = 'number',
  iconColor = 'text-white/60',
  currency = 'NGN',
}: {
  title: string;
  value: number;
  change?: number;
  icon: React.ElementType;
  format?: 'number' | 'currency' | 'percentage' | 'duration';
  iconColor?: string;
  currency?: CurrencyCode;
}) {
  const formattedValue = useMemo(() => {
    switch (format) {
      case 'currency':
        return formatMoney(value, currency);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'duration':
        const minutes = Math.floor(value / 60);
        const seconds = value % 60;
        return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      default:
        return value.toLocaleString();
    }
  }, [value, format, currency]);

  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="card p-6 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-white/60 text-minimal mb-1">{title}</p>
          <p className="text-2xl font-semibold text-white">{formattedValue}</p>
          
          {change !== undefined && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-sm",
              isPositive && "text-emerald-400",
              isNegative && "text-red-400",
              !isPositive && !isNegative && "text-white/40"
            )}>
              {isPositive && <TrendingUp size={14} />}
              {isNegative && <TrendingDown size={14} />}
              <span>{Math.abs(change).toFixed(1)}%</span>
              <span className="text-white/40 text-minimal">vs prev</span>
            </div>
          )}
        </div>
        
        <div className={cn("p-3 rounded-lg bg-white/5", iconColor)}>
          <Icon size={24} />
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


// ============================================================================
// Main Component
// ============================================================================

/**
 * PlatformDashboard - Main dashboard component
 * 
 * @see Requirements: 6.6, 6.7, 6.8, 6.9
 */
export function PlatformDashboard({
  calls,
  orders,
  platforms = [],
  restaurants = [],
  branches = [],
  className,
}: PlatformDashboardProps) {
  const [filters, setFilters] = useState<FilterState>({
    period: 'last7days',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Revenue metrics follow the tenant's currency (US → USD, NG → NGN).
  const { currency } = useCurrency();

  const analyticsService = useMemo(() => createAnalyticsService(), []);

  // Filter restaurants based on selected platform
  const filteredRestaurants = useMemo(() => {
    if (!filters.platformId) return restaurants;
    return restaurants.filter(r => r.platformId === filters.platformId);
  }, [restaurants, filters.platformId]);

  // Filter branches based on selected restaurant
  const filteredBranches = useMemo(() => {
    if (!filters.restaurantId) return branches;
    return branches.filter(b => b.restaurantId === filters.restaurantId);
  }, [branches, filters.restaurantId]);

  // Calculate metrics with trends
  const metrics = useMemo<MetricsTrend>(() => {
    return analyticsService.getMetricsForPeriod(
      calls,
      orders,
      filters.period,
      {
        platformId: filters.platformId,
        restaurantId: filters.restaurantId,
        branchId: filters.branchId,
      }
    );
  }, [analyticsService, calls, orders, filters]);

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

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-white/60 text-minimal mt-1">
            Overview of your platform performance
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            
            <FilterDropdown
              label="Business"
              value={filters.restaurantId}
              options={filteredRestaurants}
              onChange={(v) => handleFilterChange('restaurantId', v)}
              icon={Store}
              placeholder="All Businesses"
            />
            
            <FilterDropdown
              label="Branch"
              value={filters.branchId}
              options={filteredBranches}
              onChange={(v) => handleFilterChange('branchId', v)}
              icon={Store}
              placeholder="All Branches"
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

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Calls"
          value={metrics.current.totalCalls}
          change={metrics.changes.totalCalls}
          icon={Phone}
          iconColor="text-blue-400"
        />
        
        <MetricCard
          title="Total Orders"
          value={metrics.current.totalOrders}
          change={metrics.changes.totalOrders}
          icon={ShoppingCart}
          iconColor="text-emerald-400"
        />
        
        <MetricCard
          title="Missed Calls"
          value={metrics.current.missedCalls}
          change={metrics.changes.missedCalls}
          icon={PhoneMissed}
          iconColor="text-red-400"
        />
        
        <MetricCard
          title="Conversion Rate"
          value={metrics.current.conversionRate}
          change={metrics.changes.conversionRate}
          icon={TrendingUp}
          format="percentage"
          iconColor="text-purple-400"
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Revenue"
          value={metrics.current.totalRevenue}
          change={metrics.changes.totalRevenue}
          icon={DollarSign}
          format="currency"
          currency={currency}
          iconColor="text-emerald-400"
        />
        
        <MetricCard
          title="Avg Order Value"
          value={metrics.current.averageOrderValue}
          change={metrics.changes.averageOrderValue}
          icon={DollarSign}
          format="currency"
          currency={currency}
          iconColor="text-yellow-400"
        />
        
        <MetricCard
          title="Completed Orders"
          value={metrics.current.completedOrders}
          icon={CheckCircle}
          iconColor="text-emerald-400"
        />
        
        <MetricCard
          title="Cancelled Orders"
          value={metrics.current.cancelledOrders}
          icon={XCircle}
          iconColor="text-red-400"
        />
      </div>

      {/* Call Duration */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard
          title="Avg Call Duration"
          value={metrics.current.averageCallDuration}
          icon={Clock}
          format="duration"
          iconColor="text-blue-400"
        />
      </div>
    </div>
  );
}

export default PlatformDashboard;
