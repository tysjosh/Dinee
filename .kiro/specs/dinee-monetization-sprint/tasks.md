# Dinee Monetization Sprint — Tasks

## Phase A: Must-Have Before Sales Push

### Task 1: Dual-ID Mapper + Business Storage Hook
- [x] Create `src/lib/idMapper.ts` with `businessIdToRestaurantId(businessId: string): string` and `restaurantIdToBusinessId(restaurantId: string): string` (both return the input — the mapper documents the convention and provides a grep-able import for future migration)
- [x] Create `src/hooks/useBusinessStorage.ts` that wraps `useRestaurantStorage` and re-exports: `businessId` (from `restaurantId`), `businessData` (from `restaurantData`), `loading`, `saveBusinessData` (from `saveRestaurantData`), `deleteAllData`, `clearBusinessId` (from `clearRestaurantId`)
- [x] Update `src/app/client/onboarding/page.tsx` to import `useBusinessStorage` instead of `useRestaurantStorage`
- [x] Update `src/components/dashboard/SettingsSection.tsx` to import `useBusinessStorage` instead of `useRestaurantStorage`
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 2: Rename RestaurantSetup → BusinessSetup
- [x] Use `smartRelocate` to move `src/components/onboarding/RestaurantSetup.tsx` → `src/components/onboarding/BusinessSetup.tsx`
- [x] Use `semanticRename` to rename the component `RestaurantSetup` → `BusinessSetup` and interface `RestaurantSetupProps` → `BusinessSetupProps`
- [x] Update the JSDoc comment from "restaurant setup" to "business setup"
- [x] Verify all imports updated (onboarding page, any barrel exports in `src/components/onboarding/index.ts` if it exists)
- [x] Verify: `npm run type-check` passes

### Task 3: Vertical-Aware Labels in BusinessSetup
- [x] Add a `VERTICAL_LABELS` map at the top of `BusinessSetup.tsx`: `{ restaurant: "Restaurant", logistics: "Business", healthcare: "Practice", legal: "Firm", hospitality: "Property", general_services: "Business" }`
- [x] Replace the `entityLabel` ternary (`isRestaurant ? "Restaurant" : "Business"`) with `VERTICAL_LABELS[vertical || "restaurant"]`
- [x] In `getSteps()`, update step descriptions to use the vertical label (e.g., "Tell us about your practice" for healthcare, "Add your firm's office locations" for legal)
- [x] Verify the special instructions examples (already vertical-aware from previous work) still work correctly
- [x] Verify: `npm run type-check` passes

### Task 4: Rename VirtualNumberGenerator Display
- [x] Read `src/components/onboarding/VirtualNumberGenerator.tsx` and update all user-facing text from "Restaurant ID" to "Business ID"
- [x] If the component is exported as `RestaurantIdDisplay`, use `semanticRename` to rename it to `BusinessIdDisplay`
- [x] Update the import in `src/app/client/onboarding/page.tsx`
- [ ] Verify: `npm run type-check` passes

### Task 5: withModuleGuard Route Wrapper
- [x] Create `src/lib/modules/withModuleGuard.ts`:
  - Export `withModuleGuard(moduleId: string)` that returns a higher-order function wrapping a Next.js route handler
  - Extract `businessId` from `x-business-id` header, or `businessId`/`restaurantId` query param (prefer `businessId`)
  - If no businessId found, pass through to the handler (public/unscoped route)
  - Query `api.restaurants.getRestaurant` via `ConvexHttpClient` to get `enabledModules`
  - If business not found, pass through (let the route handler return its own 404)
  - Call `resolveModule(enabledModules, moduleId, {})` from `src/lib/modules/moduleResolver.ts`
  - If resolution is not `"allowed"`, return `NextResponse.json({ error: "MODULE_NOT_ENABLED", module: moduleId }, { status: 403 })`
  - Otherwise call the wrapped handler
- [x] Apply `withModuleGuard("logistics_pack")` to `src/app/client/api/v1/logistics/shipments/route.ts` GET handler as a proof-of-concept
- [x] Do NOT modify `src/middleware.ts`
- [x] Verify: `npm run type-check` passes

### Task 6: Partner API — Accept businessId Parameter
- [x] In `src/app/client/api/v1/partner/orders/route.ts`: read `businessId` query param as alias for `restaurantId`; if both provided, `businessId` wins; add `businessId` to response objects
- [x] In `src/app/client/api/v1/partner/menus/route.ts`: same dual-param support + response alias
- [x] In `src/app/client/api/v1/partner/calls/route.ts`: same dual-param support + response alias
- [x] In `src/app/client/api/v1/partner/branches/route.ts`: same dual-param support + response alias
- [x] In `src/app/client/api/v1/partner/restaurants/route.ts`: add `businessId` field to response objects (same value as `restaurantId`)
- [x] Verify: `npm run type-check` passes

### Task 7: Attribution Fields on Schema
- [x] In `convex/schema.ts` `calls` table, add: `source_platform: v.optional(v.string())`, `source_tenant: v.optional(v.string())`, `external_reference_id: v.optional(v.string())`
- [x] In `convex/schema.ts` `orders` table, add same three optional fields
- [x] In `convex/internal.ts` `upsertCallData` args validator, add the three attribution fields as optional; pass through to insert/patch
- [x] In `convex/internal.ts` `upsertOrders` args validator, add the three attribution fields as optional; pass through to insert/patch
- [x] Run `npx convex codegen`
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 8: Provisioning API Endpoint
- [x] Extend `convex/restaurants.ts` `createRestaurantWithBranches` mutation to accept optional fields: `vertical` (verticalValidator), `enabledModules` (v.optional(v.array(v.string()))), `source_platform` (v.optional(v.string())), `source_tenant` (v.optional(v.string()))); pass them through to the insert
- [ ] Run `npx convex codegen`
- [x] Create `src/app/client/api/v1/partner/businesses/route.ts` with POST handler:
  - Use `validateApiRequest(request, { requiredScopes: ["businesses:write"] })` from `src/lib/partner-api/middleware.ts`
  - Accept body: `{ name, vertical, agentName, languagePreference, specialInstructions, locations: [{ name, address, phoneNumber, operatingHours }], enabledModules, source_platform, source_tenant }`
  - Call `api.restaurants.createRestaurantWithBranches` with the body fields
  - Log audit entry via `api.integrationAuditLog.createAuditEntry`
  - Return `{ businessId, locations: [{ locationId, name }] }`
- [x] Verify: `npm run type-check` passes

### Task 9: Phase A Verification
- [x] Run `npm run type-check` — must pass clean
- [x] Run `npx vitest --run` — all tests must pass
- [x] Manually verify: create a logistics business through onboarding — no "restaurant" text visible
- [x] Manually verify: partner API accepts `businessId` query param and returns `businessId` in responses

---

## Phase B: Monetization Unlock

### Task 10: Billing Events Table
- [x] In `convex/schema.ts`, add `billingEvents` table with fields: `eventId` (string), `businessId` (string), `vertical` (verticalValidator), `eventType` (union: "call_completed", "order_placed"), `durationSeconds` (optional number), `outcome` (optional string), `sourcePlatform` (optional string), `createdAt` (number); indexes: `by_event_id` on eventId, `by_business_id` on businessId, `by_vertical` on vertical, `by_created_at` on createdAt
- [x] Create `convex/billingEvents.ts` with:
  - `createBillingEvent` mutation (accepts all fields)
  - `getUsageSummary` query: args `{ businessId, periodStart, periodEnd }`, returns `{ totalCalls, totalMinutes, outcomesByType: Record<string, number> }` by aggregating billingEvents
  - `getUsageSummaryByVertical` query: args `{ vertical, periodStart, periodEnd }`, returns aggregate across all businesses in that vertical
- [x] Run `npx convex codegen`
- [x] Verify: `npm run type-check` passes

### Task 11: Emit Billing Events from Internal Mutations
- [x] In `convex/internal.ts` `upsertCallData`: after successful insert with status "completed" OR after patch that changes status to "completed", call `ctx.db.insert("billingEvents", { eventId, businessId: data.restaurantId, vertical: "restaurant", eventType: "call_completed", durationSeconds: computed from callStartTime, sourcePlatform: data.source_platform, createdAt: Date.now() })`
- [x] In `convex/internal.ts` `upsertOrders`: after successful new order insert, call `ctx.db.insert("billingEvents", { eventId, businessId: data.restaurantId, vertical: "restaurant", eventType: "order_placed", outcome: "order_placed", sourcePlatform: data.source_platform, createdAt: Date.now() })`
- [x] Note: vertical should be looked up from the business record if available, falling back to "restaurant"
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 12: Metric Definitions Document
- [x] Create `docs/kpi-metric-definitions.md` with a table defining each KPI:
  - `active_tenant_count`: numerator = businesses with ≥1 call in window, denominator = N/A, window = 30 days rolling
  - `call_volume`: numerator = count of calls, denominator = N/A, window = per day
  - `call_minutes`: numerator = sum(call.duration) / 60, denominator = N/A, window = per day
  - `call_to_outcome_conversion`: numerator = orders created from calls, denominator = completed calls, window = per day
  - `integration_attach_rate`: numerator = businesses with runsheet status "connected", denominator = total businesses per vertical, window = snapshot
- [x] Include data source (table name), any filters, and edge case notes

### Task 13: Production KPI Computation
- [x] Rewrite `convex/kpiComputation.ts` `computeDailySnapshots` to compute real metrics per the definitions doc:
  - `active_tenant_count`: query `restaurants` by vertical, cross-reference with `calls` table for activity in last 30 days
  - `call_volume`: count `calls` created in the snapshot day, grouped by vertical (use `calls.vertical` field, fall back to looking up restaurant's vertical)
  - `call_minutes`: sum `calls.duration` / 60 for the snapshot day, grouped by vertical
  - `call_to_outcome_conversion`: count orders with `callId` set / count completed calls, per vertical per day
  - `integration_attach_rate`: count restaurants where `integrations.runsheet.status === "connected"` / total restaurants per vertical
- [x] Each metric stored via existing `api.kpiSnapshots.storeSnapshot` (idempotent)
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 14: Extend Webhook Pipeline for Call Lifecycle Events
- [x] In `convex/webhookDeliveries.ts`, add a new `dispatchWebhookEvent` internal mutation:
  - Args: `{ eventType: string, businessId: string, payload: string }`
  - Query `webhookSubscriptions` for active subscriptions whose `events` array includes `eventType`
  - For each matching subscription, insert a `webhookDeliveries` record with `success: false`, `attemptCount: 0`, `nextRetryAt: Date.now()` (triggers immediate retry by existing cron)
  - Return count of deliveries created
- [x] Run `npx convex codegen`
- [x] In `convex/internal.ts` `upsertCallData`: after insert, schedule `dispatchWebhookEvent` with eventType `call.started`; after patch to status "completed", schedule with `call.completed`
- [x] In `convex/internal.ts` `upsertOrders`: after insert, schedule `dispatchWebhookEvent` with `order.created`; after patch, schedule with `order.updated`
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 15: Phase B Verification
- [x] Run `npm run type-check` — must pass clean
- [x] Run `npx vitest --run` — all tests must pass
- [x] Run `npx convex codegen` — must complete without errors
- [x] Verify billing events are created when calls complete (check billingEvents table)

---

## Phase C: Revenue Dashboard + Enterprise Hardening

### Task 16: ARPA + Churn KPI Metrics
- [x] Update `docs/kpi-metric-definitions.md` with:
  - `arpa`: numerator = sum of paid subscriptionInvoices.amount in period, denominator = count active subscriptions, window = per month
  - `churn_rate`: numerator = subscriptions cancelled in period, denominator = active subscriptions at period start, window = per month
- [x] In `convex/kpiComputation.ts`, add computation for `arpa` and `churn_rate`:
  - `arpa`: query `subscriptionInvoices` with status "paid" in period, sum amounts, divide by count of active subscriptions per vertical
  - `churn_rate`: query `subscriptions` cancelled in period / active at period start per vertical
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 17: Revenue Proof Dashboard
- [x] In `src/components/dashboard/KpiDashboard.tsx`:
  - Add vertical filter dropdown (options: "All" + each vertical from the Vertical type)
  - Add time range selector (7d, 30d, 90d)
  - Display metric cards for: active tenants, call volume, call minutes, conversion rate, integration attach rate, ARPA
  - Each card shows current value + delta vs previous period (e.g., "+12% vs last 30d")
  - Query `api.kpiSnapshots.getSnapshots` with selected vertical and time range
- [x] In `src/components/dashboard/DashboardLayout.tsx`, gate the KPI dashboard tab to only show for users with `platform_admin` role
- [x] Verify: `npm run type-check` passes

### Task 18: Conditional Settings Rendering
- [x] In `src/components/dashboard/SettingsSection.tsx`:
  - Query the business's `enabledModules` (via `useBusinessStorage` → Convex query on restaurant record)
  - Wrap "Menu Management" section in a conditional: only render if `enabledModules` includes `restaurant_pack`
  - Wrap "Runsheet Connect" section (if present) in a conditional: only render if `enabledModules` includes `runsheet_connect`
  - Core settings (name, agent name, language, special instructions) always render
  - "Danger Zone" always renders
- [x] Verify: `npm run type-check` passes

### Task 19: Conditional Dashboard Tabs
- [x] In `src/components/dashboard/DashboardLayout.tsx`:
  - Define `TAB_MODULE_MAP: Record<string, string>` mapping tab IDs to required modules (e.g., `orders: "restaurant_pack"`, `shipments: "logistics_pack"`, `riders: "logistics_pack"`, `runsheet: "runsheet_connect"`)
  - Before rendering tabs, filter by checking `enabledModules.includes(TAB_MODULE_MAP[tab.id])` — tabs without an entry in the map are core tabs (always shown)
  - Get `enabledModules` from the business record (via context or direct query)
- [x] Verify: `npm run type-check` passes

### Task 20: Partner API Audit Logging
- [x] In each partner API route handler (orders, calls, menus, branches, restaurants, webhooks, businesses), after successful response, log to `integrationAuditLog.createAuditEntry`:
  - `businessId`: from request context
  - `integrationName`: `"partner_api"`
  - `actionType`: map HTTP method → action (`GET` → `"connect"`, `POST` → `"create"`, `PUT` → `"create"`, `DELETE` → `"revoke"`)
  - `actorUserId`: partner ID from API key context
  - `actorRole`: `"partner"`
  - `details`: JSON string with `{ endpoint, method, statusCode, requestId }`
- [x] Verify: `npm run type-check` passes, `npx vitest --run` passes

### Task 21: Final Verification
- [x] Run `npm run type-check` — must pass clean
- [x] Run `npx vitest --run` — all tests must pass
- [x] Run `npx convex codegen` — must complete without errors
- [x] Verify onboarding for restaurant, logistics, and healthcare verticals — no terminology leakage
- [x] Verify partner API accepts `businessId` and returns it in all responses
- [x] Verify `withModuleGuard` returns 403 for module-gated routes when module is not enabled
- [x] Verify KPI dashboard shows real metrics (not placeholder zeros)
