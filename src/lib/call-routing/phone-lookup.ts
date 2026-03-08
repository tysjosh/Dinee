/**
 * Phone-number-to-organization lookup for call routing.
 *
 * Resolves an inbound "To" phone number to a vertical and resource,
 * enabling conversation-type selection without query params.
 *
 * Uses the unified getEntityByPhoneNumber query which checks provisioned
 * dedicated numbers first, then falls back to legacy branch/location
 * phone number fields.
 *
 * Requirements: 11.1, 11.2, 11.3 — determine conversation type from called number
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
 * Uses the unified getEntityByPhoneNumber query which checks:
 * 1. Provisioned dedicated numbers (phoneNumbers table) — direct routing, no Business ID
 * 2. Legacy branch phone numbers — direct routing
 * 3. Legacy location phone numbers — logistics routing
 *
 * Falls back to restaurant vertical if no match (shared number flow with Business ID).
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
    // Unified lookup: provisioned numbers → branch phone → location phone
    const entity = await convexClient.query(api.phoneLookup.getEntityByPhoneNumber, {
      phoneNumber: toNumber,
    });

    if (entity) {
      if (entity.vertical === "restaurant" && entity.type === "branch") {
        const conversationType = resolveRestaurantConversationType(callbackReason);
        logger.info("Phone resolved to restaurant branch", {
          toNumber,
          branchId: entity.branchId,
          conversationType,
          dedicated: entity.phoneNumberId != null,
        });
        return {
          vertical: "restaurant",
          conversationType,
          restaurantId: entity.restaurantId,
          branchId: entity.branchId,
          platformId: entity.platformId,
        };
      }

      if (entity.type === "location") {
        const conversationType = resolveLogisticsConversationType(callbackReason);
        logger.info("Phone resolved to logistics location", {
          toNumber,
          locationId: entity.locationId,
          conversationType,
          dedicated: entity.phoneNumberId != null,
        });
        return {
          vertical: entity.vertical,
          conversationType,
          organizationId: entity.organizationId,
          locationId: entity.locationId,
          platformId: entity.platformId,
        };
      }
    }

    // Fallback: default to restaurant inbound order (shared number + Business ID flow)
    logger.warn("Phone number not found, defaulting to restaurant (shared number flow)", {
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
