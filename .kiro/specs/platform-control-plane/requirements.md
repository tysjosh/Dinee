# Requirements Document

## Introduction

This feature repurposes Dinee's existing tenant-scoped operator dashboard into a **Control Plane** for managing every external platform that connects to Dinee to run its own voice agent. It builds directly on the completed `multi-platform-voice-integrations` feature, where external platforms register an integration, assign inbound phone numbers, and Dinee runs the voice agent and submits voice-originated data back over each platform's signed contract. Dinee is never the system of record for external orders.

The Control Plane adds cross-tenant and cross-platform management surfaces on top of the existing single-pair integration primitives. It serves two audiences through a two-tier authorization model: **Dinee-internal staff** (platform-admin role) who need cross-tenant, cross-platform visibility and management, and **partner self-service** (partner role) who may view and manage only their own platform integration(s), strictly scoped to their assigned `(platformId, tenantId)`.

This feature is **additive only**. The first-party restaurant and logistics verticals, their existing Next.js `/api/v1/...` routes, the operator dashboard, and the `NEXT_APP_URL` wrappers are all kept and must keep working. The Control Plane never exposes plaintext or ciphertext credentials to any UI (masked last-4 only), audit entries reference credentials by name only, and live first-party and Runsheet voice traffic must experience zero disruption.

The feature closes five known gaps in the current integration surface: (1) there is no cross-tenant/cross-platform read/list surface — every function is single-pair; (2) there is no browser-enumerable catalog of registered platforms and their credential-field specs, because the Integration_Registry is in-process per server isolate; (3) there is no two-tier authorization model replacing the implicit single-tenant scoping; (4) there is no consolidated observability surface (connection status, credential-test history, audit-log view, optional per-platform metrics); and (5) the existing single-platform, single-tenant admin component must be generalized into an admin console and a scoped partner self-service view.

## Glossary

- **Control_Plane**: The set of Dinee-owned read, list, and management surfaces added by this feature for administering external platform integrations across tenants and platforms.
- **Platform_Admin**: A Dinee-internal staff actor holding the `platform_admin` role, granted cross-tenant and cross-platform read and management access.
- **Partner**: A partner self-service actor holding the `partner` role, whose access is restricted to the integrations within the actor's Authorization_Scope.
- **Authorization_Scope**: The set of `(Platform_Id, Tenant_Id)` pairs a Partner is permitted to read and manage. A Platform_Admin's Authorization_Scope is unrestricted (all platforms, all tenants).
- **Integration_Registry**: The existing in-process, per-isolate registry mapping a Platform_Id to its Platform_Definition (from `multi-platform-voice-integrations`).
- **Platform_Definition**: The registered descriptor of an external platform, including its Platform_Id, display name, credential field specifications, Transport_Contract, and adapter factory.
- **Platform_Catalog**: A serializable, secret-free enumeration of registered platforms and their public metadata, derived from the Integration_Registry, that a browser can consume to drive the UI.
- **Credential_Field_Spec**: A declared credential a platform needs, consisting of a machine name, a human label, and a required flag.
- **Integration**: A stored Integration_Config keyed by `(Platform_Id, Tenant_Id)`, persisted in the generic `integrations` table.
- **Platform_Id**: The stable unique identifier of a registered external platform (e.g. `runsheet`).
- **Tenant_Id**: The Dinee tenant identifier associated with an Integration.
- **Connection_Status**: The current state of an Integration, one of `connected`, `disconnected`, or `error`.
- **Masked_Summary**: A view of an Integration that excludes plaintext and ciphertext credential values and exposes at most the last 4 characters of each stored credential.
- **Last4_Preview**: The at-most-last-4-characters preview of a stored credential, safe for display, produced under the masking rules of Requirement 11.
- **Credential_Test**: An authenticated probe of an Integration's configured backend that yields a Connection_Status outcome.
- **Integration_Audit_Log**: The existing immutable audit trail (`integrationAuditLog` table) recording credential lifecycle events, referencing credentials by name only.
- **Admin_Console**: The Control_Plane user interface used by a Platform_Admin to list and manage all platforms and integrations.
- **Partner_Console**: The Control_Plane user interface used by a Partner to view and manage only integrations within the Partner's Authorization_Scope.

## Requirements

### Requirement 1: Platform Catalog Enumeration

**User Story:** As a Platform_Admin, I want to enumerate the registered platforms and their credential-field specifications, so that the Control Plane UI can drive integration forms without embedding platform-specific code or exposing platform internals.

#### Acceptance Criteria

1. WHEN the Control_Plane receives a request to enumerate the Platform_Catalog, THE Control_Plane SHALL return exactly one catalog entry for each platform registered in the Integration_Registry, with no duplicate Platform_Id and no entry for an unregistered platform.
2. THE Platform_Catalog SHALL include, for each entry, the Platform_Id, the display name, and the Credential_Field_Specs, where each Credential_Field_Spec consists of a machine name, a human label, and a required flag whose value is exactly true or false.
3. WHERE a registered platform declares supported conversation types, THE Platform_Catalog SHALL include those conversation types as a list in that platform's catalog entry.
4. WHERE a registered platform declares no supported conversation types, THE Platform_Catalog SHALL include an empty conversation-types list in that platform's catalog entry.
5. THE Platform_Catalog SHALL exclude adapter factory references, runtime service tokens, and all credential values from every catalog entry, and SHALL contain only serializable string, boolean, and list values.
6. WHEN no platform is registered in the Integration_Registry, THE Control_Plane SHALL return a Platform_Catalog containing zero entries.
7. IF the Integration_Registry cannot be accessed, THEN THE Control_Plane SHALL return an error indicating the catalog is unavailable and SHALL NOT return a partial Platform_Catalog.

### Requirement 2: Cross-Platform Integration Listing

**User Story:** As a Platform_Admin, I want to list every integration across all tenants and platforms with filtering, so that I can monitor and manage all connecting platforms from one place.

#### Acceptance Criteria

1. WHEN a Platform_Admin requests the integration list without any filter, THE Control_Plane SHALL return a Masked_Summary for every Integration across all tenants and all platforms, in a deterministic order that is identical across repeated identical requests.
2. WHERE a platform filter is supplied, THE Control_Plane SHALL return only Integrations whose Platform_Id is exactly equal, case-sensitively, to the supplied platform filter.
3. WHERE a tenant filter is supplied, THE Control_Plane SHALL return only Integrations whose Tenant_Id is exactly equal, case-sensitively, to the supplied tenant filter.
4. WHERE a connection-status filter is supplied, THE Control_Plane SHALL return only Integrations whose Connection_Status is exactly equal to the supplied status filter, where the status is one of `connected`, `disconnected`, or `error`.
5. WHERE more than one filter is supplied, THE Control_Plane SHALL return only Integrations that satisfy all supplied filters together.
6. THE Control_Plane SHALL include in each Masked_Summary the Platform_Id, the Tenant_Id, the base URL, the Connection_Status, and the Last4_Preview of each stored credential, and SHALL exclude decrypted credential values and credential ciphertext.
7. WHERE a stored credential is shorter than 4 characters, THE Control_Plane SHALL produce its Last4_Preview under the masking rules of Requirement 11 so that no full credential value is revealed.
8. WHEN no Integration matches the supplied filters, THE Control_Plane SHALL return an integration list containing zero entries and SHALL NOT return an error.
9. IF the requester is not a Platform_Admin, THEN THE Control_Plane SHALL deny the request and return an authorization error without returning any Masked_Summary.
10. IF a supplied filter value is malformed or empty, THEN THE Control_Plane SHALL reject the request with an error and SHALL leave all Integration data unchanged.

### Requirement 3: Integration Detail View

**User Story:** As a Platform_Admin, I want to view the full masked configuration of a single integration, so that I can inspect and troubleshoot a specific platform-tenant connection.

#### Acceptance Criteria

1. WHEN an authorized Platform_Admin requests the detail of an Integration identified by a `(Platform_Id, Tenant_Id)` pair, THE Control_Plane SHALL return the Masked_Summary configuration for that pair within 5 seconds.
2. WHEN the Control_Plane returns an integration detail, THE Control_Plane SHALL include the base URL, the platform-side tenant id, the allowed conversation types, the Connection_Status as exactly one of `connected`, `disconnected`, or `error`, the Last4_Preview showing at most the last 4 characters of each stored credential, and the created and updated timestamps.
3. IF no Integration exists for the requested `(Platform_Id, Tenant_Id)` pair, THEN THE Control_Plane SHALL return an empty detail result that indicates absence of a matching record and SHALL NOT return an error.
4. THE Control_Plane SHALL exclude decrypted credential values and credential ciphertext from the integration detail.
5. IF the requester is not an authorized Platform_Admin, THEN THE Control_Plane SHALL deny the request, return an authorization-denied indication, and SHALL NOT return any integration detail.
6. IF retrieval of the requested Integration fails for any reason other than a non-existent record, THEN THE Control_Plane SHALL return an error indicating the retrieval failure and SHALL NOT return any partial integration detail.

### Requirement 4: Partner-Scoped Integration Listing

**User Story:** As a Partner, I want to list only my own platform integrations, so that I can manage my connection without seeing any other tenant's or platform's data.

#### Acceptance Criteria

1. WHEN a Partner requests the integration list, THE Control_Plane SHALL return exactly one Masked_Summary for each Integration whose `(Platform_Id, Tenant_Id)` pair is a member of the requesting Partner's Authorization_Scope.
2. THE Control_Plane SHALL exclude decrypted credential values and credential ciphertext from every Masked_Summary returned to a Partner.
3. IF no Integration has a `(Platform_Id, Tenant_Id)` pair that is a member of the requesting Partner's Authorization_Scope, THEN THE Control_Plane SHALL return an integration list containing zero Masked_Summary entries.
4. IF an Integration's `(Platform_Id, Tenant_Id)` pair is not a member of the requesting Partner's Authorization_Scope, THEN THE Control_Plane SHALL exclude that Integration's Masked_Summary from the returned integration list.
5. IF the requesting Partner's Authorization_Scope cannot be determined, THEN THE Control_Plane SHALL reject the request with an error response indicating the Partner is not authorized, return no Masked_Summary, and leave all Integration data unchanged.

### Requirement 5: Two-Tier Authorization Enforcement

**User Story:** As a Dinee operator, I want authorization enforced by role and scope, so that Platform_Admins get cross-tenant access while Partners are strictly confined to their own integrations.

#### Acceptance Criteria

1. WHILE the requesting actor holds the Platform_Admin role, THE Control_Plane SHALL permit read and management access to Integrations across all tenants and all platforms without applying any Authorization_Scope filtering.
2. WHILE the requesting actor holds the Partner role, THE Control_Plane SHALL restrict read and management access to only those Integrations whose `(Platform_Id, Tenant_Id)` pair is a member of the set of `(Platform_Id, Tenant_Id)` pairs comprising the actor's Authorization_Scope.
3. WHEN a Partner requests a list of Integrations, THE Control_Plane SHALL return only the Integrations whose `(Platform_Id, Tenant_Id)` pair is within the Partner's Authorization_Scope and SHALL exclude all Integrations outside that scope from the returned collection.
4. IF a Partner requests to read an Integration whose `(Platform_Id, Tenant_Id)` is outside the Partner's Authorization_Scope, THEN THE Control_Plane SHALL deny the request and return an authorization error without returning any Integration data.
5. IF a Partner requests to modify an Integration whose `(Platform_Id, Tenant_Id)` is outside the Partner's Authorization_Scope, THEN THE Control_Plane SHALL deny the request, return an authorization error, and leave the target Integration unchanged.
6. IF a request carries no recognized actor role, THEN THE Control_Plane SHALL deny the request and return an authorization error without returning any Integration data.
7. WHEN the Control_Plane authorizes a management action, THE Control_Plane SHALL verify the target Integration's `(Platform_Id, Tenant_Id)` is within the actor's Authorization_Scope before performing the action, and IF the pair is outside the Authorization_Scope, THEN THE Control_Plane SHALL deny the action and leave the target Integration unchanged.

### Requirement 6: Platform Admin Console

**User Story:** As a Platform_Admin, I want a console that lists and manages all platforms and integrations, so that I can administer every connecting platform through one interface.

#### Acceptance Criteria

1. WHEN a Platform_Admin opens the Admin_Console, THE Admin_Console SHALL display the integration list across all platforms and tenants using the Masked_Summary, excluding decrypted credential values and credential ciphertext.
2. WHEN a Platform_Admin opens the Admin_Console and no Integration exists, THE Admin_Console SHALL display an empty integration-list state and SHALL NOT display an error.
3. THE Admin_Console SHALL provide controls to filter the integration list by platform, by tenant, and by Connection_Status, where the Connection_Status control offers exactly the values `connected`, `disconnected`, and `error`.
4. WHEN a Platform_Admin applies one or more filters, THE Admin_Console SHALL display only the Integrations returned for those filters, and WHEN no Integration matches, THE Admin_Console SHALL display an empty filtered-result state.
5. WHEN a Platform_Admin selects an Integration, THE Admin_Console SHALL display that Integration's masked detail, excluding decrypted credential values and credential ciphertext.
6. THE Admin_Console SHALL render one credential input field per Credential_Field_Spec of the selected platform's Platform_Catalog entry, labeled with the specification's human label and honoring its required flag.
7. WHEN a Platform_Admin saves an Integration configuration with all required credential fields provided, THE Admin_Console SHALL submit the configuration through the existing config-store save entry point.
8. IF a Platform_Admin attempts to save an Integration configuration with a required Credential_Field_Spec left empty, THEN THE Admin_Console SHALL block the save, identify the missing field, and SHALL NOT submit the configuration.
9. IF the config-store save entry point returns a failure, THEN THE Admin_Console SHALL display an error indication and SHALL retain the values the Platform_Admin entered.
10. THE Admin_Console SHALL display each stored credential as at most its Last4_Preview and SHALL NOT render any plaintext credential value or credential ciphertext.

### Requirement 7: Partner Self-Service View

**User Story:** As a Partner, I want a self-service view of my own integration, so that I can configure my connection, assign phone numbers, and test credentials without access to other tenants or platforms.

#### Acceptance Criteria

1. WHEN a Partner opens the Partner_Console, THE Partner_Console SHALL display only the Integrations whose `(Platform_Id, Tenant_Id)` is within the Partner's Authorization_Scope.
2. THE Partner_Console SHALL limit every displayed Integration, phone-route assignment, and credential field to Integrations whose `(Platform_Id, Tenant_Id)` is within the Partner's Authorization_Scope.
3. WHEN a Partner saves a configuration or assigns a phone number for an Integration within the Partner's Authorization_Scope, THE Partner_Console SHALL submit the request scoped to that Integration's `(Platform_Id, Tenant_Id)` through the existing config-store save and phone-route assignment entry points.
4. THE Partner_Console SHALL render credential input fields from the platform's Platform_Catalog Credential_Field_Specs, SHALL display each stored credential as at most its Last4_Preview, and SHALL exclude decrypted credential values and credential ciphertext from every displayed credential field.
5. WHEN the Partner's Authorization_Scope contains no Integration, THE Partner_Console SHALL display an empty integration view that contains no Integration, phone-route assignment, or credential field.
6. IF a Partner submits a configuration save or phone-number assignment for an Integration whose `(Platform_Id, Tenant_Id)` is outside the Partner's Authorization_Scope, THEN THE Partner_Console SHALL block the submission, leave the Integration unchanged, and display an error indication that the action is outside the Partner's Authorization_Scope.

### Requirement 8: Connection Status and Credential-Test Observability

**User Story:** As an authorized actor, I want to see connection status and credential-test outcomes over time, so that I can observe the health of an integration and diagnose credential problems.

#### Acceptance Criteria

1. WHEN an authorized actor requests the connection status of an Integration within the actor's Authorization_Scope, THE Control_Plane SHALL return the Integration's current Connection_Status as exactly one of `connected`, `disconnected`, or `error`.
2. WHEN a Credential_Test completes, THE Control_Plane SHALL record the test outcome as exactly one of success or failure together with the completion timestamp expressed in UTC and accurate to the second.
3. WHEN an authorized actor requests the credential-test history for an Integration within the actor's Authorization_Scope, THE Control_Plane SHALL return the recorded test outcomes ordered most-recent-first by completion timestamp, in a page of at most the 100 most recent outcomes.
4. THE recorded Credential_Test outcome SHALL reference the Integration by Platform_Id and Tenant_Id and SHALL exclude all credential values.
5. WHEN an authorized actor requests the connection status of an Integration for which no Connection_Status has been recorded, THE Control_Plane SHALL return an indication that no status has been recorded and SHALL NOT return an error.
6. WHEN an authorized actor requests the credential-test history for an Integration that has no recorded test outcomes, THE Control_Plane SHALL return an empty history and SHALL NOT return an error.
7. IF an actor requests connection status or credential-test history for an Integration outside the actor's Authorization_Scope, THEN THE Control_Plane SHALL deny the request, return an authorization error, and SHALL NOT disclose any status, history, or Integration data.

### Requirement 9: Integration Audit Log View

**User Story:** As an authorized actor, I want to view integration audit entries, so that I can review credential lifecycle events for the integrations I am permitted to see.

#### Acceptance Criteria

1. WHEN a Platform_Admin requests the Integration_Audit_Log for a Tenant_Id, THE Control_Plane SHALL return, within 2 seconds, the audit entries scoped to that Tenant_Id ordered by event timestamp in descending order, in pages of at most 100 entries per response.
2. WHEN a Platform_Admin requests the Integration_Audit_Log for a Platform_Id, THE Control_Plane SHALL return, within 2 seconds, the audit entries for that Platform_Id across all tenants ordered by event timestamp in descending order, in pages of at most 100 entries per response.
3. WHEN a Partner requests the Integration_Audit_Log, THE Control_Plane SHALL return, within 2 seconds, only the audit entries whose scope falls within the Partner's Authorization_Scope, ordered by event timestamp in descending order, in pages of at most 100 entries per response.
4. THE Control_Plane SHALL, in every returned audit entry, reference each credential by its credential name only and SHALL exclude every credential value and every credential secret from the response.
5. IF an actor requests audit entries whose scope falls outside the actor's Authorization_Scope, THEN THE Control_Plane SHALL deny the request, return no audit entries, and return an authorization error indicating the request is outside the actor's Authorization_Scope.
6. IF the requesting actor is not authenticated, THEN THE Control_Plane SHALL deny the request, return no audit entries, and return an authentication error indicating the actor is not authenticated.
7. WHEN an authorized actor requests the Integration_Audit_Log and no audit entries exist within the actor's Authorization_Scope for the requested filter, THE Control_Plane SHALL return an empty result set and SHALL NOT return an error.

### Requirement 10: Optional Per-Platform Usage and Health Metrics

**User Story:** As an authorized actor, I want per-platform usage and health metrics when enabled, so that I can monitor integration activity over time.

#### Acceptance Criteria

1. WHERE per-platform usage metrics are enabled, THE Control_Plane SHALL expose, for each Integration within the requesting actor's Authorization_Scope, health metrics comprising the count of submission attempts, the count of successful submissions, the count of failed submissions, and the current Connection_Status, aggregated over a configurable time window, and SHALL exclude all credential values.
2. WHERE per-platform usage metrics are enabled, THE Control_Plane SHALL restrict metric visibility to Integrations within the requesting actor's Authorization_Scope.
3. WHERE per-platform usage metrics are enabled, THE Control_Plane SHALL accept a configurable time window between 1 hour and 90 days inclusive, and SHALL apply a default window of 24 hours when no window is supplied.
4. WHERE per-platform usage metrics are enabled AND an Integration has no activity within the requested time window, THE Control_Plane SHALL return counts of zero for that Integration's submission attempts, successful submissions, and failed submissions.
5. IF an actor requests metrics for an Integration outside the actor's Authorization_Scope, THEN THE Control_Plane SHALL deny the request and return an authorization error.

### Requirement 11: Credential Masking and Secret Non-Exposure

**User Story:** As a security stakeholder, I want credentials never exposed to any UI, so that plaintext and ciphertext secrets cannot leak through the Control Plane.

#### Acceptance Criteria

1. THE Control_Plane SHALL exclude plaintext credential values from every read surface it exposes to any user interface.
2. THE Control_Plane SHALL exclude credential ciphertext from every read surface it exposes to any user interface.
3. WHEN the Control_Plane returns a stored credential to any user interface, THE Control_Plane SHALL display at most the last 4 characters of that credential and SHALL replace every preceding character with a masking character.
4. IF a stored credential contains fewer than 4 characters, THEN THE Control_Plane SHALL replace all of its characters with a masking character and SHALL display zero unmasked characters.
5. IF a read surface response would otherwise include a plaintext or ciphertext credential value, THEN THE Control_Plane SHALL omit that value, return only the masked representation defined in criteria 3 and 4, and SHALL indicate no error to the caller.
6. WHEN the Control_Plane writes an Integration_Audit_Log entry, THE audit entry SHALL reference each credential by name only and SHALL exclude any plaintext or ciphertext value of that credential.

### Requirement 12: Additive Backward Compatibility

**User Story:** As a Dinee operator, I want the Control Plane added without disrupting existing systems, so that first-party verticals and live voice traffic keep working unchanged.

#### Acceptance Criteria

1. WHEN a request is received on an existing first-party restaurant or logistics `/api/v1/...` route, THE Control_Plane SHALL return responses whose route path, request schema, response schema, and status codes are identical to the pre-Control_Plane baseline captured before the Control_Plane was added.
2. THE Control_Plane SHALL preserve the existing single-pair integration entry points (`saveIntegrationConfig`, `testIntegrationCredential`, `savePhoneRoute`, `resolveRoute`, `getMaskedConfig`, `getConfigForRuntimeInternal`, `getCredentialsForRuntime`) with identical function names, parameter lists, parameter types, and return types as the pre-Control_Plane baseline.
3. WHILE the Control_Plane is serving requests, THE Control_Plane SHALL resolve the same Runsheet voice-traffic route for a given inbound call input as the pre-Control_Plane baseline resolves for that identical input.
4. THE Control_Plane SHALL keep the operator dashboard, the first-party verticals, and the `NEXT_APP_URL` wrappers reachable and functional, with none of them removed or disabled.
5. THE Control_Plane SHALL expose its read, list, and management surfaces as additive endpoints whose paths do not overlap with, override, or shadow any existing first-party restaurant or logistics `/api/v1/...` route path.
6. IF adding a Control_Plane read, list, or management surface would alter or remove an existing first-party `/api/v1/...` route, any of the seven single-pair integration entry points, or the Runsheet voice-traffic routing decision for a given inbound call input, THEN THE Control_Plane SHALL reject that addition, preserve the existing behavior unchanged, and surface an error indicating the conflicting existing behavior.
