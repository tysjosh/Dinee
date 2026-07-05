# Implementation Plan: Platform Control Plane

## Overview

This plan layers a cross-tenant, cross-platform **Control Plane** on top of the completed `multi-platform-voice-integrations` feature. Work proceeds in a **staged, additive, backward-compatible** order: additive schema/type changes first, then pure (property-testable) cores, then new Convex read surfaces, then scoped management wrappers that *delegate* to the preserved base entry points, then optional metrics, then the two consoles, and finally the backward-compatibility guardrails.

The plan is strictly additive. It introduces new tables (`credentialTestHistory`), new optional fields (`PlatformDefinition.supportedConversationTypes?`, `users.role` `"partner"` member + `authorizationScope`), new Convex modules, and new UI routes. It **never** changes the signatures of the seven preserved base entry points (`saveIntegrationConfig`/`upsertIntegrationConfig`, `testIntegrationCredential`, `savePhoneRoute`, `resolveRoute`, `getMaskedConfig`, `getConfigForRuntimeInternal`, `getCredentialsForRuntime`), and it does not touch the first-party `/api/v1/...` routes, the operator dashboard, the `NEXT_APP_URL` wrappers, or the Runsheet voice-traffic routing decision.

Implementation language is **TypeScript** (per the design). Property-based tests use **fast-check** (min **100 iterations** each), tagged `Feature: platform-control-plane, Property N`, following the design's property → pure-core mapping. Each of the design's 10 correctness properties is implemented by **exactly one** property test.

## Tasks

- [ ] 1. Additive schema and type foundations
  - [x] 1.1 Add additive schema changes to `convex/schema.ts`
    - Add the append-only `credentialTestHistory` table: `platformId`, `tenantId`, `outcome` (`v.union(v.literal("success"), v.literal("failure"))`), `completedAt` (number); indexes `by_platform_tenant` and `by_platform_tenant_time` (`["platformId","tenantId","completedAt"]`)
    - Add `"partner"` as an additive member of the existing `users.role` union, and add optional `authorizationScope: v.optional(v.array(v.object({ platformId: v.string(), tenantId: v.string() })))`
    - Leave all existing tables/fields (`integrations`, `phoneRoutes`, `integrationAuditLog`, `agentMetrics`, `users`) unchanged so existing rows validate as-is
    - _Requirements: 8.2, 8.3, 8.4, 5.2, 4.5, 5.6, 12.4_
  - [x] 1.2 Add additive type + registry accessors
    - Add optional `supportedConversationTypes?: string[]` to `PlatformDefinition` in `src/lib/integrations/platform/types.ts` (absent → empty catalog list); no change to existing fields or the seven entry points
    - Declare Runsheet's `supportedConversationTypes` (e.g. `["runsheet_inbound_order","runsheet_driver_exception"]`) on its `PlatformDefinition`
    - Add a read-only `listRegisteredPlatforms(): PlatformDefinition[]` snapshot accessor to `src/lib/integrations/platform/registry.ts` (never mutates)
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 2. Implement the pure, property-testable cores
  - [x] 2.1 Implement the Platform_Catalog projection — `src/lib/integrations/platform/catalog.ts`
    - `buildPlatformCatalog(defs)`: exactly one secret-free entry per registered `platformId` (no duplicates, no unregistered platform), copying only `platformId`, `displayName`, `credentialFields` (`{name,label,required}`), and `conversationTypes` (empty when none declared); never copies the adapter factory, service-token env var, or any credential value
    - `getPlatformCatalog()`: server-boundary helper that registers built-in platforms, snapshots the registry via `listRegisteredPlatforms`, and projects; throws a typed "catalog unavailable" error (no partial catalog) when the snapshot cannot be obtained
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 11.1, 11.2_
  - [ ]* 2.2 Write property test for catalog completeness — `__tests__/properties/platformCatalogCompleteness.property.test.ts`
    - **Property 1: Platform catalog completeness** — exactly one entry per registered platform id, no duplicates/no unregistered entry, each entry carries id, display name, credential specs (each with a boolean `required`), and a `conversationTypes` list (empty when none)
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6**
  - [ ]* 2.3 Write property test for catalog secret-freedom — `__tests__/properties/platformCatalogSecretFree.property.test.ts`
    - **Property 2: Platform catalog is secret-free and serializable** — every entry contains only serializable string/boolean/list values and never an adapter factory, service-token env var, or credential value
    - **Validates: Requirements 1.5, 11.1, 11.2**
  - [x] 2.4 Implement the authorization core — `convex/integrations/authorization.ts`
    - Pure `resolveActorFromUser(user)`: `platform_admin` → `{ kind: "unrestricted" }`; `partner` → `{ kind: "tenant", tenantId }` (or explicit `{ kind: "pairs" }` from `authorizationScope`); unrecognized role → `unrecognized_role`; partner with no derivable scope → `scope_undeterminable`
    - Pure `isPairInScope(scope, platformId, tenantId)` and `filterToScope(scope, rows)`
    - Convex `requireActor(ctx)`: resolves identity via `ctx.auth.getUserIdentity()` + the `users` table into role + scope, or a typed failure (`unauthenticated`/`unrecognized_role`/`scope_undeterminable`); returns no integration data on failure
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.6_
  - [ ]* 2.5 Write property test for two-tier read authorization — `__tests__/properties/controlPlaneAuthorization.property.test.ts`
    - **Property 6: Two-tier read authorization isolation** — admin reads all pairs; partner reads exactly in-scope pairs and no others; no-role / scope-undeterminable → authorization error and no data (exercises `resolveActorFromUser`/`isPairInScope`/`filterToScope`)
    - **Validates: Requirements 2.9, 3.5, 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 8.7, 9.5**
  - [x] 2.6 Implement filter/sort/mask pure helpers — `convex/integrations/controlPlane.logic.ts`
    - `applyIntegrationFilter(rows, filter)`: AND-semantics, exact case-sensitive platform/tenant equality, status ∈ {connected,disconnected,error}; no match → empty
    - `sortIntegrations(rows)`: total, request-stable order keyed by `(platformId, tenantId)`
    - `toLast4Preview(stored)`: returns the preview only when it is exactly 4 characters, else `""` (zero unmasked characters for <4-char secrets); plus a `toMaskedSummary(row)` projection that routes `credentialsLast4` through the guard and never emits ciphertext/plaintext
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 11.3, 11.4_
  - [ ]* 2.7 Write property test for deterministic ordering — `__tests__/properties/integrationOrdering.property.test.ts`
    - **Property 3: Deterministic cross-platform ordering** — repeated identical requests return an identical total `(platformId, tenantId)` order, independent of input row order
    - **Validates: Requirements 2.1**
  - [ ]* 2.8 Write property test for filter AND-semantics — `__tests__/properties/integrationFilter.property.test.ts`
    - **Property 4: Filter AND-semantics with exact case-sensitive matching** — returned set equals exactly the rows satisfying all supplied filters together (exact case-sensitive platform/tenant, status ∈ {connected,disconnected,error}); no match → empty
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.8**
  - [x] 2.9 Implement credential-test-history pure cores — `convex/integrations/credentialTestHistory.logic.ts`
    - `statusToOutcome(status)`: `connected → success`, otherwise `failure`
    - `mostRecentPage(records, limit)`: most-recent-first by `completedAt`, page of at most `limit` (100); plus a whole-second UTC truncation helper for `completedAt`
    - _Requirements: 8.2, 8.3_
  - [ ]* 2.10 Write property test for credential-test history cores — `__tests__/properties/credentialTestHistory.property.test.ts`
    - **Property 8: Credential-test history ordering, pagination, and secret-freedom** — outcomes ordered most-recent-first, page of at most 100, each record references only `(platformId, tenantId)` with a `success`/`failure` outcome and whole-second UTC timestamp, never a credential value
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [x] 3. Implement the Control-Plane read surfaces
  - [x] 3.1 Implement cross-platform list & detail — `convex/integrations/controlPlane.ts`
    - `listIntegrations({platform?,tenant?,status?})`: admin-only (`requireActor`), reject non-admin with authorization error and no data, reject malformed/empty filter values leaving data unchanged; query via `by_platform_tenant`/`by_tenant_id` then `applyIntegrationFilter` + `sortIntegrations`, projecting through `toMaskedSummary`
    - `listForPartner({})`: partner-scoped via `requireActor` + `filterToScope`; empty when scope has none; scope-undeterminable → authorization error, no data
    - `getIntegrationDetail({platformId,tenantId})`: authorized by role/scope; absent record → `{ found: false }` (not an error); retrieval failure other than absence → error with no partial detail; masked-only
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_
  - [x] 3.2 Implement credential-test-history surfaces — `convex/integrations/credentialTestHistory.ts`
    - `appendCredentialTestOutcome` (internal mutation): append-only insert of `{platformId,tenantId,outcome,completedAt}`; no update/delete exposed
    - `getCredentialTestHistory`: authorized read returning `mostRecentPage(...,100)` via the time index; out-of-scope → authorization error; no outcomes → empty (not an error); never a credential value
    - `getConnectionStatus`: authorized current status, or `{ recorded: false }` when no integration record exists; out-of-scope → authorization error
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 3.3 Wire the append into the existing credential-test callback (additive) — `convex/integrations/adminConfig.ts`
    - In the existing `testIntegrationCredential` record callback, additionally call `appendCredentialTestOutcome` mapping status via `statusToOutcome` with a whole-second UTC `completedAt`, alongside the existing `setConnectionStatus`
    - Preserve `testIntegrationCredential`'s name, params, and return type exactly (append is a pure additive side effect)
    - _Requirements: 8.2, 12.2_
  - [x] 3.4 Implement scoped audit-log surfaces — `convex/integrations/controlPlaneAudit.ts`
    - A pure scope/order/paginate helper mapping `integrationAuditLog` rows to `AuditEntryView` (name-only `details`), ordering by timestamp descending, paging at most 100
    - `getAuditLogByTenant` and `getAuditLogByPlatform` (admin, via `requireActor`), and `getAuditLogForPartner` (partner scope-bound): out-of-scope → authorization error and no entries; unauthenticated → authentication error and no entries; empty in-scope set → empty result (not an error)
    - Leave the existing `callerRole`-parameter functions in `convex/integrationAuditLog.ts` untouched
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ]* 3.5 Write property test for masking non-exposure — `__tests__/properties/controlPlaneMasking.property.test.ts`
    - **Property 5: Masking non-exposure across every read surface** — for any stored integration and any read surface (list, detail, partner list, status, history, audit), the representation excludes decrypted values and ciphertext, exposes at most last-4, and reveals zero characters when the credential has fewer than 4
    - **Validates: Requirements 2.6, 2.7, 3.2, 3.4, 4.2, 6.10, 7.4, 11.1, 11.2, 11.3, 11.4, 11.5**
  - [ ]* 3.6 Write property test for audit-log views — `__tests__/properties/controlPlaneAudit.property.test.ts`
    - **Property 9: Audit-log ordering, pagination, scope, and secret-freedom** — returned entries are exactly those in the actor's scope for the filter, ordered by timestamp descending, page of at most 100, each referencing credentials by name only with no credential value/secret
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.7**

- [x] 4. Checkpoint — read surfaces validated
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the scoped management wrappers (delegate, never duplicate)
  - [x] 5.1 Implement scoped management wrappers — `convex/integrations/controlPlaneManagement.ts`
    - `saveIntegrationConfigScoped`: `requireActor` then `isPairInScope` check BEFORE delegating to the preserved base `saveIntegrationConfig` action; out-of-scope → authorization error, target unchanged; admin always in scope
    - `savePhoneRouteScoped`: scope-checked wrapper delegating to the preserved base `savePhoneRoute`
    - `testIntegrationCredentialScoped`: scope-checked wrapper delegating to the preserved base `testIntegrationCredential`
    - No change to any base entry point signature
    - _Requirements: 5.1, 5.5, 5.7, 7.3, 7.6_
  - [ ]* 5.2 Write property test for management scope safety — `__tests__/properties/managementScopeSafety.property.test.ts`
    - **Property 7: Management scope safety** — for any partner and any management action whose target pair is outside scope, the action is denied, an authorization error is returned, and the target integration is left byte-for-byte unchanged
    - **Validates: Requirements 5.5, 5.7, 7.6**
  - [ ]* 5.3 Write example tests for scoped delegation — `__tests__/properties/controlPlaneManagement.test.ts`
    - Assert admin save/route/test delegate to the base entry points unchanged, and an out-of-scope partner submission leaves the target unchanged
    - _Requirements: 5.1, 5.5, 5.7, 7.6_

- [x] 6. Implement optional per-platform metrics (flag-gated, deferrable)
  - [x] 6.1 Implement `getPlatformMetrics` gated by `CONTROL_PLANE_METRICS_ENABLED` — `convex/integrations/controlPlaneMetrics.ts`
    - When the flag is disabled, return a "metrics disabled" indication; when enabled, scope-check via `requireActor`, accept a window of 1h–90d inclusive (default 24h), return attempt/success/failure counts + current status (zero counts when no activity), never a credential value; out-of-scope → authorization error
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ]* 6.2 Write integration tests for metrics gating — `__tests__/properties/controlPlaneMetrics.test.ts`
    - Assert flag gating, default 24h window and 1h–90d bounds, zero counts on no activity, and scope denial (1–3 representative cases; sourcing is deferrable)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 7. Implement the Admin_Console and Partner_Console UI
  - [x] 7.1 Extract shared cards from `PlatformIntegrationAdmin.tsx` into `src/components/dashboard/controlPlane/`
    - Create `IntegrationListTable.tsx`, `IntegrationFilters.tsx` (status control offers exactly connected/disconnected/error), `IntegrationDetailPanel.tsx`, `IntegrationConfigForm.tsx` (dynamic credential-field renderer driven by the catalog), `MaskedCredentialsCard.tsx` (last-4 only), `CredentialTestCard.tsx`, `PhoneRouteCard.tsx`; reuse the pure helpers in `platformIntegrationAdmin.logic.ts` verbatim
    - Leave the existing `/integrations/platform` page and component behavior intact
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10, 7.4_
  - [x] 7.2 Implement the Admin_Console route — `src/app/client/dashboard/control-plane/`
    - Server component builds the `Platform_Catalog` via `getPlatformCatalog` and passes it as a serializable prop; client renders the cross-tenant/platform list with filters and a detail panel, reading via `listIntegrations`/`getIntegrationDetail`/`getConnectionStatus`/`getCredentialTestHistory` and managing via the scoped wrappers; empty/filtered-empty → empty state, no error; masked-only display
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_
  - [x] 7.3 Implement the Partner_Console route — `src/app/client/dashboard/partner/`
    - Identical composition reading via `listForPartner`, limiting every list, phone-route assignment, and credential field to the partner's scope; out-of-scope submissions blocked client-side and rejected server-side leaving the integration unchanged; empty scope → empty view; masked-only display
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [ ]* 7.4 Write console wiring example tests — `__tests__/properties/controlPlaneConsole.test.ts`
    - Assert dynamic credential-field rendering from the catalog, required-field blocking (via reused `prepareSaveConfig`), empty/filtered-empty states, masked-only display, and out-of-scope submission blocking
    - _Requirements: 6.1, 6.2, 6.4, 6.6, 6.8, 6.10, 7.1, 7.2, 7.5, 7.6_

- [ ] 8. Backward-compatibility guardrails and remaining edge tests
  - [ ]* 8.1 Write property test for Runsheet routing invariance — `__tests__/properties/routingInvariance.property.test.ts`
    - **Property 10: Runsheet routing invariance under additive Control Plane** — a baseline-vs-current comparator over `resolveRoute` yields the same routing decision for any identical inbound call input with the Control-Plane surfaces present
    - **Validates: Requirements 12.3, 12.6**
  - [ ]* 8.2 Write backward-compat contract/smoke tests — `__tests__/properties/controlPlaneBackwardCompat.test.ts`
    - Snapshot/contract tests confirming first-party `/api/v1/...` routes match the captured baseline (12.1); type/compile checks that the seven preserved entry points keep identical signatures (12.2); reachability smoke checks for the operator dashboard, verticals, and `NEXT_APP_URL` wrappers (12.4); and a path-disjointness assertion for the new console routes (12.5)
    - _Requirements: 12.1, 12.2, 12.4, 12.5_
  - [ ]* 8.3 Write remaining edge/error example tests — `__tests__/properties/controlPlaneEdgeCases.test.ts`
    - Catalog-unavailable error (1.7); malformed/empty-filter rejection (2.10); detail absence (3.3) and retrieval-failure (3.6) paths; partner scope-undeterminable error (4.5); unauthenticated audit request (9.6); detail/audit latency smoke checks (3.1, 9.1–9.3)
    - _Requirements: 1.7, 2.10, 3.1, 3.3, 3.6, 4.5, 9.1, 9.2, 9.3, 9.6_

- [x] 9. Final checkpoint — type-check and full test gate
  - Run `npm run type-check` (zero new errors) and `npx vitest run`; fix any regressions introduced by the Control-Plane additions. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- The rollout is deliberately additive and staged: schema/type changes (Task 1) and pure cores (Task 2) introduce no behavior change; read surfaces (Task 3) and scoped wrappers (Task 5) add new authorized functions that delegate to — and never alter — the seven preserved base entry points; the consoles (Task 7) are new routes that do not touch `/api/v1/...`, the operator dashboard, or the existing `/integrations/platform` page.
- Property tests use `fast-check` at a minimum of 100 iterations and are tagged `Feature: platform-control-plane, Property N`; each of Properties 1–10 is implemented by exactly one property test, following the design's property → pure-core mapping.
- Optional per-platform metrics (Task 6) are flag-gated and deferrable; they are covered by example/integration tests, not property tests, because the submission-count sourcing is deferrable.
- Checkpoints (Tasks 4 and 9) ensure incremental validation before the console work and before completion.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.4", "2.6", "2.9"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "2.7", "2.8", "2.10", "3.1", "3.2", "3.4", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["3.3", "3.5", "3.6", "5.2", "5.3", "6.2", "7.2", "7.3"] },
    { "id": 4, "tasks": ["7.4", "8.1", "8.2", "8.3"] }
  ]
}
```
