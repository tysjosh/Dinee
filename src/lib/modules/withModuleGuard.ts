/**
 * Module Guard — higher-order function that wraps a Next.js route handler
 * and enforces module entitlement before the handler executes.
 *
 * Pattern mirrors `withApiAuth()` in `src/lib/partner-api/middleware.ts`
 * but checks module activation instead of API key scopes.
 *
 * Does NOT modify `src/middleware.ts` — enforcement happens at the route
 * handler level to avoid edge-runtime constraints (no Convex from edge).
 *
 * @requirements REQ-3.1, REQ-3.2, REQ-3.3
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { resolveModule } from "./moduleResolver";

/**
 * Wraps a Next.js route handler with module entitlement enforcement.
 *
 * Resolution flow:
 *  1. Extract `businessId` from `x-business-id` header, `businessId` query
 *     param, or `restaurantId` query param (in that priority order).
 *  2. If no businessId is found, pass through (public/unscoped route).
 *  3. Query the business record from Convex.
 *  4. If business not found, pass through (let the handler return its own 404).
 *  5. Run `resolveModule` against the business's `enabledModules`.
 *  6. If not allowed → 403 `{ error: "MODULE_NOT_ENABLED", module }`.
 *  7. Otherwise invoke the wrapped handler.
 *
 * @param moduleId - The module identifier to check, e.g. "logistics_pack".
 * @returns A function that accepts a route handler and returns a guarded handler.
 */
export function withModuleGuard(moduleId: string) {
  return function guard(
    handler: (req: NextRequest) => Promise<NextResponse>
  ): (req: NextRequest) => Promise<NextResponse> {
    return async (req: NextRequest): Promise<NextResponse> => {
      // 1. Extract businessId — header takes priority, then query params
      const businessId =
        req.headers.get("x-business-id") ||
        req.nextUrl.searchParams.get("businessId") ||
        req.nextUrl.searchParams.get("restaurantId") ||
        null;

      // 2. No business context → public/unscoped route, pass through
      if (!businessId) {
        return handler(req);
      }

      // 3. Query business record from Convex
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      const business = await convex.query(api.restaurants.getRestaurant, {
        restaurantId: businessId,
      });

      // 4. Business not found → let the handler deal with it
      if (!business) {
        return handler(req);
      }

      // 5. Check module entitlement
      const enabledModules = business.enabledModules ?? [];
      const result = resolveModule(enabledModules, moduleId, {});

      // 6. Not allowed → 403
      if (result.resolution !== "allowed") {
        return NextResponse.json(
          { error: "MODULE_NOT_ENABLED", module: moduleId },
          { status: 403 }
        );
      }

      // 7. Allowed → invoke the wrapped handler
      return handler(req);
    };
  };
}
