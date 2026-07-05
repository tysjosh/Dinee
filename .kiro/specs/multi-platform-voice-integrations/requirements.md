# Requirements Document

## Introduction

Dinee is a Next.js 15 + Convex voice platform. It already exposes a GENERIC `VoiceDomainPack` system (`src/lib/modules/voiceDomainPack.ts`, `src/lib/modules/voiceDomainPackRegistry.ts`) that lets a vertical declare conversation types, tools, phases, prompts, and per-tool integration gating via `enabledIntegrations`. Packs are resolved by conversation type in the standalone ws-server (`src/app/ws-server/index.ts`).

The layer that connects a pack to an EXTERNAL third-party platform backend is currently HARDCODED to a single platform ("Runsheet"). Onboarding a new external platform today requires bespoke code: a platform-specific credential table, platform-specific phone routing, `isRunsheetCall` branches in the ws-server, and platform-specific outbound clients.

This feature GENERALIZES that connective layer (referred to as Layer 2) so that any external platform can onboard a voice agent on Dinee as CONFIGURATION rather than bespoke code. It introduces:

- A generic integration configuration model keyed by `(platformId, tenantId)` that supersedes the Runsheet-specific table, storing base URL, encrypted credentials, arbitrary platform config, and connection status.
- A generic phone→route model mapping an inbound number to `(platformId, tenantId, conversationTypes)`.
- A platform Integration Adapter interface, so each platform supplies its own read client and outbound intake contract behind a common shape.
- A generic pack↔adapter link and generic per-call binding in the ws-server that resolves an adapter by `platformId` instead of `isRunsheetCall` branches.
- Preservation of the existing security model generically: per-tenant AES-256-GCM encrypted credentials, service-token-guarded runtime credential retrieval, per-tool `requiresIntegration` gating, and per-platform auth/transport contract descriptors (Bearer vs HMAC, path prefixes, timestamp/schema formats, per-backend key salts).
- Admin UI to register a platform integration, assign phone numbers, and run a credential test that flips connection status to "connected".

The existing Runsheet integration is refactored to become the FIRST adapter of this generic system and MUST continue to serve live traffic unchanged. This spec deliberately does NOT re-specify the already-generic pack system; it focuses on generalizing Layer 2.

## Scope Constraints

- Dinee is never the system of record for external orders; it holds transient in-session drafts and submits over each platform's signed contract. No new order-of-record tables are introduced.
- Backward compatibility: the existing Runsheet integration and its live traffic keep working; Runsheet becomes the first adapter, not a removal.
- Type-check gate: the change introduces zero new TypeScript errors outside the documented Phase 0 quarantine.
- Security-sensitive: credential isolation between platforms and tenants, no plaintext secrets in logs, per-platform service tokens and key salts.

## Glossary

- **Platform**: An external third-party product (e.g. Runsheet) whose backend Dinee submits voice-originated data to and reads from on behalf of tenants.
- **Platform_Id**: A stable, unique string identifier for a Platform (e.g. `"runsheet"`), 1–64 characters.
- **Tenant_Id**: The Dinee-owned platform tenant that owns a specific integration configuration and its credentials.
- **Integration_Registry**: The in-process component that registers and resolves Platform definitions and their Integration_Adapter, keyed by Platform_Id.
- **Platform_Definition**: A registered declaration of a Platform: its Platform_Id, display name, its Integration_Adapter factory, and its Transport_Contract descriptor.
- **Integration_Adapter**: The common-shaped interface a Platform supplies, exposing a read/validate client and an outbound Intake_Client, constructed per call from decrypted credentials and config.
- **Transport_Contract**: The per-Platform descriptor of auth and transport details (auth scheme such as Bearer or HMAC, path prefixes, timestamp format, schema version, and per-backend key salt) used by the Integration_Adapter.
- **Integration_Config**: A stored configuration record for a Platform + Tenant, holding base URL, encrypted credentials, arbitrary platform config, allowed conversation types, and connection status.
- **Integration_Config_Store**: The Convex persistence surface (query/mutation) for Integration_Config records, keyed by `(Platform_Id, Tenant_Id)`.
- **Encryption_Service**: The AES-256-GCM encrypt/decrypt component (`src/lib/integrations/encryptionService.ts`) used to protect credentials at rest.
- **Runtime_Credential_Service**: The service-token-guarded Convex action that returns encrypted credentials plus config to the Voice_Runtime at call time.
- **Runtime_Service_Token**: The shared secret a Voice_Runtime caller must present to the Runtime_Credential_Service to retrieve credentials.
- **Phone_Route**: A stored mapping of an inbound phone number to a Platform_Id, Tenant_Id, and set of conversation types.
- **Phone_Route_Resolver**: The component that resolves an inbound "To" number to a Phone_Route (`src/lib/call-routing/phone-lookup.ts`).
- **Voice_Runtime**: The standalone ws-server (`src/app/ws-server/index.ts`) that binds a per-call session to a resolved Integration_Adapter.
- **Adapter_Resolver**: The component that resolves an Integration_Adapter for a call from the call's Platform_Id.
- **Credential_Test_Service**: The component that performs an authenticated probe against an Integration_Config and records the resulting connection status.
- **Connection_Status**: The state of an Integration_Config, exactly one of `connected`, `disconnected`, or `error`.
- **Integration_Admin_UI**: The admin surface used to register a platform integration, assign phone numbers, and run a credential test.
- **Migration_Service**: The one-time process that moves existing Runsheet integration and number-assignment records into the generic models.
- **VoiceDomainPack**: The existing voice-capability pack (out of scope to re-specify) that declares an `IntegrationRequirement` identifying the Platform it needs.
- **Phase_0_Quarantine**: The explicitly documented set of pre-existing files excluded from the zero-new-TypeScript-errors gate.

## Requirements

### Requirement 1: Platform Registration

**User Story:** As a platform engineer, I want to register an external platform as a first-class definition, so that Dinee can onboard the platform's voice agent through configuration rather than bespoke code.

#### Acceptance Criteria

1. WHEN a Platform_Definition with a Platform_Id of 1 to 64 characters, a display name, an Integration_Adapter factory, and a Transport_Contract is submitted, THE Integration_Registry SHALL register the Platform_Definition keyed by the Platform_Id.
2. IF a Platform_Definition is submitted with a Platform_Id that is already registered, THEN THE Integration_Registry SHALL reject the registration and report a duplicate-identifier error naming the conflicting Platform_Id.
3. IF a Platform_Definition is submitted with a Platform_Id shorter than 1 character or longer than 64 characters, THEN THE Integration_Registry SHALL reject the registration and report an invalid-identifier error.
4. IF a Platform_Definition is submitted that omits the Integration_Adapter factory or the Transport_Contract, THEN THE Integration_Registry SHALL reject the registration and report a missing-field error naming the omitted field.
5. WHEN a registration is rejected, THE Integration_Registry SHALL leave the set of registered Platform_Definitions unchanged.
6. WHEN the Integration_Registry is queried with a Platform_Id that is registered, THE Integration_Registry SHALL return the corresponding Platform_Definition.
7. WHEN the Integration_Registry is queried with a Platform_Id that is not registered, THE Integration_Registry SHALL return an unresolved result without raising an error.

### Requirement 2: Generic Integration Configuration and Encryption

**User Story:** As a platform administrator, I want to store an external platform's connection settings and credentials per tenant, so that a tenant's voice agent can authenticate to that platform without exposing secrets.

#### Acceptance Criteria

1. WHEN an Integration_Config is saved with a Platform_Id, a Tenant_Id, a non-empty base URL, and one or more credential values, THE Integration_Config_Store SHALL persist the record keyed by the pair `(Platform_Id, Tenant_Id)`.
2. WHEN an Integration_Config is saved, THE Encryption_Service SHALL encrypt each credential value with AES-256-GCM before the credential is persisted.
3. IF an Integration_Config is saved with an empty base URL, THEN THE Integration_Config_Store SHALL reject the save, report a missing-field error naming the base URL, and leave any existing stored record unchanged.
4. IF an Integration_Config is saved for a Platform_Id that is not registered in the Integration_Registry, THEN THE Integration_Config_Store SHALL reject the save and report an unknown-platform error naming the Platform_Id.
5. WHEN an Integration_Config already exists for a `(Platform_Id, Tenant_Id)` pair and a new save is submitted for the same pair, THE Integration_Config_Store SHALL update the existing record rather than create a duplicate.
6. WHEN a newly created Integration_Config is persisted, THE Integration_Config_Store SHALL set its Connection_Status to `disconnected`.
7. FOR ALL credential values, encrypting a value with the Encryption_Service and then decrypting the result SHALL produce the original value (round-trip property).
8. WHEN an Integration_Config is returned to the Integration_Admin_UI, THE Integration_Config_Store SHALL return a masked view that includes at most the last 4 characters of each credential and SHALL NOT include any decrypted credential value.

### Requirement 3: Runtime Credential Retrieval Guarded by Service Token

**User Story:** As a security engineer, I want runtime credential retrieval to require a per-platform service token, so that arbitrary callers cannot enumerate tenants' integration credentials.

#### Acceptance Criteria

1. WHEN the Runtime_Credential_Service is called with a Platform_Id, a Tenant_Id, and a Runtime_Service_Token whose value is byte-for-byte equal to the token configured for that Platform, THE Runtime_Credential_Service SHALL return, within 2 seconds, the AES-256-GCM encrypted credentials and stored config for the Integration_Config matching that `(Platform_Id, Tenant_Id)` pair.
2. IF the Runtime_Credential_Service is called with a Runtime_Service_Token whose value is not byte-for-byte equal to the token configured for the Platform, THEN THE Runtime_Credential_Service SHALL reject the call with an unauthorized error, SHALL return an error indication identifying the failure as authorization-related, and SHALL return no credentials and no config.
3. IF the Runtime_Credential_Service is called when no Runtime_Service_Token is configured for the Platform, THEN THE Runtime_Credential_Service SHALL reject the call with an unauthorized error and SHALL return no credentials and no config.
4. IF the Runtime_Credential_Service is called with a Runtime_Service_Token, Platform_Id, or Tenant_Id that is missing, empty, or contains only whitespace, THEN THE Runtime_Credential_Service SHALL reject the call with an unauthorized error and SHALL return no credentials and no config.
5. WHEN the Runtime_Credential_Service returns credentials, THE Runtime_Credential_Service SHALL return the credentials as AES-256-GCM ciphertext and SHALL NOT return any decrypted credential value.
6. WHEN the Runtime_Credential_Service is called with a valid Runtime_Service_Token for a `(Platform_Id, Tenant_Id)` pair that has no stored Integration_Config, THE Runtime_Credential_Service SHALL return a result whose resolution status is explicitly marked unresolved and SHALL NOT raise an error.
7. IF the Runtime_Credential_Service rejects a call with an unauthorized error, THEN THE Runtime_Credential_Service SHALL record an audit entry capturing the supplied Platform_Id, the supplied Tenant_Id, and the rejection timestamp, and SHALL NOT include any credential value or token value in that entry.

### Requirement 4: Generic Phone-to-Route Resolution

**User Story:** As a platform administrator, I want an inbound phone number to resolve to a platform, tenant, and conversation type, so that a call reaches the correct voice agent without platform-specific routing code.

#### Acceptance Criteria

1. WHEN a Phone_Route is saved with an inbound phone number, a Platform_Id, a Tenant_Id, and one or more conversation types, THE Phone_Route_Resolver SHALL persist the mapping so the number resolves to that Platform_Id, Tenant_Id, and conversation type set.
2. WHEN the Phone_Route_Resolver receives an inbound number that has a stored Phone_Route, THE Phone_Route_Resolver SHALL return the mapped Platform_Id, Tenant_Id, and resolved conversation type.
3. IF a Phone_Route is saved with a conversation type that is not in the owning tenant's allowed conversation types for the Platform, THEN THE Phone_Route_Resolver SHALL reject the save and report a disallowed-conversation-type error.
4. WHEN the Phone_Route_Resolver receives an inbound number that has no stored Phone_Route, THE Phone_Route_Resolver SHALL fall through to the existing branch and location resolution paths.
5. IF phone-route resolution raises an error, THEN THE Phone_Route_Resolver SHALL default to the restaurant inbound-order route so an inbound call is never dropped by a routing failure.

### Requirement 5: Integration Adapter Interface

**User Story:** As a platform engineer, I want each platform to supply a read client and an outbound intake client behind one common shape, so that the runtime can drive any platform through a single interface.

#### Acceptance Criteria

1. THE Integration_Adapter SHALL expose a read/validate client that performs the platform's in-call lookups and a credential test.
2. THE Integration_Adapter SHALL expose an outbound Intake_Client that submits voice-originated data over the platform's signed contract.
3. WHEN an Integration_Adapter is constructed, THE Integration_Registry SHALL supply the decrypted credentials, base URL, stored config, and Transport_Contract for the target `(Platform_Id, Tenant_Id)`.
4. WHERE a Platform declares a Bearer authentication scheme in its Transport_Contract, THE Integration_Adapter SHALL authenticate outbound read requests using a Bearer token.
5. WHERE a Platform declares an HMAC-signed intake scheme in its Transport_Contract, THE Integration_Adapter SHALL sign the outbound intake payload using the platform's HMAC secret, path prefix, timestamp format, and schema version from the Transport_Contract.
6. FOR ALL intake payloads, canonicalizing then signing then verifying a payload against the same secret SHALL confirm the signature (round-trip property).

### Requirement 6: Pack-to-Adapter Linkage and Adapter Resolution

**User Story:** As a platform engineer, I want a pack to declare which platform adapter it needs and have the runtime resolve it by identifier, so that the ws-server no longer branches on a hardcoded platform.

#### Acceptance Criteria

1. WHEN a VoiceDomainPack declares an IntegrationRequirement whose identifier is a registered Platform_Id, THE Adapter_Resolver SHALL resolve the Integration_Adapter for that Platform_Id.
2. WHEN a call's Platform_Id is resolved from its Phone_Route, THE Adapter_Resolver SHALL select the Integration_Adapter by Platform_Id rather than by any hardcoded platform branch.
3. IF the Adapter_Resolver is asked to resolve a Platform_Id that is not registered, THEN THE Adapter_Resolver SHALL return an unresolved result and THE Voice_Runtime SHALL enable no platform-gated tools for the call.
4. WHEN an Integration_Adapter is resolved for a call, THE Voice_Runtime SHALL add the resolved Platform_Id to the call's enabled integrations so per-tool `requiresIntegration` gating applies.

### Requirement 7: Generic Per-Call Session Binding

**User Story:** As a platform engineer, I want the ws-server to decrypt credentials and bind the per-call session generically, so that adding a platform requires no changes to the ws-server call path.

#### Acceptance Criteria

1. WHEN a call resolves to a Platform_Id and Tenant_Id, THE Voice_Runtime SHALL retrieve the Integration_Config through the Runtime_Credential_Service using the Platform's Runtime_Service_Token within 5 seconds.
2. IF the Runtime_Credential_Service retrieval fails or does not complete within 5 seconds, THEN THE Voice_Runtime SHALL leave the call session without a bound adapter, enable no platform-gated tools, and continue the call.
3. IF the retrieved Integration_Config has a Connection_Status other than `connected`, THEN THE Voice_Runtime SHALL skip credential decryption, leave the call session without a bound adapter, enable no platform-gated tools, and continue the call.
4. WHEN the retrieved Integration_Config has a Connection_Status of `connected`, THE Voice_Runtime SHALL decrypt the credentials locally with the Encryption_Service at the moment of binding.
5. WHEN the credentials are decrypted, THE Voice_Runtime SHALL construct the Integration_Adapter and bind it to the per-call session.
6. IF credential decryption or adapter construction fails, THEN THE Voice_Runtime SHALL leave the call session without a bound adapter, enable no platform-gated tools, and continue the call.
7. THE Voice_Runtime SHALL hold each decrypted credential value only in volatile memory for the duration of the outbound call for which it was decrypted, and SHALL discard every decrypted credential value when that call completes or terminates such that no decrypted credential value is retained afterward.
8. WHERE a resolved conversation type requires an additional per-call sub-session declared by the Platform_Definition, THE Voice_Runtime SHALL bind that sub-session generically from the Platform_Definition rather than from a hardcoded conversation-type check.

### Requirement 8: Credential Test and Connection-Status Gating

**User Story:** As a platform administrator, I want to test an integration's credentials and have tools activate only when connected, so that a voice agent never attempts calls with unverified credentials.

#### Acceptance Criteria

1. WHEN the Credential_Test_Service runs a test for an Integration_Config, THE Credential_Test_Service SHALL perform an authenticated probe against the configured base URL using the Integration_Adapter's read client.
2. WHEN an authenticated probe returns a successful response, THE Credential_Test_Service SHALL set the Integration_Config Connection_Status to `connected`.
3. IF an authenticated probe returns an unsuccessful response, THEN THE Credential_Test_Service SHALL set the Integration_Config Connection_Status to `error`.
4. IF an authenticated probe does not complete within 5 seconds, THEN THE Credential_Test_Service SHALL treat the credential as invalid and set the Connection_Status to `error`.
5. WHILE an Integration_Config Connection_Status is not `connected`, THE Voice_Runtime SHALL enable no platform-gated tools for calls that resolve to that Integration_Config.

### Requirement 9: Integration Admin UI

**User Story:** As a platform administrator, I want a UI to register a platform integration, assign phone numbers, and run a credential test, so that I can onboard a platform without code changes.

#### Acceptance Criteria

1. WHEN an administrator submits a platform integration in the Integration_Admin_UI with a Platform_Id, base URL, credentials, and config, THE Integration_Admin_UI SHALL save the Integration_Config through the Integration_Config_Store.
2. WHEN an administrator assigns an inbound phone number to a Platform_Id, Tenant_Id, and conversation type in the Integration_Admin_UI, THE Integration_Admin_UI SHALL save the Phone_Route through the Phone_Route_Resolver.
3. WHEN an administrator triggers a credential test in the Integration_Admin_UI, THE Integration_Admin_UI SHALL invoke the Credential_Test_Service and display the resulting Connection_Status.
4. WHEN the Integration_Admin_UI displays a saved Integration_Config, THE Integration_Admin_UI SHALL display at most the last 4 characters of each credential.
5. IF an administrator submits an Integration_Config with a missing required field, THEN THE Integration_Admin_UI SHALL display an error naming the missing field and SHALL NOT save the record.

### Requirement 10: Migration of Runsheet to the First Adapter

**User Story:** As a platform engineer, I want existing Runsheet records moved into the generic models, so that Runsheet becomes the first adapter without data loss.

#### Acceptance Criteria

1. THE Integration_Registry SHALL register Runsheet as a Platform_Definition with Platform_Id `runsheet`.
2. WHEN the Migration_Service runs, THE Migration_Service SHALL copy each existing Runsheet integration record into a generic Integration_Config keyed by `(runsheet, Tenant_Id)`.
3. WHEN the Migration_Service copies a Runsheet integration record, THE Migration_Service SHALL preserve the record's base URL, encrypted credentials, config, and Connection_Status without re-encrypting or altering the ciphertext.
4. WHEN the Migration_Service runs, THE Migration_Service SHALL copy each existing Runsheet number assignment into a generic Phone_Route with Platform_Id `runsheet`.
5. FOR ALL migrated Runsheet integration records, retrieving the migrated Integration_Config and decrypting its credentials SHALL produce the same credential values as the pre-migration record (round-trip property).
6. IF the Migration_Service encounters a record it cannot migrate, THEN THE Migration_Service SHALL leave the original Runsheet record unchanged and report the failing record identifier.

### Requirement 11: Backward Compatibility with Live Runsheet Traffic

**User Story:** As a platform operator, I want existing Runsheet calls to keep working during and after generalization, so that live traffic is never disrupted.

#### Acceptance Criteria

1. WHEN an inbound call resolves to a migrated Runsheet Phone_Route, THE Voice_Runtime SHALL bind the Runsheet Integration_Adapter and expose the same Runsheet tool set that was available before generalization.
2. WHEN a Runsheet call submits a voice-originated order, THE Runsheet Integration_Adapter SHALL submit over the existing HMAC-signed intake contract using the existing path prefix, timestamp format, and schema version.
3. WHEN a Runsheet call performs an in-call lookup, THE Runsheet Integration_Adapter SHALL use the existing Bearer-authenticated read surface under the existing path prefix.
4. THE generalized system SHALL preserve the existing Runsheet driver-exception sub-session binding for the driver-exception conversation type.

### Requirement 12: Security and Tenant Isolation

**User Story:** As a security engineer, I want credentials isolated per platform and tenant with no plaintext leakage, so that a compromise of one platform or tenant does not expose others.

#### Acceptance Criteria

1. WHEN the Voice_Runtime retrieves credentials for a `(Platform_Id, Tenant_Id)` pair, THE Runtime_Credential_Service SHALL return only the credentials belonging to that exact pair.
2. WHERE a Platform_Definition declares a key salt in its Transport_Contract, THE Encryption_Service SHALL apply that Platform's key salt so credentials of one Platform cannot be decrypted with another Platform's salt.
3. WHEN the system logs an integration event, THE system SHALL reference credentials by name only and SHALL NOT write any plaintext credential value to a log.
4. WHEN an audit entry is written for an Integration_Config change, THE Integration_Config_Store SHALL record at most the last 4 characters of a credential and SHALL NOT record the full credential value.
5. IF a caller presents a Runtime_Service_Token for one Platform when requesting credentials for a different Platform, THEN THE Runtime_Credential_Service SHALL reject the request with an unauthorized error.

### Requirement 13: Type-Check Gate

**User Story:** As a maintainer, I want the generalization to introduce no new type errors, so that the build stays green.

#### Acceptance Criteria

1. WHEN the TypeScript type check runs after the generalization completes, THE type-check gate SHALL compare the resulting set of type errors against the documented pre-generalization baseline and SHALL report zero new errors for files not listed in the documented Phase_0_Quarantine list, where a "new error" is any type error whose file and error identity is absent from the baseline.
2. WHERE a file is listed in the documented Phase_0_Quarantine list, THE type-check gate SHALL exclude that file from the zero-new-errors evaluation.
3. IF the type-check gate detects one or more new errors in files not listed in the Phase_0_Quarantine list, THEN THE type-check gate SHALL report a failing result that identifies each offending file and error, and SHALL cause the build to fail without modifying source files.
4. WHEN the type-check gate detects zero new errors in files outside the Phase_0_Quarantine list, THE type-check gate SHALL report a passing result and SHALL allow the build to continue.
5. IF a file referenced in the Phase_0_Quarantine list does not exist in the current source tree, THEN THE type-check gate SHALL report a warning result indicating the stale quarantine entry while still evaluating all remaining non-quarantined files.
