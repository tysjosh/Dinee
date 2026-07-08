"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  DashboardLayout,
  CallsSection,
  OrdersSection,
} from "@/components/dashboard";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toTitleCase } from "@/lib/utils";

function DashboardLoading() {
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
              Preparing your workspace...
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Main dashboard page.
 *
 * A tenant name is always available for an onboarded user, so there is no
 * hardcoded title fallback. If the authenticated user has no tenant yet (an
 * un-onboarded or orphaned account), the dashboard is an invalid state — we
 * redirect to onboarding rather than paint a placeholder over it. Route auth is
 * still handled by AuthGuard; this is the tenant-completeness guard.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: userLoading } = useCurrentUser();
  const { restaurantData, loading } = useRestaurantStorage();

  // No tenant on the resolved account => onboarding is incomplete. Send them to
  // finish setup instead of rendering a business-less dashboard.
  const needsOnboarding = !userLoading && !user?.tenantId;
  useEffect(() => {
    if (needsOnboarding) {
      router.replace("/client/onboarding");
    }
  }, [needsOnboarding, router]);

  if (userLoading || loading || needsOnboarding) {
    return <DashboardLoading />;
  }

  // Neutral placeholder only for the brief window before the tenant record
  // hydrates; the real (vertical-agnostic) name replaces it once loaded.
  const businessName = restaurantData?.name
    ? toTitleCase(restaurantData.name)
    : "Dashboard";

  return (
    <div className="min-h-screen bg-black text-white">
      <DashboardLayout restaurantName={businessName}>
        <CallsSection tabId="calls" />
        <OrdersSection tabId="orders" />
      </DashboardLayout>
    </div>
  );
}
