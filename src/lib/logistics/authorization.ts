/**
 * Logistics Authorization — Cross-Tenant Resource Access
 *
 * Shared enforcement point for tenant authorization on logistics endpoints.
 * Every authenticated logistics route handler calls this after middleware auth
 * to verify the partner → platform → organization ownership chain.
 *
 * Designed with a `vertical` parameter for future vertical parity with
 * the restaurant `authorizeResourceAccess` utility.
 *
 * @module logistics/authorization
 * @requirements 23.1, 23.2, 23.3, 23.5, 23.6
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

export type Vertical = "restaurant" | "logistics";

export interface LogisticsAuthorizationResult {
  authorized: boolean;
  error?: string;
}

// ============================================================================
// Main Authorization Function
// ============================================================================

/**
 * Verify that the authenticated partner owns the target organization
 * through the partner → platform → organization ownership chain.
 *
 * 1. Query partner by partnerId — must exist and be active
 * 2. Check organizationId is in the partner's organizationIds array
 * 3. Query organization — must exist and share the same platformId
 * 4. Optionally validate the organization's vertical matches the expected vertical
 *
 * @param convexClient - Convex HTTP client for querying
 * @param partnerId - The authenticated partner's ID
 * @param organizationId - The target organization to authorize access to
 * @param vertical - Optional vertical to validate against the organization's vertical
 * @returns `{ authorized: true }` or `{ authorized: false, error }`
 */
export async function authorizeLogisticsAccess(
  convexClient: ConvexHttpClient,
  partnerId: string,
  organizationId: string,
  vertical?: Vertical
): Promise<LogisticsAuthorizationResult> {
  // Step 1: Look up the partner
  const partner = await convexClient.query(
    api.partners.getPartnerByPartnerId,
    { partnerId }
  );

  if (!partner || !partner.isActive) {
    return { authorized: false, error: "Partner not found or inactive" };
  }

  // Step 2: Check the partner has access to this organization
  const partnerOrgIds = partner.organizationIds ?? [];
  if (!partnerOrgIds.includes(organizationId)) {
    return {
      authorized: false,
      error: "Access denied: organization not owned by partner",
    };
  }

  // Step 3: Query the organization and verify platform ownership
  const organization = await convexClient.query(
    api.logistics.organizations.getOrganization,
    { organizationId }
  );

  if (!organization) {
    return { authorized: false, error: "Organization not found" };
  }

  if (organization.platformId !== partner.platformId) {
    return {
      authorized: false,
      error: "Access denied: organization does not belong to partner's platform",
    };
  }

  // Step 4: Optionally validate the vertical
  if (vertical && organization.vertical !== vertical) {
    return {
      authorized: false,
      error: `Access denied: organization vertical "${organization.vertical}" does not match requested vertical "${vertical}"`,
    };
  }

  return { authorized: true };
}
