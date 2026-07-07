/**
 * Partner API - Resource Authorization
 *
 * Single enforcement point for tenant authorization. Every partner route
 * handler calls this after middleware auth to verify the authenticated
 * partner owns the requested resource.
 *
 * @module partner-api/authorization
 * @requirements 2.9 - Tenant authorization enforcement
 * @bug_condition C8 — NOT tenantOwnershipVerified(partnerId, resourceId)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { internalSecretArg } from "@/lib/internal-auth";

// ============================================================================
// Types
// ============================================================================

export type ResourceType = "restaurant" | "order" | "call" | "menu" | "branch";

export interface AuthorizationResult {
  authorized: boolean;
  error?: string;
  /** The resolved restaurantId for sub-resources (useful for downstream queries) */
  restaurantId?: string;
}

// ============================================================================
// Main Authorization Function
// ============================================================================

/**
 * Verify that the authenticated partner owns the requested resource.
 *
 * For `restaurant`: checks partner.restaurantIds includes resourceId.
 * For sub-resources (`order`, `call`, `menu`, `branch`): resolves the
 * parent restaurantId then checks ownership.
 *
 * @returns `{ authorized: true, restaurantId }` or `{ authorized: false, error }`
 */
export async function authorizeResourceAccess(
  convexClient: ConvexHttpClient,
  partnerId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<AuthorizationResult> {
  const partner = await convexClient.query(
    api.partners.getPartnerByPartnerId,
    { partnerId }
  );

  if (!partner || !partner.isActive) {
    return { authorized: false, error: "Partner not found or inactive" };
  }

  const partnerRestaurantIds = partner.restaurantIds ?? [];

  // Direct restaurant ownership check
  if (resourceType === "restaurant") {
    if (partnerRestaurantIds.includes(resourceId)) {
      return { authorized: true, restaurantId: resourceId };
    }
    return {
      authorized: false,
      error: "Access denied: restaurant not owned by partner",
    };
  }

  // For sub-resources, resolve the parent restaurantId then check ownership
  const parentRestaurantId = await resolveParentRestaurantId(
    convexClient,
    resourceType,
    resourceId
  );

  if (!parentRestaurantId) {
    return { authorized: false, error: "Resource not found" };
  }

  if (partnerRestaurantIds.includes(parentRestaurantId)) {
    return { authorized: true, restaurantId: parentRestaurantId };
  }

  return {
    authorized: false,
    error: "Access denied: resource not owned by partner",
  };
}

// ============================================================================
// Sub-resource Resolution
// ============================================================================

async function resolveParentRestaurantId(
  convexClient: ConvexHttpClient,
  resourceType: Exclude<ResourceType, "restaurant">,
  resourceId: string
): Promise<string | null> {
  switch (resourceType) {
    case "order": {
      const order = await convexClient.query(
        api.orders.getOrderByOrderIdOnly,
        { orderId: resourceId }
      );
      return order?.restaurantId ?? null;
    }

    case "call": {
      const call = await convexClient.query(api.calls.getCallByCallId, {
        callId: resourceId,
      });
      return call?.restaurantId ?? null;
    }

    case "menu": {
      const menuItem = await convexClient.query(
        api.menuItems.getMenuItemById,
        { id: resourceId as Id<"menuItems">, ...internalSecretArg() }
      );
      return menuItem?.restaurantId ?? null;
    }

    case "branch": {
      const branch = await convexClient.query(api.branches.getBranch, {
        branchId: resourceId,
        ...internalSecretArg(),
      });
      return branch?.restaurantId ?? null;
    }

    default:
      return null;
  }
}
