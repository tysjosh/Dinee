/**
 * AgentPerformance - Dashboard component for AI agent performance metrics
 * 
 * This component displays:
 * - Summary cards showing total agents, total calls, average metrics
 * - Table/grid of individual agent metrics
 * - Comparison view showing rankings across branches
 * - Filter controls for date range and branch
 * 
 * @see Requirements: 23.7, 23.8
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Phone,
  TrendingUp,
  TrendingDown,
  Clock,
  Filter,
  Building2,
  Store,
  ChevronDown,
  Bot,
  Target,
  AlertTriangle,
  Award,
  BarChart3,
  Users,
  ArrowUpDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createAgentMetricsService,
  AgentMetrics,
  AgentMetricsSummary,
  AgentComparison,
  AgentCallData,
  AgentNameMap,
  TimePeriod,
  OrderData,
} from '@/lib/analytics';

// ============================================================================
// Types
// ============================================================================

export interface AgentPerformanceProps {
  /** Call data for analytics (with ASR and fallback info) */
  calls: AgentCallData[];
  /** Order data for analytics */
  orders: OrderData[];
  /** Available platforms for filtering */
  platforms?: Array<{ id: string; name: string }>;
  /** Available restaurants for filtering */
  restaurants?: Array<{ id: string; name: string; platformId?: string }>;
  /** Available branches for filtering */
  branches?: Array<{ id: string; name: string; restaurantId: string }>;
  /** Agent name mapping for display */
  agentNames?: AgentNameMap;
  /** Optional class name */
  className?: string;
}


interface FilterState {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
  period: TimePeriod;
}

type SortField = 'totalCalls' | 'conversionRate' | 'asrAccuracy' | 'fallbackRate' | 'averageCallDuration';
type SortDirection = 'asc' | 'desc';

type ViewMode = 'metrics' | 'comparison';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format duration in human-readable format
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
 * Get color class based on metric value and thresholds
 */
function getMetricColor(value: number, type: 'conversion' | 'asr' | 'fallback'): string {
  switch (type) {
    case 'conversion':
      if (value >= 50) return 'text-emerald-400';
      if (value >= 30) return 'text-amber-400';
      return 'text-red-400';
    case 'asr':
      if (value >= 80) return 'text-emerald-400';
      if (value >= 60) return 'text-amber-400';
      return 'text-red-400';
    case 'fallback':
      if (value <= 10) return 'text-emerald-400';
      if (value <= 25) return 'text-amber-400';
      return 'text-red-400';
    default:
      return 'text-white/60';
  }
}

/**
 * Get rank badge color based on position
 */
function getRankColor(rank: number): string {
  if (rank === 1) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  if (rank === 2) return 'bg-slate-400/20 text-slate-300 border-slate-400/30';
  if (rank === 3) return 'bg-orange-600/20 text-orange-400 border-orange-600/30';
  return 'bg-white/5 text-white/60 border-white/10';
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Summary metric card component
 */
function SummaryCard({
  title,
  value,
  icon: Icon,
  format = 'number',
  iconColor = 'text-white/60',
  subtitle,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  format?: 'number' | 'percentage';
  iconColor?: string;
  subtitle?: string;
}) {
  const formattedValue = useMemo(() => {
    switch (format) {
      case 'percentage':
        return `${value.toFixed(1)}%`;
      default:
        return value.toLocaleString();
    }
  }, [value, format]);

  return (
    <div className="card p-4 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-white/40 text-minimal mb-1">{title}</p>
          <p className="text-xl font-semibold text-white">{formattedValue}</p>
          {subtitle && (
            <p className="text-xs text-white/40 mt-1">{subtitle}</p>
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
 * View mode toggle component
 */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex rounded-lg bg-white/5 p-1">
      <button
        onClick={() => onChange('metrics')}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
          value === 'metrics'
            ? "bg-emerald-500/20 text-emerald-400"
            : "text-white/60 hover:text-white/80"
        )}
      >
        <BarChart3 size={14} />
        <span>Metrics</span>
      </button>
      <button
        onClick={() => onChange('comparison')}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
          value === 'comparison'
            ? "bg-emerald-500/20 text-emerald-400"
            : "text-white/60 hover:text-white/80"
        )}
      >
        <Award size={14} />
        <span>Rankings</span>
      </button>
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
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const isActive = currentSort === field;
  
  return (
    <th
      className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider cursor-pointer hover:text-white/60 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
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
 * Agent metrics row component
 */
function AgentMetricsRow({ agent }: { agent: AgentMetrics }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
            <Bot size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">{agent.agentName}</p>
            <p className="text-xs text-white/40">{agent.agentId}</p>
          </div>
        </div>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm font-medium text-white">{agent.totalCalls.toLocaleString()}</span>
      </td>
      <td className="p-4 text-right">
        <span className="text-sm text-white/60">{formatDuration(agent.averageCallDuration)}</span>
      </td>
      <td className="p-4 text-right">
        <span className={cn("text-sm font-medium", getMetricColor(agent.conversionRate, 'conversion'))}>
          {agent.conversionRate.toFixed(1)}%
        </span>
      </td>
      <td className="p-4 text-right">
        <span className={cn("text-sm font-medium", getMetricColor(agent.asrAccuracy, 'asr'))}>
          {agent.asrAccuracy.toFixed(1)}%
        </span>
      </td>
      <td className="p-4 text-right">
        <span className={cn("text-sm font-medium", getMetricColor(agent.fallbackRate, 'fallback'))}>
          {agent.fallbackRate.toFixed(1)}%
        </span>
      </td>
    </tr>
  );
}

/**
 * Agent comparison row component for rankings view
 * 
 * @see Requirements: 23.7
 */
function AgentComparisonRow({ 
  comparison, 
  index 
}: { 
  comparison: AgentComparison; 
  index: number;
}) {
  const { agent, conversionRank, asrAccuracyRank, fallbackRateRank, overallScore } = comparison;
  const overallRank = index + 1;
  
  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border",
            getRankColor(overallRank)
          )}>
            {overallRank}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{agent.agentName}</p>
            <p className="text-xs text-white/40">{agent.totalCalls.toLocaleString()} calls</p>
          </div>
        </div>
      </td>
      <td className="p-4 text-center">
        <div className="flex flex-col items-center">
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium border",
            getRankColor(conversionRank)
          )}>
            #{conversionRank}
          </span>
          <span className="text-xs text-white/40 mt-1">{agent.conversionRate.toFixed(1)}%</span>
        </div>
      </td>
      <td className="p-4 text-center">
        <div className="flex flex-col items-center">
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium border",
            getRankColor(asrAccuracyRank)
          )}>
            #{asrAccuracyRank}
          </span>
          <span className="text-xs text-white/40 mt-1">{agent.asrAccuracy.toFixed(1)}%</span>
        </div>
      </td>
      <td className="p-4 text-center">
        <div className="flex flex-col items-center">
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium border",
            getRankColor(fallbackRateRank)
          )}>
            #{fallbackRateRank}
          </span>
          <span className="text-xs text-white/40 mt-1">{agent.fallbackRate.toFixed(1)}%</span>
        </div>
      </td>
      <td className="p-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm font-medium text-white">{overallScore.toFixed(2)}</span>
          {overallRank === 1 && (
            <Award size={16} className="text-amber-400" />
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Agent metrics table component
 */
function AgentMetricsTable({
  agents,
  sortField,
  sortDirection,
  onSort,
}: {
  agents: AgentMetrics[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      const multiplier = sortDirection === 'asc' ? 1 : -1;
      return (aValue - bValue) * multiplier;
    });
  }, [agents, sortField, sortDirection]);

  if (agents.length === 0) {
    return (
      <div className="text-center py-12">
        <Bot className="h-12 w-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/60">No agent data available</p>
        <p className="text-white/40 text-sm mt-1">Try adjusting your filters or time period</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              Agent
            </th>
            <SortableHeader
              label="Calls"
              field="totalCalls"
              currentSort={sortField}
              currentDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHeader
              label="Avg Duration"
              field="averageCallDuration"
              currentSort={sortField}
              currentDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHeader
              label="Conversion"
              field="conversionRate"
              currentSort={sortField}
              currentDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHeader
              label="ASR Accuracy"
              field="asrAccuracy"
              currentSort={sortField}
              currentDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHeader
              label="Fallback Rate"
              field="fallbackRate"
              currentSort={sortField}
              currentDirection={sortDirection}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {sortedAgents.map((agent) => (
            <AgentMetricsRow key={agent.agentId} agent={agent} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Agent comparison table component for rankings view
 * 
 * @see Requirements: 23.7
 */
function AgentComparisonTable({
  comparisons,
}: {
  comparisons: AgentComparison[];
}) {
  if (comparisons.length === 0) {
    return (
      <div className="text-center py-12">
        <Award className="h-12 w-12 text-white/20 mx-auto mb-4" />
        <p className="text-white/60">No comparison data available</p>
        <p className="text-white/40 text-sm mt-1">Need at least 2 agents to compare</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              Agent
            </th>
            <th className="text-center p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              Conversion Rank
            </th>
            <th className="text-center p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              ASR Rank
            </th>
            <th className="text-center p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              Fallback Rank
            </th>
            <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
              Overall Score
            </th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((comparison, index) => (
            <AgentComparisonRow 
              key={comparison.agent.agentId} 
              comparison={comparison} 
              index={index}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * AgentPerformance - Main agent performance dashboard component
 * 
 * Displays agent metrics with filtering and comparison capabilities.
 * 
 * @see Requirements: 23.7, 23.8
 */
export function AgentPerformance({
  calls,
  orders,
  platforms = [],
  restaurants = [],
  branches = [],
  agentNames = {},
  className,
}: AgentPerformanceProps) {
  const [filters, setFilters] = useState<FilterState>({
    period: 'last7days',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('metrics');
  const [sortField, setSortField] = useState<SortField>('totalCalls');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const agentMetricsService = useMemo(() => createAgentMetricsService(), []);

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

  // Build agent name map from branches
  const fullAgentNames = useMemo(() => {
    const names: AgentNameMap = { ...agentNames };
    for (const branch of branches) {
      if (!names[branch.id]) {
        names[branch.id] = branch.name;
      }
    }
    for (const restaurant of restaurants) {
      if (!names[restaurant.id]) {
        names[restaurant.id] = restaurant.name;
      }
    }
    return names;
  }, [agentNames, branches, restaurants]);

  // Calculate date range from period
  const dateRange = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (filters.period) {
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
  }, [filters.period]);

  // Get agent metrics summary
  const metricsSummary = useMemo<AgentMetricsSummary>(() => {
    return agentMetricsService.getAgentMetricsSummary(
      calls,
      orders,
      {
        platformId: filters.platformId,
        restaurantId: filters.restaurantId,
        branchId: filters.branchId,
        ...dateRange,
      },
      fullAgentNames
    );
  }, [agentMetricsService, calls, orders, filters, dateRange, fullAgentNames]);

  // Get agent comparisons for ranking view
  const agentComparisons = useMemo<AgentComparison[]>(() => {
    return agentMetricsService.compareAgentPerformance(
      calls,
      orders,
      {
        platformId: filters.platformId,
        restaurantId: filters.restaurantId,
        branchId: filters.branchId,
        ...dateRange,
      },
      fullAgentNames
    );
  }, [agentMetricsService, calls, orders, filters, dateRange, fullAgentNames]);

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

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-purple-400" />
            <h1 className="text-2xl font-semibold text-white">Agent Performance</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Monitor AI agent metrics and compare performance across branches
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard
          title="Total Agents"
          value={metricsSummary.totalAgents}
          icon={Users}
          iconColor="text-purple-400"
        />
        <SummaryCard
          title="Total Calls"
          value={metricsSummary.totalCalls}
          icon={Phone}
          iconColor="text-blue-400"
        />
        <SummaryCard
          title="Avg Conversion"
          value={metricsSummary.averageConversionRate}
          icon={Target}
          format="percentage"
          iconColor="text-emerald-400"
        />
        <SummaryCard
          title="Avg ASR Accuracy"
          value={metricsSummary.averageAsrAccuracy}
          icon={TrendingUp}
          format="percentage"
          iconColor="text-cyan-400"
        />
        <SummaryCard
          title="Avg Fallback Rate"
          value={metricsSummary.averageFallbackRate}
          icon={AlertTriangle}
          format="percentage"
          iconColor="text-amber-400"
          subtitle="Lower is better"
        />
      </div>

      {/* Main Content */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-lg font-medium text-white">
            {viewMode === 'metrics' ? 'Agent Metrics' : 'Performance Rankings'}
          </h2>
          <p className="text-sm text-white/40 mt-1">
            {viewMode === 'metrics' 
              ? 'Detailed performance metrics for each agent'
              : 'Compare agent performance across branches (lower score = better)'
            }
          </p>
        </div>
        
        {viewMode === 'metrics' ? (
          <AgentMetricsTable
            agents={metricsSummary.agents}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        ) : (
          <AgentComparisonTable comparisons={agentComparisons} />
        )}
      </div>

      {/* Legend for comparison view */}
      {viewMode === 'comparison' && agentComparisons.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-white mb-3">Scoring Methodology</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Target size={16} className="text-emerald-400 mt-0.5" />
              <div>
                <p className="text-white/80">Conversion Rate</p>
                <p className="text-white/40 text-xs">40% weight - Higher is better</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <TrendingUp size={16} className="text-cyan-400 mt-0.5" />
              <div>
                <p className="text-white/80">ASR Accuracy</p>
                <p className="text-white/40 text-xs">35% weight - Higher is better</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5" />
              <div>
                <p className="text-white/80">Fallback Rate</p>
                <p className="text-white/40 text-xs">25% weight - Lower is better</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentPerformance;
