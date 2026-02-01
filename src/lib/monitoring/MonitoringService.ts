/**
 * Monitoring Service Implementation
 * 
 * Implements the MonitoringService interface to provide comprehensive
 * monitoring and observability for the platform, including:
 * - API endpoint response time tracking
 * - Database query latency tracking
 * - External service response time tracking
 * - SLA threshold monitoring and alerting
 * 
 * @module monitoring/MonitoringService
 * @requirements 20.1 - Track API endpoint response times
 * @requirements 20.2 - Track database query latencies
 * @requirements 20.3 - Track external service response times
 * @requirements 20.4 - Define SLA thresholds
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 */

import type {
  MonitoringService,
  MonitoringServiceConfig,
  Metric,
  MetricType,
  MetricFilter,
  APIResponseMetric,
  DatabaseQueryMetric,
  ExternalServiceMetric,
  UptimeMetric,
  ErrorRateMetric,
  Alert,
  AlertFilter,
  AlertSeverity,
  AlertRule,
  AggregatedMetrics,
  TimeSeriesData,
  TimeSeriesDataPoint,
  MonitoringDashboardData,
  HealthStatus,
  ExternalService,
  SLAThresholds,
  NotificationChannel,
  NotificationConfig,
} from './types';
import {
  DEFAULT_SLA_THRESHOLDS,
  DEFAULT_MONITORING_CONFIG,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Maximum metrics to keep in memory */
const MAX_METRICS_IN_MEMORY = 10000;

/** Maximum alerts to keep in memory */
const MAX_ALERTS_IN_MEMORY = 1000;

/** Default aggregation window in milliseconds (1 minute) */
const DEFAULT_AGGREGATION_WINDOW_MS = 60 * 1000;


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for metrics and alerts
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
}

/**
 * Calculate percentile from sorted array
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

/**
 * Determine health status based on error rate and latency
 */
function determineHealthStatus(
  errorRate: number,
  avgLatencyMs: number,
  thresholds: SLAThresholds
): HealthStatus {
  if (errorRate > thresholds.maxErrorRatePercentage * 2 || avgLatencyMs > thresholds.maxApiResponseTimeMs * 2) {
    return 'unhealthy';
  }
  if (errorRate > thresholds.maxErrorRatePercentage || avgLatencyMs > thresholds.maxApiResponseTimeMs) {
    return 'degraded';
  }
  return 'healthy';
}

// ============================================================================
// Default Alert Rules
// ============================================================================

/**
 * Default alert rules based on SLA thresholds
 * @requirements 20.4 - Define SLA thresholds: 99.9% uptime, <500ms API response time
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 */
const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'rule_api_latency_warning',
    name: 'API Latency Warning',
    description: 'Alert when API response time exceeds 400ms',
    metricType: 'api_response_time',
    threshold: 400,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 3,
  },
  {
    id: 'rule_api_latency_critical',
    name: 'API Latency Critical',
    description: 'Alert when API response time exceeds 500ms (SLA breach)',
    metricType: 'api_response_time',
    threshold: 500,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 2,
  },
  {
    id: 'rule_db_latency_warning',
    name: 'Database Latency Warning',
    description: 'Alert when database query latency exceeds 150ms',
    metricType: 'database_query_latency',
    threshold: 150,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 5,
  },
  {
    id: 'rule_db_latency_critical',
    name: 'Database Latency Critical',
    description: 'Alert when database query latency exceeds 200ms',
    metricType: 'database_query_latency',
    threshold: 200,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 3,
  },
  {
    id: 'rule_external_service_latency',
    name: 'External Service Latency',
    description: 'Alert when external service response time exceeds 2000ms',
    metricType: 'external_service_response_time',
    threshold: 2000,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 2,
  },
  {
    id: 'rule_uptime_critical',
    name: 'Uptime Critical',
    description: 'Alert when uptime falls below 99.9%',
    metricType: 'uptime_check',
    threshold: 99.9,
    operator: 'lt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 1,
  },
];


// ============================================================================
// Monitoring Service Implementation
// ============================================================================

/**
 * Unified Monitoring Service
 * 
 * Provides comprehensive monitoring and observability for the platform,
 * including metric tracking, alerting, and dashboard data aggregation.
 * 
 * @requirements 20.1 - Track API endpoint response times
 * @requirements 20.2 - Track database query latencies
 * @requirements 20.3 - Track external service response times
 * @requirements 20.4 - Define SLA thresholds
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 * 
 * @example
 * ```typescript
 * const monitoringService = createMonitoringService({
 *   slaThresholds: {
 *     maxApiResponseTimeMs: 500,
 *     minUptimePercentage: 99.9,
 *   },
 *   notifications: {
 *     slack: {
 *       enabled: true,
 *       webhookUrl: 'https://hooks.slack.com/...',
 *     },
 *   },
 * });
 * 
 * // Record API metric
 * monitoringService.recordAPIMetric({
 *   endpoint: '/api/orders',
 *   method: 'POST',
 *   responseTimeMs: 150,
 *   statusCode: 200,
 *   success: true,
 * });
 * ```
 */
export class UnifiedMonitoringService implements MonitoringService {
  private config: MonitoringServiceConfig;
  private slaThresholds: SLAThresholds;
  private alertRules: AlertRule[];
  
  // In-memory storage for metrics
  private metrics: Metric[] = [];
  
  // In-memory storage for alerts
  private alerts: Alert[] = [];
  
  // Track consecutive breaches for alert rules
  private breachCounts: Map<string, number> = new Map();
  
  // Track last alert time for cooldown
  private lastAlertTime: Map<string, number> = new Map();
  
  // Track uptime checks
  private uptimeChecks: Map<string, { up: number; total: number }> = new Map();

  constructor(config: MonitoringServiceConfig = {}) {
    this.config = {
      ...DEFAULT_MONITORING_CONFIG,
      ...config,
    };
    
    this.slaThresholds = {
      ...DEFAULT_SLA_THRESHOLDS,
      ...config.slaThresholds,
    };
    
    this.alertRules = config.alertRules || DEFAULT_ALERT_RULES;
  }

  // ==========================================================================
  // Metric Recording Methods
  // ==========================================================================

  /**
   * Record an API response time metric
   * @requirements 20.1 - Track API endpoint response times
   */
  recordAPIMetric(
    metric: Omit<APIResponseMetric, 'id' | 'type' | 'timestamp'>
  ): void {
    const fullMetric: APIResponseMetric = {
      ...metric,
      id: generateId('API'),
      type: 'api_response_time',
      timestamp: Date.now(),
    };
    
    this.addMetric(fullMetric);
    this.checkAlertRules(fullMetric);
  }

  /**
   * Record a database query latency metric
   * @requirements 20.2 - Track database query latencies
   */
  recordDatabaseMetric(
    metric: Omit<DatabaseQueryMetric, 'id' | 'type' | 'timestamp'>
  ): void {
    const fullMetric: DatabaseQueryMetric = {
      ...metric,
      id: generateId('DB'),
      type: 'database_query_latency',
      timestamp: Date.now(),
    };
    
    this.addMetric(fullMetric);
    this.checkAlertRules(fullMetric);
  }

  /**
   * Record an external service response time metric
   * @requirements 20.3 - Track external service response times
   */
  recordExternalServiceMetric(
    metric: Omit<ExternalServiceMetric, 'id' | 'type' | 'timestamp'>
  ): void {
    const fullMetric: ExternalServiceMetric = {
      ...metric,
      id: generateId('EXT'),
      type: 'external_service_response_time',
      timestamp: Date.now(),
    };
    
    this.addMetric(fullMetric);
    this.checkAlertRules(fullMetric);
  }

  /**
   * Record an uptime check metric
   */
  recordUptimeCheck(
    metric: Omit<UptimeMetric, 'id' | 'type' | 'timestamp'>
  ): void {
    const fullMetric: UptimeMetric = {
      ...metric,
      id: generateId('UP'),
      type: 'uptime_check',
      timestamp: Date.now(),
    };
    
    this.addMetric(fullMetric);
    
    // Update uptime tracking
    const current = this.uptimeChecks.get(metric.target) || { up: 0, total: 0 };
    current.total++;
    if (metric.isUp) {
      current.up++;
    }
    this.uptimeChecks.set(metric.target, current);
    
    // Check uptime threshold
    const uptimePercentage = (current.up / current.total) * 100;
    if (uptimePercentage < this.slaThresholds.minUptimePercentage) {
      this.checkUptimeAlert(metric.target, uptimePercentage);
    }
  }


  // ==========================================================================
  // Metric Retrieval Methods
  // ==========================================================================

  /**
   * Get metrics with optional filtering
   */
  getMetrics(filter: MetricFilter): Metric[] {
    let result = [...this.metrics];
    
    if (filter.type) {
      result = result.filter(m => m.type === filter.type);
    }
    
    if (filter.startTime) {
      result = result.filter(m => m.timestamp >= filter.startTime!);
    }
    
    if (filter.endTime) {
      result = result.filter(m => m.timestamp <= filter.endTime!);
    }
    
    if (filter.success !== undefined) {
      result = result.filter(m => {
        if ('success' in m) {
          return m.success === filter.success;
        }
        return true;
      });
    }
    
    // Sort by timestamp descending
    result.sort((a, b) => b.timestamp - a.timestamp);
    
    // Apply pagination
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }
    
    return result;
  }

  /**
   * Get aggregated metrics for a time period
   * @requirements 20.7 - Display real-time and historical metrics
   */
  getAggregatedMetrics(period: { start: number; end: number }): AggregatedMetrics {
    const metricsInPeriod = this.metrics.filter(
      m => m.timestamp >= period.start && m.timestamp <= period.end
    );
    
    // Aggregate API metrics
    const apiMetrics = metricsInPeriod.filter(
      (m): m is APIResponseMetric => m.type === 'api_response_time'
    );
    const apiResponseTimes = apiMetrics.map(m => m.responseTimeMs).sort((a, b) => a - b);
    
    // Aggregate database metrics
    const dbMetrics = metricsInPeriod.filter(
      (m): m is DatabaseQueryMetric => m.type === 'database_query_latency'
    );
    const dbLatencies = dbMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
    
    // Aggregate external service metrics
    const extMetrics = metricsInPeriod.filter(
      (m): m is ExternalServiceMetric => m.type === 'external_service_response_time'
    );
    
    const externalServices = this.aggregateExternalServiceMetrics(extMetrics);
    
    // Calculate overall system health
    const apiErrorRate = apiMetrics.length > 0
      ? (apiMetrics.filter(m => !m.success).length / apiMetrics.length) * 100
      : 0;
    const avgApiLatency = apiResponseTimes.length > 0
      ? apiResponseTimes.reduce((a, b) => a + b, 0) / apiResponseTimes.length
      : 0;
    
    return {
      period,
      api: {
        totalRequests: apiMetrics.length,
        successfulRequests: apiMetrics.filter(m => m.success).length,
        failedRequests: apiMetrics.filter(m => !m.success).length,
        averageResponseTimeMs: Math.round(avgApiLatency),
        p50ResponseTimeMs: calculatePercentile(apiResponseTimes, 50),
        p95ResponseTimeMs: calculatePercentile(apiResponseTimes, 95),
        p99ResponseTimeMs: calculatePercentile(apiResponseTimes, 99),
        errorRate: Math.round(apiErrorRate * 100) / 100,
      },
      database: {
        totalQueries: dbMetrics.length,
        successfulQueries: dbMetrics.filter(m => m.success).length,
        failedQueries: dbMetrics.filter(m => !m.success).length,
        averageLatencyMs: dbLatencies.length > 0
          ? Math.round(dbLatencies.reduce((a, b) => a + b, 0) / dbLatencies.length)
          : 0,
        p50LatencyMs: calculatePercentile(dbLatencies, 50),
        p95LatencyMs: calculatePercentile(dbLatencies, 95),
        p99LatencyMs: calculatePercentile(dbLatencies, 99),
      },
      externalServices,
      systemHealth: {
        status: determineHealthStatus(apiErrorRate, avgApiLatency, this.slaThresholds),
        uptimePercentage: this.calculateOverallUptime(),
        activeAlerts: this.getActiveAlerts().length,
        lastUpdated: Date.now(),
      },
    };
  }

  /**
   * Get time series data for a specific metric type
   * @requirements 20.7 - Display real-time and historical metrics
   */
  getTimeSeriesData(
    metricType: MetricType,
    period: { start: number; end: number }
  ): TimeSeriesData {
    const metricsInPeriod = this.metrics.filter(
      m => m.type === metricType && m.timestamp >= period.start && m.timestamp <= period.end
    );
    
    // Group by time buckets (1 minute intervals)
    const bucketSize = DEFAULT_AGGREGATION_WINDOW_MS;
    const buckets = new Map<number, number[]>();
    
    metricsInPeriod.forEach(m => {
      const bucketKey = Math.floor(m.timestamp / bucketSize) * bucketSize;
      const values = buckets.get(bucketKey) || [];
      
      // Extract the relevant value based on metric type
      let value = 0;
      if (m.type === 'api_response_time') {
        value = (m as APIResponseMetric).responseTimeMs;
      } else if (m.type === 'database_query_latency') {
        value = (m as DatabaseQueryMetric).latencyMs;
      } else if (m.type === 'external_service_response_time') {
        value = (m as ExternalServiceMetric).responseTimeMs;
      } else if (m.type === 'uptime_check') {
        value = (m as UptimeMetric).isUp ? 100 : 0;
      }
      
      values.push(value);
      buckets.set(bucketKey, values);
    });
    
    // Convert to time series data points
    const data: TimeSeriesDataPoint[] = Array.from(buckets.entries())
      .map(([timestamp, values]) => ({
        timestamp,
        value: values.reduce((a, b) => a + b, 0) / values.length,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const unitMap: Record<MetricType, string> = {
      api_response_time: 'ms',
      database_query_latency: 'ms',
      external_service_response_time: 'ms',
      uptime_check: '%',
      error_rate: '%',
    };
    
    return {
      name: metricType,
      data,
      unit: unitMap[metricType] || 'ms',
    };
  }


  // ==========================================================================
  // Alert Management Methods
  // ==========================================================================

  /**
   * Get all active (unresolved) alerts
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  /**
   * Get alert history with optional filtering
   */
  getAlertHistory(filter: AlertFilter): Alert[] {
    let result = [...this.alerts];
    
    if (filter.severity) {
      result = result.filter(a => a.severity === filter.severity);
    }
    
    if (filter.acknowledged !== undefined) {
      result = result.filter(a => a.acknowledged === filter.acknowledged);
    }
    
    if (filter.resolved !== undefined) {
      result = result.filter(a => a.resolved === filter.resolved);
    }
    
    if (filter.startTime) {
      result = result.filter(a => a.timestamp >= filter.startTime!);
    }
    
    if (filter.endTime) {
      result = result.filter(a => a.timestamp <= filter.endTime!);
    }
    
    // Sort by timestamp descending
    result.sort((a, b) => b.timestamp - a.timestamp);
    
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }
    
    return result;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, userId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      alert.acknowledgedBy = userId;
    }
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      // Call handler if configured
      if (this.config.metricHandlers?.onAlertResolved) {
        this.config.metricHandlers.onAlertResolved(alert);
      }
    }
  }

  // ==========================================================================
  // Health Check Methods
  // ==========================================================================

  /**
   * Get overall system health status
   */
  getSystemHealth(): { status: HealthStatus; details: Record<string, HealthStatus> } {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    const recentMetrics = this.getAggregatedMetrics({
      start: fiveMinutesAgo,
      end: now,
    });
    
    const details: Record<string, HealthStatus> = {
      api: determineHealthStatus(
        recentMetrics.api.errorRate,
        recentMetrics.api.averageResponseTimeMs,
        this.slaThresholds
      ),
      database: recentMetrics.database.averageLatencyMs > this.slaThresholds.maxDatabaseLatencyMs
        ? 'degraded'
        : 'healthy',
    };
    
    // Add external service health
    for (const [service, data] of Object.entries(recentMetrics.externalServices)) {
      details[service] = data.status;
    }
    
    // Overall status is the worst of all components
    const statuses = Object.values(details);
    let overallStatus: HealthStatus = 'healthy';
    if (statuses.includes('unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overallStatus = 'degraded';
    }
    
    return { status: overallStatus, details };
  }

  /**
   * Get uptime percentage for a time period
   */
  getUptimePercentage(period: { start: number; end: number }): number {
    const uptimeMetrics = this.metrics.filter(
      (m): m is UptimeMetric =>
        m.type === 'uptime_check' &&
        m.timestamp >= period.start &&
        m.timestamp <= period.end
    );
    
    if (uptimeMetrics.length === 0) {
      return 100; // No data means we assume 100% uptime
    }
    
    const upCount = uptimeMetrics.filter(m => m.isUp).length;
    return (upCount / uptimeMetrics.length) * 100;
  }

  // ==========================================================================
  // Dashboard Data Methods
  // ==========================================================================

  /**
   * Get complete dashboard data
   * @requirements 20.7 - Display real-time and historical metrics
   */
  getDashboardData(): MonitoringDashboardData {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    
    const period = { start: oneHourAgo, end: now };
    
    return {
      current: this.getAggregatedMetrics(period),
      timeSeries: {
        apiResponseTime: this.getTimeSeriesData('api_response_time', period),
        databaseLatency: this.getTimeSeriesData('database_query_latency', period),
        errorRate: this.calculateErrorRateTimeSeries(period),
        uptime: this.getTimeSeriesData('uptime_check', period),
      },
      activeAlerts: this.getActiveAlerts(),
      recentAlerts: this.getAlertHistory({
        startTime: oneDayAgo,
        limit: 50,
      }),
    };
  }

  // ==========================================================================
  // Configuration Methods
  // ==========================================================================

  /**
   * Update monitoring configuration
   */
  updateConfig(config: Partial<MonitoringServiceConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
    
    if (config.slaThresholds) {
      this.slaThresholds = {
        ...this.slaThresholds,
        ...config.slaThresholds,
      };
    }
    
    if (config.alertRules) {
      this.alertRules = config.alertRules;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): MonitoringServiceConfig {
    return { ...this.config };
  }


  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Add a metric to storage with size management
   */
  private addMetric(metric: Metric): void {
    this.metrics.push(metric);
    
    // Trim old metrics if we exceed the limit
    if (this.metrics.length > MAX_METRICS_IN_MEMORY) {
      this.metrics = this.metrics.slice(-MAX_METRICS_IN_MEMORY);
    }
    
    // Call handler if configured
    if (this.config.metricHandlers?.onMetricRecorded) {
      this.config.metricHandlers.onMetricRecorded(metric);
    }
  }

  /**
   * Check alert rules against a metric
   * @requirements 20.5 - Trigger alerts on latency threshold breach
   */
  private checkAlertRules(metric: Metric): void {
    const applicableRules = this.alertRules.filter(
      rule => rule.enabled && rule.metricType === metric.type
    );
    
    for (const rule of applicableRules) {
      const value = this.extractMetricValue(metric);
      const breached = this.isThresholdBreached(value, rule.threshold, rule.operator);
      
      if (breached) {
        this.handleBreach(rule, value, metric);
      } else {
        // Reset breach count on success
        this.breachCounts.set(rule.id, 0);
      }
    }
  }

  /**
   * Check uptime alert threshold
   * @requirements 20.6 - Trigger alerts on uptime threshold breach
   */
  private checkUptimeAlert(target: string, uptimePercentage: number): void {
    const uptimeRule = this.alertRules.find(
      r => r.metricType === 'uptime_check' && r.enabled
    );
    
    if (uptimeRule && uptimePercentage < uptimeRule.threshold) {
      this.createAlert({
        severity: uptimeRule.severity,
        title: `Uptime Below SLA Threshold`,
        message: `${target} uptime is ${uptimePercentage.toFixed(2)}%, below the ${uptimeRule.threshold}% threshold`,
        metricType: 'uptime_check',
        currentValue: uptimePercentage,
        threshold: uptimeRule.threshold,
        context: { target },
      });
    }
  }

  /**
   * Handle a threshold breach
   */
  private handleBreach(rule: AlertRule, value: number, metric: Metric): void {
    const currentBreaches = (this.breachCounts.get(rule.id) || 0) + 1;
    this.breachCounts.set(rule.id, currentBreaches);
    
    // Check if we've hit the consecutive breach threshold
    if (currentBreaches >= rule.consecutiveBreaches) {
      // Check cooldown
      const lastAlert = this.lastAlertTime.get(rule.id) || 0;
      const cooldownMs = rule.cooldownSeconds * 1000;
      
      if (Date.now() - lastAlert >= cooldownMs) {
        this.createAlert({
          severity: rule.severity,
          title: rule.name,
          message: `${rule.description}. Current value: ${value.toFixed(2)}, Threshold: ${rule.threshold}`,
          metricType: rule.metricType,
          currentValue: value,
          threshold: rule.threshold,
          context: { ruleId: rule.id, metric },
        });
        
        this.lastAlertTime.set(rule.id, Date.now());
        this.breachCounts.set(rule.id, 0);
        
        // Send notifications
        this.sendNotifications(rule.channels, this.alerts[this.alerts.length - 1]);
      }
    }
  }

  /**
   * Create a new alert
   */
  private createAlert(params: {
    severity: AlertSeverity;
    title: string;
    message: string;
    metricType: MetricType;
    currentValue: number;
    threshold: number;
    context?: Record<string, unknown>;
  }): void {
    const alert: Alert = {
      id: generateId('ALERT'),
      severity: params.severity,
      title: params.title,
      message: params.message,
      metricType: params.metricType,
      currentValue: params.currentValue,
      threshold: params.threshold,
      timestamp: Date.now(),
      acknowledged: false,
      resolved: false,
      context: params.context,
    };
    
    this.alerts.push(alert);
    
    // Trim old alerts if we exceed the limit
    if (this.alerts.length > MAX_ALERTS_IN_MEMORY) {
      this.alerts = this.alerts.slice(-MAX_ALERTS_IN_MEMORY);
    }
    
    // Call handler if configured
    if (this.config.metricHandlers?.onAlertTriggered) {
      this.config.metricHandlers.onAlertTriggered(alert);
    }
  }

  /**
   * Extract numeric value from a metric
   */
  private extractMetricValue(metric: Metric): number {
    switch (metric.type) {
      case 'api_response_time':
        return (metric as APIResponseMetric).responseTimeMs;
      case 'database_query_latency':
        return (metric as DatabaseQueryMetric).latencyMs;
      case 'external_service_response_time':
        return (metric as ExternalServiceMetric).responseTimeMs;
      case 'uptime_check':
        return (metric as UptimeMetric).isUp ? 100 : 0;
      case 'error_rate':
        return (metric as ErrorRateMetric).errorRate;
      default:
        return 0;
    }
  }

  /**
   * Check if a threshold is breached
   */
  private isThresholdBreached(
    value: number,
    threshold: number,
    operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  ): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  }


  /**
   * Send notifications for an alert
   * @requirements 20.8 - Support email and Slack notifications
   */
  private async sendNotifications(
    channels: NotificationChannel[],
    alert: Alert
  ): Promise<void> {
    const notifications = this.config.notifications;
    if (!notifications) return;
    
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'email':
            if (notifications.email?.enabled) {
              await this.sendEmailNotification(alert, notifications.email);
            }
            break;
          case 'slack':
            if (notifications.slack?.enabled) {
              await this.sendSlackNotification(alert, notifications.slack);
            }
            break;
          case 'webhook':
            if (notifications.webhook?.enabled) {
              await this.sendWebhookNotification(alert, notifications.webhook);
            }
            break;
        }
      } catch (error) {
        console.error(
          `[MonitoringService] Failed to send ${channel} notification:`,
          error
        );
      }
    }
  }

  /**
   * Send email notification
   * @requirements 20.8 - Support email notifications
   */
  private async sendEmailNotification(
    alert: Alert,
    config: NonNullable<NotificationConfig['email']>
  ): Promise<void> {
    // In a real implementation, this would use an email service like SendGrid, SES, etc.
    // Placeholder for actual email sending
    // await emailService.send({
    //   to: config.recipients,
    //   from: config.fromAddress || 'alerts@platform.com',
    //   subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
    //   body: alert.message,
    // });
  }

  /**
   * Send Slack notification
   * @requirements 20.8 - Support Slack notifications
   */
  private async sendSlackNotification(
    alert: Alert,
    config: NonNullable<NotificationConfig['slack']>
  ): Promise<void> {
    const severityColors: Record<AlertSeverity, string> = {
      info: '#36a64f',
      warning: '#ff9800',
      critical: '#f44336',
    };
    
    const payload = {
      username: config.username || 'Monitoring Bot',
      channel: config.channel,
      attachments: [
        {
          color: severityColors[alert.severity],
          title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          text: alert.message,
          fields: [
            {
              title: 'Current Value',
              value: alert.currentValue.toFixed(2),
              short: true,
            },
            {
              title: 'Threshold',
              value: alert.threshold.toString(),
              short: true,
            },
            {
              title: 'Metric Type',
              value: alert.metricType,
              short: true,
            },
            {
              title: 'Time',
              value: new Date(alert.timestamp).toISOString(),
              short: true,
            },
          ],
          footer: 'Platform Monitoring',
          ts: Math.floor(alert.timestamp / 1000),
        },
      ],
    };
    
    // In production, actually send the webhook
    if (config.webhookUrl && !config.webhookUrl.includes('example')) {
      try {
        await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        // Silently handle notification failures
      }
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    alert: Alert,
    config: NonNullable<NotificationConfig['webhook']>
  ): Promise<void> {
    const payload = {
      alert,
      timestamp: Date.now(),
      source: 'platform-monitoring',
    };
    
    // In production, actually send the webhook
    if (config.url && !config.url.includes('example')) {
      try {
        await fetch(config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...config.headers,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        // Silently handle notification failures
      }
    }
  }

  /**
   * Aggregate external service metrics
   */
  private aggregateExternalServiceMetrics(
    metrics: ExternalServiceMetric[]
  ): AggregatedMetrics['externalServices'] {
    const services: ExternalService[] = [
      'paystack',
      'flutterwave',
      'whatsapp',
      'twilio',
      'asr_provider',
    ];
    
    const result: AggregatedMetrics['externalServices'] = {} as AggregatedMetrics['externalServices'];
    
    for (const service of services) {
      const serviceMetrics = metrics.filter(m => m.service === service);
      const totalRequests = serviceMetrics.length;
      const successfulRequests = serviceMetrics.filter(m => m.success).length;
      const failedRequests = totalRequests - successfulRequests;
      const responseTimes = serviceMetrics.map(m => m.responseTimeMs);
      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;
      const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
      
      result[service] = {
        totalRequests,
        successfulRequests,
        failedRequests,
        averageResponseTimeMs: Math.round(avgResponseTime),
        errorRate: Math.round(errorRate * 100) / 100,
        lastChecked: serviceMetrics.length > 0
          ? Math.max(...serviceMetrics.map(m => m.timestamp))
          : 0,
        status: determineHealthStatus(
          errorRate,
          avgResponseTime,
          this.slaThresholds
        ),
      };
    }
    
    return result;
  }

  /**
   * Calculate overall uptime percentage
   */
  private calculateOverallUptime(): number {
    let totalUp = 0;
    let totalChecks = 0;
    
    for (const { up, total } of this.uptimeChecks.values()) {
      totalUp += up;
      totalChecks += total;
    }
    
    return totalChecks > 0 ? (totalUp / totalChecks) * 100 : 100;
  }

  /**
   * Calculate error rate time series
   */
  private calculateErrorRateTimeSeries(
    period: { start: number; end: number }
  ): TimeSeriesData {
    const apiMetrics = this.metrics.filter(
      (m): m is APIResponseMetric =>
        m.type === 'api_response_time' &&
        m.timestamp >= period.start &&
        m.timestamp <= period.end
    );
    
    // Group by time buckets
    const bucketSize = DEFAULT_AGGREGATION_WINDOW_MS;
    const buckets = new Map<number, { total: number; failed: number }>();
    
    apiMetrics.forEach(m => {
      const bucketKey = Math.floor(m.timestamp / bucketSize) * bucketSize;
      const current = buckets.get(bucketKey) || { total: 0, failed: 0 };
      current.total++;
      if (!m.success) {
        current.failed++;
      }
      buckets.set(bucketKey, current);
    });
    
    const data: TimeSeriesDataPoint[] = Array.from(buckets.entries())
      .map(([timestamp, { total, failed }]) => ({
        timestamp,
        value: total > 0 ? (failed / total) * 100 : 0,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    return {
      name: 'error_rate',
      data,
      unit: '%',
    };
  }

  // ==========================================================================
  // Testing/Debug Methods
  // ==========================================================================

  /**
   * Clear all metrics (for testing)
   */
  clearMetrics(): void {
    this.metrics = [];
    this.uptimeChecks.clear();
  }

  /**
   * Clear all alerts (for testing)
   */
  clearAlerts(): void {
    this.alerts = [];
    this.breachCounts.clear();
    this.lastAlertTime.clear();
  }

  /**
   * Get raw metrics array (for testing)
   */
  getRawMetrics(): Metric[] {
    return [...this.metrics];
  }

  /**
   * Get raw alerts array (for testing)
   */
  getRawAlerts(): Alert[] {
    return [...this.alerts];
  }
}


// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a UnifiedMonitoringService instance
 * 
 * @param config - Optional configuration for the monitoring service
 * @returns UnifiedMonitoringService instance
 * 
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const monitoringService = createMonitoringService();
 * 
 * // With custom configuration
 * const monitoringService = createMonitoringService({
 *   slaThresholds: {
 *     maxApiResponseTimeMs: 300,
 *     minUptimePercentage: 99.95,
 *   },
 *   notifications: {
 *     slack: {
 *       enabled: true,
 *       webhookUrl: process.env.SLACK_WEBHOOK_URL!,
 *       channel: '#alerts',
 *     },
 *     email: {
 *       enabled: true,
 *       recipients: ['ops@company.com'],
 *     },
 *   },
 * });
 * ```
 */
export function createMonitoringService(
  config: MonitoringServiceConfig = {}
): UnifiedMonitoringService {
  return new UnifiedMonitoringService(config);
}

/**
 * Create a MonitoringService instance from environment variables
 * 
 * Expected environment variables:
 * - MONITORING_API_THRESHOLD_MS (optional, default 500)
 * - MONITORING_DB_THRESHOLD_MS (optional, default 200)
 * - MONITORING_UPTIME_THRESHOLD (optional, default 99.9)
 * - SLACK_WEBHOOK_URL (optional)
 * - ALERT_EMAIL_RECIPIENTS (optional, comma-separated)
 */
export function createMonitoringServiceFromEnv(
  overrides: Partial<MonitoringServiceConfig> = {}
): UnifiedMonitoringService {
  const slaThresholds: Partial<SLAThresholds> = {
    maxApiResponseTimeMs: process.env.MONITORING_API_THRESHOLD_MS
      ? parseInt(process.env.MONITORING_API_THRESHOLD_MS, 10)
      : DEFAULT_SLA_THRESHOLDS.maxApiResponseTimeMs,
    maxDatabaseLatencyMs: process.env.MONITORING_DB_THRESHOLD_MS
      ? parseInt(process.env.MONITORING_DB_THRESHOLD_MS, 10)
      : DEFAULT_SLA_THRESHOLDS.maxDatabaseLatencyMs,
    minUptimePercentage: process.env.MONITORING_UPTIME_THRESHOLD
      ? parseFloat(process.env.MONITORING_UPTIME_THRESHOLD)
      : DEFAULT_SLA_THRESHOLDS.minUptimePercentage,
    ...overrides.slaThresholds,
  };

  const notifications: NotificationConfig = {
    slack: process.env.SLACK_WEBHOOK_URL
      ? {
          enabled: true,
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
        }
      : undefined,
    email: process.env.ALERT_EMAIL_RECIPIENTS
      ? {
          enabled: true,
          recipients: process.env.ALERT_EMAIL_RECIPIENTS.split(',').map(e => e.trim()),
        }
      : undefined,
    ...overrides.notifications,
  };

  return new UnifiedMonitoringService({
    ...overrides,
    slaThresholds,
    notifications,
  });
}

// ============================================================================
// Singleton Instance (Optional)
// ============================================================================

let defaultInstance: UnifiedMonitoringService | null = null;

/**
 * Get or create the default monitoring service instance
 * 
 * This provides a singleton pattern for cases where a single
 * monitoring service instance is needed across the application.
 */
export function getMonitoringService(): UnifiedMonitoringService {
  if (!defaultInstance) {
    defaultInstance = createMonitoringServiceFromEnv();
  }
  return defaultInstance;
}

/**
 * Reset the default monitoring service instance (for testing)
 */
export function resetMonitoringService(): void {
  defaultInstance = null;
}

// ============================================================================
// Default Export
// ============================================================================

export default UnifiedMonitoringService;
