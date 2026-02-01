/**
 * Analytics Module - Public API
 * 
 * This module exports analytics services for dashboard metrics calculation.
 * 
 * @module analytics
 */

export {
  AnalyticsService,
  createAnalyticsService,
  getDateRange,
  calculatePercentageChange,
} from './AnalyticsService';

export type {
  AnalyticsFilter,
  DashboardMetrics,
  MetricsTrend,
  CallData,
  OrderData,
  TimePeriod,
  FunnelStageName,
  FunnelStage,
  OrderWithFunnelData,
} from './AnalyticsService';

export {
  ExportService,
  createExportService,
  formatTimestampISO,
  formatTimestampLocal,
  formatCurrency,
  escapeCSVValue,
  toCSV,
  downloadFile,
} from './ExportService';

export type {
  ExportOptions,
  ExportResult,
} from './ExportService';

export {
  AgentMetricsService,
  createAgentMetricsService,
} from './AgentMetricsService';

export type {
  AgentCallData,
  AgentMetrics,
  AgentMetricsSummary,
  AgentComparison,
  AgentNameMap,
} from './AgentMetricsService';
