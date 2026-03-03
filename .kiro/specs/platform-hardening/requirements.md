# Requirements Document

## Introduction

This document defines the requirements for hardening the Dinee restaurant call management platform across six domains: Platform/Core, Data/Schema, Logistics APIs, Voice/Realtime, Webhooks/Integration, and QA/Release. The hardening effort addresses security gaps, data integrity risks, operational observability shortfalls, and release readiness concerns identified during the logistics vertical buildout. All changes are non-breaking: existing restaurant workflows, API contracts, and voice agent behavior remain unchanged. The scope covers feature flag finalization, tenant isolation enforcement, idempotency mandates, audit logging, schema index verification, webhook contract standardization, voice tool resilience, and end-to-end regression coverage.

## Glossary

- **Platform**: The top-level multi-tenant entity managing multiple Organizations across verticals
- **Tenant**: Any scoped entity (Platform, Organization, Restaurant, Branch) that owns data
- **Feature_Flag**: A runtime toggle controlling feature availability per scope (global, platform, restaurant, branch)
- **X-Tenant-Id**: HTTP header identifying the target tenant for multi-tenant API operations
- **Partner**: A third-party integrator authenticated via API key or OAuth credentials
- **Idempotency_Key**: A client-supplied unique token ensuring write operations produce the same result on retry
- **Audit_Log**: A structured, append-only record of system operations including requestId, tenantId, and resourceId
- **Correlation_ID**: A unique requestId propagated across API, Convex mutations, voice tools, and webhook dispatches for end-to-end tracing
- **Shipment**: The primary logistics entity representing a parcel moving from sender to recipient
- **Tracking_Code**: A human-facing alphanumeric code (LG + 8 chars) used by customers to track a Shipment
- **Delivery_Status**: The lifecycle state of a Shipment: created, assigned, picked_up, in_transit, delivered, failed, cancelled
- **Status_Transition**: A validated change from one Delivery_Status to another per the state machine rules
- **Voice_Agent**: The AI-powered phone agent handling inbound and outbound calls via the ws-server
- **Call_Phase**: A state gate in the ws-server controlling which voice tools are available during a conversation
- **Tool_Pack**: A set of backend functions available to the Voice_Agent during a specific conversation type
- **Webhook_Event**: An event record dispatched to partner-registered callback URLs
- **Webhook_Delivery**: A record tracking each attempt to deliver a Webhook_Event to a subscriber endpoint
- **Dead_Letter**: A Webhook_Delivery that has exhausted all retry attempts without successful delivery
- **PII**: Personally Identifiable Information including names, phone numbers, and addresses
- **Convex**: The real-time backend database and API layer used by the application
- **Runbook**: An operational document describing deployment steps, health checks, and rollback procedures
- **Smoke_Test**: An automated script validating a critical end-to-end workflow in a staging environment
- **Regression_Suite**: A collection of tests verifying that existing functionality remains unchanged after new code is deployed

## Requirements

### Requirement 1: Logistics Feature Flag Finalization

**User Story:** As a platform administrator, I want logistics feature flags finalized per platform and tenant scope, so that logistics functionality can be safely enabled or disabled without code deployments.

#### Acceptance Criteria

1. THE Feature_Flag_System SHALL define a `logistics_api_enabled` flag with scope levels: global, platform, restaurant, and branch
2. THE Feature_Flag_System SHALL define a `logistics_voice_enabled` flag controlling logistics voice agent tool availability per platform
3. THE Feature_Flag_System SHALL define a `logistics_webhooks_enabled` flag controlling logistics webhook dispatch per platform
4. WHEN a logistics API request is received, THE System SHALL check the `logistics_api_enabled` flag for the requesting tenant's platform before processing
5. WHEN a flag is not explicitly set at a narrower scope, THE Feature_Flag_System SHALL inherit the value from the next broader scope (branch → restaurant → platform → global)
6. THE Feature_Flag_System SHALL record the `setBy` user identifier and `reason` text on every flag change for audit purposes
7. IF a logistics feature flag is disabled for a platform, THEN THE System SHALL return a 403 Forbidden response with a descriptive message indicating the feature is not enabled

### Requirement 2: Tenant Isolation on Logistics Routes

**User Story:** As a platform administrator, I want all logistics API routes to enforce X-Tenant-Id and partner scope checks, so that no partner can access resources belonging to another organization.

#### Acceptance Criteria

1. THE System SHALL require the `X-Tenant-Id` header on all authenticated logistics API endpoints: `POST /api/v1/logistics/shipments`, `GET /api/v1/logistics/shipments`, `GET /api/v1/logistics/shipments/{shipmentId}`, `POST /api/v1/logistics/shipments/{shipmentId}/assign`, `POST /api/v1/logistics/shipments/{shipmentId}/status`, and `POST /api/v1/logistics/riders/{riderId}/status`
2. WHEN an authenticated logistics request is received, THE System SHALL call `authorizeLogisticsAccess()` to verify the partner → platform → organization ownership chain before executing any business logic
3. WHEN a partner requests a Shipment belonging to an Organization the partner does not own, THE System SHALL return a 403 Forbidden response
4. WHEN a partner requests a Rider belonging to an Organization the partner does not own, THE System SHALL return a 403 Forbidden response
5. WHEN the `X-Tenant-Id` header is missing on an authenticated logistics endpoint, THE System SHALL return a 400 Bad Request response with a message indicating the header is required
6. THE System SHALL apply `authorizeLogisticsAccess()` consistently across all logistics route handlers to prevent authorization drift between routes
7. WHEN an authenticated logistics request is received, THE System SHALL cross-validate the X-Tenant-Id header value against the authenticated partner's ownership chain (partner → platform → organization) and reject requests where the header value does not match the partner's authorized scope with a 403 Forbidden response

### Requirement 3: Mandatory Idempotency for Write Endpoints

**User Story:** As a third-party integrator, I want all logistics write endpoints to enforce idempotency keys, so that network retries cannot create duplicate shipments or trigger duplicate side effects.

#### Acceptance Criteria

1. THE System SHALL require the `X-Idempotency-Key` header on `POST /api/v1/logistics/shipments`, `POST /api/v1/logistics/shipments/{shipmentId}/assign`, and `POST /api/v1/logistics/shipments/{shipmentId}/status`
2. WHEN the `X-Idempotency-Key` header is missing on a write endpoint, THE System SHALL return a 400 Bad Request response with a message indicating the header is required
3. WHEN an `X-Idempotency-Key` is provided, THE System SHALL store the key, request body hash, response status, and response body after the first successful processing
4. WHEN a subsequent request arrives with a previously seen `X-Idempotency-Key` and matching request body hash, THE System SHALL return the stored response without re-executing the mutation
5. IF an `X-Idempotency-Key` is reused with a different request body hash, THEN THE System SHALL return a 422 Unprocessable Entity response indicating a key mismatch
6. THE System SHALL scope idempotency keys to the authenticated partnerId to prevent cross-tenant key collisions
7. THE System SHALL expire stored idempotency records after 24 hours
8. WHEN a mutation fails after partial side effects but before the idempotency response is stored, THE System SHALL store a "failed" idempotency state with the error details, the original key, and the request hash
9. WHEN a subsequent request arrives with an idempotency key that has a stored "failed" state, THE System SHALL re-execute the mutation rather than returning the failed state

### Requirement 4: Operational Audit Logging

**User Story:** As a platform operator, I want structured audit logs emitted for all logistics write operations, so that issues can be investigated with full context including requestId, tenantId, and resourceId.

#### Acceptance Criteria

1. THE System SHALL emit a structured audit log entry for every logistics write operation (shipment creation, rider assignment, status update, rider heartbeat)
2. THE Audit_Log entry SHALL include minimum fields: timestamp, level, requestId, tenantId, vertical, endpoint, method, and resourceId
3. THE System SHALL use the `createLogger` utility from `src/lib/logger.ts` for all audit log emissions
4. WHEN a logistics write operation succeeds, THE System SHALL log at "info" level with the operation result summary
5. WHEN a logistics write operation fails due to validation or authorization, THE System SHALL log at "warn" level with the rejection reason
6. WHEN a logistics write operation fails due to an unexpected error, THE System SHALL log at "error" level with the error message and stack trace
7. THE System SHALL propagate the requestId from the `X-Request-Id` header (or auto-generated value) into every audit log entry for the request lifecycle

### Requirement 5: Logistics Index Verification and Usage

**User Story:** As a platform operator, I want all logistics database indexes verified as defined and actively used by queries, so that query performance remains predictable under production load.

#### Acceptance Criteria

1. THE Schema SHALL define indexes on the `shipments` table: by_shipment_id, by_tracking_code, by_organization_id, by_delivery_status, by_assigned_rider_id
2. THE Schema SHALL define indexes on the `riders` table: by_rider_id, by_organization_id, by_status
3. THE Schema SHALL define indexes on the `shipmentEvents` table: by_shipment_id, by_event_type
4. THE Schema SHALL define indexes on the `organizations` table: by_organization_id, by_platform_id, by_vertical
5. THE Schema SHALL define indexes on the `locations` table: by_location_id, by_organization_id, by_city_state
6. THE Schema SHALL define indexes on the `idempotencyKeys` table: by_key_partner, by_expires_at
7. WHEN querying shipments by organizationId, THE System SHALL use the `by_organization_id` index via `.withIndex()` rather than `.filter()`
8. WHEN querying shipments by trackingCode, THE System SHALL use the `by_tracking_code` index via `.withIndex()`
9. WHEN querying shipments by deliveryStatus, THE System SHALL use the `by_delivery_status` index via `.withIndex()`

### Requirement 6: Webhook Event Schema Completeness

**User Story:** As a platform operator, I want all webhook events to carry resourceType, resourceId, and shipmentId fields, so that webhook consumers can reliably identify the resource associated with each event.

#### Acceptance Criteria

1. THE Schema SHALL define `resourceType` as a required field on new webhook event records with values "order" or "shipment"
2. THE Schema SHALL define `resourceId` as a required field on new webhook event records containing the orderId or shipmentId
3. THE Schema SHALL define `shipmentId` as an optional field on the `webhookEvents` table indexed by `by_shipment_id`
4. WHEN a logistics webhook event is created, THE System SHALL populate shipmentId, set resourceType to "shipment", and set resourceId to the shipmentId value
5. WHEN a restaurant webhook event is created, THE System SHALL populate orderId, set resourceType to "order", and set resourceId to the orderId value
6. THE `atomicInsertWebhookEvent` mutation SHALL accept and persist resourceType, resourceId, and shipmentId fields

### Requirement 7: Migration Guardrails for Optional Fields

**User Story:** As a platform operator, I want migration guardrails when adding optional fields to existing restaurant tables, so that schema changes do not break existing data or queries.

#### Acceptance Criteria

1. WHEN adding a new optional field to an existing table (restaurants, orders, calls, menuItems), THE System SHALL define the field using `v.optional()` in the Convex schema
2. THE System SHALL verify that all existing queries on modified tables continue to function when the new optional field is absent from existing records
3. THE System SHALL verify that all existing mutations on modified tables do not require the new optional field
4. WHEN a new optional field is added, THE System SHALL include a code comment referencing the requirement or spec that introduced the field
5. IF a migration adds a field that existing code paths read, THEN THE System SHALL provide a default value fallback in the reading code path

### Requirement 8: Uniqueness Strategy Under Concurrency

**User Story:** As a platform operator, I want shipmentId and trackingCode uniqueness enforced at the transaction level, so that concurrent write requests cannot create duplicate records.

#### Acceptance Criteria

1. THE `createShipment` mutation SHALL perform an atomic check-and-insert within a single Convex mutation transaction for both shipmentId and trackingCode
2. WHEN a duplicate shipmentId is detected during the atomic transaction, THE System SHALL throw an error with message prefix "409:" indicating the shipmentId conflict
3. WHEN a generated trackingCode collides with an existing record, THE System SHALL retry generation up to 5 times within the same mutation transaction
4. IF all 5 trackingCode generation attempts collide, THEN THE System SHALL throw an error with message prefix "409:" indicating the trackingCode conflict
5. THE System SHALL apply the same atomic check-and-insert pattern for riderId, organizationId, locationId, and eventId creation mutations
6. THE uniqueness checks and inserts SHALL execute within the same Convex mutation to prevent time-of-check-to-time-of-use race conditions

### Requirement 9: Shipment Creation Validation and Conflict Handling

**User Story:** As a third-party integrator, I want the shipment creation endpoint to validate all required fields and return clear conflict errors, so that I can handle creation failures programmatically.

#### Acceptance Criteria

1. THE `POST /api/v1/logistics/shipments` endpoint SHALL validate that sender object contains required fields: name, phone, address, city, state
2. THE `POST /api/v1/logistics/shipments` endpoint SHALL validate that recipient object contains required fields: name, phone, address, city, state
3. THE `POST /api/v1/logistics/shipments` endpoint SHALL validate that parcel object contains required fields: type, weightKg
4. THE `POST /api/v1/logistics/shipments` endpoint SHALL validate that serviceType is one of: same_day, next_day, express, scheduled
5. WHEN validation fails, THE System SHALL return a 400 Bad Request response with a JSON body listing all validation errors
6. WHEN a shipmentId conflict is detected, THE System SHALL return a 409 Conflict response with a JSON body identifying the conflicting field
7. WHEN a trackingCode generation fails after retries, THE System SHALL return a 409 Conflict response indicating tracking code exhaustion

### Requirement 10: Rider Assignment Conflict Semantics

**User Story:** As a third-party integrator, I want the rider assignment endpoint to return proper conflict responses when a rider is unavailable, so that I can implement retry or fallback logic.

#### Acceptance Criteria

1. WHEN `POST /api/v1/logistics/shipments/{shipmentId}/assign` is called with a riderId whose status is not "available", THE System SHALL return a 409 Conflict response
2. WHEN `POST /api/v1/logistics/shipments/{shipmentId}/assign` is called with a riderId whose isActive is false, THE System SHALL return a 409 Conflict response
3. THE 409 Conflict response body SHALL include the rider's current status and isActive values for diagnostic purposes
4. WHEN the shipment is not in a valid state for assignment (not "created"), THE System SHALL return a 422 Unprocessable Entity response with the current shipment status
5. WHEN the shipmentId does not exist, THE System SHALL return a 404 Not Found response
6. WHEN the riderId does not exist, THE System SHALL return a 404 Not Found response

### Requirement 11: Status Transition Enforcement

**User Story:** As a third-party integrator, I want the status update endpoint to enforce valid transitions and return clear error responses, so that shipments cannot be moved to invalid states.

#### Acceptance Criteria

1. THE `POST /api/v1/logistics/shipments/{shipmentId}/status` endpoint SHALL enforce the valid transition map: created→assigned, assigned→picked_up, picked_up→in_transit, in_transit→delivered, in_transit→failed, created→cancelled, assigned→cancelled, failed→created
2. WHEN an invalid status transition is requested, THE System SHALL return a 422 Unprocessable Entity response with the current status, requested status, and list of valid transitions from the current status
3. WHEN deliveryStatus is "delivered" or "cancelled", THE System SHALL reject any further status updates with a 422 response indicating the shipment is in a terminal state
4. WHEN status is updated to "failed" without a failureReason field, THE System SHALL return a 400 Bad Request response
5. WHEN status is updated to "delivered" with a proofOfDelivery object missing both photoUrl and signatureUrl, THE System SHALL return a 400 Bad Request response
6. THE System SHALL log all rejected status transition attempts at "warn" level with requestId, shipmentId, current status, and requested status

### Requirement 12: Public Tracking Endpoint Safety

**User Story:** As a platform operator, I want the public tracking endpoint to return a PII-stripped response, so that sensitive sender and recipient details are not exposed to unauthenticated callers.

#### Acceptance Criteria

1. THE `GET /api/v1/logistics/track/{trackingCode}` response SHALL include only: trackingCode, deliveryStatus, serviceType, etaMinutes (if available), and lastEventTimestamp
2. THE `GET /api/v1/logistics/track/{trackingCode}` response SHALL exclude: sender full address, sender phone, recipient full address, recipient phone, organizationId, assignedRiderId, paymentMethod, paymentStatus, and customerId
3. WHEN a valid trackingCode is provided, THE System SHALL return a 200 response with the PII-stripped tracking payload
4. WHEN an invalid trackingCode is provided, THE System SHALL return a 404 Not Found response with a generic message that does not reveal whether the code format is valid
5. THE System SHALL rate-limit the public tracking endpoint to 60 requests per minute per IP address
6. THE System SHALL use the `maskShipmentForPublic` utility from `src/lib/logistics/masking.ts` to strip PII fields before returning the response
7. THE `maskShipmentForPublic` function SHALL REMOVE (not mask or redact) the following fields entirely from the response: sender.phone, sender.address, recipient.phone, recipient.address, organizationId, assignedRiderId, paymentMethod, paymentStatus, customerId
8. THE `maskShipmentForPublic` function SHALL RETAIN the following fields in the response: trackingCode, deliveryStatus, serviceType, etaMinutes, lastEventTimestamp
9. THE `maskShipmentForPublic` function signature SHALL be: `maskShipmentForPublic(shipment: ShipmentDoc): PublicTrackingResponse`

### Requirement 13: List Endpoint Pagination and Performance

**User Story:** As a third-party integrator, I want list endpoints to support efficient pagination and filtering, so that I can browse large datasets without performance degradation.

#### Acceptance Criteria

1. THE `GET /api/v1/logistics/shipments` endpoint SHALL accept query parameters: organizationId (required), status (optional), page (optional, default 1), perPage (optional, default 20, maximum 100)
2. WHEN perPage exceeds 100, THE System SHALL clamp the value to 100 without returning an error
3. THE System SHALL return paginated results with fields: items, page, perPage, totalCount
4. WHEN filtering by organizationId, THE System SHALL use the `by_organization_id` index via `.withIndex()`; WHEN filtering by both organizationId and deliveryStatus, THE System SHALL use the `by_organization_id` index with `.withIndex()` and MAY apply a post-filter on deliveryStatus if a composite index is not available; a composite index (`by_org_and_status` on `[organizationId, deliveryStatus]`) is preferred if query volume warrants it
5. THE System SHALL sort results by createdAt in descending order (newest first)
6. WHEN page exceeds available results, THE System SHALL return an empty items array with the correct totalCount

### Requirement 14: Logistics Call-Phase Gating in WS-Server

**User Story:** As a platform operator, I want the ws-server to enforce call-phase gating for all logistics voice tools, so that tools are only available during the appropriate conversation phase.

#### Acceptance Criteria

1. THE ws-server SHALL define logistics call phases: await_org_verification, org_verified, shipment_open, shipment_confirmed
2. WHEN the logistics call phase is `await_org_verification`, THE Voice_Agent SHALL restrict available tools to `get_organization_details` only
3. WHEN the logistics call phase is `org_verified`, THE Voice_Agent SHALL enable `create_shipment` and `quote_delivery` tools in addition to `get_organization_details`
4. WHEN the logistics call phase is `shipment_open`, THE Voice_Agent SHALL enable `update_shipment`, `assign_rider`, and `add_shipment_event` tools in addition to previously available tools
5. WHEN the logistics call phase is `shipment_confirmed`, THE Voice_Agent SHALL restrict tools to read-only operations (no further mutations on the confirmed shipment)
6. WHEN a voice tool call is attempted outside its permitted call phase, THE System SHALL reject the call with a descriptive error message and log the violation at "warn" level
7. THE System SHALL maintain existing restaurant call phases (await_restaurant_id, restaurant_verified, order_open, order_finalized) without modification
8. THE System SHALL enforce the following tool availability matrix per call phase:
   - `await_org_verification`: get_organization_details only
   - `org_verified`: get_organization_details, create_shipment, quote_delivery
   - `shipment_open`: get_organization_details, create_shipment, quote_delivery, update_shipment, assign_rider, add_shipment_event
   - `shipment_confirmed`: get_organization_details, quote_delivery (read-only only; no mutations permitted)

### Requirement 15: Organization Details Real Lookup

**User Story:** As a platform operator, I want the `get_organization_details` voice tool to perform a real database lookup, so that the voice agent receives accurate organization data during logistics calls.

#### Acceptance Criteria

1. THE `get_organization_details` voice tool SHALL query the Convex `organizations` table using the provided organizationId
2. WHEN the organization exists, THE tool SHALL return the organization's name, vertical, platformId, and settings
3. WHEN the organization does not exist, THE tool SHALL return an error response indicating the organization was not found
4. THE tool SHALL validate that the organization's vertical is "logistics" before returning details during a logistics conversation
5. THE tool SHALL use the `by_organization_id` index for the lookup query

### Requirement 16: Voice Tool Call Retry and Fallback

**User Story:** As a platform operator, I want voice tool calls to implement retry and fallback behavior, so that transient failures do not cause call drops or silent failures.

#### Acceptance Criteria

1. WHEN a logistics voice tool call fails due to a transient error (network timeout, Convex mutation conflict), THE System SHALL retry the tool call up to 2 times with exponential backoff (1s, 3s)
2. WHEN all retry attempts fail, THE System SHALL return a graceful error message to the Voice_Agent indicating the operation could not be completed
3. THE System SHALL log each retry attempt at "warn" level with the tool name, attempt number, and error message
4. WHEN a tool call fails after all retries, THE System SHALL log at "error" level with the tool name, total attempts, and final error
5. THE retry behavior SHALL apply to all logistics voice tools: create_shipment, update_shipment, assign_rider, add_shipment_event, quote_delivery, and get_organization_details
6. THE System SHALL not retry tool calls that fail due to validation errors (invalid input, unauthorized access)

### Requirement 17: Transcript and Call Event Correlation IDs

**User Story:** As a platform operator, I want correlation IDs propagated across voice flows, so that transcript entries, call events, and tool invocations can be traced back to a single call session.

#### Acceptance Criteria

1. WHEN a new voice call session is established in the ws-server, THE System SHALL generate a unique correlationId for the session
2. THE System SHALL include the correlationId in all transcript entries created during the call session
3. THE System SHALL include the correlationId in all shipment events created by voice tool calls during the session
4. THE System SHALL include the correlationId in all audit log entries emitted during voice tool execution
5. THE System SHALL include the correlationId in webhook events dispatched as a result of voice tool actions
6. THE correlationId SHALL be distinct from the requestId used for API requests; voice sessions use correlationId while API requests use requestId
7. THE Convex `calls` table record SHALL store the correlation identifier in a field named `correlationId`
8. THE Convex `shipmentEvents` table record SHALL store the correlation identifier in a field named `correlationId`
9. Transcript entries SHALL include a `correlationId` field linking the entry to the originating voice session
10. Audit log entries SHALL include a `correlationId` field linking the entry to the originating voice session
11. Webhook payloads originating from voice actions SHALL include both `requestId` (set to the correlationId value) and `correlationId` fields
12. API-originated webhook payloads SHALL include `requestId` only (no correlationId field)

### Requirement 18: Outbound Webhook Payload Contract

**User Story:** As a third-party integrator consuming webhooks, I want a standardized payload contract for logistics webhook events, so that I can reliably parse and process incoming webhook data.

#### Acceptance Criteria

1. THE outbound logistics webhook payload SHALL include fields: eventId, eventType, resourceType ("shipment"), resourceId (shipmentId), shipmentId, timestamp, and requestId
2. THE outbound logistics webhook payload SHALL include a `data` object containing the event-specific details (shipment snapshot, status change details, rider assignment details)
3. THE System SHALL use consistent field naming across all logistics webhook event types: shipment.created, shipment.assigned, shipment.status_updated, shipment.delivered, shipment.failed
4. THE `data` object for `shipment.status_updated` events SHALL include: oldStatus, newStatus, and failureReason (when applicable)
5. THE `data` object for `shipment.assigned` events SHALL include: riderId and shipmentId
6. THE System SHALL include the originating requestId in every outbound webhook payload for end-to-end traceability

### Requirement 19: Race-Safe Idempotent Webhook Insertion and Dispatch

**User Story:** As a platform operator, I want webhook event insertion to be atomic and idempotent, so that duplicate dispatches from concurrent operations do not create duplicate webhook records or side effects.

#### Acceptance Criteria

1. THE `atomicInsertWebhookEvent` mutation SHALL perform a check-and-insert within a single Convex mutation transaction using the `by_event_id` index
2. WHEN a duplicate eventId is detected, THE mutation SHALL return `{ inserted: false, alreadyProcessed }` without creating a new record
3. WHEN a new eventId is inserted, THE mutation SHALL return `{ inserted: true, id }` with the new document ID
4. THE `dispatchLogisticsWebhookEvent` function SHALL skip subscriber delivery when the atomic insert returns `inserted: false`
5. THE System SHALL log duplicate webhook event attempts at "warn" level with the eventId, shipmentId, and requestId
6. THE webhook dispatch function SHALL not throw errors on delivery failures; delivery failures SHALL be logged and the webhook event SHALL remain persisted for retry

### Requirement 20: Webhook Retry and Dead-Letter Observability

**User Story:** As a platform operator, I want visibility into webhook retry attempts and dead-letter events, so that I can diagnose integration failures and monitor delivery health.

#### Acceptance Criteria

1. THE `webhookDeliveries` table SHALL track attemptCount, lastAttemptAt, error, and nextRetryAt for each delivery attempt
2. THE System SHALL retry failed webhook deliveries up to 5 times with exponential backoff (30s, 2m, 10m, 1h, 6h)
3. WHEN a webhook delivery exhausts all 5 retry attempts, THE System SHALL mark the delivery as a dead-letter by setting success to false and nextRetryAt to null
4. THE System SHALL expose a query to retrieve dead-letter webhook deliveries filtered by subscriptionId and time range
5. THE System SHALL expose a query to retrieve webhook delivery statistics (total, successful, failed, dead-letter count) per partner
6. THE System SHALL log each retry attempt at "info" level with deliveryId, attemptCount, statusCode, and error message
7. THE System SHALL implement a Convex cron job (or scheduled function) that runs every 60 seconds to process pending webhook retries
8. THE webhook retry scheduler SHALL query the `webhookDeliveries` table using the `by_next_retry_at` index to find deliveries where `nextRetryAt` is less than or equal to the current timestamp and `success` is false

### Requirement 21: Signed Webhook Verification Documentation

**User Story:** As a third-party integrator, I want documentation on how to verify webhook signatures, so that I can authenticate incoming webhook payloads from the platform.

#### Acceptance Criteria

1. THE System SHALL sign all outbound webhook payloads using HMAC-SHA256 with the subscriber's webhook secret
2. THE System SHALL include the signature in the `X-Webhook-Signature` header of each outbound webhook delivery
3. THE System SHALL include a `X-Webhook-Timestamp` header containing the Unix timestamp of the webhook dispatch
4. THE signature payload SHALL be computed as: HMAC-SHA256(secret, timestamp + "." + JSON.stringify(body))
5. THE System SHALL document the verification algorithm, header names, and example verification code in a consumer-facing reference
6. WHEN a webhook subscriber's secret is rotated, THE System SHALL use the new secret for all subsequent deliveries without affecting in-flight retries

### Requirement 22: Full Regression Suite

**User Story:** As a platform operator, I want a comprehensive regression test suite covering both restaurant and logistics functionality, so that deployments do not introduce regressions in either vertical.

#### Acceptance Criteria

1. THE Regression_Suite SHALL include tests for all existing restaurant API endpoints verifying unchanged response schemas
2. THE Regression_Suite SHALL include tests for all logistics API endpoints verifying correct status codes, response shapes, and error handling
3. THE Regression_Suite SHALL include tests verifying tenant isolation: a partner accessing resources outside their organization scope receives 403
4. THE Regression_Suite SHALL include tests verifying idempotency: duplicate requests with the same idempotency key return the stored response
5. THE Regression_Suite SHALL include tests verifying status transition enforcement: invalid transitions return 422
6. THE Regression_Suite SHALL include tests verifying the public tracking endpoint returns PII-stripped responses
7. WHEN a logistics code change causes a restaurant regression test to fail, THE System SHALL treat the failure as a blocking defect

### Requirement 23: Staging Smoke Scripts

**User Story:** As a platform operator, I want automated smoke scripts for staging that exercise the full shipment lifecycle, so that I can validate end-to-end functionality before production deployment.

#### Acceptance Criteria

1. THE Smoke_Script SHALL execute the full shipment lifecycle: create → assign → picked_up → in_transit → delivered
2. THE Smoke_Script SHALL execute the failure path: create → assign → picked_up → in_transit → failed
3. THE Smoke_Script SHALL verify webhook events are dispatched for each status transition
4. THE Smoke_Script SHALL verify idempotency by replaying the create request with the same idempotency key and asserting the same response
5. THE Smoke_Script SHALL verify the public tracking endpoint returns correct status at each lifecycle stage
6. THE Smoke_Script SHALL verify rider status transitions: available → busy → available through the assignment and completion cycle
7. THE Smoke_Script SHALL report pass/fail status for each step with timing information

### Requirement 24: Production Runbook and Rollback Plan

**User Story:** As a platform operator, I want a production runbook with deployment steps and rollback procedures, so that the hardening release can be deployed safely with clear recovery options.

#### Acceptance Criteria

1. THE Runbook SHALL document pre-deployment checklist items: feature flag states, database index verification, environment variable validation
2. THE Runbook SHALL document deployment steps in order: schema deployment, API route deployment, ws-server deployment, feature flag enablement
3. THE Runbook SHALL document health check endpoints and expected responses for post-deployment verification
4. THE Runbook SHALL document rollback steps: feature flag disablement, code revert procedure, and data integrity verification
5. THE Runbook SHALL document monitoring dashboards and alert thresholds to watch during and after deployment
6. THE Runbook SHALL document escalation contacts and communication channels for deployment issues
