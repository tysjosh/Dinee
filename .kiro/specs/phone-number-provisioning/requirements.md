# Requirements Document

## Introduction

This document defines the requirements for implementing phone number provisioning in the Dinee restaurant call management platform. Currently, all restaurants share a single hardcoded virtual phone number (`NEXT_PUBLIC_VIRTUAL_NUMBER` environment variable), and customers must enter a Business ID to route calls. This feature replaces that model with dedicated per-branch phone number provisioning, enabling direct-dial calling where each restaurant branch receives its own virtual phone number. The provisioning system integrates with the existing multi-provider telecom architecture (Twilio, Vonage, Africa's Talking, Termii), handles number lifecycle management, supports provider failover, and addresses number recycling for churned tenants. All changes maintain backward compatibility with the existing shared-number flow during migration.

## Glossary

- **Provisioning_Service**: The backend service responsible for acquiring, assigning, and releasing virtual phone numbers from telecom providers
- **Phone_Number_Record**: A Convex database record tracking the lifecycle of a provisioned phone number including its assignment, provider, status, and history
- **Telecom_Provider**: An external telephony service (Twilio, Vonage, Africa's Talking, Termii) from which virtual phone numbers are purchased
- **Number_Pool**: A set of pre-purchased phone numbers held in reserve for fast assignment to new branches
- **Number_Status**: The lifecycle state of a provisioned phone number: available, assigned, releasing, released, quarantined, failed
- **Quarantine_Period**: A configurable cooling-off window (default 30 days) after a number is released before it can be reassigned, preventing misrouted calls from previous tenants
- **Branch**: A physical restaurant location that receives a dedicated virtual phone number for inbound AI call handling
- **Location**: A logistics vertical physical site (hub, warehouse) that may receive a dedicated virtual phone number
- **Provisioning_Request**: A record tracking an in-flight number acquisition attempt including provider, status, and retry metadata
- **Number_Capability**: The set of features a phone number supports: voice, SMS, MMS, fax
- **Region**: A geographic area used for number selection and provider routing (e.g., nigeria, ghana, kenya, south_africa, default)
- **Webhook_Configuration**: The call-handling URL configuration applied to a provisioned number at the telecom provider level
- **Dashboard**: The restaurant owner web interface for managing settings, viewing calls, and monitoring operations
- **Onboarding_Flow**: The multi-step setup process where a restaurant owner creates their account, uploads menus, and receives a virtual phone number

## Requirements

### Requirement 1: Phone Number Record Schema

**User Story:** As a platform operator, I want a dedicated database table tracking all provisioned phone numbers, so that number lifecycle, ownership, and provider details are queryable and auditable.

#### Acceptance Criteria

1. THE Schema SHALL define a `phoneNumbers` table with required fields: numberId (string), phoneNumber (string, E.164 format), provider (string), status (Number_Status), capabilities (array of Number_Capability values), region (string), countryCode (string), and createdAt (number)
2. THE Schema SHALL define optional assignment fields on the `phoneNumbers` table: assignedToType (union of "branch" or "location"), assignedToId (string), assignedAt (number), and releasedAt (number)
3. THE Schema SHALL define optional lifecycle fields on the `phoneNumbers` table: quarantineExpiresAt (number), providerNumberSid (string), monthlyCost (number), currency (string), lastHealthCheckAt (number), and healthStatus (union of "healthy", "degraded", "unreachable")
4. THE Schema SHALL define indexes on the `phoneNumbers` table: by_number_id (numberId), by_phone_number (phoneNumber), by_status (status), by_assigned_to (assignedToType, assignedToId), by_provider (provider), and by_quarantine_expires (quarantineExpiresAt)
5. THE Schema SHALL define a `provisioningRequests` table with fields: requestId (string), branchId or locationId (string), targetType (union of "branch" or "location"), provider (string), status (union of "pending", "in_progress", "completed", "failed"), region (string), countryCode (string), attemptCount (number), maxAttempts (number), lastError (optional string), phoneNumberId (optional string), createdAt (number), updatedAt (number), and completedAt (optional number)
6. THE Schema SHALL define indexes on the `provisioningRequests` table: by_request_id (requestId), by_branch_id (branchId), by_status (status), and by_created_at (createdAt)

### Requirement 2: Number Acquisition from Telecom Providers

**User Story:** As a platform operator, I want the system to purchase phone numbers from telecom providers via their APIs, so that new branches can receive dedicated virtual numbers automatically.

#### Acceptance Criteria

1. WHEN a number acquisition is requested for a region, THE Provisioning_Service SHALL attempt to purchase a number from the primary provider for that region as defined by the ProviderRoutingService routing rules
2. IF the primary provider fails to provision a number (API error, no inventory, timeout), THEN THE Provisioning_Service SHALL attempt the secondary provider for that region
3. IF both primary and secondary providers fail, THEN THE Provisioning_Service SHALL attempt remaining configured providers in order (Twilio, Vonage, Africa's Talking, Termii) excluding already-attempted providers
4. WHEN a number is successfully purchased from a provider, THE Provisioning_Service SHALL store the provider's number SID, the E.164 formatted phone number, the monthly cost, and the currency in the Phone_Number_Record
5. WHEN a number is purchased, THE Provisioning_Service SHALL configure the number's voice webhook URL to point to the platform's `/incoming-call` endpoint at the telecom provider level
6. IF all provider attempts fail for a provisioning request, THEN THE Provisioning_Service SHALL mark the Provisioning_Request as "failed" with the last error message and emit a monitoring alert at "critical" severity
7. THE Provisioning_Service SHALL validate that a purchased number supports voice capability before accepting the number

### Requirement 3: Number Assignment to Branches

**User Story:** As a restaurant owner completing onboarding, I want my branch to automatically receive a dedicated phone number, so that customers can call my restaurant directly without entering a Business ID.

#### Acceptance Criteria

1. WHEN a branch completes the onboarding flow and reaches the virtual number step, THE Provisioning_Service SHALL create a Provisioning_Request for that branch
2. THE Provisioning_Service SHALL first check the Number_Pool for an available number matching the branch's region before purchasing a new number from a provider
3. WHEN a number is assigned to a branch, THE Provisioning_Service SHALL update the Phone_Number_Record with assignedToType "branch", assignedToId set to the branchId, and assignedAt set to the current timestamp
4. WHEN a number is assigned to a branch, THE Provisioning_Service SHALL update the branch record's phoneNumber field with the provisioned E.164 number
5. WHEN a number is assigned to a branch, THE Provisioning_Service SHALL update the Phone_Number_Record status from "available" to "assigned"
6. IF provisioning fails after all retries, THEN THE Provisioning_Service SHALL fall back to the shared number model for that branch and display the shared number with Business ID instructions to the restaurant owner
7. THE Provisioning_Service SHALL prevent assigning a number that is already in "assigned" status to another branch

### Requirement 4: Number Release and Quarantine

**User Story:** As a platform operator, I want released phone numbers to enter a quarantine period before reassignment, so that calls from the previous tenant's customers are not misrouted to a new tenant.

#### Acceptance Criteria

1. WHEN a branch is deactivated or a subscription is cancelled, THE Provisioning_Service SHALL change the Phone_Number_Record status from "assigned" to "releasing"
2. WHEN a number enters "releasing" status, THE Provisioning_Service SHALL remove the branch assignment fields (assignedToType, assignedToId) and set releasedAt to the current timestamp
3. WHEN a number enters "releasing" status, THE Provisioning_Service SHALL reconfigure the number's voice webhook at the provider to point to a "number-disconnected" announcement endpoint
4. THE Provisioning_Service SHALL transition numbers from "releasing" to "quarantined" status and set quarantineExpiresAt to the current timestamp plus the configured Quarantine_Period (default 30 days)
5. WHEN the quarantineExpiresAt timestamp is reached, THE Provisioning_Service SHALL transition the number to "available" status and add the number back to the Number_Pool for reassignment
6. THE Provisioning_Service SHALL implement a Convex scheduled function that runs every 6 hours to process quarantine expirations
7. WHILE a number is in "quarantined" status, THE Provisioning_Service SHALL reject any assignment requests for that number

### Requirement 5: Number Pool Management

**User Story:** As a platform operator, I want a pool of pre-purchased numbers available for instant assignment, so that onboarding latency is minimized and new branches receive numbers within seconds.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL maintain a configurable minimum pool size per region (default: 5 numbers per active region)
2. THE Provisioning_Service SHALL implement a Convex scheduled function that runs every hour to check pool levels and replenish below-minimum regions
3. WHEN the available number count for a region drops below the configured minimum, THE Provisioning_Service SHALL initiate purchase requests to bring the pool back to the minimum level
4. THE Number_Pool SHALL consist of Phone_Number_Records with status "available" and no branch or location assignment
5. WHEN assigning a number from the pool, THE Provisioning_Service SHALL select the oldest available number (by createdAt) to ensure even rotation
6. IF the pool is empty for a region when an assignment is requested, THEN THE Provisioning_Service SHALL purchase a number on-demand from the provider and assign it directly without pooling

### Requirement 6: Provisioning Request Retry Logic

**User Story:** As a platform operator, I want failed provisioning attempts to retry with exponential backoff, so that transient provider failures do not permanently block number assignment.

#### Acceptance Criteria

1. WHEN a provisioning attempt fails due to a transient error (network timeout, provider rate limit, temporary unavailability), THE Provisioning_Service SHALL retry the attempt with exponential backoff delays: 5 seconds, 30 seconds, 2 minutes, 10 minutes
2. THE Provisioning_Service SHALL set a maximum of 4 retry attempts per provisioning request (5 total attempts including the initial)
3. WHEN a retry attempt uses a different provider due to failover, THE Provisioning_Service SHALL record the provider used for each attempt in the Provisioning_Request
4. THE Provisioning_Service SHALL not retry provisioning attempts that fail due to non-transient errors (invalid credentials, account suspended, insufficient funds)
5. WHEN all retry attempts are exhausted, THE Provisioning_Service SHALL update the Provisioning_Request status to "failed" and record the final error
6. THE Provisioning_Service SHALL log each retry attempt at "warn" level with requestId, attemptCount, provider, and error message

### Requirement 7: Number Health Monitoring

**User Story:** As a platform operator, I want provisioned numbers monitored for reachability, so that degraded or unreachable numbers are detected and flagged before customers experience call failures.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL implement a health check that queries each telecom provider's API to verify assigned numbers are active and properly configured
2. THE Provisioning_Service SHALL run health checks via a Convex scheduled function every 4 hours for all numbers in "assigned" status
3. WHEN a health check determines a number is unreachable or misconfigured at the provider, THE Provisioning_Service SHALL update the Phone_Number_Record healthStatus to "unreachable" and emit a monitoring alert at "warning" severity
4. WHEN a health check determines a number has degraded quality (webhook misconfigured but number active), THE Provisioning_Service SHALL update the Phone_Number_Record healthStatus to "degraded"
5. WHEN a previously unhealthy number passes a health check, THE Provisioning_Service SHALL update the healthStatus to "healthy"
6. THE Provisioning_Service SHALL update lastHealthCheckAt on every health check execution regardless of result

### Requirement 8: Provider Cost Tracking

**User Story:** As a platform operator, I want per-number cost data stored and queryable, so that billing calculations and cost optimization decisions are based on accurate provider pricing.

#### Acceptance Criteria

1. WHEN a number is purchased, THE Provisioning_Service SHALL store the monthlyRecurringCost and currency from the provider's API response in the Phone_Number_Record
2. THE System SHALL expose a Convex query to calculate total monthly phone number costs grouped by provider and region
3. THE System SHALL expose a Convex query to calculate per-branch phone number costs for billing integration
4. WHEN a number is released back to the provider (not recycled), THE Provisioning_Service SHALL record the release date for pro-rated billing calculations

### Requirement 9: Onboarding Flow Integration

**User Story:** As a restaurant owner, I want the onboarding flow to show my dedicated phone number after provisioning completes, so that I know the exact number customers should call.

#### Acceptance Criteria

1. WHEN the onboarding flow reaches the virtual number step, THE Dashboard SHALL initiate a provisioning request and display a loading state while provisioning is in progress
2. WHEN provisioning completes successfully, THE Dashboard SHALL display the provisioned E.164 phone number formatted for the branch's locale
3. WHEN provisioning completes successfully, THE Dashboard SHALL remove the Business ID entry instruction from the "How it works" section since direct-dial is now available
4. IF provisioning fails, THEN THE Dashboard SHALL display the shared number with Business ID instructions as a fallback and show a notification explaining that a dedicated number will be assigned later
5. THE Dashboard SHALL display the phone number's provider name for transparency (e.g., "Powered by Twilio")
6. WHEN a branch already has an assigned phone number, THE Dashboard SHALL display the existing number without initiating a new provisioning request

### Requirement 10: Dashboard Number Management

**User Story:** As a restaurant owner, I want to view and manage my branch's phone number from the dashboard settings, so that I can see number status, request a replacement, or understand billing impact.

#### Acceptance Criteria

1. THE Dashboard SHALL display the branch's assigned phone number, provider, status, health status, and monthly cost in the settings section
2. WHEN the phone number healthStatus is "degraded" or "unreachable", THE Dashboard SHALL display a warning badge with a description of the issue
3. THE Dashboard SHALL provide a "Request Replacement" action that initiates a new provisioning request and releases the current number
4. WHEN a replacement is requested, THE Dashboard SHALL display a confirmation dialog explaining that the old number will enter quarantine and customers using the old number will hear a disconnection message
5. IF the branch has no assigned phone number (using shared number fallback), THEN THE Dashboard SHALL display a "Request Dedicated Number" action that initiates provisioning

### Requirement 11: Backward Compatibility with Shared Number

**User Story:** As a platform operator, I want the shared number model to remain functional during migration, so that existing restaurants continue to work while dedicated numbers are rolled out.

#### Acceptance Criteria

1. WHEN an inbound call arrives on the shared number (`NEXT_PUBLIC_VIRTUAL_NUMBER`), THE System SHALL continue to prompt for Business ID and route the call using the existing restaurantId lookup flow
2. WHEN an inbound call arrives on a provisioned dedicated number, THE System SHALL use the phoneLookup module to resolve the branch directly without prompting for Business ID
3. THE System SHALL support both routing modes simultaneously: shared-number-with-Business-ID and dedicated-number-direct-dial
4. WHEN a branch has a dedicated number assigned, THE Dashboard SHALL display the dedicated number as the primary contact method
5. WHEN a branch does not have a dedicated number assigned, THE Dashboard SHALL display the shared number with Business ID instructions
6. THE System SHALL use a feature flag `dedicated_numbers_enabled` to control whether new provisioning requests are accepted, allowing gradual rollout per platform

### Requirement 12: Number Release on Provider Cancellation

**User Story:** As a platform operator, I want phone numbers released back to the provider when they are no longer needed after quarantine, so that the platform does not incur ongoing costs for unused numbers.

#### Acceptance Criteria

1. WHEN a quarantined number's quarantine period expires and the Number_Pool for that region is at or above the configured minimum, THE Provisioning_Service SHALL release the number back to the telecom provider via the provider's API
2. WHEN a quarantined number's quarantine period expires and the Number_Pool for that region is below the configured minimum, THE Provisioning_Service SHALL retain the number in the pool with "available" status
3. WHEN releasing a number to the provider, THE Provisioning_Service SHALL call the provider's number deletion/release API and update the Phone_Number_Record status to "released"
4. IF the provider release API call fails, THEN THE Provisioning_Service SHALL retry the release up to 3 times with exponential backoff and log each failure at "error" level
5. THE Provisioning_Service SHALL log all number releases at "info" level with numberId, phoneNumber, provider, and reason (quarantine_expired, pool_full, manual_release)

### Requirement 13: Provisioning Audit Trail

**User Story:** As a platform operator, I want a complete audit trail of all provisioning actions, so that number lifecycle events can be investigated and compliance requirements are met.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL log all provisioning lifecycle events (purchase, assign, release, quarantine, health_check, pool_replenish) using the createLogger utility
2. THE audit log entry SHALL include minimum fields: timestamp, level, action, numberId, phoneNumber, provider, region, and requestId (when applicable)
3. WHEN a number is assigned to a branch, THE audit log SHALL include the branchId and restaurantId
4. WHEN a number assignment changes (reassignment, release), THE audit log SHALL include both the previous and new assignment details
5. WHEN a provisioning request fails, THE audit log SHALL include the error message, attempt count, and all providers attempted
