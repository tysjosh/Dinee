import { describe, it, expect } from "vitest";
import {
  evaluateAlertRules,
  type AlertThresholds,
  type WindowMetrics,
} from "./alertRules";

const WINDOW_START = 1_000;
const WINDOW_END = 61_000;

const thresholds: AlertThresholds = {
  lowConfidenceRate: 0.2,
  reviewRequiredRate: 0.3,
  toolRejectionRate: 0.1,
  authFailureRate: 0.05,
};

function baseMetrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    tenantId: "tenant-a",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    lowConfidenceRate: 0,
    reviewRequiredRate: 0,
    toolRejectionRate: 0,
    authFailureRate: 0,
    dependencies: [],
    ...overrides,
  };
}

describe("evaluateAlertRules", () => {
  it("raises no alerts when everything is healthy and under threshold", () => {
    expect(evaluateAlertRules(baseMetrics(), thresholds)).toEqual([]);
  });

  it("raises a critical dependency_failure alert per unreachable dependency (Req 17.1)", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({
        dependencies: [
          { dependency: "openai", reachable: false },
          { dependency: "twilio", reachable: true },
          { dependency: "runsheet", reachable: false },
        ],
      }),
      thresholds
    );

    const depAlerts = alerts.filter((a) => a.alertType === "dependency_failure");
    expect(depAlerts).toHaveLength(2);
    expect(depAlerts.map((a) => a.dependency).sort()).toEqual([
      "openai",
      "runsheet",
    ]);
    expect(depAlerts.every((a) => a.severity === "critical")).toBe(true);
  });

  it("raises low_confidence_rate when observed >= threshold (Req 17.2)", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({ lowConfidenceRate: 0.2 }),
      thresholds
    );
    const alert = alerts.find((a) => a.alertType === "low_confidence_rate");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("warning");
    expect(alert?.threshold).toBe(0.2);
    expect(alert?.observedValue).toBe(0.2);
    expect(alert?.windowStart).toBe(WINDOW_START);
    expect(alert?.windowEnd).toBe(WINDOW_END);
  });

  it("does not raise a rate alert when observed is strictly below threshold", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({ lowConfidenceRate: 0.199 }),
      thresholds
    );
    expect(alerts.find((a) => a.alertType === "low_confidence_rate")).toBeUndefined();
  });

  it("raises review_required_rate when breached (Req 17.3)", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({ reviewRequiredRate: 0.5 }),
      thresholds
    );
    expect(alerts.find((a) => a.alertType === "review_required_rate")).toBeDefined();
  });

  it("raises tool_rejection_rate identifying the tenant (Req 17.4)", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({ tenantId: "tenant-x", toolRejectionRate: 0.25 }),
      thresholds
    );
    const alert = alerts.find((a) => a.alertType === "tool_rejection_rate");
    expect(alert).toBeDefined();
    expect(alert?.tenantId).toBe("tenant-x");
    expect(alert?.message).toContain("tenant-x");
  });

  it("raises auth_failure_rate identifying the tenant (Req 17.5)", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({ tenantId: "tenant-y", authFailureRate: 0.05 }),
      thresholds
    );
    const alert = alerts.find((a) => a.alertType === "auth_failure_rate");
    expect(alert).toBeDefined();
    expect(alert?.tenantId).toBe("tenant-y");
    expect(alert?.message).toContain("tenant-y");
  });

  it("raises multiple alerts together in stable order", () => {
    const alerts = evaluateAlertRules(
      baseMetrics({
        dependencies: [{ dependency: "twilio", reachable: false }],
        lowConfidenceRate: 0.9,
        reviewRequiredRate: 0.9,
        toolRejectionRate: 0.9,
        authFailureRate: 0.9,
      }),
      thresholds
    );

    expect(alerts.map((a) => a.alertType)).toEqual([
      "dependency_failure",
      "low_confidence_rate",
      "review_required_rate",
      "tool_rejection_rate",
      "auth_failure_rate",
    ]);
  });

  it("is pure: it does not mutate its input metrics", () => {
    const metrics = baseMetrics({
      dependencies: [{ dependency: "openai", reachable: false }],
      lowConfidenceRate: 0.5,
    });
    const snapshot = JSON.parse(JSON.stringify(metrics));
    evaluateAlertRules(metrics, thresholds);
    expect(metrics).toEqual(snapshot);
  });
});
