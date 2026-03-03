/**
 * Unit tests for authorizeResourceAccess
 *
 * Tests the centralized tenant authorization utility that verifies
 * partner ownership of requested resources.
 *
 * @requirements 2.9 - Tenant authorization enforcement
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authorizeResourceAccess } from "./authorization";
import type { ResourceType } from "./authorization";

// ============================================================================
// Mock ConvexHttpClient
// ============================================================================

function createMockConvexClient(queryResponses: Record<string, unknown>) {
  // Track call index to return different responses for sequential calls
  let callIndex = 0;
  const responseOrder = Object.values(queryResponses);

  return {
    query: vi.fn(async () => {
      const response = responseOrder[callIndex] ?? null;
      callIndex++;
      return response;
    }),
  } as any; // eslint-disable-line
}

// ============================================================================
// Test Data
// ============================================================================

const ACTIVE_PARTNER = {
  partnerId: "partner-001",
  name: "Test Partner",
  email: "test@partner.com",
  isActive: true,
  platformId: "platform-001",
  restaurantIds: ["restaurant-A", "restaurant-B"],
  createdAt: Date.now(),
};

const INACTIVE_PARTNER = {
  ...ACTIVE_PARTNER,
  partnerId: "partner-inactive",
  isActive: false,
};

const PARTNER_NO_RESTAURANTS = {
  ...ACTIVE_PARTNER,
  partnerId: "partner-empty",
  restaurantIds: undefined,
};

// ============================================================================
// Tests
// ============================================================================

describe("authorizeResourceAccess", () => {
  describe("partner not found or inactive", () => {
    it("returns unauthorized when partner does not exist", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: null,
      });

      const result = await authorizeResourceAccess(
        client,
        "nonexistent",
        "restaurant",
        "restaurant-A"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not found or inactive");
    });

    it("returns unauthorized when partner is inactive", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: INACTIVE_PARTNER,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-inactive",
        "restaurant",
        "restaurant-A"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not found or inactive");
    });
  });

  describe("restaurant resource type", () => {
    it("authorizes when partner owns the restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "restaurant",
        "restaurant-A"
      );

      expect(result.authorized).toBe(true);
      expect(result.restaurantId).toBe("restaurant-A");
    });

    it("denies when partner does not own the restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "restaurant",
        "restaurant-X"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });

    it("denies when partner has no restaurantIds", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: PARTNER_NO_RESTAURANTS,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-empty",
        "restaurant",
        "restaurant-A"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });
  });

  describe("order sub-resource", () => {
    it("authorizes when order belongs to an owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getOrderByOrderIdOnly: { orderId: "ord_123", restaurantId: "restaurant-A" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "order",
        "ord_123"
      );

      expect(result.authorized).toBe(true);
      expect(result.restaurantId).toBe("restaurant-A");
    });

    it("denies when order belongs to a non-owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getOrderByOrderIdOnly: { orderId: "ord_456", restaurantId: "restaurant-X" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "order",
        "ord_456"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });

    it("returns not found when order does not exist", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getOrderByOrderIdOnly: null,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "order",
        "ord_nonexistent"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("Resource not found");
    });
  });

  describe("call sub-resource", () => {
    it("authorizes when call belongs to an owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getCallByCallId: { callId: "call-001", restaurantId: "restaurant-B" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "call",
        "call-001"
      );

      expect(result.authorized).toBe(true);
      expect(result.restaurantId).toBe("restaurant-B");
    });

    it("denies when call belongs to a non-owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getCallByCallId: { callId: "call-002", restaurantId: "restaurant-X" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "call",
        "call-002"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });
  });

  describe("branch sub-resource", () => {
    it("authorizes when branch belongs to an owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getBranch: { branchId: "BR001", restaurantId: "restaurant-A" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "branch",
        "BR001"
      );

      expect(result.authorized).toBe(true);
      expect(result.restaurantId).toBe("restaurant-A");
    });

    it("denies when branch belongs to a non-owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getBranch: { branchId: "BR002", restaurantId: "restaurant-X" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "branch",
        "BR002"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });

    it("returns not found when branch does not exist", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getBranch: null,
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "branch",
        "BR_nonexistent"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("Resource not found");
    });
  });

  describe("menu sub-resource", () => {
    it("authorizes when menu item belongs to an owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getMenuItemById: { restaurantId: "restaurant-A", name: "Jollof Rice" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "menu",
        "some-menu-item-id"
      );

      expect(result.authorized).toBe(true);
      expect(result.restaurantId).toBe("restaurant-A");
    });

    it("denies when menu item belongs to a non-owned restaurant", async () => {
      const client = createMockConvexClient({
        getPartnerByPartnerId: ACTIVE_PARTNER,
        getMenuItemById: { restaurantId: "restaurant-X", name: "Suya" },
      });

      const result = await authorizeResourceAccess(
        client,
        "partner-001",
        "menu",
        "some-menu-item-id"
      );

      expect(result.authorized).toBe(false);
      expect(result.error).toContain("not owned by partner");
    });
  });
});
