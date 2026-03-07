/**
 * Unit tests for the route guard utility.
 *
 * Validates: Requirements 13.6
 */
import { describe, it, expect } from "vitest";
import { getRequiredModule, isRouteAllowed } from "./routeGuard";

describe("getRequiredModule", () => {
  it("returns restaurant_pack for /dashboard/orders", () => {
    expect(getRequiredModule("/dashboard/orders")).toBe("restaurant_pack");
  });

  it("returns restaurant_pack for /dashboard/orders/123", () => {
    expect(getRequiredModule("/dashboard/orders/123")).toBe("restaurant_pack");
  });

  it("returns restaurant_pack for /dashboard/menu", () => {
    expect(getRequiredModule("/dashboard/menu")).toBe("restaurant_pack");
  });

  it("returns logistics_pack for /dashboard/shipments", () => {
    expect(getRequiredModule("/dashboard/shipments")).toBe("logistics_pack");
  });

  it("returns logistics_pack for /dashboard/riders", () => {
    expect(getRequiredModule("/dashboard/riders")).toBe("logistics_pack");
  });

  it("returns logistics_pack for /dashboard/dispatch", () => {
    expect(getRequiredModule("/dashboard/dispatch")).toBe("logistics_pack");
  });

  it("returns runsheet_connect for /dashboard/integrations/runsheet", () => {
    expect(getRequiredModule("/dashboard/integrations/runsheet")).toBe("runsheet_connect");
  });

  it("returns runsheet_connect for /dashboard/integrations/runsheet/config", () => {
    expect(getRequiredModule("/dashboard/integrations/runsheet/config")).toBe("runsheet_connect");
  });

  it("returns null for core dashboard routes", () => {
    expect(getRequiredModule("/dashboard")).toBeNull();
    expect(getRequiredModule("/dashboard/calls")).toBeNull();
    expect(getRequiredModule("/dashboard/transcripts")).toBeNull();
    expect(getRequiredModule("/dashboard/contacts")).toBeNull();
    expect(getRequiredModule("/dashboard/settings")).toBeNull();
  });

  it("returns null for non-dashboard routes", () => {
    expect(getRequiredModule("/")).toBeNull();
    expect(getRequiredModule("/login")).toBeNull();
  });
});

describe("isRouteAllowed", () => {
  it("allows core routes regardless of enabled modules", () => {
    expect(isRouteAllowed("/dashboard/calls", [])).toBe(true);
    expect(isRouteAllowed("/dashboard/settings", ["core_platform"])).toBe(true);
  });

  it("allows restaurant routes when restaurant_pack is enabled", () => {
    const modules = ["core_platform", "restaurant_pack"];
    expect(isRouteAllowed("/dashboard/orders", modules)).toBe(true);
    expect(isRouteAllowed("/dashboard/menu", modules)).toBe(true);
  });

  it("blocks restaurant routes when restaurant_pack is not enabled", () => {
    const modules = ["core_platform"];
    expect(isRouteAllowed("/dashboard/orders", modules)).toBe(false);
    expect(isRouteAllowed("/dashboard/menu", modules)).toBe(false);
  });

  it("allows logistics routes when logistics_pack is enabled", () => {
    const modules = ["core_platform", "logistics_pack"];
    expect(isRouteAllowed("/dashboard/shipments", modules)).toBe(true);
    expect(isRouteAllowed("/dashboard/riders", modules)).toBe(true);
    expect(isRouteAllowed("/dashboard/dispatch", modules)).toBe(true);
  });

  it("blocks logistics routes when logistics_pack is not enabled", () => {
    const modules = ["core_platform", "restaurant_pack"];
    expect(isRouteAllowed("/dashboard/shipments", modules)).toBe(false);
    expect(isRouteAllowed("/dashboard/dispatch", modules)).toBe(false);
  });

  it("allows runsheet routes when runsheet_connect is enabled", () => {
    const modules = ["core_platform", "logistics_pack", "runsheet_connect"];
    expect(isRouteAllowed("/dashboard/integrations/runsheet", modules)).toBe(true);
  });

  it("blocks runsheet routes when runsheet_connect is not enabled", () => {
    const modules = ["core_platform", "logistics_pack"];
    expect(isRouteAllowed("/dashboard/integrations/runsheet", modules)).toBe(false);
  });
});
