"use client";

import React, { useState, useMemo } from "react";
import type { Vertical } from "@/lib/modules/types";

/**
 * KPI Dashboard UI with vertical filtering.
 * Displays metrics segmented by vertical with date range support.
 *
 * Requirements: 15.7
 */

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
  snapshots: KpiSnapshot[];
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
  runsheet_attach_rate: "Runsheet Attach Rate",
  revenue_per_tenant: "Revenue / Tenant",
  call_to_outcome_conversion: "Call → Outcome",
  churn_rate: "Churn Rate",
};

const KpiDashboard: React.FC<KpiDashboardProps> = ({ snapshots }) => {
  const [selectedVertical, setSelectedVertical] = useState<Vertical | "all">("all");
  const [selectedPeriod, setSelectedPeriod] = useState<"day" | "week" | "month">("day");

  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      if (selectedVertical !== "all" && s.vertical !== selectedVertical) return false;
      if (s.periodType !== selectedPeriod) return false;
      return true;
    });
  }, [snapshots, selectedVertical, selectedPeriod]);

  // Group by metric for display
  const metricGroups = useMemo(() => {
    const groups: Record<string, KpiSnapshot[]> = {};
    for (const s of filteredSnapshots) {
      if (!groups[s.metricName]) groups[s.metricName] = [];
      groups[s.metricName].push(s);
    }
    return groups;
  }, [filteredSnapshots]);

  const formatValue = (metricName: string, value: number): string => {
    if (metricName.includes("rate") || metricName.includes("conversion") || metricName.includes("churn")) {
      return `${value.toFixed(1)}%`;
    }
    if (metricName.includes("revenue")) {
      return `$${value.toFixed(2)}`;
    }
    return value.toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
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

        <div className="flex rounded-lg border border-white/20 overflow-hidden">
          {(["day", "week", "month"] as const).map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                selectedPeriod === period
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      {Object.keys(metricGroups).length === 0 ? (
        <div className="card-minimal rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-white/60">No KPI data available for the selected filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(metricGroups).map(([metricName, metricSnapshots]) => {
            const latest = metricSnapshots.reduce((a, b) =>
              a.createdAt > b.createdAt ? a : b
            );
            return (
              <div key={metricName} className="card-minimal rounded-xl p-4">
                <p className="text-xs text-white/50 uppercase tracking-wider">
                  {METRIC_LABELS[metricName] ?? metricName}
                </p>
                <p className="text-2xl font-semibold text-white mt-2">
                  {formatValue(metricName, latest.value)}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-white/40">
                    {VERTICAL_LABELS[latest.vertical] ?? latest.vertical}
                  </span>
                  <span className="text-xs text-white/40">
                    {new Date(latest.periodStart).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KpiDashboard;
