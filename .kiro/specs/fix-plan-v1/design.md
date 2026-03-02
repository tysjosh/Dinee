# Fix Plan v1 — Bugfix Design

## Overview

This design addresses 9 systemic issues (P0–P3) across the restaurant call management platform. The bugs span type system integrity, authentication security, data integrity, multi-tenant isolation, reliability under concurrency, voice agent safety, and observability. The fix strategy is layered: normalize the type foundation first (P0), then harden auth and data paths (P0/P1), then add distributed infrastructure (P2), and finally enforce runtime safety and traceability (P3).

## Glossary

- **Bug_Condition (C)**: The set of inputs/states that trigger one of the 9 identified defects
- **Property (P)**: The desired behavior after fixes are applied
- **Preservation**: Existing behaviors that must remain unchanged by the fixes
- **`types.ts`**: The canonical type module at `src/lib/partner-api/types.ts`
- **`validateApiKey()`**: The per-route auth function in internal-use handlers
- **`pendingCallbacks`**: The in-memory `Map<string, CallbackContext>` in ws-server
- **`upsertOrders`**: The Convex mutation in `convex/internal.ts`
- **orderId**: Current 4-digit numeric ID serving as both internal key and customer reference
- **publicOrderCode**: New human-readable 6-char code for customer-facing references

## Bug Details

### Fault Condition

The platform exhibits 9 distinct fault conditions across type safety, security, data integrity, reliability, and observability.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PlatformOperation
  OUTPUT: boolean

  // P0: Type drift — consumers import names that don't exist in types.ts
  C1 := input.operation == "compile"
        AND input.importedTypeName NOT IN types.ts.exportedNames

  // P0: Fail-open internal auth when env var missing in production
  C2 := input.operation == "internal_api_request"
        AND env.INTERNAL_API_KEY == undefined
        AND env.NODE_ENV != "development"

  // P0: ws-server wrapper functions omit x-api-key header
  C3 := input.operation == "ws_server_internal_fetch"
        AND input.headers["x-api-key"] == undefined

  // P0: Order ID collision — 4-digit numeric = 10,000 keyspace
  C4 := input.operation == "generate_order_id"
        AND keyspace(input.generator) <= 10000

  // P0: upsertOrders index lookup not scoped to restaurantId
  C5 := input.operation == "upsert_order"
        AND indexLookupFields == ["orderId"] // missing restaurantId

  // P1: Full-table scan for single-record order lookups
  C6 := input.operation IN ["getOrderByOrderId", "updatePaymentStatus",
         "recordCODPaymentCollection", "recordCODPaymentFailure",
         "updateOrderStatus", "updateDeliveryStatus"]
        AND queryStrategy == "collect_then_find"

  // P1: Unindexed call lookup in updateCallASRData
  C7 := input.operation == "updateCallASRData"
        AND queryStrategy == "filter_without_index"

  // P1: Missing tenant authorization on partner API
  C8 := input.operation == "partner_api_resource_access"
        AND NOT tenantOwnershipVerified(input.partnerId, input.resourceId)

  // P2: Ephemeral callback context lost on restart
  C9 := input.operation == "callback_handoff"
        AND storageType == "in_memory_map"

  // P2: Single-instance rate limiter under multi-instance deployment
  C10 := input.operation == "rate_limit_check"
         AND limiterType == "in_memory"
         AND serverInstanceCount > 1

  // P3: Unguarded tool calls — no phase enforcement
  C11 := input.operation == "ws_tool_call"
         AND NOT phaseAllows(currentPhase, toolName)

  // P3: Unstructured logging without correlation IDs
  C12 := input.operation == "log_event"
         AND correlationId == undefined

  // P3: Racy webhook idempotency — check-then-insert race window
  C13 := input.operation == "webhook_process"
         AND NOT atomicIdempotencyGuard(eventId)

  RETURN C1 OR C2 OR C3 OR C4 OR C5 OR C6 OR C7 OR C8
         OR C9 OR C10 OR C11 OR C12 OR C13
END FUNCTION
```

### Examples

- **Type drift (C1)**: `middleware.ts` imports `ApiKey` but `types.ts` exports `APIKey`. `rate-limiter.ts` imports `RateLimitHeaders` but `types.ts` exports `RateLimitStatus` with different field names (`remaining` vs computed from `currentCount`). Partner routes import `ApiErrorResponse`/`ApiSuccessResponse` which don't exist at all.
- **Fail-open auth (C2)**: Deploy to staging without setting `INTERNAL_API_KEY` → all 7 internal routes accept unauthenticated POST requests, allowing arbitrary order/call mutations.
- **Order ID collision (C4)**: Two concurrent calls both generate orderId `"4821"` → `upsertOrders` overwrites one restaurant's order with another's data because the index lookup only matches on `orderId`.
- **Full-table scan (C6)**: `updatePaymentStatus("ORD-1234")` calls `.collect()` on the entire orders table (could be 100k+ rows), then `.find()` in memory — O(N) instead of O(1).
- **Cross-tenant access (C8)**: Partner A (authorized for restaurant "R001") calls `GET /api/v1/partner/orders?restaurantId=R002` → middleware validates API key and scopes but never checks that R002 belongs to Partner A.
- **Racy idempotency (C13)**: Paystack sends duplicate webhook → both requests query `getWebhookEventByEventId` (returns null), both proceed to `createWebhookEvent` + `updatePaymentStatus`, processing the payment twice.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Partner API routes with valid API keys and correct scopes continue to return successful responses with the same response shape and status codes (Req 3.1)
- Internal-use routes with valid `x-api-key` header matching `INTERNAL_API_KEY` continue to process requests and return the same response format (Req 3.2)
- When `INTERNAL_API_KEY` is unset and `NODE_ENV === "development"`, internal routes continue to allow requests for local dev convenience (Req 3.3)
- Restaurant-scoped order queries (`getOrdersByRestaurant`, `getActiveOrdersByRestaurant`) continue to return correct results via existing indexes (Req 3.4)
- Call queries by restaurant/branch (`getCallsByRestaurant`, `getCallsByBranch`) continue to return correct results (Req 3.5)
- Valid, non-duplicate Paystack/Flutterwave webhooks with correct signatures continue to process, update payment status, and return 200 (Req 3.6)
- Normal voice call flow (restaurant verification → order building → completion) continues to work identically (Req 3.7)
- Requests within the 1000/min rate limit continue to receive the same `X-RateLimit-*` headers and pass through (Req 3.8)
- `upsertCallData` continues to use `by_call_and_order_id` index for lookups with same insert/update behavior (Req 3.9)
- `createOrderWithPayment` with WhatsApp opt-in continues to schedule confirmation messages and set initial statuses correctly (Req 3.10)

**Scope:**
All inputs that do NOT trigger any of the 13 fault conditions (C1–C13) should be completely unaffected by these fixes. This includes:
- Normal authenticated partner API calls with proper tenant scope
- Internal API calls with valid `x-api-key` in production
- Order/call queries that already use indexes (restaurant-scoped, branch-scoped)
- Single-instance deployments where in-memory rate limiting is sufficient
- Voice calls that follow the normal phase progression
- First-delivery webhook events (no duplicates)

## Hypothesized Root Cause

Based on the bug analysis, the root causes are:

1. **Type System Drift (C1)**: `types.ts` was written with `API`-prefixed names (`APIKey`, `APIScope`, `APIResponse`, `APIError`) while consumers were written assuming `Api`-prefixed names (`ApiKey`, `ApiKeyScope`, `ApiErrorResponse`, `ApiSuccessResponse`). Additionally, several types referenced by consumers (`ApiKeyValidationResult`, `RateLimitHeaders`, `ApiRequestContext`, `OAuthClient`, `OAuthAccessToken`, `OAuthTokenRequest`) are not exported from `types.ts` at all. The `RateLimitConfig` and `RateLimitStatus` interfaces in `types.ts` have different field names than what `rate-limiter.ts` expects (e.g., `remaining` vs computed from `currentCount`, `exceeded` vs `isLimited`).

2. **Fail-Open Auth Pattern (C2, C3)**: The `validateApiKey()` function in each internal-use route returns `true` when `INTERNAL_API_KEY` is undefined, regardless of `NODE_ENV`. The ws-server wrapper functions (`wrapperUpsertCallData`, `wrapperGetRestaurantDetails`, etc.) construct `fetch()` calls without including any `x-api-key` header, so once auth is enforced they would all fail with 401.

3. **Insufficient Order ID Entropy (C4, C5)**: `generateOrderId()` uses `otp-generator` to produce a 4-digit numeric string (10,000 possible values). The same value serves as both the internal primary key and the customer-facing reference. In `upsertOrders`, the `by_order_and_restaurant_id` composite index is used but only the first field (`orderId`) is passed to the query builder, so the `restaurantId` component is not constraining the lookup.

4. **Full-Table Scan Pattern (C6, C7)**: Six functions in `convex/orders.ts` (`getOrderByOrderId`, `updatePaymentStatus`, `recordCODPaymentCollection`, `recordCODPaymentFailure`, `updateOrderStatus`, `updateDeliveryStatus`) call `.query("orders").collect()` followed by `.find()` — a full-table scan. `updateCallASRData` in `convex/calls.ts` uses `.filter()` without `.withIndex()`, also scanning the entire table.

5. **Missing Tenant Authorization (C8)**: `validateApiRequest()` in `middleware.ts` validates the API key, checks scopes, and enforces rate limits, but never verifies that the authenticated partner's `restaurantIds` or `platformId` includes the resource being accessed. Each route handler trusts the `restaurantId` query parameter without ownership verification.

6. **Ephemeral Callback State (C9)**: `pendingCallbacks` is a plain `Map<string, CallbackContext>` in the ws-server process. It's keyed by phone number (race-prone with concurrent callbacks to the same number) and lost entirely on process restart or when running multiple instances.

7. **Single-Instance Rate Limiter (C10)**: `InMemoryRateLimiter` maintains request timestamps in a process-local `Map`. Multiple server instances each maintain independent counters, so a client can exceed the limit by distributing requests.

8. **Unguarded Tool Execution (C11)**: The ws-server's `response.function_call_arguments.done` handler dispatches tool calls via a `switch` statement with no phase validation. Tools like `upsert_order` can execute before `get_restaurant_details` has been called, and `generate_order_id` can be called multiple times.

9. **Unstructured Logging + Racy Idempotency (C12, C13)**: All logging uses `console.log`/`console.error` without correlation IDs. Webhook idempotency uses a query-then-insert pattern (`getWebhookEventByEventId` → `createWebhookEvent`) with no unique constraint on `eventId`, creating a TOCTOU race window.

## Correctness Properties

Property 1: Fault Condition — Type System Compiles Clean

_For any_ codebase state after applying the type normalization fix, running `npx tsc --noEmit` SHALL produce 0 type errors across all files that import from `@/lib/partner-api/types`.

**Validates: Requirements 2.1, 2.2**

Property 2: Fault Condition — Internal Auth Fails Closed in Production

_For any_ HTTP request to an internal-use route where `INTERNAL_API_KEY` is not set and `NODE_ENV !== "development"`, the handler SHALL return HTTP 500 with an error indicating misconfiguration and SHALL NOT execute the mutation.

**Validates: Requirements 2.3, 2.4**

Property 3: Fault Condition — ws-server Includes Auth Header

_For any_ HTTP request made by a ws-server wrapper function to an internal API route, the request SHALL include the `x-api-key` header with the value of `process.env.INTERNAL_API_KEY`.

**Validates: Requirements 2.4**

Property 4: Fault Condition — Order ID Entropy and Separation

_For any_ call to the order ID generation functions, the internal `orderId` SHALL have at least 12 characters of entropy (nanoid/ULID), and the `publicOrderCode` SHALL be a 6-character alphanumeric string unique within the restaurant scope. The two identifiers SHALL be distinct values serving different purposes.

**Validates: Requirements 2.5**

Property 5: Fault Condition — Tenant-Scoped Order Upsert

_For any_ call to `upsertOrders` with a given `orderId` and `restaurantId`, the index lookup SHALL use both fields of the `by_order_and_restaurant_id` composite index, ensuring orders from different restaurants with the same `orderId` do not collide.

**Validates: Requirements 2.6**

Property 6: Fault Condition — Index-Backed Single-Record Lookups

_For any_ call to `getOrderByOrderId`, `updatePaymentStatus`, `recordCODPaymentCollection`, `recordCODPaymentFailure`, `updateOrderStatus`, or `updateDeliveryStatus`, the query SHALL use the `by_order_and_restaurant_id` index with both `orderId` and `restaurantId` parameters. No `.collect()` followed by `.find()` pattern SHALL be used.

**Validates: Requirements 2.7, 4.1, 4.2, 4.3**

Property 7: Fault Condition — Indexed Call Lookup

_For any_ call to `updateCallASRData`, the query SHALL use the `by_call_and_order_id` index (or a dedicated `by_call_id` index) instead of `.filter()` without an index.

**Validates: Requirements 2.8**

Property 8: Fault Condition — Tenant Authorization Enforcement

_For any_ partner API request accessing a resource, the `authorizeResourceAccess(partnerId, resourceType, resourceId)` utility SHALL verify that the partner's `restaurantIds` or `platformId` includes the target resource's tenant, returning 403 if the check fails.

**Validates: Requirements 2.9**

Property 9: Fault Condition — Persistent Callback Context

_For any_ callback initiation, the callback context SHALL be stored in a persistent store (Convex table) keyed by a unique `callbackSessionId` (UUID), not by phone number. The context SHALL survive server restarts and be accessible across instances.

**Validates: Requirements 2.10**

Property 10: Fault Condition — Distributed Rate Limiting

_For any_ rate limit check across multiple server instances, the rate limiter SHALL use a distributed store (Upstash Redis sliding window) ensuring accurate counts. The `X-RateLimit-*` response headers SHALL remain consistent with the same semantics as the current implementation.

**Validates: Requirements 2.11**

Property 11: Fault Condition — Phase-Gated Tool Execution

_For any_ tool call received by the ws-server, the call phase state machine SHALL enforce that only allowed tools execute in the current phase. Tool calls outside their allowed phase SHALL be rejected with a structured error log and SHALL NOT produce side effects.

**Validates: Requirements 2.12**

Property 12: Fault Condition — Structured Logging with Correlation

_For any_ log event emitted by internal API routes, ws-server handlers, or webhook routes, the log entry SHALL be structured JSON with a correlation ID (`callId`, `requestId`, or `orderId`) attached.

**Validates: Requirements 2.13**

Property 13: Fault Condition — Atomic Webhook Idempotency

_For any_ webhook event processing, the idempotency guard SHALL be atomic: the handler attempts to insert the event record first, and if the insert fails due to a uniqueness violation on `eventId`, the handler SHALL return HTTP 200 with no side effects. Payment status updates SHALL only execute after successful event insertion.

**Validates: Requirements 2.14**

Property 14: Preservation — Existing Authenticated Flows Unchanged

_For any_ input where none of the bug conditions (C1–C13) hold — valid partner API calls, authenticated internal requests, normal voice call flows, first-delivery webhooks — the fixed system SHALL produce the same results as the original system.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

---

### Fix 1: Type System Normalization (P0)

**Files**: `src/lib/partner-api/types.ts`, `src/lib/partner-api/auth.ts`, `src/lib/partner-api/middleware.ts`, `src/lib/partner-api/rate-limiter.ts`, all partner route files

**Strategy**: Normalize `types.ts` exports to match the `Api`-prefixed convention used by all consumers, since consumers outnumber the source file. Add missing type exports.

**Specific Changes**:

1. **Rename exports in `types.ts`**:
   - `APIKey` → `ApiKey` (add `rateLimitOverride?: number` field to match consumer expectations in `middleware.ts`)
   - `APIKeyStatus` → `ApiKeyStatus`
   - `APIScope` → `ApiKeyScope` (rename from `APIScope` to match `auth.ts` imports)
   - `APIResponse<T>` → `ApiSuccessResponse<T>` (rename to match partner route imports)
   - `APIError` → `ApiErrorResponse` (rename to match partner route imports)
   - `APIUsageMetrics` → `ApiUsageMetrics`
   - `AccessToken` → `OAuthAccessToken`
   - `PartnerApplication` → `OAuthClient` (or add `OAuthClient` as an alias)

2. **Add missing type exports to `types.ts`**:
   ```typescript
   export interface ApiKeyValidationResult {
     valid: boolean;
     apiKey?: ApiKey;
     error?: string;
   }

   export interface ApiRequestContext {
     requestId: string;
     apiKey: ApiKey;
     partnerId: string;
     clientIp: string;
     timestamp: number;
   }

   export interface OAuthTokenRequest {
     grantType: OAuthGrantType;
     clientId: string;
     clientSecret: string;
     scope?: string;
   }

   export interface RateLimitHeaders {
     'X-RateLimit-Limit': string;
     'X-RateLimit-Remaining': string;
     'X-RateLimit-Reset': string;
   }
   ```

3. **Reconcile `RateLimitConfig` and `RateLimitStatus`**: The `types.ts` versions have different field names than what `rate-limiter.ts` uses internally. Normalize:
   - `RateLimitConfig`: Remove `slidingWindow` field (always true), keep `maxRequests` and `windowSeconds`
   - `RateLimitStatus`: Use `currentCount`, `maxRequests`, `resetInSeconds`, `isLimited` (matching `rate-limiter.ts` internal usage)

4. **Update `DEFAULT_RATE_LIMIT` export**: Currently `types.ts` exports it as a `RateLimitConfig` object while `auth.ts` exports it as a number (`1000`). Consolidate: `types.ts` exports the config object, `auth.ts` exports the numeric constant.

---

### Fix 2: Internal Auth Hardening (P0)

**Files**: All 7 internal-use route files in `src/app/client/api/v1/(internal-use)/*/route.ts`

**Strategy**: Extract `validateApiKey()` into a shared utility. Make it fail-closed in non-development environments.

**Specific Changes**:

1. **Create `src/lib/internal-auth.ts`**:
   ```typescript
   import { NextRequest } from "next/server";

   export function validateInternalApiKey(request: NextRequest): {
     valid: boolean;
     error?: string;
     statusCode?: number;
   } {
     const apiKey = request.headers.get("x-api-key");
     const expectedKey = process.env.INTERNAL_API_KEY;

     // Development mode: allow if no key configured
     if (!expectedKey && process.env.NODE_ENV === "development") {
       return { valid: true };
     }

     // Production/staging: fail-closed if key not configured
     if (!expectedKey) {
       return {
         valid: false,
         error: "Server misconfiguration: INTERNAL_API_KEY not set",
         statusCode: 500,
       };
     }

     // Validate the provided key
     if (!apiKey || apiKey !== expectedKey) {
       return { valid: false, error: "Unauthorized", statusCode: 401 };
     }

     return { valid: true };
   }
   ```

2. **Update all 7 internal-use route handlers** to import and use `validateInternalApiKey()` instead of the inline `validateApiKey()`.

3. **Update ws-server wrapper functions** to include the `x-api-key` header:
   ```typescript
   const INTERNAL_HEADERS = {
     "Content-Type": "application/json",
     "x-api-key": process.env.INTERNAL_API_KEY || "",
   };
   ```
   Apply to all `fetch()` calls in `wrapperUpsertCallData`, `wrapperAddTranscriptDialogues`, `wrapperUpsertOrders`, `wrapperGetRestaurantDetails`, `wrapperMatchUpsellPrompts`, `wrapperRecordPromptAcceptance`, `wrapperCheckBlocked`.

---

### Fix 3: Split Order ID Design (P0)

**Files**: `src/app/ws-server/tools.ts`, `convex/schema.ts`, `convex/internal.ts`, `convex/orders.ts`, partner route handlers, dashboard components

**Strategy**: Replace the single 4-digit `orderId` with two identifiers: a high-entropy internal `orderId` and a human-readable `publicOrderCode`.

**Specific Changes**:

1. **New ID generation in `tools.ts`**:
   ```typescript
   import { nanoid } from "nanoid";

   export function generateOrderId(): string {
     return `ord_${nanoid(16)}`; // e.g., "ord_V1StGXR8_Z5jdHi6B"
   }

   export function generatePublicOrderCode(): string {
     // 6-char uppercase alphanumeric, ~2.18 billion combinations
     const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 for readability
     let code = "";
     for (let i = 0; i < 6; i++) {
       code += chars[Math.floor(Math.random() * chars.length)];
     }
     return code;
   }
   ```

2. **Schema update** — add `publicOrderCode` field to orders table:
   ```typescript
   publicOrderCode: v.optional(v.string()), // Optional for backward compat during migration
   ```
   Add index: `.index("by_public_order_code_and_restaurant", ["publicOrderCode", "restaurantId"])`

3. **Update `upsertOrders` args** to accept `publicOrderCode`.

4. **Update `generate_order_id` tool** in ws-server to return both `orderId` and `publicOrderCode`. The voice agent reads back the `publicOrderCode` to the customer.

5. **Update dashboard components** to display `publicOrderCode` where customers see it, while using `orderId` for all internal API calls.

---

### Fix 4: Index-Backed Query Migration (P0/P1)

**Files**: `convex/orders.ts`, `convex/calls.ts`, `convex/internal.ts`, `convex/schema.ts`

**Strategy**: Replace all `.collect().find()` patterns with `.withIndex()` queries. Add `restaurantId` as a required parameter to all single-order lookup functions.

**Specific Changes**:

1. **Add `by_order_id` index** to orders table for cases where only orderId is known (webhook handlers):
   ```typescript
   .index("by_order_id", ["orderId"])
   ```

2. **Rewrite 6 functions in `convex/orders.ts`** — all follow the same pattern:
   ```typescript
   // BEFORE (full-table scan):
   const orders = await ctx.db.query("orders").collect();
   const order = orders.find(o => o.orderId === args.orderId);

   // AFTER (index-backed):
   const order = await ctx.db
     .query("orders")
     .withIndex("by_order_and_restaurant_id", (q) =>
       q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
     )
     .unique();
   ```
   Functions to update: `getOrderByOrderId`, `updatePaymentStatus`, `recordCODPaymentCollection`, `recordCODPaymentFailure`, `updateOrderStatus`, `updateDeliveryStatus`.

3. **Add `restaurantId` as required arg** to all 6 functions. Update all call sites (webhook handlers, partner routes, dashboard) to pass `restaurantId`.

4. **Fix `upsertOrders` in `convex/internal.ts`** — pass both fields to the index:
   ```typescript
   const orderResponse = await ctx.db.query("orders")
     .withIndex("by_order_and_restaurant_id", (q) =>
       q.eq("orderId", orderId).eq("restaurantId", args.data.restaurantId)
     )
     .unique();
   ```

5. **Fix `updateCallASRData` in `convex/calls.ts`**:
   ```typescript
   // BEFORE:
   const call = await ctx.db.query("calls")
     .filter((q) => q.eq(q.field("callId"), args.callId))
     .first();

   // AFTER:
   const call = await ctx.db.query("calls")
     .withIndex("by_call_and_order_id", (q) => q.eq("callId", args.callId))
     .first();
   ```

---

### Fix 5: `authorizeResourceAccess()` Utility (P1)

**Files**: New file `src/lib/partner-api/authorization.ts`, all partner route handlers

**Strategy**: Create a single enforcement point for tenant authorization that every partner route calls after middleware auth.

**Specific Changes**:

1. **Create `src/lib/partner-api/authorization.ts`**:
   ```typescript
   import { ConvexHttpClient } from "convex/browser";
   import { api } from "../../../convex/_generated/api";

   type ResourceType = "restaurant" | "order" | "call" | "menu" | "branch";

   interface AuthorizationResult {
     authorized: boolean;
     error?: string;
   }

   export async function authorizeResourceAccess(
     convexClient: ConvexHttpClient,
     partnerId: string,
     resourceType: ResourceType,
     resourceId: string
   ): Promise<AuthorizationResult> {
     // Fetch partner record
     const partner = await convexClient.query(
       api.partners.getPartnerById, { partnerId }
     );

     if (!partner || !partner.isActive) {
       return { authorized: false, error: "Partner not found or inactive" };
     }

     // For restaurant resources, check direct ownership
     if (resourceType === "restaurant") {
       const owns = partner.restaurantIds?.includes(resourceId) ?? false;
       return owns
         ? { authorized: true }
         : { authorized: false, error: "Access denied: restaurant not owned by partner" };
     }

     // For sub-resources (order, call, menu, branch), resolve the parent restaurantId
     // then check ownership
     let parentRestaurantId: string | null = null;

     switch (resourceType) {
       case "branch": {
         const branch = await convexClient.query(
           api.branches.getBranchById, { branchId: resourceId }
         );
         parentRestaurantId = branch?.restaurantId ?? null;
         break;
       }
       case "order": {
         const order = await convexClient.query(
           api.orders.getOrderByOrderId, { orderId: resourceId }
         );
         parentRestaurantId = order?.restaurantId ?? null;
         break;
       }
       // ... similar for call, menu
     }

     if (!parentRestaurantId) {
       return { authorized: false, error: "Resource not found" };
     }

     const owns = partner.restaurantIds?.includes(parentRestaurantId) ?? false;
     return owns
       ? { authorized: true }
       : { authorized: false, error: "Access denied: resource not owned by partner" };
   }
   ```

2. **Update every partner route handler** to call `authorizeResourceAccess()` before any read/write:
   ```typescript
   const authResult = await authorizeResourceAccess(
     convexClient, context.partnerId, "restaurant", restaurantId
   );
   if (!authResult.authorized) {
     return NextResponse.json(
       { error: "Forbidden", message: authResult.error },
       { status: 403 }
     );
   }
   ```

---

### Fix 6: Persistent Callback Context Store (P2)

**Files**: `convex/schema.ts`, new `convex/callbackSessions.ts`, `src/app/ws-server/index.ts`

**Strategy**: Replace the in-memory `pendingCallbacks` Map with a Convex table. Key by a UUID `callbackSessionId` instead of phone number.

**Specific Changes**:

1. **Add `callbackSessions` table to schema**:
   ```typescript
   callbackSessions: defineTable({
     sessionId: v.string(),       // UUID generated at callback initiation
     phoneNumber: v.string(),
     reason: v.optional(v.string()),
     data: v.optional(v.string()),
     isCallback: v.boolean(),
     createdAt: v.number(),
     expiresAt: v.number(),       // TTL: createdAt + 5 minutes
     consumed: v.boolean(),       // Set true after media-stream-callback reads it
   })
     .index("by_session_id", ["sessionId"])
     .index("by_expires_at", ["expiresAt"]),
   ```

2. **Create `convex/callbackSessions.ts`** with mutations:
   - `createSession(sessionId, phoneNumber, reason, data)` — inserts with `expiresAt = Date.now() + 300_000`
   - `getAndConsumeSession(sessionId)` — reads by index, sets `consumed = true`, returns context
   - `cleanupExpiredSessions()` — scheduled job to delete expired rows

3. **Update `/callback` route** in ws-server:
   - Generate `callbackSessionId = crypto.randomUUID()`
   - Store context via Convex mutation instead of `pendingCallbacks.set()`
   - Pass `callbackSessionId` in the Twilio Stream URL: `wss://.../media-stream-callback?sessionId=${callbackSessionId}`

4. **Update `/media-stream-callback` route** to read context from Convex by `sessionId` instead of phone number.

5. **Remove `pendingCallbacks` Map** entirely.

---

### Fix 7: Distributed Rate Limiter (P2)

**Files**: `src/lib/partner-api/rate-limiter.ts`, new dependency `@upstash/ratelimit` + `@upstash/redis`

**Strategy**: Replace `InMemoryRateLimiter` with Upstash Redis sliding window. Maintain the same public API surface (`checkRateLimit`, `recordAndCheckRateLimit`, `getRateLimitHeaders`, `createRateLimitResponse`).

**Specific Changes**:

1. **Add dependencies**: `@upstash/ratelimit`, `@upstash/redis`

2. **Add env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

3. **Rewrite `rate-limiter.ts`**:
   ```typescript
   import { Ratelimit } from "@upstash/ratelimit";
   import { Redis } from "@upstash/redis";

   const redis = new Redis({
     url: process.env.UPSTASH_REDIS_REST_URL!,
     token: process.env.UPSTASH_REDIS_REST_TOKEN!,
   });

   const ratelimit = new Ratelimit({
     redis,
     limiter: Ratelimit.slidingWindow(1000, "60 s"),
     analytics: true,
     prefix: "partner-api",
   });

   export async function recordAndCheckRateLimit(
     apiKey: ApiKey
   ): Promise<RateLimitStatus> {
     const limit = apiKey.rateLimitOverride ?? DEFAULT_RATE_LIMIT;
     const { success, remaining, reset, limit: maxReqs } =
       await ratelimit.limit(apiKey.id);

     return {
       currentCount: maxReqs - remaining,
       maxRequests: limit,
       resetInSeconds: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
       isLimited: !success,
     };
   }
   ```

4. **Fallback**: If Upstash env vars are not set (local dev), fall back to the existing `InMemoryRateLimiter` with a console warning.

5. **Preserve response shape**: `getRateLimitHeaders()` and `createRateLimitResponse()` remain unchanged — they consume `RateLimitStatus` which keeps the same fields.

---

### Fix 8: Voice Agent State Machine (P3)

**Files**: `src/app/ws-server/index.ts`, new `src/app/ws-server/call-phase.ts`

**Strategy**: Introduce a deterministic state machine that gates tool execution by call phase.

**Specific Changes**:

1. **Create `src/app/ws-server/call-phase.ts`**:
   ```typescript
   export type CallPhase =
     | "await_restaurant_id"
     | "restaurant_verified"
     | "order_open"
     | "order_finalized";

   const ALLOWED_TOOLS: Record<CallPhase, Set<string>> = {
     await_restaurant_id: new Set(["get_restaurant_details"]),
     restaurant_verified: new Set([
       "upsert_call_data",
       "add_transcript_dialogue",
       "generate_order_id",
     ]),
     order_open: new Set([
       "upsert_order",
       "add_transcript_dialogue",
       "generate_order_id",
     ]),
     order_finalized: new Set(["add_transcript_dialogue"]),
   };

   export function isToolAllowed(phase: CallPhase, toolName: string): boolean {
     return ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
   }

   export function nextPhase(
     current: CallPhase,
     event: string
   ): CallPhase {
     switch (current) {
       case "await_restaurant_id":
         if (event === "restaurant_verified") return "restaurant_verified";
         break;
       case "restaurant_verified":
         if (event === "order_id_generated") return "order_open";
         break;
       case "order_open":
         if (event === "order_finalized") return "order_finalized";
         break;
     }
     return current; // No transition
   }
   ```

2. **Add phase tracking to each WebSocket connection** in `index.ts`:
   ```typescript
   let callPhase: CallPhase = "await_restaurant_id";
   ```

3. **Gate tool execution** in the `response.function_call_arguments.done` handler:
   ```typescript
   if (!isToolAllowed(callPhase, res.name)) {
     console.error(JSON.stringify({
       event: "tool_rejected",
       callId: callSid,
       phase: callPhase,
       tool: res.name,
       timestamp: Date.now(),
     }));
     output = { success: false, error: `Tool ${res.name} not allowed in phase ${callPhase}` };
   }
   ```

4. **Advance phase** after successful tool calls:
   - After `get_restaurant_details` succeeds → `callPhase = nextPhase(callPhase, "restaurant_verified")`
   - After `generate_order_id` succeeds → `callPhase = nextPhase(callPhase, "order_id_generated")`
   - After `upsert_order` with `status === "completed"` → `callPhase = nextPhase(callPhase, "order_finalized")`

---

### Fix 9: Structured Logging + Webhook Idempotency (P3)

**Files**: New `src/lib/logger.ts`, `convex/schema.ts`, `convex/webhookEvents.ts`, webhook route handlers, internal-use routes, ws-server

**Strategy**: Introduce a minimal structured logger and make webhook idempotency atomic.

**Specific Changes**:

1. **Create `src/lib/logger.ts`**:
   ```typescript
   type LogLevel = "info" | "warn" | "error" | "debug";

   interface LogContext {
     callId?: string;
     requestId?: string;
     orderId?: string;
     partnerId?: string;
     [key: string]: unknown;
   }

   export function createLogger(module: string) {
     return {
       info: (message: string, ctx?: LogContext) =>
         emit("info", module, message, ctx),
       warn: (message: string, ctx?: LogContext) =>
         emit("warn", module, message, ctx),
       error: (message: string, ctx?: LogContext) =>
         emit("error", module, message, ctx),
       debug: (message: string, ctx?: LogContext) =>
         emit("debug", module, message, ctx),
     };
   }

   function emit(level: LogLevel, module: string, message: string, ctx?: LogContext) {
     const entry = {
       level,
       module,
       message,
       timestamp: new Date().toISOString(),
       ...ctx,
     };
     if (level === "error") {
       console.error(JSON.stringify(entry));
     } else {
       console.log(JSON.stringify(entry));
     }
   }
   ```

2. **Replace `console.log`/`console.error`** calls in internal-use routes, ws-server handlers, and webhook routes with `createLogger()` calls, always passing the relevant correlation ID.

3. **Webhook idempotency — atomic insert-first strategy**:

   a. The `webhookEvents` table already has `by_event_id` index. Convex doesn't support unique constraints natively, so we use an atomic mutation that checks-and-inserts in a single transaction:

   ```typescript
   // convex/webhookEvents.ts
   export const atomicInsertWebhookEvent = mutation({
     args: { /* same as createWebhookEvent */ },
     handler: async (ctx, args) => {
       // Check within the same transaction
       const existing = await ctx.db
         .query("webhookEvents")
         .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
         .first();

       if (existing) {
         return { inserted: false, alreadyProcessed: existing.processed };
       }

       const id = await ctx.db.insert("webhookEvents", {
         ...args,
         createdAt: Date.now(),
       });
       return { inserted: true, id };
     },
   });
   ```

   b. Since Convex mutations are serialized (single-writer per document), this eliminates the TOCTOU race. The webhook handler calls `atomicInsertWebhookEvent` first — if `inserted === false`, return 200 immediately with no side effects.

   c. Update Paystack and Flutterwave route handlers to use this pattern:
   ```typescript
   const insertResult = await convexClient.mutation(
     api.webhookEvents.atomicInsertWebhookEvent,
     { eventId, provider: "paystack", eventType, payload, verified: true, processed: false }
   );
   if (!insertResult.inserted) {
     return NextResponse.json({ status: "already_processed" }, { status: 200 });
   }
   // Proceed with payment processing...
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing fixes. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that exercise each fault condition on the current unfixed codebase to observe failures and confirm root causes.

**Test Cases**:
1. **Type Compilation Test**: Run `npx tsc --noEmit` on the current codebase — expect type errors from `auth.ts`, `middleware.ts`, `rate-limiter.ts`, and partner routes importing non-existent types (will fail on unfixed code)
2. **Fail-Open Auth Test**: Set `NODE_ENV=production` with no `INTERNAL_API_KEY`, send POST to `/api/v1/upsert-order` — expect 200 instead of 401/500 (will fail on unfixed code)
3. **Order ID Collision Test**: Call `generateOrderId()` 1000 times, check for duplicates — expect collisions within ~100 calls given birthday paradox on 10,000 keyspace (will fail on unfixed code)
4. **Full-Table Scan Test**: Call `getOrderByOrderId` and measure query plan — expect `.collect()` pattern (will fail on unfixed code)
5. **Cross-Tenant Access Test**: Authenticate as Partner A, request orders for Restaurant B (not owned by A) — expect 200 instead of 403 (will fail on unfixed code)
6. **Webhook Race Test**: Send two identical webhook events concurrently — expect both to process (will fail on unfixed code)

**Expected Counterexamples**:
- TypeScript compiler produces errors for missing type exports
- Internal routes accept unauthenticated requests in production mode
- Order ID collisions occur within small sample sizes
- Partner API returns data for restaurants not owned by the authenticated partner

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT expectedBehavior(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSystem(input) = fixedSystem(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid authenticated requests, normal order flows, and webhook processing, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Partner API Preservation**: Verify that valid partner API calls with correct scopes and owned restaurants continue to return the same response shape and status codes after fixes
2. **Internal Auth Preservation**: Verify that requests with valid `x-api-key` in production and requests without key in development mode continue to work
3. **Order Query Preservation**: Verify that `getOrdersByRestaurant`, `getActiveOrdersByRestaurant`, and other index-backed queries return identical results after the full-table scan functions are rewritten
4. **Webhook Preservation**: Verify that valid, first-delivery webhooks with correct signatures continue to process payments and return 200
5. **Rate Limit Header Preservation**: Verify that `X-RateLimit-*` headers maintain the same semantics after migrating to distributed rate limiter

### Unit Tests

- Test `validateInternalApiKey()` with all combinations: key set + matching, key set + wrong, key unset + dev, key unset + production
- Test `generateOrderId()` produces strings matching `ord_` prefix with 16+ chars
- Test `generatePublicOrderCode()` produces 6-char alphanumeric strings with no ambiguous characters
- Test `authorizeResourceAccess()` with owned/unowned restaurants, inactive partners, missing resources
- Test `isToolAllowed()` for all phase × tool combinations
- Test `nextPhase()` state transitions for valid and invalid events
- Test `atomicInsertWebhookEvent` returns `{ inserted: false }` for duplicate eventIds
- Test `createLogger()` output format includes all required fields

### Property-Based Tests

- Generate random type import configurations and verify compilation succeeds after normalization
- Generate random order IDs and verify no collisions within restaurant scope across 10,000 generations
- Generate random partner × restaurant combinations and verify `authorizeResourceAccess` correctly allows/denies
- Generate random call phase × tool name pairs and verify `isToolAllowed` matches the specification
- Generate random rate limit request sequences and verify distributed limiter produces consistent headers
- Generate random webhook event sequences (including duplicates) and verify exactly-once processing

### Integration Tests

- End-to-end test: voice call flow through all 4 phases with tool gating
- End-to-end test: partner API authentication → authorization → data access with tenant isolation
- End-to-end test: webhook delivery → idempotent processing → payment status update
- End-to-end test: callback initiation → persistent context storage → media-stream-callback retrieval
- End-to-end test: concurrent order creation across restaurants with new ID scheme
- End-to-end test: rate limiting across simulated multi-instance deployment
