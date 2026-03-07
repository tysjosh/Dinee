"use client";

import { useRestaurantStorage } from "./useRestaurantStorage";

/**
 * Thin wrapper over useRestaurantStorage that re-exports with
 * business-centric naming. Consuming components can migrate
 * incrementally from useRestaurantStorage → useBusinessStorage.
 *
 * Requirement: REQ-1.2
 */
export function useBusinessStorage() {
  const storage = useRestaurantStorage();

  return {
    businessId: storage.restaurantId,
    businessData: storage.restaurantData,
    loading: storage.loading,
    saveBusinessData: storage.saveRestaurantData,
    deleteAllData: storage.deleteAllData,
    clearBusinessId: storage.clearRestaurantId,
  };
}
