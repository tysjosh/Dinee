# Implementation Plan: AI Reception OS Pivot

## Overview

This plan follows the 7-step safe migration sequence defined in the design. Each task builds incrementally on the previous, starting with schema changes and core infrastructure, then layering vertical packs, registries, integrations, UI updates, and finally KPI computation. Property-based tests and unit tests are placed close to the code they validate. All existing restaurant functionality is preserved behind the `restaurant_pack` module with full backward compatibility.

## Tasks

- [x] 1. Schema changes and vertical-aware tenant model
  - [x] 1.1 Extend the vertical validator in `convex/shared/validators.ts` to support all 6 verticals: general_services, healthcare, legal, hospitality, logistics, restaurant
    - Update `verticalValidator` to a `v.union` of all 6 literals
    - Extend `conversationTypeValidator` with new conversation types for general_services, healthcare, legal, and hospitality
    - Extend `featureFlagNameValidator` with vertical pack flags and `runsheet_connect_enabled`
    - Extend `featureFlagScopeValidator` with `"business"` scope
    - _Requirements: 1.1, 6.1, 11.1_

  - [x] 1.2 Add new fields to the `restaurants` table in the Convex schema
    - Add `vertical` field (optional, verticalValidator) for backward compat
    - Add `enabledModules` field (optional array of strings)
    - Add `integrations` object field with optional `runsheet` sub-object containing apiKeyEncrypted, apiKeyLast4, tenantMapping, webhookUrl, webhookSecret, lastSyncAt, status, failureCount, credentialExpiresAt
    - Add `by_vertical` index
    - _Requirements: 1.2, 1.3, 1.4, 7.3_

  - [x] 1.3 Extend the `users` table schema with new role and tenantType values
    - Add `"business_owner"` to role union validator
    - Add `"business"` to tenantType union validator
    - _Requirements: 2.4, 2.5_

  - [x] 1.4 Extend the `calls` table schema with workflow_type and integration_context fields
    - Add `workflow_type` optional string field
    - Add `integration_context` optional object with runsheetSessionId and externalReferenceIds
    - _Requirements: 11.1, 11.2_

  - [x] 1.5 Extend the `subscriptions` table schema with vertical and addOns fields
    - Add `vertical` optional field using verticalValidator
    - Add `addOns` optional array of strings
    - _Requirements: 14.6_

  - [x] 1.6 Create new tables: kpiSnapshots, integrationAuditLog, webhookDeduplication
    - Define `kpiSnapshots` table with snapshotId, metricName, vertical, periodType, periodStart, periodEnd, value, metadata, createdAt and indexes
    - Define `integrationAuditLog` table with entryId, businessId, integrationName, actionType, actorUserId, actorRole, details, createdAt and indexes
    - Define `webhookDeduplication` table with eventId, provider, processedAt, expiresAt and indexes
    - _Requirements: 15.6, 18.9, 8.7_

- [x] 2. Module resolver and pack registries
  - [x] 2.1 Implement the module boundary interface types in `src/lib/modules/types.ts`
    - Define VerticalPack, PromptPack, IntentDefinition, ToolDefinition, ToolParameter, UISectionDescriptor, AnalyticsQueryDescriptor, IntegrationHook interfaces
    - Export Vertical type alias matching the 6 supported verticals
    - _Requirements: 3E.12, 9.1, 10.1_

  - [x] 2.2 Implement the module resolver in `src/lib/modules/moduleResolver.ts`
    - Implement `resolveModule(businessEnabledModules, moduleName, featureFlags)` with the precedence rule: enabledModules is source of truth, feature flag is kill switch
    - Return `"allowed"`, `"blocked_not_activated"`, or `"blocked_kill_switch"`
    - Add inline code comments documenting the enabledModules vs feature flag precedence rule
    - _Requirements: 6.7, 6.8, 6.9, 6.10_

  - [x] 2.3 Write property test for module resolution correctness
    - **Property 1: Module Resolution Correctness**
    - **Validates: Requirements 6.7, 6.8, 6.9**
    - Create `__tests__/properties/moduleResolution.test.ts`
    - Generate random enabledModules subsets, feature flag maps (true/false/undefined), and target module names
    - Assert resolveModule returns the correct resolution per the precedence truth table
    - Minimum 100 iterations with fast-check

  - [x] 2.4 Implement the prompt pack registry in `src/lib/modules/promptPackRegistry.ts`
    - Implement `registerPromptPack(vertical, pack)` and `getPromptPack(vertical)` with general_services fallback
    - _Requirements: 9.5, 9.7_

  - [x] 2.5 Implement the tool pack registry in `src/lib/modules/toolPackRegistry.ts`
    - Implement `registerToolPack(vertical, tools)` and `getToolPack(vertical, enabledModules)` with integration-gated tool filtering
    - Implement `validateToolCall(toolName, vertical, enabledModules)` to enforce tool access
    - _Requirements: 10.1, 10.5, 10.6, 10.7_

  - [x] 2.6 Write property test for tool pack enforcement
    - **Property 3: Tool Pack Enforcement**
    - **Validates: Requirements 10.5, 10.6, 10.7**
    - Create `__tests__/properties/toolPackEnforcement.test.ts`
    - Generate random verticals, enabledModules, and tool names from all packs plus invalid names
    - Assert validateToolCall returns true iff tool is in getToolPack(V, M)
    - Minimum 100 iterations with fast-check

  - [x] 2.7 Implement the UI section registry in `src/lib/modules/uiSectionRegistry.ts`
    - Implement `registerUISections(descriptors)` and `getVisibleSections(enabledModules)` filtering by requiredModule
    - Core sections (requiredModule = "core_platform") always included
    - _Requirements: 13.1, 13.5_

  - [x] 2.8 Write property test for vertical isolation
    - **Property 2: Vertical Isolation**
    - **Validates: Requirements 3E.13, 4.2, 4.5, 5D.12, 5D.14, 13.1, 13.5, 13.6**
    - Create `__tests__/properties/verticalIsolation.test.ts`
    - Generate random Business configs with random verticals and enabledModules subsets
    - Assert getVisibleSections returns only core_platform sections and sections matching enabledModules
    - Minimum 100 iterations with fast-check

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Restaurant vertical pack implementation
  - [x] 4.1 Create the restaurant pack definition in `src/lib/modules/packs/restaurantPack.ts`
    - Define the VerticalPack object with moduleId "restaurant_pack", vertical "restaurant"
    - Register restaurant prompt pack with intents: menu_inquiry, place_order, order_status, reservation, general_inquiry
    - Register restaurant tool pack: get_restaurant_details, upsert_call_data, add_transcript_dialogue, upsert_order, generate_order_id
    - Register restaurant UI sections: Orders, Menu Management, Upsell Prompts, Restaurant Analytics
    - _Requirements: 4.1, 4.4, 9.2, 10.2, 13.2_

  - [x] 4.2 Create pack registration entry point in `src/lib/modules/packs/index.ts`
    - Export a `registerAllPacks()` function that registers restaurant pack (and later other packs) with all registries
    - _Requirements: 3E.12_

- [x] 5. Logistics vertical pack and Runsheet Connect integration
  - [x] 5.1 Create the logistics pack definition in `src/lib/modules/packs/logisticsPack.ts`
    - Define the VerticalPack with moduleId "logistics_pack", vertical "logistics"
    - Register logistics prompt pack with intents: shipment_status_inquiry, pickup_scheduling, failed_delivery_callback, rider_eta_inquiry, general_inquiry
    - Register logistics tool pack: create_shipment, update_shipment, assign_rider, add_shipment_event, quote_delivery, push_event_to_runsheet (requiresIntegration: "runsheet_connect")
    - Register logistics UI sections: Shipments, Riders, Dispatch, Logistics Analytics
    - _Requirements: 5A, 5B, 5C, 5D, 9.3, 10.3, 13.3_

  - [x] 5.2 Create the general services pack definition in `src/lib/modules/packs/generalServicesPack.ts`
    - Define the VerticalPack with moduleId "general_services_pack", vertical "general_services"
    - Register general_services prompt pack with intents: appointment_booking, service_inquiry, callback_request, general_inquiry
    - Register general_services tool pack: upsert_call_data, add_transcript_dialogue, create_appointment, capture_contact
    - _Requirements: 9.4, 10.4_

  - [x] 5.3 Implement the Runsheet Connect client in `src/lib/integrations/runsheetClient.ts`
    - Implement RunsheetClient class with registerWebhook, pushShipmentEvent, validateWebhookSignature methods
    - Implement HMAC-SHA256 signature validation with timing-safe comparison
    - _Requirements: 7.4, 8.2, 18.7_

  - [x] 5.4 Implement the encryption service for integration credentials in `src/lib/integrations/encryptionService.ts`
    - Implement AES-256-GCM encrypt/decrypt functions using INTEGRATION_ENCRYPTION_KEY env var
    - Random IV per encryption, prepended to ciphertext
    - Extract apiKeyLast4 for safe UI display
    - _Requirements: 18.1, 18.2_

  - [x] 5.5 Write property test for integration security — credential non-exposure
    - **Property 7: Integration Security — Credential Non-Exposure**
    - **Validates: Requirements 18.1, 18.2**
    - Create `__tests__/properties/integrationSecurity.test.ts`
    - Generate random credential strings, encrypt, assert ciphertext does not contain plaintext
    - Assert decrypt(encrypt(value)) === value (round-trip)
    - Assert mock API response serialization does not contain plaintext key
    - Minimum 100 iterations with fast-check

  - [x] 5.6 Implement Runsheet webhook endpoint handler in a Convex HTTP action or API route
    - Validate HMAC-SHA256 signature using stored webhookSecret
    - Enforce replay protection: reject events with timestamp > 5 minutes old
    - Deduplicate by eventId using webhookDeduplication table
    - Process shipment_status events: update Shipment deliveryStatus
    - Process rider_assignment events: update Shipment assignedRiderId
    - Create ShipmentEvent audit log entry for each processed event
    - Log unmatched shipmentIds and increment failure count
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 18.7, 18.8_

  - [x] 5.7 Write property test for webhook idempotency
    - **Property 6: Webhook Idempotency**
    - **Validates: Requirements 8.7, 8.3, 8.4, 8.5**
    - Create `__tests__/properties/webhookIdempotency.test.ts`
    - Generate random valid webhook events, process N times, assert same DB state as processing once
    - Assert exactly one ShipmentEvent and one webhookDeduplication entry per eventId
    - Minimum 100 iterations with fast-check

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. API backward compatibility layer
  - [x] 7.1 Implement dual ID normalization in `src/lib/partner-api/dualIdSupport.ts`
    - Implement `normalizeBusinessId(params)` accepting both restaurantId and businessId
    - Return `{ businessId, usedDeprecatedField }` with proper flag
    - Throw error when neither field is provided
    - _Requirements: 17.4, 17.5_

  - [x] 7.2 Implement deprecation header middleware in `src/lib/partner-api/deprecationHeaders.ts`
    - Add `Deprecation: <field_name>; sunset=<date>; use=<replacement>` header when deprecated fields are used
    - Enrich responses with both restaurantId and businessId during dual-support period
    - _Requirements: 17.6, 17.5_

  - [x] 7.3 Write property test for backward compatibility — dual ID normalization
    - **Property 4: Backward Compatibility — Dual ID Normalization**
    - **Validates: Requirements 2.6, 17.4, 17.5, 17.6**
    - Create `__tests__/properties/backwardCompat.test.ts`
    - Generate random non-empty ID strings
    - Assert normalizeBusinessId({ restaurantId: id }).businessId === id
    - Assert normalizeBusinessId({ businessId: id }).businessId === id
    - Assert usedDeprecatedField flags are correct
    - Assert normalizeBusinessId({}) throws
    - Minimum 100 iterations with fast-check

- [x] 8. Migration steps implementation
  - [x] 8.1 Implement migration step 1: add vertical field and backfill existing tenants in `convex/migrations/step1_addVerticalField.ts`
    - Idempotent mutation with dryRun and batchSize args
    - Backfill existing records with vertical "restaurant" and enabledModules ["core_platform", "restaurant_pack"]
    - Skip records that already have vertical set (idempotency)
    - Return success/failure counts and sample of affected records in dry-run mode
    - _Requirements: 16.1, 16.2, 16.8, 16.9_

  - [x] 8.2 Implement migration step 2: add feature flags for vertical packs in `convex/migrations/step2_addFeatureFlags.ts`
    - Create feature flag records for all vertical pack flags and runsheet_connect_enabled
    - Default all flags to disabled at global scope
    - Idempotent: skip flags that already exist
    - _Requirements: 16.1, 6.4_

  - [x] 8.3 Implement migration step 3: gate restaurant flows behind feature flag in `convex/migrations/step3_gateRestaurantFlows.ts`
    - Enable restaurant_pack_enabled flag for all existing restaurant businesses
    - Idempotent execution
    - _Requirements: 16.1, 16.3_

  - [x] 8.4 Write property test for migration idempotency
    - **Property 5: Migration Idempotency**
    - **Validates: Requirements 16.8, 4.6, 16.2**
    - Create `__tests__/properties/migrationIdempotency.test.ts`
    - Generate random Business record sets with partial migration states
    - Run migration step, capture state, run again, assert states are identical
    - Verify dry-run mode leaves state unchanged
    - Minimum 100 iterations with fast-check

- [x] 9. Onboarding wizard updates
  - [x] 9.1 Add Business Type Selection step to the onboarding wizard
    - Create a vertical picker component with icons and descriptions for all 6 verticals
    - Store selected vertical in onboarding state
    - Replace "Restaurant Setup" labels with "Business Setup" and "Branch Setup" with "Location Setup"
    - _Requirements: 12.1, 12.5, 2.2, 2.3, 2.7_

  - [x] 9.2 Add Module Activation step to the onboarding wizard
    - Show available vertical packs for the selected vertical with toggle switches
    - Default core_platform as always enabled (non-toggleable)
    - _Requirements: 12.2_

  - [x] 9.3 Add Integration Setup step (conditional) to the onboarding wizard
    - Show Runsheet Connect option when logistics vertical is selected
    - Collect API key and tenant mapping configuration
    - _Requirements: 12.3, 12.7_

  - [x] 9.4 Update onboarding completion mutation to create Business with vertical, enabledModules, and integration config
    - Ensure vertical is set from selection, enabledModules always includes "core_platform"
    - Preserve menu extraction step for restaurant vertical
    - Present hub/warehouse configuration for logistics vertical
    - _Requirements: 12.4, 12.6, 12.7, 1.5, 1.6_

  - [x] 9.5 Write property test for onboarding completeness
    - **Property 10: Onboarding Completeness**
    - **Validates: Requirements 1.5, 1.6, 12.4**
    - Create `__tests__/properties/onboardingCompleteness.test.ts`
    - Generate random vertical selections and module activation choices
    - Assert resulting Business has valid vertical, enabledModules includes "core_platform"
    - Assert vertical pack in enabledModules matches selected vertical
    - Minimum 100 iterations with fast-check

- [x] 10. Dashboard conditional rendering
  - [x] 10.1 Implement `useEnabledModules` hook in `src/hooks/useEnabledModules.ts`
    - Read Business enabledModules from context, default to ["core_platform"]
    - Expose `isModuleActive(moduleId)` helper and `visibleSections` from UI section registry
    - _Requirements: 13.1_

  - [x] 10.2 Update dashboard navigation to render tabs based on enabled modules
    - Always show core sections: Calls, Transcripts, Contacts, Appointments/Tasks, Settings
    - Conditionally show restaurant sections (Orders, Menu Management, etc.) when restaurant_pack active
    - Conditionally show logistics sections (Shipments, Riders, Dispatch, etc.) when logistics_pack active
    - Show Integrations > Runsheet under Settings when runsheet_connect active
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

  - [x] 10.3 Add route guard middleware for disabled module URLs
    - Return 403 when user navigates directly to a disabled module's URL
    - _Requirements: 13.6_

  - [x] 10.4 Update dashboard header and branding to "Dinee AI Reception OS"
    - Replace restaurant-specific branding across header, page titles, and meta tags
    - _Requirements: 13.7_

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration security and audit logging
  - [x] 12.1 Implement Runsheet Connect configuration UI under Business Settings > Integrations
    - API key input with masked display (last 4 chars only)
    - Tenant mapping editor (Location → Runsheet hub ID)
    - Health status panel: connection status, last sync, failure count
    - RBAC: restrict connect/disconnect to business_owner and platform_admin roles
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 18.2, 18.6_

  - [x] 12.2 Implement credential key rotation flow
    - Accept new API key, encrypt, test connectivity with Runsheet API
    - On success: replace old key, update apiKeyLast4, log audit entry
    - On failure: keep old key, show error
    - _Requirements: 18.3_

  - [x] 12.3 Implement credential expiry notifications and handling
    - Dashboard alerts at 30 days, 7 days, and 1 day before expiry
    - On expiry: set status to "error", cease outbound calls, show renewal prompt
    - _Requirements: 18.4, 18.5_

  - [x] 12.4 Implement integration audit log mutations and admin query
    - Create audit log entries for credential create, rotate, revoke, expire, connect, disconnect
    - Make entries immutable (no update/delete mutations)
    - Expose query for platform_admin users
    - _Requirements: 18.9, 18.10_

  - [x] 12.5 Write property test for feature flag kill switch
    - **Property 8: Feature Flag Kill Switch**
    - **Validates: Requirements 6.2, 6.9**
    - Create `__tests__/properties/featureFlagKillSwitch.test.ts`
    - Generate random modules in enabledModules, set flag to false at random scopes
    - Assert resolveModule returns "blocked_kill_switch"
    - Test hierarchical resolution: more specific scope overrides less specific
    - Minimum 100 iterations with fast-check

- [x] 13. KPI computation and dashboard
  - [x] 13.1 Implement KPI computation functions in Convex
    - Active tenant count by vertical
    - Runsheet attach rate for logistics vertical
    - Revenue per tenant by vertical
    - Call-to-outcome conversion rate by vertical with correct attribution windows (restaurant: 30min, logistics: 60min, general_services: 24hr)
    - Churn rate by vertical (zero calls in trailing 30 days)
    - Apply inclusion/exclusion rules: call attributed to period of call end, only onboarded businesses count as active, new businesses excluded from churn in creation period
    - All period boundaries in UTC
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.8, 15.9_

  - [x] 13.2 Implement KPI snapshot storage and scheduled computation
    - Create scheduled Convex action (cron) for daily snapshot computation
    - Store snapshots in kpiSnapshots table with vertical dimension
    - Support weekly and monthly rollups
    - _Requirements: 15.6_

  - [x] 13.3 Implement KPI dashboard UI with vertical filtering
    - Display metrics segmented by vertical
    - Support filtering by vertical, date range, and platform
    - _Requirements: 15.7_

  - [x] 13.4 Write property test for KPI attribution — single period assignment
    - **Property 9: KPI Attribution — Single Period Assignment**
    - **Validates: Requirements 15.8, 15.9**
    - Create `__tests__/properties/kpiAttribution.test.ts`
    - Generate random UTC timestamps for call endedAt
    - Assert call falls in exactly one daily, weekly, and monthly period
    - Test boundary timestamps (midnight UTC, first of month)
    - Assert new businesses excluded from churn in creation period
    - Minimum 100 iterations with fast-check

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The task order follows the 7-step safe migration sequence from the design
- Checkpoints ensure incremental validation at key milestones
- Property tests validate the 10 universal correctness properties from the design using fast-check
- All schema changes are additive — no existing fields or indexes are removed
- The `restaurants` table is extended in-place, not replaced, for backward compatibility
