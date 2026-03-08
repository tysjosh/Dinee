"use client";

import React, { ReactNode } from "react";
import { CallsProvider } from "./CallsContext";
import { OrdersProvider } from "./OrdersContext";
import { RestaurantProvider } from "./RestaurantContext";
import { TenantProvider, UserRole } from "./TenantContext";
import { Toaster } from "@/components/ui/sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface AppProviderProps {
  children: ReactNode;
  // Optional overrides — used for testing or SSR scenarios
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
 * 
 * Tenant resolution is derived from the authenticated user's session
 * via useCurrentUser(), replacing the previous localStorage-based approach.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export function AppProvider({ 
  children,
  initialPlatformId,
  initialBranchId,
  initialRole,
}: AppProviderProps) {
  const { user, isLoading } = useCurrentUser();

  // Derive tenant identity from the authenticated user's record
  const resolvedRole: UserRole = (initialRole ?? user?.role ?? 'supervisor') as UserRole;

  const resolvedRestaurantId =
    (user?.tenantType === 'restaurant' || user?.tenantType === 'business')
      ? user.tenantId
      : undefined;

  const resolvedPlatformId =
    initialPlatformId ?? (user?.tenantType === 'platform' ? user.tenantId : undefined);

  const resolvedBranchId =
    initialBranchId ?? (user?.tenantType === 'branch' ? user.tenantId : undefined);

  // Use the restaurantId (or empty string) as a stable key so child providers
  // re-mount when the tenant changes (e.g. after onboarding completes).
  const tenantKey = resolvedRestaurantId || "no-id";

  return (
    <TenantProvider
      initialPlatformId={resolvedPlatformId}
      initialRestaurantId={resolvedRestaurantId || undefined}
      initialBranchId={resolvedBranchId}
      initialRole={resolvedRole}
    >
      <RestaurantProvider>
        <CallsProvider key={`calls-${tenantKey}`}>
          <OrdersProvider key={`orders-${tenantKey}`}>
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
