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
  | "logistics_failure_notice"
  | "runsheet_fuel_order_intake"
  | "runsheet_order_status"
  | "runsheet_driver_exception"
  | "runsheet_dispatch_callback";

/**
 * A stored generic route mapping an inbound number to a platform, tenant, and
 * conversation type. Superseding shape for the Runsheet-specific assignment.
 */
export interface PhoneRoute {
  platformId: string;
  tenantId: string;
  conversationType: ConversationType;
}

export interface PhoneLookupResult {
  /**
   * The resolved vertical. For a generic `phoneRoutes` hit this carries the
   * resolved `platformId`; branch/location fallbacks keep their existing
   * vertical semantics.
   */
  vertical: "restaurant" | "logistics" | "runsheet" | string;
  conversationType: ConversationType;
  organizationId?: string;
  restaurantId?: string;
  branchId?: string;
  locationId?: string;
  platformId?: string | null;
  /**
   * The Dinee tenant that owns the number (generic `phoneRoutes` and legacy
   * Runsheet routes).
   */
  tenantId?: string;
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
    // Generic phone→route store takes precedence (Req 4.2): a stored route maps
    // the inbound number to a (platformId, tenantId, conversationType) triple.
    // On a miss this returns null and we fall through to the existing Runsheet
    // and branch/location resolution paths (Req 4.4).
    const route = await convexClient.query(
      api.integrations.phoneRoutes.resolveRoute,
      { phoneNumber: toNumber },
    );
    if (route) {
      logger.info("Phone resolved to generic phone route", {
        toNumber,
        platformId: route.platformId,
        tenantId: route.tenantId,
        conversationType: route.conversationType,
      });
      return {
        // Carry the resolved platform as the vertical so downstream adapter
        // resolution keys off the platformId rather than a hardcoded vertical.
        vertical: route.platformId,
        conversationType: route.conversationType as ConversationType,
        platformId: route.platformId,
        tenantId: route.tenantId,
      };
    }

    // Runsheet number resolution (Req 9.5): a Dinee-managed number assigned to a
    // Runsheet conversation type routes to the Runsheet pack, carrying the
    // owning Dinee tenant id. Retained during the staged rollout for numbers not
    // yet migrated to the generic store. When no assignment exists this returns
    // null and we fall through to the existing branch/location logic.
    const assignment = await convexClient.query(
      api.runsheet.numberAssignments.resolveNumber,
      { phoneNumber: toNumber },
    );
    if (assignment) {
      logger.info("Phone resolved to runsheet number assignment", {
        toNumber,
        tenantId: assignment.tenantId,
        conversationType: assignment.conversationType,
      });
      return {
        vertical: "runsheet",
        conversationType: assignment.conversationType as ConversationType,
        tenantId: assignment.tenantId,
      };
    }

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
