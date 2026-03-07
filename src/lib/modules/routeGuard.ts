/**
 * Route Guard — maps URL path prefixes to required modules and checks
 * whether a route is allowed for a given set of enabled modules.
 *
 * Pure utility with no React dependencies.
 *
 * Requirements: 13.6
 */

/**
 * Maps URL path prefixes to the module ID required to access them.
 * Order matters: more specific prefixes must come before less specific ones.
 */
export const ROUTE_MODULE_MAP: ReadonlyArray<{ prefix: string; moduleId: string }> = [
  // Restaurant pack routes
  { prefix: "/dashboard/orders", moduleId: "restaurant_pack" },
  { prefix: "/dashboard/menu", moduleId: "restaurant_pack" },

  // Logistics pack routes
  { prefix: "/dashboard/shipments", moduleId: "logistics_pack" },
  { prefix: "/dashboard/riders", moduleId: "logistics_pack" },
  { prefix: "/dashboard/dispatch", moduleId: "logistics_pack" },

  // Runsheet Connect (must come before generic /dashboard/integrations)
  { prefix: "/dashboard/integrations/runsheet", moduleId: "runsheet_connect" },
];

/**
 * Returns the module ID required to access the given pathname,
 * or `null` if the route is a core route (always allowed).
 */
export function getRequiredModule(pathname: string): string | null {
  for (const entry of ROUTE_MODULE_MAP) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + "/") || pathname.startsWith(entry.prefix + "?")) {
      return entry.moduleId;
    }
  }
  return null;
}

/**
 * Returns `true` if the pathname is allowed for the given set of enabled modules.
 * Core routes (no required module) are always allowed.
 */
export function isRouteAllowed(pathname: string, enabledModules: string[]): boolean {
  const requiredModule = getRequiredModule(pathname);
  if (requiredModule === null) {
    return true;
  }
  return enabledModules.includes(requiredModule);
}
