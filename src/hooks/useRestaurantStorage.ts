"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Restaurant } from "@/types/global";

const RESTAURANT_ID_KEY = "restaurantId";

/**
 * Custom hook to manage restaurant ID in local storage and fetch data from Convex
 * Provides functions to create, update, and delete restaurant data
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
  const createRestaurant = useMutation(api.restaurants.createRestaurant);
  const updateRestaurant = useMutation(api.restaurants.updateRestaurant);
  const createMenuItems = useMutation(api.menuItems.createMenuItems);
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

  const saveRestaurantData = useCallback(async (data: Omit<Restaurant, 'id'>) => {
    try {
      if (restaurantId) {
        // Update existing restaurant
        await updateRestaurant({
          restaurantId,
          platformId: data.platformId,
          name: data.name,
          agentName: data.agentName,
          specialInstructions: data.specialInstructions,
          languagePreference: data.languagePreference as 'english' | 'spanish' | 'french' | 'pidgin',
        });

        // Save menu items separately
        if (data.menuDetails && data.menuDetails.length > 0) {
          await createMenuItems({
            restaurantId,
            menuItems: data.menuDetails,
          });
        }



        return { restaurantId };
      } else {
        const result = await createRestaurant({
          platformId: data.platformId,
          name: data.name,
          agentName: data.agentName,
          specialInstructions: data.specialInstructions,
          languagePreference: data.languagePreference as 'english' | 'spanish' | 'french' | 'pidgin',
        });

        if (result?.restaurantId) {
          saveRestaurantId(result.restaurantId);
          if (data.menuDetails && data.menuDetails.length > 0) {
            await createMenuItems({
              restaurantId: result.restaurantId,
              menuItems: data.menuDetails,
            });
          }



          return result;
        }
        throw new Error("Failed to create restaurant");
      }
    } catch (error) {
      console.error("Failed to save restaurant data", error);
      throw error;
    }
  }, [restaurantId, createRestaurant, updateRestaurant, createMenuItems, saveRestaurantId]);

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
    platformId: restaurantData.platformId,
    name: restaurantData.name,
    agentName: restaurantData.agentName,
    menuDetails: menuItems.map(item => ({
      name: item.name,
      price: item.price,
      description: item.description,
      modifiers: item.modifiers,
    })),
    specialInstructions: restaurantData.specialInstructions,
    languagePreference: restaurantData.languagePreference as 'english' | 'spanish' | 'french' | 'pidgin',
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
