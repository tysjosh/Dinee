import { describe, it, expect } from "vitest";
import { normalizeBusinessId } from "./dualIdSupport";

describe("normalizeBusinessId", () => {
  it("returns businessId when businessId is provided", () => {
    const result = normalizeBusinessId({ businessId: "biz-123" });
    expect(result).toEqual({ businessId: "biz-123", usedDeprecatedField: false });
  });

  it("returns businessId from restaurantId when only restaurantId is provided", () => {
    const result = normalizeBusinessId({ restaurantId: "rest-456" });
    expect(result).toEqual({ businessId: "rest-456", usedDeprecatedField: true });
  });

  it("prefers businessId over restaurantId when both are provided", () => {
    const result = normalizeBusinessId({ businessId: "biz-1", restaurantId: "rest-2" });
    expect(result).toEqual({ businessId: "biz-1", usedDeprecatedField: false });
  });

  it("throws when neither field is provided", () => {
    expect(() => normalizeBusinessId({})).toThrow(
      "Either businessId or restaurantId is required"
    );
  });

  it("throws when params contain unrelated fields only", () => {
    expect(() => normalizeBusinessId({ name: "test", id: "123" })).toThrow(
      "Either businessId or restaurantId is required"
    );
  });
});
