/**
 * Phone-number-to-organization lookup for call routing.
 *
 * Resolves an inbound "To" phone number to a vertical and resource,
 * enabling conversation-type selection without query params.
 *
 * Requirements: 11.3 — determine conversation type from called number
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { createLogger } from "../logger";

const logger = createLogger("phone-lookup");

export type ConversationType =
  | "restaurant_inbound_order"
  | "restaurant_followup"
  | "restaurant_cancellation"
  | "logistics_booking"
  | "logistics_followup"
  | "logistics_failure_notice";

export interface PhoneLookupResult {
  vertical: "restaurant" | "logistics";
  conversationType: ConversationType;
  organizationId?: string;
  restaurantId?: string;
  branchId?: string;
  locationId?: string;
  platformId?: string | null;
}

/**
 * Resolve a phone number to a vertical and default conversation type.
 *
 * Checks branches first (restaurant), then locations (logistics).
 * Falls back to restaurant vertical if no match is found.
 *
 * @param convexClient - Convex HTTP client
 * @param toNumber - The called phone number (Twilio "To" field)
 * @param callbackReason - Optional callback reason for determining conversation subtype
 */
export async function resolvePhoneToRoute(
  convexClient: ConvexHttpClient,
  toNumber: string,
  callbackReason?: string,
): Promise<PhoneLookupResult> {
  try {
    // 1. Check restaurant branches
    const branch = await convexClient.query(api.phoneLookup.getBranchByPhoneNumber, {
      phoneNumber: toNumber,
    });

    if (branch) {
      const conversationType = resolveRestaurantConversationType(callbackReason);
      logger.info("Phone resolved to restaurant branch", {
        toNumber,
        branchId: branch.branchId,
        conversationType,
      });
      return {
        vertical: "restaurant",
        conversationType,
        restaurantId: branch.restaurantId,
        branchId: branch.branchId,
        platformId: branch.platformId,
      };
    }

    // 2. Check logistics locations
    const location = await convexClient.query(api.phoneLookup.getLocationByPhoneNumber, {
      phoneNumber: toNumber,
    });

    if (location) {
      const conversationType = resolveLogisticsConversationType(callbackReason);
      logger.info("Phone resolved to logistics location", {
        toNumber,
        locationId: location.locationId,
        conversationType,
      });
      return {
        vertical: "logistics",
        conversationType,
        organizationId: location.organizationId,
        locationId: location.locationId,
        platformId: location.platformId,
      };
    }

    // 3. Fallback: default to restaurant inbound order
    logger.warn("Phone number not found in branches or locations, defaulting to restaurant", {
      toNumber,
    });
    return {
      vertical: "restaurant",
      conversationType: "restaurant_inbound_order",
    };
  } catch (error) {
    logger.error("Phone lookup failed, defaulting to restaurant", { toNumber });
    return {
      vertical: "restaurant",
      conversationType: "restaurant_inbound_order",
    };
  }
}

function resolveRestaurantConversationType(
  callbackReason?: string,
): ConversationType {
  switch (callbackReason) {
    case "followup":
      return "restaurant_followup";
    case "cancellation":
      return "restaurant_cancellation";
    default:
      return "restaurant_inbound_order";
  }
}

function resolveLogisticsConversationType(
  callbackReason?: string,
): ConversationType {
  switch (callbackReason) {
    case "followup":
      return "logistics_followup";
    case "failure_notice":
      return "logistics_failure_notice";
    default:
      return "logistics_booking";
  }
}
