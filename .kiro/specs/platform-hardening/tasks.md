# Implementation Plan: Platform Hardening

## Overview

Incremental hardening of the Dinee platform across schema, authorization, idempotency, masking, voice tooling, webhooks, audit logging, and QA. Each task builds on the previous, starting with schema/data layer changes and ending with regression tests and operational docs. All code is TypeScript targeting the existing Next.js 15 + Convex stack.

## Tasks

- [x] 1. Schema changes and index additions
  - [x] 1.1 Add `status` field to `idempotencyKeys` table in `convex/schema.ts`
    - Add `status: v.optional(v.union(v.literal("success"), v.literal("failed")))` to the idempotencyKeys table definition
    - Existing records without `status` are treated as `"success"` for backward compatibility
    - _Requirements: 3.8, 3.9, 7.1_

  - [x] 1.2 Add `correlationId` fields to `calls`, `shipmentEvents`, and `transcripts` tables in `convex/schema.ts`
    - Add `correlationId: v.optional(v.string())` to each table
    - Include code comments referencing Req 17.7, 17.8, 17.9
    - _Requirements: 17.7, 17.8, 17.9, 7.1, 7.4_

  - [x] 1.3 Add `by_next_retry_at` index to `webhookDeliveries` table and `by_org_and_status` composite index to `shipments` table in `convex/schema.ts`
    - `webhookDeliveries`: add index `by_next_retry_at` on `["nextRetryAt"]`
    - `shipments`: add index `by_org_and_status` on `["organizationId", "deliveryStatus"]`
    - _Requirements: 20.8, 13.4, 5.1_

  - [x] 1.4 Add `resourceType`, `resourceId`, and `shipmentId` fields to `webhookEvents` table in `convex/schema.ts`
    - `resourceType: v.optional(v.union(v.literal("order"), v.literal("shipment")))`
    - `resourceId: v.optional(v.string())`
    - `shipmentId: v.optional(v.string())` with `by_shipment_id` index
    - _Requirements: 6.1, 6.2, 6.3, 7.1_

  - [x] 1.5 Verify all logistics indexes are defined in `convex/schema.ts`
    - Confirm indexes on `shipments`: by_shipment_id, by_tracking_code, by_organization_id, by_delivery_status, by_assigned_rider_id
    - Confirm indexes on `riders`: by_rider_id, by_organization_id, by_status
    - Confirm indexes on `shipmentEvents`: by_shipment_id, by_event_type
    - Confirm indexes on `organizations`: by_organization_id, by_platform_id, by_vertical
    - Confirm indexes on `locations`: by_location_id, by_organization_id, by_city_state
    - Confirm indexes on `idempotencyKeys`: by_key_partner, by_expires_at
    - Add any missing indexes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 2. Checkpoint - Ensure schema changes are valid
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Idempotency layer with failed-state recovery
  - [x] 3.1 Update `convex/logistics/idempotencyKeys.ts` to support `status` field
    - Update `storeIdempotencyKey` mutation to accept and persist `status` field
    - Update `checkIdempotencyKey` query to return `status` field
    - Default missing `status` to `"success"` for backward compatibility
    - _Requirements: 3.3, 3.8, 3.9, 7.5_

  - [x] 3.2 Update `src/lib/logistics/idempotency.ts` with failed-state recovery
    - Add `IdempotencyFailed` type to `IdempotencyCheckResult` union
    - Update `checkIdempotency` to return `{ failed: true }` when stored status is `"failed"`
    - Add `storeIdempotencyFailure` function to store failed state with error details
    - _Requirements: 3.8, 3.9_

  - [ ]* 3.3 Write property test for idempotency replay consistency
    - **Property 1: Idempotency Replay Consistency**
    - Generate arbitrary valid payloads, execute once, replay with same key + body, assert status and body match
    - **Validates: Requirements 3.4**

  - [ ]* 3.4 Write property test for idempotency key partner isolation
    - **Property 2: Idempotency Key Partner Isolation**
    - Same key for different partners must not collide
    - **Validates: Requirements 3.6**

  - [ ]* 3.5 Write property test for failed idempotency re-execution
    - **Property 3: Failed Idempotency Re-execution**
    - Force mutation failure, verify failed state stored, retry with same key, verify re-execution
    - **Validates: Requirements 3.8, 3.9**

- [x] 4. Audit logger enhancement
  - [x] 4.1 Extend `LogContext` interface in `src/lib/logger.ts`
    - Add fields: `correlationId`, `tenantId`, `vertical`, `endpoint`, `method`, `resourceId`
    - Ensure `createLogger` passes these fields through to structured JSON output
    - _Requirements: 4.1, 4.2, 4.3, 4.7, 17.10_

- [x] 5. Tenant isolation cross-validation
  - [x] 5.1 Verify and document `authorizeLogisticsAccess` in `src/lib/logistics/authorization.ts`
    - Confirm existing function validates partner → platform → organization ownership chain
    - Ensure all logistics route handlers pass `X-Tenant-Id` header value as the `organizationId` parameter
    - Add documentation comments explaining cross-validation behavior
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.2 Update logistics route handlers to enforce `X-Tenant-Id` header
    - Verify all six logistics endpoints require `X-Tenant-Id` header and return 400 if missing
    - Verify all endpoints call `authorizeLogisticsAccess()` before business logic
    - Endpoints: POST/GET shipments, GET shipment by id, POST assign, POST status, POST rider status
    - _Requirements: 2.1, 2.5, 2.6_

- [x] 6. `maskShipmentForPublic` utility
  - [x] 6.1 Implement `maskShipmentForPublic` in `src/lib/logistics/masking.ts`
    - Replace existing masking helpers with `maskShipmentForPublic(shipment: ShipmentDoc): PublicTrackingResponse`
    - Construct new object with only allowed fields: trackingCode, deliveryStatus, serviceType, etaMinutes (optional), lastEventTimestamp (optional)
    - Export `PublicTrackingResponse` type
    - _Requirements: 12.1, 12.2, 12.6, 12.7, 12.8, 12.9_

  - [x] 6.2 Update public tracking route to use `maskShipmentForPublic`
    - Update `src/app/client/api/v1/logistics/track/[trackingCode]/route.ts` to use the new utility
    - Ensure 404 response for invalid tracking codes uses generic message
    - _Requirements: 12.3, 12.4, 12.6_

  - [ ]* 6.3 Write property test for PII field removal
    - **Property 6: PII Field Removal**
    - Generate arbitrary ShipmentDoc objects, apply maskShipmentForPublic, assert forbidden keys absent and retained keys present
    - **Validates: Requirements 12.7, 12.8**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Call-phase tool matrix
  - [x] 8.1 Update `ALLOWED_TOOLS` map in `src/app/ws-server/logistics-call-phase.ts`
    - Update to cumulative matrix: await_org_verification (get_organization_details only), org_verified (+ create_shipment, quote_delivery), shipment_open (+ update_shipment, assign_rider, add_shipment_event), shipment_confirmed (get_organization_details, quote_delivery — read-only only)
    - Ensure `isLogisticsToolAllowed` function checks against the updated map
    - Log violations at "warn" level
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.8_

  - [ ]* 8.2 Write property test for call-phase tool gating
    - **Property 7: Call-Phase Tool Gating**
    - For each of 4 phases × all tool names, assert isLogisticsToolAllowed matches the reference matrix
    - **Validates: Requirements 14.8**

- [x] 9. Correlation ID propagation
  - [x] 9.1 Add `generateCorrelationId` to `src/lib/logistics/correlation.ts`
    - Implement `generateCorrelationId()` returning `voice-${randomUUID()}`
    - Keep existing `getOrCreateRequestId` unchanged
    - _Requirements: 17.1, 17.6_

  - [x] 9.2 Generate correlationId on voice session start in `src/app/ws-server/index.ts`
    - Call `generateCorrelationId()` when a new voice call session is established
    - Pass correlationId to all tool calls during the session
    - Store correlationId on the `calls` table record
    - _Requirements: 17.1, 17.2, 17.7_

  - [x] 9.3 Propagate correlationId to shipment events, transcripts, and audit logs
    - Include correlationId in all `shipmentEvents` created by voice tool calls
    - Include correlationId in all transcript entries during the session
    - Include correlationId in all audit log entries during voice tool execution
    - _Requirements: 17.3, 17.4, 17.8, 17.9, 17.10_

  - [x] 9.4 Propagate correlationId to webhook payloads
    - Voice-originated webhooks: set both `requestId` (= correlationId) and `correlationId`
    - API-originated webhooks: set `requestId` only, no `correlationId` field
    - Update `src/lib/logistics/webhook-dispatch.ts`
    - _Requirements: 17.5, 17.11, 17.12_

  - [ ]* 9.5 Write property test for correlation ID propagation
    - **Property 8: Correlation ID Propagation**
    - Simulate a voice session, collect all created records, assert all correlationId values are identical and non-null
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 9.6 Write property test for voice vs API webhook payload distinction
    - **Property 14: Voice vs API Webhook Payload Distinction**
    - Trigger webhooks from both voice and API paths, assert field presence/absence per origin
    - **Validates: Requirements 17.11, 17.12**

- [x] 10. Voice tool retry wrapper
  - [x] 10.1 Implement `withRetry` wrapper in `src/app/ws-server/logistics-tools.ts`
    - Add `isTransientError` function checking for network, timeout, mutation conflict patterns
    - Add `withRetry<T>` function with max 2 retries, exponential backoff (1s, 3s)
    - Log retry attempts at "warn" level, final failures at "error" level
    - Do not retry validation errors (non-transient)
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [x] 10.2 Wrap all logistics voice tool calls with `withRetry`
    - Apply to: create_shipment, update_shipment, assign_rider, add_shipment_event, quote_delivery, get_organization_details
    - Return graceful error message to Voice_Agent on final failure
    - _Requirements: 16.5, 16.2_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Webhook HMAC-SHA256 signing
  - [x] 12.1 Implement `signWebhookPayload` in `src/lib/partner-api/webhook-service.ts`
    - Compute HMAC-SHA256 of `${timestamp}.${body}` using subscriber's webhook secret
    - Add `X-Webhook-Signature` and `X-Webhook-Timestamp` headers to outbound deliveries
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [ ]* 12.2 Write property test for webhook signature round-trip
    - **Property 9: Webhook Signature Verification Round-Trip**
    - Generate arbitrary secrets, timestamps, and JSON bodies; sign; recompute independently; assert match
    - **Validates: Requirements 21.4**

- [x] 13. Webhook retry cron scheduler
  - [x] 13.1 Add `processRetries` internal mutation to `convex/webhookDeliveries.ts`
    - Query `webhookDeliveries` using `by_next_retry_at` index for deliveries where `nextRetryAt <= now` and `success == false`
    - Batch limit of 50 per tick
    - On success: set `success=true`, update `lastAttemptAt`
    - On failure: increment `attemptCount`, compute next backoff (30s, 2m, 10m, 1h, 6h)
    - If `attemptCount >= 5`: set `nextRetryAt=null` (dead-letter)
    - Log each attempt at "info" level
    - _Requirements: 20.1, 20.2, 20.3, 20.6, 20.7, 20.8_

  - [x] 13.2 Register cron job in `convex/crons.ts`
    - Add 60-second interval cron calling `internal.webhookDeliveries.processRetries`
    - _Requirements: 20.7_

  - [x] 13.3 Add dead-letter and stats queries to `convex/webhookDeliveries.ts`
    - Add query to retrieve dead-letter deliveries filtered by subscriptionId and time range
    - Add query to retrieve delivery statistics (total, successful, failed, dead-letter count) per partner
    - _Requirements: 20.4, 20.5_

- [x] 14. Atomic webhook event insertion
  - [x] 14.1 Update `atomicInsertWebhookEvent` mutation to accept and persist `resourceType`, `resourceId`, `shipmentId`
    - Ensure check-and-insert within single Convex mutation using `by_event_id` index
    - Return `{ inserted: false, alreadyProcessed }` on duplicate, `{ inserted: true, id }` on new
    - Skip subscriber delivery when `inserted: false`
    - Log duplicate attempts at "warn" level
    - _Requirements: 6.4, 6.5, 6.6, 19.1, 19.2, 19.3, 19.4, 19.5_

  - [ ]* 14.2 Write property test for atomic webhook deduplication
    - **Property 10: Atomic Webhook Deduplication**
    - Insert same eventId twice, assert first returns `inserted: true`, second returns `inserted: false`, table has exactly one record
    - **Validates: Requirements 19.1, 19.2**

- [x] 15. Webhook payload contract standardization
  - [x] 15.1 Update webhook dispatch to include standardized payload fields
    - Ensure all logistics webhook payloads include: eventId, eventType, resourceType ("shipment"), resourceId, shipmentId, timestamp, requestId
    - Include `data` object with event-specific details per event type
    - `shipment.status_updated` data: oldStatus, newStatus, failureReason (when applicable)
    - `shipment.assigned` data: riderId, shipmentId
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 15.2 Write property test for webhook payload contract completeness
    - **Property 13: Webhook Payload Contract Completeness**
    - Trigger various webhook events, assert all required fields present and non-null
    - **Validates: Requirements 18.1**

- [x] 16. Idempotency failed-state handling in route handlers
  - [x] 16.1 Update shipment creation route to handle failed idempotency state
    - In `src/app/client/api/v1/logistics/shipments/route.ts`, handle `IdempotencyFailed` result by re-executing the mutation
    - Add audit logging with tenantId, vertical, endpoint, method, resourceId
    - _Requirements: 3.8, 3.9, 4.1, 4.2, 4.4, 4.5, 4.6_

  - [x] 16.2 Update assign and status routes to handle failed idempotency state
    - Apply same failed-state handling pattern to assign and status update routes
    - Add audit logging to both routes
    - _Requirements: 3.8, 3.9, 4.1_

- [x] 17. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Regression test suite
  - [ ]* 18.1 Write restaurant API regression tests in `tests/regression/restaurant-api.test.ts`
    - Test all existing restaurant API endpoints verifying unchanged response schemas
    - Verify no logistics changes break restaurant functionality
    - _Requirements: 22.1, 22.7_

  - [ ]* 18.2 Write logistics API regression tests in `tests/regression/logistics-api.test.ts`
    - Test all logistics endpoints: correct status codes, response shapes, error handling
    - Test tenant isolation: partner accessing resources outside their org scope receives 403
    - Test idempotency: duplicate requests return stored response
    - Test status transition enforcement: invalid transitions return 422
    - Test public tracking endpoint returns PII-stripped responses
    - _Requirements: 22.2, 22.3, 22.4, 22.5, 22.6_

  - [ ]* 18.3 Write property test for status transition validity
    - **Property 4: Status Transition Validity**
    - Enumerate all 49 (7×7) status pairs, assert validateTransition matches the reference map exactly
    - **Validates: Requirements 11.1**

  - [ ]* 18.4 Write property test for terminal state immutability
    - **Property 5: Terminal State Immutability**
    - For terminal states "delivered" and "cancelled", assert all transitions return false
    - **Validates: Requirements 11.3**

  - [ ]* 18.5 Write property test for validation error completeness
    - **Property 12: Validation Error Completeness**
    - Generate requests with varying missing fields, assert error count matches missing field count
    - **Validates: Requirements 9.5**

  - [ ]* 18.6 Write property test for request ID propagation in audit logs
    - **Property 11: Request ID Propagation in Audit Logs**
    - Make requests with known X-Request-Id values, assert all audit log entries contain the expected requestId
    - **Validates: Requirements 4.7**

- [ ] 19. Staging smoke script
  - [ ]* 19.1 Create staging smoke script at `scripts/smoke-staging.ts`
    - Execute full shipment lifecycle: create → assign → picked_up → in_transit → delivered
    - Execute failure path: create → assign → picked_up → in_transit → failed
    - Verify webhook events dispatched for each status transition
    - Verify idempotency by replaying create request
    - Verify public tracking endpoint at each lifecycle stage
    - Verify rider status transitions through assignment cycle
    - Report pass/fail with timing information
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_

- [x] 20. Operational documentation
  - [x] 20.1 Create production runbook at `docs/runbook-hardening.md`
    - Pre-deployment checklist: feature flag states, index verification, env var validation
    - Deployment steps: schema → API routes → ws-server → feature flag enablement
    - Health check endpoints and expected responses
    - Rollback steps: flag disablement, code revert, data integrity verification
    - Monitoring dashboards and alert thresholds
    - Escalation contacts and communication channels
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

  - [x] 20.2 Create webhook verification guide at `docs/webhook-verification.md`
    - Document HMAC-SHA256 verification algorithm
    - Document header names: X-Webhook-Signature, X-Webhook-Timestamp
    - Include example verification code in TypeScript, Python, and Go
    - _Requirements: 21.5_

- [x] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after major milestones
- Property tests validate universal correctness properties from the design document
- All new fields on existing tables use `v.optional()` per Req 7.1 to avoid breaking existing data
- The design uses TypeScript throughout, matching the existing codebase
