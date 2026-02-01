/**
 * FunnelAnalytics - Dashboard component for order funnel analytics
 * 
 * This component displays:
 * - Visual funnel chart showing stage progression
 * - Conversion rates between stages
 * - Drop-off counts highlighted
 * - Average time at each stage
 * - Filter controls for segmentation
 * - Highlights stage with highest drop-off rate
 * 
 * @see Requirements: 22.4, 22.5, 22.6, 22.7
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  TrendingDown,
  TrendingUp,
  Clock,
  AlertTriangle,
  Filter,
  Building2,
  Store,
  ChevronDown,
  CreditCard,
  Phone,
  ShoppingCart,
  Wallet,
  CheckCircle,
  Truck,
  ArrowDown,
  BarChart3,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AnalyticsService,
  createAnalyticsService,
  FunnelStage,
  FunnelStageName,
  TimePeriod,
  CallData,
  OrderData,
  getDateRange,
} from '@/lib/analytics';
import { ExportService, createExportService } from '@/lib/analytics/ExportService';

// ============================================================================
// Types
// ============================================================================

export interface FunnelAnalyticsProps {
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
  paymentMethod?: 'paystack' | 'flutterwave' | 'cod' | 'all';
}

type PaymentMethodFilter = 'paystack' | 'flutterwave' | 'cod' | 'all';

// ============================================================================
// Constants
// ============================================================================

const STAGE_ICONS: Record<FunnelStageName, React.ElementType> = {
  call_started: Phone,
  order_initiated: ShoppingCart,
  payment_started: Wallet,
  payment_completed: CheckCircle,
  delivery_completed: Truck,
};

const STAGE_LABELS: Record<FunnelStageName, string> = {
  call_started: 'Calls Started',
  order_initiated: 'Orders Initiated',
  payment_started: 'Payment Started',
  payment_completed: 'Payment Completed',
  delivery_completed: 'Delivery Completed',
};

const STAGE_COLORS: Record<FunnelStageName, string> = {
  call_started: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  order_initiated: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  payment_started: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  payment_completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  delivery_completed: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const PAYMENT_METHODS: Array<{ value: PaymentMethodFilter; label: string }> = [
  { value: 'all', label: 'All Methods' },
  { value: 'paystack', label: 'Paystack' },
  { value: 'flutterwave', label: 'Flutterwave' },
  { value: 'cod', label: 'Cash on Delivery' },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format time duration in human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds === 0) return '-';
  
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Calculate funnel bar width percentage based on count
 */
function calculateBarWidth(count: number, maxCount: number): number {
  if (maxCount === 0) return 0;
  return Math.max(10, (count / maxCount) * 100);
}

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
 * Payment method filter component
 */
function PaymentMethodFilter({
  value,
  onChange,
}: {
  value: PaymentMethodFilter;
  onChange: (method: PaymentMethodFilter) => void;
}) {
  return (
    <div className="relative">
      <label className="block text-xs text-white/40 mb-1 text-minimal">Payment Method</label>
      <div className="relative">
        <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as PaymentMethodFilter)}
          className="input-dark w-full pl-10 pr-8 py-2 rounded-lg appearance-none cursor-pointer text-sm"
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
      </div>
    </div>
  );
}

/**
 * Funnel stage card component
 */
function FunnelStageCard({
  stage,
  maxCount,
  isHighestDropOff,
  isFirst,
}: {
  stage: FunnelStage;
  maxCount: number;
  isHighestDropOff: boolean;
  isFirst: boolean;
}) {
  const Icon = STAGE_ICONS[stage.name];
  const label = STAGE_LABELS[stage.name];
  const colorClass = STAGE_COLORS[stage.name];
  const barWidth = calculateBarWidth(stage.count, maxCount);

  return (
    <div className="relative">
      {/* Connection arrow (except for first stage) */}
      {!isFirst && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center">
          <ArrowDown className="h-4 w-4 text-white/30" />
        </div>
      )}
      
      <div
        className={cn(
          "card p-4 transition-all",
          isHighestDropOff && "ring-2 ring-red-500/50 bg-red-500/5"
        )}
      >
        {/* Highest drop-off indicator */}
        {isHighestDropOff && (
          <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30">
            <AlertTriangle className="h-3 w-3 text-red-400" />
            <span className="text-xs text-red-400 font-medium">Highest Drop-off</span>
          </div>
        )}

        {/* Stage header */}
        <div className="flex items-center gap-3 mb-3">
          <div className={cn("p-2 rounded-lg border", colorClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-white">{label}</h3>
            <p className="text-2xl font-semibold text-white">{stage.count.toLocaleString()}</p>
          </div>
        </div>

        {/* Visual bar */}
        <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-3">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              stage.name === 'call_started' && "bg-blue-500",
              stage.name === 'order_initiated' && "bg-purple-500",
              stage.name === 'payment_started' && "bg-amber-500",
              stage.name === 'payment_completed' && "bg-emerald-500",
              stage.name === 'delivery_completed' && "bg-cyan-500"
            )}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {/* Conversion rate */}
          <div className="p-2 rounded-lg bg-white/5">
            <div className="flex items-center justify-center gap-1 mb-1">
              {stage.conversionRate >= 50 ? (
                <TrendingUp className="h-3 w-3 text-emerald-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-400" />
              )}
              <span className={cn(
                "text-sm font-medium",
                stage.conversionRate >= 50 ? "text-emerald-400" : "text-red-400"
              )}>
                {stage.conversionRate.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-white/40">Conversion</p>
          </div>

          {/* Drop-off count */}
          <div className="p-2 rounded-lg bg-white/5">
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className={cn(
                "text-sm font-medium",
                stage.dropOffCount > 0 ? "text-red-400" : "text-white/60"
              )}>
                {stage.dropOffCount > 0 ? `-${stage.dropOffCount.toLocaleString()}` : '0'}
              </span>
            </div>
            <p className="text-xs text-white/40">Drop-off</p>
          </div>

          {/* Average time */}
          <div className="p-2 rounded-lg bg-white/5">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Clock className="h-3 w-3 text-white/40" />
              <span className="text-sm font-medium text-white/60">
                {formatDuration(stage.averageTimeSeconds)}
              </span>
            </div>
            <p className="text-xs text-white/40">Avg Time</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Summary metrics component
 */
function FunnelSummary({
  stages,
  highestDropOffStage,
}: {
  stages: FunnelStage[];
  highestDropOffStage: FunnelStage | null;
}) {
  const firstStage = stages[0];
  const lastStage = stages[stages.length - 1];
  
  const overallConversion = firstStage && lastStage && firstStage.count > 0
    ? (lastStage.count / firstStage.count) * 100
    : 0;
  
  const totalDropOffs = stages.reduce((sum, s) => sum + s.dropOffCount, 0);
  
  const totalTime = stages.reduce((sum, s) => sum + s.averageTimeSeconds, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Overall conversion */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-white/40 text-minimal">Overall Conversion</p>
            <p className="text-xl font-semibold text-white">{overallConversion.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Total drop-offs */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
            <TrendingDown className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-white/40 text-minimal">Total Drop-offs</p>
            <p className="text-xl font-semibold text-white">{totalDropOffs.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Highest drop-off stage */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-white/40 text-minimal">Highest Drop-off</p>
            <p className="text-sm font-medium text-white truncate">
              {highestDropOffStage ? STAGE_LABELS[highestDropOffStage.name] : '-'}
            </p>
            {highestDropOffStage && (
              <p className="text-xs text-red-400">
                {highestDropOffStage.dropOffCount.toLocaleString()} lost
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Average total time */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-white/40 text-minimal">Avg Journey Time</p>
            <p className="text-xl font-semibold text-white">{formatDuration(totalTime)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FunnelAnalytics - Main funnel analytics dashboard component
 * 
 * @see Requirements: 22.4, 22.5, 22.6, 22.7, 22.8
 */
export function FunnelAnalytics({
  calls,
  orders,
  platforms = [],
  restaurants = [],
  branches = [],
  className,
}: FunnelAnalyticsProps) {
  const [filters, setFilters] = useState<FilterState>({
    period: 'last7days',
    paymentMethod: 'all',
  });
  const [showFilters, setShowFilters] = useState(false);

  const analyticsService = useMemo(() => createAnalyticsService(), []);
  const exportService = useMemo(() => createExportService(), []);

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

  // Filter orders by payment method
  const filteredOrders = useMemo(() => {
    if (filters.paymentMethod === 'all') return orders;
    return orders.filter(o => o.paymentMethod === filters.paymentMethod);
  }, [orders, filters.paymentMethod]);

  // Calculate funnel stages
  const funnelStages = useMemo<FunnelStage[]>(() => {
    return analyticsService.getOrderFunnelForPeriod(
      calls,
      filteredOrders,
      filters.period,
      {
        platformId: filters.platformId,
        restaurantId: filters.restaurantId,
        branchId: filters.branchId,
      }
    );
  }, [analyticsService, calls, filteredOrders, filters]);

  // Find the stage with highest drop-off (excluding first stage)
  const highestDropOffStage = useMemo(() => {
    const stagesWithDropOff = funnelStages.filter((s, i) => i > 0 && s.dropOffCount > 0);
    if (stagesWithDropOff.length === 0) return null;
    return stagesWithDropOff.reduce((max, s) => 
      s.dropOffCount > max.dropOffCount ? s : max
    );
  }, [funnelStages]);

  // Get max count for bar width calculation
  const maxCount = useMemo(() => {
    return Math.max(...funnelStages.map(s => s.count), 1);
  }, [funnelStages]);

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

  const handlePaymentMethodChange = useCallback((method: PaymentMethodFilter) => {
    setFilters(prev => ({ ...prev, paymentMethod: method }));
  }, []);

  /**
   * Handle funnel data export to CSV
   * 
   * Exports the current funnel data with applied filters to a CSV file.
   * The CSV includes: Stage, Count, Conversion Rate (%), Drop-off Count, Average Time (seconds)
   * 
   * @see Requirements: 22.8
   * @see Property 26: CSV Export Format Compliance
   */
  const handleExportFunnel = useCallback(() => {
    if (funnelStages.length === 0) return;

    // Build filename with filter context
    const dateStr = new Date().toISOString().split('T')[0];
    let filename = `funnel-export-${filters.period}-${dateStr}`;
    
    if (filters.branchId) {
      const branch = branches.find(b => b.id === filters.branchId);
      if (branch) {
        filename = `funnel-${branch.name.toLowerCase().replace(/\s+/g, '-')}-${filters.period}-${dateStr}`;
      }
    } else if (filters.restaurantId) {
      const restaurant = restaurants.find(r => r.id === filters.restaurantId);
      if (restaurant) {
        filename = `funnel-${restaurant.name.toLowerCase().replace(/\s+/g, '-')}-${filters.period}-${dateStr}`;
      }
    }
    
    if (filters.paymentMethod && filters.paymentMethod !== 'all') {
      filename += `-${filters.paymentMethod}`;
    }
    
    filename += '.csv';

    exportService.downloadFunnel(funnelStages, { filename });
  }, [funnelStages, filters, branches, restaurants, exportService]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Order Funnel Analytics</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Track conversion rates and identify drop-off points in your order flow
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Export Button */}
          <button
            onClick={handleExportFunnel}
            disabled={funnelStages.length === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
              funnelStages.length > 0
                ? "bg-white/5 text-white/60 hover:bg-white/10 hover:text-emerald-400"
                : "bg-white/5 text-white/30 cursor-not-allowed"
            )}
            title="Export funnel data to CSV"
            aria-label="Export funnel data to CSV"
          >
            <Download size={16} />
            <span className="text-minimal">Export CSV</span>
          </button>
          
          {/* Filters Toggle */}
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
              label="Restaurant"
              value={filters.restaurantId}
              options={filteredRestaurants}
              onChange={(v) => handleFilterChange('restaurantId', v)}
              icon={Store}
              placeholder="All Restaurants"
            />
            
            <FilterDropdown
              label="Branch"
              value={filters.branchId}
              options={filteredBranches}
              onChange={(v) => handleFilterChange('branchId', v)}
              icon={Store}
              placeholder="All Branches"
            />

            <PaymentMethodFilter
              value={filters.paymentMethod || 'all'}
              onChange={handlePaymentMethodChange}
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
      <FunnelSummary 
        stages={funnelStages} 
        highestDropOffStage={highestDropOffStage}
      />

      {/* Funnel Visualization */}
      <div className="card p-6">
        <h2 className="text-lg font-medium text-white mb-6">Funnel Stages</h2>
        
        {funnelStages.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            {funnelStages.map((stage, index) => (
              <FunnelStageCard
                key={stage.name}
                stage={stage}
                maxCount={maxCount}
                isHighestDropOff={highestDropOffStage?.name === stage.name}
                isFirst={index === 0}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 text-white/20 mx-auto mb-4" />
            <p className="text-white/60">No funnel data available for the selected filters</p>
            <p className="text-white/40 text-sm mt-1">Try adjusting your filters or time period</p>
          </div>
        )}
      </div>

      {/* Stage Details Table */}
      {funnelStages.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-medium text-white">Stage Details</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Stage</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Count</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Conversion</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Drop-off</th>
                  <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {funnelStages.map((stage) => {
                  const Icon = STAGE_ICONS[stage.name];
                  const isHighest = highestDropOffStage?.name === stage.name;
                  
                  return (
                    <tr 
                      key={stage.name} 
                      className={cn(
                        "border-b border-white/5 hover:bg-white/5 transition-colors",
                        isHighest && "bg-red-500/5"
                      )}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Icon className="h-4 w-4 text-white/60" />
                          <span className="text-sm text-white">{STAGE_LABELS[stage.name]}</span>
                          {isHighest && (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs">
                              Highest Drop-off
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm font-medium text-white">{stage.count.toLocaleString()}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className={cn(
                          "text-sm font-medium",
                          stage.conversionRate >= 50 ? "text-emerald-400" : "text-red-400"
                        )}>
                          {stage.conversionRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className={cn(
                          "text-sm font-medium",
                          stage.dropOffCount > 0 ? "text-red-400" : "text-white/40"
                        )}>
                          {stage.dropOffCount > 0 ? `-${stage.dropOffCount.toLocaleString()}` : '-'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm text-white/60">{formatDuration(stage.averageTimeSeconds)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default FunnelAnalytics;
