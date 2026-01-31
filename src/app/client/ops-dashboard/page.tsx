"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

const DEFAULT_SERVICE = "voice-ai";

const computeUptime = (metrics: Array<{ status: string }>) => {
  if (!metrics.length) return 100;
  const okCount = metrics.filter((metric) => metric.status === "ok").length;
  return Number(((okCount / metrics.length) * 100).toFixed(1));
};

const computeLatency = (metrics: Array<{ latencyMs: number }>) => {
  if (!metrics.length) return 0;
  const total = metrics.reduce((sum, metric) => sum + metric.latencyMs, 0);
  return Math.round(total / metrics.length);
};

export default function OpsDashboardPage() {
  const [serviceName, setServiceName] = useState(DEFAULT_SERVICE);
  const [uptimeTarget, setUptimeTarget] = useState("99.5");
  const [latencyThreshold, setLatencyThreshold] = useState("1200");

  const metrics = useQuery(api.monitoring.getRecentServiceMetrics, {
    serviceName,
    limit: 50,
  });
  const slaConfig = useQuery(api.monitoring.getSlaConfig, { serviceName });
  const upsertSlaConfig = useMutation(api.monitoring.upsertSlaConfig);

  const uptime = useMemo(() => computeUptime(metrics ?? []), [metrics]);
  const avgLatency = useMemo(() => computeLatency(metrics ?? []), [metrics]);

  const handleSave = async () => {
    await upsertSlaConfig({
      serviceName,
      uptimeTarget: Number(uptimeTarget),
      latencyThresholdMs: Number(latencyThreshold),
    });
  };

  return (
    <div className="min-h-screen bg-black text-white px-6 py-16">
      <div className="max-w-4xl mx-auto space-y-10">
        <div>
          <h1 className="text-3xl text-white text-minimal">
            Reliability &amp; Observability
          </h1>
          <p className="text-white/60 mt-2">
            Track uptime and latency for critical services, and manage SLA thresholds.
          </p>
        </div>

        <div className="card-minimal rounded-xl p-6 border border-white/10 space-y-4">
          <h2 className="text-lg text-white text-minimal">Service Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-2">Service Name</label>
              <input
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
                placeholder="voice-ai"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card-minimal rounded-xl p-6 border border-white/10">
            <p className="text-sm text-white/60">Uptime (last 50 checks)</p>
            <p className="text-3xl text-white mt-3">{uptime}%</p>
            <p className="text-sm text-white/50 mt-2">
              Target: {slaConfig?.uptimeTarget ?? uptimeTarget}%
            </p>
          </div>
          <div className="card-minimal rounded-xl p-6 border border-white/10">
            <p className="text-sm text-white/60">Average Latency</p>
            <p className="text-3xl text-white mt-3">{avgLatency} ms</p>
            <p className="text-sm text-white/50 mt-2">
              Threshold: {slaConfig?.latencyThresholdMs ?? latencyThreshold} ms
            </p>
          </div>
        </div>

        <div className="card-minimal rounded-xl p-6 border border-white/10 space-y-4">
          <h2 className="text-lg text-white text-minimal">SLA Thresholds</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Uptime Target (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={uptimeTarget}
                onChange={(event) => setUptimeTarget(event.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Latency Threshold (ms)
              </label>
              <input
                type="number"
                value={latencyThreshold}
                onChange={(event) => setLatencyThreshold(event.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            className="btn-minimal btn-primary-minimal px-4 py-2 rounded-lg text-sm"
          >
            Save SLA Thresholds
          </button>
        </div>
      </div>
    </div>
  );
}
