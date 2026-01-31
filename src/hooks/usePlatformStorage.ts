"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const PLATFORM_ID_KEY = "platformId";
const BRANCH_ID_KEY = "branchId";

export function usePlatformStorage(userId?: string) {
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const platformData = useQuery(
    api.platforms.getPlatform,
    platformId ? { platformId } : "skip"
  );

  const platformSummary = useQuery(
    api.platforms.getPlatformSummary,
    platformId && userId ? { platformId, userId } : "skip"
  );

  const createPlatform = useMutation(api.platforms.createPlatform);
  const createBranch = useMutation(api.branches.createBranch);

  const loadStoredIds = useCallback(() => {
    try {
      const storedPlatformId = localStorage.getItem(PLATFORM_ID_KEY);
      const storedBranchId = localStorage.getItem(BRANCH_ID_KEY);
      if (storedPlatformId) {
        setPlatformId(storedPlatformId);
      }
      if (storedBranchId) {
        setBranchId(storedBranchId);
      }
    } catch (error) {
      console.error("Failed to read platform data from storage", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const savePlatformId = useCallback((id: string) => {
    try {
      localStorage.setItem(PLATFORM_ID_KEY, id);
      setPlatformId(id);
    } catch (error) {
      console.error("Failed to save platform ID", error);
    }
  }, []);

  const saveBranchId = useCallback((id: string) => {
    try {
      localStorage.setItem(BRANCH_ID_KEY, id);
      setBranchId(id);
    } catch (error) {
      console.error("Failed to save branch ID", error);
    }
  }, []);

  const clearPlatformData = useCallback(() => {
    try {
      localStorage.removeItem(PLATFORM_ID_KEY);
      localStorage.removeItem(BRANCH_ID_KEY);
      setPlatformId(null);
      setBranchId(null);
    } catch (error) {
      console.error("Failed to clear platform data", error);
    }
  }, []);

  const ensurePlatform = useCallback(
    async ({
      platformName,
      existingPlatformId,
    }: {
      platformName?: string;
      existingPlatformId?: string;
    }) => {
      if (existingPlatformId) {
        savePlatformId(existingPlatformId);
        return existingPlatformId;
      }

      if (!platformName) {
        return null;
      }

      const result = await createPlatform({ name: platformName });
      if (result?.platformId) {
        savePlatformId(result.platformId);
        return result.platformId;
      }

      return null;
    },
    [createPlatform, savePlatformId]
  );

  const ensureBranch = useCallback(
    async ({
      platformId: targetPlatformId,
      restaurantId,
      branchName,
      branchAddress,
    }: {
      platformId: string;
      restaurantId: string;
      branchName?: string;
      branchAddress?: string;
    }) => {
      if (!branchName) {
        return null;
      }

      const result = await createBranch({
        platformId: targetPlatformId,
        restaurantId,
        name: branchName,
        address: branchAddress,
      });

      if (result?.branchId) {
        saveBranchId(result.branchId);
        return result.branchId;
      }

      return null;
    },
    [createBranch, saveBranchId]
  );

  useEffect(() => {
    loadStoredIds();
  }, [loadStoredIds]);

  return {
    platformId,
    branchId,
    platformData,
    platformSummary,
    loading,
    ensurePlatform,
    ensureBranch,
    savePlatformId,
    saveBranchId,
    clearPlatformData,
  };
}
