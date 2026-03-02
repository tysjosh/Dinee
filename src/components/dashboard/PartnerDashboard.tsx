/**
 * PartnerDashboard - Dashboard component for partner API management
 * 
 * This component displays:
 * - API usage metrics
 * - Webhook delivery status
 * - API key management
 * 
 * @see Requirements: 21.7 - Display API usage metrics and webhook delivery status
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
  Key,
  Activity,
  Webhook,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  BarChart3,
  TrendingUp,
  Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  APIKey,
  APIUsageMetrics,
  WebhookMetrics,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '@/lib/partner-api';

// ============================================================================
// Types
// ============================================================================

export interface PartnerDashboardProps {
  /** Partner ID */
  partnerId: string;
  /** Partner name */
  partnerName: string;
  /** API keys for this partner */
  apiKeys: APIKey[];
  /** API usage metrics */
  usageMetrics: APIUsageMetrics;
  /** Webhook metrics */
  webhookMetrics: WebhookMetrics;
  /** Recent webhook deliveries */
  recentDeliveries: WebhookDelivery[];
  /** Callback to create new API key */
  onCreateKey?: () => void;
  /** Callback to revoke API key */
  onRevokeKey?: (keyId: string) => void;
  /** Callback to retry webhook delivery */
  onRetryDelivery?: (deliveryId: string) => void;
  /** Callback to refresh data */
  onRefresh?: () => void;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Optional class name */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DELIVERY_STATUS_CONFIG: Record<WebhookDeliveryStatus, {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ElementType;
}> = {
  pending: {
    label: 'Pending',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    icon: Clock,
  },
  delivered: {
    label: 'Delivered',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    icon: CheckCircle,
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: XCircle,
  },
  retrying: {
    label: 'Retrying',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: RefreshCw,
  },
};

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Metric card component
 */
function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  status,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  status?: 'success' | 'warning' | 'error';
}) {
  return (
    <div className="card p-5 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={cn(
          "p-2.5 rounded-lg",
          status === 'success' && "bg-emerald-500/20",
          status === 'warning' && "bg-yellow-500/20",
          status === 'error' && "bg-red-500/20",
          !status && "bg-white/5"
        )}>
          <Icon size={20} className={cn(
            status === 'success' && "text-emerald-400",
            status === 'warning' && "text-yellow-400",
            status === 'error' && "text-red-400",
            !status && "text-white/60"
          )} />
        </div>
        {trend && (
          <TrendingUp size={16} className={cn(
            trend === 'up' && "text-emerald-400",
            trend === 'down' && "text-red-400 rotate-180",
            trend === 'neutral' && "text-white/40"
          )} />
        )}
      </div>
      <p className="text-xs text-white/50 mb-1">{title}</p>
      <p className="text-2xl font-semibold text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {subtitle && (
        <p className="text-xs text-white/40 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

/**
 * API key card component
 */
function APIKeyCard({
  apiKey,
  onRevoke,
}: {
  apiKey: APIKey;
  onRevoke?: (keyId: string) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const isActive = apiKey.status === 'active';
  const isExpired = apiKey.expiresAt && apiKey.expiresAt < Date.now();

  return (
    <div className={cn(
      "card p-4 border",
      isActive && !isExpired && "border-emerald-500/20",
      isExpired && "border-yellow-500/20",
      !isActive && "border-red-500/20 opacity-60"
    )}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium text-white">{apiKey.name}</h4>
          <p className="text-xs text-white/40 mt-0.5">
            Created {new Date(apiKey.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className={cn(
          "px-2 py-0.5 rounded text-xs font-medium",
          isActive && !isExpired && "bg-emerald-500/20 text-emerald-400",
          isExpired && "bg-yellow-500/20 text-yellow-400",
          !isActive && "bg-red-500/20 text-red-400"
        )}>
          {isExpired ? 'Expired' : apiKey.status}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <code className="flex-1 px-3 py-2 bg-white/5 rounded text-sm text-white/60 font-mono">
          {showKey ? apiKey.keyPrefix + '...' : '••••••••••••'}
        </code>
        <button
          onClick={() => setShowKey(!showKey)}
          className="p-2 rounded hover:bg-white/10 transition-colors"
          title={showKey ? 'Hide' : 'Show'}
        >
          {showKey ? (
            <EyeOff size={16} className="text-white/60" />
          ) : (
            <Eye size={16} className="text-white/60" />
          )}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(apiKey.keyPrefix)}
          className="p-2 rounded hover:bg-white/10 transition-colors"
          title="Copy prefix"
        >
          <Copy size={16} className="text-white/60" />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-white/40">
          {apiKey.lastUsedAt
            ? `Last used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`
            : 'Never used'
          }
        </div>
        {isActive && onRevoke && (
          <button
            onClick={() => onRevoke(apiKey.id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12} />
            Revoke
          </button>
        )}
      </div>

      {apiKey.scopes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-white/40 mb-2">Scopes</p>
          <div className="flex flex-wrap gap-1">
            {apiKey.scopes.slice(0, 4).map((scope) => (
              <span
                key={scope}
                className="px-2 py-0.5 bg-white/5 rounded text-xs text-white/60"
              >
                {scope}
              </span>
            ))}
            {apiKey.scopes.length > 4 && (
              <span className="px-2 py-0.5 bg-white/5 rounded text-xs text-white/40">
                +{apiKey.scopes.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Webhook delivery row component
 */
function DeliveryRow({
  delivery,
  onRetry,
}: {
  delivery: WebhookDelivery;
  onRetry?: (deliveryId: string) => void;
}) {
  const config = DELIVERY_STATUS_CONFIG[delivery.status ?? 'pending'];
  const StatusIcon = config.icon;

  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-lg", config.bgColor)}>
          <StatusIcon size={16} className={config.color} />
        </div>
        <div>
          <p className="text-sm font-medium text-white">
            {delivery.event?.type ?? 'unknown'}
          </p>
          <p className="text-xs text-white/40">
            {new Date(delivery.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className={cn("text-sm font-medium", config.color)}>
            {config.label}
          </p>
          <p className="text-xs text-white/40">
            {delivery.attempts}/{delivery.maxAttempts} attempts
          </p>
        </div>

        {delivery.status === 'failed' && onRetry && (
          <button
            onClick={() => onRetry(delivery.id)}
            className="p-2 rounded hover:bg-white/10 transition-colors"
            title="Retry"
          >
            <RefreshCw size={16} className="text-white/60" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Endpoint usage chart (simple bar visualization)
 */
function EndpointUsageChart({
  byEndpoint,
}: {
  byEndpoint: Record<string, number>;
}) {
  const entries = Object.entries(byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxValue = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="space-y-3">
      {entries.map(([endpoint, count]) => (
        <div key={endpoint}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-white/60 truncate max-w-[200px]">
              {endpoint}
            </span>
            <span className="text-white font-medium">{count}</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(count / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {entries.length === 0 && (
        <p className="text-sm text-white/40 text-center py-4">
          No endpoint data available
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * PartnerDashboard - Main partner dashboard component
 * 
 * @see Requirements: 21.7 - Display API usage metrics and webhook delivery status
 */
export function PartnerDashboard({
  partnerId,
  partnerName,
  apiKeys,
  usageMetrics,
  webhookMetrics,
  recentDeliveries,
  onCreateKey,
  onRevokeKey,
  onRetryDelivery,
  onRefresh,
  isLoading = false,
  className,
}: PartnerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'webhooks'>('overview');

  // Calculate success rate
  const successRate = usageMetrics.totalRequests > 0
    ? ((usageMetrics.successfulRequests / usageMetrics.totalRequests) * 100).toFixed(1)
    : '100.0';

  // Calculate webhook success rate
  const webhookSuccessRate = webhookMetrics.totalEvents > 0
    ? ((webhookMetrics.delivered / webhookMetrics.totalEvents) * 100).toFixed(1)
    : '100.0';

  // Active API keys count
  const activeKeysCount = apiKeys.filter(k => k.status === 'active').length;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">{partnerName}</h1>
          <p className="text-white/60 text-sm mt-1">Partner API Dashboard</p>
        </div>

        <div className="flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                "bg-white/5 text-white/60 hover:bg-white/10",
                isLoading && "opacity-50 cursor-not-allowed"
              )}
            >
              <RefreshCw size={16} className={cn(isLoading && "animate-spin")} />
              <span className="text-sm">Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['overview', 'keys', 'webhooks'] as const).map((tab) => (
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
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Requests"
              value={usageMetrics.totalRequests}
              subtitle="Last 24 hours"
              icon={Activity}
            />
            <MetricCard
              title="Success Rate"
              value={`${successRate}%`}
              subtitle={`${usageMetrics.failedRequests} failed`}
              icon={CheckCircle}
              status={parseFloat(successRate) >= 99 ? 'success' : parseFloat(successRate) >= 95 ? 'warning' : 'error'}
            />
            <MetricCard
              title="Avg Response Time"
              value={`${usageMetrics.averageResponseTimeMs}ms`}
              icon={Clock}
              status={usageMetrics.averageResponseTimeMs < 200 ? 'success' : usageMetrics.averageResponseTimeMs < 500 ? 'warning' : 'error'}
            />
            <MetricCard
              title="Rate Limited"
              value={usageMetrics.rateLimitedRequests}
              icon={AlertTriangle}
              status={usageMetrics.rateLimitedRequests === 0 ? 'success' : 'warning'}
            />
          </div>

          {/* Endpoint Usage */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <Server size={16} className="text-white/60" />
              Top Endpoints
            </h3>
            <EndpointUsageChart byEndpoint={usageMetrics.byEndpoint} />
          </div>

          {/* Webhook Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                <Webhook size={16} className="text-white/60" />
                Webhook Delivery
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-semibold text-emerald-400">
                    {webhookMetrics.delivered}
                  </p>
                  <p className="text-xs text-white/40">Delivered</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-yellow-400">
                    {webhookMetrics.pending}
                  </p>
                  <p className="text-xs text-white/40">Pending</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold text-red-400">
                    {webhookMetrics.failed}
                  </p>
                  <p className="text-xs text-white/40">Failed</p>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                <Key size={16} className="text-white/60" />
                API Keys
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {activeKeysCount}
                  </p>
                  <p className="text-xs text-white/40">Active keys</p>
                </div>
                <p className="text-sm text-white/40">
                  {apiKeys.length} total
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'keys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-white">API Keys</h3>
            {onCreateKey && (
              <button
                onClick={onCreateKey}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
              >
                <Plus size={16} />
                Create Key
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {apiKeys.map((key) => (
              <APIKeyCard
                key={key.id}
                apiKey={key}
                onRevoke={onRevokeKey}
              />
            ))}
          </div>

          {apiKeys.length === 0 && (
            <div className="card p-8 text-center">
              <Key size={48} className="mx-auto text-white/20 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No API Keys</h3>
              <p className="text-sm text-white/60 mb-4">
                Create an API key to start using the Partner API
              </p>
              {onCreateKey && (
                <button
                  onClick={onCreateKey}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
                >
                  <Plus size={16} />
                  Create Key
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Webhooks Tab */}
      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          {/* Webhook Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Events"
              value={webhookMetrics.totalEvents}
              icon={Webhook}
            />
            <MetricCard
              title="Success Rate"
              value={`${webhookSuccessRate}%`}
              icon={CheckCircle}
              status={parseFloat(webhookSuccessRate) >= 99 ? 'success' : parseFloat(webhookSuccessRate) >= 95 ? 'warning' : 'error'}
            />
            <MetricCard
              title="Avg Delivery Time"
              value={`${webhookMetrics.averageDeliveryTimeMs}ms`}
              icon={Clock}
            />
            <MetricCard
              title="Pending"
              value={webhookMetrics.pending}
              icon={AlertTriangle}
              status={webhookMetrics.pending === 0 ? 'success' : 'warning'}
            />
          </div>

          {/* Recent Deliveries */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-white mb-4">
              Recent Deliveries
            </h3>
            <div className="space-y-2">
              {recentDeliveries.slice(0, 10).map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  onRetry={onRetryDelivery}
                />
              ))}
            </div>

            {recentDeliveries.length === 0 && (
              <p className="text-sm text-white/40 text-center py-8">
                No webhook deliveries yet
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PartnerDashboard;
