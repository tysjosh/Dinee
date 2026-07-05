import { describe, it, expect } from "vitest";
import {
  computeAgentRates,
  computeTenantAgentRates,
  type AgentMetricRow,
} from "./windowedMetrics";

/**
 * Unit tests for the windowed per-agent rate aggregation (Req 16.2, 16.3, 16.4).
 */

function row(overrides: Partial<AgentMetricRow> = {}): AgentMetricRow {
  return {
    tenantId: "tenant-a",
    conversationType: "runsheet_fuel_intake",
    createdAt: 1_000,
    callsReceived: 1,
    callsCompleted: 1,
    toolSuccessCount: 0,
    toolFailureCount: 0,
    fallbackOccurred: false,
    reviewRequired: false,
    autoSubmitOutcome: "not_applicable",
    ...overrides,
  };
}

describe("computeAgentRates", () => {
  it("returns no agents when there are no rows", () => {
    expect(computeAgentRates([], 0, 10_000)).toEqual([]);
  });

  it("computes the four rates for a single agent", () => {
    const rows: AgentMetricRow[] = [
      row({
        toolSuccessCount: 3,
        toolFailureCount: 1,
        fallbackOccurred: true,
        reviewRequired: true,
        autoSubmitOutcome: "auto_submitted",
      }),
      row({
        toolSuccessCount: 4,
        toolFailureCount: 0,
        fallbackOccurred: false,
        reviewRequired: false,
        autoSubmitOutcome: "not_eligible",
      }),
    ];

    const [agent] = computeAgentRates(rows, 0, 10_000);

    expect(agent.conversationType).toBe("runsheet_fuel_intake");
    expect(agent.callCount).toBe(2);
    expect(agent.toolInvocations).toBe(8);
    // 1 failure out of 8 invocations.
    expect(agent.toolFailureRate).toBeCloseTo(1 / 8);
    // 1 of 2 calls had a fallback / review / auto-submit.
    expect(agent.fallbackRate).toBeCloseTo(0.5);
    expect(agent.reviewRequiredRate).toBeCloseTo(0.5);
    expect(agent.autoSubmitRate).toBeCloseTo(0.5);
  });

  it("groups by conversation type and sorts deterministically", () => {
    const rows: AgentMetricRow[] = [
      row({ conversationType: "runsheet_order_status" }),
      row({ conversationType: "runsheet_fuel_intake" }),
    ];

    const agents = computeAgentRates(rows, 0, 10_000);
    expect(agents.map((a) => a.conversationType)).toEqual([
      "runsheet_fuel_intake",
      "runsheet_order_status",
    ]);
  });

  it("uses a zero rate when the denominator is zero (no tool invocations)", () => {
    const [agent] = computeAgentRates([row()], 0, 10_000);
    expect(agent.toolInvocations).toBe(0);
    expect(agent.toolFailureRate).toBe(0);
  });

  it("excludes rows outside the half-open window [start, end)", () => {
    const rows: AgentMetricRow[] = [
      row({ createdAt: 99 }), // before start
      row({ createdAt: 100 }), // inclusive start
      row({ createdAt: 199 }), // inside
      row({ createdAt: 200 }), // exclusive end
    ];

    const [agent] = computeAgentRates(rows, 100, 200);
    expect(agent.callCount).toBe(2);
  });
});

describe("computeTenantAgentRates", () => {
  it("groups by tenant and lists only tenants with in-window activity", () => {
    const rows: AgentMetricRow[] = [
      row({ tenantId: "tenant-b", createdAt: 150 }),
      row({ tenantId: "tenant-a", createdAt: 150 }),
      row({ tenantId: "tenant-c", createdAt: 5 }), // outside window
    ];

    const tenants = computeTenantAgentRates(rows, 100, 200);
    expect(tenants.map((t) => t.tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(tenants[0].agents).toHaveLength(1);
  });

  it("keeps tenant rate computations isolated from one another", () => {
    const rows: AgentMetricRow[] = [
      row({ tenantId: "tenant-a", fallbackOccurred: true }),
      row({ tenantId: "tenant-b", fallbackOccurred: false }),
    ];

    const tenants = computeTenantAgentRates(rows, 0, 10_000);
    const a = tenants.find((t) => t.tenantId === "tenant-a");
    const b = tenants.find((t) => t.tenantId === "tenant-b");
    expect(a?.agents[0].fallbackRate).toBe(1);
    expect(b?.agents[0].fallbackRate).toBe(0);
  });
});
