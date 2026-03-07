# Requirements Document

## Introduction

This document defines the requirements for repositioning Dinee from a restaurant-only call management application into a multi-vertical "AI Reception OS" platform serving any call-heavy business. The pivot introduces a vertical-aware tenant model, splits core platform capabilities from vertical-specific module packs, renames restaurant-centric concepts to generic business terminology, adds a Runsheet Connect integration module for logistics dispatch, updates call-agent flows with vertical-specific prompt packs and toolsets, and introduces vertical-aware billing and KPI tracking. Existing restaurant functionality is preserved as a vertical pack rather than the default identity, and all changes follow a safe rollout sequence with feature flags and backward compatibility.

## Glossary

- **Business**: The generic tenant entity replacing the restaurant-centric concept; represents any call-heavy organization using the platform
- **Location**: A physical site belonging to a Business, replacing the "branch" concept; can be a restaurant branch, clinic, law office, warehouse, or dispatch hub
- **Vertical**: A business domain classification for a tenant: general_services, healthcare, legal, hospitality, logistics, or restaurant
- **Vertical_Pack**: A feature-gated module set providing domain-specific workflows, UI components, and voice agent toolsets for a particular Vertical
- **Core_Platform**: The always-on set of capabilities shared across all verticals: inbound/outbound calls, call routing, AI receptionist scripts, transcripts, summaries, QA, contact capture, and appointment/task capture
- **Runsheet_Connect**: An optional integration module that links a Business to the Runsheet logistics dispatch system via OAuth/API key, tenant mapping, and webhook automation
- **Prompt_Pack**: A set of AI agent system prompts, intent definitions, and conversation scripts tailored to a specific Vertical
- **Tool_Pack**: A set of backend functions available to the Voice_Agent during calls, scoped to a specific Vertical
- **Voice_Agent**: The AI-powered phone agent that handles inbound and outbound calls
- **Feature_Flag**: A configuration toggle that enables or disables a Vertical_Pack or integration module for a specific Business
- **Enabled_Modules**: An array on the Business entity listing which Vertical_Packs and integration modules are active for that tenant
- **Integration_Credential**: Stored OAuth tokens or API keys for external service connections such as Runsheet_Connect
- **Onboarding_Wizard**: The guided setup flow for new Businesses, including vertical selection, module activation, and optional integration linking
- **KPI_Dashboard**: The analytics view tracking performance metrics segmented by Vertical
- **Conversation_Type**: A classifier determining which Prompt_Pack and Tool_Pack the Voice_Agent uses for a given call
- **Convex**: The real-time backend database and API layer used by the application
- **Platform**: The top-level multi-tenant entity managing multiple Businesses

## Entity Model Mapping

This section defines the canonical entity hierarchy and terminology mapping to resolve ambiguity between legacy and platform-era concepts.

### Entity Hierarchy

```
Platform → Business → Location → User
```

- **Platform** owns many **Businesses**. A Platform represents the top-level multi-tenant operator (Dinee).
- **Business** is the canonical tenant entity. One Business can have many **Locations**.
- **Location** belongs to exactly one Business. A Location represents a physical site (restaurant branch, warehouse, clinic, office).
- **User** belongs to exactly one Business and optionally one Location.

### Terminology Mapping

| Legacy Term | Canonical Term | Notes |
|---|---|---|
| restaurant | Business | "restaurant" is now a vertical classification, not an entity type |
| branch | Location | All physical sites are Locations regardless of vertical |
| tenant | Business | "tenant" and "business" are synonymous; "Business" is the canonical term used in code and UI |

### `users.tenantType` Valid States

| Value | Status | Description |
|---|---|---|
| `"restaurant"` | Legacy — sunset planned | Original value from restaurant-only era. Will be removed at API v2 milestone (see Requirement 17). |
| `"business"` | Canonical | The standard value for all new and migrated records. |

During the dual-support period, the System accepts both values. New records SHALL use `"business"`. Migration step 1 (Requirement 16) backfills existing records but preserves `"restaurant"` until the sunset date.

## Requirements

### Requirement 1: Vertical-Aware Tenant Model

**User Story:** As a platform administrator, I want each Business to declare a vertical classification and a set of enabled modules, so that the platform loads different workflows and capabilities per business type.

#### Acceptance Criteria

1. THE Schema SHALL extend the `vertical` validator to support values: "general_services", "healthcare", "legal", "hospitality", "logistics", and "restaurant"
2. THE Schema SHALL add a `vertical` field to the Business (currently `restaurants`) table, defaulting to "restaurant" for existing records
3. THE Schema SHALL add an `enabledModules` array field to the Business table, containing string identifiers for active Vertical_Packs and integration modules
4. THE Schema SHALL add an `integrations` object field to the Business table with an optional `runsheet` sub-object for Runsheet_Connect configuration
5. WHEN a new Business is created, THE System SHALL require a valid `vertical` value from the supported set
6. WHEN a new Business is created without an `enabledModules` value, THE System SHALL default to the Core_Platform module set
7. IF a `vertical` value is provided that is not in the supported set, THEN THE System SHALL reject the operation with a validation error

### Requirement 2: Concept Renaming — Restaurant to Business

**User Story:** As a product owner, I want the platform to use generic business terminology instead of restaurant-specific language, so that the product appeals to any call-heavy business vertical.

#### Acceptance Criteria

1. THE System SHALL introduce a `businesses` table alias or migration path from the existing `restaurants` table, preserving all existing data and indexes
2. THE System SHALL rename user-facing labels from "Restaurant" to "Business" across all dashboard UI components
3. THE System SHALL rename user-facing labels from "Branch" to "Location" across all dashboard UI components
4. THE System SHALL update the `users` table role values to include "business_owner" alongside the existing "restaurant_owner" for backward compatibility
5. THE System SHALL update the `users` table tenantType values to include "business" alongside the existing "restaurant" for backward compatibility
6. WHEN existing API consumers send requests using "restaurant" terminology, THE System SHALL accept the requests without error for backward compatibility
7. THE System SHALL update all onboarding copy to reference "Business" and "Location" instead of "Restaurant" and "Branch"

### Requirement 3: Core Platform Module Separation

**User Story:** As a platform architect, I want core capabilities separated from vertical-specific modules, so that all verticals share the same foundational call management infrastructure.

#### Acceptance Criteria

##### 3A — Call Management Core
1. THE Core_Platform SHALL provide inbound call reception and outbound call initiation for all Businesses regardless of vertical
2. THE Core_Platform SHALL provide call routing by Location, directing inbound calls to the correct Location based on the called number's mapping
3. WHEN a Business has no Vertical_Packs enabled, THE System SHALL still accept and route inbound calls using Core_Platform call management

##### 3B — AI Receptionist Core
4. THE Core_Platform SHALL provide AI receptionist script execution using the base Voice_Agent model for all Businesses
5. THE Core_Platform SHALL provide real-time transcript capture, storing each dialogue turn within 2 seconds of utterance
6. THE Core_Platform SHALL provide call summary generation, producing a structured summary within 30 seconds of call completion

##### 3C — Quality and Analytics Core
7. THE Core_Platform SHALL provide QA scoring for all completed calls, evaluating against configurable quality rubrics
8. THE Core_Platform SHALL provide contact capture, extracting and storing caller name, phone number, and email when provided during a call

##### 3D — Task and Appointment Core
9. THE Core_Platform SHALL provide appointment/task capture, creating a structured record when the Voice_Agent identifies a scheduling intent during a call

##### 3E — Module Boundary and Isolation
10. THE System SHALL load Core_Platform modules without requiring any Vertical_Pack to be enabled
11. THE System SHALL ensure Core_Platform code paths contain no hard-coded references to restaurant-specific entities (menu items, food orders, restaurant IDs)
12. THE System SHALL define a module boundary interface that Vertical_Packs implement to extend Core_Platform behavior, including hooks for: custom intents, custom tools, custom UI sections, and custom analytics queries
13. WHEN a Vertical_Pack is disabled, THE System SHALL verify that no Core_Platform code path invokes any function from that pack's module boundary

### Requirement 4: Restaurant Vertical Pack

**User Story:** As a restaurant operator, I want all existing restaurant-specific features preserved as an activatable module pack, so that restaurant functionality continues working after the platform pivot.

#### Acceptance Criteria

1. THE Restaurant_Pack SHALL include: menu item management, food order capture and tracking, order status workflow (active → preparing → ready → completed → cancelled), upsell/cross-sell prompts, and restaurant-specific voice agent tools
2. WHEN a Business has vertical "restaurant" and "restaurant_pack" in enabledModules, THE System SHALL load all restaurant-specific UI components and API endpoints
3. THE System SHALL preserve all existing restaurant API routes and response schemas without breaking changes
4. THE System SHALL preserve all existing restaurant voice agent tools: get_restaurant_details, upsert_call_data, add_transcript_dialogue, upsert_order, generate_order_id
5. WHEN a Business does not have "restaurant_pack" in enabledModules, THE System SHALL hide restaurant-specific UI sections and disable restaurant-specific API endpoints for that Business
6. THE System SHALL backfill all existing restaurant tenants with vertical "restaurant" and enabledModules including "restaurant_pack" during migration

### Requirement 5: Logistics Vertical Pack

**User Story:** As a logistics operator, I want a logistics-specific module pack with dispatch, shipment tracking, and rider management, so that the platform supports logistics call workflows.

#### Acceptance Criteria

##### 5A — Shipment Lifecycle
1. THE Logistics_Pack SHALL provide shipment creation with required fields: origin Location, destination address, package description, and requested pickup time
2. THE Logistics_Pack SHALL support shipment lifecycle statuses: pending → assigned → picked_up → in_transit → delivered → failed, with each transition recorded as a ShipmentEvent
3. THE Logistics_Pack SHALL provide ETA calculation, returning an estimated delivery time based on origin, destination, and current shipment status
4. THE Logistics_Pack SHALL provide proof of delivery capture, storing a delivery confirmation (signature, photo reference, or recipient name) on the Shipment record

##### 5B — Rider Management
5. THE Logistics_Pack SHALL provide rider assignment, linking an available rider to a pending shipment and updating the shipment status to "assigned"
6. THE Logistics_Pack SHALL provide rider dispatch, notifying the assigned rider of pickup details and updating the shipment status to reflect dispatch
7. THE Logistics_Pack SHALL provide delivery status management, allowing riders to update shipment status through the platform

##### 5C — Voice Agent Intents
8. THE Logistics_Pack voice agent SHALL handle the `shipment_status_inquiry` intent, retrieving and reading back the current status and ETA for a shipment identified by tracking number or caller phone
9. THE Logistics_Pack voice agent SHALL handle the `pickup_scheduling` intent, creating a new shipment record with pickup details captured during the call
10. THE Logistics_Pack voice agent SHALL handle the `failed_delivery_callback` intent, logging a failed delivery reason and scheduling a redelivery or customer callback
11. THE Logistics_Pack voice agent SHALL handle the `rider_eta_inquiry` intent, retrieving and reading back the assigned rider's estimated arrival time

##### 5D — Module Activation and Integration
12. WHEN a Business has vertical "logistics" and "logistics_pack" in enabledModules, THE System SHALL load logistics-specific UI components and API endpoints
13. THE System SHALL reuse existing logistics schema entities (shipments, riders, shipmentEvents, locations) from the logistics-vertical spec
14. WHEN a Business does not have "logistics_pack" in enabledModules, THE System SHALL hide logistics-specific UI sections and disable logistics-specific API endpoints for that Business
15. THE Logistics_Pack SHALL integrate with Runsheet_Connect when the integration is enabled for the Business

### Requirement 6: Feature Flag Gating for Vertical Packs

**User Story:** As a platform administrator, I want vertical packs and integration modules controlled by feature flags, so that modules can be gradually rolled out and toggled per Business.

#### Acceptance Criteria

1. THE System SHALL extend the feature flag name validator to include: "restaurant_pack_enabled", "logistics_pack_enabled", "healthcare_pack_enabled", "legal_pack_enabled", "hospitality_pack_enabled", "general_services_pack_enabled", and "runsheet_connect_enabled"
2. WHEN a Vertical_Pack feature flag is disabled for a Business, THE System SHALL prevent that Business from accessing the pack's UI components, API endpoints, and voice agent tools
3. THE System SHALL evaluate feature flags using the existing hierarchical resolution: global → platform → business → location
4. WHEN a new vertical pack is deployed, THE System SHALL default the corresponding feature flag to disabled at the global scope
5. THE System SHALL support enabling a vertical pack for a single Business without affecting other Businesses on the same Platform
6. THE System SHALL log all feature flag changes with the flag name, old value, new value, scope, and actor for audit purposes
7. THE System SHALL treat the `enabledModules` array on the Business record as the tenant configuration source of truth for which modules are active
8. THE System SHALL treat feature flags (`*_enabled`) as rollout guardrails used during deployment phases only, not as the primary module activation mechanism
9. WHEN both `enabledModules` and a feature flag exist for a module, THE System SHALL apply this precedence rule: `enabledModules` determines activation UNLESS the corresponding feature flag is explicitly set to disabled, in which case the feature flag acts as a kill switch and the module is deactivated regardless of `enabledModules`
10. THE System SHALL document the `enabledModules` vs feature flag precedence rule in the platform developer guide and include it in the module resolution logic's inline code comments

### Requirement 7: Runsheet Connect Integration Module

**User Story:** As a logistics operator, I want to connect my Dinee account to Runsheet for dispatch automation, so that shipment events flow between the two systems automatically.

#### Acceptance Criteria

1. THE System SHALL provide a Runsheet_Connect configuration UI under an "Integrations" section in the Business settings dashboard
2. THE Runsheet_Connect module SHALL support authentication via OAuth token or API key stored as an Integration_Credential
3. THE System SHALL store Runsheet_Connect credentials in the Business integrations.runsheet object with fields: apiKey (encrypted), tenantMapping (object mapping Dinee locationIds to Runsheet hub IDs), webhookUrl (auto-generated callback URL), lastSyncAt (timestamp), and status ("connected", "disconnected", "error")
4. WHEN Runsheet_Connect is enabled, THE System SHALL automatically register a webhook subscription with Runsheet for shipment status updates
5. THE System SHALL display a health status panel showing: connection status, last successful sync timestamp, failure count, and retry queue depth
6. IF the Runsheet API returns an authentication error, THEN THE System SHALL update the integration status to "error" and display a reconnection prompt
7. THE System SHALL validate tenant mapping completeness: each active Location in the Business SHALL have a corresponding Runsheet hub ID mapping

### Requirement 8: Runsheet Webhook Automation

**User Story:** As a platform operator, I want Runsheet webhook events processed automatically, so that shipment status updates from Runsheet are reflected in the Dinee platform in real time.

#### Acceptance Criteria

1. THE System SHALL expose a webhook endpoint at `/api/v1/integrations/runsheet/webhook` that accepts Runsheet event payloads
2. WHEN a Runsheet webhook event is received, THE System SHALL validate the event signature using the stored Runsheet API key
3. WHEN a valid shipment status event is received from Runsheet, THE System SHALL update the corresponding Shipment deliveryStatus in the Dinee database
4. WHEN a valid rider assignment event is received from Runsheet, THE System SHALL update the corresponding Shipment assignedRiderId in the Dinee database
5. THE System SHALL create a ShipmentEvent audit log entry for each processed Runsheet webhook event with actorType "system"
6. IF a Runsheet webhook event references a shipmentId not found in the Dinee database, THEN THE System SHALL log the event as unmatched and increment the failure count on the health status panel
7. THE System SHALL process Runsheet webhook events idempotently using the event ID as a deduplication key

### Requirement 9: Call Agent Vertical-Aware Prompt Packs

**User Story:** As a platform administrator, I want the voice agent to load different prompt packs based on the Business vertical, so that the AI receptionist speaks with domain-appropriate language and handles domain-specific intents.

#### Acceptance Criteria

1. THE System SHALL define a Prompt_Pack interface with fields: systemPrompt (string), intents (array of intent definitions), toneGuidance (string), and greetingTemplate (string)
2. THE System SHALL implement a restaurant Prompt_Pack with intents: menu_inquiry, place_order, order_status, reservation, and general_inquiry
3. THE System SHALL implement a logistics Prompt_Pack with intents: shipment_status, pickup_scheduling, failed_delivery_callback, rider_eta, and general_inquiry
4. THE System SHALL implement a general_services Prompt_Pack with intents: appointment_booking, service_inquiry, callback_request, and general_inquiry
5. WHEN an inbound call is received, THE System SHALL determine the Business vertical from the called number's associated Business record and load the corresponding Prompt_Pack
6. THE System SHALL keep the base receptionist AI model the same across all verticals; only the Prompt_Pack and Tool_Pack SHALL change per vertical
7. WHEN a vertical does not have a dedicated Prompt_Pack, THE System SHALL fall back to the general_services Prompt_Pack

### Requirement 10: Call Agent Vertical-Aware Tool Packs

**User Story:** As a platform administrator, I want the voice agent to have access to different backend tools based on the Business vertical, so that domain-specific actions are available during calls.

#### Acceptance Criteria

1. THE System SHALL define a Tool_Pack registry that maps each vertical to a set of available voice agent tools
2. THE Restaurant Tool_Pack SHALL include: get_restaurant_details, upsert_call_data, add_transcript_dialogue, upsert_order, generate_order_id
3. THE Logistics Tool_Pack SHALL include: create_shipment, update_shipment, assign_rider, add_shipment_event, quote_delivery, and optionally push_event_to_runsheet when Runsheet_Connect is enabled
4. THE General_Services Tool_Pack SHALL include: upsert_call_data, add_transcript_dialogue, create_appointment, and capture_contact
5. WHEN a call is active, THE Voice_Agent SHALL restrict available tools to the Tool_Pack matching the Business vertical
6. IF a voice agent tool call targets a tool not in the active Tool_Pack, THEN THE System SHALL reject the call with an error and log the violation
7. THE System SHALL support extending Tool_Packs with integration-specific tools (Runsheet push) when the corresponding integration is enabled

### Requirement 11: Call Session Metadata Extension

**User Story:** As a platform operator, I want call session records to include vertical and workflow context, so that calls can be analyzed and routed by business type.

#### Acceptance Criteria

1. THE Schema SHALL add a `workflow_type` field to the `calls` table indicating the active Prompt_Pack used during the call
2. THE Schema SHALL add an `integration_context` optional object field to the `calls` table storing integration-specific metadata (Runsheet session ID, external reference IDs)
3. WHEN a call is initiated, THE System SHALL populate the `vertical` field from the Business record associated with the called number
4. WHEN a call is initiated, THE System SHALL populate the `workflow_type` field based on the selected Prompt_Pack
5. THE System SHALL include vertical, workflow_type, and integration_context in call transcript exports and analytics queries
6. THE System SHALL preserve existing call fields and indexes without modification for backward compatibility

### Requirement 12: Updated Onboarding Wizard

**User Story:** As a new Business owner, I want the onboarding wizard to let me choose my business type and activate relevant module packs, so that the platform is configured for my industry from the start.

#### Acceptance Criteria

1. THE Onboarding_Wizard SHALL present a "Business Type" selection step with options: Restaurant, Logistics, Healthcare, Legal, Hospitality, and General Services
2. WHEN a Business type is selected, THE Onboarding_Wizard SHALL display the available Vertical_Packs for that type and allow the user to enable or disable each pack
3. THE Onboarding_Wizard SHALL present an optional "Connect Integrations" step showing available integrations (Runsheet_Connect for logistics vertical)
4. WHEN the user completes onboarding, THE System SHALL create the Business record with the selected vertical, enabledModules, and integration configurations
5. THE Onboarding_Wizard SHALL replace all "Restaurant Setup" labels with "Business Setup" and "Branch Setup" labels with "Location Setup"
6. THE Onboarding_Wizard SHALL preserve the existing menu extraction step when the restaurant vertical pack is selected
7. WHEN the user selects the logistics vertical, THE Onboarding_Wizard SHALL present location setup (hub/warehouse configuration) instead of menu extraction

### Requirement 13: Dashboard Vertical Awareness

**User Story:** As a Business operator, I want the dashboard to show only the sections relevant to my vertical and enabled modules, so that the interface is not cluttered with irrelevant features.

#### Acceptance Criteria

1. THE Dashboard SHALL render navigation items and content sections based on the Business's enabledModules array
2. WHEN "restaurant_pack" is in enabledModules, THE Dashboard SHALL show: Orders, Menu Management, Upsell Prompts, and Restaurant Analytics sections
3. WHEN "logistics_pack" is in enabledModules, THE Dashboard SHALL show: Shipments, Riders, Dispatch, and Logistics Analytics sections
4. WHEN "runsheet_connect" is in enabledModules, THE Dashboard SHALL show an "Integrations > Runsheet" section under Settings
5. THE Dashboard SHALL always show Core_Platform sections: Calls, Transcripts, Contacts, Appointments/Tasks, and Settings regardless of enabled modules
6. WHEN a module is disabled for a Business, THE Dashboard SHALL hide the corresponding navigation items and return a 403 response if the user navigates directly to a disabled module's URL
7. THE Dashboard SHALL update the header and branding to reflect "Dinee AI Reception OS" instead of restaurant-specific branding

### Requirement 14: Billing and Packaging Updates

**User Story:** As a platform administrator, I want billing plans structured around base platform access with vertical pack and integration add-ons, so that pricing scales with the features each Business uses.

#### Acceptance Criteria

1. THE System SHALL define base Dinee plans that include Core_Platform capabilities for all verticals
2. THE System SHALL support add-on billing items for each Vertical_Pack: restaurant_pack, logistics_pack, healthcare_pack, legal_pack, hospitality_pack, general_services_pack
3. THE System SHALL support an add-on billing item for Runsheet_Connect integration
4. THE System SHALL track usage billing based on call minutes consumed per Business per billing period
5. THE System SHALL support optional automation action billing for integration-triggered events (Runsheet webhook processing, automated dispatch)
6. THE Subscription model SHALL include a `vertical` field and an `addOns` array field listing active paid add-ons
7. WHEN a Business enables a paid Vertical_Pack or integration, THE System SHALL create or update the subscription to include the corresponding add-on billing item

### Requirement 15: KPI Tracking by Vertical

**User Story:** As a platform administrator, I want KPI metrics segmented by vertical, so that I can compare performance and business health across different industry segments.

#### Acceptance Criteria

1. THE KPI_Dashboard SHALL track and display: active tenant count segmented by vertical
2. THE KPI_Dashboard SHALL track and display: Runsheet_Connect attach rate, calculated as: (logistics Businesses with integrations.runsheet.status = "connected") / (total Businesses with vertical = "logistics"), expressed as a percentage
3. THE KPI_Dashboard SHALL track and display: revenue per tenant segmented by vertical, calculated as: (total billed amount in the billing period) / (count of active Businesses in that period), computed independently per vertical
4. THE KPI_Dashboard SHALL track and display: call-to-outcome conversion rate segmented by vertical using these definitions:
   - Restaurant: (calls resulting in an order with status ≠ "cancelled" placed within 30 minutes of call end) / (total inbound calls to restaurant Businesses in the period)
   - Logistics: (calls resulting in a shipment created within 60 minutes of call end) / (total inbound calls to logistics Businesses in the period)
   - General Services: (calls resulting in an appointment scheduled within 24 hours of call end) / (total inbound calls to general services Businesses in the period)
5. THE KPI_Dashboard SHALL track and display: churn rate segmented by vertical, calculated as: (Businesses with zero inbound calls in the trailing 30-day window) / (total active Businesses), computed independently per vertical
6. THE System SHALL store KPI metric snapshots with a vertical dimension for historical trend analysis
7. WHEN filtering KPI data, THE System SHALL support filtering by vertical, date range, and platform
8. THE System SHALL use UTC timezone for all metric period boundaries (day, week, month start/end)
9. THE System SHALL document attribution windows and inclusion/exclusion rules per metric: a call is attributed to the period in which the call ended; only Businesses with at least one completed onboarding step are counted as "active"; Businesses created within the current period are excluded from churn calculation for that period

### Requirement 16: Safe Migration Rollout Sequence

**User Story:** As a platform engineer, I want a defined migration sequence with feature flags at each step, so that the pivot can be rolled out incrementally without breaking existing tenants.

#### Acceptance Criteria

1. THE Migration SHALL follow this sequence: (1) add vertical field and backfill existing tenants to "restaurant", (2) add feature flags for vertical packs, (3) move restaurant-only flows behind restaurant_pack feature flag, (4) add Runsheet_Connect integration module and credential storage, (5) add logistics prompt pack and intent handlers, (6) update onboarding wizard, (7) update documentation and marketing site
2. WHEN step 1 is executed, THE System SHALL backfill all existing Business records with vertical "restaurant" and enabledModules ["core_platform", "restaurant_pack"]
3. WHEN step 3 is executed, THE System SHALL gate all restaurant-specific UI components and API endpoints behind the "restaurant_pack_enabled" feature flag
4. THE System SHALL support rolling back each migration step independently using feature flags without data loss
5. WHEN a migration step fails, THE System SHALL log the failure with affected tenant IDs and provide a retry mechanism
6. THE System SHALL validate that each migration step completes successfully before proceeding to the next step
7. THE System SHALL maintain backward-compatible API endpoints throughout the entire migration sequence
8. THE System SHALL ensure each migration step is idempotent, producing the same result whether executed once or multiple times on the same data set
9. THE System SHALL provide a dry-run mode for each migration step that reports the count and sample of affected records without modifying any data
10. THE System SHALL provide an explicit rollback script for each migration step that reverses the step's changes without affecting subsequent steps
11. THE System SHALL define a success SLO per migration step: at least 99.9% of targeted records SHALL be migrated successfully, with automated validation checks confirming record counts and field integrity after each step
12. WHEN a migration step produces failed records, THE System SHALL log each failure with the affected Business ID (tenant ID), record ID, error message, and step identifier for manual remediation

### Requirement 17: Schema and API Backward Compatibility

**User Story:** As an existing API consumer, I want all current API endpoints and data schemas to remain functional during and after the pivot, so that my integrations are not disrupted.

#### Acceptance Criteria

1. THE System SHALL preserve all existing restaurant API routes under `/api/v1/partner/` without path changes
2. THE System SHALL preserve all existing request and response schemas for restaurant endpoints
3. WHEN an API request does not include a vertical header, THE System SHALL default to "restaurant" behavior
4. THE System SHALL accept both "restaurantId" and "businessId" as valid identifiers in API requests during the transition period
5. THE System SHALL return both "restaurantId" and "businessId" fields in API responses during the transition period for backward compatibility
6. IF a deprecated field name is used in a request, THEN THE System SHALL process the request normally and include a deprecation warning header in the response using the format: `Deprecation: <field_name>; sunset=<YYYY-MM-DD>; use=<replacement_field>`
7. THE System SHALL maintain existing webhook event schemas and add new vertical-specific event types without modifying existing event type payloads
8. THE System SHALL define a dual-support period of 6 months from the pivot launch date, during which both legacy ("restaurant", "restaurantId") and canonical ("business", "businessId") terminology are accepted
9. THE System SHALL gate removal of deprecated fields and endpoints behind the API v2 versioning milestone; deprecated items SHALL NOT be removed before API v2 is released
10. THE System SHALL publish a migration guide for API consumers at least 30 days before the dual-support period begins, documenting all field renames, endpoint changes, and recommended migration steps
11. WHEN the dual-support period ends, THE System SHALL reject requests using deprecated field names with a 400 response and a message referencing the migration guide URL
### Requirement 18: Integration Security and Compliance

**User Story:** As a platform security officer, I want all integration credentials and webhook flows protected by encryption, access control, and audit logging, so that external service connections do not introduce security vulnerabilities.

#### Acceptance Criteria

1. THE System SHALL encrypt all Integration_Credential secrets (API keys, OAuth tokens) at rest using AES-256 or equivalent encryption
2. THE System SHALL mask Integration_Credential secrets in all UI displays and application logs, showing only the last 4 characters (e.g., `••••••••a1b2`)
3. THE System SHALL provide a key rotation flow for Integration_Credentials: the Business owner generates a new credential, the System validates connectivity with the new credential, and only then deactivates the old credential
4. WHEN an Integration_Credential approaches its configured expiry date, THE System SHALL notify the Business owner via dashboard alert at 30 days, 7 days, and 1 day before expiry
5. IF an Integration_Credential has expired, THEN THE System SHALL update the integration status to "error", cease outbound API calls using the expired credential, and display a renewal prompt
6. THE System SHALL restrict Runsheet_Connect connect and disconnect operations to users with role "business_owner" or "platform_admin"; users with other roles SHALL receive a 403 Forbidden response
7. WHEN a Runsheet webhook event is received, THE System SHALL validate the webhook signature using HMAC-SHA256 and reject events with invalid signatures, returning a 401 response
8. THE System SHALL enforce replay protection on webhook events by rejecting any event with a timestamp older than 5 minutes from the current server time (UTC)
9. THE System SHALL create an audit log entry for every integration credential change (create, rotate, revoke, expire) including: actor user ID, actor role, Business ID, integration name, action type, and timestamp
10. THE System SHALL make integration audit log entries immutable and accessible to platform_admin users through the admin dashboard
