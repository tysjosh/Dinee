/**
 * Logistics Authorization — Cross-Tenant Resource Access
 *
 * Shared enforcement point for tenant authorization on logistics endpoints.
 * Every authenticated logistics route handler calls this after middleware auth
 * to verify the partner → platform → organization ownership chain.
 *
 * ## Cross-Validation Behavior (Req 2.7)
 *
 * This module implements the cross-validation strategy described in the
 * platform-hardening design: the `organizationId` parameter passed to
 * `authorizeLogisticsAccess` is validated against the authenticated partner's
 * ownership chain (partner → platform → organization). Route handlers MUST
 * pass the `X-Tenant-Id` header value as the `organizationId` parameter so
 * that the header is never accepted at face value — it is always verified
 * against the partner's authorized scope.
 *
 * ### Ownership Chain Steps
 * 1. Partner must exist and be active
 * 2. `organizationId` must appear in `partner.organizationIds`
 * 3. Organization's `platformId` must match `partner.platformId`
 * 4. (Optional) Organization's `vertical` must match the expected vertical
 *
 * If any step fails, a 403 Forbidden response is returned.
 *
 * Designed with a `vertical` parameter for future vertical parity with
 * the restaurant `authorizeResourceAccess` utility.
 *
 * @module logistics/authorization
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
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
 * Cross-validate the authenticated partner's ownership of the target organization.
 *
 * Implements the partner → platform → organization ownership chain check
 * required by Req 2.2 and Req 2.7. This is the single enforcement point
 * called by every logistics route handler before executing business logic
 * (Req 2.6).
 *
 * ### Validation Steps
 * 1. Query partner by `partnerId` — must exist and be active
 * 2. Verify `organizationId` appears in `partner.organizationIds` (Req 2.3, 2.4)
 * 3. Query organization — must exist and `platformId` must match `partner.platformId`
 * 4. (Optional) Validate the organization's `vertical` matches the expected vertical
 *
 * ### Cross-Validation (Req 2.7)
 * Route handlers MUST pass the raw `X-Tenant-Id` header value as the
 * `organizationId` parameter. This ensures the header is cross-validated
 * against the partner's authorized scope rather than trusted at face value.
 * For resource-specific endpoints (e.g., GET shipment by ID, assign rider),
 * the `organizationId` is derived from the looked-up resource's
 * `organizationId` field, which is equally valid since the resource already
 * belongs to a specific organization.
 *
 * @param convexClient - Convex HTTP client for querying
 * @param partnerId - The authenticated partner's ID (from auth middleware)
 * @param organizationId - The organization to authorize — from `X-Tenant-Id` header
 *   or from the resource's `organizationId` field (Req 2.1, 2.5, 2.7)
 * @param vertical - Optional vertical to validate (e.g., "logistics")
 * @returns `{ authorized: true }` or `{ authorized: false, error }` with a
 *   message suitable for a 403 Forbidden response (Req 2.3, 2.4)
 */
export async function authorizeLogisticsAccess(
  convexClient: ConvexHttpClient,
  partnerId: string,
  organizationId: string,
  vertical?: Vertical
): Promise<LogisticsAuthorizationResult> {
  // Step 1: Look up the partner — must exist and be active
  const partner = await convexClient.query(
    api.partners.getPartnerByPartnerId,
    { partnerId }
  );

  if (!partner || !partner.isActive) {
    return { authorized: false, error: "Partner not found or inactive" };
  }

  // Step 2: Verify organizationId is in the partner's authorized set (Req 2.3, 2.4)
  // This is the core cross-validation: the organizationId (from X-Tenant-Id or
  // resource lookup) must be explicitly listed in the partner's organizationIds.
  const partnerOrgIds = partner.organizationIds ?? [];
  if (!partnerOrgIds.includes(organizationId)) {
    return {
      authorized: false,
      error: "Access denied: organization not owned by partner",
    };
  }

  // Step 3: Verify platform ownership chain (Req 2.7)
  // Even if the partner claims the org, the org's platformId must match
  // the partner's platformId — preventing cross-platform access.
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
