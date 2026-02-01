/**
 * Monitoring Service Types and Interfaces
 * 
 * This module defines the types and interfaces for the monitoring and observability
 * infrastructure, supporting API endpoint tracking, database query latencies,
 * external service monitoring, and alerting.
 * 
 * @module monitoring/types
 * @requirements 20.1 - Track API endpoint response times
 * @requirements 20.2 - Track database query latencies
 * @requirements 20.3 - Track external service response times
 * @requirements 20.4 - Define SLA thresholds
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 * @requirements 20.7 - Display real-time and historical metrics
 * @requirements 20.8 - Support email and Slack notifications
 */

// ============================================================================
// Metric Types
// ============================================================================

/**
 * Types of metrics that can be tracked
 */
export type MetricType = 
  | 'api_response_time'
  | 'database_query_latency'
  | 'external_service_response_time'
  | 'uptime_check'
  | 'error_rate';

/**
 * External services that can be monitored
 * @requirements 20.3 - Track external service response times
 */
export type ExternalService = 
  | 'paystack'
  | 'flutterwave'
  | 'whatsapp'
  | 'twilio'
  | 'asr_provider';

/**
 * Status of a health check
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Alert notification channels
 * @requirements 20.8 - Support email and Slack notifications
 */
export type NotificationChannel = 'email' | 'slack' | 'webhook';

// ============================================================================
// Metric Data Structures
// ============================================================================

/**
 * Base metric data structure
 */
export interface BaseMetric {
  /** Unique identifier for the metric */
  id: string;
  /** Type of metric */
  type: MetricType;
  /** Timestamp when the metric was recorded */
  timestamp: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * API response time metric
 * @requirements 20.1 - Track API endpoint response times
 */
export interface APIResponseMetric extends BaseMetric {
  type: 'api_response_time';
  /** API endpoint path */
  endpoint: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** HTTP status code */
  statusCode: number;
  /** Whether the request was successful */
  success: boolean;
  /** Request ID for tracing */
  requestId?: string;
}

/**
 * Database query latency metric
 * @requirements 20.2 - Track database query latencies
 */
export interface DatabaseQueryMetric extends BaseMetric {
  type: 'database_query_latency';
  /** Query operation type */
  operation: 'query' | 'mutation' | 'action';
  /** Name of the query/mutation */
  queryName: string;
  /** Query execution time in milliseconds */
  latencyMs: number;
  /** Whether the query was successful */
  success: boolean;
  /** Number of rows affected/returned */
  rowCount?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * External service response time metric
 * @requirements 20.3 - Track external service response times
 */
export interface ExternalServiceMetric extends BaseMetric {
  type: 'external_service_response_time';
  /** Name of the external service */
  service: ExternalService;
  /** Operation performed */
  operation: string;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Whether the request was successful */
  success: boolean;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Uptime check metric
 */
export interface UptimeMetric extends BaseMetric {
  type: 'uptime_check';
  /** Service or endpoint being checked */
  target: string;
  /** Whether the check passed */
  isUp: boolean;
  /** Response time in milliseconds */
  responseTimeMs?: number;
  /** Error message if down */
  error?: string;
}

/**
 * Error rate metric
 */
export interface ErrorRateMetric extends BaseMetric {
  type: 'error_rate';
  /** Service or endpoint */
  target: string;
  /** Total requests in the window */
  totalRequests: number;
  /** Failed requests in the window */
  failedRequests: number;
  /** Error rate percentage */
  errorRate: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/**
 * Union type for all metrics
 */
export type Metric = 
  | APIResponseMetric 
  | DatabaseQueryMetric 
  | ExternalServiceMetric 
  | UptimeMetric 
  | ErrorRateMetric;

// ============================================================================
// SLA Configuration
// ============================================================================

/**
 * SLA threshold configuration
 * @requirements 20.4 - Define SLA thresholds: 99.9% uptime, <500ms API response time
 */
export interface SLAThresholds {
  /** Maximum acceptable API response time in milliseconds */
  maxApiResponseTimeMs: number;
  /** Maximum acceptable database query latency in milliseconds */
  maxDatabaseLatencyMs: number;
  /** Maximum acceptable external service response time in milliseconds */
  maxExternalServiceResponseTimeMs: number;
  /** Minimum acceptable uptime percentage (0-100) */
  minUptimePercentage: number;
  /** Maximum acceptable error rate percentage (0-100) */
  maxErrorRatePercentage: number;
}

/**
 * Default SLA thresholds
 * @requirements 20.4 - 99.9% uptime, <500ms API response time
 */
export const DEFAULT_SLA_THRESHOLDS: SLAThresholds = {
  maxApiResponseTimeMs: 500,
  maxDatabaseLatencyMs: 200,
  maxExternalServiceResponseTimeMs: 2000,
  minUptimePercentage: 99.9,
  maxErrorRatePercentage: 1,
};

// ============================================================================
// Alert Types
// ============================================================================

/**
 * Alert definition
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 */
export interface Alert {
  /** Unique identifier for the alert */
  id: string;
  /** Alert severity */
  severity: AlertSeverity;
  /** Alert title */
  title: string;
  /** Detailed alert message */
  message: string;
  /** Type of metric that triggered the alert */
  metricType: MetricType;
  /** Current value that triggered the alert */
  currentValue: number;
  /** Threshold that was breached */
  threshold: number;
  /** Timestamp when the alert was created */
  timestamp: number;
  /** Whether the alert has been acknowledged */
  acknowledged: boolean;
  /** Timestamp when the alert was acknowledged */
  acknowledgedAt?: number;
  /** User who acknowledged the alert */
  acknowledgedBy?: string;
  /** Whether the alert has been resolved */
  resolved: boolean;
  /** Timestamp when the alert was resolved */
  resolvedAt?: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Alert rule configuration
 */
export interface AlertRule {
  /** Unique identifier for the rule */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Metric type to monitor */
  metricType: MetricType;
  /** Threshold value */
  threshold: number;
  /** Comparison operator */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  /** Alert severity when triggered */
  severity: AlertSeverity;
  /** Notification channels to use */
  channels: NotificationChannel[];
  /** Whether the rule is enabled */
  enabled: boolean;
  /** Cooldown period in seconds before re-alerting */
  cooldownSeconds: number;
  /** Number of consecutive breaches before alerting */
  consecutiveBreaches: number;
}

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification configuration
 * @requirements 20.8 - Support email and Slack notifications
 */
export interface NotificationConfig {
  /** Email notification settings */
  email?: {
    enabled: boolean;
    recipients: string[];
    fromAddress?: string;
  };
  /** Slack notification settings */
  slack?: {
    enabled: boolean;
    webhookUrl: string;
    channel?: string;
    username?: string;
  };
  /** Generic webhook notification settings */
  webhook?: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  /** Alert that triggered the notification */
  alert: Alert;
  /** Notification channel */
  channel: NotificationChannel;
  /** Timestamp when notification was sent */
  sentAt: number;
  /** Whether the notification was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Dashboard Types
// ============================================================================

/**
 * Aggregated metrics for dashboard display
 * @requirements 20.7 - Display real-time and historical metrics
 */
export interface AggregatedMetrics {
  /** Time period for aggregation */
  period: {
    start: number;
    end: number;
  };
  /** API metrics summary */
  api: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTimeMs: number;
    p50ResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
    errorRate: number;
  };
  /** Database metrics summary */
  database: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
  };
  /** External service metrics summary */
  externalServices: Record<ExternalService, {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTimeMs: number;
    errorRate: number;
    lastChecked: number;
    status: HealthStatus;
  }>;
  /** Overall system health */
  systemHealth: {
    status: HealthStatus;
    uptimePercentage: number;
    activeAlerts: number;
    lastUpdated: number;
  };
}

/**
 * Time series data point for charts
 */
export interface TimeSeriesDataPoint {
  /** Timestamp */
  timestamp: number;
  /** Value */
  value: number;
  /** Optional label */
  label?: string;
}

/**
 * Time series data for dashboard charts
 */
export interface TimeSeriesData {
  /** Metric name */
  name: string;
  /** Data points */
  data: TimeSeriesDataPoint[];
  /** Unit of measurement */
  unit: string;
}

/**
 * Dashboard data structure
 * @requirements 20.7 - Display real-time and historical metrics
 */
export interface MonitoringDashboardData {
  /** Current aggregated metrics */
  current: AggregatedMetrics;
  /** Historical time series data */
  timeSeries: {
    apiResponseTime: TimeSeriesData;
    databaseLatency: TimeSeriesData;
    errorRate: TimeSeriesData;
    uptime: TimeSeriesData;
  };
  /** Active alerts */
  activeAlerts: Alert[];
  /** Recent alerts (last 24 hours) */
  recentAlerts: Alert[];
}

// ============================================================================
// Service Configuration
// ============================================================================

/**
 * Monitoring service configuration
 */
export interface MonitoringServiceConfig {
  /** SLA thresholds */
  slaThresholds?: Partial<SLAThresholds>;
  /** Notification configuration */
  notifications?: NotificationConfig;
  /** Alert rules */
  alertRules?: AlertRule[];
  /** Metrics retention period in days */
  retentionDays?: number;
  /** Aggregation interval in seconds */
  aggregationIntervalSeconds?: number;
  /** Whether to enable real-time monitoring */
  enableRealTimeMonitoring?: boolean;
  /** Custom metric handlers */
  metricHandlers?: {
    onMetricRecorded?: (metric: Metric) => void;
    onAlertTriggered?: (alert: Alert) => void;
    onAlertResolved?: (alert: Alert) => void;
  };
}

/**
 * Default monitoring service configuration
 */
export const DEFAULT_MONITORING_CONFIG: MonitoringServiceConfig = {
  slaThresholds: DEFAULT_SLA_THRESHOLDS,
  retentionDays: 30,
  aggregationIntervalSeconds: 60,
  enableRealTimeMonitoring: true,
};

// ============================================================================
// Monitoring Service Interface
// ============================================================================

/**
 * Monitoring Service interface
 */
export interface MonitoringService {
  // Metric recording
  recordAPIMetric(metric: Omit<APIResponseMetric, 'id' | 'type' | 'timestamp'>): void;
  recordDatabaseMetric(metric: Omit<DatabaseQueryMetric, 'id' | 'type' | 'timestamp'>): void;
  recordExternalServiceMetric(metric: Omit<ExternalServiceMetric, 'id' | 'type' | 'timestamp'>): void;
  recordUptimeCheck(metric: Omit<UptimeMetric, 'id' | 'type' | 'timestamp'>): void;
  
  // Metric retrieval
  getMetrics(filter: MetricFilter): Metric[];
  getAggregatedMetrics(period: { start: number; end: number }): AggregatedMetrics;
  getTimeSeriesData(metricType: MetricType, period: { start: number; end: number }): TimeSeriesData;
  
  // Alert management
  getActiveAlerts(): Alert[];
  getAlertHistory(filter: AlertFilter): Alert[];
  acknowledgeAlert(alertId: string, userId: string): void;
  resolveAlert(alertId: string): void;
  
  // Health checks
  getSystemHealth(): { status: HealthStatus; details: Record<string, HealthStatus> };
  getUptimePercentage(period: { start: number; end: number }): number;
  
  // Dashboard data
  getDashboardData(): MonitoringDashboardData;
  
  // Configuration
  updateConfig(config: Partial<MonitoringServiceConfig>): void;
  getConfig(): MonitoringServiceConfig;
}

/**
 * Filter for querying metrics
 */
export interface MetricFilter {
  /** Filter by metric type */
  type?: MetricType;
  /** Filter by start timestamp */
  startTime?: number;
  /** Filter by end timestamp */
  endTime?: number;
  /** Filter by success status */
  success?: boolean;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Filter for querying alerts
 */
export interface AlertFilter {
  /** Filter by severity */
  severity?: AlertSeverity;
  /** Filter by acknowledged status */
  acknowledged?: boolean;
  /** Filter by resolved status */
  resolved?: boolean;
  /** Filter by start timestamp */
  startTime?: number;
  /** Filter by end timestamp */
  endTime?: number;
  /** Maximum number of results */
  limit?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Monitoring service error codes
 */
export type MonitoringErrorCode =
  | 'METRIC_RECORDING_FAILED'
  | 'ALERT_NOT_FOUND'
  | 'NOTIFICATION_FAILED'
  | 'CONFIGURATION_ERROR'
  | 'AGGREGATION_FAILED';

/**
 * Monitoring service error
 */
export interface MonitoringError {
  /** Error code */
  code: MonitoringErrorCode;
  /** Error message */
  message: string;
  /** Original error if available */
  cause?: Error;
  /** Additional context */
  context?: Record<string, unknown>;
}
