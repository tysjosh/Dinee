"use client";

import React, { ReactNode } from "react";
import { CallsProvider } from "./CallsContext";
import { OrdersProvider } from "./OrdersContext";
import { RestaurantProvider } from "./RestaurantContext";
import { TenantProvider, UserRole } from "./TenantContext";
import { Toaster } from "@/components/ui/sonner";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";

interface AppProviderProps {
  children: ReactNode;
  // Optional tenant configuration for multi-tenant support
  initialPlatformId?: string;
  initialBranchId?: string;
  initialRole?: UserRole;
}

/**
 * Main application provider that wraps all context providers
 * This ensures all state management contexts are available throughout the app
 * 
 * Provider hierarchy:
 * - TenantProvider: Multi-tenant context (platform, restaurant, branch, role)
 * - RestaurantProvider: Restaurant-specific data
 * - CallsProvider: Call management state
 * - OrdersProvider: Order management state
 */
export function AppProvider({ 
  children,
  initialPlatformId,
  initialBranchId,
  initialRole,
}: AppProviderProps) {
  const { restaurantId } = useRestaurantStorage();

  return (
    <TenantProvider
      initialPlatformId={initialPlatformId}
      initialRestaurantId={restaurantId || undefined}
      initialBranchId={initialBranchId}
      initialRole={initialRole}
    >
      <RestaurantProvider>
        <CallsProvider key={`calls-${restaurantId || "no-id"}`}>
          <OrdersProvider key={`orders-${restaurantId || "no-id"}`}>
            {children}
            <Toaster
              closeButton={true}
              richColors={true}
              duration={2000}
              theme="system"
              position="bottom-right"
            />
          </OrdersProvider>
        </CallsProvider>
      </RestaurantProvider>
    </TenantProvider>
  );
}

// Export all hooks for easy access
export { useCalls } from "./CallsContext";
export { useOrders } from "./OrdersContext";
export { useRestaurant } from "./RestaurantContext";
export { useTenant } from "./TenantContext";

// Export tenant types for convenience
export type { 
  UserRole, 
  Permission, 
  TenantScope, 
  Platform, 
  Branch,
  ResourceAction,
} from "./TenantContext";

export { 
  ROLE_PERMISSIONS, 
  getPermissionsForRole, 
  roleHasPermission,
  getTenantTypeForRole,
} from "./TenantContext";
