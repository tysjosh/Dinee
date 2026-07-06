"use client";

import React, { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Vertical } from "@/lib/modules/types";
import { useCurrency } from "@/hooks/useCurrency";
import { formatMoney, type CurrencyCode } from "@/lib/region";

interface KpiSnapshot {
  snapshotId: string;
  metricName: string;
  vertical: Vertical;
  periodType: "day" | "week" | "month";
  periodStart: number;
  periodEnd: number;
  value: number;
  metadata?: string;
  createdAt: number;
}

interface KpiDashboardProps {
  snapshots?: KpiSnapshot[];
  tabId?: string;
}

const VERTICALS: Vertical[] = [
  "restaurant",
  "logistics",
  "general_services",
  "healthcare",
  "legal",
  "hospitality",
];

const VERTICAL_LABELS: Record<Vertical, string> = {
  restaurant: "Restaurant",
  logistics: "Logistics",
  general_services: "General Services",
  healthcare: "Healthcare",
  legal: "Legal",
  hospitality: "Hospitality",
};

const METRIC_LABELS: Record<string, string> = {
  active_tenant_count: "Active Tenants",
  call_volume: "Call Volume",
  call_minutes: "Call Minutes",
  call_to_outcome_conversion: "Conversion Rate",
  integration_attach_rate: "Integration Attach Rate",
  arpa: "ARPA",
  churn_rate: "Churn Rate",
};

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

type TimeRange = (typeof TIME_RANGES)[number]["days"];

function formatMetricValue(metricName: string, value: number, currency: CurrencyCode): string {
  if (metricName === "call_to_outcome_conversion" || metricName === "integration_attach_rate" || metricName === "churn_rate") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (metricName === "arpa") {
    return formatMoney(value, currency);
  }
  if (metricName === "call_minutes") {
    return `${value.toFixed(1)} min`;
  }
  return value.toLocaleString();
}

function computeDelta(current: number, previous: number): { delta: number; label: string } {
  if (previous === 0) return { delta: 0, label: "—" };
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return { delta, label: `${sign}${delta.toFixed(1)}%` };
}

const KpiDashboard: React.FC<KpiDashboardProps> = ({ snapshots: propSnapshots }) => {
  const [selectedVertical, setSelectedVertical] = useState<Vertical | "all">("all");
  const [selectedRange, setSelectedRange] = useState<TimeRange>(30);

  // ARPA is money; format it in the tenant's currency (US → USD, NG → NGN).
  const { currency } = useCurrency();

  // Query snapshots from Convex for each vertical
  const queryVertical = selectedVertical === "all" ? "restaurant" : selectedVertical;
  const convexSnapshots = useQuery(api.kpiSnapshots.getLatestSnapshots, { vertical: queryVertical });

  const snapshots: KpiSnapshot[] = propSnapshots ?? convexSnapshots ?? [];

  const now = Date.now();
  const rangeStart = now - selectedRange * 24 * 60 * 60 * 1000;
  const previousRangeStart = rangeStart - selectedRange * 24 * 60 * 60 * 1000;

  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      if (selectedVertical !== "all" && s.vertical !== selectedVertical) return false;
      return s.periodStart >= rangeStart;
    });
  }, [snapshots, selectedVertical, rangeStart]);

  const previousSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      if (selectedVertical !== "all" && s.vertical !== selectedVertical) return false;
      return s.periodStart >= previousRangeStart && s.periodStart < rangeStart;
    });
  }, [snapshots, selectedVertical, previousRangeStart, rangeStart]);

  // Group by metric, get latest value and previous period value
  const metricCards = useMemo(() => {
    const metrics = Object.keys(METRIC_LABELS);
    return metrics.map((metricName) => {
      const currentEntries = filteredSnapshots.filter((s) => s.metricName === metricName);
      const previousEntries = previousSnapshots.filter((s) => s.metricName === metricName);

      const latest = currentEntries.length > 0
        ? currentEntries.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        : null;
      const prevLatest = previousEntries.length > 0
        ? previousEntries.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        : null;

      const currentValue = latest?.value ?? 0;
      const previousValue = prevLatest?.value ?? 0;
      const { delta, label: deltaLabel } = computeDelta(currentValue, previousValue);

      return { metricName, currentValue, delta, deltaLabel, hasData: latest !== null };
    });
  }, [filteredSnapshots, previousSnapshots]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={selectedVertical}
          onChange={(e) => setSelectedVertical(e.target.value as Vertical | "all")}
          className="px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          aria-label="Filter by vertical"
        >
          <option value="all" className="bg-black">All Verticals</option>
          {VERTICALS.map((v) => (
            <option key={v} value={v} className="bg-black">
              {VERTICAL_LABELS[v]}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg border border-white/20 overflow-hidden" role="group" aria-label="Time range">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => setSelectedRange(range.days)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                selectedRange === range.days
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {metricCards.map(({ metricName, currentValue, delta, deltaLabel, hasData }) => (
          <div key={metricName} className="card-minimal rounded-xl p-4">
            <p className="text-xs text-white/50 uppercase tracking-wider">
              {METRIC_LABELS[metricName] ?? metricName}
            </p>
            <p className="text-2xl font-semibold text-white mt-2">
              {hasData ? formatMetricValue(metricName, currentValue, currency) : "—"}
            </p>
            <div className="flex items-center mt-2">
              {hasData && deltaLabel !== "—" ? (
                <span className={`text-xs font-medium ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {deltaLabel} vs prev {selectedRange}d
                </span>
              ) : (
                <span className="text-xs text-white/30">No comparison data</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KpiDashboard;
