"use client";

import { useMemo, useState, useEffect } from "react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { usePlatformStorage } from "@/hooks/usePlatformStorage";
import { useUserStorage } from "@/hooks/useUserStorage";
import { api } from "../../../../convex/_generated/api";

const STAT_CARDS = [
  {
    key: "calls",
    label: "Calls",
    description: "Total calls handled",
  },
  {
    key: "orders",
    label: "Orders",
    description: "Orders captured",
  },
  {
    key: "missedCalls",
    label: "Missed Calls",
    description: "Completed calls without orders",
  },
  {
    key: "conversionRate",
    label: "Conversion Rate",
    description: "Orders ÷ calls",
    format: (value: number) => `${value.toFixed(1)}%`,
  },
] as const;

export default function PlatformDashboardPage() {
  const router = useRouter();
  const { userId, loading: userLoading } = useUserStorage();
  const { platformId, platformData, platformSummary, loading } = usePlatformStorage(userId ?? undefined);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!loading && !userLoading && (!platformId || !userId)) {
      router.push("/client/onboarding");
    }
  }, [loading, userLoading, platformId, userId, router]);

  const dateFilters = useMemo(() => {
    const start = startDate ? new Date(startDate).getTime() : undefined;
    const end = endDate
      ? new Date(`${endDate}T23:59:59`).getTime()
      : undefined;
    return { startDate: start, endDate: end };
  }, [startDate, endDate]);

  const restaurants = useQuery(
    api.restaurants.listRestaurantsByPlatform,
    platformId ? { platformId } : "skip"
  );

  const branches = useQuery(
    api.branches.listBranchesByPlatform,
    platformId ? { platformId } : "skip"
  );

  const platformMetrics = useQuery(
    api.platforms.getPlatformMetrics,
    platformId && userId
      ? {
          platformId,
          userId,
          restaurantId: selectedRestaurantId || undefined,
          branchId: selectedBranchId || undefined,
          ...dateFilters,
        }
      : "skip"
  );

  const platformReport = useQuery(
    api.platforms.getPlatformReport,
    platformId && userId
      ? {
          platformId,
          userId,
          restaurantId: selectedRestaurantId || undefined,
          branchId: selectedBranchId || undefined,
          ...dateFilters,
        }
      : "skip"
  );

  if (loading || userLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex items-center justify-center min-h-screen px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="text-center space-y-6"
          >
            <div className="bg-black border border-gray-800 rounded-lg p-8 max-w-md">
              <div className="relative mb-6">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto"></div>
              </div>
              <h2 className="text-lg font-medium text-white mb-2">
                Loading Platform Dashboard
              </h2>
              <p className="text-gray-400 text-sm">
                Preparing platform insights...
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!platformId) {
    return null;
  }

  const metricData = platformMetrics ?? platformSummary;

  const handleExport = () => {
    if (!platformReport) return;

    const callRows = [
      ["Call ID", "Restaurant ID", "Branch ID", "Status", "Order ID", "Phone Number", "Call Start Time"],
      ...platformReport.calls.map((call) => [
        call.callId,
        call.restaurantId,
        call.branchId,
        call.status,
        call.orderId,
        call.phoneNumber,
        call.callStartTime ? new Date(call.callStartTime).toISOString() : "",
      ]),
    ];

    const orderRows = [
      ["Order ID", "Restaurant ID", "Branch ID", "Status", "Total Amount", "Payment Status", "Order Time"],
      ...platformReport.orders.map((order) => [
        order.orderId,
        order.restaurantId,
        order.branchId,
        order.status,
        order.totalAmount ?? "",
        order.paymentStatus,
        order.orderPlacementTime ? new Date(order.orderPlacementTime).toISOString() : "",
      ]),
    ];

    const csvContent = [
      "Calls",
      ...callRows.map((row) => row.join(",")),
      "",
      "Orders",
      ...orderRows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `platform-report-${platformId}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-black text-white px-6 py-16">
      <div className="max-w-5xl mx-auto space-y-10">
        <div>
          <h1 className="text-3xl text-white text-minimal">
            {platformData?.name || "Platform Dashboard"}
          </h1>
          <p className="text-white/60 mt-2">
            Platform ID: <span className="text-white/80 font-mono">{platformId}</span>
          </p>
        </div>

        <div className="card-minimal rounded-xl p-6 border border-white/10 space-y-4">
          <h2 className="text-lg text-white text-minimal">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Restaurant
              </label>
              <select
                value={selectedRestaurantId}
                onChange={(e) => setSelectedRestaurantId(e.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              >
                <option value="">All restaurants</option>
                {(restaurants ?? []).map((restaurant) => (
                  <option key={restaurant.restaurantId} value={restaurant.restaurantId}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Branch
              </label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              >
                <option value="">All branches</option>
                {(branches ?? []).map((branch) => (
                  <option key={branch.branchId} value={branch.branchId}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-2">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-2">
                End date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-dark w-full px-4 py-2 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleExport}
              className="btn-minimal btn-primary-minimal px-4 py-2 rounded-lg text-sm"
              disabled={!platformReport}
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {STAT_CARDS.map((stat) => (
            <div
              key={stat.key}
              className="card-minimal rounded-xl p-6 border border-white/10"
            >
              <p className="text-sm text-white/60">{stat.label}</p>
              <p className="text-3xl text-white mt-3">
                {stat.format
                  ? stat.format(Number(metricData?.[stat.key] ?? 0))
                  : metricData?.[stat.key] ?? 0}
              </p>
              <p className="text-sm text-white/50 mt-2">{stat.description}</p>
            </div>
          ))}
        </div>

        <div className="card-minimal rounded-xl p-6 border border-white/10">
          <h2 className="text-lg text-white text-minimal">Next Steps</h2>
          <ul className="mt-4 space-y-2 text-white/70 text-sm">
            <li>• Add restaurants and branches to begin capturing orders.</li>
            <li>• Share the platform ID with your onboarding team.</li>
            <li>• Monitor call and order metrics as pilots go live.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
