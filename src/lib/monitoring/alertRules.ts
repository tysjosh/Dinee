/**
 * Pure alert-rule evaluator for per-agent monitoring (Requirement 17).
 *
 * The Monitoring_Service raises an alert when a monitored condition breaches
 * its configured threshold over the reporting window. This module holds the
 * *pure* decision logic: given a snapshot of window metrics and the configured
 * thresholds, it returns the set of alerts that should be raised. It performs
 * no I/O and reads no clock — callers supply the window bounds and the
 * dependency-health snapshot, and persist the returned alerts via the
 * `convex/runsheet/agentAlerts.ts` mutation.
 *
 * The windowed rates (low-confidence, review-required, tool-rejection,
 * auth-failure) are derived upstream from the `agentMetrics` rows recorded by
 * task 15.1 (Req 16) and fed in here as plain numbers, keeping this evaluator
 * independent of the Convex database.
 *
 * Rule semantics:
 *   - Dependency failure (Req 17.1): raise one `critical` alert per monitored
 *     dependency (OpenAI / Twilio / Runsheet) that is unreachable.
 *   - Rate rules (Req 17.2–17.5): raise a `warning` alert when the observed
 *     rate over the window is **greater than or equal to** the configured
 *     threshold (`observed >= threshold`).
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5 (dinee-voice-platform)
 */

/** The five monitored alert conditions (Req 17.1–17.5). */
export type AgentAlertType =
  | "dependency_failure"
  | "low_confidence_rate"
  | "review_required_rate"
  | "tool_rejection_rate"
  | "auth_failure_rate";

/** Alert severity levels, aligned with the `agentAlerts` schema table. */
export type AgentAlertSeverity = "info" | "warning" | "critical";

/** Dependencies whose failure the Monitoring_Service alerts on (Req 17.1). */
export type MonitoredDependency = "openai" | "twilio" | "runsheet";

/**
 * A single dependency-health observation over the reporting window. `reachable`
 * is `false` when the dependency failed / was unreachable (Req 17.1).
 */
export interface DependencyHealth {
  dependency: MonitoredDependency;
  reachable: boolean;
}

/**
 * Windowed metric snapshot for a single tenant over the reporting window.
 *
 * Rates are fractions in the inclusive range [0, 1] derived upstream from the
 * `agentMetrics` window aggregation (Req 16). `windowStart` / `windowEnd` are
 * epoch-millisecond bounds carried through onto each raised alert.
 */
export interface WindowMetrics {
  /** Tenant these metrics are scoped to (Req 17.4, 17.5). */
  tenantId: string;
  /** Start of the reporting window (epoch ms). */
  windowStart: number;
  /** End of the reporting window (epoch ms). */
  windowEnd: number;
  /** Fraction of calls with low ASR confidence over the window (Req 17.2). */
  lowConfidenceRate: number;
  /** Fraction of calls whose outcome required review over the window (Req 17.3). */
  reviewRequiredRate: number;
  /** Fraction of tool calls rejected for the tenant over the window (Req 17.4). */
  toolRejectionRate: number;
  /** Fraction of authentication attempts that failed for the tenant (Req 17.5). */
  authFailureRate: number;
  /**
   * Dependency-health snapshot observed over the window. Only unreachable
   * dependencies produce alerts (Req 17.1). Omit or leave empty when no
   * dependency health was sampled.
   */
  dependencies?: DependencyHealth[];
}

/**
 * The configured thresholds a tenant's window rates are evaluated against
 * (Req 17.2–17.5). Each is a fraction in [0, 1]; a rate rule breaches when the
 * observed rate is `>= threshold`.
 */
export interface AlertThresholds {
  lowConfidenceRate: number;
  reviewRequiredRate: number;
  toolRejectionRate: number;
  authFailureRate: number;
}

/**
 * An alert the evaluator has decided to raise. Mirrors the persisted
 * `agentAlerts` row shape (minus the storage-managed `createdAt` / `resolved`
 * fields, which the mutation fills in).
 */
export interface RaisedAlert {
  tenantId: string;
  alertType: AgentAlertType;
  severity: AgentAlertSeverity;
  /** Failed dependency name (dependency failure) or breached rate name. */
  subject: string;
  /** The specific failed dependency — set only for `dependency_failure`. */
  dependency?: MonitoredDependency;
  /** The configured threshold that was breached — set for rate rules. */
  threshold?: number;
  /** The observed value that breached the threshold — set for rate rules. */
  observedValue?: number;
  windowStart: number;
  windowEnd: number;
  message: string;
}

/** Human-readable label for a monitored dependency, used in alert messages. */
const DEPENDENCY_LABEL: Record<MonitoredDependency, string> = {
  openai: "OpenAI",
  twilio: "Twilio",
  runsheet: "Runsheet backend",
};

/** Formats a rate fraction as a percentage string for alert messages. */
function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Evaluate the alert rules for a single tenant's window (Req 17.1–17.5).
 *
 * Returns the alerts that should be raised for this window, in a stable order:
 * dependency failures first (one per unreachable dependency), followed by the
 * rate-rule breaches in requirement order (low-confidence, review-required,
 * tool-rejection, auth-failure). An empty array means nothing breached.
 *
 * The function is pure: it does not read the clock, perform I/O, or mutate its
 * inputs.
 */
export function evaluateAlertRules(
  metrics: WindowMetrics,
  thresholds: AlertThresholds
): RaisedAlert[] {
  const alerts: RaisedAlert[] = [];
  const { tenantId, windowStart, windowEnd } = metrics;

  // Req 17.1 — one critical alert per unreachable dependency.
  for (const health of metrics.dependencies ?? []) {
    if (!health.reachable) {
      const label = DEPENDENCY_LABEL[health.dependency];
      alerts.push({
        tenantId,
        alertType: "dependency_failure",
        severity: "critical",
        subject: label,
        dependency: health.dependency,
        windowStart,
        windowEnd,
        message: `Dependency failure: ${label} is unreachable.`,
      });
    }
  }

  // Req 17.2 — low-confidence rate breach.
  if (metrics.lowConfidenceRate >= thresholds.lowConfidenceRate) {
    alerts.push({
      tenantId,
      alertType: "low_confidence_rate",
      severity: "warning",
      subject: "low-confidence rate",
      threshold: thresholds.lowConfidenceRate,
      observedValue: metrics.lowConfidenceRate,
      windowStart,
      windowEnd,
      message:
        `Low-confidence rate ${formatRate(metrics.lowConfidenceRate)} ` +
        `reached the configured threshold ${formatRate(thresholds.lowConfidenceRate)} ` +
        `over the reporting window.`,
    });
  }

  // Req 17.3 — review-required rate breach.
  if (metrics.reviewRequiredRate >= thresholds.reviewRequiredRate) {
    alerts.push({
      tenantId,
      alertType: "review_required_rate",
      severity: "warning",
      subject: "review-required rate",
      threshold: thresholds.reviewRequiredRate,
      observedValue: metrics.reviewRequiredRate,
      windowStart,
      windowEnd,
      message:
        `Review-required rate ${formatRate(metrics.reviewRequiredRate)} ` +
        `reached the configured threshold ${formatRate(thresholds.reviewRequiredRate)} ` +
        `over the reporting window.`,
    });
  }

  // Req 17.4 — per-tenant tool-rejection rate breach.
  if (metrics.toolRejectionRate >= thresholds.toolRejectionRate) {
    alerts.push({
      tenantId,
      alertType: "tool_rejection_rate",
      severity: "warning",
      subject: "tool-rejection rate",
      threshold: thresholds.toolRejectionRate,
      observedValue: metrics.toolRejectionRate,
      windowStart,
      windowEnd,
      message:
        `Tool-rejection rate ${formatRate(metrics.toolRejectionRate)} for tenant ${tenantId} ` +
        `reached the configured threshold ${formatRate(thresholds.toolRejectionRate)} ` +
        `over the reporting window.`,
    });
  }

  // Req 17.5 — per-tenant authentication-failure rate breach.
  if (metrics.authFailureRate >= thresholds.authFailureRate) {
    alerts.push({
      tenantId,
      alertType: "auth_failure_rate",
      severity: "warning",
      subject: "authentication-failure rate",
      threshold: thresholds.authFailureRate,
      observedValue: metrics.authFailureRate,
      windowStart,
      windowEnd,
      message:
        `Authentication-failure rate ${formatRate(metrics.authFailureRate)} for tenant ${tenantId} ` +
        `reached the configured threshold ${formatRate(thresholds.authFailureRate)} ` +
        `over the reporting window.`,
    });
  }

  return alerts;
}
