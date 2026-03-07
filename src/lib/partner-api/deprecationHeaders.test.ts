import { describe, it, expect } from "vitest";
import { addDeprecationHeader, enrichResponseWithDualIds } from "./deprecationHeaders";

describe("addDeprecationHeader", () => {
  it("sets Deprecation header when deprecated field was used", () => {
    const headers = new Headers();
    addDeprecationHeader(headers, true);
    expect(headers.get("Deprecation")).toBe(
      "restaurantId; sunset=2026-06-01; use=businessId"
    );
  });

  it("does not set Deprecation header when deprecated field was not used", () => {
    const headers = new Headers();
    addDeprecationHeader(headers, false);
    expect(headers.has("Deprecation")).toBe(false);
  });

  it("overwrites existing Deprecation header if called again", () => {
    const headers = new Headers();
    headers.set("Deprecation", "old-value");
    addDeprecationHeader(headers, true);
    expect(headers.get("Deprecation")).toBe(
      "restaurantId; sunset=2026-06-01; use=businessId"
    );
  });
});

describe("enrichResponseWithDualIds", () => {
  it("adds both restaurantId and businessId to the response body", () => {
    const body = { vertical: "restaurant", name: "Test Biz" };
    const result = enrichResponseWithDualIds(body, "biz-123");
    expect(result).toEqual({
      vertical: "restaurant",
      name: "Test Biz",
      restaurantId: "biz-123",
      businessId: "biz-123",
    });
  });

  it("overwrites existing restaurantId with the canonical businessId", () => {
    const body = { restaurantId: "old-id", vertical: "restaurant" };
    const result = enrichResponseWithDualIds(body, "biz-456");
    expect(result.restaurantId).toBe("biz-456");
    expect(result.businessId).toBe("biz-456");
  });

  it("preserves all other fields in the response body", () => {
    const body = { vertical: "logistics", status: "active", count: 42 };
    const result = enrichResponseWithDualIds(body, "biz-789");
    expect(result.vertical).toBe("logistics");
    expect(result.status).toBe("active");
    expect(result.count).toBe(42);
    expect(result.restaurantId).toBe("biz-789");
    expect(result.businessId).toBe("biz-789");
  });

  it("works with an empty body", () => {
    const result = enrichResponseWithDualIds({}, "biz-000");
    expect(result).toEqual({
      restaurantId: "biz-000",
      businessId: "biz-000",
    });
  });
});
