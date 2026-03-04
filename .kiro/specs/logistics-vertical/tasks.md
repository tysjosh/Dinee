# Implementation Plan: Logistics Vertical

## Overview

Additive implementation of a logistics vertical alongside the existing restaurant domain. New tables, endpoints, voice tools, and state machines are introduced in parallel. Shared files (`convex/schema.ts`, auth middleware, WS server routing, webhook infrastructure) receive additive, non-breaking changes only — no breaking changes to existing restaurant behavior or contracts. Tasks are ordered by dependency: shared foundations first, then data layer, infrastructure utilities (including correlation/request ID), API surface, webhooks, voice agent, and finally compatibility adapters and non-regression validation.

## Tasks

- [x] 1. Shared validators and type foundations
  - [x] 1.1 Create `convex/shared/validators.ts` with all shared Convex validators
    - Define `verticalValidator`, `deliveryStatusValidator`, `serviceTypeValidator`, `riderStatusValidator`, `logisticsPaymentMethodValidator`, `paymentStatusValidator`, `actorTypeValidator`, `addressValidator`, `parcelValidator`, `proofOfDeliveryValidator`
    - Export all validators for use across logistics mutations and queries
    - _Requirements: 1.1, 4.1, 4.3, 4.4, 4.5, 4.6, 5.3, 6.3_
  - [x] 1.2 Create `src/lib/logistics/status-machine.ts` with delivery status transition validator
    - Implement `VALID_TRANSITIONS` map and `validateTransition(current, next)` function
    - Export `DeliveryStatus` type
    - _Requirements: 19.1, 19.2, 19.3_
  - [x] 1.3 Write property test for status transition validator
    - **Property 1: Status machine completeness and correctness**
    - For all `(current, next)` pairs: `validateTransition` returns true iff the pair is in the defined valid transitions set
    - Terminal states (`delivered`, `cancelled`) have no valid outgoing transitions except `failed→created` for re-attempt
    - **Validates: Requirements 19.1, 19.2, 19.3**
  - [x] 1.4 Create `src/lib/logistics/masking.ts` with PII masking utilities
    - Implement `maskPhone(phone)` returning `"****" + last4`
    - Implement `maskAddress(addr)` returning only `city` and `state`
    - _Requirements: 26.1, 26.2, 26.3, 26.5_
  - [x] 1.5 Write property test for PII masking
    - **Property 2: PII masking never leaks sensitive data**
    - For all phone strings of length >= 4: `maskPhone` output contains only `*` and last 4 digits
    - For all address objects: `maskAddress` output contains no street address, building, or apartment fields
    - **Validates: Requirements 26.1, 26.2**

- [x] 2. Checkpoint — Ensure shared foundations compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Schema extensions and new Convex tables
  - [x] 3.1 Extend `convex/schema.ts` with additive fields on existing tables
    - Add `enabledVerticals: v.optional(v.array(verticalValidator))` to `platforms` table
    - Add `shipmentId: v.optional(v.string())`, `resourceType: v.optional(...)`, `resourceId: v.optional(v.string())` to `webhookEvents` table with `by_shipment_id` index
    - Add `vertical: v.optional(verticalValidator)`, `locationId: v.optional(v.string())` to `orders` table
    - Add `vertical: v.optional(verticalValidator)` to `calls` table
    - Add `organizationIds: v.optional(v.array(v.string()))` to `partners` table
    - All additive fields are `v.optional(...)` — no breaking changes to existing data
    - _Requirements: 1.2, 1.4, 1.5, 10.1, 10.2, 10.3_
  - [x] 3.2 Add `organizations` table to `convex/schema.ts`
    - Fields: `organizationId`, `platformId`, `vertical`, `name`, `settings`, `createdAt`
    - Indexes: `by_organization_id`, `by_platform_id`, `by_vertical`
    - _Requirements: 2.1, 2.2_
  - [x] 3.3 Add `locations` table to `convex/schema.ts`
    - Fields: `locationId`, `organizationId`, `name`, `address`, `city`, `state`, `geo`, `isActive`, `operatingHours`, `createdAt`
    - Indexes: `by_location_id`, `by_organization_id`, `by_city_state`
    - _Requirements: 3.1, 3.2_
  - [x] 3.4 Add `shipments` table to `convex/schema.ts`
    - All fields per design: `shipmentId`, `trackingCode`, `organizationId`, `locationId`, `customerId`, `sender`, `recipient`, `parcel`, `serviceType`, `paymentMethod`, `paymentStatus`, `deliveryStatus`, `failureReason`, `etaMinutes`, `assignedRiderId`, `proofOfDelivery`, `createdAt`, `updatedAt`
    - Indexes: `by_shipment_id`, `by_tracking_code`, `by_organization_id`, `by_delivery_status`, `by_assigned_rider_id`
    - _Requirements: 4.1, 4.2, 4.9_
  - [x] 3.5 Add `riders` table to `convex/schema.ts`
    - Fields: `riderId`, `organizationId`, `name`, `phone`, `vehicleType`, `status`, `lastLocation`, `isActive`
    - Indexes: `by_rider_id`, `by_organization_id`, `by_status`
    - _Requirements: 5.1, 5.2_
  - [x] 3.6 Add `shipmentEvents` table to `convex/schema.ts`
    - Fields: `eventId`, `shipmentId`, `eventType`, `actorType`, `actorId`, `payload`, `createdAt`
    - Indexes: `by_shipment_id`, `by_event_type`
    - _Requirements: 6.1, 6.2_
  - [x] 3.7 Add `idempotencyKeys` table to `convex/schema.ts`
    - Fields: `key`, `partnerId`, `requestHash`, `responseStatus`, `responseBody`, `createdAt`, `expiresAt`
    - Indexes: `by_key_and_partner`, `by_expires_at`
    - _Requirements: 21.1, 21.2, 21.5_

- [x] 4. Convex logistics mutations and queries
  - [x] 4.1 Create `convex/logistics/organizations.ts`
    - Implement `createOrganization` mutation with atomic check-and-insert: query `by_organization_id` index, if exists return 409 Conflict with `"organizationId already exists"`, else insert — all in one mutation transaction
    - Validate `platformId` references existing platform and `vertical` is in `enabledVerticals`
    - Implement `getOrganization` and `listOrganizations` queries with filtering by `platformId` and `vertical`
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 20.1, 20.2, 20.3_
  - [x] 4.2 Create `convex/logistics/locations.ts`
    - Implement `createLocation` mutation with atomic check-and-insert: query `by_location_id` index, if exists return 409 Conflict with `"locationId already exists"`, else insert — all in one mutation transaction
    - Validate `organizationId` references existing organization
    - Implement `getLocation` and `listLocations` queries with filtering by `organizationId`, `city`, `state`
    - _Requirements: 3.3, 3.4, 3.5, 3.7, 20.1, 20.2, 20.3_
  - [x] 4.3 Create `convex/logistics/shipments.ts` — creation and queries
    - Implement `createShipment` mutation with atomic check-and-insert: query `by_shipment_id` and `by_tracking_code` indexes, if either exists return 409 Conflict identifying which field conflicted, else insert — all in one mutation transaction
    - Generate tracking code: `LG` prefix + 8 random uppercase alphanumeric chars
    - Set initial `deliveryStatus` to `"created"`, record `createdAt` and `updatedAt`
    - Create corresponding `shipmentEvent` with `eventType: "shipment_created"` in same mutation
    - Implement `getShipment` query by `shipmentId`
    - Implement `getShipmentByTrackingCode` query by `trackingCode`
    - Implement `listShipments` query with pagination (page, perPage, max 100), filtering by `organizationId` and optional `status`, sorted by `createdAt` descending — index-backed only, no `.filter()` or `.collect()` on full table
    - _Requirements: 4.7, 4.8, 4.9, 4.10, 7.2, 7.3, 7.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 20.1, 20.2, 20.3, 20.4, 20.5, 28.6, 28.7_
  - [x] 4.4 Create `convex/logistics/shipments.ts` — status transitions
    - Implement `updateShipmentStatus` mutation that calls `validateTransition` before patching
    - Update `updatedAt` on every status change
    - Create `shipmentEvent` recording old and new status in same mutation
    - Handle `"delivered"` status: accept optional `proofOfDelivery`, validate at least one of `photoUrl`/`signatureUrl`, create `proof_of_delivery_submitted` event
    - Handle `"failed"` status: require `failureReason`, store on shipment, create `delivery_failed` event, set assigned rider back to `"available"`
    - Handle re-attempt: `"failed"→"created"` resets `assignedRiderId` to null
    - Reject invalid transitions with descriptive error
    - _Requirements: 4.3, 4.10, 16.1, 16.2, 16.3, 16.4, 16.5, 17.1, 17.2, 17.3, 17.4, 17.5, 19.1, 19.2, 19.3, 19.4, 19.5_
  - [x] 4.5 Write property test for shipment status transitions
    - **Property 3: Status transitions enforce state machine invariants**
    - For all `(current, next)` pairs not in `VALID_TRANSITIONS`: mutation rejects with error
    - For terminal states `delivered` and `cancelled`: no further transitions accepted
    - For `failed→created`: `assignedRiderId` is cleared
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.5**
  - [x] 4.6 Create `convex/logistics/riders.ts`
    - Implement `createRider` mutation with atomic check-and-insert: query `by_rider_id` index, if exists return 409 Conflict with `"riderId already exists"`, else insert — all in one mutation transaction
    - Implement `updateRiderStatus` mutation for status and location heartbeat
    - Implement `getRider` query and `listRiders` query with filtering by `organizationId` and `status`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 20.1, 20.2, 20.3_
  - [x] 4.7 Create `convex/logistics/shipmentEvents.ts`
    - Implement `createShipmentEvent` mutation with atomic check-and-insert: query `by_shipment_id` + `by_event_type` for `eventId`, if exists return 409 Conflict, else insert — all in one mutation transaction
    - Do NOT expose any `updateShipmentEvent` or `deleteShipmentEvent` mutations — the module must be append-only with no update/delete API surface
    - Implement `listShipmentEvents` query by `shipmentId`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 20.1_
  - [x] 4.8 Write property test for append-only event log
    - **Property 4: Shipment events are immutable once created**
    - For all existing event records: update and delete operations are rejected
    - For all shipment status changes: a corresponding event is created with correct `eventType`
    - **Validates: Requirements 6.4, 6.7**
  - [x] 4.9 Implement rider assignment logic in `convex/logistics/shipments.ts`
    - Implement `assignRider` mutation: validate rider is `"available"` and `isActive`, update shipment `assignedRiderId` and `deliveryStatus` to `"assigned"`, set rider status to `"busy"`, create `rider_assigned` event
    - Return 409 if rider not available
    - On delivery completion or failure, reset rider to `"available"`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_
  - [x] 4.10 Write property test for rider assignment invariants
    - **Property 5: Rider assignment maintains consistency**
    - For all assignments: rider status transitions to `"busy"`, shipment status transitions to `"assigned"`
    - For all unavailable/inactive riders: assignment is rejected with 409
    - On delivery/failure: rider returns to `"available"`
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**

- [x] 5. Checkpoint — Ensure Convex mutations compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Logistics infrastructure utilities
  - [x] 6.1 Create `src/lib/logistics/correlation.ts`
    - Implement `getOrCreateRequestId(headers)` reading `X-Request-Id` or generating UUID
    - This must be done before route handlers so all new logs are traceable from day one
    - _Requirements: 22.1, 22.2, 22.3_
  - [x] 6.2 Create `src/lib/logistics/authorization.ts` as a shared cross-tenant authorization utility
    - Implement `authorizeLogisticsAccess(convexClient, partnerId, organizationId)` verifying partner → platform → organization ownership chain
    - Design the function signature to be reusable for future verticals (not logistics-only) — accept `vertical` parameter for parity with restaurant `authorizeResourceAccess`
    - Return `{ authorized: boolean; error?: string }`
    - _Requirements: 23.1, 23.2, 23.3, 23.5, 23.6_
  - [x] 6.3 Create `src/lib/logistics/feature-gate.ts`
    - Implement `isLogisticsEnabled(convexClient, platformId)` checking `enabledVerticals` includes `"logistics"` and `logistics_api_enabled` feature flag
    - Return boolean
    - _Requirements: 29.1, 29.2, 29.3, 29.5_
  - [x] 6.4 Create `src/lib/logistics/idempotency.ts`
    - Implement idempotency check/store logic using `idempotencyKeys` table
    - Check key existence scoped to `partnerId`, compare request hash, return stored response or execute mutation
    - Return 422 on key mismatch
    - Design the interface to be reusable for restaurant write paths in the future (shared `idempotencyKeys` table, partner-scoped)
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.6_
  - [x] 6.5 Apply atomic idempotency to logistics webhook event ingestion
    - Use existing `atomicInsertWebhookEvent` pattern from `convex/webhookEvents.ts`
    - Deduplicate by `eventId`, log duplicates at warn level
    - This must be done before route handlers wire webhook dispatch
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_
  - [x] 6.6 Write property test for idempotency layer
    - **Property 6: Idempotency key replay returns stored response**
    - For all valid idempotency keys: second request with same key and body returns stored response without re-execution
    - For all keys reused with different body: returns 422
    - Keys scoped to partner: same key from different partners does not collide
    - **Validates: Requirements 21.2, 21.3, 21.4, 21.6**
  - [x] 6.7 Write property test for authorization chain
    - **Property 7: Authorization rejects cross-tenant access**
    - For all `(partnerId, organizationId)` pairs where partner's platform does not own the organization: `authorizeLogisticsAccess` returns `{ authorized: false }`
    - For all valid ownership chains: returns `{ authorized: true }`
    - **Validates: Requirements 23.2, 23.3**

- [x] 7. Logistics API route handlers
  - [x] 7.1 Create `src/app/client/api/v1/logistics/shipments/route.ts` — POST (create) and GET (list)
    - POST: auth → feature gate → authorization → idempotency check → `createShipment` mutation → dispatch `shipment.created` webhook → return 201 with `X-Request-Id`
    - GET: auth → feature gate → authorization → `listShipments` query with pagination params → return 200
    - _Requirements: 7.1, 7.2, 7.4, 7.9, 7.10, 7.11, 7.12, 9.1, 9.4, 22.1, 22.3_
  - [x] 7.2 Create `src/app/client/api/v1/logistics/shipments/[shipmentId]/route.ts` — GET (single)
    - Auth → feature gate → authorization → `getShipment` query → return 200
    - _Requirements: 7.3, 7.9, 7.10, 7.11, 7.12_
  - [x] 7.3 Create `src/app/client/api/v1/logistics/shipments/[shipmentId]/assign/route.ts` — POST
    - Auth → feature gate → authorization → idempotency check → `assignRider` mutation → dispatch `shipment.assigned` webhook → return 200
    - _Requirements: 7.5, 7.9, 7.10, 7.11, 7.12_
  - [x] 7.4 Create `src/app/client/api/v1/logistics/shipments/[shipmentId]/status/route.ts` — POST
    - Auth → feature gate → authorization → idempotency check → `updateShipmentStatus` mutation → dispatch `shipment.status_updated` (or `shipment.delivered`/`shipment.failed`) webhook → return 200
    - _Requirements: 7.6, 7.9, 7.10, 7.11, 7.12, 17.6_
  - [x] 7.5 Create `src/app/client/api/v1/logistics/track/[trackingCode]/route.ts` — GET (public, no auth)
    - No auth required
    - Apply distributed rate limiting using existing Upstash Redis rate limiter from `src/lib/partner-api/rate-limiter.ts` — configure a separate `logistics_tracking` sliding window (e.g., 60 req/min per IP)
    - Query `getShipmentByTrackingCode`, apply PII masking via `maskPhone` and `maskAddress`
    - Return only: `trackingCode`, `deliveryStatus`, `serviceType`, `etaMinutes`, last event timestamp
    - Return 404 for invalid tracking codes
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 23.4, 26.1, 26.2_
  - [x] 7.6 Create `src/app/client/api/v1/logistics/riders/[riderId]/status/route.ts` — POST (heartbeat)
    - Auth → feature gate → authorization (verify partner owns rider's organization) → `updateRiderStatus` mutation → return 200
    - _Requirements: 7.8, 7.9, 7.10, 23.5_
  - [x] 7.7 Write property test for public tracking endpoint PII masking
    - **Property 8: Public tracking never exposes sensitive fields**
    - For all shipments queried via tracking endpoint: response excludes sender full address, recipient full address, payment details, organizationId, assignedRiderId
    - Phone numbers in response are masked to `****XXXX` format
    - **Validates: Requirements 14.3, 26.1, 26.2**

- [x] 8. Checkpoint — Ensure API routes compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Webhook extensions for logistics
  - [x] 9.1 Create `dispatchLogisticsWebhook` utility function
    - Populate `shipmentId`, `resourceType: "shipment"`, `resourceId` on webhook events
    - Include originating `requestId` in webhook payload
    - Use existing `webhookDeliveries` infrastructure for dispatch and retry
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 22.6_
  - [x] 9.2 Wire webhook dispatch into all state-changing logistics route handlers
    - `shipment.created` on POST create, `shipment.assigned` on POST assign, `shipment.status_updated` / `shipment.delivered` / `shipment.failed` on POST status
    - _Requirements: 10.4_
  - [x] 9.3 Write property test for webhook idempotency
    - **Property 9: Duplicate logistics webhook events produce no side effects**
    - For all webhook events dispatched twice with same `eventId`: second dispatch returns 200 with no mutation
    - **Validates: Requirements 25.1, 25.2**

- [x] 10. Voice agent logistics tool pack and call phases
  - [x] 10.1 Create `src/app/ws-server/logistics-call-phase.ts`
    - Define `LogisticsCallPhase` type: `await_org_verification`, `org_verified`, `shipment_open`, `shipment_confirmed`
    - Define `ALLOWED_TOOLS` mapping per phase per design
    - Implement `isLogisticsToolAllowed(phase, toolName)` and `nextLogisticsPhase(current, event)`
    - **Note**: `shipment_confirmed` phase allows `get_organization_details` + `quote_delivery` (read-only). This follows the platform-hardening spec correction, not the original Req 27.1 which said `add_shipment_event` only.
    - _Requirements: 11.6, 11.7, 27.1 (superseded by platform-hardening Req 14.8), 27.2, 27.3, 27.4, 27.5_
  - [x] 10.2 Create `src/app/ws-server/logistics-tools.ts`
    - Implement `wrapperCreateShipment`, `wrapperUpdateShipment`, `wrapperAssignRider`, `wrapperAddShipmentEvent`, `wrapperQuoteDelivery`
    - Each tool calls the corresponding logistics API endpoint internally
    - `wrapperAddShipmentEvent` calls the `createShipmentEvent` Convex mutation directly via `ConvexHttpClient` — a proper dedicated event-append tool
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 10.3 Integrate logistics tool pack into WS server
    - **Implemented**: WS server uses phone-number-based routing via `resolvePhoneToRoute()` to determine `conversationType`. The `isLogistics` boolean is derived from `conversationType.startsWith("logistics_")`. Tool execution gated via `isLogisticsToolAllowed`. Existing restaurant tool dispatch preserved unchanged.
    - _Covers: 11.4 (tool pack selection via conversation type), 11.5 (restaurant phases unchanged), 12.6, 12.7, 12.8_
  - [x] 10.5 Implement conversation type enums and phone-number-based call routing
    - Define conversation type enums: `restaurant_inbound_order`, `restaurant_followup`, `restaurant_cancellation`, `logistics_booking`, `logistics_followup`, `logistics_failure_notice`
    - Add `conversation_type` field to `calls` table
    - Implement phone-number-to-organization lookup: when an inbound call arrives, determine the conversation type based on the called number's associated vertical and Organization
    - Replace `?vertical=logistics` query param routing with phone-number-based vertical detection
    - Select tool pack based on conversation type enum, not boolean flag
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 10.4 Write property test for logistics call phase tool gating
    - **Property 10: Tools are only accessible in their allowed phases**
    - For all `(phase, tool)` pairs not in `ALLOWED_TOOLS`: `isLogisticsToolAllowed` returns false
    - For all `(phase, tool)` pairs in `ALLOWED_TOOLS`: returns true
    - No shipment mutation tools are accessible in `await_org_verification` phase
    - **Validates: Requirements 27.1, 27.2, 27.4**

- [x] 11. Compatibility adapters
  - [x] 11.1 Create `convex/logistics/adapters.ts`
    - Implement `getOrganizationFromRestaurant(restaurantId)` — read-only adapter mapping Restaurant → Organization shape
    - Implement `getLocationFromBranch(branchId)` — read-only adapter mapping Branch → Location shape
    - Implement `listOrganizationsWithAdapted(platformId, vertical?)` — merges native organizations with adapted restaurant records
    - All adapters are query-only, no mutations
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [x] 12. Idempotency key TTL cleanup
  - [x] 12.1 Create scheduled Convex action for idempotency key expiration
    - Query `idempotencyKeys` by `by_expires_at` index for records past TTL
    - Delete expired records in batches
    - Schedule to run periodically (e.g., every hour)
    - _Requirements: 21.5_

- [x] 13. Feature-flag rollout and rollback procedure
  - [x] 13.1 Verify `logistics_api_enabled` feature flag controls all logistics endpoints
    - Confirm all `/api/v1/logistics/*` routes check `isLogisticsEnabled()` and return 403 when disabled
    - Confirm disabling the flag immediately stops serving logistics requests without data loss
    - Confirm re-enabling the flag restores full functionality with no data migration needed
    - _Requirements: 29.1, 29.2, 29.3, 29.5, 29.6_
  - [x] 13.2 Verify `enabledVerticals` platform-level gating
    - Confirm organization creation rejects verticals not in the platform's `enabledVerticals`
    - Confirm logistics is disabled by default (platforms without `enabledVerticals` or without `"logistics"` in the array)
    - _Requirements: 29.1, 29.4_

- [x] 14. Checkpoint — Ensure full logistics vertical compiles and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Non-regression and backward compatibility validation
  - [x] 15.1 Verify all existing restaurant API endpoints return unchanged response schemas
    - Confirm all routes under `/api/v1/partner/` are unmodified
    - Confirm existing authentication and rate limiting behavior is preserved
    - Confirm restaurant endpoints default to `"restaurant"` vertical when no header provided
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 24.1, 24.2_
  - [x] 15.2 Verify existing preservation tests from fix-plan-v1 still pass
    - Run all tests in `tests/preservation/` directory
    - Confirm no logistics module imports from restaurant-specific modules
    - _Requirements: 24.3, 24.4_
  - [x] 15.3 Verify existing restaurant tables and data are unmodified
    - Confirm `restaurants` and `branches` tables have no schema changes
    - Confirm all additive fields on `orders`, `calls`, `webhookEvents`, `platforms`, `partners` are optional
    - _Requirements: 1.6, 2.6, 3.5_
  - [x] 15.4 Write non-regression contract test for restaurant API response shapes
    - **Property 11: Restaurant API responses are unchanged after logistics deployment**
    - For all existing restaurant API endpoints: response payload shapes match pre-logistics baseline
    - New optional fields do not break existing consumers
    - **Verified**: `tests/logistics/restaurant-api-non-regression.test.ts` exists with 87 tests, all passing. Validates Property 11 for Requirements 8.2, 8.6, 24.1, 24.2.
    - **Validates: Requirements 8.2, 8.6, 24.1, 24.2**

- [x] 16. Final checkpoint — Ensure all tests pass
  - Run full test suite including all property tests, preservation tests, and non-regression tests
  - Verify `npx tsc --noEmit` produces 0 type errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Shared files (`schema.ts`, auth middleware, WS server, webhook infra) receive additive, non-breaking changes only — no breaking changes to existing restaurant behavior or contracts
- Feature flags gate all logistics functionality for staged rollout (Requirement 29)
- Correlation/request ID (Task 6.1) and webhook idempotency (Task 6.5) are positioned before route handlers so all new code is traceable and race-safe from day one
- Authorization utility (Task 6.2) is designed with a shared interface for future vertical parity
- Idempotency layer (Task 6.4) uses a shared `idempotencyKeys` table scoped by partner, reusable for restaurant write paths in the future
- All entity creation mutations use atomic check-and-insert with descriptive 409 Conflict responses identifying the conflicting field

## Audit Notes (March 2026)

Requirement-by-requirement audit comparing spec against actual implementation.

### Requirements NOT implemented

- **Req 28 (Performance SLOs)**: Operational latency targets (p95). No code enforces or measures them — these are acceptance criteria for load testing, not code features. Expected gap.

### Previously simplified, now fully implemented

- **Req 12.4 (`add_shipment_event` tool)**: Now calls `createShipmentEvent` Convex mutation directly via `ConvexHttpClient`, instead of the previous indirect HTTP round-trip through the status endpoint. The tool generates a unique `eventId`, passes `actorType`/`actorId`/`payload` directly, and handles 409 duplicate conflicts. Proper dedicated event-append implementation.
- **Req 27.1 (`shipment_confirmed` allowed tools)**: Requirements.md updated to match platform-hardening Req 14.8 correction. `shipment_confirmed` allows `get_organization_details` + `quote_delivery` (read-only). Code and spec are now aligned.

### Previously unimplemented, now complete

- **Req 11.1–11.4 (Conversation Types)**: All six conversation type enums defined in `conversationTypeValidator` (`convex/shared/validators.ts`). `conversationType` field added to `calls` table. Phone-number-to-organization lookup implemented via `resolvePhoneToRoute()` (`src/lib/call-routing/phone-lookup.ts`) backed by `convex/phoneLookup.ts` queries. WS server `/incoming-call` reads Twilio `To` number, resolves vertical via phone lookup, passes `conversationType` to WebSocket stream. `isLogistics` derived from `conversationType.startsWith("logistics_")`. Task 10.5 completed.
- **Req 24.1–24.2 (Backward Compatibility Contract Tests)**: Verified. `tests/logistics/restaurant-api-non-regression.test.ts` exists with 87 tests, all passing. Validates Property 11 (restaurant API response shapes unchanged after logistics deployment). Task 15.4 verified and marked complete.
- **Platform-hardening Req 15 (Organization Details Real Lookup)**: `get_organization_details` voice tool now performs a real Convex lookup via `wrapperGetOrganizationDetails` in `logistics-tools.ts`. Uses lazy `require()` imports for `ConvexHttpClient` and queries `api.logistics.organizations.getOrganization`. Returns org name, vertical, platformId, settings. Returns error if org not found. Wrapped with `withRetry`. Stub in `index.ts` replaced with real call. Phase transition to `org_verified` only occurs on success.
- **Conversation-subtype-aware prompts**: Logistics system prompts now differentiate by `conversationType`: `logistics_booking` (shipment booking flow), `logistics_followup` (status checks, updates, rider management), `logistics_failure_notice` (delivery failure notification, re-attempt options). Transcription hints also differentiated per subtype. Restaurant subtypes were already differentiated.

### All other requirements (1–10, 12–13, 14–23, 25–26, 29): Fully implemented as specified.

### Final verification (March 2026)

- `npx tsc --noEmit`: 0 type errors
- `npx vitest run`: 557 tests passed, 30 test files, 0 failures
- All tasks complete. Logistics vertical spec fully implemented.