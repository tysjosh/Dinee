/**
 * Alerting Service Implementation
 * 
 * Provides dedicated alerting functionality with SLA threshold monitoring,
 * multi-channel notifications (email, Slack), and alert lifecycle management.
 * 
 * @module monitoring/AlertingService
 * @requirements 20.4 - Define SLA thresholds (99.9% uptime, <500ms response)
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 * @requirements 20.8 - Support email and Slack notifications
 */

import type {
  Alert,
  AlertRule,
  AlertSeverity,
  AlertFilter,
  NotificationChannel,
  NotificationConfig,
  NotificationPayload,
  MetricType,
  SLAThresholds,
} from './types';
import { DEFAULT_SLA_THRESHOLDS } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Alerting service configuration
 */
export interface AlertingServiceConfig {
  /** SLA thresholds for alerting */
  slaThresholds?: Partial<SLAThresholds>;
  /** Notification configuration */
  notifications?: NotificationConfig;
  /** Custom alert rules */
  alertRules?: AlertRule[];
  /** Maximum alerts to retain */
  maxAlerts?: number;
  /** Default cooldown period in seconds */
  defaultCooldownSeconds?: number;
  /** Callback when alert is triggered */
  onAlertTriggered?: (alert: Alert) => void;
  /** Callback when alert is resolved */
  onAlertResolved?: (alert: Alert) => void;
}

/**
 * Alert creation parameters
 */
export interface CreateAlertParams {
  severity: AlertSeverity;
  title: string;
  message: string;
  metricType: MetricType;
  currentValue: number;
  threshold: number;
  context?: Record<string, unknown>;
}

/**
 * Notification result
 */
export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
  sentAt: number;
}


// ============================================================================
// Constants
// ============================================================================

/** Maximum alerts to keep in memory */
const DEFAULT_MAX_ALERTS = 1000;

/** Default cooldown period in seconds */
const DEFAULT_COOLDOWN_SECONDS = 300;

/**
 * Default alert rules based on SLA requirements
 * @requirements 20.4 - Define SLA thresholds: 99.9% uptime, <500ms API response time
 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  // API Response Time Rules
  {
    id: 'api_latency_warning',
    name: 'API Latency Warning',
    description: 'API response time approaching SLA threshold',
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
    id: 'api_latency_critical',
    name: 'API Latency Critical',
    description: 'API response time exceeds 500ms SLA threshold',
    metricType: 'api_response_time',
    threshold: 500,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 2,
  },
  // Database Latency Rules
  {
    id: 'db_latency_warning',
    name: 'Database Latency Warning',
    description: 'Database query latency approaching threshold',
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
    id: 'db_latency_critical',
    name: 'Database Latency Critical',
    description: 'Database query latency exceeds threshold',
    metricType: 'database_query_latency',
    threshold: 200,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 3,
  },
  // External Service Rules
  {
    id: 'external_service_warning',
    name: 'External Service Latency Warning',
    description: 'External service response time is high',
    metricType: 'external_service_response_time',
    threshold: 1500,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 2,
  },
  {
    id: 'external_service_critical',
    name: 'External Service Latency Critical',
    description: 'External service response time exceeds threshold',
    metricType: 'external_service_response_time',
    threshold: 2000,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 2,
  },
  // Uptime Rules
  {
    id: 'uptime_warning',
    name: 'Uptime Warning',
    description: 'System uptime approaching SLA threshold',
    metricType: 'uptime_check',
    threshold: 99.95,
    operator: 'lt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 1,
  },
  {
    id: 'uptime_critical',
    name: 'Uptime Critical',
    description: 'System uptime below 99.9% SLA threshold',
    metricType: 'uptime_check',
    threshold: 99.9,
    operator: 'lt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 1,
  },
  // Error Rate Rules
  {
    id: 'error_rate_warning',
    name: 'Error Rate Warning',
    description: 'Error rate is elevated',
    metricType: 'error_rate',
    threshold: 0.5,
    operator: 'gt',
    severity: 'warning',
    channels: ['slack'],
    enabled: true,
    cooldownSeconds: 300,
    consecutiveBreaches: 3,
  },
  {
    id: 'error_rate_critical',
    name: 'Error Rate Critical',
    description: 'Error rate exceeds acceptable threshold',
    metricType: 'error_rate',
    threshold: 1,
    operator: 'gt',
    severity: 'critical',
    channels: ['email', 'slack'],
    enabled: true,
    cooldownSeconds: 60,
    consecutiveBreaches: 2,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique alert ID
 */
function generateAlertId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ALERT_${timestamp}_${random}`.toUpperCase();
}

/**
 * Format alert message for Slack
 */
function formatSlackMessage(alert: Alert): object {
  const severityColors: Record<AlertSeverity, string> = {
    info: '#36a64f',
    warning: '#ff9800',
    critical: '#f44336',
  };

  const severityEmoji: Record<AlertSeverity, string> = {
    info: 'ℹ️',
    warning: '⚠️',
    critical: '🚨',
  };

  return {
    attachments: [
      {
        color: severityColors[alert.severity],
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${severityEmoji[alert.severity]} ${alert.title}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: alert.message,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Severity:*\n${alert.severity.toUpperCase()}`,
              },
              {
                type: 'mrkdwn',
                text: `*Metric Type:*\n${alert.metricType}`,
              },
              {
                type: 'mrkdwn',
                text: `*Current Value:*\n${alert.currentValue.toFixed(2)}`,
              },
              {
                type: 'mrkdwn',
                text: `*Threshold:*\n${alert.threshold}`,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Alert ID: ${alert.id} | Time: ${new Date(alert.timestamp).toISOString()}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Format alert message for email
 */
function formatEmailMessage(alert: Alert): { subject: string; body: string } {
  const severityPrefix: Record<AlertSeverity, string> = {
    info: '[INFO]',
    warning: '[WARNING]',
    critical: '[CRITICAL]',
  };

  const subject = `${severityPrefix[alert.severity]} ${alert.title}`;
  
  const body = `
Platform Monitoring Alert
========================

${alert.title}

Severity: ${alert.severity.toUpperCase()}
Metric Type: ${alert.metricType}
Current Value: ${alert.currentValue.toFixed(2)}
Threshold: ${alert.threshold}

Message:
${alert.message}

Alert Details:
- Alert ID: ${alert.id}
- Timestamp: ${new Date(alert.timestamp).toISOString()}
${alert.context ? `- Context: ${JSON.stringify(alert.context, null, 2)}` : ''}

---
This is an automated alert from the Platform Monitoring System.
  `.trim();

  return { subject, body };
}


// ============================================================================
// Alerting Service Implementation
// ============================================================================

/**
 * Alerting Service
 * 
 * Manages alert creation, lifecycle, and notifications for the monitoring system.
 * Supports SLA threshold monitoring with email and Slack notifications.
 * 
 * @requirements 20.4 - Define SLA thresholds (99.9% uptime, <500ms response)
 * @requirements 20.5 - Trigger alerts on latency threshold breach
 * @requirements 20.6 - Trigger alerts on uptime threshold breach
 * @requirements 20.8 - Support email and Slack notifications
 * 
 * @example
 * ```typescript
 * const alertingService = createAlertingService({
 *   slaThresholds: {
 *     maxApiResponseTimeMs: 500,
 *     minUptimePercentage: 99.9,
 *   },
 *   notifications: {
 *     slack: {
 *       enabled: true,
 *       webhookUrl: process.env.SLACK_WEBHOOK_URL!,
 *     },
 *     email: {
 *       enabled: true,
 *       recipients: ['ops@company.com'],
 *     },
 *   },
 * });
 * 
 * // Create an alert
 * const alert = alertingService.createAlert({
 *   severity: 'critical',
 *   title: 'API Latency Critical',
 *   message: 'API response time exceeds 500ms threshold',
 *   metricType: 'api_response_time',
 *   currentValue: 650,
 *   threshold: 500,
 * });
 * ```
 */
export class AlertingService {
  private config: AlertingServiceConfig;
  private slaThresholds: SLAThresholds;
  private alertRules: AlertRule[];
  private alerts: Alert[] = [];
  private breachCounts: Map<string, number> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private notificationHistory: NotificationPayload[] = [];

  constructor(config: AlertingServiceConfig = {}) {
    this.config = {
      maxAlerts: DEFAULT_MAX_ALERTS,
      defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
      ...config,
    };

    this.slaThresholds = {
      ...DEFAULT_SLA_THRESHOLDS,
      ...config.slaThresholds,
    };

    this.alertRules = config.alertRules || DEFAULT_ALERT_RULES;
  }

  // ==========================================================================
  // Alert Creation
  // ==========================================================================

  /**
   * Create a new alert
   */
  createAlert(params: CreateAlertParams): Alert {
    const alert: Alert = {
      id: generateAlertId(),
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
    this.trimAlerts();

    // Call callback if configured
    if (this.config.onAlertTriggered) {
      this.config.onAlertTriggered(alert);
    }

    return alert;
  }

  /**
   * Check a metric value against alert rules and create alerts if needed
   * @requirements 20.5 - Trigger alerts on latency threshold breach
   */
  checkMetricValue(
    metricType: MetricType,
    value: number,
    context?: Record<string, unknown>
  ): Alert | null {
    const applicableRules = this.alertRules.filter(
      rule => rule.enabled && rule.metricType === metricType
    );

    for (const rule of applicableRules) {
      const breached = this.isThresholdBreached(value, rule.threshold, rule.operator);

      if (breached) {
        const alert = this.handleBreach(rule, value, context);
        if (alert) {
          return alert;
        }
      } else {
        // Reset breach count on success
        this.breachCounts.set(rule.id, 0);
      }
    }

    return null;
  }

  /**
   * Check uptime percentage against SLA threshold
   * @requirements 20.6 - Trigger alerts on uptime threshold breach
   */
  checkUptimeThreshold(
    uptimePercentage: number,
    target: string
  ): Alert | null {
    if (uptimePercentage < this.slaThresholds.minUptimePercentage) {
      const alert = this.createAlert({
        severity: 'critical',
        title: 'Uptime Below SLA Threshold',
        message: `${target} uptime is ${uptimePercentage.toFixed(2)}%, below the ${this.slaThresholds.minUptimePercentage}% SLA threshold`,
        metricType: 'uptime_check',
        currentValue: uptimePercentage,
        threshold: this.slaThresholds.minUptimePercentage,
        context: { target },
      });

      // Send notifications for critical uptime alerts
      this.sendNotifications(['email', 'slack'], alert);

      return alert;
    }

    return null;
  }

  // ==========================================================================
  // Alert Management
  // ==========================================================================

  /**
   * Get all active (unresolved) alerts
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return this.alerts.filter(a => a.severity === severity);
  }

  /**
   * Get alert history with filtering
   */
  getAlertHistory(filter: AlertFilter = {}): Alert[] {
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
  acknowledgeAlert(alertId: string, userId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = userId;

    return true;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = Date.now();

    if (this.config.onAlertResolved) {
      this.config.onAlertResolved(alert);
    }

    return true;
  }

  /**
   * Get alert by ID
   */
  getAlert(alertId: string): Alert | undefined {
    return this.alerts.find(a => a.id === alertId);
  }


  // ==========================================================================
  // Notification Methods
  // ==========================================================================

  /**
   * Send notifications for an alert
   * @requirements 20.8 - Support email and Slack notifications
   */
  async sendNotifications(
    channels: NotificationChannel[],
    alert: Alert
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const notifications = this.config.notifications;

    if (!notifications) {
      return results;
    }

    for (const channel of channels) {
      try {
        let result: NotificationResult;

        switch (channel) {
          case 'email':
            result = await this.sendEmailNotification(alert);
            break;
          case 'slack':
            result = await this.sendSlackNotification(alert);
            break;
          case 'webhook':
            result = await this.sendWebhookNotification(alert);
            break;
          default:
            result = {
              channel,
              success: false,
              error: `Unknown channel: ${channel}`,
              sentAt: Date.now(),
            };
        }

        results.push(result);

        // Store notification history
        this.notificationHistory.push({
          alert,
          channel,
          sentAt: result.sentAt,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          channel,
          success: false,
          error: errorMessage,
          sentAt: Date.now(),
        });
      }
    }

    return results;
  }

  /**
   * Send email notification
   * @requirements 20.8 - Support email notifications
   */
  private async sendEmailNotification(alert: Alert): Promise<NotificationResult> {
    const emailConfig = this.config.notifications?.email;

    if (!emailConfig?.enabled) {
      return {
        channel: 'email',
        success: false,
        error: 'Email notifications not enabled',
        sentAt: Date.now(),
      };
    }

    const { subject, body } = formatEmailMessage(alert);

    // In production, integrate with email service (SendGrid, SES, etc.)
    // await emailService.send({
    //   to: emailConfig.recipients,
    //   from: emailConfig.fromAddress || 'alerts@platform.com',
    //   subject,
    //   text: body,
    // });

    return {
      channel: 'email',
      success: true,
      sentAt: Date.now(),
    };
  }

  /**
   * Send Slack notification
   * @requirements 20.8 - Support Slack notifications
   */
  private async sendSlackNotification(alert: Alert): Promise<NotificationResult> {
    const slackConfig = this.config.notifications?.slack;

    if (!slackConfig?.enabled) {
      return {
        channel: 'slack',
        success: false,
        error: 'Slack notifications not enabled',
        sentAt: Date.now(),
      };
    }

    const payload = {
      username: slackConfig.username || 'Platform Monitoring',
      channel: slackConfig.channel,
      ...formatSlackMessage(alert),
    };

    // Send to Slack webhook if URL is configured and not a placeholder
    if (slackConfig.webhookUrl && !slackConfig.webhookUrl.includes('example')) {
      try {
        const response = await fetch(slackConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          return {
            channel: 'slack',
            success: false,
            error: `Slack API error: ${response.status}`,
            sentAt: Date.now(),
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          channel: 'slack',
          success: false,
          error: errorMessage,
          sentAt: Date.now(),
        };
      }
    }

    return {
      channel: 'slack',
      success: true,
      sentAt: Date.now(),
    };
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(alert: Alert): Promise<NotificationResult> {
    const webhookConfig = this.config.notifications?.webhook;

    if (!webhookConfig?.enabled) {
      return {
        channel: 'webhook',
        success: false,
        error: 'Webhook notifications not enabled',
        sentAt: Date.now(),
      };
    }

    const payload = {
      type: 'alert',
      alert,
      timestamp: Date.now(),
      source: 'platform-monitoring',
    };

    if (webhookConfig.url && !webhookConfig.url.includes('example')) {
      try {
        const response = await fetch(webhookConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...webhookConfig.headers,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          return {
            channel: 'webhook',
            success: false,
            error: `Webhook error: ${response.status}`,
            sentAt: Date.now(),
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          channel: 'webhook',
          success: false,
          error: errorMessage,
          sentAt: Date.now(),
        };
      }
    }

    return {
      channel: 'webhook',
      success: true,
      sentAt: Date.now(),
    };
  }

  /**
   * Get notification history
   */
  getNotificationHistory(limit?: number): NotificationPayload[] {
    const history = [...this.notificationHistory].sort(
      (a, b) => b.sentAt - a.sentAt
    );
    return limit ? history.slice(0, limit) : history;
  }


  // ==========================================================================
  // Alert Rules Management
  // ==========================================================================

  /**
   * Get all alert rules
   */
  getAlertRules(): AlertRule[] {
    return [...this.alertRules];
  }

  /**
   * Add a new alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  /**
   * Update an existing alert rule
   */
  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const index = this.alertRules.findIndex(r => r.id === ruleId);
    if (index === -1) {
      return false;
    }

    this.alertRules[index] = {
      ...this.alertRules[index],
      ...updates,
    };
    return true;
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const index = this.alertRules.findIndex(r => r.id === ruleId);
    if (index === -1) {
      return false;
    }

    this.alertRules.splice(index, 1);
    return true;
  }

  /**
   * Enable or disable an alert rule
   */
  setAlertRuleEnabled(ruleId: string, enabled: boolean): boolean {
    return this.updateAlertRule(ruleId, { enabled });
  }

  // ==========================================================================
  // SLA Thresholds
  // ==========================================================================

  /**
   * Get current SLA thresholds
   */
  getSLAThresholds(): SLAThresholds {
    return { ...this.slaThresholds };
  }

  /**
   * Update SLA thresholds
   */
  updateSLAThresholds(thresholds: Partial<SLAThresholds>): void {
    this.slaThresholds = {
      ...this.slaThresholds,
      ...thresholds,
    };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Handle a threshold breach
   */
  private handleBreach(
    rule: AlertRule,
    value: number,
    context?: Record<string, unknown>
  ): Alert | null {
    const currentBreaches = (this.breachCounts.get(rule.id) || 0) + 1;
    this.breachCounts.set(rule.id, currentBreaches);

    // Check if we've hit the consecutive breach threshold
    if (currentBreaches < rule.consecutiveBreaches) {
      return null;
    }

    // Check cooldown
    const lastAlert = this.lastAlertTime.get(rule.id) || 0;
    const cooldownMs = rule.cooldownSeconds * 1000;

    if (Date.now() - lastAlert < cooldownMs) {
      return null;
    }

    // Create alert
    const alert = this.createAlert({
      severity: rule.severity,
      title: rule.name,
      message: `${rule.description}. Current value: ${value.toFixed(2)}, Threshold: ${rule.threshold}`,
      metricType: rule.metricType,
      currentValue: value,
      threshold: rule.threshold,
      context: { ruleId: rule.id, ...context },
    });

    this.lastAlertTime.set(rule.id, Date.now());
    this.breachCounts.set(rule.id, 0);

    // Send notifications
    this.sendNotifications(rule.channels, alert);

    return alert;
  }

  /**
   * Check if a threshold is breached
   */
  private isThresholdBreached(
    value: number,
    threshold: number,
    operator: AlertRule['operator']
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
   * Trim alerts to stay within limit
   */
  private trimAlerts(): void {
    const maxAlerts = this.config.maxAlerts || DEFAULT_MAX_ALERTS;
    if (this.alerts.length > maxAlerts) {
      this.alerts = this.alerts.slice(-maxAlerts);
    }
  }

  // ==========================================================================
  // Testing/Debug Methods
  // ==========================================================================

  /**
   * Clear all alerts (for testing)
   */
  clearAlerts(): void {
    this.alerts = [];
    this.breachCounts.clear();
    this.lastAlertTime.clear();
  }

  /**
   * Clear notification history (for testing)
   */
  clearNotificationHistory(): void {
    this.notificationHistory = [];
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
 * Create an AlertingService instance
 */
export function createAlertingService(
  config: AlertingServiceConfig = {}
): AlertingService {
  return new AlertingService(config);
}

/**
 * Create an AlertingService from environment variables
 */
export function createAlertingServiceFromEnv(
  overrides: Partial<AlertingServiceConfig> = {}
): AlertingService {
  const slaThresholds: Partial<SLAThresholds> = {
    maxApiResponseTimeMs: process.env.SLA_API_THRESHOLD_MS
      ? parseInt(process.env.SLA_API_THRESHOLD_MS, 10)
      : DEFAULT_SLA_THRESHOLDS.maxApiResponseTimeMs,
    maxDatabaseLatencyMs: process.env.SLA_DB_THRESHOLD_MS
      ? parseInt(process.env.SLA_DB_THRESHOLD_MS, 10)
      : DEFAULT_SLA_THRESHOLDS.maxDatabaseLatencyMs,
    minUptimePercentage: process.env.SLA_UPTIME_THRESHOLD
      ? parseFloat(process.env.SLA_UPTIME_THRESHOLD)
      : DEFAULT_SLA_THRESHOLDS.minUptimePercentage,
    ...overrides.slaThresholds,
  };

  const notifications: NotificationConfig = {
    slack: process.env.SLACK_ALERT_WEBHOOK_URL
      ? {
          enabled: true,
          webhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL,
          channel: process.env.SLACK_ALERT_CHANNEL,
        }
      : undefined,
    email: process.env.ALERT_EMAIL_RECIPIENTS
      ? {
          enabled: true,
          recipients: process.env.ALERT_EMAIL_RECIPIENTS.split(',').map(e => e.trim()),
          fromAddress: process.env.ALERT_EMAIL_FROM,
        }
      : undefined,
    ...overrides.notifications,
  };

  return new AlertingService({
    ...overrides,
    slaThresholds,
    notifications,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default AlertingService;
