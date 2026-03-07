# Dinee Monetization Sprint — Design

## Architecture Decisions

### 1. No Middleware Changes

The existing `src/middleware.ts` handles `/client` prefix redirects. We do NOT touch it.

Module entitlement enforcement is done via a `withModuleGuard()` route handler wrapper — same pattern as the existing `withApiAuth()` in `src/lib/partner-api/middleware.ts`. This avoids:
- Middleware runtime constraints (no Convex calls from edge runtime)
- Breaking existing redirect behavior
- Latency on every request

### 2. Extend Existing Webhook Pipeline (No New Emitter)

The codebase already has a complete webhook delivery system:
- `convex/webhookSubscriptions.ts` — subscription CRUD + event type filtering
- `convex/webhookDeliveries.ts` — delivery tracking, retry with exponential backoff, dead-letter

For call lifecycle events, we extend this pipeline:
- Add new event types to subscription `events` array: `call.started`, `call.completed`, `call.failed`, `order.created`, `order.updated`
- Create a `dispatchWebhookEvent` internal mutation in `convex/webhookDeliveries.ts` that queries matching subscriptions and creates delivery records
- Call `dispatchWebhookEvent` from `upsertCallData` and `upsertOrders` in `convex/internal.ts`

### 3. Provisioning Uses Existing Mutation Pattern

The provisioning endpoint (`POST /api/v1/partner/businesses`) uses the existing `api.restaurants.createRestaurantWithBranches` mutation — but with the `vertical` and `enabledModules` fields populated. This is the correct target because:
- The `restaurants` table IS the business table (just legacy-named)
- The mutation already handles atomic restaurant + branch creation
- We just need to pass through the new optional fields (`vertical`, `enabledModules`, `integrations`)

If the mutation doesn't accept these fields yet, we extend it (not fork a new one).

---

## Component Design

### Dual-ID Mapper (`src/lib/idMapper.ts`)

```typescript
export function businessIdToRestaurantId(businessId: string): string {
  return businessId;
}
export function restaurantIdToBusinessId(restaurantId: string): string {
  return restaurantId;
}
```

Trivial now, but provides:
- Single import for all ID translation
- Future-proof if ID formats diverge
- Grep-able migration marker

### useBusinessStorage Hook (`src/hooks/useBusinessStorage.ts`)

Thin wrapper over `useRestaurantStorage`:

```typescript
export function useBusinessStorage() {
  const storage = useRestaurantStorage();
  return {
    businessId: storage.restaurantId,
    businessData: storage.restaurantData,
    loading: storage.loading,
    saveBusinessData: storage.saveRestaurantData,
    deleteAllData: storage.deleteAllData,
    clearBusinessId: storage.clearRestaurantId,
  };
}
```

### withModuleGuard Route Wrapper (`src/lib/modules/withModuleGuard.ts`)

```typescript
export function withModuleGuard(moduleId: string) {
  return function guard(
    handler: (req: NextRequest) => Promise<NextResponse>
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      const businessId = req.headers.get("x-business-id")
        || req.nextUrl.searchParams.get("businessId")
        || req.nextUrl.searchParams.get("restaurantId");

      if (!businessId) return handler(req); // no business context = public route

      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      const business = await convex.query(api.restaurants.getRestaurant, { restaurantId: businessId });

      if (!business) return handler(req); // business not found = let route handle 404

      const enabledModules = business.enabledModules || [];
      const featureFlags = {}; // TODO: resolve from featureFlags table if needed
      const result = resolveModule(enabledModules, moduleId, featureFlags);

      if (result.resolution !== "allowed") {
        return NextResponse.json(
          { error: "MODULE_NOT_ENABLED", module: moduleId },
          { status: 403 }
        );
      }

      return handler(req);
    };
  };
}
```

Applied to routes like:
```typescript
// src/app/client/api/v1/logistics/shipments/route.ts
export const GET = withModuleGuard("logistics_pack")(async (req) => { ... });
```

### BusinessSetup Component

Rename `RestaurantSetup.tsx` → `BusinessSetup.tsx`. The component already has `vertical` prop and `isRestaurant` logic. Changes:

1. Vertical-to-label map replaces scattered ternaries:
```typescript
const VERTICAL_LABELS: Record<Vertical, string> = {
  restaurant: "Restaurant",
  logistics: "Business",
  healthcare: "Practice",
  legal: "Firm",
  hospitality: "Property",
  general_services: "Business",
};
```

2. Step descriptions adapt per vertical (already partially done via `getSteps()`).

### Billing Events Table

```
convex/schema.ts — billingEvents table:
  eventId: string (unique)
  businessId: string
  vertical: verticalValidator
  eventType: "call_completed" | "order_placed"
  durationSeconds: optional number
  outcome: optional string
  sourcePlatform: optional string
  createdAt: number
  Indexes: by_event_id, by_business_id, by_vertical, by_created_at
```

### KPI Metric Definitions (Phase B prerequisite)

| Metric | Numerator | Denominator | Time Window |
|--------|-----------|-------------|-------------|
| `active_tenant_count` | Businesses with ≥1 call in window | — | 30 days rolling |
| `call_volume` | Count of calls | — | Per day |
| `call_minutes` | Sum of call.duration / 60 | — | Per day |
| `call_to_outcome_conversion` | Orders created from calls | Completed calls | Per day |
| `integration_attach_rate` | Businesses with runsheet connected | Total businesses per vertical | Snapshot |
| `arpa` (Phase C) | Sum of paid invoice amounts | Active subscriptions | Per month |
| `churn_rate` (Phase C) | Cancelled subscriptions in period | Active at period start | Per month |

---

## File Impact Summary

### New Files
- `src/lib/idMapper.ts`
- `src/hooks/useBusinessStorage.ts`
- `src/lib/modules/withModuleGuard.ts`
- `src/app/client/api/v1/partner/businesses/route.ts`
- `convex/billingEvents.ts`
- `docs/kpi-metric-definitions.md`

### Renamed Files
- `src/components/onboarding/RestaurantSetup.tsx` → `BusinessSetup.tsx`
- `src/components/onboarding/VirtualNumberGenerator.tsx` — export renamed to `BusinessIdDisplay`

### Modified Files
- `convex/schema.ts` — attribution fields on calls/orders, billingEvents table
- `convex/internal.ts` — attribution fields in upsertCallData/upsertOrders, billing event emission
- `convex/restaurants.ts` — extend createRestaurantWithBranches to accept vertical/enabledModules
- `convex/kpiComputation.ts` — real metric queries
- `convex/webhookDeliveries.ts` — dispatchWebhookEvent internal mutation
- `src/app/client/onboarding/page.tsx` — import BusinessSetup
- `src/components/dashboard/SettingsSection.tsx` — conditional sections by module
- `src/components/dashboard/DashboardLayout.tsx` — filter tabs by enabledModules
- `src/components/dashboard/KpiDashboard.tsx` — real metrics display (Phase C)
- Partner API routes — accept businessId param alias

### Unchanged
- `src/middleware.ts` — NOT modified
- `convex/webhookSubscriptions.ts` — existing CRUD is sufficient
- DB schema field `restaurantId` — stays for backward compat
