/**
 * Feature: ai-reception-os-pivot, Property 2: Vertical Isolation
 *
 * Validates: Requirements 3E.13, 4.2, 4.5, 5D.12, 5D.14, 13.1, 13.5, 13.6
 *
 * For any Business with enabledModules list M, getVisibleSections(M) SHALL
 * return only sections whose requiredModule is "core_platform" or is present
 * in M. No section with a requiredModule NOT in M (and not "core_platform")
 * shall appear. All core_platform sections are always present.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  registerUISections,
  getVisibleSections,
  clearRegistry,
} from "../../src/lib/modules/uiSectionRegistry";
import type { UISectionDescriptor } from "../../src/lib/modules/types";

/** All vertical pack module IDs used in the platform */
const VERTICAL_PACKS = [
  "restaurant_pack",
  "logistics_pack",
  "general_services_pack",
];

/** All module IDs including core_platform */
const ALL_MODULES = ["core_platform", ...VERTICAL_PACKS];

/** Fixed set of UI sections registered across all packs for testing */
const ALL_SECTIONS: UISectionDescriptor[] = [
  // Core platform sections — always visible
  { id: "calls", label: "Calls", icon: "phone", tabId: "calls", component: "CallsView", requiredModule: "core_platform" },
  { id: "transcripts", label: "Transcripts", icon: "file-text", tabId: "transcripts", component: "TranscriptsView", requiredModule: "core_platform" },
  { id: "contacts", label: "Contacts", icon: "users", tabId: "contacts", component: "ContactsView", requiredModule: "core_platform" },
  { id: "settings", label: "Settings", icon: "settings", tabId: "settings", component: "SettingsView", requiredModule: "core_platform" },

  // Restaurant pack sections
  { id: "orders", label: "Orders", icon: "shopping-bag", tabId: "orders", component: "OrdersView", requiredModule: "restaurant_pack" },
  { id: "menu-mgmt", label: "Menu Management", icon: "utensils", tabId: "menu", component: "MenuView", requiredModule: "restaurant_pack" },
  { id: "upsell", label: "Upsell Prompts", icon: "trending-up", tabId: "upsell", component: "UpsellView", requiredModule: "restaurant_pack" },
  { id: "restaurant-analytics", label: "Restaurant Analytics", icon: "bar-chart", tabId: "restaurant-analytics", component: "RestaurantAnalyticsView", requiredModule: "restaurant_pack" },

  // Logistics pack sections
  { id: "shipments", label: "Shipments", icon: "package", tabId: "shipments", component: "ShipmentsView", requiredModule: "logistics_pack" },
  { id: "riders", label: "Riders", icon: "truck", tabId: "riders", component: "RidersView", requiredModule: "logistics_pack" },
  { id: "dispatch", label: "Dispatch", icon: "map", tabId: "dispatch", component: "DispatchView", requiredModule: "logistics_pack" },
  { id: "logistics-analytics", label: "Logistics Analytics", icon: "bar-chart", tabId: "logistics-analytics", component: "LogisticsAnalyticsView", requiredModule: "logistics_pack" },

  // General services pack sections
  { id: "appointments", label: "Appointments", icon: "calendar", tabId: "appointments", component: "AppointmentsView", requiredModule: "general_services_pack" },
  { id: "service-catalog", label: "Service Catalog", icon: "list", tabId: "service-catalog", component: "ServiceCatalogView", requiredModule: "general_services_pack" },
];

const coreSections = ALL_SECTIONS.filter(
  (s) => s.requiredModule === "core_platform"
);

/** Arbitrary: a random subset of vertical packs (not including core_platform) */
const enabledModulesArb = fc
  .subarray(VERTICAL_PACKS, { minLength: 0 })
  .map((packs) => ["core_platform", ...packs]);

describe("Property 2: Vertical Isolation", () => {
  beforeEach(() => {
    clearRegistry();
    registerUISections(ALL_SECTIONS);
  });

  it("getVisibleSections returns only core_platform sections and sections matching enabledModules", () => {
    fc.assert(
      fc.property(enabledModulesArb, (enabledModules) => {
        const visible = getVisibleSections(enabledModules);

        // Every returned section must have requiredModule === "core_platform"
        // OR requiredModule in enabledModules
        for (const section of visible) {
          expect(
            section.requiredModule === "core_platform" ||
              enabledModules.includes(section.requiredModule)
          ).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("all core_platform sections are always present regardless of enabledModules", () => {
    fc.assert(
      fc.property(enabledModulesArb, (enabledModules) => {
        const visible = getVisibleSections(enabledModules);
        const visibleIds = visible.map((s) => s.id);

        for (const coreSection of coreSections) {
          expect(visibleIds).toContain(coreSection.id);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("no section with requiredModule NOT in enabledModules (and not core_platform) appears", () => {
    fc.assert(
      fc.property(enabledModulesArb, (enabledModules) => {
        const visible = getVisibleSections(enabledModules);
        const visibleIds = new Set(visible.map((s) => s.id));

        // For every registered section whose requiredModule is NOT in
        // enabledModules and is not core_platform, it must be absent
        for (const section of ALL_SECTIONS) {
          if (
            section.requiredModule !== "core_platform" &&
            !enabledModules.includes(section.requiredModule)
          ) {
            expect(visibleIds.has(section.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
