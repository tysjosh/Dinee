# Bugfix Requirements Document

## Introduction

This document covers a comprehensive fix plan (v1) addressing 9 critical issues across the restaurant call management platform, spanning type system integrity, security, data integrity, reliability, and observability. The issues are prioritized P0–P3, where P0 items are ship-blockers that must be resolved before any production deployment.

## Bug Analysis

### Current Behavior (Defect)

**P0 — Ship-Blockers**

1.1 WHEN `auth.ts`, `middleware.ts`, or `rate-limiter.ts` import type names `ApiKey`, `ApiKeyScope`, `ApiRequestContext`, `ApiErrorResponse`, `ApiSuccessResponse`, `OAuthClient`, `OAuthAccessToken`, `OAuthTokenRequest`, `ApiKeyValidationResult`, `RateLimitHeaders` from `types.ts` THEN the TypeScript compiler fails because `types.ts` exports different names (`APIKey`, `APIScope`, `APIResponse`, `APIError`, etc.) and does not export several of the referenced types at all

1.2 WHEN all partner route handlers (`branches`, `calls`, `menus`, `orders`, `restaurants`, `webhooks`) import `ApiErrorResponse` and `ApiSuccessResponse` from `@/lib/partner-api/types` THEN the TypeScript compiler fails because these types do not exist in the module's exports

1.3 WHEN `INTERNAL_API_KEY` environment variable is not set in a non-development environment THEN the `validateApiKey()` function in all 7 internal-use route handlers returns `true`, allowing unauthenticated access to mutation endpoints (fail-open)

1.4 WHEN the ws-server wrapper functions (`wrapperUpsertCallData`, `wrapperAddTranscriptDialogues`, `wrapperUpsertOrders`, `wrapperMatchUpsellPrompts`, `wrapperRecordPromptAcceptance`, `wrapperCheckBlocked`, `wrapperGetRestaurantDetails`) make HTTP requests to internal API routes THEN they do not include the `x-api-key` header, meaning requests would be rejected once internal auth is enforced

1.5 WHEN `generateOrderId()` is called THEN it produces a 4-digit numeric string using `otp-generator`, yielding only 10,000 possible values and creating a high probability of ID collision across concurrent orders and restaurants. Additionally, the same value serves as both the internal primary key and the human-facing reference, with no separation between the two concerns

1.6 WHEN `upsertOrders` in `convex/internal.ts` queries for an existing order THEN it uses the `by_order_and_restaurant_id` index but only filters by `orderId` (not scoped to `restaurantId`), meaning two restaurants could collide on the same orderId value

**P1 — Data Integrity + Multi-tenant Correctness**

1.7 WHEN `getOrderByOrderId`, `updatePaymentStatus`, `recordCODPaymentCollection`, `recordCODPaymentFailure`, `updateOrderStatus`, or `updateDeliveryStatus` in `convex/orders.ts` are called THEN they execute `.query("orders").collect()` which performs a full-table scan of all orders across all tenants, then filter in-memory with `.find()`

1.8 WHEN `updateCallASRData` in `convex/calls.ts` is called THEN it queries the `calls` table using `.filter()` without an index, performing a full-table scan instead of using the existing `by_call_and_order_id` index

1.9 WHEN a partner API request is authenticated via `validateApiRequest` in `middleware.ts` THEN the middleware validates the API key and scopes but does not enforce that the partner's `restaurantIds` or `platformId` match the resource being accessed, allowing cross-tenant data access

**P2 — Reliability for Real Traffic**

1.10 WHEN the ws-server process stores callback context in `pendingCallbacks: Map<string, CallbackContext>` THEN this state is lost on server restart or when running multiple instances, breaking the `/callback` → `/media-stream-callback` handoff

1.11 WHEN the in-memory `InMemoryRateLimiter` in `rate-limiter.ts` is used across multiple server instances THEN each instance maintains its own independent counter, allowing a client to exceed the rate limit by distributing requests across instances

**P3 — Voice Agent Safety + Observability**

1.12 WHEN the ws-server processes tool calls from the OpenAI Realtime API THEN there is no state machine enforcing call phases, meaning tool calls like `upsertOrders` or `addTranscriptDialogues` can execute before the restaurant has been verified

1.13 WHEN internal API routes, ws-server handlers, and webhook routes log errors THEN they use unstructured `console.log`/`console.error` without correlation IDs, making it impossible to trace a single call or request across multiple log entries

1.14 WHEN webhook events are processed by Paystack or Flutterwave handlers THEN the idempotency check queries by `eventId` but does not use a unique constraint, creating a race window where duplicate webhook deliveries could both pass the idempotency check and process the same payment twice

### Expected Behavior (Correct)

**P0 — Ship-Blockers**

2.1 WHEN `auth.ts`, `middleware.ts`, `rate-limiter.ts`, and partner route handlers import types from `types.ts` THEN the type names SHALL be consistent and `npm run type-check` SHALL pass with 0 errors — either by normalizing exports in `types.ts` to match import names or by updating all imports to match existing exports

2.2 WHEN all partner route handlers import response types from `@/lib/partner-api/types` THEN the module SHALL export `ApiErrorResponse` and `ApiSuccessResponse` (or equivalent names used consistently everywhere)

2.3 WHEN `INTERNAL_API_KEY` is not set in a non-development environment (i.e., `NODE_ENV !== 'development'`) THEN the internal-use route handlers SHALL reject all requests with a 500 error indicating misconfiguration, rather than allowing unauthenticated access

2.4 WHEN ws-server wrapper functions make HTTP requests to internal API routes THEN they SHALL include the `x-api-key` header with the value of `INTERNAL_API_KEY` environment variable on every request

2.5 WHEN `generateOrderId()` is called THEN it SHALL produce two identifiers: (a) an internal `orderId` with high entropy (e.g., prefixed ULID, KSUID, or nanoid of at least 12 characters) used as the immutable primary key for all backend lookups and mutations, and (b) a human-readable `publicOrderCode` of 6–8 alphanumeric characters used for customer-facing references (voice agent readback, dashboard display, support lookups). The `publicOrderCode` SHALL be unique within a restaurant scope. All dashboard UI, transcript references, and support workflows SHALL display `publicOrderCode`; all internal APIs, indexes, and mutations SHALL use `orderId`

2.6 WHEN `upsertOrders` in `convex/internal.ts` queries for an existing order THEN it SHALL scope the lookup by both `orderId` AND `restaurantId` using the `by_order_and_restaurant_id` composite index to prevent cross-restaurant collisions

**P1 — Data Integrity + Multi-tenant Correctness**

2.7 WHEN `getOrderByOrderId`, `updatePaymentStatus`, `recordCODPaymentCollection`, `recordCODPaymentFailure`, `updateOrderStatus`, or `updateDeliveryStatus` are called THEN they SHALL use the `by_order_and_restaurant_id` composite index exclusively for all single-order lookups, requiring callers to pass both `orderId` AND `restaurantId`. This is the single global strategy for order lookups — no ad-hoc mixing of `by_order_id`-only paths. All call sites SHALL be updated to provide `restaurantId`. Full-table scans SHALL never be used for single-record lookups

2.8 WHEN `updateCallASRData` in `convex/calls.ts` is called THEN it SHALL use the `by_call_and_order_id` index (or a dedicated `by_call_id` index) to look up the call record instead of scanning the entire table

2.9 WHEN a partner API request accesses a resource (restaurant, order, call, menu, branch) THEN a shared `authorizeResourceAccess(partnerId, resourceType, resourceId)` utility SHALL verify that the authenticated partner's `restaurantIds` or `platformId` includes the target resource's tenant, returning 403 Forbidden if the ownership check fails. This utility SHALL be the single enforcement point — middleware validates auth/scope, and every route handler SHALL call `authorizeResourceAccess()` before any read/write operation. No route SHALL implement its own ad-hoc ownership check

**P2 — Reliability for Real Traffic**

2.10 WHEN the ws-server stores callback context THEN it SHALL use a persistent store (e.g., a Convex table with TTL cleanup, or Redis) instead of an in-memory Map, ensuring context survives restarts and is accessible across multiple instances. The persistent key SHALL be a `callbackSessionId` (UUID) generated at callback initiation and passed through the Twilio stream URL — not the phone number, which is race-prone with concurrent callbacks to the same number. The `/callback` → `/media-stream-callback` handoff SHALL be idempotent and race-safe by keying on `callbackSessionId`

2.11 WHEN the rate limiter tracks request counts THEN it SHALL use a distributed store (e.g., Redis/Upstash sliding window) instead of in-memory state, ensuring accurate rate limiting across all server instances while maintaining the same response headers and 429 response shape. The implementation SHALL use a sliding window algorithm with explicit clock-skew tolerance (accept timestamps within ±5 seconds) and deterministic window semantics so that `X-RateLimit-*` headers remain consistent and predictable after migration from the in-memory implementation

**P3 — Voice Agent Safety + Observability**

2.12 WHEN the ws-server processes tool calls THEN it SHALL enforce a deterministic call phase state machine (`await_restaurant_id` → `restaurant_verified` → `order_open` → `order_finalized`) and SHALL reject or ignore tool calls that are not valid for the current phase. The allowed tools per phase are:
- `await_restaurant_id`: only `get_restaurant_details`
- `restaurant_verified`: `upsert_call_data`, `add_transcript_dialogue`
- `order_open`: `generate_order_id`, `upsert_order`, `add_transcript_dialogue`
- `order_finalized`: `add_transcript_dialogue` only; no mutating order tools except through the cancellation flow
Any tool call received outside its allowed phase SHALL be rejected with a structured error logged (including callId, current phase, rejected tool name) and SHALL NOT produce side effects

2.13 WHEN internal API routes, ws-server handlers, and webhook routes log events THEN they SHALL use structured logging with a correlation ID (e.g., `callId`, `requestId`, or `orderId`) attached to every log entry for end-to-end traceability

2.14 WHEN webhook events are processed THEN the idempotency check SHALL be race-safe by: (a) adding a unique index on `webhookEvents.eventId` in the Convex schema, (b) using an atomic insert-first strategy where the handler attempts to insert the event record before processing — if the insert fails due to uniqueness violation, the handler SHALL return HTTP 200 with an "already processed" indicator and produce no side effects, and (c) the payment status update SHALL only execute after successful event insertion, ensuring no duplicate payment processing

### Unchanged Behavior (Regression Prevention)

3.1 WHEN partner route handlers make authenticated API calls with valid API keys and correct scopes THEN the system SHALL CONTINUE TO return successful responses with the same response shape and status codes

3.2 WHEN internal-use route handlers receive requests with a valid `x-api-key` header matching `INTERNAL_API_KEY` THEN the system SHALL CONTINUE TO process the request and return the same response format

3.3 WHEN `INTERNAL_API_KEY` is not set and `NODE_ENV` is `development` THEN the internal-use route handlers SHALL CONTINUE TO allow requests for local development convenience

3.4 WHEN orders are created, updated, or queried by restaurant-scoped endpoints (e.g., `getOrdersByRestaurant`, `getActiveOrdersByRestaurant`) THEN the system SHALL CONTINUE TO return correct results using existing index-backed queries

3.5 WHEN calls are queried by restaurant or branch using `getCallsByRestaurant`, `getCallsByBranch`, or similar index-backed queries THEN the system SHALL CONTINUE TO return correct results

3.6 WHEN Paystack or Flutterwave webhooks deliver valid, non-duplicate events with correct signatures THEN the system SHALL CONTINUE TO process them, update order payment status, and return 200 responses

3.7 WHEN the ws-server successfully verifies a restaurant and builds an order through the normal call flow THEN the system SHALL CONTINUE TO create orders, save transcripts, and complete calls with the same behavior

3.8 WHEN the rate limiter allows requests within the configured limit (1000 requests/minute per API key) THEN the system SHALL CONTINUE TO return the same `X-RateLimit-*` response headers and allow the requests through

3.9 WHEN `upsertCallData` in `convex/internal.ts` upserts call records THEN the system SHALL CONTINUE TO use the `by_call_and_order_id` index for lookups and maintain the same insert/update behavior

3.10 WHEN orders are created via `createOrderWithPayment` with WhatsApp opt-in THEN the system SHALL CONTINUE TO schedule confirmation messages and set initial payment/delivery status correctly

### Non-Functional Regression Prevention (Performance Guardrails)

4.1 AFTER fixes are applied, no Convex query in order or call hot paths (single-record lookups, status updates, payment updates) SHALL use `.collect()` followed by in-memory `.find()` or `.filter()` — all single-record lookups SHALL use index-backed queries

4.2 AFTER fixes are applied, partner API order/call lookup endpoints SHALL maintain p95 latency under 200ms for single-record queries (measured at the Convex query layer), consistent with index-backed query performance

4.3 AFTER fixes are applied, the `orders` and `calls` tables SHALL have no query path that reads more than O(1) records for a single-record lookup operation
