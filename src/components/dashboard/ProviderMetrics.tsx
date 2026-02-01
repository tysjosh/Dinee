/**
 * ProviderMetrics - Dashboard component for displaying telecom provider metrics
 * 
 * This component displays:
 * - Call quality metrics by provider
 * - Provider health status
 * - A/B testing comparison results
 * - Failover statistics
 * 
 * @see Requirements: 19.6, 19.7
 */

import React, { useMemo } from 'react';
import {
  Phone,
  PhoneOff,
  Activity,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  BarChart3,
  ArrowRightLeft,
  Beaker,
  Clock,
  Signal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ProviderMetrics as ProviderMetricsData,
  ProviderHealth,
  ABTestComparison,
  TelecomProvider,
} from '@/lib/voice';

// ============================================================================
// Types
// ============================================================================

export interface ProviderMetricsProps {
  /** Metrics data for all providers */
  providerMetrics: ProviderMetricsData[];
  /** Health status for all providers */
  providerHealth: ProviderHealth[];
  /** A/B test comparison results (optional) */
  abTestComparison?: ABTestComparison | null;
  /** Whether to show A/B test section */
  showABTest?: boolean;
  /** Optional class name */
  className?: string;
  /** Time period label */
  periodLabel?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get display name for a provider
 */
function getProviderDisplayName(provider: TelecomProvider): string {
  const names: Record<TelecomProvider, string> = {
    twilio: 'Twilio',
    vonage: 'Vonage',
    africas_talking: "Africa's Talking",
    termii: 'Termii',
    mock: 'Mock Provider',
  };
  return names[provider] || provider;
}

/**
 * Get status color class
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'text-emerald-400';
    case 'degraded':
      return 'text-yellow-400';
    case 'unavailable':
      return 'text-red-400';
    default:
      return 'text-white/40';
  }
}

/**
 * Get status background class
 */
function getStatusBgColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-500/20 border-emerald-500/30';
    case 'degraded':
      return 'bg-yellow-500/20 border-yellow-500/30';
    case 'unavailable':
      return 'bg-red-500/20 border-red-500/30';
    default:
      return 'bg-white/5 border-white/10';
  }
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Provider card showing key metrics
 */
function ProviderCard({
  metrics,
  health,
}: {
  metrics: ProviderMetricsData;
  health?: ProviderHealth;
}) {
  const successRatePercent = (metrics.successRate * 100).toFixed(1);
  const status = health?.status || 'healthy';

  return (
    <div className={cn(
      "card p-4 border transition-colors",
      getStatusBgColor(status)
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg",
            status === 'healthy' ? 'bg-emerald-500/20' :
            status === 'degraded' ? 'bg-yellow-500/20' : 'bg-red-500/20'
          )}>
            {status === 'healthy' ? (
              <Wifi size={20} className="text-emerald-400" />
            ) : status === 'degraded' ? (
              <Activity size={20} className="text-yellow-400" />
            ) : (
              <WifiOff size={20} className="text-red-400" />
            )}
          </div>
          <div>
            <h3 className="font-medium text-white">
              {getProviderDisplayName(metrics.provider)}
            </h3>
            <p className={cn("text-xs capitalize", getStatusColor(status))}>
              {status}
            </p>
          </div>
        </div>
        
        {/* Success Rate Badge */}
        <div className={cn(
          "px-3 py-1 rounded-full text-sm font-medium",
          metrics.successRate >= 0.95 ? "bg-emerald-500/20 text-emerald-400" :
          metrics.successRate >= 0.8 ? "bg-yellow-500/20 text-yellow-400" :
          "bg-red-500/20 text-red-400"
        )}>
          {successRatePercent}%
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricItem
          label="Total Calls"
          value={metrics.totalCalls.toLocaleString()}
          icon={Phone}
        />
        <MetricItem
          label="Success"
          value={metrics.successfulCalls.toLocaleString()}
          icon={CheckCircle}
          iconColor="text-emerald-400"
        />
        <MetricItem
          label="Failed"
          value={metrics.failedCalls.toLocaleString()}
          icon={XCircle}
          iconColor="text-red-400"
        />
        <MetricItem
          label="Avg Duration"
          value={`${metrics.averageDurationSeconds.toFixed(0)}s`}
          icon={Clock}
        />
      </div>

      {/* Quality Metrics */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-xs text-white/40 mb-2">Quality Metrics</p>
        <div className="grid grid-cols-3 gap-2">
          <QualityMetric
            label="Audio"
            value={metrics.averageAudioQuality}
            max={100}
            unit="%"
          />
          <QualityMetric
            label="Latency"
            value={metrics.averageLatencyMs}
            max={500}
            unit="ms"
            inverse
          />
          <QualityMetric
            label="Loss"
            value={metrics.averagePacketLoss}
            max={10}
            unit="%"
            inverse
          />
        </div>
      </div>

      {/* Failover Stats */}
      {(metrics.failoverInCount > 0 || metrics.failoverOutCount > 0) && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-xs text-white/40 mb-2">Failover Activity</p>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <ArrowRightLeft size={14} className="text-blue-400" />
              <span className="text-white/60">In:</span>
              <span className="text-white">{metrics.failoverInCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <ArrowRightLeft size={14} className="text-orange-400" />
              <span className="text-white/60">Out:</span>
              <span className="text-white">{metrics.failoverOutCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small metric item
 */
function MetricItem({
  label,
  value,
  icon: Icon,
  iconColor = 'text-white/40',
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  iconColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
      <Icon size={14} className={iconColor} />
      <div>
        <p className="text-xs text-white/40">{label}</p>
        <p className="text-sm font-medium text-white">{value}</p>
      </div>
    </div>
  );
}

/**
 * Quality metric with progress bar
 */
function QualityMetric({
  label,
  value,
  max,
  unit,
  inverse = false,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  inverse?: boolean;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const displayValue = value.toFixed(inverse ? 0 : 1);
  
  // For inverse metrics (like latency), lower is better
  const isGood = inverse ? value < max * 0.3 : value > max * 0.7;
  const isBad = inverse ? value > max * 0.7 : value < max * 0.3;

  return (
    <div className="text-center">
      <p className="text-xs text-white/40 mb-1">{label}</p>
      <p className={cn(
        "text-sm font-medium",
        isGood ? "text-emerald-400" : isBad ? "text-red-400" : "text-yellow-400"
      )}>
        {displayValue}{unit}
      </p>
      <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isGood ? "bg-emerald-500" : isBad ? "bg-red-500" : "bg-yellow-500"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A/B Test comparison component
 * @requirements 19.7 - Support A/B testing comparison
 */
function ABTestSection({
  comparison,
}: {
  comparison: ABTestComparison;
}) {
  const providerAName = getProviderDisplayName(comparison.providerA);
  const providerBName = getProviderDisplayName(comparison.providerB);
  const isSignificant = comparison.statisticalSignificance >= 0.95;
  const recommendedName = getProviderDisplayName(comparison.recommendedProvider);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Beaker size={20} className="text-purple-400" />
          <h3 className="font-medium text-white">A/B Test Results</h3>
        </div>
        <span className={cn(
          "px-2 py-1 rounded text-xs",
          isSignificant
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-yellow-500/20 text-yellow-400"
        )}>
          {isSignificant ? 'Statistically Significant' : 'Needs More Data'}
        </span>
      </div>

      {/* Comparison Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Provider A */}
        <div className={cn(
          "p-3 rounded-lg border",
          comparison.recommendedProvider === comparison.providerA
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-white/5 border-white/10"
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">{providerAName}</span>
            <span className="text-xs text-white/40">Group A</span>
          </div>
          <div className="space-y-2">
            <ComparisonMetric
              label="Success Rate"
              value={`${(comparison.metricsA.successRate * 100).toFixed(1)}%`}
              isWinner={comparison.metricsA.successRate > comparison.metricsB.successRate}
            />
            <ComparisonMetric
              label="Avg Latency"
              value={`${comparison.metricsA.averageLatencyMs.toFixed(0)}ms`}
              isWinner={comparison.metricsA.averageLatencyMs < comparison.metricsB.averageLatencyMs}
            />
            <ComparisonMetric
              label="Audio Quality"
              value={`${comparison.metricsA.averageAudioQuality.toFixed(0)}%`}
              isWinner={comparison.metricsA.averageAudioQuality > comparison.metricsB.averageAudioQuality}
            />
          </div>
        </div>

        {/* Provider B */}
        <div className={cn(
          "p-3 rounded-lg border",
          comparison.recommendedProvider === comparison.providerB
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-white/5 border-white/10"
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">{providerBName}</span>
            <span className="text-xs text-white/40">Group B</span>
          </div>
          <div className="space-y-2">
            <ComparisonMetric
              label="Success Rate"
              value={`${(comparison.metricsB.successRate * 100).toFixed(1)}%`}
              isWinner={comparison.metricsB.successRate > comparison.metricsA.successRate}
            />
            <ComparisonMetric
              label="Avg Latency"
              value={`${comparison.metricsB.averageLatencyMs.toFixed(0)}ms`}
              isWinner={comparison.metricsB.averageLatencyMs < comparison.metricsA.averageLatencyMs}
            />
            <ComparisonMetric
              label="Audio Quality"
              value={`${comparison.metricsB.averageAudioQuality.toFixed(0)}%`}
              isWinner={comparison.metricsB.averageAudioQuality > comparison.metricsA.averageAudioQuality}
            />
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div className="p-3 bg-white/5 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/40 mb-1">Recommendation</p>
            <p className="text-sm font-medium text-white">
              Use <span className="text-emerald-400">{recommendedName}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/40 mb-1">Confidence</p>
            <p className={cn(
              "text-sm font-medium",
              comparison.confidence >= 0.8 ? "text-emerald-400" :
              comparison.confidence >= 0.5 ? "text-yellow-400" : "text-white/60"
            )}>
              {(comparison.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
        <div className="mt-2 text-xs text-white/40">
          Sample size: {comparison.totalSampleSize.toLocaleString()} calls
        </div>
      </div>
    </div>
  );
}

/**
 * Comparison metric row
 */
function ComparisonMetric({
  label,
  value,
  isWinner,
}: {
  label: string;
  value: string;
  isWinner: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-white/60">{label}</span>
      <span className={cn(
        "text-xs font-medium",
        isWinner ? "text-emerald-400" : "text-white"
      )}>
        {value}
        {isWinner && <TrendingUp size={12} className="inline ml-1" />}
      </span>
    </div>
  );
}

/**
 * Summary stats bar
 */
function SummaryStats({
  metrics,
}: {
  metrics: ProviderMetricsData[];
}) {
  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, m) => ({
        totalCalls: acc.totalCalls + m.totalCalls,
        successfulCalls: acc.successfulCalls + m.successfulCalls,
        failedCalls: acc.failedCalls + m.failedCalls,
        failoverIn: acc.failoverIn + m.failoverInCount,
        failoverOut: acc.failoverOut + m.failoverOutCount,
      }),
      { totalCalls: 0, successfulCalls: 0, failedCalls: 0, failoverIn: 0, failoverOut: 0 }
    );
  }, [metrics]);

  const overallSuccessRate = totals.totalCalls > 0
    ? (totals.successfulCalls / totals.totalCalls * 100).toFixed(1)
    : '0.0';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Phone size={16} className="text-blue-400" />
          <span className="text-xs text-white/40">Total Calls</span>
        </div>
        <p className="text-2xl font-semibold text-white">
          {totals.totalCalls.toLocaleString()}
        </p>
      </div>
      
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 size={16} className="text-emerald-400" />
          <span className="text-xs text-white/40">Success Rate</span>
        </div>
        <p className={cn(
          "text-2xl font-semibold",
          parseFloat(overallSuccessRate) >= 95 ? "text-emerald-400" :
          parseFloat(overallSuccessRate) >= 80 ? "text-yellow-400" : "text-red-400"
        )}>
          {overallSuccessRate}%
        </p>
      </div>
      
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <XCircle size={16} className="text-red-400" />
          <span className="text-xs text-white/40">Failed Calls</span>
        </div>
        <p className="text-2xl font-semibold text-white">
          {totals.failedCalls.toLocaleString()}
        </p>
      </div>
      
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <ArrowRightLeft size={16} className="text-orange-400" />
          <span className="text-xs text-white/40">Failovers</span>
        </div>
        <p className="text-2xl font-semibold text-white">
          {totals.failoverIn}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * ProviderMetrics - Main component for displaying provider metrics
 * 
 * @see Requirements: 19.6, 19.7
 */
export function ProviderMetrics({
  providerMetrics,
  providerHealth,
  abTestComparison,
  showABTest = true,
  className,
  periodLabel = 'Last 24 Hours',
}: ProviderMetricsProps) {
  // Filter out providers with no calls
  const activeProviders = useMemo(() => {
    return providerMetrics.filter(m => m.totalCalls > 0);
  }, [providerMetrics]);

  // Get health status for each provider
  const healthMap = useMemo(() => {
    const map = new Map<TelecomProvider, ProviderHealth>();
    for (const health of providerHealth) {
      map.set(health.provider, health);
    }
    return map;
  }, [providerHealth]);

  // Check for any unhealthy providers
  const unhealthyProviders = useMemo(() => {
    return providerHealth.filter(h => h.status !== 'healthy');
  }, [providerHealth]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Signal size={20} className="text-blue-400" />
            Provider Metrics
          </h2>
          <p className="text-sm text-white/60 mt-1">{periodLabel}</p>
        </div>
        
        {unhealthyProviders.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <AlertTriangle size={14} className="text-yellow-400" />
            <span className="text-sm text-yellow-400">
              {unhealthyProviders.length} provider{unhealthyProviders.length > 1 ? 's' : ''} degraded
            </span>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <SummaryStats metrics={providerMetrics} />

      {/* Provider Cards Grid */}
      <div>
        <h3 className="text-sm font-medium text-white/60 mb-3">Provider Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeProviders.map((metrics) => (
            <ProviderCard
              key={metrics.provider}
              metrics={metrics}
              health={healthMap.get(metrics.provider)}
            />
          ))}
        </div>
        
        {activeProviders.length === 0 && (
          <div className="card p-8 text-center">
            <PhoneOff size={48} className="mx-auto text-white/20 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No Call Data</h3>
            <p className="text-sm text-white/60">
              Provider metrics will appear here once calls are processed.
            </p>
          </div>
        )}
      </div>

      {/* A/B Test Section */}
      {showABTest && abTestComparison && (
        <div>
          <h3 className="text-sm font-medium text-white/60 mb-3">A/B Test Comparison</h3>
          <ABTestSection comparison={abTestComparison} />
        </div>
      )}

      {/* Health Status Legend */}
      <div className="card p-4">
        <h3 className="text-sm font-medium text-white mb-3">Status Legend</h3>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-sm text-white/60">Healthy (&gt;90% success)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="text-sm text-white/60">Degraded (70-90% success)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm text-white/60">Unavailable (&lt;70% success)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProviderMetrics;
