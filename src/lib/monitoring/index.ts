/**
 * Monitoring Module
 * 
 * Provides comprehensive monitoring and observability for the platform,
 * including API endpoint tracking, database query latencies, external
 * service monitoring, and alerting.
 * 
 * @module monitoring
 * @requirements 20.1 - Track API endpoint response times
 * @requirements 20.2 - Track database query latencies
 * @requirements 20.3 - Track external service response times
 * @requirements 20.4 - Define SLA thresholds
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 * @requirements 20.7 - Display real-time and historical metrics
 * @requirements 20.8 - Support email and Slack notifications
 */

// Export types
export type {
  // Metric types
  MetricType,
  ExternalService,
  HealthStatus,
  AlertSeverity,
  NotificationChannel,
  
  // Metric data structures
  BaseMetric,
  APIResponseMetric,
  DatabaseQueryMetric,
  ExternalServiceMetric,
  UptimeMetric,
  ErrorRateMetric,
  Metric,
  
  // SLA configuration
  SLAThresholds,
  
  // Alert types
  Alert,
  AlertRule,
  AlertFilter,
  
  // Notification types
  NotificationConfig,
  NotificationPayload,
  
  // Dashboard types
  AggregatedMetrics,
  TimeSeriesDataPoint,
  TimeSeriesData,
  MonitoringDashboardData,
  
  // Service configuration
  MonitoringServiceConfig,
  MonitoringService,
  MetricFilter,
  
  // Error types
  MonitoringErrorCode,
  MonitoringError,
} from './types';

// Export constants
export {
  DEFAULT_SLA_THRESHOLDS,
  DEFAULT_MONITORING_CONFIG,
} from './types';

// Export service implementation
export {
  UnifiedMonitoringService,
  createMonitoringService,
  createMonitoringServiceFromEnv,
  getMonitoringService,
  resetMonitoringService,
} from './MonitoringService';

// Export alerting service
export {
  AlertingService,
  createAlertingService,
  createAlertingServiceFromEnv,
  DEFAULT_ALERT_RULES,
} from './AlertingService';

export type {
  AlertingServiceConfig,
  CreateAlertParams,
  NotificationResult,
} from './AlertingService';

// Default export
export { default } from './MonitoringService';
