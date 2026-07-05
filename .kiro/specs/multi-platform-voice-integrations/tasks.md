# Implementation Plan: Multi-Platform Voice Integrations

## Overview

This plan generalizes the Runsheet-specific "Layer 2" of the Dinee voice platform into a generic, config-driven, multi-platform integration system. Work proceeds in a **staged, backward-compatible rollout**: generic components are introduced *additively* alongside the existing Runsheet-specific code first, Runsheet is then registered as the first adapter and its data migrated with ciphertext preserved byte-for-byte, and only then is the ws-server cut over to the generic binding path. Live Runsheet traffic is never disrupted.

Implementation language is **TypeScript** (per the design). Property-based tests use `fast-check` (min 100 iterations each), tagged `Feature: multi-platform-voice-integrations, Property N`, following the property → test-file mapping in the design. Each of Properties 1–21 is implemented by exactly one property test.

## Tasks

- [x] 1. Define generic platform contracts and adapter interfaces (additive foundation)
  - [x] 1.1 Create `src/lib/integrations/platform/types.ts`
    - Define `AuthScheme`, `TimestampFormat`, `TransportContract` (incl. optional `keySalt`), `AdapterConstructionContext`, `AdapterFactory`, `PlatformDefinition`, `CredentialFieldSpec`, `SubSessionBinding`
    - Define result types: `RegisterPlatformResult`, `PlatformRegistrationError`, `ResolvePlatformResult`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.3, 5.4, 5.5, 7.8, 9.1, 12.2_
  - [x] 1.2 Create `src/lib/integrations/platform/adapter.ts`
    - Define `ReadClient`, `IntakeClient`, `IntakePayload`, `IntakeResult`, `IntegrationAdapter`
    - _Requirements: 5.1, 5.2, 5.6_

- [x] 2. Implement the in-process Integration Registry
  - [x] 2.1 Create `src/lib/integrations/platform/registry.ts`
    - Implement `registerPlatform` (validate-before-mutate: reject `duplicate_id`, `invalid_id` for length <1 or >64, `missing_field` for absent factory/contract, leaving state unchanged), `resolvePlatform` (explicit `{resolved:false}`, never throws), `isPlatformRegistered`, and a testing-only `clearPlatformRegistry`
    - Mirror the `voiceDomainPackRegistry` patterns (Map keyed by id, pure validate step)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - [x]* 2.2 Write property test for the registry — `__tests__/properties/platformRegistry.property.test.ts`
    - **Property 1: Platform registration round-trip** — **Validates: Requirements 1.1, 1.6**
    - **Property 2: Rejected registration reports the correct error and leaves the registry unchanged** — **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
    - **Property 3: Unregistered lookup is an explicit unresolved result, never a throw** — **Validates: Requirements 1.7**

- [x] 3. Add per-platform key-salt support to the Encryption Service
  - [x] 3.1 Extend `src/lib/integrations/encryptionService.ts`
    - Add optional per-platform `keySalt` parameter to encrypt/decrypt so a platform's credentials cannot be decrypted with another platform's salt; when absent, use the shared `INTEGRATION_ENCRYPTION_KEY` unchanged (so migrated Runsheet ciphertext still decrypts)
    - Preserve existing signatures for backward compatibility (no wire/behavior change for existing callers)
    - _Requirements: 2.2, 2.7, 12.2, 10.3_
  - [x]* 3.2 Write property test for encryption — `__tests__/properties/credentialEncryption.property.test.ts`
    - **Property 4: Credential encryption round-trip** (empty, unicode, long values) — **Validates: Requirements 2.2, 2.7**
    - **Property 20: Per-platform key salt isolates decryption** (same salt reproduces value; different salt fails) — **Validates: Requirements 12.2**

- [x] 4. Add generic Convex schema tables
  - [x] 4.1 Add `integrations` and `phoneRoutes` tables to `convex/schema.ts`
    - `integrations`: `platformId`, `tenantId`, `baseUrl`, `platformTenantId`, `credentialsEncrypted` (name→ciphertext), `credentialsLast4`, `allowedConversationTypes`, `config`, `status` union, `createdAt`, `updatedAt`; indexes `by_platform_tenant` and `by_tenant_id`
    - `phoneRoutes`: `phoneNumber`, `platformId`, `tenantId`, `conversationType`, `createdAt`; indexes `by_phone_number` and `by_platform_tenant`
    - Leave `runsheetIntegrations` / `runsheetNumberAssignments` in place (additive rollout)
    - _Requirements: 2.1, 4.1, 4.3, 8.2, 8.3_

- [x] 5. Implement the generic Integration Config Store
  - [x] 5.1 Create `convex/integrations/configStore.ts`
    - Pure helpers: `validateIntegrationConfig` (reject empty/whitespace base URL → `missing_field`; unregistered platform → `unknown_platform`) and `buildIntegrationAuditDetail` (secrets by name + last-4 only, never full value)
    - Convex surface: `upsertIntegrationConfig` keyed by `(platformId, tenantId)` (validate before write, update-not-duplicate on existing pair, new records start `disconnected`), `setConnectionStatus`, internal query + masked public view `getMaskedConfig` (last-4 only, never plaintext/ciphertext), reusing `integrationAuditLog`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.8, 8.2, 8.3, 12.3, 12.4_
  - [x]* 5.2 Write property test for the config store — `__tests__/properties/integrationConfigStore.property.test.ts`
    - **Property 5: Config store upsert keying and initial status** — **Validates: Requirements 2.1, 2.5, 2.6**
    - **Property 6: Config validation rejection** — **Validates: Requirements 2.3, 2.4**
    - **Property 7: Masked view never exposes credential material** — **Validates: Requirements 2.8**
  - [x]* 5.3 Extend audit-secrecy property test — `__tests__/properties/integrationSecurity.test.ts`
    - **Property 21: Audit and log details reference secrets by name only** — **Validates: Requirements 12.3, 12.4**

- [x] 6. Implement the service-token-guarded Runtime Credential Service
  - [x] 6.1 Create `convex/integrations/runtimeCredentials.ts`
    - Per-platform service-token-guarded action fronting an internal query; resolve the token env var from the `PlatformDefinition.runtimeServiceTokenEnvVar`; constant-time token comparison
    - Return `resolved` (ciphertext + config only, never plaintext), `unresolved` (valid token, no config, no throw), or `unauthorized` (missing/empty/whitespace/unconfigured/cross-platform token → no credentials, write name-only audit entry); resolve within 2s
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 12.1, 12.5_
  - [x]* 6.2 Write property test for the credential guard — `__tests__/properties/runtimeCredentialGuard.property.test.ts`
    - **Property 8: Runtime credential guard** — **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 12.5**
    - **Property 19: Runtime credential retrieval is tenant- and platform-isolated** — **Validates: Requirements 12.1**

- [x] 7. Implement the Runsheet Integration Adapter (wrap existing clients, preserve wire contract)
  - [x] 7.1 Create `src/lib/integrations/runsheet/adapter.ts`
    - `runsheetAdapterFactory` wrapping the existing `RunsheetApiClient` (Bearer reads under `/voice`) and `VoiceIntakeClient` (HMAC-signed `POST /voice-intake`) with NO change to their wire behavior
    - Generic `IntakePayload` → `VoiceIntakePayload` adapter (`submitViaRunsheet`) preserving canonical body, ISO-8601 timestamp, `schemaVersion` `"1.0"`, and signed headers byte-for-byte; `readClient.testCredential` never throws
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 11.2, 11.3_
  - [x]* 7.2 Extend intake sign/verify property test — `__tests__/properties/intakeHmac.property.test.ts` (and/or `intakeRoundTrip.property.test.ts`)
    - **Property 11: Intake signature round-trip** (sign→verify confirms; mutating any field fails verification) — **Validates: Requirements 5.5, 5.6**
  - [x]* 7.3 Write Runsheet wire-equivalence property test — `__tests__/properties/runsheetAdapterCompat.property.test.ts`
    - **Property 12: Runsheet adapter preserves the existing wire contract** (byte-identical body + headers vs pre-generalization `VoiceIntakeClient`) — **Validates: Requirements 11.2**

- [x] 8. Register Runsheet as the first Platform Definition
  - [x] 8.1 Create the Runsheet `PlatformDefinition` and startup registration
    - `platformId: "runsheet"`, `credentialFields` (`api_key`, `webhook_secret`), `adapterFactory: runsheetAdapterFactory`, `contract` (`authScheme:"bearer"`, `readPathPrefix:"/voice"`, `intakePath:"/voice-intake"`, `timestampFormat:"iso-8601"`, `schemaVersion:"1.0"`, `tenantHeader:"X-Runsheet-Tenant"`, no `keySalt`), `subSessions` binding `runsheet_driver_exception`, `runtimeServiceTokenEnvVar: "RUNSHEET_RUNTIME_SERVICE_TOKEN"`; register at startup via `registerPlatform`
    - _Requirements: 10.1, 11.4, 12.5_
  - [x]* 8.2 Write startup registration smoke test
    - Assert Runsheet is registered as `runsheet` and resolves to the Runsheet definition — _Requirements: 10.1_

- [x] 9. Implement the Adapter Resolver
  - [x] 9.1 Create `src/lib/integrations/platform/adapterResolver.ts`
    - `resolveAdapter(platformId, ctx)` builds the adapter via the registry's factory for a registered `platformId`; returns unresolved for unregistered so the runtime enables no platform-gated tools
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x]* 9.2 Extend adapter-resolution + gating property test — `__tests__/properties/integrationGating.property.test.ts`
    - **Property 13: Adapter resolution by Platform_Id** — **Validates: Requirements 6.1, 6.2, 6.3**
    - **Property 14: Platform-gated tools require an enabled, connected integration** — **Validates: Requirements 6.4, 8.5**

- [x] 10. Implement the Credential Test Service
  - [x] 10.1 Create `src/lib/integrations/platform/credentialTest.ts`
    - `runCredentialTest(adapter, record)` probes via `readClient.testCredential` (5s deadline), maps success → `connected`, failure → `error`, no completion within 5s → invalid → `error`, records status via the config store, returns the recorded status
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x]* 10.2 Write credential-test status property test — `__tests__/properties/credentialTestStatus.property.test.ts`
    - **Property 16: Credential-test outcome maps to connection status** — **Validates: Requirements 8.2, 8.3, 8.4**

- [x] 11. Generalize Phone-to-Route resolution
  - [x] 11.1 Implement the generic `phoneRoutes` store (Convex mutation + query)
    - Save mapping `(phoneNumber → platformId, tenantId, conversationType)`; reject a conversation type not in the tenant's allowed set for the platform (disallowed-conversation-type error naming the offending type), reusing the pure `isConversationTypeAllowed` predicate and leaving existing routes unchanged
    - _Requirements: 4.1, 4.3_
  - [x] 11.2 Generalize `resolvePhoneToRoute` in `src/lib/call-routing/phone-lookup.ts`
    - Consult the generic `phoneRoutes` store first (return `{platformId, tenantId, conversationType}`); on miss fall through to existing branch/location lookup; on any thrown error default to the restaurant inbound-order route
    - _Requirements: 4.2, 4.4, 4.5_
  - [x]* 11.3 Write phone-route property test — `__tests__/properties/phoneRoute.property.test.ts`
    - **Property 9: Phone route save→resolve round-trip** — **Validates: Requirements 4.1, 4.2**
    - **Property 10: Disallowed conversation type is rejected** — **Validates: Requirements 4.3**
  - [x]* 11.4 Write routing fall-through + fail-open example test
    - Assert `phoneRoutes` miss falls through to branch/location lookup and a thrown resolution error defaults to the restaurant inbound-order route — _Requirements: 4.4, 4.5_

- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement the idempotent Runsheet Migration Service
  - [x] 13.1 Create `convex/integrations/migrateRunsheet.ts`
    - Copy each `runsheetIntegrations` row → `integrations` keyed by `(runsheet, tenantId)` preserving baseUrl, ciphertext (byte-for-byte, never re-encrypted), config, and status; copy each `runsheetNumberAssignments` row → `phoneRoutes` with `platformId:"runsheet"`; idempotent (already-migrated pairs skipped, not duplicated); per-record failure isolation leaving originals unchanged; return a `MigrationReport`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_
  - [x]* 13.2 Write migration property test — `__tests__/properties/runsheetMigration.property.test.ts`
    - **Property 17: Migration copy fidelity and ciphertext-preservation round-trip** — **Validates: Requirements 10.2, 10.3, 10.4, 10.5**
    - **Property 18: Migration failure isolation** — **Validates: Requirements 10.6**

- [x] 14. Cut the ws-server over to generic per-call binding
  - [x] 14.1 Refactor `src/app/ws-server/index.ts`
    - Replace the `isRunsheetCall` branch with generic flow: resolve route → resolve platform → retrieve credentials via `Runtime_Credential_Service` using that platform's token (within 5s) → if `status === "connected"` decrypt (with contract key salt) at bind time → build adapter via factory → bind session and add `platformId` to `enabledIntegrations`
    - Data-driven sub-session binding from `PlatformDefinition.subSessions` (generalize the driver-exception sub-session); connected-only tool gating; on any failure bind no adapter, enable no platform-gated tools, and continue the call; release bound session + sub-sessions and discard decrypted credentials on socket close
    - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.5, 11.1, 11.4_
  - [x]* 14.2 Write sub-session binding property test — `__tests__/properties/subSessionBinding.property.test.ts`
    - **Property 15: Sub-session binding is data-driven** — **Validates: Requirements 7.8**
  - [x]* 14.3 Write ws-server degrade-path example tests
    - Assert bind-skip when status is not `connected` (Req 7.3), and decrypt/adapter-construction failure leaves no adapter bound and the call continuing (Req 7.4–7.6) — _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x]* 14.4 Write backward-compat integration test for the live Runsheet path
    - Assert credential retrieval completes within the deadline (Req 7.1) and a migrated Runsheet phone route binds the Runsheet adapter and exposes the same tool set as baseline (Req 11.1) — _Requirements: 7.1, 11.1_

- [x] 15. Build the generic Integration Admin UI
  - [x] 15.1 Implement the platform-driven admin UI and wire it to the services
    - Render credential fields dynamically from the resolved `PlatformDefinition.credentialFields`; register integration (save via config store), assign inbound number (save via phone-route store), trigger credential test (invoke Credential_Test_Service and display resulting status), masked display showing at most last-4 of each credential; block save and name the missing field on a missing required field
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x]* 15.2 Write admin UI wiring example tests
    - Assert save-through-config-store, assign-number, credential-test status display, masked last-4 display, and missing-field validation — _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 16. Final checkpoint — Type-check gate and full test run
  - [x] 16.1 Run `npm run type-check` (zero new errors outside the Phase 0 quarantine) and `npx vitest run`; fix any regressions introduced by the generalization
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 11.1, 11.2, 11.3, 11.4_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- The rollout is deliberately staged: tasks 1–13 are additive (generic components + Runsheet adapter + migration) and do not touch the live call path; task 14 performs the ws-server cutover only after the generic path and migration are in place, so live Runsheet traffic is never disrupted.
- Each task references specific requirement clauses for traceability.
- Property tests use `fast-check` at a minimum of 100 iterations and are tagged `Feature: multi-platform-voice-integrations, Property N`; each of Properties 1–21 is implemented by exactly one property test, following the design's property → test-file mapping.
- Checkpoints ensure incremental validation before the cutover and before completion.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "4.1"] },
    { "id": 1, "tasks": ["2.1", "3.2", "7.1", "11.1"] },
    { "id": 2, "tasks": ["2.2", "5.1", "8.1", "9.1", "11.2", "7.2", "7.3"] },
    { "id": 3, "tasks": ["5.2", "5.3", "6.1", "8.2", "9.2", "10.1", "11.3", "11.4"] },
    { "id": 4, "tasks": ["6.2", "10.2", "13.1"] },
    { "id": 5, "tasks": ["13.2", "14.1"] },
    { "id": 6, "tasks": ["14.2", "14.3", "14.4", "15.1"] },
    { "id": 7, "tasks": ["15.2"] },
    { "id": 8, "tasks": ["16.1"] }
  ]
}
```
