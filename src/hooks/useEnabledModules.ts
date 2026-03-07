import { useMemo, useCallback } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { getVisibleSections } from "@/lib/modules/uiSectionRegistry";
import type { UISectionDescriptor } from "@/lib/modules/types";

/**
 * Reads the Business's enabledModules from RestaurantContext and exposes
 * helpers for checking module activation and retrieving visible UI sections.
 *
 * Requirements: 13.1
 */
export function useEnabledModules(): {
  enabledModules: string[];
  isModuleActive: (moduleId: string) => boolean;
  visibleSections: UISectionDescriptor[];
} {
  const { restaurant } = useRestaurant();
  const enabledModules = restaurant?.enabledModules ?? ["core_platform"];

  const isModuleActive = useCallback(
    (moduleId: string) =>
      moduleId === "core_platform" || enabledModules.includes(moduleId),
    [enabledModules]
  );

  const visibleSections = useMemo(
    () => getVisibleSections(enabledModules),
    [enabledModules]
  );

  return { enabledModules, isModuleActive, visibleSections };
}
