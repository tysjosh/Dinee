/**
 * FallbackMetrics - Dashboard component for displaying voice fallback metrics
 * 
 * This component displays:
 * - Fallback rate per branch
 * - Success/failure breakdown by channel (WhatsApp/SMS)
 * - Average confidence scores that triggered fallback
 * - Trend indicators comparing to previous period
 * 
 * @see Requirements: 18.5, 18.6
 */

import React, { useMemo } from 'react';
import {
  PhoneOff,
  MessageSquare,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface FallbackMetricsData {
  /** Total number of calls in the period */
  totalCalls: number;
  /** Total number of fallback events */
  totalFallbacks: number;
  /** Number of successful fallbacks */
  successfulFallbacks: number;
  /** Number of failed fallbacks */
  failedFallbacks: number;
  /** Fallback rate (fallbacks / total calls) */
  fallbackRate: number;
  /** Breakdown by channel */
  byChannel: {
    whatsapp: { count: number; successRate: number };
    sms: { count: number; successRate: number };
  };
  /** Average confidence score that triggered fallback */
  averageTriggerConfidence: number;
  /** Previous period comparison */
  previousPeriod?: {
    fallbackRate: number;
    totalFallbacks: number;
  };
}

export interface BranchFallbackData {
  /** Branch ID */
  branchId: string;
  /** Branch name */
  branchName: string;
  /** Fallback metrics for this branch */
  metrics: FallbackMetricsData;
}

export interface FallbackMetricsProps {
  /** Fallback metrics data */
  metrics: FallbackMetricsData;
  /** Optional branch-level breakdown */
  branchMetrics?: BranchFallbackData[];
  /** Whether to show branch breakdown */
  showBranchBreakdown?: boolean;
  /** Optional class name */
  className?: string;
  /** Time period label */
  periodLabel?: string;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Metric card for displaying a single metric
 */
function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  format = 'number',
  iconColor = 'text-white/60',
  subtitle,
}: {
  title: string;
  value: number;
  change?: number;
  icon: React.ElementType;
  format?: 'number' | 'percentage' | 'confidence';
  iconColor?: string;
  subtitle?: string;
}) {
  const formattedValue = useMemo(() => {
    switch (format) {
      case 'percentage':
        return `${(value * 100).toFixed(1)}%`;
      case 'confidence':
        return `${(value * 100).toFixed(0)}%`;
      default:
        return value.toLocaleString();
    }
  }, [value, format]);

  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  
  // For fallback rate, lower is better, so we invert the color logic
  const isImprovement = isNegative;
  const isRegression = isPositive;

  return (
    <div className="card p-4 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-white/60 text-minimal mb-1">{title}</p>
          <p className="text-2xl font-semibold text-white">{formattedValue}</p>
          
          {subtitle && (
            <p className="text-xs text-white/40 mt-1">{subtitle}</p>
          )}
          
          {change !== undefined && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-sm",
              isImprovement && "text-emerald-400",
              isRegression && "text-red-400",
              !isImprovement && !isRegression && "text-white/40"
            )}>
              {isRegression && <TrendingUp size={14} />}
              {isImprovement && <TrendingDown size={14} />}
              <span>{Math.abs(change * 100).toFixed(1)}%</span>
              <span className="text-white/40 text-minimal">vs prev</span>
            </div>
          )}
        </div>
        
        <div className={cn("p-3 rounded-lg bg-white/5", iconColor)}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

/**
 * Channel breakdown card
 */
function ChannelBreakdown({
  channel,
  count,
  successRate,
  icon: Icon,
  iconColor,
}: {
  channel: string;
  count: number;
  successRate: number;
  icon: React.ElementType;
  iconColor: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-lg bg-white/5", iconColor)}>
          <Icon size={16} />
        </div>
        <div>
          <p className="text-sm font-medium text-white capitalize">{channel}</p>
          <p className="text-xs text-white/40">{count} fallbacks</p>
        </div>
      </div>
      <div className="text-right">
        <p className={cn(
          "text-sm font-medium",
          successRate >= 0.8 ? "text-emerald-400" :
          successRate >= 0.5 ? "text-yellow-400" : "text-red-400"
        )}>
          {(successRate * 100).toFixed(0)}%
        </p>
        <p className="text-xs text-white/40">success</p>
      </div>
    </div>
  );
}

/**
 * Branch row for branch breakdown table
 */
function BranchRow({
  branch,
  isHighlighted,
}: {
  branch: BranchFallbackData;
  isHighlighted?: boolean;
}) {
  const { metrics } = branch;
  const fallbackRatePercent = (metrics.fallbackRate * 100).toFixed(1);
  const successRate = metrics.totalFallbacks > 0
    ? metrics.successfulFallbacks / metrics.totalFallbacks
    : 0;

  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg transition-colors",
      isHighlighted ? "bg-yellow-500/10 border border-yellow-500/20" : "bg-white/5 hover:bg-white/10"
    )}>
      <div className="flex items-center gap-3">
        {isHighlighted && (
          <AlertTriangle size={16} className="text-yellow-400" />
        )}
        <div>
          <p className="text-sm font-medium text-white">{branch.branchName}</p>
          <p className="text-xs text-white/40">
            {metrics.totalFallbacks} of {metrics.totalCalls} calls
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className={cn(
            "text-sm font-medium",
            metrics.fallbackRate > 0.2 ? "text-red-400" :
            metrics.fallbackRate > 0.1 ? "text-yellow-400" : "text-emerald-400"
          )}>
            {fallbackRatePercent}%
          </p>
          <p className="text-xs text-white/40">fallback rate</p>
        </div>
        
        <div className="text-right">
          <p className={cn(
            "text-sm font-medium",
            successRate >= 0.8 ? "text-emerald-400" :
            successRate >= 0.5 ? "text-yellow-400" : "text-red-400"
          )}>
            {(successRate * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-white/40">success</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Confidence indicator bar
 */
function ConfidenceIndicator({
  confidence,
  threshold = 0.6,
}: {
  confidence: number;
  threshold?: number;
}) {
  const confidencePercent = confidence * 100;
  const thresholdPercent = threshold * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/60">Avg. Trigger Confidence</span>
        <span className="text-white font-medium">{confidencePercent.toFixed(0)}%</span>
      </div>
      <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
        {/* Confidence bar */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            confidence < threshold * 0.5 ? "bg-red-500" :
            confidence < threshold * 0.8 ? "bg-yellow-500" : "bg-emerald-500"
          )}
          style={{ width: `${confidencePercent}%` }}
        />
        {/* Threshold marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white/60"
          style={{ left: `${thresholdPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>0%</span>
        <span>Threshold: {thresholdPercent}%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FallbackMetrics - Main component for displaying fallback metrics
 * 
 * @see Requirements: 18.5, 18.6
 */
export function FallbackMetrics({
  metrics,
  branchMetrics = [],
  showBranchBreakdown = true,
  className,
  periodLabel = 'Last 7 Days',
}: FallbackMetricsProps) {
  // Calculate change from previous period
  const fallbackRateChange = useMemo(() => {
    if (!metrics.previousPeriod) return undefined;
    return metrics.fallbackRate - metrics.previousPeriod.fallbackRate;
  }, [metrics]);

  // Sort branches by fallback rate (highest first)
  const sortedBranches = useMemo(() => {
    return [...branchMetrics].sort(
      (a, b) => b.metrics.fallbackRate - a.metrics.fallbackRate
    );
  }, [branchMetrics]);

  // Identify branches with high fallback rates (>15%)
  const highFallbackBranches = useMemo(() => {
    return sortedBranches.filter((b) => b.metrics.fallbackRate > 0.15);
  }, [sortedBranches]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <PhoneOff size={20} className="text-yellow-400" />
            Voice Fallback Metrics
          </h2>
          <p className="text-sm text-white/60 mt-1">{periodLabel}</p>
        </div>
        
        {highFallbackBranches.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <AlertTriangle size={14} className="text-yellow-400" />
            <span className="text-sm text-yellow-400">
              {highFallbackBranches.length} branch{highFallbackBranches.length > 1 ? 'es' : ''} with high fallback rate
            </span>
          </div>
        )}
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Fallback Rate"
          value={metrics.fallbackRate}
          change={fallbackRateChange}
          icon={BarChart3}
          format="percentage"
          iconColor="text-yellow-400"
          subtitle={`${metrics.totalFallbacks} of ${metrics.totalCalls} calls`}
        />
        
        <MetricCard
          title="Successful Fallbacks"
          value={metrics.successfulFallbacks}
          icon={CheckCircle}
          iconColor="text-emerald-400"
          subtitle={metrics.totalFallbacks > 0
            ? `${((metrics.successfulFallbacks / metrics.totalFallbacks) * 100).toFixed(0)}% success rate`
            : 'No fallbacks'
          }
        />
        
        <MetricCard
          title="Failed Fallbacks"
          value={metrics.failedFallbacks}
          icon={XCircle}
          iconColor="text-red-400"
          subtitle={metrics.totalFallbacks > 0
            ? `${((metrics.failedFallbacks / metrics.totalFallbacks) * 100).toFixed(0)}% failure rate`
            : 'No failures'
          }
        />
        
        <MetricCard
          title="Avg. Trigger Confidence"
          value={metrics.averageTriggerConfidence}
          icon={AlertTriangle}
          format="confidence"
          iconColor="text-orange-400"
          subtitle="When fallback triggered"
        />
      </div>

      {/* Channel Breakdown */}
      <div className="card p-4">
        <h3 className="text-sm font-medium text-white mb-4">Channel Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChannelBreakdown
            channel="WhatsApp"
            count={metrics.byChannel.whatsapp.count}
            successRate={metrics.byChannel.whatsapp.successRate}
            icon={MessageCircle}
            iconColor="text-emerald-400"
          />
          <ChannelBreakdown
            channel="SMS"
            count={metrics.byChannel.sms.count}
            successRate={metrics.byChannel.sms.successRate}
            icon={MessageSquare}
            iconColor="text-blue-400"
          />
        </div>
      </div>

      {/* Confidence Indicator */}
      <div className="card p-4">
        <ConfidenceIndicator
          confidence={metrics.averageTriggerConfidence}
          threshold={0.6}
        />
      </div>

      {/* Branch Breakdown */}
      {showBranchBreakdown && branchMetrics.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-white mb-4">
            Fallback Rate by Branch
          </h3>
          <div className="space-y-2">
            {sortedBranches.map((branch) => (
              <BranchRow
                key={branch.branchId}
                branch={branch}
                isHighlighted={branch.metrics.fallbackRate > 0.15}
              />
            ))}
          </div>
          
          {sortedBranches.length === 0 && (
            <p className="text-sm text-white/40 text-center py-4">
              No branch data available
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {metrics.totalCalls === 0 && (
        <div className="card p-8 text-center">
          <PhoneOff size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No Call Data</h3>
          <p className="text-sm text-white/60">
            Fallback metrics will appear here once calls are processed.
          </p>
        </div>
      )}
    </div>
  );
}

export default FallbackMetrics;
