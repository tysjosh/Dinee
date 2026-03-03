# Requirements Document

## Introduction

This document defines the requirements for adding a logistics vertical alongside the existing restaurant domain in the restaurant call management platform. The logistics vertical introduces shipment management, rider dispatch, delivery tracking, and logistics-specific voice agent capabilities. The implementation follows a non-breaking coexistence strategy: all existing restaurant tables, endpoints, and workflows remain unchanged while new logistics-specific entities, API routes, and voice agent tool packs are added in parallel. A shared domain layer (`vertical: "restaurant" | "logistics"`) unifies tenant identity, communications, payments, and webhook infrastructure across both verticals.

## Glossary

- **Vertical**: A business domain supported by the platform, either "restaurant" or "logistics"
- **Organization**: A tenant entity representing either a restaurant company or a logistics company, identified by vertical
- **Location**: A physical site (warehouse, hub, branch) belonging to an Organization; superset of the existing Branch concept
- **Shipment**: The primary logistics entity representing a parcel moving from sender to recipient
- **Tracking_Code**: A human-facing alphanumeric code used by customers to track a Shipment
- **Rider**: A delivery person assigned to pick up and deliver Shipments
- **Shipment_Event**: An immutable audit log entry recording a state change or action on a Shipment
- **Proof_of_Delivery**: Evidence of successful delivery including photo, signature, recipient name, and timestamp
- **Service_Type**: The speed tier for a Shipment: same_day, next_day, express, or scheduled
- **Delivery_Status**: The lifecycle state of a Shipment: created, assigned, picked_up, in_transit, delivered, failed, cancelled
- **Partner_API**: The existing authenticated REST API used by third-party integrators
- **Voice_Agent**: The AI-powered phone agent that handles inbound and outbound calls
- **Conversation_Type**: A classifier that determines which tool pack and prompt set the Voice_Agent uses
- **Tool_Pack**: A set of backend functions available to the Voice_Agent during a specific Conversation_Type
- **Platform**: The top-level multi-tenant entity managing multiple Organizations
- **Convex**: The real-time backend database and API layer used by the application
- **Webhook_Event**: An event record dispatched to partner-registered callback URLs
- **COD**: Cash-on-delivery payment method
- **Paystack**: Nigerian payment gateway for card and bank transfer payments
- **Flutterwave**: Nigerian payment gateway supporting multiple payment methods

## Requirements

### Requirement 1: Domain Vertical Abstraction Layer

**User Story:** As a platform administrator, I want the platform to support multiple business verticals (restaurant and logistics), so that the same infrastructure can serve different industry domains without breaking existing functionality.

#### Acceptance Criteria

1. THE Schema SHALL define a `vertical` field as a union of "restaurant" and "logistics" literals
2. THE Schema SHALL extend the `platforms` table with an `enabledVerticals` array field containing one or more vertical values
3. WHEN a new Organization is created, THE System SHALL require a `vertical` field that matches one of the Platform's enabled verticals
4. THE System SHALL add an optional `vertical` field defaulting to "restaurant" on existing `orders` and `calls` tables
5. THE System SHALL add an optional `locationId` field on existing `orders` table to mirror `branchId` for forward compatibility
6. WHEN querying existing restaurant data, THE System SHALL return results unchanged regardless of the new vertical fields
7. IF a vertical value is provided that does not match the Platform's enabled verticals, THEN THE System SHALL reject the operation with a validation error

### Requirement 2: Organization Entity

**User Story:** As a platform administrator, I want to create Organizations scoped to a vertical, so that restaurant companies and logistics companies are managed as distinct tenant types under the same platform.

#### Acceptance Criteria

1. THE Schema SHALL define an `organizations` table with fields: organizationId, platformId, vertical, name, settings (object), and createdAt
2. THE Schema SHALL define indexes on the `organizations` table: by_organization_id, by_platform_id, by_vertical
3. WHEN creating an Organization, THE System SHALL validate that the platformId references an existing Platform
4. WHEN creating an Organization, THE System SHALL validate that the vertical value is included in the referenced Platform's enabledVerticals
5. THE System SHALL enforce unique organizationId values across all Organizations
6. THE System SHALL preserve existing `restaurants` table and data without modification for backward compatibility
7. WHEN querying Organizations, THE System SHALL support filtering by platformId and by vertical

### Requirement 3: Location Entity

**User Story:** As an organization administrator, I want to register physical locations (hubs, warehouses, branches), so that shipments and operations can be associated with specific sites.

#### Acceptance Criteria

1. THE Schema SHALL define a `locations` table with fields: locationId, organizationId, name, address, city, state, geo (object with lat and lng as numbers), isActive (boolean), operatingHours (object), and createdAt
2. THE Schema SHALL define indexes on the `locations` table: by_location_id, by_organization_id, by_city_state
3. WHEN creating a Location, THE System SHALL validate that the organizationId references an existing Organization
4. THE System SHALL enforce unique locationId values across all Locations
5. THE System SHALL preserve existing `branches` table and data without modification for backward compatibility
6. THE System SHALL support internal mapping from Branch records to Location records for Organizations with vertical "restaurant"
7. WHEN querying Locations, THE System SHALL support filtering by organizationId, city, and state

### Requirement 4: Shipment Entity and Lifecycle

**User Story:** As a logistics operator, I want to create and manage shipments with full lifecycle tracking, so that parcels are tracked from creation through delivery or failure.

#### Acceptance Criteria

1. THE Schema SHALL define a `shipments` table with fields: shipmentId, trackingCode, organizationId, locationId (optional), customerId (optional), sender (object with name, phone, address, city, state, lat, lng), recipient (object with name, phone, address, city, state, lat, lng), parcel (object with type, weightKg, dimensions, declaredValue, notes), serviceType, paymentMethod (optional), paymentStatus (optional), deliveryStatus, failureReason (optional), etaMinutes (optional), assignedRiderId (optional), proofOfDelivery (optional object with photoUrl, signatureUrl, recipientName, deliveredAt), createdAt, and updatedAt
2. THE Schema SHALL define indexes on the `shipments` table: by_shipment_id, by_tracking_code, by_organization_id, by_delivery_status, by_assigned_rider_id
3. THE System SHALL support deliveryStatus values: created, assigned, picked_up, in_transit, delivered, failed, cancelled
4. THE System SHALL support serviceType values: same_day, next_day, express, scheduled
5. THE System SHALL support paymentMethod values: paystack, flutterwave, cod, wallet
6. THE System SHALL support paymentStatus values: pending, paid, failed, refunded
7. WHEN a Shipment is created, THE System SHALL generate a unique shipmentId and a human-readable trackingCode
8. WHEN a Shipment is created, THE System SHALL set deliveryStatus to "created" and record createdAt and updatedAt timestamps
9. THE System SHALL enforce unique shipmentId and unique trackingCode values across all Shipments
10. WHEN deliveryStatus changes, THE System SHALL update the updatedAt timestamp

### Requirement 5: Rider Entity and Status Management

**User Story:** As a logistics operator, I want to register and manage delivery riders with real-time status tracking, so that I can assign available riders to shipments.

#### Acceptance Criteria

1. THE Schema SHALL define a `riders` table with fields: riderId, organizationId, name, phone, vehicleType, status, lastLocation (optional object with lat, lng, updatedAt), and isActive (boolean)
2. THE Schema SHALL define indexes on the `riders` table: by_rider_id, by_organization_id, by_status
3. THE System SHALL support rider status values: offline, available, busy
4. WHEN a Rider status update is received, THE System SHALL update the status field and lastLocation if coordinates are provided
5. THE System SHALL enforce unique riderId values across all Riders
6. WHEN querying Riders, THE System SHALL support filtering by organizationId and by status
7. WHEN a Rider is assigned to a Shipment, THE System SHALL update the Rider status to "busy"

### Requirement 6: Shipment Event Log

**User Story:** As a logistics operator, I want an immutable event log for each shipment, so that I have a complete audit trail of all actions and state changes.

#### Acceptance Criteria

1. THE Schema SHALL define a `shipmentEvents` table with fields: eventId, shipmentId, eventType (string), actorType, actorId (string), payload (string for JSON data), and createdAt
2. THE Schema SHALL define indexes on the `shipmentEvents` table: by_shipment_id, by_event_type
3. THE System SHALL support actorType values: system, agent, rider, merchant
4. WHEN a Shipment deliveryStatus changes, THE System SHALL create a corresponding ShipmentEvent record
5. WHEN a Rider is assigned to a Shipment, THE System SHALL create a ShipmentEvent with eventType "rider_assigned"
6. THE System SHALL enforce unique eventId values across all ShipmentEvents
7. THE ShipmentEvent records SHALL be append-only; THE System SHALL reject updates or deletions of existing events

### Requirement 7: Logistics API Endpoints

**User Story:** As a third-party integrator, I want dedicated logistics API endpoints, so that I can programmatically create shipments, assign riders, and track deliveries without affecting existing restaurant API routes.

#### Acceptance Criteria

1. THE System SHALL expose logistics endpoints under the path prefix `/api/v1/logistics/`
2. THE System SHALL implement `POST /api/v1/logistics/shipments` to create a new Shipment
3. THE System SHALL implement `GET /api/v1/logistics/shipments/{shipmentId}` to retrieve a single Shipment by shipmentId
4. THE System SHALL implement `GET /api/v1/logistics/shipments` with query parameters organizationId, status, page, and perPage to list Shipments with pagination
5. THE System SHALL implement `POST /api/v1/logistics/shipments/{shipmentId}/assign` to assign a Rider to a Shipment
6. THE System SHALL implement `POST /api/v1/logistics/shipments/{shipmentId}/status` to update the deliveryStatus of a Shipment
7. THE System SHALL implement `GET /api/v1/logistics/track/{trackingCode}` as a public-safe endpoint to retrieve Shipment status by trackingCode without requiring authentication
8. THE System SHALL implement `POST /api/v1/logistics/riders/{riderId}/status` to update Rider status and location (heartbeat)
9. THE System SHALL require `Authorization: Bearer <partner-key>` or `X-API-Key` header on all logistics endpoints except the public tracking endpoint
10. THE System SHALL require `X-Tenant-Id` header on all authenticated logistics endpoints
11. WHEN an authenticated request is missing valid credentials, THE System SHALL return a 401 Unauthorized response
12. WHEN a request targets a resource outside the authenticated tenant's scope, THE System SHALL return a 403 Forbidden response

### Requirement 8: Restaurant API Stability

**User Story:** As an existing restaurant API consumer, I want all current restaurant endpoints to remain unchanged, so that my integrations continue working after the logistics vertical is added.

#### Acceptance Criteria

1. THE System SHALL preserve all existing restaurant API routes under `/api/v1/partner/` without path changes
2. THE System SHALL preserve all existing request and response schemas for restaurant endpoints
3. THE System SHALL preserve existing authentication and authorization behavior for restaurant endpoints
4. WHEN a restaurant endpoint is called without a vertical header, THE System SHALL default to "restaurant" behavior
5. THE System SHALL preserve existing rate limiting configuration for restaurant endpoints
6. IF a new optional field is added to a restaurant response, THEN THE System SHALL ensure the field is optional and does not break existing consumers

### Requirement 9: Shared Authentication and Tenant Headers

**User Story:** As a platform administrator, I want a unified authentication scheme across verticals, so that partners can use the same credentials for both restaurant and logistics APIs.

#### Acceptance Criteria

1. THE System SHALL accept `Authorization: Bearer <partner-key>` or `X-API-Key` header for authentication across both verticals
2. THE System SHALL accept `X-Tenant-Id` header to identify the target tenant for multi-tenant operations
3. THE System SHALL accept an optional `X-Vertical: restaurant|logistics` header to disambiguate requests when a tenant operates in multiple verticals
4. WHEN `X-Vertical` is not provided, THE System SHALL infer the vertical from the API path prefix (partner routes default to restaurant, logistics routes default to logistics)
5. THE System SHALL validate that the authenticated partner has access to the specified tenant and vertical
6. IF the partner does not have access to the requested vertical, THEN THE System SHALL return a 403 Forbidden response

### Requirement 10: Polymorphic Webhook Events

**User Story:** As a third-party integrator, I want webhook events for logistics actions alongside existing restaurant events, so that I can react to shipment lifecycle changes in real time.

#### Acceptance Criteria

1. THE Schema SHALL extend the `webhookEvents` table with optional `shipmentId` field alongside the existing optional `orderId` field
2. THE Schema SHALL add `resourceType` field to `webhookEvents` with values "order" or "shipment"
3. THE Schema SHALL add `resourceId` field to `webhookEvents` as a generic reference to the associated order or shipment
4. THE System SHALL dispatch webhook events for logistics actions: shipment.created, shipment.assigned, shipment.status_updated, shipment.delivered, shipment.failed
5. WHEN a logistics webhook event is created, THE System SHALL populate shipmentId, resourceType as "shipment", and resourceId with the shipmentId
6. WHEN a restaurant webhook event is created, THE System SHALL populate orderId, resourceType as "order", and resourceId with the orderId
7. THE System SHALL deliver logistics webhook events using the same retry and delivery infrastructure as restaurant webhook events

### Requirement 11: Voice Agent Conversation Types

**User Story:** As a platform administrator, I want the voice agent to support logistics-specific conversation types, so that callers can book shipments and track deliveries by phone.

#### Acceptance Criteria

1. THE System SHALL define conversation types for restaurant: restaurant_inbound_order, restaurant_followup, restaurant_cancellation
2. THE System SHALL define conversation types for logistics: logistics_booking, logistics_followup, logistics_failure_notice
3. WHEN an inbound call is received, THE System SHALL determine the conversation type based on the called number's associated vertical and Organization
4. THE Voice_Agent SHALL select the appropriate tool pack based on the determined conversation type
5. THE System SHALL maintain existing restaurant call phases (await_restaurant_id, restaurant_verified, order_open, order_finalized) without modification
6. THE System SHALL define logistics call phases: await_org_verification, org_verified, shipment_open, shipment_confirmed
7. THE Voice_Agent SHALL enforce tool access restrictions based on the current logistics call phase

### Requirement 12: Logistics Voice Agent Tool Pack

**User Story:** As a logistics operator, I want the voice agent to have logistics-specific tools, so that callers can create shipments, get delivery quotes, and check tracking status by phone.

#### Acceptance Criteria

1. THE System SHALL implement a `create_shipment` voice tool that creates a new Shipment from caller-provided details
2. THE System SHALL implement an `update_shipment` voice tool that updates Shipment fields during an active call
3. THE System SHALL implement an `assign_rider` voice tool that assigns an available Rider to a Shipment
4. THE System SHALL implement an `add_shipment_event` voice tool that appends an event to the Shipment event log
5. THE System SHALL implement a `quote_delivery` voice tool that returns estimated cost and ETA based on sender/recipient locations and service type
6. THE System SHALL preserve all existing restaurant voice tools (get_restaurant_details, upsert_call_data, add_transcript_dialogue, upsert_order, generate_order_id) without modification
7. WHEN a logistics conversation is active, THE Voice_Agent SHALL restrict available tools to the logistics tool pack only
8. WHEN a restaurant conversation is active, THE Voice_Agent SHALL restrict available tools to the restaurant tool pack only

### Requirement 13: Shipment Pagination and Filtering

**User Story:** As a logistics operator, I want to list and filter shipments with pagination, so that I can efficiently browse large volumes of shipment data.

#### Acceptance Criteria

1. THE List_Shipments endpoint SHALL accept query parameters: organizationId (required), status (optional), page (optional, default 1), perPage (optional, default 20, maximum 100)
2. WHEN status filter is provided, THE System SHALL return only Shipments matching the specified deliveryStatus
3. THE System SHALL return paginated results with fields: items (array of Shipments), page, perPage, totalCount
4. THE System SHALL use index-backed queries for filtering by organizationId and deliveryStatus
5. WHEN page exceeds available results, THE System SHALL return an empty items array with correct totalCount
6. THE System SHALL sort results by createdAt in descending order (newest first)

### Requirement 14: Public Shipment Tracking

**User Story:** As a shipment recipient, I want to track my delivery using a tracking code without logging in, so that I can check delivery status at any time.

#### Acceptance Criteria

1. THE Track endpoint SHALL accept a trackingCode path parameter and return Shipment status without requiring authentication
2. THE Track endpoint response SHALL include: trackingCode, deliveryStatus, serviceType, etaMinutes (if available), and last event timestamp
3. THE Track endpoint response SHALL exclude sensitive fields: sender full address, recipient full address, payment details, organizationId, and assignedRiderId
4. WHEN a valid trackingCode is provided, THE System SHALL return the Shipment tracking information with a 200 status code
5. WHEN an invalid trackingCode is provided, THE System SHALL return a 404 Not Found response
6. THE System SHALL rate-limit the public tracking endpoint to prevent abuse

### Requirement 15: Rider Assignment and Dispatch

**User Story:** As a logistics operator, I want to assign riders to shipments and track dispatch status, so that deliveries are fulfilled by available riders.

#### Acceptance Criteria

1. WHEN a Rider is assigned to a Shipment, THE System SHALL update the Shipment's assignedRiderId and set deliveryStatus to "assigned"
2. WHEN a Rider is assigned, THE System SHALL validate that the Rider's status is "available" and isActive is true
3. WHEN a Rider is assigned, THE System SHALL update the Rider's status to "busy"
4. IF the specified Rider is not available, THEN THE System SHALL return a 409 Conflict response with a descriptive message
5. WHEN a Shipment delivery is completed or failed, THE System SHALL update the assigned Rider's status back to "available"
6. THE Assign endpoint SHALL require the shipmentId and riderId in the request body
7. THE System SHALL create a ShipmentEvent with eventType "rider_assigned" when assignment succeeds

### Requirement 16: Proof of Delivery Capture

**User Story:** As a logistics operator, I want riders to submit proof of delivery, so that successful deliveries are documented with evidence.

#### Acceptance Criteria

1. WHEN deliveryStatus is updated to "delivered", THE System SHALL accept an optional proofOfDelivery object with fields: photoUrl, signatureUrl, recipientName, and deliveredAt
2. THE System SHALL store the proofOfDelivery object on the Shipment record
3. THE System SHALL create a ShipmentEvent with eventType "proof_of_delivery_submitted" containing the proof details in the payload
4. WHEN proofOfDelivery is provided, THE System SHALL validate that at least one of photoUrl or signatureUrl is present
5. THE proofOfDelivery deliveredAt field SHALL default to the current timestamp if not provided

### Requirement 17: Delivery Failure Handling

**User Story:** As a logistics operator, I want to record delivery failures with reasons, so that failed deliveries can be investigated and re-attempted.

#### Acceptance Criteria

1. WHEN deliveryStatus is updated to "failed", THE System SHALL require a failureReason field in the request
2. THE System SHALL store the failureReason on the Shipment record
3. THE System SHALL create a ShipmentEvent with eventType "delivery_failed" containing the failureReason in the payload
4. WHEN a Shipment fails, THE System SHALL update the assigned Rider's status back to "available"
5. THE System SHALL allow re-assignment of a failed Shipment to a different Rider by resetting deliveryStatus to "created"
6. THE System SHALL dispatch a webhook event with type "shipment.failed" when a delivery fails

### Requirement 18: Migration Compatibility Adapters

**User Story:** As a platform administrator, I want compatibility adapters between old and new entity models, so that existing restaurant data can be accessed through the new Organization/Location abstractions without data migration.

#### Acceptance Criteria

1. THE System SHALL provide an internal adapter that maps existing Restaurant records to Organization records with vertical "restaurant"
2. THE System SHALL provide an internal adapter that maps existing Branch records to Location records
3. WHEN querying Organizations with vertical "restaurant", THE System SHALL include adapted Restaurant records in the results
4. WHEN querying Locations for a restaurant Organization, THE System SHALL include adapted Branch records in the results
5. THE Adapters SHALL be read-only views; mutations SHALL continue to use the original Restaurant and Branch tables for restaurant vertical
6. THE System SHALL support a `restaurantId` to `organizationId` mapping lookup for cross-referencing

### Requirement 19: Logistics Shipment Status Transition Validation

**User Story:** As a logistics operator, I want the system to enforce valid status transitions, so that shipments cannot skip lifecycle stages or move to invalid states.

#### Acceptance Criteria

1. THE System SHALL enforce the following valid deliveryStatus transitions: created→assigned, assigned→picked_up, picked_up→in_transit, in_transit→delivered, in_transit→failed, created→cancelled, assigned→cancelled
2. IF a status update requests an invalid transition, THEN THE System SHALL reject the request with a 422 Unprocessable Entity response and a descriptive error message
3. WHEN deliveryStatus is "delivered" or "cancelled", THE System SHALL reject any further status updates
4. THE System SHALL log all rejected status transition attempts for audit purposes
5. WHEN a valid status transition occurs, THE System SHALL create a ShipmentEvent recording the old and new status values


### Requirement 20: Uniqueness Enforcement Mechanism

**User Story:** As a platform administrator, I want all entity identifiers to be enforced as unique at the database transaction level, so that concurrent writes cannot create duplicate records.

#### Acceptance Criteria

1. THE System SHALL implement an atomic check-and-insert transaction pattern for all entities with unique identifiers: shipmentId, trackingCode, riderId, organizationId, locationId, and eventId
2. WHEN a create operation detects a duplicate identifier during the atomic transaction, THE System SHALL reject the operation with a 409 Conflict response
3. THE System SHALL perform uniqueness checks within the same Convex mutation transaction as the insert to prevent race conditions between concurrent requests
4. THE System SHALL return a descriptive error message in the 409 response body identifying which field caused the conflict
5. THE System SHALL apply the atomic check-and-insert pattern consistently across all logistics entity creation endpoints and voice agent tool mutations

### Requirement 21: Idempotency for Write Endpoints

**User Story:** As a third-party integrator, I want write endpoints to support idempotency keys, so that network retries do not create duplicate shipments or trigger duplicate side effects.

#### Acceptance Criteria

1. THE System SHALL accept an optional `X-Idempotency-Key` header on `POST /api/v1/logistics/shipments`, `POST /api/v1/logistics/shipments/{shipmentId}/assign`, and `POST /api/v1/logistics/shipments/{shipmentId}/status`
2. WHEN an `X-Idempotency-Key` is provided, THE System SHALL store the key, associated response status, and response body after the first successful processing
3. WHEN a subsequent request arrives with a previously seen `X-Idempotency-Key`, THE System SHALL return the stored response without re-executing the mutation
4. THE System SHALL scope idempotency keys to the authenticated partner to prevent cross-tenant collisions
5. THE System SHALL expire stored idempotency records after 24 hours
6. IF an `X-Idempotency-Key` is reused with a different request body, THEN THE System SHALL return a 422 Unprocessable Entity response indicating a key mismatch

### Requirement 22: Correlation and Traceability Standard

**User Story:** As a platform operator, I want all logistics requests to carry a correlation identifier through every processing layer, so that issues can be traced end-to-end across API, voice agent, and webhook systems.

#### Acceptance Criteria

1. THE System SHALL generate a unique `requestId` for each incoming logistics API request and propagate the requestId to all downstream operations including Convex mutations, voice agent tool calls, and webhook event dispatches
2. THE System SHALL accept an optional `X-Request-Id` header on incoming requests; WHEN provided, THE System SHALL use the provided value as the requestId instead of generating a new one
3. THE System SHALL include the `requestId` in all API response headers as `X-Request-Id`
4. THE System SHALL use the structured logger from `src/lib/logger.ts` (createLogger) for all logistics endpoint and mutation logging
5. THE System SHALL emit structured log entries with minimum fields: timestamp, level, requestId, tenantId, vertical, and resourceId
6. WHEN a logistics webhook event is dispatched, THE System SHALL include the originating requestId in the webhook payload

### Requirement 23: Authorization Matrix for Resource-Level Access

**User Story:** As a platform administrator, I want explicit resource-level authorization rules for all logistics endpoints, so that partners can only access resources belonging to their own organizations.

#### Acceptance Criteria

1. THE System SHALL implement a shared `authorizeLogisticsAccess()` utility function used by all authenticated logistics endpoints
2. THE `authorizeLogisticsAccess()` utility SHALL verify that the authenticated partner's platformId owns the target organizationId before granting access to any organization-scoped resource
3. WHEN a partner requests a Shipment, Rider, or Location belonging to an Organization the partner does not own, THE System SHALL return a 403 Forbidden response
4. THE public tracking endpoint (`GET /api/v1/logistics/track/{trackingCode}`) SHALL require no authentication but SHALL be rate-limited
5. THE Rider status endpoint (`POST /api/v1/logistics/riders/{riderId}/status`) SHALL require partner authentication and SHALL verify that the partner owns the Organization to which the Rider belongs
6. THE System SHALL apply `authorizeLogisticsAccess()` consistently across all logistics endpoints to prevent authorization drift between routes

### Requirement 24: Backward Compatibility Test Requirements

**User Story:** As a platform administrator, I want explicit non-regression tests for all existing restaurant functionality, so that adding the logistics vertical does not break any current behavior.

#### Acceptance Criteria

1. THE System SHALL maintain a non-regression test suite that validates all existing restaurant API endpoints return unchanged response schemas after logistics code is deployed
2. THE System SHALL include contract tests verifying that no existing restaurant API response payload shapes are modified by the logistics vertical addition
3. THE System SHALL ensure all existing preservation tests from the fix-plan-v1 bugfix spec continue passing after logistics code is merged
4. THE System SHALL enforce that new logistics modules do not import from or modify restaurant-specific modules (restaurant-specific Convex functions, restaurant voice tools, restaurant API route handlers)
5. WHEN a logistics code change causes a restaurant non-regression test to fail, THE System SHALL treat the failure as a blocking defect requiring resolution before merge

### Requirement 25: Webhook Race Safety

**User Story:** As a platform operator, I want webhook event ingestion to be idempotent, so that duplicate webhook dispatches do not create duplicate side effects.

#### Acceptance Criteria

1. THE System SHALL apply atomic idempotency on webhook event ingestion for all logistics webhook event types using the same `atomicInsertWebhookEvent` pattern from `convex/webhookEvents.ts`
2. WHEN a duplicate logistics webhook event is received (matching eventId), THE System SHALL return a 200 response with no side effects
3. THE System SHALL use the eventId as the idempotency key for webhook event deduplication
4. THE System SHALL apply the atomic idempotency pattern to all logistics webhook dispatches: shipment.created, shipment.assigned, shipment.status_updated, shipment.delivered, and shipment.failed
5. THE System SHALL log duplicate webhook event attempts at the warn level with the eventId and shipmentId for observability

### Requirement 26: PII and Privacy Boundaries for Logistics Tracking

**User Story:** As a platform administrator, I want personal information to be masked in public-facing responses and logs, so that sender and recipient privacy is protected.

#### Acceptance Criteria

1. THE public tracking endpoint SHALL mask sender and recipient phone numbers to show only the last 4 digits (format: "****1234")
2. THE public tracking endpoint SHALL mask sender and recipient addresses to show only city and state (excluding street address, building, and apartment details)
3. THE System SHALL mask phone numbers and full addresses in all structured log entries, replacing them with the masked format defined above
4. WHEN an authenticated partner requests Shipment details for an Organization the partner owns, THE System SHALL return full unmasked sender and recipient details
5. THE System SHALL define masking utility functions for phone numbers and addresses and apply the utilities consistently across all public responses and log outputs

### Requirement 27: Voice Agent State Machine and Tool Gating for Logistics

**User Story:** As a platform administrator, I want the logistics voice agent to enforce strict tool access per call phase, so that mutations cannot occur before organization verification is complete.

#### Acceptance Criteria

1. THE System SHALL define allowed tools per logistics call phase: await_org_verification phase allows only `get_organization_details`; org_verified phase allows `create_shipment` and `quote_delivery`; shipment_open phase allows `update_shipment`, `assign_rider`, and `add_shipment_event`; shipment_confirmed phase allows only `add_shipment_event`
2. WHEN the Voice_Agent attempts to invoke a tool not allowed in the current logistics call phase, THE System SHALL reject the tool invocation and instruct the agent to complete the current phase first
3. THE System SHALL use the `isToolAllowed` and `nextPhase` pattern from `src/app/ws-server/call-phase.ts` for logistics call phase management
4. THE System SHALL prevent shipment creation or modification tools from executing before the org_verified phase is reached
5. WHEN a logistics call phase transitions, THE System SHALL log the phase change with the callId, previous phase, and new phase

### Requirement 28: Performance and SLO Acceptance Criteria

**User Story:** As a platform operator, I want defined performance targets for all logistics endpoints, so that the system meets latency expectations under production load.

#### Acceptance Criteria

1. THE List_Shipments endpoint SHALL respond within 200 milliseconds at the 95th percentile
2. THE Get_Shipment and Track endpoints SHALL respond within 100 milliseconds at the 95th percentile
3. THE Create_Shipment endpoint SHALL respond within 500 milliseconds at the 95th percentile
4. THE Status_Update endpoint SHALL respond within 300 milliseconds at the 95th percentile
5. THE Webhook processing pipeline SHALL complete within 1 second at the 95th percentile from event creation to dispatch
6. THE System SHALL use index-backed Convex queries for all list and filter operations; THE System SHALL not use unindexed `.filter()` or `.collect()` patterns on logistics tables
7. THE List_Shipments endpoint SHALL support cursor-based pagination for efficient traversal of large datasets

### Requirement 29: Migration Rollout Controls

**User Story:** As a platform administrator, I want logistics functionality to be gated behind feature flags, so that I can enable the vertical per-tenant and roll back instantly if issues arise.

#### Acceptance Criteria

1. THE System SHALL disable logistics endpoints by default for all platforms; logistics access SHALL require "logistics" to be present in the Platform's `enabledVerticals` array
2. THE System SHALL support a `logistics_api_enabled` feature flag per platform that controls access to all `/api/v1/logistics/*` endpoints
3. WHEN a platform does not have logistics enabled (missing from enabledVerticals or feature flag is false), THE System SHALL return a 403 Forbidden response with a descriptive message for all logistics API requests
4. THE System SHALL support staged enablement allowing platform administrators to enable logistics for specific Organizations within a Platform
5. WHEN the `logistics_api_enabled` flag is disabled for a platform, THE System SHALL immediately stop serving all logistics API requests for that platform without data loss or data corruption
6. THE System SHALL preserve all logistics data when the feature flag is disabled, allowing re-enablement without data migration
