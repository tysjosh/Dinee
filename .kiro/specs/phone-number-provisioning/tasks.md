# Implementation Plan: Phone Number Provisioning

## Overview

Implement dedicated per-branch phone number provisioning replacing the shared virtual number model. The system acquires numbers from telecom providers (Twilio, Vonage, Africa's Talking, Termii) with multi-provider failover, manages number lifecycle (assignment, release, quarantine), maintains a pre-purchased number pool for instant assignment, and integrates with the onboarding flow and dashboard. A feature flag controls gradual rollout while maintaining backward compatibility.

## Tasks

- [x] 1. Define schema tables and TypeScript types
  - [x] 1.1 Add `phoneNumbers` and `provisioningRequests` tables to `convex/schema.ts`
    - Add the `phoneNumbers` table with all required fields (numberId, phoneNumber, provider, status, capabilities, region, countryCode, createdAt), optional assignment fields (assignedToType, assignedToId, assignedAt, releasedAt), and optional lifecycle fields (quarantineExpiresAt, providerNumberSid, monthlyCost, currency, lastHealthCheckAt, healthStatus)
    - Add all indexes: by_number_id, by_phone_number, by_status, by_assigned_to, by_provider, by_quarantine_expires
    - Add the `provisioningRequests` table with all required fields (requestId, branchId, locationId, targetType, provider, status, region, countryCode, attemptCount, maxAttempts, lastError, phoneNumberId, createdAt, updatedAt, completedAt)
    - Add all indexes: by_request_id, by_branch_id, by_status, by_created_at
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Create shared TypeScript types and validators in `convex/shared/phoneProvisioningTypes.ts`
    - Define NumberStatus, HealthStatus, NumberCapability, AssignedToType, ProvisioningRequestStatus, TelecomProvider, ProvisioningRegion types
    - Define Convex validators for each type (numberStatusValidator, healthStatusValidator, etc.)
    - Define the provider routing table mapping regions to primary/secondary/tertiary providers
    - Define constants: QUARANTINE_PERIOD_MS (30 days), DEFAULT_POOL_MIN (5), MAX_PROVISION_ATTEMPTS (5), BACKOFF_DELAYS [5000, 30000, 120000, 600000]
    - Define E.164 phone number validation regex
    - Define transient vs non-transient error classification helper
    - _Requirements: 1.1, 1.5, 2.1, 4.4, 5.1, 6.1, 6.2, 6.4_

  - [x] 1.3 Write property test: Phone number record schema completeness (Property 1)
    - **Property 1: Phone number record schema completeness**
    - Generate random valid phone number records and verify all required fields are present with correct types, and optional fields are accepted when provided
    - Test file: `__tests__/properties/phoneNumberSchema.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 1.4 Write property test: Provisioning request record schema completeness (Property 2)
    - **Property 2: Provisioning request record schema completeness**
    - Generate random provisioning request records and verify all required fields are present, and branchId/locationId matches targetType
    - Test file: `__tests__/properties/provisioningRequestSchema.property.test.ts`
    - **Validates: Requirements 1.5**

- [x] 2. Implement provider routing and utility functions
  - [x] 2.1 Create `convex/phoneProvisioning/providerRouting.ts` with provider failover logic
    - Implement `getProviderOrder(region)` returning ordered list of providers for a region based on the routing table
    - Implement `getNextProvider(region, attemptedProviders)` returning the next untried provider
    - Implement `classifyError(error)` returning "transient" or "non_transient" based on error type
    - Implement `getBackoffDelay(attemptNumber)` returning the delay in ms for the given attempt
    - Implement `validateE164(phoneNumber)` returning boolean for E.164 format validation
    - Implement `generateNumberId()` and `generateRequestId()` for unique ID generation
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.4_

  - [x] 2.2 Write property test: Provider failover ordering (Property 3)
    - **Property 3: Provider failover ordering**
    - Generate random regions and failure sequences, verify provider attempt order matches routing table and never repeats an already-attempted provider
    - Test file: `__tests__/properties/providerFailover.property.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 2.3 Write property test: Exponential backoff retry delays (Property 16)
    - **Property 16: Exponential backoff retry delays**
    - Generate random attempt numbers (1-4), verify the computed delay matches the backoff schedule (5s, 30s, 2m, 10m) and total attempts do not exceed 5
    - Test file: `__tests__/properties/backoffDelays.property.test.ts`
    - **Validates: Requirements 6.1, 6.2**

  - [x] 2.4 Write property test: Non-transient errors are not retried (Property 17)
    - **Property 17: Non-transient errors are not retried**
    - Generate random non-transient error types (invalid credentials, account suspended, insufficient funds), verify no retry is scheduled
    - Test file: `__tests__/properties/nonTransientErrors.property.test.ts`
    - **Validates: Requirements 6.4**

- [x] 3. Add `dedicated_numbers_enabled` feature flag
  - Add `v.literal("dedicated_numbers_enabled")` to the `featureFlagNameValidator` union in `convex/featureFlags.ts`
  - _Requirements: 11.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement core provisioning mutations and actions
  - [x] 5.1 Create `convex/phoneProvisioning/mutations.ts` with core provisioning mutations
    - Implement `initiateProvisioning(branchId, region, countryCode)` mutation: check feature flag, check if branch already has a number (skip if so), check pool for available number, assign from pool or create provisioning request for on-demand purchase
    - Implement `assignNumberToBranch(phoneNumberId, branchId)` mutation: validate number is "available", update phoneNumbers record (status → "assigned", assignedToType, assignedToId, assignedAt), update branch record's phoneNumber field, reject if number not available
    - Implement `releaseNumber(phoneNumberId)` mutation: validate number is "assigned", transition to "releasing", clear assignment fields, set releasedAt, then transition to "quarantined" with quarantineExpiresAt
    - Implement `requestReplacement(branchId)` mutation: release current number, initiate new provisioning
    - Implement `updateHealthStatus(phoneNumberId, healthStatus)` mutation: update healthStatus and lastHealthCheckAt
    - Use createLogger for audit trail on all lifecycle events
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.1, 4.2, 4.4, 4.7, 9.6, 11.6, 13.1, 13.2, 13.3, 13.4_

  - [x] 5.2 Create `convex/phoneProvisioning/actions.ts` with provider API actions
    - Implement `purchaseNumberFromProvider(provider, region, countryCode)` action: call provider API (stubbed for now with TODO for real integration), validate voice capability, return number SID, E.164 number, monthly cost, currency
    - Implement `configureWebhook(provider, providerNumberSid, webhookUrl)` action: set voice webhook at provider
    - Implement `releaseNumberAtProvider(provider, providerNumberSid)` action: release number back to provider
    - Implement `checkNumberHealth(provider, providerNumberSid)` action: query provider for number status, return health classification
    - Implement `executeProvisioning(requestId)` action: orchestrate the full provisioning flow with retry logic, provider failover, backoff delays, and fallback to shared number on total failure
    - Emit monitoring alerts on critical failures via `monitoringAlerts.createAlert`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.6, 4.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 8.1, 12.3, 12.4_

  - [x] 5.3 Write property test: Assignment invariants (Property 7)
    - **Property 7: Assignment invariants**
    - Generate random branch IDs and available numbers, perform assignment, verify all record fields are correctly updated (status "assigned", assignedToType "branch", assignedToId, assignedAt)
    - Test file: `__tests__/properties/assignmentInvariants.property.test.ts`
    - **Validates: Requirements 3.3, 3.4, 3.5**

  - [x] 5.4 Write property test: Only available numbers can be assigned (Property 9)
    - **Property 9: Only available numbers can be assigned**
    - Generate random phone numbers with non-available statuses (assigned, quarantined, releasing, released, failed), verify assignment is rejected
    - Test file: `__tests__/properties/availableOnlyAssignment.property.test.ts`
    - **Validates: Requirements 3.7, 4.7**

  - [x] 5.5 Write property test: Release state transition chain (Property 11)
    - **Property 11: Release state transition chain**
    - Generate random assigned numbers, perform release, verify the full state transition chain (assigned → releasing → quarantined) and field updates (assignment cleared, releasedAt set, quarantineExpiresAt set)
    - Test file: `__tests__/properties/releaseTransition.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.4, 8.4**

- [x] 6. Implement queries
  - [x] 6.1 Create `convex/phoneProvisioning/queries.ts` with all provisioning queries
    - Implement `getPhoneNumberByBranch(branchId)` query: return assigned phone number record for a branch using by_assigned_to index
    - Implement `getProvisioningRequest(requestId)` query: return provisioning request by requestId
    - Implement `getProvisioningRequestsByBranch(branchId)` query: return provisioning history for a branch
    - Implement `getPoolStatus(region?)` query: return available number counts per region
    - Implement `getMonthlyPhoneNumberCosts(groupBy)` query: aggregate costs by provider or region
    - Implement `getBranchPhoneNumberCost(branchId)` query: return per-branch cost for billing
    - _Requirements: 8.2, 8.3, 9.1, 10.1_

  - [x] 6.2 Extend `convex/phoneLookup.ts` with provisioned number lookup
    - Add `getEntityByPhoneNumber(phoneNumber)` query: look up the `phoneNumbers` table first by by_phone_number index, resolve to branch or location based on assignedToType, fall back to existing getBranchByPhoneNumber/getLocationByPhoneNumber for non-provisioned numbers
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 6.3 Write property test: Cost aggregation correctness (Property 19)
    - **Property 19: Cost aggregation correctness**
    - Generate random sets of phone number records with costs, verify aggregation sums match per provider/region groups and per-branch cost returns correct value
    - Test file: `__tests__/properties/costAggregation.property.test.ts`
    - **Validates: Requirements 8.2, 8.3**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement scheduled functions (pool, quarantine, health)
  - [x] 8.1 Create `convex/phoneProvisioning/scheduledFunctions.ts` with scheduled jobs
    - Implement `processQuarantineExpirations` internal mutation: query quarantined numbers where quarantineExpiresAt < now, for each: if pool below minimum → set status "available" (retain in pool), if pool at/above minimum → call releaseNumberAtProvider action and set status "released"
    - Implement `replenishNumberPool` internal action: for each active region, count available numbers, if below minimum → purchase enough numbers to reach minimum via purchaseNumberFromProvider
    - Implement `runHealthChecks` internal action: query all "assigned" numbers, for each call checkNumberHealth, update healthStatus and lastHealthCheckAt, emit warning alert for unreachable numbers
    - _Requirements: 4.5, 4.6, 5.1, 5.2, 5.3, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.1, 12.2, 12.5_

  - [x] 8.2 Register scheduled functions in `convex/crons.ts`
    - Add `processQuarantineExpirations` cron running every 6 hours
    - Add `replenishNumberPool` cron running every 1 hour
    - Add `runHealthChecks` cron running every 4 hours
    - _Requirements: 4.6, 5.2, 7.2_

  - [x] 8.3 Write property test: Pool oldest-first selection (Property 13)
    - **Property 13: Pool oldest-first selection**
    - Generate random pools of available numbers with varying createdAt timestamps, verify the oldest is always selected for assignment
    - Test file: `__tests__/properties/poolOldestFirst.property.test.ts`
    - **Validates: Requirements 5.5**

  - [x] 8.4 Write property test: Pool invariant (Property 15)
    - **Property 15: Pool invariant**
    - Generate random pool states, verify no number with status "available" has assignedToId or assignedToType set
    - Test file: `__tests__/properties/poolInvariant.property.test.ts`
    - **Validates: Requirements 5.4**

  - [x] 8.5 Write property test: Health status correctness (Property 18)
    - **Property 18: Health status correctness**
    - Generate random health check results, verify healthStatus is correctly set (unreachable/degraded/healthy) and lastHealthCheckAt is always updated regardless of result
    - Test file: `__tests__/properties/healthStatus.property.test.ts`
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6**

  - [x] 8.6 Write property test: Quarantine expiry routing decision (Property 23)
    - **Property 23: Quarantine expiry routing decision**
    - Generate random quarantined numbers and pool sizes, verify correct routing: release to provider when pool >= minimum, retain in pool when pool < minimum
    - Test file: `__tests__/properties/quarantineExpiry.property.test.ts`
    - **Validates: Requirements 12.1, 12.2**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update onboarding flow with provisioning integration
  - [x] 10.1 Create `src/components/onboarding/VirtualNumberStep.tsx` replacing `VirtualNumberGenerator.tsx`
    - Check `dedicated_numbers_enabled` feature flag
    - If enabled: call `initiateProvisioning` mutation, show loading spinner during provisioning, display provisioned E.164 number formatted for locale on success, show provider attribution ("Powered by Twilio/Vonage/etc.")
    - If disabled or provisioning fails: fall back to shared number + Business ID display (existing behavior), show notification that dedicated number will be assigned later
    - If branch already has assigned number: display existing number without initiating new provisioning
    - Remove Business ID entry instruction from "How it works" when dedicated number is available
    - Maintain existing "Go to Dashboard" flow
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 11.4, 11.5_

  - [x] 10.2 Update `src/components/onboarding/index.ts` to export VirtualNumberStep
    - Update the export to reference the new VirtualNumberStep component
    - _Requirements: 9.1_

- [x] 11. Implement dashboard phone number management
  - [x] 11.1 Create `src/components/dashboard/PhoneNumberManagement.tsx`
    - Display assigned phone number, provider, status, health status, and monthly cost
    - Show health warning badges (yellow for "degraded", red for "unreachable") with issue descriptions
    - Provide "Request Replacement" button that opens a confirmation dialog explaining quarantine and disconnection message
    - On replacement confirmation: call `requestReplacement` mutation, show loading state, display new number on success
    - If branch has no dedicated number (shared number fallback): show "Request Dedicated Number" button that calls `initiateProvisioning`
    - Show shared number with Business ID instructions when no dedicated number is assigned
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.4, 11.5_

  - [x] 11.2 Integrate PhoneNumberManagement into `src/components/dashboard/SettingsSection.tsx`
    - Replace the hardcoded "AI Agent Phone Number" section with the PhoneNumberManagement component
    - Update the "Customer Instructions" section to conditionally show direct-dial instructions (dedicated number) or Business ID instructions (shared number) based on whether branch has a dedicated number
    - _Requirements: 10.1, 11.4, 11.5_

- [x] 12. Wire backward compatibility for call routing
  - [x] 12.1 Update call routing to support both dedicated and shared number flows
    - Ensure inbound calls on shared number (`NEXT_PUBLIC_VIRTUAL_NUMBER`) continue to prompt for Business ID and route via existing restaurantId lookup
    - Ensure inbound calls on provisioned dedicated numbers use `getEntityByPhoneNumber` from phoneLookup to resolve branch directly without Business ID prompt
    - Both routing modes must work simultaneously
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Provider API actions are stubbed initially with TODOs for real Twilio/Vonage/Africa's Talking/Termii integration
- The implementation uses TypeScript throughout (Convex backend + React frontend)
- fast-check and vitest are already configured in the project
