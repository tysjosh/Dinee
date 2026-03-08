"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AppProvider } from "@/contexts/AppProvider";

/**
 * Public routes that do NOT require authentication.
 * These routes are accessible without being wrapped by AuthGuard.
 */
const PUBLIC_ROUTES = [
  "/client/login",
  "/client/signup",
  "/client/forgot-password",
  "/client/reset-password",
];

/**
 * Checks if the current pathname is a public route (no auth required).
 */
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

interface ClientLayoutShellProps {
  children: React.ReactNode;
}

/**
 * Client-side layout shell that conditionally wraps children with AuthGuard.
 *
 * - Public routes (login, signup, forgot-password, reset-password): render children directly
 * - Protected routes (dashboard, onboarding, etc.): wrap with AuthGuard → AppProvider
 *
 * Provider chain for protected routes:
 *   ConvexClientProvider (ConvexProvider + ConvexAuthProvider)
 *     └── AuthGuard (redirects unauthenticated users)
 *           └── AppProvider
 *                 └── TenantProvider → RestaurantProvider → CallsProvider → OrdersProvider
 *
 * Requirements: 8.1, 8.3, 8.5
 */
export function ClientLayoutShell({ children }: ClientLayoutShellProps) {
  const pathname = usePathname();

  if (isPublicRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <AuthGuard>
      <AppProvider>{children}</AppProvider>
    </AuthGuard>
  );
}
