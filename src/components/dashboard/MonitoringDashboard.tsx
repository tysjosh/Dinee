/**
 * MonitoringDashboard - Dashboard component for system monitoring and observability
 * 
 * This component displays:
 * - Real-time and historical metrics
 * - Uptime and latency trends
 * - Active alerts and alert history
 * - System health status
 * 
 * @see Requirements: 20.7 - Display real-time and historical metrics
 */

'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Globe,
  Server,
  TrendingUp,
  TrendingDown,
  XCircle,
  Bell,
  BellOff,
  RefreshCw,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  MonitoringDashboardData,
  AggregatedMetrics,
  Alert,
  HealthStatus,
  AlertSeverity,
  TimeSeriesData,
  ExternalService,
} from '@/lib/monitoring';


// ============================================================================
// Types
// ============================================================================

export interface MonitoringDashboardProps {
  /** Dashboard data from MonitoringService */
  data: MonitoringDashboardData;
  /** Callback to refresh data */
  onRefresh?: () => void;
  /** Callback when alert is acknowledged */
  onAcknowledgeAlert?: (alertId: string) => void;
  /** Callback when alert is resolved */
  onResolveAlert?: (alertId: string) => void;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Auto-refresh interval in seconds (0 to disable) */
  autoRefreshInterval?: number;
  /** Optional class name */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const HEALTH_STATUS_CONFIG: Record<HealthStatus, {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ElementType;
}> = {
  healthy: {
    label: 'Healthy',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    icon: CheckCircle,
  },
  degraded: {
    label: 'Degraded',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    icon: AlertTriangle,
  },
  unhealthy: {
    label: 'Unhealthy',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: XCircle,
  },
};

const SEVERITY_CONFIG: Record<AlertSeverity, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  info: {
    label: 'Info',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  warning: {
    label: 'Warning',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
  },
  critical: {
    label: 'Critical',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
  },
};

const EXTERNAL_SERVICE_LABELS: Record<ExternalService, string> = {
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
  whatsapp: 'WhatsApp',
  twilio: 'Twilio',
  asr_provider: 'ASR Provider',
};


// ============================================================================
// Sub-components
// ============================================================================

/**
 * System health status indicator
 */
function HealthStatusBadge({ status }: { status: HealthStatus }) {
  const config = HEALTH_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1.5 rounded-full",
      config.bgColor
    )}>
      <Icon size={16} className={config.color} />
      <span className={cn("text-sm font-medium", config.color)}>
        {config.label}
      </span>
    </div>
  );
}

/**
 * Metric card for displaying key metrics
 */
function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  status,
  subtitle,
}: {
  title: string;
  value: number | string;
  unit?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  status?: HealthStatus;
  subtitle?: string;
}) {
  const statusConfig = status ? HEALTH_STATUS_CONFIG[status] : null;

  return (
    <div className="card p-5 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={cn(
          "p-2.5 rounded-lg",
          statusConfig?.bgColor || "bg-white/5"
        )}>
          <Icon size={20} className={statusConfig?.color || "text-white/60"} />
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 text-xs",
            trend === 'up' && "text-emerald-400",
            trend === 'down' && "text-red-400",
            trend === 'neutral' && "text-white/40"
          )}>
            {trend === 'up' && <TrendingUp size={12} />}
            {trend === 'down' && <TrendingDown size={12} />}
          </div>
        )}
      </div>
      
      <p className="text-xs text-white/50 mb-1">{title}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-white">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {unit && <span className="text-sm text-white/40">{unit}</span>}
      </div>
      {subtitle && (
        <p className="text-xs text-white/40 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

/**
 * Latency metric display with percentiles
 */
function LatencyMetrics({
  title,
  icon: Icon,
  average,
  p50,
  p95,
  p99,
  threshold,
}: {
  title: string;
  icon: React.ElementType;
  average: number;
  p50: number;
  p95: number;
  p99: number;
  threshold: number;
}) {
  const isAboveThreshold = average > threshold;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn(
          "p-2.5 rounded-lg",
          isAboveThreshold ? "bg-red-500/20" : "bg-white/5"
        )}>
          <Icon size={20} className={isAboveThreshold ? "text-red-400" : "text-white/60"} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-white">{title}</h3>
          <p className="text-xs text-white/40">Threshold: {threshold}ms</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="text-center">
          <p className="text-xs text-white/40 mb-1">Avg</p>
          <p className={cn(
            "text-lg font-semibold",
            isAboveThreshold ? "text-red-400" : "text-white"
          )}>
            {average}
          </p>
          <p className="text-xs text-white/40">ms</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-white/40 mb-1">P50</p>
          <p className="text-lg font-semibold text-white">{p50}</p>
          <p className="text-xs text-white/40">ms</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-white/40 mb-1">P95</p>
          <p className={cn(
            "text-lg font-semibold",
            p95 > threshold ? "text-yellow-400" : "text-white"
          )}>
            {p95}
          </p>
          <p className="text-xs text-white/40">ms</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-white/40 mb-1">P99</p>
          <p className={cn(
            "text-lg font-semibold",
            p99 > threshold ? "text-red-400" : "text-white"
          )}>
            {p99}
          </p>
          <p className="text-xs text-white/40">ms</p>
        </div>
      </div>
    </div>
  );
}

/**
 * External service status card
 */
function ExternalServiceCard({
  service,
  data,
}: {
  service: ExternalService;
  data: AggregatedMetrics['externalServices'][ExternalService];
}) {
  const statusConfig = HEALTH_STATUS_CONFIG[data.status];
  const StatusIcon = statusConfig.icon;

  return (
    <div className={cn(
      "card p-4 border",
      data.status === 'healthy' && "border-emerald-500/20",
      data.status === 'degraded' && "border-yellow-500/20",
      data.status === 'unhealthy' && "border-red-500/20"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-white/60" />
          <span className="text-sm font-medium text-white">
            {EXTERNAL_SERVICE_LABELS[service]}
          </span>
        </div>
        <StatusIcon size={16} className={statusConfig.color} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-white/40 text-xs">Requests</p>
          <p className="text-white font-medium">{data.totalRequests}</p>
        </div>
        <div>
          <p className="text-white/40 text-xs">Avg Response</p>
          <p className="text-white font-medium">{data.averageResponseTimeMs}ms</p>
        </div>
        <div>
          <p className="text-white/40 text-xs">Success Rate</p>
          <p className={cn(
            "font-medium",
            data.errorRate > 5 ? "text-red-400" : "text-emerald-400"
          )}>
            {(100 - data.errorRate).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-white/40 text-xs">Last Check</p>
          <p className="text-white/60 text-xs">
            {data.lastChecked > 0 
              ? new Date(data.lastChecked).toLocaleTimeString()
              : 'N/A'
            }
          </p>
        </div>
      </div>
    </div>
  );
}


/**
 * Alert card component
 */
function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
}: {
  alert: Alert;
  onAcknowledge?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
}) {
  const config = SEVERITY_CONFIG[alert.severity];

  return (
    <div className={cn(
      "card p-4 border",
      config.borderColor,
      alert.resolved && "opacity-60"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(
              "px-2 py-0.5 rounded text-xs font-medium",
              config.bgColor,
              config.color
            )}>
              {config.label}
            </span>
            {alert.acknowledged && (
              <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-white/60">
                Acknowledged
              </span>
            )}
            {alert.resolved && (
              <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">
                Resolved
              </span>
            )}
          </div>
          
          <h4 className="text-sm font-medium text-white truncate">
            {alert.title}
          </h4>
          <p className="text-xs text-white/60 mt-1 line-clamp-2">
            {alert.message}
          </p>
          
          <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
            <span>Value: {alert.currentValue.toFixed(2)}</span>
            <span>Threshold: {alert.threshold}</span>
            <span>{new Date(alert.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {!alert.resolved && (
          <div className="flex flex-col gap-1">
            {!alert.acknowledged && onAcknowledge && (
              <button
                onClick={() => onAcknowledge(alert.id)}
                className="p-1.5 rounded hover:bg-white/10 transition-colors"
                title="Acknowledge"
              >
                <Bell size={14} className="text-white/60" />
              </button>
            )}
            {onResolve && (
              <button
                onClick={() => onResolve(alert.id)}
                className="p-1.5 rounded hover:bg-white/10 transition-colors"
                title="Resolve"
              >
                <CheckCircle size={14} className="text-white/60" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Simple time series chart (bar chart visualization)
 */
function SimpleChart({
  data,
  height = 100,
  showLabels = true,
}: {
  data: TimeSeriesData;
  height?: number;
  showLabels?: boolean;
}) {
  if (data.data.length === 0) {
    return (
      <div 
        className="flex items-center justify-center text-white/40 text-sm"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...data.data.map(d => d.value), 1);
  const barWidth = Math.max(4, Math.floor(100 / data.data.length) - 1);

  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end justify-between h-full gap-0.5">
        {data.data.slice(-30).map((point, index) => {
          const barHeight = (point.value / maxValue) * 100;
          return (
            <div
              key={point.timestamp}
              className="flex-1 min-w-1 bg-emerald-500/60 hover:bg-emerald-500 transition-colors rounded-t"
              style={{ height: `${Math.max(barHeight, 2)}%` }}
              title={`${point.value.toFixed(2)} ${data.unit} at ${new Date(point.timestamp).toLocaleTimeString()}`}
            />
          );
        })}
      </div>
      {showLabels && (
        <div className="flex justify-between mt-2 text-xs text-white/40">
          <span>
            {data.data.length > 0 
              ? new Date(data.data[0].timestamp).toLocaleTimeString()
              : ''
            }
          </span>
          <span>
            {data.data.length > 0 
              ? new Date(data.data[data.data.length - 1].timestamp).toLocaleTimeString()
              : ''
            }
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Uptime indicator with percentage
 */
function UptimeIndicator({ percentage }: { percentage: number }) {
  const status: HealthStatus = 
    percentage >= 99.9 ? 'healthy' :
    percentage >= 99 ? 'degraded' : 'unhealthy';
  
  const config = HEALTH_STATUS_CONFIG[status];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-white">System Uptime</h3>
        <HealthStatusBadge status={status} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className={cn("text-4xl font-bold", config.color)}>
          {percentage.toFixed(2)}
        </span>
        <span className="text-lg text-white/40">%</span>
      </div>

      <div className="mt-4">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-500",
              status === 'healthy' && "bg-emerald-500",
              status === 'degraded' && "bg-yellow-500",
              status === 'unhealthy' && "bg-red-500"
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-white/40">
          <span>SLA Target: 99.9%</span>
          <span>{percentage >= 99.9 ? 'Meeting SLA' : 'Below SLA'}</span>
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// Main Component
// ============================================================================

/**
 * MonitoringDashboard - Main monitoring dashboard component
 * 
 * Displays real-time and historical metrics, uptime trends, and alerts.
 * 
 * @see Requirements: 20.7 - Display real-time and historical metrics
 */
export function MonitoringDashboard({
  data,
  onRefresh,
  onAcknowledgeAlert,
  onResolveAlert,
  isLoading = false,
  autoRefreshInterval = 30,
  className,
}: MonitoringDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'services'>('overview');
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefreshInterval <= 0 || !onRefresh) return;

    const interval = setInterval(() => {
      onRefresh();
      setLastRefresh(Date.now());
    }, autoRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefreshInterval, onRefresh]);

  const handleManualRefresh = useCallback(() => {
    if (onRefresh) {
      onRefresh();
      setLastRefresh(Date.now());
    }
  }, [onRefresh]);

  const { current, timeSeries, activeAlerts, recentAlerts } = data;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">System Monitoring</h1>
          <p className="text-white/60 text-sm mt-1">
            Real-time system health and performance metrics
          </p>
        </div>

        <div className="flex items-center gap-3">
          <HealthStatusBadge status={current.systemHealth.status} />
          
          <button
            onClick={handleManualRefresh}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
              "bg-white/5 text-white/60 hover:bg-white/10",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
          >
            <RefreshCw size={16} className={cn(isLoading && "animate-spin")} />
            <span className="text-sm hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Last updated */}
      <div className="text-xs text-white/40">
        Last updated: {new Date(lastRefresh).toLocaleTimeString()}
        {autoRefreshInterval > 0 && ` • Auto-refresh every ${autoRefreshInterval}s`}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['overview', 'alerts', 'services'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-white/60 hover:bg-white/5"
            )}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'alerts' && activeAlerts.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">
                {activeAlerts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total API Requests"
              value={current.api.totalRequests}
              icon={Server}
              status={current.api.errorRate > 1 ? 'degraded' : 'healthy'}
              subtitle={`${current.api.errorRate.toFixed(1)}% error rate`}
            />
            <MetricCard
              title="Database Queries"
              value={current.database.totalQueries}
              icon={Database}
              status={current.database.averageLatencyMs > 200 ? 'degraded' : 'healthy'}
              subtitle={`${current.database.averageLatencyMs}ms avg latency`}
            />
            <MetricCard
              title="Active Alerts"
              value={current.systemHealth.activeAlerts}
              icon={AlertTriangle}
              status={current.systemHealth.activeAlerts > 0 ? 'degraded' : 'healthy'}
            />
            <MetricCard
              title="System Uptime"
              value={`${current.systemHealth.uptimePercentage.toFixed(2)}%`}
              icon={Activity}
              status={current.systemHealth.uptimePercentage >= 99.9 ? 'healthy' : 'degraded'}
            />
          </div>

          {/* Latency Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LatencyMetrics
              title="API Response Time"
              icon={Server}
              average={current.api.averageResponseTimeMs}
              p50={current.api.p50ResponseTimeMs}
              p95={current.api.p95ResponseTimeMs}
              p99={current.api.p99ResponseTimeMs}
              threshold={500}
            />
            <LatencyMetrics
              title="Database Latency"
              icon={Database}
              average={current.database.averageLatencyMs}
              p50={current.database.p50LatencyMs}
              p95={current.database.p95LatencyMs}
              p99={current.database.p99LatencyMs}
              threshold={200}
            />
          </div>

          {/* Uptime and Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <UptimeIndicator percentage={current.systemHealth.uptimePercentage} />
            
            <div className="card p-5">
              <h3 className="text-sm font-medium text-white mb-4">
                API Response Time Trend
              </h3>
              <SimpleChart data={timeSeries.apiResponseTime} height={120} />
            </div>
          </div>

          {/* Error Rate Chart */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-white mb-4">
              Error Rate Trend
            </h3>
            <SimpleChart data={timeSeries.errorRate} height={100} />
          </div>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {/* Active Alerts */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
              <Bell size={18} className="text-red-400" />
              Active Alerts
              {activeAlerts.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">
                  {activeAlerts.length}
                </span>
              )}
            </h3>
            
            {activeAlerts.length === 0 ? (
              <div className="card p-8 text-center">
                <BellOff size={32} className="mx-auto text-white/20 mb-3" />
                <p className="text-white/60">No active alerts</p>
                <p className="text-white/40 text-sm mt-1">
                  All systems are operating normally
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={onAcknowledgeAlert}
                    onResolve={onResolveAlert}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Recent Alerts */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
              <Clock size={18} className="text-white/60" />
              Recent Alerts (24h)
            </h3>
            
            {recentAlerts.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-white/60">No alerts in the last 24 hours</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentAlerts.slice(0, 10).map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={onAcknowledgeAlert}
                    onResolve={onResolveAlert}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Services Tab */}
      {activeTab === 'services' && (
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Globe size={18} className="text-white/60" />
            External Services Status
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.entries(current.externalServices) as [ExternalService, AggregatedMetrics['externalServices'][ExternalService]][]).map(
              ([service, serviceData]) => (
                <ExternalServiceCard
                  key={service}
                  service={service}
                  data={serviceData}
                />
              )
            )}
          </div>

          {/* Service Response Time Trends */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-white mb-4">
              Database Latency Trend
            </h3>
            <SimpleChart data={timeSeries.databaseLatency} height={100} />
          </div>
        </div>
      )}
    </div>
  );
}

export default MonitoringDashboard;
