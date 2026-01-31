"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const USER_ID_KEY = "userId";

export type UserRole =
  | "platform_admin"
  | "restaurant_owner"
  | "branch_manager"
  | "supervisor";

export function useUserStorage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const user = useQuery(api.users.getUser, userId ? { userId } : "skip");
  const createUser = useMutation(api.users.createUser);

  const loadUserId = useCallback(() => {
    try {
      const stored = localStorage.getItem(USER_ID_KEY);
      if (stored) {
        setUserId(stored);
      }
    } catch (error) {
      console.error("Failed to read user ID from storage", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveUserId = useCallback((id: string) => {
    try {
      localStorage.setItem(USER_ID_KEY, id);
      setUserId(id);
    } catch (error) {
      console.error("Failed to save user ID", error);
    }
  }, []);

  const clearUserId = useCallback(() => {
    try {
      localStorage.removeItem(USER_ID_KEY);
      setUserId(null);
    } catch (error) {
      console.error("Failed to clear user ID", error);
    }
  }, []);

  const createPrimaryUser = useCallback(
    async ({
      email,
      role,
      platformId,
      restaurantId,
      branchId,
    }: {
      email: string;
      role: UserRole;
      platformId?: string;
      restaurantId?: string;
      branchId?: string;
    }) => {
      const result = await createUser({
        email,
        role,
        platformId,
        restaurantId,
        branchId,
      });
      if (result?.userId) {
        saveUserId(result.userId);
        return result.userId;
      }
      return null;
    },
    [createUser, saveUserId]
  );

  useEffect(() => {
    loadUserId();
  }, [loadUserId]);

  return {
    userId,
    user,
    loading,
    createPrimaryUser,
    saveUserId,
    clearUserId,
  };
}
