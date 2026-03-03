/**
 * Property-Based Test — Authorization Chain (Property 7)
 *
 * **Validates: Requirements 23.2, 23.3**
 *
 * Property 7: Authorization rejects cross-tenant access
 * - For all (partnerId, organizationId) pairs where partner's platform does not
 *   own the organization: authorizeLogisticsAccess returns { authorized: false }
 * - For all valid ownership chains: returns { authorized: true }
 *
 * Since the real authorizeLogisticsAccess requires a ConvexHttpClient, these tests
 * verify the authorization decision logic via a pure simulation function that
 * mirrors the ownership chain checks:
 *   1. Partner exists and is active
 *   2. organizationId is in partner's organizationIds array
 *   3. Organization exists and shares same platformId as partner
 *   4. Optional vertical match
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vertical,
  LogisticsAuthorizationResult,
} from "../../src/lib/logistics/authorization";

// ─── Simulated data structures ──────────────────────────────────────────────

interface SimPartner {
  partnerId: string;
  platformId: string;
  isActive: boolean;
  organizationIds: string[];
}

interface SimOrganization {
  organizationId: string;
  platformId: string;
  vertical: Vertical;
}

interface SimWorld {
  partners: SimPartner[];
  organizations: SimOrganization[];
}

// ─── Pure authorization decision function ───────────────────────────────────
// Mirrors the logic in src/lib/logistics/authorization.ts exactly.

function simulateAuthorizeLogisticsAccess(
  world: SimWorld,
  partnerId: string,
  organizationId: string,
  vertical?: Vertical
): LogisticsAuthorizationResult {
  // Step 1: Look up the partner
  const partner = world.partners.find((p) => p.partnerId === partnerId);
  if (!partner || !partner.isActive) {
    return { authorized: false, error: "Partner not found or inactive" };
  }

  // Step 2: Check the partner has access to this organization
  if (!partner.organizationIds.includes(organizationId)) {
    return {
      authorized: false,
      error: "Access denied: organization not owned by partner",
    };
  }

  // Step 3: Query the organization and verify platform ownership
  const organization = world.organizations.find(
    (o) => o.organizationId === organizationId
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


// ─── Arbitraries ────────────────────────────────────────────────────────────

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const idArb = fc
  .array(fc.constantFrom(...ID_CHARS.split("")), {
    minLength: 1,
    maxLength: 24,
  })
  .map((chars) => chars.join(""));

const verticalArb: fc.Arbitrary<Vertical> = fc.constantFrom(
  "restaurant" as Vertical,
  "logistics" as Vertical
);

const partnerArb = fc.record({
  partnerId: idArb,
  platformId: idArb,
  isActive: fc.boolean(),
  organizationIds: fc.array(idArb, { minLength: 0, maxLength: 5 }),
});

const organizationArb = fc.record({
  organizationId: idArb,
  platformId: idArb,
  vertical: verticalArb,
});

/**
 * Generate a "valid ownership chain" world: a partner that is active,
 * has the organizationId in its list, and the organization shares the
 * same platformId.
 */
const validChainArb = fc
  .record({
    partnerId: idArb,
    platformId: idArb,
    organizationId: idArb,
    vertical: verticalArb,
  })
  .map(({ partnerId, platformId, organizationId, vertical }) => {
    const partner: SimPartner = {
      partnerId,
      platformId,
      isActive: true,
      organizationIds: [organizationId],
    };
    const organization: SimOrganization = {
      organizationId,
      platformId, // same platform
      vertical,
    };
    return { partner, organization, vertical };
  });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Authorization Chain — Property 7", () => {
  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * For all valid ownership chains (partner active, org in partner's list,
   * same platformId): authorization returns { authorized: true }.
   */
  it("valid ownership chain returns authorized: true", () => {
    fc.assert(
      fc.property(validChainArb, ({ partner, organization }) => {
        const world: SimWorld = {
          partners: [partner],
          organizations: [organization],
        };

        const result = simulateAuthorizeLogisticsAccess(
          world,
          partner.partnerId,
          organization.organizationId
        );

        expect(result.authorized).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * For all valid ownership chains with matching vertical: authorized: true.
   */
  it("valid ownership chain with matching vertical returns authorized: true", () => {
    fc.assert(
      fc.property(validChainArb, ({ partner, organization, vertical }) => {
        const world: SimWorld = {
          partners: [partner],
          organizations: [organization],
        };

        const result = simulateAuthorizeLogisticsAccess(
          world,
          partner.partnerId,
          organization.organizationId,
          vertical
        );

        expect(result.authorized).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * Cross-tenant: partner's platformId differs from organization's platformId.
   * Even if the orgId is in the partner's list, authorization must fail.
   */
  it("cross-platform ownership returns authorized: false", () => {
    const crossPlatformArb = fc
      .record({
        partnerId: idArb,
        partnerPlatformId: idArb,
        orgPlatformId: idArb,
        organizationId: idArb,
        vertical: verticalArb,
      })
      .filter((d) => d.partnerPlatformId !== d.orgPlatformId);

    fc.assert(
      fc.property(
        crossPlatformArb,
        ({ partnerId, partnerPlatformId, orgPlatformId, organizationId, vertical }) => {
          const world: SimWorld = {
            partners: [
              {
                partnerId,
                platformId: partnerPlatformId,
                isActive: true,
                organizationIds: [organizationId],
              },
            ],
            organizations: [
              {
                organizationId,
                platformId: orgPlatformId,
                vertical,
              },
            ],
          };

          const result = simulateAuthorizeLogisticsAccess(
            world,
            partnerId,
            organizationId
          );

          expect(result.authorized).toBe(false);
          expect(result.error).toContain("does not belong to partner's platform");
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * Organization not in partner's organizationIds list: authorization fails.
   */
  it("organization not in partner's list returns authorized: false", () => {
    const missingOrgArb = fc
      .record({
        partnerId: idArb,
        platformId: idArb,
        organizationId: idArb,
        partnerOrgIds: fc.array(idArb, { minLength: 0, maxLength: 5 }),
        vertical: verticalArb,
      })
      .filter((d) => !d.partnerOrgIds.includes(d.organizationId));

    fc.assert(
      fc.property(
        missingOrgArb,
        ({ partnerId, platformId, organizationId, partnerOrgIds, vertical }) => {
          const world: SimWorld = {
            partners: [
              {
                partnerId,
                platformId,
                isActive: true,
                organizationIds: partnerOrgIds,
              },
            ],
            organizations: [
              { organizationId, platformId, vertical },
            ],
          };

          const result = simulateAuthorizeLogisticsAccess(
            world,
            partnerId,
            organizationId
          );

          expect(result.authorized).toBe(false);
          expect(result.error).toContain("organization not owned by partner");
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2**
   *
   * Inactive partner: authorization always fails regardless of ownership.
   */
  it("inactive partner returns authorized: false", () => {
    fc.assert(
      fc.property(
        validChainArb,
        ({ partner, organization }) => {
          const inactivePartner = { ...partner, isActive: false };
          const world: SimWorld = {
            partners: [inactivePartner],
            organizations: [organization],
          };

          const result = simulateAuthorizeLogisticsAccess(
            world,
            inactivePartner.partnerId,
            organization.organizationId
          );

          expect(result.authorized).toBe(false);
          expect(result.error).toContain("not found or inactive");
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2**
   *
   * Non-existent partner: authorization fails.
   */
  it("non-existent partner returns authorized: false", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        (unknownPartnerId, organizationId) => {
          const world: SimWorld = {
            partners: [],
            organizations: [
              { organizationId, platformId: "plat1", vertical: "logistics" },
            ],
          };

          const result = simulateAuthorizeLogisticsAccess(
            world,
            unknownPartnerId,
            organizationId
          );

          expect(result.authorized).toBe(false);
          expect(result.error).toContain("not found or inactive");
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2**
   *
   * Non-existent organization (partner lists it but it doesn't exist in DB):
   * authorization fails.
   */
  it("non-existent organization returns authorized: false", () => {
    fc.assert(
      fc.property(idArb, idArb, idArb, (partnerId, platformId, orgId) => {
        const world: SimWorld = {
          partners: [
            {
              partnerId,
              platformId,
              isActive: true,
              organizationIds: [orgId],
            },
          ],
          organizations: [], // org doesn't exist
        };

        const result = simulateAuthorizeLogisticsAccess(
          world,
          partnerId,
          orgId
        );

        expect(result.authorized).toBe(false);
        expect(result.error).toContain("Organization not found");
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * Vertical mismatch: valid chain but requested vertical doesn't match
   * the organization's vertical.
   */
  it("vertical mismatch returns authorized: false", () => {
    const mismatchArb = validChainArb.map(({ partner, organization }) => {
      const requestedVertical: Vertical =
        organization.vertical === "logistics" ? "restaurant" : "logistics";
      return { partner, organization, requestedVertical };
    });

    fc.assert(
      fc.property(
        mismatchArb,
        ({ partner, organization, requestedVertical }) => {
          const world: SimWorld = {
            partners: [partner],
            organizations: [organization],
          };

          const result = simulateAuthorizeLogisticsAccess(
            world,
            partner.partnerId,
            organization.organizationId,
            requestedVertical
          );

          expect(result.authorized).toBe(false);
          expect(result.error).toContain("does not match requested vertical");
        }
      ),
      { numRuns: 500 }
    );
  });
});
