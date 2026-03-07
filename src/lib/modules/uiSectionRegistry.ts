/**
 * UI Section Registry
 *
 * Stores dashboard UI section descriptors registered by vertical packs.
 * The dashboard uses this registry to determine which navigation items
 * and content sections to render based on the Business's enabledModules.
 *
 * Core sections (requiredModule = "core_platform") are always visible
 * regardless of which modules are enabled.
 *
 * Requirements: 13.1, 13.5
 */

import type { UISectionDescriptor } from "./types";

const sections: UISectionDescriptor[] = [];

/**
 * Registers one or more UI section descriptors.
 * Typically called by each vertical pack during initialization.
 */
export function registerUISections(descriptors: UISectionDescriptor[]): void {
  sections.push(...descriptors);
}

/**
 * Returns UI sections visible for the given enabledModules (Req 13.1).
 * Core sections (requiredModule = "core_platform") are always included (Req 13.5).
 */
export function getVisibleSections(enabledModules: string[]): UISectionDescriptor[] {
  return sections.filter(
    (s) => s.requiredModule === "core_platform" || enabledModules.includes(s.requiredModule)
  );
}

/**
 * Clears all registered UI sections. Intended for testing only.
 */
export function clearRegistry(): void {
  sections.length = 0;
}
