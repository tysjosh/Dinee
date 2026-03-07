/**
 * Pack Registration Entry Point
 *
 * Single entry point for initializing all vertical packs.
 * Call registerAllPacks() during application startup to register
 * every vertical pack with the platform registries.
 *
 * Requirements: 3E.12
 */

import { registerRestaurantPack } from "./restaurantPack";
import { registerLogisticsPack } from "./logisticsPack";
import { registerGeneralServicesPack } from "./generalServicesPack";

/**
 * Registers all vertical packs with the platform registries.
 * Add new pack registrations here as verticals are implemented.
 */
export function registerAllPacks(): void {
  registerRestaurantPack();
  registerLogisticsPack();
  registerGeneralServicesPack();
}
