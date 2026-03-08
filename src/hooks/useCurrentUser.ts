"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

export interface UseCurrentUserResult {
  user: Doc<"users"> | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * Hook to get the current authenticated user's full record.
 * Uses Convex Auth session to resolve the user identity, then
 * queries the users table for the complete Doc<"users"> record.
 *
 * Requirements: 1.4
 */
export function useCurrentUser(): UseCurrentUserResult {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();

  const user = useQuery(
    api.users.currentUser,
    isAuthenticated ? {} : "skip"
  );

  const isLoading = authLoading || (isAuthenticated && user === undefined);

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated,
  };
}
