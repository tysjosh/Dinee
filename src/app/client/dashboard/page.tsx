"use client";

import React from "react";
import { motion } from "motion/react";
import {
  DashboardLayout,
  CallsSection,
  OrdersSection,
} from "@/components/dashboard";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { toTitleCase } from "@/lib/utils";

/**
 * Main dashboard page that displays restaurant call and order management interface.
 * Route protection (auth check, onboarding redirect) is handled by AuthGuard
 * in the client layout — no localStorage-based redirect logic needed here.
 */
export default function DashboardPage() {
  const { restaurantData, loading } = useRestaurantStorage();

  const restaurantName = restaurantData?.name
    ? toTitleCase(restaurantData.name)
    : "Restaurant Dashboard";

  if (loading) {
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
                Loading Dashboard
              </h2>
              <p className="text-gray-400 text-sm">
                Preparing your restaurant management interface...
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <DashboardLayout restaurantName={restaurantName}>
        <CallsSection tabId="calls" />
        <OrdersSection tabId="orders" />
      </DashboardLayout>
    </div>
  );
}
