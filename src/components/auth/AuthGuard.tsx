"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
  const { user, isLoading, isAuthenticated } = useCurrentUser();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.push("/client/login");
      return;
    }

    if (user && !user.tenantId) {
      router.push("/client/onboarding");
    }
  }, [isLoading, isAuthenticated, user, router]);

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

  if (user && !user.tenantId) {
    return null;
  }

  return <>{children}</>;
}
