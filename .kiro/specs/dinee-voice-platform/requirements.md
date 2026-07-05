# Requirements Document

## Introduction

This feature transforms Dinee from a restaurant/logistics call-management application into a general **voice-agent platform** on which external products configure and operate voice agents. The first external product integrated on the platform is **Runsheet**, a fuel and logistics dispatch product.

The target architecture is: a caller reaches a Dinee-managed phone number (Twilio) → the Dinee Voice Runtime → an OpenAI Realtime agent → a Runsheet tool pack → the Runsheet backend intake path → the Runsheet dispatcher dashboard. Dinee owns the agent runtime; Runsheet owns operational truth (customers, orders, dispatch).

**Ownership boundary.** Operational truth lives in the **Runsheet backend**, not in Dinee. The Runsheet backend owns and stores the voice intake request record, the `Order_Draft`, the dispatcher review queue, and final order state. Dinee owns and stores only: the phone-number-to-conversation-type mapping, agent/`VoiceDomainPack` configuration, integration configuration, call records, transcripts, and audit logs. Dinee submits voice-originated orders to the Runsheet backend over a defined, signed **Intake_Contract** and never acts as the system of record for orders. The Runsheet backend voice-intake endpoints, idempotency handling, and review-queue behavior are implemented as a **parallel Runsheet-repository track**; Dinee codes against that track through the Intake_Contract and a Dinee-side mock client for testing.

The work includes an explicit **stabilization then clean-house** component. **The current codebase does not pass `npm run type-check`** — it has many pre-existing errors (phone provisioning, scheduled functions, billing fields, and implicit `any` declarations). Stabilization is therefore an explicit **Phase 0** that runs **before** any platform-refactor work: pre-existing TypeScript errors are fixed or explicitly quarantined, and the current Twilio/OpenAI call path is preserved with regression coverage. Only after Phase 0 does the zero-error `npm run type-check` gate apply to the refactored platform.

The current Voice Runtime (`src/app/ws-server/index.ts`) hardcodes restaurant-versus-logistics branching, inlines tool definitions, and maintains vertical-specific call-phase state machines. Existing runtime files contain real handlers, retry logic, and utilities (the ws-server tool/handler modules `tools.ts` and `logistics-tools.ts`, and the two call-phase modules `call-phase.ts` and `logistics-call-phase.ts`). These are **extracted gradually into pack modules behind compatibility tests**; legacy branching is removed only after packs cover the existing flows, not deleted wholesale up front. The new voice pack abstraction is a voice-specific layer named **`VoiceDomainPack`** that bridges to and extends the existing module-pack system (`src/lib/modules/types.ts`, `src/lib/modules/toolPackRegistry.ts`) rather than introducing a parallel registry. A `VerticalPack` contract, a tool-pack registry with dynamic loading and integration gating, and a `runsheetClient` already exist but are shipment-oriented and partly stubbed.

**MVP scope (primary deliverable):** A customer calls a Dinee-managed Runsheet phone number, states a fuel need, the Fuel Intake Agent collects the required order details, and a draft order — with transcript and extracted fields — appears in the Runsheet dispatcher review queue in review-only mode. The MVP is review-only: no auto-submit enable/disable toggle is surfaced in the admin UI. Auto-submit, the customer status agent, the driver agent, platform monitoring/billing, and the optional parahackAI integration are documented here as later phases and are explicitly out of the MVP.

## Glossary

- **Dinee_Platform**: The overall voice-agent platform that hosts voice domain packs, the Voice Runtime, integration configuration, and administrative interfaces.
- **Voice_Runtime**: The Dinee WebSocket server (`src/app/ws-server`) that bridges Twilio media streams to the OpenAI Realtime agent and dispatches tool calls.
- **Realtime_Agent**: The OpenAI Realtime session that conducts the spoken conversation for a single call.
- **Module_Pack_System**: The existing Dinee module-pack infrastructure (`src/lib/modules/types.ts`, `src/lib/modules/toolPackRegistry.ts`) that defines the `VerticalPack` type, tool packs, and their registries.
- **VoiceDomainPack**: A self-contained, dynamically loadable definition of an external product's voice capabilities — identity, prompts, conversation types, tools, call phases, escalation rules, and required integration configuration. The VoiceDomainPack is a voice-specific layer that extends and bridges to the Module_Pack_System rather than duplicating a parallel registry.
- **VoiceDomainPack_Registry**: The Dinee_Platform component that registers, validates, and resolves VoiceDomainPacks at runtime, reusing the Module_Pack_System where a registration already exists.
- **Runsheet**: The first external product integrated on the Dinee_Platform, a fuel and logistics dispatch product.
- **Runsheet_Backend**: The Runsheet-owned server, implemented in the Runsheet repository, that hosts the Voice_Intake_Adapter, the Order_Draft store, the Dispatcher_Review_Queue, and final order state.
- **Runsheet_Pack**: The VoiceDomainPack that defines Runsheet's voice agents, conversation types, and tools.
- **Runsheet_Admin**: A user, acting for a Runsheet tenant, who configures Runsheet voice agents within the Dinee_Platform.
- **Fuel_Intake_Agent**: The Runsheet_Pack voice agent for the `runsheet_fuel_order_intake` conversation type that collects fuel order details from a caller.
- **Status_Agent**: The read-only Runsheet_Pack voice agent for the `runsheet_order_status` conversation type.
- **Driver_Agent**: The Runsheet_Pack voice agent for the `runsheet_driver_exception` conversation type used by drivers.
- **Runsheet_Integration**: The stored, per-tenant configuration that connects the Dinee_Platform to a specific Runsheet backend tenant.
- **Intake_Contract**: The defined, versioned request and response contract (payload shape, canonicalization, HMAC signing, idempotency, replay window, tenant matching, and error semantics) that the Dinee_Platform codes against to submit voice-originated orders to the Runsheet_Backend.
- **Mock_Intake_Client**: A Dinee-side test double that implements the Intake_Contract so that Dinee submission behavior can be tested without the live Runsheet_Backend.
- **Voice_Intake_Adapter**: The Runsheet_Backend component (implemented in the Runsheet repository, not hosted by Dinee) that receives voice-originated orders through a dedicated intake path. Dinee submits to it over the signed Intake_Contract.
- **Order_Draft**: A non-authoritative order produced by the Fuel_Intake_Agent, containing extracted slots, transcript reference, and confidence data, pending dispatcher action. The Order_Draft is owned and persisted by the Runsheet_Backend; the Dinee_Platform retains it only transiently for submission and retry.
- **Dispatcher_Review_Queue**: The Runsheet_Backend review queue and dispatcher interface listing voice-originated Order Drafts awaiting accept, edit, or reject. It is owned and stored by Runsheet, not by Dinee.
- **Confidence_Score**: A numeric value in the inclusive range 0.0 to 1.0 representing the agent's certainty in the extracted order data.
- **Auto_Submit**: The mode in which an Order_Draft is submitted directly to Runsheet without dispatcher review when all eligibility conditions are met.
- **Escalation_Target**: A configured phone number, email address, or webhook URL that receives escalations when the Realtime_Agent cannot complete a conversation.
- **Monitoring_Service**: The Dinee_Platform component that records per-agent metrics and raises alerts.
- **Canonical_Payload**: The deterministic byte representation of a voice intake payload used for HMAC signing and verification — either the exact raw HTTP request body transmitted, or an RFC 8785 JSON Canonicalization Scheme (JCS) serialization.
- **HMAC_Signature**: A keyed hash (HMAC-SHA256) computed over the Canonical_Payload that authenticates a request between the Dinee_Platform and the Runsheet_Backend.
- **Idempotency_Key**: A unique key that identifies a single call-or-order attempt so that repeated delivery does not create duplicate records.

## Requirements

### Requirement 1: Phase 0 Stabilization, then Clean-House of Dinee Core

**User Story:** As a Dinee platform engineer, I want the baseline stabilized in an explicit Phase 0 before any platform refactor, and legacy logic removed only after packs cover existing flows, so that the platform is a clean and non-regressing foundation for external voice domain packs.

#### Acceptance Criteria

1. WHERE a pre-existing TypeScript error exists in the baseline codebase (including phone provisioning, scheduled functions, billing fields, and implicit `any` declarations), THE Dinee_Platform SHALL, during Phase 0 stabilization and before VoiceDomainPack refactor work begins, either correct the error or record the error in a documented quarantine list that identifies the file and the error.
2. WHEN Phase 0 stabilization completes, THE Dinee_Platform SHALL preserve the current Twilio-to-OpenAI call path such that a caller reaching an existing configured number reaches a Realtime_Agent.
3. THE Dinee_Platform SHALL provide regression coverage that exercises the current Twilio-to-OpenAI call path and that passes at the completion of Phase 0 stabilization.
4. THE Dinee_Platform SHALL extract the existing Voice_Runtime handler modules, retry logic, and utilities — including the tool modules `src/app/ws-server/tools.ts` and `src/app/ws-server/logistics-tools.ts` and the call-phase modules `src/app/ws-server/call-phase.ts` and `src/app/ws-server/logistics-call-phase.ts` — into VoiceDomainPack modules incrementally, and SHALL cover each extraction with a compatibility test that verifies the extracted behavior matches the behavior recorded before extraction.
5. THE Dinee_Platform SHALL remove legacy vertical branching from the Voice_Runtime only after VoiceDomainPack modules cover the corresponding existing call flows, as verified by passing compatibility tests.
6. WHERE domain-specific voice logic exists after extraction, THE Dinee_Platform SHALL organize that logic under the packs directory (`src/lib/modules/packs`) rather than inside the Voice_Runtime entry module.
7. WHEN Phase 0 stabilization is complete and the VoiceDomainPack refactor is applied, THE refactored Dinee_Platform SHALL compile with zero TypeScript errors reported by the `npm run type-check` command, excluding only files recorded in the Phase 0 quarantine list.
8. WHEN the Voice_Runtime starts in the local development environment and its health endpoint is requested, THE Voice_Runtime SHALL return, within 5 seconds, a response reporting an operational status of success.
9. WHEN a Twilio webhook request reaches the `/incoming-call` route, THE Voice_Runtime SHALL resolve the called number to a conversation route within 2 seconds.
10. WHEN the Voice_Runtime resolves the called number to a conversation route, THE Voice_Runtime SHALL establish a media-stream connection for the call.
11. IF the called number on a `/incoming-call` request does not resolve to a conversation route, THEN THE Voice_Runtime SHALL reject the request with an error indication and SHALL NOT establish a media-stream connection.
12. THE Dinee_Platform SHALL provide an agent-runtime health test that verifies phone-number lookup resolves a route, call-phase state initializes, tool definitions load for the resolved domain, and tool calls that are not in the resolved tool set are rejected.
13. IF a secret value committed to environment configuration is identified as exposed, THEN THE Dinee_Platform SHALL reference that secret by name in an audit record without reproducing the secret value.

### Requirement 2: VoiceDomainPack Contract

**User Story:** As a Dinee platform engineer, I want a formal VoiceDomainPack contract that extends the existing module-pack system, so that external products define voice agents in a consistent, first-class way without a duplicate registry.

#### Acceptance Criteria

1. THE Dinee_Platform SHALL define a VoiceDomainPack interface that includes an identifier (1 to 64 characters), a name (1 to 128 characters), a description (0 to 1024 characters), at least 1 and at most 50 conversation types, at most 100 tool definitions, at least 1 and at most 20 call-phase definitions, a default prompt, escalation rules, and an integration configuration listing each integration the pack requires to operate.
2. WHEN a VoiceDomainPack is registered, THE VoiceDomainPack_Registry SHALL validate that the identifier is non-empty, is between 1 and 64 characters, and is unique among registered packs.
3. IF a VoiceDomainPack is registered with an identifier that already exists in the VoiceDomainPack_Registry, THEN THE VoiceDomainPack_Registry SHALL reject the registration, return an error indicating a duplicate identifier and record the conflicting identifier, and leave the set of registered packs unchanged.
4. IF a VoiceDomainPack is registered with any required field (identifier, name, at least one conversation type, or at least one call-phase definition) missing or outside its defined bounds, THEN THE VoiceDomainPack_Registry SHALL reject the registration, return an error indicating the offending field, and leave the set of registered packs unchanged.
5. WHEN a VoiceDomainPack defines a tool, THE VoiceDomainPack SHALL declare, for that tool, the tool name, a description, a parameter schema, and the call phases in which the tool is permitted.
6. IF a VoiceDomainPack defines a tool that permits a call phase not present in the pack's call-phase definitions, THEN THE VoiceDomainPack_Registry SHALL reject the registration, return an error indicating the invalid call phase, and leave the set of registered packs unchanged.
7. THE VoiceDomainPack SHALL declare, for each conversation type, the transcript metadata shape and a default fallback behavior.
8. THE VoiceDomainPack SHALL be defined as a voice-specific layer that extends and bridges to the Module_Pack_System (`src/lib/modules/types.ts`, `src/lib/modules/toolPackRegistry.ts`) rather than introducing a separate parallel tool registry.
9. WHERE the Module_Pack_System already registers a tool pack or vertical for a product, THE VoiceDomainPack_Registry SHALL reuse or wrap that registration rather than duplicating it.

### Requirement 3: Dynamic VoiceDomainPack Loading in the Voice Runtime

**User Story:** As a Dinee platform engineer, I want the Voice Runtime to load voice domain packs dynamically, so that adding a new external product does not require editing the runtime.

#### Acceptance Criteria

1. WHEN a call is routed to a conversation type, THE Voice_Runtime SHALL resolve, within 2 seconds, the single VoiceDomainPack whose registered conversation types include that conversation type.
2. THE Voice_Runtime SHALL complete VoiceDomainPack resolution before initializing the Realtime_Agent session.
3. WHEN the Voice_Runtime initializes a Realtime_Agent session, THE Voice_Runtime SHALL load the tool definitions and system prompt from the resolved VoiceDomainPack.
4. THE Voice_Runtime SHALL apply the loaded tool definitions and system prompt before the Realtime_Agent produces its first spoken response.
5. IF a call is routed to a conversation type that no registered VoiceDomainPack owns, THEN THE Voice_Runtime SHALL not initialize a Realtime_Agent session, play an audio message to the caller, terminate the call, and record an audit entry containing the unresolved conversation type and the call identifier.
6. WHEN the Voice_Runtime evaluates a tool call, THE Voice_Runtime SHALL permit the tool call only when the tool is present in the resolved VoiceDomainPack tool set and permitted in the active call phase of the resolved VoiceDomainPack.
7. IF the Realtime_Agent requests a tool that is not in the resolved VoiceDomainPack tool set, THEN THE Voice_Runtime SHALL reject the tool call, not execute the tool, return a rejection result to the Realtime_Agent, preserve the call state, and record an audit entry containing the rejected tool name and the call identifier.
8. IF the Realtime_Agent requests a tool that is present in the resolved VoiceDomainPack tool set but not permitted in the active call phase, THEN THE Voice_Runtime SHALL reject the tool call, not execute the tool, return a rejection result to the Realtime_Agent, preserve the call state, and record an audit entry containing the rejected tool name, the active call phase, and the call identifier.

### Requirement 4: Runsheet VoiceDomainPack Registration

**User Story:** As a Runsheet Admin, I want Runsheet available as a voice domain pack on Dinee, so that I can create Runsheet voice agents.

#### Acceptance Criteria

1. THE Runsheet_Pack SHALL declare exactly the conversation types `runsheet_fuel_order_intake`, `runsheet_order_status`, `runsheet_driver_exception`, and `runsheet_dispatch_callback`, and no other conversation types.
2. WHEN the Dinee_Platform initializes, THE Dinee_Platform SHALL register the Runsheet_Pack with the VoiceDomainPack_Registry.
3. IF registration of the Runsheet_Pack fails validation, THEN THE VoiceDomainPack_Registry SHALL reject the registration, return an error indicating the offending field, and leave the set of registered packs unchanged, consistent with Requirement 2.
4. WHERE the Runsheet_Integration for a tenant is disabled or absent, THE Voice_Runtime SHALL exclude from the resolved tool set for that tenant every Runsheet tool whose definition declares required integration configuration.
5. WHEN a called number resolves to a Runsheet tenant, THE Voice_Runtime SHALL select as the active conversation type the conversation type mapped to that called number's configured route.
6. IF a called number resolves to a Runsheet tenant but no conversation type is mapped to that number's configured route, THEN THE Voice_Runtime SHALL not initialize a Realtime_Agent session, play an audio message to the caller, terminate the call, and record an audit entry containing the called number and the call identifier, consistent with Requirement 3.

### Requirement 5: Fuel Order Intake Slot Collection

**User Story:** As a fuel customer, I want to place a fuel order by phone, so that a dispatcher receives my order details without a live human taking the call.

#### Acceptance Criteria

1. WHILE the Fuel_Intake_Agent is collecting order details, THE Fuel_Intake_Agent SHALL request the customer name or callback phone number.
2. WHILE the Fuel_Intake_Agent is collecting order details, THE Fuel_Intake_Agent SHALL request the delivery site.
3. WHILE the Fuel_Intake_Agent is collecting order details, THE Fuel_Intake_Agent SHALL request the product code.
4. WHILE the Fuel_Intake_Agent is collecting order details, THE Fuel_Intake_Agent SHALL request the requested quantity in gallons or a fill-to-full indication.
5. WHILE the Fuel_Intake_Agent is collecting order details, THE Fuel_Intake_Agent SHALL request the requested delivery window.
6. WHERE the calling tenant requires a purchase order number, THE Fuel_Intake_Agent SHALL request the purchase order number before producing an Order_Draft.
7. WHEN the caller reports a runout concern or states urgency, THE Fuel_Intake_Agent SHALL record on the Order_Draft an urgency level of exactly one of `normal`, `urgent`, or `emergency`.
8. WHEN all required slots for the calling tenant are collected, THE Fuel_Intake_Agent SHALL produce an Order_Draft containing the extracted slots and a Confidence_Score.
9. IF a required slot remains unresolved after the Fuel_Intake_Agent has requested that slot 3 times, THEN THE Fuel_Intake_Agent SHALL mark that slot as missing on the Order_Draft.
10. IF the caller provides a value for a required slot that fails validation, THEN THE Fuel_Intake_Agent SHALL re-request the slot, SHALL NOT record the invalid value on the Order_Draft, and SHALL inform the caller that the value was not accepted.
11. WHEN the Fuel_Intake_Agent records the extracted slots on the Order_Draft, THE Fuel_Intake_Agent SHALL include each collected slot value in the recorded extracted slots.

### Requirement 6: Fuel Order Intake Tools

**User Story:** As a Runsheet Admin, I want the fuel intake agent to look up and validate Runsheet data during the call, so that captured orders reference real customers, sites, and products.

#### Acceptance Criteria

1. THE Runsheet_Pack SHALL define, for the review-only MVP fuel-intake tool set, exactly the tools `runsheet_lookup_customer`, `runsheet_list_customer_sites`, `runsheet_list_customer_tanks`, `runsheet_validate_product`, `runsheet_create_order_draft`, and `runsheet_queue_dispatch_review`, and SHALL NOT include a model-invoked transcript-capture tool in that tool set.
2. THE Runsheet_Pack SHALL treat `runsheet_submit_order` as a later-phase tool that is never exposed in the resolved tool set until the Auto_Submit feature defined in Requirement 13 is implemented.
3. WHEN the Fuel_Intake_Agent invokes `runsheet_lookup_customer` with a phone number or account identifier, THE Runsheet_Integration SHALL respond within 5 seconds with a single customer record when exactly one customer matches, an ordered list of matching customer records when more than one customer matches, and an empty result when no customer matches.
4. IF the Fuel_Intake_Agent invokes `runsheet_lookup_customer` with neither a phone number nor an account identifier, THEN THE Runsheet_Integration SHALL reject the invocation and return an error indication.
5. WHEN the Fuel_Intake_Agent invokes `runsheet_validate_product` with a product code, THE Runsheet_Integration SHALL respond within 5 seconds with a boolean result indicating whether the product code is valid for the tenant.
6. IF a Runsheet tool invocation does not respond within 5 seconds, THEN THE Voice_Runtime SHALL treat the invocation as failed, record the tool name and the timeout, and continue the conversation with the configured fallback behavior.
7. IF a Runsheet tool invocation returns an error from the Runsheet_Backend, THEN THE Voice_Runtime SHALL record the tool name and the error and continue the conversation with the configured fallback behavior.
8. WHEN the Order_Draft is complete, THE Fuel_Intake_Agent SHALL invoke `runsheet_queue_dispatch_review` to submit the Order_Draft to the Runsheet_Backend for placement in the Dispatcher_Review_Queue.
9. IF `runsheet_queue_dispatch_review` does not confirm placement of the Order_Draft in the Dispatcher_Review_Queue before the call ends, THEN THE Voice_Runtime SHALL escalate or transfer the call per the configured Escalation_Target and SHALL NOT silently discard the Order_Draft.
10. WHILE `runsheet_queue_dispatch_review` placement remains unconfirmed during an active call, THE Voice_Runtime SHALL retain the Order_Draft transiently for retry, and SHALL NOT persist the Order_Draft as a Dinee order-of-record.

### Requirement 7: Runsheet Call Phase Gating

**User Story:** As a Runsheet Admin, I want tools gated by conversation phase, so that mutations happen only after the caller and order context are established.

#### Acceptance Criteria

1. WHILE the Fuel_Intake_Agent is in the customer-identification phase, THE Voice_Runtime SHALL permit only the customer lookup tool and the site or tank listing tools.
2. WHILE the Fuel_Intake_Agent is in the order-building phase, THE Voice_Runtime SHALL permit the product validation tool and the order-draft creation tool.
3. WHEN the Order_Draft is finalized, THE Voice_Runtime SHALL permit the dispatch-review queueing tool.
4. IF the Realtime_Agent requests a mutation tool before the customer-identification phase completes, THEN THE Voice_Runtime SHALL reject the tool call, not execute the tool, preserve the call state, and record an audit entry containing the rejected tool name, the current call phase, and the call identifier.

### Requirement 8: Runsheet Integration Configuration

**User Story:** As a Runsheet Admin, I want to connect and configure a Runsheet tenant on Dinee, so that voice agents route orders to the correct Runsheet backend.

#### Acceptance Criteria

1. THE Runsheet_Integration SHALL store a Runsheet base URL, a tenant identifier, an encrypted API key, a webhook secret, a default review mode, and a set of allowed conversation types.
2. WHEN a Runsheet_Admin saves an API key, THE Dinee_Platform SHALL store the API key in encrypted form.
3. WHEN the Dinee_Platform records an audit entry that references a stored API key, THE Dinee_Platform SHALL reference the API key by name rather than by value.
4. THE Runsheet_Integration SHALL accept a default review mode value of exactly one of `always_review` or `auto_submit_low_risk`.
5. WHEN a Runsheet_Admin requests a credential test, THE Dinee_Platform SHALL attempt an authenticated request to the configured Runsheet base URL and SHALL report within 5 seconds whether the credential is valid.
6. IF a Runsheet_Admin submits a review mode value other than `always_review` or `auto_submit_low_risk`, THEN THE Dinee_Platform SHALL reject the configuration, report the invalid value, and leave the stored Runsheet_Integration unchanged.
7. IF a Runsheet_Admin submits a configuration missing the Runsheet base URL, the tenant identifier, or the API key, THEN THE Dinee_Platform SHALL reject the configuration, return an error indicating the missing field, and leave the stored Runsheet_Integration unchanged.

### Requirement 9: Runsheet Integration Management Interface

**User Story:** As a Runsheet Admin, I want an interface to manage the Runsheet connection, so that I can assign numbers, choose agent types, and configure escalation.

#### Acceptance Criteria

1. THE Dinee_Platform SHALL provide an interface for a Runsheet_Admin to assign a Dinee-managed phone number to a Runsheet conversation type.
2. WHILE the platform is in MVP scope, THE Dinee_Platform SHALL store the Auto_Submit configuration for the tenant internally and SHALL present no Auto_Submit enable-or-disable toggle in the Runsheet_Admin interface.
3. WHERE the Auto_Submit feature defined in Requirement 13 is delivered, THE Dinee_Platform SHALL surface an Auto_Submit enable-or-disable toggle in the Runsheet_Admin interface.
4. THE Dinee_Platform SHALL provide an interface for a Runsheet_Admin to configure an Escalation_Target as exactly one of a phone number, an email address, or a webhook URL.
5. WHEN a Runsheet_Admin selects a default agent type, THE Dinee_Platform SHALL restrict callable conversation types to the tenant's allowed conversation types.
6. IF a Runsheet_Admin assigns a Dinee-managed phone number to a conversation type that is not in the tenant's allowed conversation types, THEN THE Dinee_Platform SHALL reject the assignment, return an error indicating the disallowed conversation type, and leave the existing number assignments unchanged.
7. IF a Runsheet_Admin configures an Escalation_Target that is not a valid phone number, email address, or webhook URL, THEN THE Dinee_Platform SHALL reject the Escalation_Target, return an error indicating the invalid value, and leave the existing Escalation_Target unchanged.

### Requirement 10: Runsheet Backend Voice Intake Path

**User Story:** As a Runsheet dispatcher, I want voice-originated orders to arrive through a dedicated intake path owned by the Runsheet backend, so that they are distinguishable from other order sources and remain in Runsheet's system of record.

#### Acceptance Criteria

1. WHEN the Dinee_Platform submits a voice-originated order, THE Voice_Intake_Adapter SHALL accept the order at a dedicated voice intake endpoint with a channel type of `voice`.
2. WHEN the Voice_Intake_Adapter accepts a voice-originated order, THE Voice_Intake_Adapter SHALL record the intake metadata including the call identifier, the transcript identifier, the full transcript content, the recording reference, the Confidence_Score, the Dinee agent identifier, the Dinee session identifier, the caller phone number, the review-required flag, and the extracted slots.
3. WHEN the Voice_Intake_Adapter accepts a voice-originated order, THE Voice_Intake_Adapter SHALL record a source schema version on the voice-originated order.
4. WHEN the Voice_Intake_Adapter accepts a voice-originated order, THE Voice_Intake_Adapter SHALL write a structured audit log entry for the intake.
5. IF a voice-originated order is submitted without the call identifier, the caller phone number, or the extracted slots, THEN THE Voice_Intake_Adapter SHALL reject the order, return an error indicating the missing field, and SHALL NOT create a Runsheet order.
6. THE Dinee_Platform SHALL submit each voice-originated order to the Voice_Intake_Adapter over the signed Intake_Contract.
7. IF the Dinee_Platform produces or handles an Order_Draft, THEN THE Dinee_Platform SHALL retain the Order_Draft, the voice intake request record, the Dispatcher_Review_Queue, and final order state only transiently for submission and retry, and SHALL NOT persist them as a system of record.
8. THE Runsheet_Backend SHALL own and store the voice intake request record, the Order_Draft, the Dispatcher_Review_Queue, and the final order state.
9. WHEN the Dinee_Platform submits a voice-originated order, THE Dinee_Platform SHALL include in the signed intake payload the full transcript content in addition to the transcript identifier, so that the Runsheet_Backend receives the transcript content without a callback to the Dinee_Platform.

### Requirement 11: Voice Intake Security

**User Story:** As a Runsheet security owner, I want the voice intake path authenticated and protected against replay and duplication with a language-independent signing scheme, so that only Dinee can submit orders, each order is created once, and TypeScript signing matches Python verification deterministically.

#### Acceptance Criteria

1. WHEN the Dinee_Platform submits a voice-originated order, THE Dinee_Platform SHALL compute the HMAC_Signature over the Canonical_Payload, where the Canonical_Payload is the exact raw HTTP request body transmitted to the Voice_Intake_Adapter, or, where a structured canonicalization is used instead, an RFC 8785 JSON Canonicalization Scheme (JCS) serialization of the payload.
2. IF the HMAC_Signature on an intake request does not match the signature the Voice_Intake_Adapter computes over the same Canonical_Payload, THEN THE Voice_Intake_Adapter SHALL reject the request, record the rejection, and SHALL NOT create a Runsheet order.
3. IF an intake request presents an Idempotency_Key that matches a previously accepted request, THEN THE Voice_Intake_Adapter SHALL return the original result and SHALL NOT create a duplicate order.
4. IF an intake request presents a tenant identifier that does not match the authenticated integration, THEN THE Voice_Intake_Adapter SHALL reject the request, record the tenant mismatch, and SHALL NOT create a Runsheet order.
5. IF an intake request timestamp is outside the accepted freshness window, THEN THE Voice_Intake_Adapter SHALL reject the request as a replay, record the rejection, and SHALL NOT create a Runsheet order.
6. WHEN the Dinee_Platform serializes a voice intake payload into the Canonical_Payload and the Voice_Intake_Adapter deserializes that payload, THE Voice_Intake_Adapter SHALL reconstruct extracted slots and intake metadata equivalent to the values submitted by the Dinee_Platform, and the Canonical_Payload reproduced from the reconstructed values SHALL be byte-identical to the transmitted Canonical_Payload.
7. THE Dinee_Platform and the Voice_Intake_Adapter SHALL use the same documented Canonical_Payload method — the exact raw transmitted HTTP body or the RFC 8785 JSON Canonicalization Scheme — so that signing in TypeScript and verification in Python produce identical signature inputs for identical payloads.

### Requirement 12: Dispatcher Review Workflow

**User Story:** As a Runsheet dispatcher, I want a review queue for voice orders (owned and stored by the Runsheet backend), so that I can verify and act on each draft before it becomes a dispatched order.

#### Acceptance Criteria

1. WHEN a voice-originated Order_Draft is accepted under review mode, THE Dispatcher_Review_Queue SHALL list the Order_Draft with the extracted order form, the transcript, the Confidence_Score, the missing or uncertain fields, and a recommended action.
2. THE Dispatcher_Review_Queue SHALL present, for each Order_Draft, controls to accept, edit, and reject the Order_Draft.
3. THE Dispatcher_Review_Queue SHALL present, for each Order_Draft, a link to the call recording.
4. WHEN a dispatcher accepts an Order_Draft, THE Voice_Intake_Adapter SHALL submit the Order_Draft as a Runsheet order.
5. WHEN a dispatcher accepts an Order_Draft, THE Voice_Intake_Adapter SHALL record the accepting dispatcher.
6. WHEN a dispatcher rejects an Order_Draft, THE Voice_Intake_Adapter SHALL mark the Order_Draft as rejected and SHALL NOT create a Runsheet order for that Order_Draft.
7. WHILE the tenant default review mode is `always_review`, THE Voice_Intake_Adapter SHALL route every voice-originated Order_Draft to the Dispatcher_Review_Queue.
8. THE Runsheet_Backend SHALL own and store the Dispatcher_Review_Queue, and THE Dinee_Platform SHALL NOT store the Dispatcher_Review_Queue.

### Requirement 13: Auto-Submit Eligibility (Later Phase)

**User Story:** As a Runsheet Admin, I want auto-submit restricted to low-risk orders, so that only trustworthy voice orders bypass review. This requirement is a later phase and is not part of the review-only MVP.

#### Acceptance Criteria

1. WHILE the tenant default review mode is `auto_submit_low_risk`, THE Voice_Intake_Adapter SHALL submit an Order_Draft without dispatcher review only when all of the following conditions hold: the customer is known, the delivery site is known, the tank is known, the product is known, the Confidence_Score is at or above the configured threshold, no compliance warning is present, no credit hold is present, and no unusual delivery instruction is present.
2. IF any condition in the Auto_Submit eligibility set is not met, THEN THE Voice_Intake_Adapter SHALL route the Order_Draft to the Dispatcher_Review_Queue.
3. WHEN an Order_Draft is auto-submitted, THE Voice_Intake_Adapter SHALL record that the Order_Draft was auto-submitted.
4. WHEN an Order_Draft is auto-submitted, THE Voice_Intake_Adapter SHALL record the Confidence_Score at submission.
5. WHERE the Auto_Submit feature is delivered, THE Runsheet_Pack SHALL expose the later-phase `runsheet_submit_order` tool, which is excluded from the review-only MVP fuel-intake tool set per Requirement 6.

### Requirement 14: Customer Status Agent

**User Story:** As a fuel customer, I want to check my order status by phone, so that I can get delivery information without a dispatcher.

#### Acceptance Criteria

1. THE Runsheet_Pack SHALL define the read-only tools `runsheet_lookup_order_by_phone`, `runsheet_get_order_status`, `runsheet_get_eta`, and `runsheet_get_recent_deliveries` for the `runsheet_order_status` conversation type.
2. WHEN the Status_Agent invokes `runsheet_lookup_order_by_phone` with a caller phone number, THE Runsheet_Integration SHALL respond within 5 seconds with an ordered list of matching orders when one or more orders match, and an empty result when no order matches.
3. IF the Realtime_Agent requests a mutation tool during a `runsheet_order_status` conversation, THEN THE Voice_Runtime SHALL reject the tool call, not execute the tool, preserve the call state, and record an audit entry containing the rejected tool name and the call identifier.

### Requirement 15: Driver Voice Agent

**User Story:** As a driver, I want to report delays and exceptions by phone, so that dispatch is updated on active assignments.

#### Acceptance Criteria

1. THE Runsheet_Pack SHALL define the tools `runsheet_verify_driver`, `runsheet_get_active_assignment`, `runsheet_report_delay`, `runsheet_report_terminal_wait`, `runsheet_report_exception`, and `runsheet_append_driver_note` for the `runsheet_driver_exception` conversation type.
2. WHILE the Driver_Agent is in the driver-verification phase, THE Voice_Runtime SHALL permit only the driver-verification tool and the active-assignment lookup tool.
3. IF the caller phone number does not match a known driver during the driver-verification phase, THEN THE Driver_Agent SHALL request a driver identifier before permitting an active-assignment lookup.
4. WHERE a driver action is configured as sensitive, THE Driver_Agent SHALL request a driver PIN before invoking the corresponding tool.
5. WHEN the Driver_Agent invokes a reporting tool, THE Voice_Runtime SHALL permit the tool call only after the driver identity is confirmed and an active assignment is present.
6. IF the Realtime_Agent requests a reporting tool before the driver identity is confirmed or before an active assignment is present, THEN THE Voice_Runtime SHALL reject the tool call, not execute the tool, preserve the call state, and record an audit entry containing the rejected tool name and the call identifier.

### Requirement 16: Per-Agent Monitoring and Metrics

**User Story:** As a Dinee platform operator and a Runsheet Admin, I want per-agent metrics, so that I can measure voice agent performance and value.

#### Acceptance Criteria

1. WHEN a call completes, THE Monitoring_Service SHALL record, for the active agent, the calls received count, the completed count, the call duration, the tool success count, the tool failure count, the fallback occurrence, the review-required outcome, and the Auto_Submit outcome.
2. THE Monitoring_Service SHALL compute, per agent over a reporting window, the tool failure rate, the fallback rate, the review-required rate, and the Auto_Submit rate.
3. WHERE the requesting user is a Runsheet_Admin, THE Monitoring_Service SHALL expose metrics scoped to that user's tenant.
4. WHERE the requesting user is a Dinee_Platform operator, THE Monitoring_Service SHALL expose metrics across all tenants.

### Requirement 17: Alerting

**User Story:** As a Dinee platform operator, I want alerts on failures and anomalies, so that I can respond before agents degrade the customer experience.

#### Acceptance Criteria

1. IF a dependency on OpenAI, Twilio, or the Runsheet_Backend fails, THEN THE Monitoring_Service SHALL raise an alert identifying the failed dependency.
2. IF the low-confidence rate exceeds the configured threshold over the reporting window, THEN THE Monitoring_Service SHALL raise an alert identifying the low-confidence rate.
3. IF the review-required rate exceeds the configured threshold over the reporting window, THEN THE Monitoring_Service SHALL raise an alert identifying the review-required rate.
4. IF tool rejections for a tenant exceed the configured threshold over the reporting window, THEN THE Monitoring_Service SHALL raise an alert identifying the tenant and the tool-rejection rate.
5. IF authentication failures for a tenant exceed the configured threshold over the reporting window, THEN THE Monitoring_Service SHALL raise an alert identifying the tenant and the authentication-failure rate.

### Requirement 18: Transcript Capture

**User Story:** As a Runsheet dispatcher, I want the full call transcript attached to each voice order, so that I can verify what the caller said.

#### Acceptance Criteria

1. WHILE a Runsheet call is in progress, THE Voice_Runtime SHALL, as a runtime side-effect and without a model tool call, append each confirmed dialogue turn to the Dinee-owned transcript identified by the call identifier.
2. WHEN a voice-originated Order_Draft is submitted, THE Dinee_Platform SHALL include the full transcript content in the signed intake payload and SHALL include the transcript identifier as a reference, so that the Voice_Intake_Adapter associates both the full transcript content and the transcript identifier with the Order_Draft.
3. IF appending a confirmed dialogue turn to the Dinee-owned transcript fails, THEN THE Voice_Runtime SHALL record the failure and retain the unappended dialogue turn for retry.

### Requirement 19: Optional parahackAI Telephony Integration (Future Phase)

**User Story:** As a Dinee platform operator, I want the parahackAI telephony integration defined as a future phase, so that carrier-grade telephony can be added after the Dinee and Runsheet integration is proven.

#### Acceptance Criteria

1. THE Dinee_Platform SHALL treat the parahackAI telephony integration as a future phase that is not part of the MVP scope.
2. WHERE the parahackAI telephony integration is enabled, THE Dinee_Platform SHALL route calls through the parahackAI-managed carrier path instead of the default Twilio path.
3. WHERE the parahackAI telephony integration is enabled, THE Dinee_Platform SHALL enforce the configured consent rules before connecting a Realtime_Agent.
4. WHERE the parahackAI telephony integration is enabled, THE Dinee_Platform SHALL enforce the configured do-not-call rules before connecting a Realtime_Agent.
5. WHERE the parahackAI telephony integration is enabled, THE Dinee_Platform SHALL enforce the configured recording-retention rules before connecting a Realtime_Agent.
6. IF a configured consent, do-not-call, or recording-retention rule is not satisfied while the parahackAI telephony integration is enabled, THEN THE Dinee_Platform SHALL not connect a Realtime_Agent and SHALL record the unsatisfied rule.

### Requirement 20: Ownership Boundary and Runsheet Backend Contract Track

**User Story:** As a platform architect, I want a clear ownership boundary between Dinee and the Runsheet backend, so that operational truth stays in Runsheet, Dinee stays a voice runtime, and the two systems integrate through a defined contract that can be developed and tested in parallel.

#### Acceptance Criteria

1. THE Dinee_Platform SHALL store only the phone-number-to-conversation-type mappings, the agent and VoiceDomainPack configuration, the integration configuration, the call records, the transcripts, and the audit logs.
2. THE Runsheet_Backend SHALL own and store the voice intake request record, the Order_Draft, the Dispatcher_Review_Queue, and the final order state.
3. IF the Dinee_Platform produces or handles an Order_Draft, THEN THE Dinee_Platform SHALL retain the Order_Draft only transiently for submission and retry and SHALL NOT persist it as a system of record.
4. THE Dinee_Platform SHALL submit voice-originated orders to the Runsheet_Backend exclusively through the versioned Intake_Contract.
5. THE Runsheet_Backend voice-intake endpoints, idempotency handling, and Dispatcher_Review_Queue behavior SHALL be implemented as a parallel Runsheet-repository track, and THE Dinee_Platform SHALL code against that track through the defined Intake_Contract.
6. THE Dinee_Platform SHALL provide a Mock_Intake_Client that implements the Intake_Contract so that Dinee submission behavior can be verified without the live Runsheet_Backend.
