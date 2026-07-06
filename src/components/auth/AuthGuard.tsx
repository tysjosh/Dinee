"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** The onboarding route is where users without a tenant belong, so the
 * "no tenantId → redirect to onboarding" rule must not apply while on it
 * (otherwise the guard renders null on the very page it redirects to). */
const ONBOARDING_ROUTE = "/client/onboarding";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side route protection component that wraps protected routes.
 * Handles three auth states:
 * - Loading: shows a spinner while session resolves
 * - Unauthenticated: redirects to /client/login
 * - Authenticated with empty tenantId: redirects to /client/onboarding
 * - Authenticated with tenantId: renders children
 *
 * Requirements: 8.1, 8.2, 8.5
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated } = useCurrentUser();

  const onOnboarding =
    pathname === ONBOARDING_ROUTE || pathname.startsWith(ONBOARDING_ROUTE + "/");

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.push("/client/login");
      return;
    }

    if (user && !user.tenantId && !onOnboarding) {
      router.push("/client/onboarding");
    }
  }, [isLoading, isAuthenticated, user, router, onOnboarding]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="flex items-center justify-center min-h-screen px-6">
          <div className="text-center space-y-6">
            <div className="bg-black border border-gray-800 rounded-lg p-8 max-w-md">
              <div className="relative mb-6">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto"></div>
              </div>
              <h2 className="text-lg font-medium text-white mb-2">
                Verifying access
              </h2>
              <p className="text-gray-400 text-sm">
                Checking your authentication status...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (user && !user.tenantId && !onOnboarding) {
    return null;
  }

  return <>{children}</>;
}
