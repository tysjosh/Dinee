# Dinee Monetization Sprint — Requirements

## Context

Dinee is pivoting from a restaurant-only call management tool to a horizontal AI Reception OS platform. Strategy: "Runsheet connects to Dinee" — Dinee is the AI call execution platform, Runsheet is the logistics ops product that optionally plugs in.

The codebase has a working multi-vertical module system, but the domain model, API surface, onboarding, dashboard, entitlement enforcement, and KPI/billing telemetry are not yet production-grade.

This spec is phased into three tiers by revenue impact. Each phase is independently shippable.

---

## Phase A — Must-Have Before Sales Push

### REQ-1: Canonical businessId Alias Layer

- REQ-1.1: A central dual-ID mapper utility (`src/lib/idMapper.ts`) MUST translate between `businessId` and `restaurantId` in both directions. The underlying value is the same — the mapper documents the convention and provides a single grep-able import.
- REQ-1.2: A `useBusinessStorage` hook MUST wrap `useRestaurantStorage` and re-export with `businessId` naming. Consuming components migrate incrementally.
- REQ-1.3: Partner API routes MUST accept `businessId` as a query parameter alias for `restaurantId`. If both are provided, `businessId` takes precedence.
- REQ-1.4: Partner API response objects MUST include `businessId` alongside `restaurantId` for forward compatibility.

### REQ-2: Vertical-Safe Onboarding (No Restaurant Leakage)

- REQ-2.1: The `RestaurantSetup` component MUST be renamed to `BusinessSetup` across the codebase.
- REQ-2.2: Step labels, placeholders, helper text, and validation MUST adapt to the selected vertical using a config map (not scattered conditionals).
- REQ-2.3: The entity label MUST vary by vertical: "Restaurant" for restaurant, "Practice" for healthcare, "Firm" for legal, "Property" for hospitality, "Business" for logistics/general_services.
- REQ-2.4: The "Virtual Number / Business ID" display component MUST use "Business ID" terminology for all verticals.
- REQ-2.5: No user-visible string in onboarding should say "Restaurant" unless the active vertical is `restaurant`.

### REQ-3: Entitlement Enforcement in API Routes

- REQ-3.1: A `withModuleGuard(moduleId)` route wrapper utility MUST check whether the requesting business has the required module enabled, returning `403 { error: "MODULE_NOT_ENABLED", module: "<moduleId>" }` if not.
- REQ-3.2: The wrapper MUST resolve the business's `enabledModules` from Convex and use the existing `resolveModule()` function for the check.
- REQ-3.3: The wrapper MUST be applied to module-gated API routes (logistics, runsheet, menu-items) without modifying the existing `src/middleware.ts` redirect behavior.
- REQ-3.4: UI guards (dashboard tab visibility, settings section rendering) remain as secondary convenience.

### REQ-4: Runsheet Inbound Provisioning Endpoint

- REQ-4.1: A provisioning API (`POST /api/v1/partner/businesses`) MUST allow external systems to create a tenant (business + locations + virtual number + AI script config) in a single call.
- REQ-4.2: The endpoint MUST accept: `name`, `vertical`, `agentName`, `languagePreference`, `specialInstructions`, `locations[]`, `enabledModules[]`, `source_platform`, `source_tenant`.
- REQ-4.3: The endpoint MUST use the existing `validateApiRequest` partner auth middleware and `authorizeResourceAccess` pattern.
- REQ-4.4: Attribution fields (`source_platform`, `source_tenant`, `external_reference_id`) MUST be added to the `calls` and `orders` schema tables as optional fields.
- REQ-4.5: The endpoint MUST log a provisioning audit entry via `integrationAuditLog.createAuditEntry`.

---

## Phase B — Monetization Unlock

### REQ-5: Billing Events + Usage Aggregation

- REQ-5.1: A `billingEvents` Convex table MUST store per-call/per-order billing events with: `businessId`, `vertical`, `eventType`, `durationSeconds`, `outcome`, `sourcePlatform`.
- REQ-5.2: Billing events MUST be emitted from `convex/internal.ts` when a call completes or an order is created.
- REQ-5.3: A `getUsageSummary` query MUST return per-business totals for a billing period: total calls, total minutes, outcomes by type.

### REQ-6: KPI v1 (Real Metrics)

- REQ-6.1: A metric definitions document MUST define numerator, denominator, and time window for each KPI before implementation.
- REQ-6.2: The KPI computation cron MUST compute real metrics (replacing placeholders): `active_tenant_count`, `call_volume`, `call_minutes`, `call_to_outcome_conversion`, `integration_attach_rate` per vertical per day.
- REQ-6.3: Call lifecycle webhook events (`call.started`, `call.completed`, `call.failed`, `order.created`, `order.updated`) MUST be dispatched through the existing webhook delivery pipeline (not a new emitter).

---

## Phase C — Revenue Dashboard + Enterprise Hardening

### REQ-7: ARPA/Churn + Revenue Dashboard

- REQ-7.1: KPI computation MUST add `arpa` and `churn_rate` metrics derived from subscription data.
- REQ-7.2: A KPI dashboard tab MUST display: active tenants by vertical, call volume trends, conversion rates, integration attach rates, ARPA.
- REQ-7.3: The dashboard MUST be filterable by vertical and time range (7d, 30d, 90d).
- REQ-7.4: The dashboard MUST be gated behind `platform_admin` role.

### REQ-8: Conditional Dashboard + Settings Rendering

- REQ-8.1: Settings sections MUST render by active module: core settings always, menu management only with `restaurant_pack`, runsheet config only with `runsheet_connect`.
- REQ-8.2: Dashboard tabs MUST be filtered by `enabledModules` — no empty/broken tabs for non-activated verticals.

### REQ-9: Audit Log Completeness

- REQ-9.1: All partner API calls MUST be logged to `integrationAuditLog` with request metadata (endpoint, method, status code, request ID).
- REQ-9.2: Scope enforcement MUST use the existing `requiredScopes` option in `validateApiRequest` — no new scope check utility needed.
