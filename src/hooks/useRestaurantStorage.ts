"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Restaurant } from "@/types/global";
import { BranchData } from "@/components/onboarding/BranchSetup";

const RESTAURANT_ID_KEY = "restaurantId";

/**
 * Extended restaurant data type that includes branches for onboarding
 */
interface RestaurantDataWithBranches extends Omit<Restaurant, 'id'> {
  branches?: BranchData[];
}

/**
 * Custom hook to manage restaurant ID in local storage and fetch data from Convex
 * Provides functions to create, update, and delete restaurant data
 * 
 * Requirements: 1.4, 3.2, 3.5 - Supports transactional multi-branch creation during onboarding
 * - Creates restaurant and default branch atomically
 * - Ensures rollback on failure
 * - Updates branchCount after branch creation
 */
export function useRestaurantStorage() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const restaurantData = useQuery(
    api.restaurants.getRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const menuItems = useQuery(
    api.menuItems.getMenuItems,
    restaurantId ? { restaurantId } : "skip"
  );
  // Use the new transactional mutation for creating restaurant with branches
  const createRestaurantWithBranches = useMutation(api.restaurants.createRestaurantWithBranches);
  const updateRestaurant = useMutation(api.restaurants.updateRestaurant);
  const createMenuItems = useMutation(api.menuItems.createMenuItems);
  const createBranch = useMutation(api.branches.createBranch);
  const updateBranchCount = useMutation(api.restaurants.updateBranchCount);
  const deleteRestaurantData = useMutation(api.restaurants.deleteRestaurantData);

  const getRestaurantId = useCallback(() => {
    try {
      const storedId = localStorage.getItem(RESTAURANT_ID_KEY);
      if (storedId) {
        setRestaurantId(storedId);
        return storedId;
      }
      return null;
    } catch (error) {
      console.error("Failed to get restaurant ID from storage", error);
      return null;
    }
  }, []);

  const saveRestaurantId = useCallback((id: string) => {
    try {
      localStorage.setItem(RESTAURANT_ID_KEY, id);
      setRestaurantId(id);
    } catch (error) {
      console.error("Failed to save restaurant ID to storage", error);
    }
  }, []);

  const clearRestaurantId = useCallback(() => {
    try {
      localStorage.removeItem(RESTAURANT_ID_KEY);
      setRestaurantId(null);
    } catch (error) {
      console.error("Failed to clear restaurant ID from storage", error);
    }
  }, []);

  const saveRestaurantData = useCallback(async (data: RestaurantDataWithBranches) => {
    try {
      if (restaurantId) {
        // Update existing restaurant
        await updateRestaurant({
          restaurantId,
          name: data.name,
          agentName: data.agentName,
          specialInstructions: data.specialInstructions,
          languagePreference: data.languagePreference as 'english' | 'nigerian_english' | 'pidgin' | 'spanish' | 'french',
        });

        // Save menu items separately
        if (data.menuDetails && data.menuDetails.length > 0) {
          await createMenuItems({
            restaurantId,
            menuItems: data.menuDetails,
          });
        }

        // Create branches if provided (for updates, branches are typically managed separately)
        // Track created branches for updating branchCount
        let newBranchCount = 0;
        if (data.branches && data.branches.length > 0) {
          for (const branch of data.branches) {
            await createBranch({
              restaurantId,
              name: branch.name,
              address: branch.address,
              phoneNumber: branch.phoneNumber,
              operatingHours: branch.operatingHours,
              isActive: true,
            });
            newBranchCount++;
          }
          
          // Update the restaurant's branchCount after adding new branches
          // Get current branchCount and add new branches
          const currentBranchCount = restaurantData?.branchCount || 0;
          await updateBranchCount({
            restaurantId,
            branchCount: currentBranchCount + newBranchCount,
          });
        }

        return { restaurantId };
      } else {
        // Use provided platformId or default platform for backward compatibility
        const platformId = data.platformId || 'default-platform';
        
        // Requirements: 1.4, 3.5 - Create restaurant and branches atomically
        // This uses the transactional mutation that:
        // 1. Creates the restaurant
        // 2. Creates all branches (or a default branch if none provided)
        // 3. Updates branchCount
        // 4. Rolls back everything if any step fails
        const result = await createRestaurantWithBranches({
          name: data.name,
          agentName: data.agentName,
          specialInstructions: data.specialInstructions,
          languagePreference: data.languagePreference as 'english' | 'nigerian_english' | 'pidgin' | 'spanish' | 'french',
          platformId,
          branches: data.branches?.map(branch => ({
            name: branch.name,
            address: branch.address,
            phoneNumber: branch.phoneNumber,
            operatingHours: branch.operatingHours,
            isActive: true,
          })),
        });

        if (result?.success && result?.restaurantId) {
          saveRestaurantId(result.restaurantId);
          
          // Save menu items after restaurant and branches are created
          if (data.menuDetails && data.menuDetails.length > 0) {
            await createMenuItems({
              restaurantId: result.restaurantId,
              menuItems: data.menuDetails,
            });
          }

          return { restaurantId: result.restaurantId };
        }
        throw new Error("Failed to create restaurant with branches");
      }
    } catch (error) {
      console.error("Failed to save restaurant data", error);
      throw error;
    }
  }, [restaurantId, restaurantData, createRestaurantWithBranches, updateRestaurant, createMenuItems, createBranch, updateBranchCount, saveRestaurantId]);

  const deleteAllData = useCallback(async () => {
    try {
      if (restaurantId) {
        const success = await deleteRestaurantData({ restaurantId });
        if (success) {
          clearRestaurantId();
        }
        return success;
      }
      return false;
    } catch (error) {
      console.error("Failed to delete restaurant data", error);
      throw error;
    }
  }, [restaurantId, deleteRestaurantData, clearRestaurantId]);

  useEffect(() => {
    const id = getRestaurantId();
    setLoading(false);
  }, [getRestaurantId]);

  // Convert Convex data to Restaurant type
  const convertedRestaurantData: Restaurant | null = restaurantData && menuItems ? {
    id: restaurantData.restaurantId,
    name: restaurantData.name,
    agentName: restaurantData.agentName,
    menuDetails: menuItems.map(item => ({
      name: item.name,
      price: item.price,
      description: item.description,
    })),
    specialInstructions: restaurantData.specialInstructions,
    languagePreference: restaurantData.languagePreference as 'english' | 'nigerian_english' | 'pidgin' | 'spanish' | 'french',
    platformId: restaurantData.platformId,
    branchCount: restaurantData.branchCount,
  } : null;

  return {
    restaurantId,
    restaurantData: convertedRestaurantData,
    loading: loading || (restaurantId && (restaurantData === undefined || menuItems === undefined)),
    saveRestaurantData,
    deleteAllData,
    clearRestaurantId,
  };
}
