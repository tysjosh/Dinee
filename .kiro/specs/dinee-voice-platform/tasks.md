# Implementation Plan: Dinee Voice Platform

## Overview

This plan converts the design into an incremental, test-driven coding sequence that honors the reviewer-driven constraints:

1. **Phase 0 first.** Before any platform refactor, the pre-existing TypeScript errors are inventoried and either fixed or recorded in a documented quarantine list, the current Twilio→OpenAI call path is preserved, and regression/compatibility tests pin the current behavior as a baseline. The zero-error `npm run type-check` gate applies to the refactored platform **only after Phase 0**, excluding quarantined files. No `VoiceDomainPack` refactor work begins until Phase 0 is complete.
2. **Gradual extraction, not deletion.** The existing runtime files that contain real handlers, retry logic, and utilities (`src/app/ws-server/tools.ts`, `logistics-tools.ts`, `call-phase.ts`, `logistics-call-phase.ts`) are extracted into `VoiceDomainPack` modules incrementally, each behind a compatibility test that asserts the extracted behavior matches the Phase 0 baseline. Legacy branching (`isLogistics`, duplicated tool arrays, the two phase modules) is removed **only after** packs cover the existing flows and the compatibility tests pass.
3. **Ownership boundary.** Dinee stores only `runsheetIntegrations` + `runsheetNumberAssignments`, holds the `Order_Draft` **transiently in memory** (never a Convex table), and submits over the signed **Intake_Contract** via the `voiceIntakeClient` and a `Mock_Intake_Client`. There are **no** Dinee `orderDrafts`/`voiceIntakeRequests` tables and **no** Dinee dispatcher-review-queue page. The Voice_Intake_Adapter, review queue, idempotency/replay ledger, and their storage are a **separate Runsheet-repository track** documented (non-code) at the end of this plan.
4. **VoiceDomainPack bridging.** The voice layer is named `VoiceDomainPack` (`voiceDomainPack.ts`, `voiceDomainPackRegistry.ts`, `registerVoiceDomainPack`) and bridges to the existing Module_Pack_System (`src/lib/modules/types.ts`, `toolPackRegistry.ts`) via a `ModulePackBridge` (`verticalPackId`, `reuseToolPackIds`, `reuse`/`extend` mode, `unknown_module_bridge` validation) rather than duplicating a registry. The Runsheet pack reuses the existing logistics `VerticalPack`/tool-pack registration through `moduleBridge`.
5. **HMAC canonicalization.** The intake client signs the exact raw transmitted body (preferred) or RFC 8785 JCS, using the same documented method Dinee (TypeScript) and Runsheet (Python) both use, proven by a shared cross-language test-vector fixture.
6. **Mandatory security tests.** The property tests for tool gating (Property 6), HMAC authentication (18), idempotency (19), tenant match (20), replay window (21), and serialization round-trip (22) are **MANDATORY** (not marked `*`) and gate the MVP. The intake-side security properties are exercised on the Dinee side through the `Mock_Intake_Client` and the shared test vectors.
7. **No auto-submit toggle in MVP.** The admin UI stores auto-submit config internally but surfaces no toggle; auto-submit (Req 13) is a clearly-marked later phase.

MVP scope is Requirements 1–12, 18, and 20. Later phases (Requirements 13–17, 19) are at the end and clearly marked out of MVP.

All property-based tests use `fast-check` + Vitest under `__tests__/properties/**`, run with a minimum of 100 iterations (`fc.assert(..., { numRuns: 100 })`), and carry the tag comment `// Feature: dinee-voice-platform, Property {n}: {property text}` plus a `Validates: Requirements ...` reference, matching the existing `toolPackEnforcement.test.ts` convention. Run tests with `npx vitest run` and the type-check gate with `npm run type-check`.

## Tasks

- [x] 1. Phase 0 — Stabilization (runs BEFORE any VoiceDomainPack refactor)
  - [x] 1.1 Add the test script and inventory/fix-or-quarantine pre-existing TypeScript errors
    - Add `"test": "vitest run"` to `package.json` scripts so property/unit suites run in single-execution mode
    - Run `npm run type-check`, then for each pre-existing error (phone provisioning, scheduled functions, billing fields, implicit `any`) either fix it or record it in a documented quarantine list at `.kiro/specs/dinee-voice-platform/type-quarantine.md` that names the file and the error
    - _Requirements: 1.1_

  - [x] 1.2 Record exposed committed secrets by name in an audit record
    - Scan committed environment configuration for exposed secrets and, for any identified as exposed, reference the secret by name in an audit record without reproducing the secret value
    - _Requirements: 1.13_

  - [x] 1.3 Add regression coverage that pins the current Twilio→OpenAI call path (baseline)
    - Add regression/compatibility tests that exercise the existing Twilio→OpenAI path so a caller reaching an existing configured number reaches a Realtime_Agent, capturing the current behavior as the baseline the gradual extraction must not break
    - File `__tests__/properties/callPathBaseline.test.ts`
    - _Requirements: 1.2, 1.3_

- [x] 2. VoiceDomainPack contract, registry, and ModulePackBridge
  - [x] 2.1 Define the VoiceDomainPack contract types
    - Create `src/lib/modules/voiceDomainPack.ts` with `VoiceDomainPack`, `ConversationTypeDefinition`, `VoiceToolDefinition`, `CallPhaseDefinition`, `EscalationRule`, `EscalationTarget`, `IntegrationRequirement`, `FallbackBehavior`, the transcript-metadata shape, and the `ModulePackBridge` type (`verticalPackId`, `reuseToolPackIds`, `mode: "reuse" | "extend"`)
    - Encode field-bound documentation (id 1–64, name 1–128, description ≤1024, 1–50 conversation types, ≤100 tools, 1–20 phases), per-tool `allowedPhases`/`requiresIntegration`/`readOnly`/`handler`/`reusesModuleTool`, and per-conversation `initialPhase`/`transcriptMetadata`/`fallbackBehavior`
    - _Requirements: 2.1, 2.5, 2.7, 2.8_

  - [x] 2.2 Implement the VoiceDomainPack registry with module-bridge validation and gating
    - Create `src/lib/modules/voiceDomainPackRegistry.ts` with `registerVoiceDomainPack`, `resolvePackByConversationType`, `resolveToolSet`, `isToolCallPermitted`, and `clearRegistry`
    - Enforce the ordered validation (invalid_id → duplicate_id → missing_field/field_out_of_bounds → invalid_tool_phase → initialPhase membership → `unknown_module_bridge` when a `moduleBridge` target is absent from the Module_Pack_System); make registration atomic so a rejected pack leaves the registry unchanged
    - `resolveToolSet` applies membership + integration gating and, when a `moduleBridge` is present in `reuse` mode, derives the tool set from the linked `src/lib/modules/toolPackRegistry.ts` tool packs so a tool disabled at the module level is never re-exposed; `extend` mode adds voice-only tools on top; `isToolCallPermitted` returns `{ permitted, reason }` for membership (`not_in_set`) and phase (`not_in_phase`)
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.8, 2.9, 3.1, 3.6, 4.2, 4.3, 4.4_

  - [x]* 2.3 Write property test for registration validation
    - **Property 1: VoiceDomainPack registration validation** — generate packs with mutated bounds; assert accept iff all bounds hold and rejection names the offending field with the registry unchanged
    - File `__tests__/properties/voiceDomainPackRegistration.property.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.3**

  - [x]* 2.4 Write property test for duplicate-id rejection
    - **Property 2: Duplicate identifier rejection leaves the registry unchanged** — assert a `duplicate_id` error whose detail records the conflicting id and a registry snapshot equal to before
    - File `__tests__/properties/voiceDomainPackDuplicateId.property.test.ts`
    - **Validates: Requirements 2.3**

  - [x]* 2.5 Write property test for tool-phase validity
    - **Property 3: Tool phase references must be defined phases** — generate tools referencing valid/invalid phase ids; assert `invalid_tool_phase` naming the offending phase and registry unchanged
    - File `__tests__/properties/voiceDomainPackToolPhase.property.test.ts`
    - **Validates: Requirements 2.6**

  - [x]* 2.6 Write property test for conversation-type resolution uniqueness
    - **Property 4: Conversation-type resolution is unique** — disjoint conversation-type generator; assert the single owning pack or `null`
    - File `__tests__/properties/packResolution.property.test.ts`
    - **Validates: Requirements 3.1**

  - [x]* 2.7 Write property test for integration + module-bridge gating of the exposed tool set
    - **Property 7: Integration gating of the exposed tool set (honors module bridge)** — assert `resolveToolSet` includes a tool iff it needs no integration or its required integration is enabled, and that a `reuse`-mode bridge never re-exposes a tool disabled at the module level
    - File `__tests__/properties/integrationGating.property.test.ts`
    - **Validates: Requirements 4.4, 2.9**

  - [x] 2.8 Write property test for tool-call gating (membership ∧ phase) — MANDATORY
    - **Property 6: Tool-call gating (membership ∧ phase)** — mirror `toolPackEnforcement.test.ts`; assert `isToolCallPermitted` is permitted iff the tool is in the set and the active phase is in its `allowedPhases`, and that a rejected call is not executed, returns a rejection result, preserves the phase, and records an audit entry (tool, phase, callId)
    - File `__tests__/properties/voiceToolGating.property.test.ts`
    - **Validates: Requirements 3.6, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4**

  - [x]* 2.9 Write example tests for the Module_Pack_System bridge
    - Assert a pack with a `moduleBridge` reuses an existing `VerticalPack`/tool-pack registration without duplicating it, and a bridge to a missing target is rejected with `unknown_module_bridge`
    - File `__tests__/properties/moduleBridge.test.ts`
    - _Requirements: 2.8, 2.9_

- [x] 3. Generic pack-driven session driver
  - [x] 3.1 Implement the generic phase engine
    - Create `src/app/ws-server/runtime/phaseEngine.ts` with `nextPhase(phases, current, event)` returning the target phase for a matching transition or the current phase otherwise
    - This is the generic replacement the two legacy call-phase modules fold into during extraction
    - _Requirements: 3.6_

  - [x] 3.2 Implement the session config builder
    - Create `src/app/ws-server/runtime/sessionConfig.ts` that builds the OpenAI `session.update` payload (prompt + integration-gated tool set + transcription hint) from a resolved pack and conversation type, before the first spoken response
    - _Requirements: 3.3, 3.4_

  - [x] 3.3 Implement the tool executor with timeout and fallback
    - Create `src/app/ws-server/runtime/toolExecutor.ts` with `executeTool(handlerKey, args, ctx, timeoutMs = 5000)` returning `{ status: "ok" | "error" | "timeout" }`
    - Resolve `timeout` at the 5s deadline and `error` on backend failure so the driver can continue with the conversation-type fallback behavior
    - _Requirements: 6.5, 6.6_

  - [x] 3.4 Implement the transcript buffer
    - Create `src/app/ws-server/runtime/transcriptBuffer.ts` that appends confirmed human/AI turns keyed by `callSid` and retains unpersisted turns in memory for retry on persistence failure
    - _Requirements: 18.1, 18.4_

  - [x] 3.5 Implement `prepareSession` and tool-call gating dispatch
    - Create `src/app/ws-server/runtime/session.ts` with `prepareSession(ctx)` returning `start` (with `SessionInit`) or `terminate` (`no_pack` / `no_mapping` + audit record); resolution precedes any OpenAI session init and the number lookup resolves a route within the SLA
    - On a function-call event, call `isToolCallPermitted`; on `not_in_set`/`not_in_phase` return a rejection result, do not execute, preserve the phase, and write an audit entry (tool, phase, callId); on permitted, execute via the tool executor and apply the declared phase transition
    - Fail-safe on unconfirmed submission: while the call is active and `runsheet_queue_dispatch_review` placement is unconfirmed, retain the transient in-session draft for retry and never persist it as a Dinee order-of-record; if placement is still unconfirmed when the call ends, escalate or transfer per the configured `Escalation_Target` rather than discarding the draft
    - _Requirements: 1.9, 1.10, 1.11, 3.1, 3.2, 3.5, 3.7, 3.8, 4.5, 4.6, 6.8, 6.9, 6.10_

  - [x]* 3.6 Write property test for unresolved-route termination
    - **Property 5: Unresolved route terminates the call without a session** — assert `prepareSession` returns `terminate` with the correct reason + audit (unresolved conversation type / called number + call id) and never `start`
    - File `__tests__/properties/routeTermination.property.test.ts`
    - **Validates: Requirements 1.11, 3.5, 4.6**

  - [x]* 3.7 Write property test for transcript append ordering
    - **Property 23: Transcript append preserves all turns in order** — for any sequence of appended turns, the stored transcript for that call id contains all turns in append order
    - File `__tests__/properties/transcriptAppend.property.test.ts`
    - **Validates: Requirements 18.1**

  - [x]* 3.8 Write unit tests for the tool executor
    - Cover timeout (fake timers), backend error (rejected mock), and dispatch-review non-confirmation retaining the transient draft
    - File `__tests__/properties/toolExecutor.test.ts`
    - _Requirements: 6.5, 6.6, 6.8_

- [x] 4. Gradual extraction of existing flows into packs, transport wiring, and clean-house
  - [x] 4.1 Extract the restaurant flow into a VoiceDomainPack module
    - Create `src/lib/modules/packs/restaurant/` and move the real handlers/retry logic/utilities out of `src/app/ws-server/tools.ts` into pack modules incrementally, expressing the restaurant prompt, tools, and phases against the `VoiceDomainPack` contract; leave the legacy runtime path intact until the compatibility test passes
    - _Requirements: 1.4, 1.6_

  - [x] 4.2 Write compatibility test for the restaurant extraction (required — gates legacy removal)
    - Assert the extracted restaurant pack behavior matches the Phase 0 baseline recorded in task 1.3
    - This is a required prerequisite for the legacy-removal task 4.8; that task must not run until this test passes
    - File `__tests__/properties/restaurantExtractionCompat.test.ts`
    - _Requirements: 1.4, 1.5_

  - [x] 4.3 Extract the logistics flow into a VoiceDomainPack module bridging the existing logistics registration
    - Create `src/lib/modules/packs/logistics/` and move the real handlers/retry logic/utilities out of `src/app/ws-server/logistics-tools.ts` into pack modules incrementally; set a `moduleBridge` that reuses the existing logistics `VerticalPack`/tool-pack registration rather than duplicating it; leave the legacy path intact until the compatibility test passes
    - _Requirements: 1.4, 1.6, 2.9_

  - [x] 4.4 Write compatibility test for the logistics extraction (required — gates legacy removal)
    - Assert the extracted logistics pack behavior matches the Phase 0 baseline recorded in task 1.3
    - This is a required prerequisite for the legacy-removal task 4.8; that task must not run until this test passes
    - File `__tests__/properties/logisticsExtractionCompat.test.ts`
    - _Requirements: 1.4, 1.5_

  - [x] 4.5 Extract the two call-phase modules into the phase engine + pack phase definitions
    - Fold the behavior of `src/app/ws-server/call-phase.ts` and `src/app/ws-server/logistics-call-phase.ts` into `runtime/phaseEngine.ts` and the restaurant/logistics pack `CallPhaseDefinition[]`, keeping the legacy modules in place until the compatibility test passes
    - _Requirements: 1.4, 1.6_

  - [x] 4.6 Write compatibility test for the phase-machine extraction (required — gates legacy removal)
    - Assert phase transitions driven by `phaseEngine` + pack definitions match the legacy call-phase modules against the Phase 0 baseline
    - This is a required prerequisite for the legacy-removal task 4.8; that task must not run until this test passes
    - File `__tests__/properties/phaseExtractionCompat.test.ts`
    - _Requirements: 1.4, 1.5_

  - [x] 4.7 Wire the transport entry to delegate to the session driver
    - Update `src/app/ws-server/index.ts` to resolve packs via the registry and delegate session lifecycle to `runtime/session.ts` for the existing restaurant/logistics conversation types, keeping only transport code (Twilio webhooks, media-stream sockets, OpenAI socket lifecycle)
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 4.8 Remove legacy branching only after packs cover the flows
    - This task depends on the three required compatibility tests (4.2, 4.4, 4.6) all passing; do not begin until each of those tests is green
    - After the compatibility tests (4.2, 4.4, 4.6) pass, remove the `isLogistics` branch and the duplicated inline tool arrays from `src/app/ws-server/index.ts` and delete `call-phase.ts`, `logistics-call-phase.ts`, `tools.ts`, and `logistics-tools.ts`, redirecting all references to `runtime/` + pack definitions so all domain-specific voice logic lives under `src/lib/modules/packs`
    - _Requirements: 1.5, 1.6_

  - [x] 4.9 Verify the type-check gate after the refactor (required gate)
    - Run `npm run type-check` and confirm zero errors excluding only the files recorded in the Phase 0 quarantine list; this zero-error gate is a required, non-optional gate for the refactored platform
    - _Requirements: 1.7_

  - [x] 4.10 Implement the agent-runtime health harness
    - Create an integration-style harness verifying phone-number lookup resolves a route, phase state initializes, tool definitions load for the resolved domain, and out-of-set tool calls are rejected
    - _Requirements: 1.12_

  - [x]* 4.11 Write health-endpoint and latency smoke tests
    - Assert the Voice_Runtime health endpoint returns success within 5 seconds, the `/incoming-call` number lookup resolves within 2 seconds, and a media-stream connection is established on resolution
    - File `__tests__/properties/healthEndpoint.test.ts`
    - _Requirements: 1.8, 1.9, 1.10_

- [x] 5. Checkpoint - Ensure the stabilized, extracted platform is green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Runsheet VoiceDomainPack
  - [x] 6.1 Define the Runsheet conversation types
    - Create `src/lib/modules/packs/runsheet/conversationTypes.ts` declaring exactly `runsheet_fuel_order_intake`, `runsheet_order_status`, `runsheet_driver_exception`, `runsheet_dispatch_callback` and no others
    - _Requirements: 4.1_

  - [x] 6.2 Define the fuel-intake phase machine
    - Create `src/lib/modules/packs/runsheet/phases.ts` with `customer_identification`, `order_building`, and terminal `order_finalized`, plus transitions; mutation phases exclude the customer-identification phase
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.3 Define the fuel-intake tools (six-tool review-only MVP set)
    - Create `src/lib/modules/packs/runsheet/tools.ts` with exactly the six MVP tools (`runsheet_lookup_customer`, `runsheet_list_customer_sites`, `runsheet_list_customer_tanks`, `runsheet_validate_product`, `runsheet_create_order_draft`, `runsheet_queue_dispatch_review`), each with `requiresIntegration: "runsheet"`, `allowedPhases`, and `readOnly` flags
    - Do NOT define `runsheet_submit_order` here — it is a later-phase (auto-submit / Req 13) tool introduced only when that feature ships (task 12.1); do NOT define any model-invoked transcript-capture tool (`runsheet_append_call_transcript`) — transcript capture is a runtime side-effect handled by `transcriptBuffer`, not a model tool
    - Gate `allowedPhases` so the terminal `order_finalized` phase permits only `runsheet_queue_dispatch_review`
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3_

  - [x] 6.4 Define the fuel-intake prompts
    - Create `src/lib/modules/packs/runsheet/prompts.ts` driving collection of customer/callback, delivery site, product code, quantity or fill-to-full, and delivery window
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.5 Implement slot definitions and the transient `Order_Draft` builder
    - Create `src/lib/modules/packs/runsheet/slots.ts` with `SlotDefinition` (per-tenant `required`, `validate`, `maxRequests: 3`), `OrderDraftInput`, and `buildOrderDraft` producing the in-memory `OrderDraft` (never a Convex table)
    - Encode: invalid values are not recorded and are re-requested; a slot unresolved after 3 requests is marked missing; PO number required only where the tenant requires it; urgency constrained to `normal`/`urgent`/`emergency`; every collected value appears in `slots`; confidence in `[0,1]`
    - _Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

  - [x] 6.6 Assemble and register the Runsheet pack via moduleBridge
    - Create `src/lib/modules/packs/runsheet/index.ts` that assembles the `VoiceDomainPack`, sets a `moduleBridge` reusing the existing logistics `VerticalPack`/tool-pack registration where present, and registers it with the registry during platform initialization; a validation failure is surfaced per Req 4.3
    - _Requirements: 2.8, 2.9, 4.2, 4.3_

  - [x]* 6.7 Write property test for invalid slot rejection
    - **Property 9: Invalid slot values are never recorded** — for any value failing a slot validator, it is absent from the transient draft and the slot stays unresolved
    - File `__tests__/properties/slotValidation.property.test.ts`
    - **Validates: Requirements 5.10**

  - [x]* 6.8 Write property test for missing-slot marking
    - **Property 10: Unresolved slots are marked missing after the retry limit** — a slot unresolved after 3 requests appears in `missingSlots`
    - File `__tests__/properties/slotMissing.property.test.ts`
    - **Validates: Requirements 5.9**

  - [x]* 6.9 Write property test for draft completeness, urgency enum, and slot inclusion
    - **Property 11: Draft completeness, urgency enum, and slot inclusion** — `slots` contains every collected value, urgency ∈ {normal,urgent,emergency}, confidence ∈ [0,1], and no complete draft when a required PO number is uncollected
    - File `__tests__/properties/orderDraftCompleteness.property.test.ts`
    - **Validates: Requirements 5.6, 5.7, 5.8, 5.11**

  - [x]* 6.10 Write example tests for the pack's declared surface
    - Assert the pack declares exactly the four conversation types and that the review-only MVP fuel-intake tool set is exactly the six tools, containing no model-invoked transcript-append tool and no `runsheet_submit_order`
    - File `__tests__/properties/runsheetPackSurface.test.ts`
    - _Requirements: 4.1, 6.1, 6.2_

  - [x]* 6.11 Write example test for Runsheet phase gating
    - Applying **Property 6**, assert a mutation tool (`runsheet_create_order_draft`) requested before `customer_identification` completes is rejected with an audit entry
    - File `__tests__/properties/runsheetPhaseGating.test.ts`
    - _Requirements: 7.4_

- [x] 7. Runsheet read/validate API client
  - [x] 7.1 Implement the Runsheet API read client
    - Create `src/lib/integrations/runsheet/apiClient.ts` (extending the existing shipment-oriented `runsheetClient.ts`) with `lookupCustomer` (single/list/empty by match count; rejects when neither phone nor account id is given), `listCustomerSites`, `listCustomerTanks`, `validateProduct` (boolean), and `testCredential`
    - _Requirements: 6.2, 6.3, 6.4, 8.5_

  - [x]* 7.2 Write property test for customer-lookup result shape
    - **Property 12: Customer lookup result shape matches match count** — single when one match, ordered list when many, empty when none
    - File `__tests__/properties/customerLookupShape.property.test.ts`
    - **Validates: Requirements 6.2**

  - [x]* 7.3 Write example test for lookup argument validation
    - `lookupCustomer` with neither phone nor account id returns an error
    - File `__tests__/properties/runsheetApiClient.test.ts`
    - _Requirements: 6.3_

- [x] 8. Intake_Contract client, Mock_Intake_Client, and mandatory security
  - [x] 8.1 Implement the signed Intake_Contract client
    - Create `src/lib/integrations/runsheet/voiceIntakeClient.ts` with `VoiceIntakePayload`, `canonicalizeIntake` (exact raw transmitted body by default, RFC 8785 JCS as the documented alternative), `deserializeIntake`, `signIntake` (HMAC-SHA256 hex over the canonical bytes), and `submitVoiceIntake` (signed `POST {baseUrl}/voice-intake` with tenant/idempotency/timestamp/signature/schema-version headers)
    - Shape `VoiceIntakePayload` so it carries the full confirmed transcript content — a `transcript` array of `TranscriptTurn` (`role: "caller" | "agent"`, `text`, `at` epoch ms) — in addition to the `transcriptId` reference, so the Runsheet backend receives the transcript content without a callback into Dinee
    - _Requirements: 10.2, 10.3, 10.6, 10.9, 11.1, 11.7, 20.4_

  - [x] 8.2 Implement the Mock_Intake_Client test double
    - Create `src/lib/integrations/runsheet/mockIntakeClient.ts` implementing `IntakeClient` with in-memory idempotency, replay-window, and tenant checks matching the contract semantics, recording received canonical bytes + signature so Dinee-side tests can assert HMAC correctness, replay rejection, tenant mismatch, idempotent replay, and round-trip fidelity
    - _Requirements: 20.6_

  - [x] 8.3 Author the shared cross-language HMAC/canonicalization test-vector fixture
    - Create a shared fixture (`__tests__/fixtures/intakeVectors.json`) of fixed `payload → canonical bytes → expected signature` that both the Dinee TypeScript client and the Runsheet Python adapter run, proving signing in TypeScript and verification in Python produce identical signature inputs
    - _Requirements: 11.7_

  - [x] 8.4 Write property test for intake payload serialization round-trip — MANDATORY
    - **Property 22: Intake payload serialization round-trip (deterministic, byte-identical, cross-language)** — `deserializeIntake(canonicalizeIntake(payload))` reconstructs extracted slots and intake metadata — **including the full transcript content (every confirmed turn, its role, text, and timestamp) and the transcript identifier** — equivalent to the submitted values, and re-canonicalizing the reconstructed values is byte-identical to the transmitted canonical bytes; runs the shared vectors from 8.3; generator includes awkward slot values and transcript turns (unicode, empty strings, numbers-as-strings, nested, key-order permutations, multi-turn transcripts)
    - File `__tests__/properties/intakeRoundTrip.property.test.ts`
    - **Validates: Requirements 10.2, 10.3, 10.9, 11.6, 11.7**

  - [x] 8.5 Write property test for HMAC authentication — MANDATORY
    - **Property 18: HMAC authentication of the intake path** — a correctly signed request authenticates; any altered signature/payload is rejected, recorded, and creates no order (verified on the Dinee side via the Mock_Intake_Client); runs the shared cross-language vectors from 8.3
    - File `__tests__/properties/intakeHmac.property.test.ts`
    - **Validates: Requirements 11.1, 11.2, 11.7**

  - [x] 8.6 Write property test for idempotent submission — MANDATORY
    - **Property 19: Idempotent intake submission** — via the Mock_Intake_Client, a repeat of an accepted idempotency key returns the original stored result and creates no duplicate
    - File `__tests__/properties/intakeIdempotency.property.test.ts`
    - **Validates: Requirements 11.3**

  - [x] 8.7 Write property test for tenant match — MANDATORY
    - **Property 20: Tenant match on the intake path** — via the Mock_Intake_Client, a mismatched tenant id is rejected, recorded, and creates no order
    - File `__tests__/properties/intakeTenantMatch.property.test.ts`
    - **Validates: Requirements 11.4**

  - [x] 8.8 Write property test for replay-window freshness — MANDATORY
    - **Property 21: Replay-window freshness** — via the Mock_Intake_Client, a timestamp outside the window is rejected as replay (no order); one inside (otherwise valid) is accepted
    - File `__tests__/properties/intakeReplayWindow.property.test.ts`
    - **Validates: Requirements 11.5**

  - [x]* 8.9 Write property test for intake required-field validation
    - **Property 17: Intake required-field validation** — via the Mock_Intake_Client, omitting callId, callerPhone, or extractedSlots is rejected naming the field and creates no order
    - File `__tests__/properties/intakeRequiredFields.property.test.ts`
    - **Validates: Requirements 10.5**

  - [x]* 8.10 Write example test for the Mock_Intake_Client contract conformance
    - Assert `MockIntakeClient` implements `IntakeClient` and passes the shared contract vectors from 8.3
    - File `__tests__/properties/mockIntakeClient.test.ts`
    - _Requirements: 20.6_

- [x] 9. Runsheet integration configuration and admin UI (Dinee-owned)
  - [x] 9.1 Add the Dinee-owned integration schema tables and extend the conversation-type validator
    - Add `runsheetIntegrations` (including `autoSubmitEnabled` stored internally) and `runsheetNumberAssignments` to `convex/schema.ts` with documented fields/indexes, and extend the existing `conversationTypeValidator` union with the four `runsheet_*` types; do not add any `orderDrafts` or `voiceIntakeRequests` tables
    - _Requirements: 8.1, 8.4, 9.1, 9.2, 4.1_

  - [x] 9.2 Implement integration config save/validate with encryption and credential test
    - Create `convex/runsheet/integrations.ts` mutations that encrypt the API key and webhook secret (AES-256-GCM via the existing `encryptionService`), store `apiKeyLast4`, validate review mode ∈ {always_review, auto_submit_low_risk} and required base URL/tenant id/API key, and expose a credential test; reject invalid input leaving the stored integration unchanged; audit entries reference secrets by name only
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 9.3 Implement number-to-conversation-type assignment
    - Create `convex/runsheet/numberAssignments.ts` mutation that accepts an assignment iff the conversation type is in the tenant's allowed set and rejects otherwise, leaving existing assignments unchanged, and resolves an accepted number to exactly the mapped conversation type
    - _Requirements: 9.1, 9.5, 9.6_

  - [x] 9.4 Implement escalation-target validation
    - Create `src/lib/integrations/runsheet/configValidation.ts` validating an escalation target as exactly one valid phone number, email address, or webhook URL; invalid input is rejected leaving the existing target unchanged
    - _Requirements: 9.4, 9.7_

  - [x] 9.5 Build the Runsheet Admin configuration UI (no Auto_Submit toggle in MVP)
    - Create `src/app/dashboard/integrations/runsheet/page.tsx` (Tailwind v4, existing `card`/`btn`/`badge` utilities) with forms for base URL, tenant id, API key, webhook secret, default review mode, allowed conversation types, a Test-credential action, number-to-conversation-type assignment, and escalation-target config; store the Auto_Submit setting internally and surface no Auto_Submit enable/disable toggle; validation errors surface inline
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 9.1, 9.2, 9.4_

  - [x]* 9.6 Write property test for config validation
    - **Property 15: Review-mode and required-field configuration validation** — accepted only if review mode is valid and base URL/tenant id/API key present; else rejected naming the field and stored config unchanged
    - File `__tests__/properties/integrationConfigValidation.property.test.ts`
    - **Validates: Requirements 8.4, 8.6, 8.7**

  - [x]* 9.7 Write property test for escalation-target validation
    - **Property 16: Escalation-target validation** — accepted iff a valid phone/email/webhook; invalid rejected leaving the existing target unchanged
    - File `__tests__/properties/escalationTarget.property.test.ts`
    - **Validates: Requirements 9.7**

  - [x]* 9.8 Write property test for number mapping and allowed-set restriction
    - **Property 8: Number-to-conversation-type mapping and allowed-set restriction** — assignment succeeds iff in the allowed set, rejection leaves assignments unchanged, resolving an accepted number returns exactly the mapped type, and callable types ⊆ allowed types
    - File `__tests__/properties/numberMapping.property.test.ts`
    - **Validates: Requirements 4.5, 9.5, 9.6**

  - [x]* 9.9 Write property test for API-key encryption round-trip
    - **Property 13: API key encryption round-trips and hides plaintext** — `decrypt(encrypt(k)) === k` and ciphertext ≠ `k`
    - File `__tests__/properties/apiKeyEncryption.property.test.ts`
    - **Validates: Requirements 8.2**

  - [x]* 9.10 Write property test for secret masking in audit records
    - **Property 14: Secrets are referenced by name, never by value, in audit records** — the serialized audit entry never contains the secret, only its name and at most a masked last-4
    - File `__tests__/properties/secretMasking.property.test.ts`
    - **Validates: Requirements 1.13, 8.3**

  - [x]* 9.11 Write structural ownership-boundary test
    - Assert the Dinee Convex schema contains no `orderDrafts`, `voiceIntakeRequests`, or dispatcher-review-queue tables, there is no Dinee review-queue page, the only Dinee submission path is the Intake_Contract client, and the admin UI presents no Auto_Submit toggle in MVP
    - File `__tests__/properties/ownershipBoundary.test.ts`
    - _Requirements: 20.1, 12.8, 20.4, 9.2_

- [x] 10. Transcript capture and dispatch-review submission wiring
  - [x] 10.1 Wire the dispatch-review handler and runtime transcript side-effect
    - Create `src/lib/modules/packs/runsheet/handlers.ts` mapping `runsheet_queue_dispatch_review` to submit the transient draft to the Runsheet backend via the signed `voiceIntakeClient` over the Intake_Contract, carrying the full confirmed transcript content plus the transcript id; on non-confirmation during the active call retain the transient in-session draft for retry and never persist it to a Dinee table; if placement is still unconfirmed at call end, escalate or transfer per the configured `Escalation_Target`
    - Do NOT wire any model-invoked transcript-append tool; transcript capture is a runtime side-effect performed by the session driver's `transcriptBuffer` (task 3.4), not a tool the model calls
    - _Requirements: 6.7, 6.8, 6.9, 6.10, 18.1, 18.3, 20.3_

  - [x] 10.2 Implement transcript association and append persistence
    - Create `convex/runsheet/transcripts.ts` that persists transcript content against the call id (reusing the existing Dinee-owned `transcripts` table) and associates the transcript id with the submitted intake payload, retaining unpersisted content for retry on failure
    - _Requirements: 18.2, 18.4_

  - [x]* 10.3 Write example test for dispatch-review non-confirmation and escalation-on-unconfirmed
    - Assert that during an active call a non-confirmed `runsheet_queue_dispatch_review` retains the transient draft in-session for retry and never persists it to a Dinee table, and that when placement is still unconfirmed at call end the runtime escalates or transfers per the configured `Escalation_Target` rather than discarding the draft
    - File `__tests__/properties/dispatchReviewRetry.test.ts`
    - _Requirements: 6.8, 6.9, 6.10, 10.7, 20.3_

- [x] 11. Checkpoint - Ensure all MVP tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Runsheet Backend Implementation Track (separate repo — OUT OF SCOPE for this repo)

> This section is a **non-code** parallel plan for the Runsheet team. It lives in the Runsheet repository (Python/FastAPI). Dinee does **not** host, implement, or store any of the following, and **no Dinee coding task above implements it**. It is documented so the two tracks can be built and tested in parallel against the shared Intake_Contract and the shared HMAC/canonicalization test vectors (task 8.3).

The Runsheet backend must build and own:

- **Voice_Intake_Adapter endpoint** (`POST /voice-intake`, `channel: "voice"`) that enforces, in fixed order: HMAC verification over the same Canonical_Payload method Dinee uses (constant-time), freshness/replay window, tenant match, idempotency (return original result on duplicate), and required-field validation (Req 10.1, 11.2, 11.3, 11.4, 11.5, 10.5).
- **Intake and Order_Draft persistence** — the voice intake request record with all intake metadata + source schema version, and the authoritative `Order_Draft` lifecycle (Req 10.2, 10.3, 10.4, 20.2).
- **Idempotency + replay ledger** keyed by idempotency key + tenant with the stored original response and timestamp bookkeeping (Req 11.3, 11.5).
- **Dispatcher review queue + dispatcher UI** — list drafts with the extracted form, transcript, confidence, missing/uncertain fields, recommended action, and recording link; accept/edit/reject controls; accept → order + accepting dispatcher recorded; reject → no order; `always_review` routes every draft (Req 12.1–12.8).
- **Runsheet-side property/integration tests** for adapter acceptance/persistence/audit, the server-side mandatory security checks, and the dispatcher workflow, running the **shared cross-language HMAC/canonicalization vectors** (Req 11.7) so Python verification matches TypeScript signing.

## Later Phases (out of MVP scope)

The tasks below implement Requirements 13–17 and 19. They are deferred and should be scheduled only after the MVP above is complete and verified.

- [x] 12. (LATER PHASE) Auto-submit eligibility — Requirement 13
  - [x] 12.1 Introduce the later-phase `runsheet_submit_order` tool and the auto-submit eligibility evaluator
    - Add the `runsheet_submit_order` tool definition to `src/lib/modules/packs/runsheet/tools.ts` (excluded from the review-only MVP six-tool set) so it is exposed in the resolved tool set only now that the Auto_Submit feature is delivered
    - Add an eligibility evaluator that auto-submits under `auto_submit_low_risk` only when the full conjunction holds (known customer/site/tank/product, confidence ≥ threshold, no compliance warning, no credit hold, no unusual instruction); otherwise route to review; record `auto_submitted` and the confidence at submission
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 6.2_

  - [x] 12.2 Surface the Auto_Submit toggle in the admin UI
    - Update `src/app/dashboard/integrations/runsheet/page.tsx` to surface the Auto_Submit enable/disable toggle now that Requirement 13 is delivered
    - _Requirements: 9.3_

  - [x]* 12.3 Write property test for auto-submit eligibility
    - Auto-submitted iff the full eligibility conjunction holds; otherwise routed to review
    - File `__tests__/properties/autoSubmitEligibility.property.test.ts`
    - _Requirements: 13.1, 13.2_

- [x] 13. (LATER PHASE) Customer status agent — Requirement 14
  - [x] 13.1 Implement the status conversation type and read-only tools
    - Add the `runsheet_order_status` read-only tools (`runsheet_lookup_order_by_phone`, `runsheet_get_order_status`, `runsheet_get_eta`, `runsheet_get_recent_deliveries`) and their handlers
    - _Requirements: 14.1, 14.2_

  - [x]* 13.2 Write test for read-only mutation rejection
    - Applying **Property 6**, assert any mutation tool requested during a `runsheet_order_status` conversation is rejected with an audit entry
    - File `__tests__/properties/statusAgentReadOnly.test.ts`
    - _Requirements: 14.3_

- [x] 14. (LATER PHASE) Driver voice agent — Requirement 15
  - [x] 14.1 Implement the driver conversation type, tools, phases, and PIN gating
    - Add the `runsheet_driver_exception` tools, verification/assignment phases, driver-identifier fallback, and sensitive-action PIN gating so reporting tools are permitted only after identity is confirmed and an active assignment is present
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x]* 14.2 Write test for driver gating
    - Applying **Property 6**, assert reporting tools are rejected before identity confirmation / active assignment
    - File `__tests__/properties/driverGating.test.ts`
    - _Requirements: 15.2, 15.5, 15.6_

- [x] 15. (LATER PHASE) Per-agent monitoring and metrics — Requirement 16
  - [x] 15.1 Record per-agent call outcomes
    - Add an `agentMetrics` table to `convex/schema.ts` and record on call completion the calls-received/completed counts, duration, tool success/failure counts, fallback occurrence, review-required outcome, and Auto_Submit outcome
    - _Requirements: 16.1_

  - [x] 15.2 Compute windowed metrics with tenant scoping
    - Compute per-agent tool-failure/fallback/review-required/Auto_Submit rates over a window, scoping metrics to a Runsheet_Admin's tenant and exposing all tenants to a platform operator
    - _Requirements: 16.2, 16.3, 16.4_

- [x] 16. (LATER PHASE) Alerting — Requirement 17
  - [x] 16.1 Implement alert rules
    - Add an `agentAlerts` table to `convex/schema.ts` and raise alerts on dependency failure (OpenAI/Twilio/Runsheet), low-confidence-rate, review-required-rate, per-tenant tool-rejection-rate, and per-tenant authentication-failure-rate threshold breaches over the reporting window
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [-] 17. (LATER PHASE) Optional parahackAI telephony — Requirement 19 — REMOVED (out of scope)
  - This optional telephony integration (Requirement 19) was descoped and its implementation removed. The pure carrier-routing/rule-gating module (`src/lib/telephony/parahack.ts`), its unit test (`src/lib/telephony/parahack.test.ts`), and the property test (`__tests__/properties/parahackConsentGating.property.test.ts`) were deleted. No other code depended on it. Calls continue to route through the default Twilio path.
  - ~~17.1 Implement parahackAI carrier routing and rule gating~~ (removed)
  - ~~17.2 Write property test for parahackAI rule gating~~ (removed)

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- The mandatory security property tests — Property 6 (tool gating, task 2.8), Property 18 (HMAC, task 8.5), Property 19 (idempotency, task 8.6), Property 20 (tenant match, task 8.7), Property 21 (replay window, task 8.8), and Property 22 (round-trip serialization, task 8.4) — are **not** marked optional and gate the MVP. Property 22 maps to Req 10.2/10.3/10.9/11.6/11.7 and asserts the full transcript content round-trips byte-identically.
- The three extraction compatibility tests (4.2 restaurant, 4.4 logistics, 4.6 phase-machine) are **required, not optional**; they are prerequisites that gate the legacy-removal task 4.8, which must not run until all three pass. The post-refactor `npm run type-check` zero-error gate (task 4.9) is also **required, not optional**.
- The review-only MVP fuel-intake tool set is exactly six tools (task 6.3); `runsheet_submit_order` is never in the resolved set until the later-phase Auto_Submit feature ships (task 12.1, Req 6.2/13.5), and transcript capture is a runtime side-effect (`transcriptBuffer`, task 3.4), never a model-invoked tool (Req 6.1, 18.1).
- Fail-safe on unconfirmed submission: if `runsheet_queue_dispatch_review` placement is not confirmed before the call ends, the runtime escalates/transfers per the configured `Escalation_Target` rather than discarding the transient draft; during the active call it retains the draft for retry and never persists it as a Dinee order-of-record (Req 6.9, 6.10).
- Phase 0 (Epic 1) runs before any refactor; the extraction (Epic 4) is gradual and behind compatibility tests, and legacy removal (task 4.8) happens only after those tests pass (Req 1.4, 1.5).
- Dinee stores only `runsheetIntegrations` + `runsheetNumberAssignments`; the `Order_Draft` is transient in-memory; there are no Dinee `orderDrafts`/`voiceIntakeRequests` tables and no Dinee review-queue page (Req 20.1, 12.8). The Voice_Intake_Adapter, review queue, and ledger are the separate Runsheet-repo track above.
- Property tests use `fast-check` + Vitest under `__tests__/properties/**`, 100 iterations minimum, tagged `// Feature: dinee-voice-platform, Property {n}: {text}` with a `Validates: Requirements ...` reference.
- The intake HTTP endpoint is order-creating and network-exposed (owned by the Runsheet backend); it is authenticated solely by HMAC over the Canonical_Payload plus tenant match and freshness — there is no unauthenticated mutation path, and Dinee exposes no equivalent path.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "7.1", "8.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2", "3.3", "3.4", "6.1", "6.2", "6.3", "6.4", "6.5", "7.2", "7.3", "8.2", "8.3", "9.2", "9.3", "9.4"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "3.5", "6.6", "6.7", "6.8", "6.9", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11"] },
    { "id": 4, "tasks": ["3.6", "3.7", "3.8", "4.1", "4.3", "6.10", "6.11", "10.1", "10.2"] },
    { "id": 5, "tasks": ["4.2", "4.4", "4.5", "10.3"] },
    { "id": 6, "tasks": ["4.6", "4.7"] },
    { "id": 7, "tasks": ["4.8"] },
    { "id": 8, "tasks": ["4.9", "4.10"] },
    { "id": 9, "tasks": ["4.11"] },
    { "id": 10, "tasks": ["12.1", "13.1", "15.1"] },
    { "id": 11, "tasks": ["12.2", "14.1", "15.2", "16.1"] },
    { "id": 12, "tasks": ["12.3", "13.2", "14.2", "17.1"] },
    { "id": 13, "tasks": ["17.2"] }
  ]
}
```
