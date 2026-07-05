import Fastify from "fastify";
import WebSocket from "ws";
import type { FunctionReturnType } from "convex/server";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import cors from "@fastify/cors"
import crypto from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import {
  CANCELLATION_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  LOG_EVENT_TYPES,
  SHOW_TIMING_MATH,
  VOICE,
} from "./server-constants.ts";
import {
  wrapperGetRestaurantDetails,
  wrapperUpsertCallData,
  wrapperAddTranscriptDialogues,
  wrapperUpsertOrders,
  wrapperCheckBlocked,
  generateBlockedCallTwiML,
} from "../../lib/modules/packs/restaurant/wrappers.ts";
import {
  generateOrderId,
  generatePublicOrderCode,
} from "../../lib/modules/packs/restaurant/handlers.ts";
import { nextPhase as nextRestaurantPhase } from "./runtime/phaseEngine.ts";
import {
  restaurantInboundPhases,
  AWAIT_RESTAURANT_ID_PHASE,
  RESTAURANT_VERIFIED_PHASE,
  ORDER_OPEN_PHASE,
} from "../../lib/modules/packs/restaurant/phases.ts";
import { restaurantTools } from "../../lib/modules/packs/restaurant/tools.ts";
import { isToolCallPermitted } from "../../lib/modules/voiceDomainPackRegistry.ts";
import twilio from "twilio";
import { createLogger } from "../../lib/logger.ts";
import { generateCorrelationId } from "../../lib/logistics/correlation.ts";
import { resolvePhoneToRoute, type ConversationType } from "../../lib/call-routing/phone-lookup.ts";
// Pack-driven voice runtime: registry-resolved packs + generic session driver.
// All domain-specific voice logic (prompts, tools, phases, handlers, wrappers)
// now lives under src/lib/modules/packs; this module keeps only transport code
// (Twilio webhooks, media-stream sockets, OpenAI socket lifecycle). The legacy
// ws-server modules (tools.ts, logistics-tools.ts, call-phase.ts,
// logistics-call-phase.ts) and the inline isLogistics branch were removed in the
// legacy-removal step (task 4.8) once the compatibility tests passed.
import { registerRestaurantVoicePack } from "../../lib/modules/packs/restaurant/index.ts";
import { registerLogisticsVoicePack } from "../../lib/modules/packs/logistics/index.ts";
import { registerRunsheetVoicePack } from "../../lib/modules/packs/runsheet/index.ts";
import {
  registerRunsheetPlatform,
  RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE,
} from "../../lib/integrations/runsheet/platform.ts";
import { resolvePlatform } from "../../lib/integrations/platform/registry.ts";
import { resolveAdapter } from "../../lib/integrations/platform/adapterResolver.ts";
import { selectSubSessionBindings } from "../../lib/integrations/platform/subSessions.ts";
import type {
  AdapterConstructionContext,
  SubSessionBinding,
} from "../../lib/integrations/platform/types.ts";
import {
  prepareSession,
  SessionDriver,
  type ResolvedCallContext,
  type AuditRecord,
} from "./runtime/session.ts";
import { buildSessionConfig } from "./runtime/sessionConfig.ts";
import type { ToolOutcome } from "./runtime/toolExecutor.ts";
import { TranscriptBuffer, type TranscriptPersister } from "./runtime/transcriptBuffer.ts";
import {
  bindRunsheetCallSession,
  releaseRunsheetCallSession,
} from "../../lib/modules/packs/runsheet/handlers.ts";
import {
  bindDriverCallSession,
  releaseDriverCallSession,
  newDriverVerificationState,
  RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS,
} from "../../lib/modules/packs/runsheet/driverHandlers.ts";
import { decrypt } from "../../lib/integrations/encryptionService.ts";
import { RunsheetApiClient } from "../../lib/integrations/runsheet/apiClient.ts";
import { VoiceIntakeClient } from "../../lib/integrations/runsheet/voiceIntakeClient.ts";
import type { OrderDraft } from "../../lib/modules/packs/runsheet/slots.ts";

const logger = createLogger("ws-server");

/**
 * The result shape returned by the generic, service-token-guarded
 * Runtime_Credential_Service action. A `resolved` result carries the ENCRYPTED
 * credentials (ciphertext keyed by credential name) + stored config that the
 * ws-server decrypts locally at bind time; `unresolved` / `unauthorized` carry
 * no credentials (Req 3.x).
 */
type RuntimeCredentialResult = FunctionReturnType<
  typeof api.integrations.runtimeCredentials.getCredentialsForRuntime
>;

/** Deadline for runtime credential retrieval at bind time (Req 7.1). */
const RUNTIME_CREDENTIAL_DEADLINE_MS = 5000;

/**
 * Races a promise against a deadline, rejecting if it does not settle in time.
 * Bounds runtime credential retrieval so a slow/hung Runtime_Credential_Service
 * call degrades to "no integration" rather than stalling call setup
 * (Req 7.1, 7.2).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Maps a Platform_Definition `SubSessionBinding.binderKey` to its concrete
 * per-call bind/release pair. Data-driven sub-session binding (Req 7.8, 11.4)
 * resolves the binder by key rather than a hardcoded conversation-type check.
 * Runsheet's driver-exception sub-session is the first (and currently only)
 * entry; it preserves the exact prior wiring — identity verification and
 * sensitive-action gating — for `runsheet_driver_exception` calls.
 */
const SUB_SESSION_BINDERS: Record<
  string,
  {
    bind: (args: {
      callSid: string;
      apiClient: RunsheetApiClient;
      callerPhone: string;
    }) => void;
    release: (callSid: string) => void;
  }
> = {
  [RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE]: {
    bind: ({ callSid, apiClient, callerPhone }) =>
      bindDriverCallSession(callSid, {
        apiClient,
        config: {
          callerPhone,
          sensitiveActions: RUNSHEET_DEFAULT_SENSITIVE_DRIVER_ACTIONS,
        },
        state: newDriverVerificationState(),
      }),
    release: releaseDriverCallSession,
  },
};

dotenv.config({ path: ".env.local" });
const PORT = (process.env.NEXT_BACKEND_PORT || 8000) as number | undefined;
const { NEXT_OPENAI_KEY } = process.env;
if (!NEXT_OPENAI_KEY) {
  logger.error("Missing OpenAI API key.");
  process.exit(1);
}

// The Runsheet voice pack decrypts per-tenant credentials (Runsheet API key +
// webhook secret) in-process using INTEGRATION_ENCRYPTION_KEY (AES-256-GCM).
// It is NOT required for restaurant/logistics calls, so a missing key is a
// non-fatal startup warning rather than a hard exit: Runsheet calls then start
// without Runsheet tools (the media-stream bind is guarded) instead of crashing.
if (!process.env.INTEGRATION_ENCRYPTION_KEY) {
  logger.warn(
    "INTEGRATION_ENCRYPTION_KEY is not set; Runsheet voice calls will start without Runsheet tools until it is configured.",
  );
}

// Convex client for persistent callback session storage
const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Register the restaurant and logistics VoiceDomainPacks (and wire their tool
// handlers into the runtime tool executor) at startup, so the pack-driven
// session driver can resolve packs by conversation type (Req 3.1, 4.2). The
// logistics pack bridges the existing logistics Module_Pack_System registration.
registerRestaurantVoicePack();
const logisticsPackRegistration = registerLogisticsVoicePack();
if (!logisticsPackRegistration.ok) {
  logger.error("Failed to register logistics voice pack", {
    code: logisticsPackRegistration.error.code,
    detail: logisticsPackRegistration.error.detail,
  });
}

// Register the Runsheet VoiceDomainPack. It bridges the logistics
// Module_Pack_System registration (extend mode) and requires the runsheet
// integration for its fuel-intake tools. A validation failure is surfaced here
// per Req 4.3 rather than failing silently.
const runsheetPackRegistration = registerRunsheetVoicePack();
if (!runsheetPackRegistration.ok) {
  logger.error("Failed to register runsheet voice pack", {
    code: runsheetPackRegistration.error.code,
    detail: runsheetPackRegistration.error.detail,
  });
}

// Register Runsheet as the first Platform_Definition with the generic
// Integration_Registry at startup (Req 10.1, 12.5), so the generic call path
// can resolve it by platformId and bind its adapter. Idempotent and non-fatal.
registerRunsheetPlatform();

// Type definitions for connection-scoped state
interface CallbackContext {
  reason?: string;
  phoneNumber?: string;
  isCallback?: boolean;
  data?: string;
}

const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.register(cors, {
  origin: process.env.NODE_ENV === "production" 
    ? [process.env.FRONTEND_URL || ""].filter(Boolean)
    : ["*"],
  methods: ["GET", "POST"],
});

/* Health check route */
fastify.all("/health", async (_req, reply) => {
  reply.send({ status: "ok" });
});

/* Twilio entry-point */
fastify.all("/incoming-call", async (request: any, reply) => {
  const callSid = request.body.CallSid || request.query?.CallSid;
  const fromNumber = request.body.From || request.query?.From;
  
  // Check if the phone number is blocked or requires verification
  // Requirements: 25.4 - Reject or require verification for blocklisted numbers
  if (fromNumber) {
    try {
      const blockingResult = await wrapperCheckBlocked(fromNumber);
      
      if (blockingResult.success && blockingResult.data) {
        const { action, reason } = blockingResult.data;
        
        if (action === 'block') {
          // Immediately reject calls from blocked numbers
          logger.info(`Blocking call from ${fromNumber}: ${reason}`, { callId: callSid });
          const twiml = generateBlockedCallTwiML();
          return reply.type("text/xml").send(twiml);
        }
        
        if (action === 'require_verification') {
          // Log the verification requirement - the call will proceed but with a flag
          // In a production system, this could transfer to a human agent
          logger.warn(`Call from ${fromNumber} requires verification: ${reason}`, { callId: callSid });
          // For now, we allow the call to proceed but log the warning
          // A more sophisticated implementation could:
          // 1. Transfer to a human agent
          // 2. Add extra verification steps in the AI conversation
          // 3. Flag the order for manual review
        }
      }
    } catch (error) {
      // If blocking check fails, allow the call to proceed (fail-open)
      logger.error("Error checking blocked status", { callId: callSid });
    }
  }
  
  // Resolve vertical from called number via phone-number-to-organization lookup (Req 11.3)
  const toNumber = request.body?.To || request.query?.To || "";
  const route = await resolvePhoneToRoute(convexClient, toNumber);

  // Pass call context via query params to the WebSocket connection
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
    <Pause length="1"/>
    <Connect>
    <Stream url="wss://${request.headers.host}/media-stream?callSid=${encodeURIComponent(callSid || '')}&amp;from=${encodeURIComponent(fromNumber || '')}&amp;to=${encodeURIComponent(toNumber)}&amp;conversationType=${encodeURIComponent(route.conversationType)}&amp;tenantId=${encodeURIComponent(route.tenantId ?? "")}&amp;platformId=${encodeURIComponent(route.platformId ?? "")}" />
    </Connect>
    </Response>
  `;
  reply.type("text/xml").send(twiml);
});



/* Twilio entry-point for callback calls */
fastify.all("/callback", async (request: any, reply) => {
  try {
    const reason = request.body?.reason || request.query?.reason || "General inquiry";
    const phoneNumber = request.body?.phoneNumber || request.query?.phoneNumber;
    const data = request.body?.data || request.query?.data;

    if (!phoneNumber) {
      return reply.status(400).send({ error: "Phone number is required" });
    }

    // Generate a unique session ID for this callback
    const callbackSessionId = crypto.randomUUID();

    // Store callback context in Convex (persistent, survives restarts)
    await convexClient.mutation(api.callbackSessions.createSession, {
      sessionId: callbackSessionId,
      phoneNumber,
      reason: Array.isArray(reason) ? reason[0] : reason,
      data: typeof data === "string" ? data : JSON.stringify(data),
    });

    const client = twilio(process.env.NEXT_TWILIO_SID, process.env.NEXT_TWILIO_AUTH_TOKEN);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="1"/>
      <Connect>
      <Stream url="wss://${request.headers.host}/media-stream-callback?sessionId=${encodeURIComponent(callbackSessionId)}" />
      </Connect>
    </Response>`;
    
    await client.calls.create({
      from: process.env.NEXT_VIRTUAL_NUMBER!,
      to: phoneNumber,
      twiml,
    });
    
    return reply.send({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return reply.status(500).send({ error: errorMessage });
  }
});

/* websocket */
fastify.register(async (fastify) => {
  // route for connecting OpenAI live api with the incoming call
  fastify.get("/media-stream", { websocket: true }, async (connection, req) => {
    // Extract connection-scoped state from query params
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const callSid = url.searchParams.get("callSid") || "";
    const fromNumber = url.searchParams.get("from") || "";
    const conversationType = (url.searchParams.get("conversationType") || "restaurant_inbound_order") as ConversationType;
    const toNumber = url.searchParams.get("to") || "";
    // The Dinee tenant that owns a Runsheet number (threaded from /incoming-call
    // via the number assignment). Named `dineeTenantId` to avoid clashing with
    // the Runsheet-side tenant id carried in the integration config.
    const dineeTenantId = url.searchParams.get("tenantId") || "";
    // The external platform this call routes to. Prefer the platformId resolved
    // from the generic phoneRoutes store (threaded via query params by
    // /incoming-call). For backward compatibility with Runsheet numbers not yet
    // migrated to the generic phoneRoutes store, fall back to deriving
    // "runsheet" from the conversation-type prefix (Req 11.1). An empty
    // platformId denotes a non-integration call (restaurant/logistics) for which
    // no adapter is ever bound.
    const resolvedPlatformId = url.searchParams.get("platformId") || "";
    const platformId =
      resolvedPlatformId ||
      (conversationType.startsWith("runsheet_") ? "runsheet" : "");
    // Retained for the transcript-persistence side-effect gating below; a
    // Runsheet call is now simply one whose resolved platform is "runsheet".
    const isRunsheetCall = platformId === "runsheet";

    // Connection-specific state (transport only)
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;

    // Transcription state (transport-level gating for transcript persistence)
    let restaurantIdConfirmed = false;
    let currentRestaurantId: string | null = null;

    // --- Pack-driven session resolution (Req 3.1, 3.2) ---
    // Resolve the VoiceDomainPack that owns this conversation type and build the
    // session init BEFORE opening the OpenAI socket. All domain behavior
    // (prompt, tools, phases, tool dispatch, phase transitions) is delegated to
    // runtime/session.ts; this module keeps only the transport plumbing.
    // Resolve the tenant's Runsheet integration BEFORE building the session so
    // the enabled-integrations set can gate the resolved tool set (Req 4.3,
    // 8.1). Only runsheet calls with an owning Dinee tenant fetch the config;
    // restaurant/logistics calls are untouched (enabledIntegrations stays []).
    // --- Generic, config-driven per-call integration binding ---
    // Resolve the platform, retrieve its credentials via the service-token-
    // guarded Runtime_Credential_Service, decrypt at bind time, build the
    // adapter via the registry factory, and gate the platform tool set — all
    // driven by the resolved platformId and its Platform_Definition rather than
    // a hardcoded platform branch. On ANY failure the call proceeds with no
    // adapter bound and no platform-gated tools enabled (fail-closed:
    // Req 7.2, 7.3, 7.6, 8.5).
    let enabledIntegrations: string[] = [];

    // Per-call Runsheet binding materials, populated ONLY for a connected
    // Runsheet integration whose credentials decrypt and whose adapter builds.
    // Prepared here (before tool gating) so tools are advertised only when a
    // usable binding is guaranteed (Finding 1). Also carries the platform's
    // declared sub-session bindings so the post-driver bind is data-driven.
    let runsheetBindingKit: {
      apiClient: RunsheetApiClient;
      intakeClient: VoiceIntakeClient;
      webhookSecret: string;
      config: Record<string, unknown>;
      subSessions: SubSessionBinding[];
    } | null = null;

    // Sub-session release callbacks invoked on socket close, collected from the
    // Platform_Definition's data-driven sub-session bindings (Req 7.7, 7.8).
    const subSessionReleases: Array<() => void> = [];

    const platformResolution = platformId
      ? resolvePlatform(platformId)
      : ({ resolved: false } as const);

    if (platformId && dineeTenantId && platformResolution.resolved) {
      const definition = platformResolution.definition;

      // Present THIS platform's runtime service token (from its declared env
      // var) to the guarded action, which resolves the same env var server-side
      // and compares in constant time (Req 3.x, 12.5). A different platform
      // reads a different env var, so a cross-platform token cannot retrieve
      // these credentials.
      const serviceToken =
        process.env[definition.runtimeServiceTokenEnvVar] ?? "";

      // Retrieve within a 5s deadline (Req 7.1). A timeout, thrown error, or a
      // non-`resolved` result (unauthorized / unresolved) degrades to "no
      // integration" — no adapter, no platform tools (Req 7.2).
      let credentialResult: RuntimeCredentialResult | null = null;
      try {
        credentialResult = await withTimeout(
          convexClient.action(
            api.integrations.runtimeCredentials.getCredentialsForRuntime,
            { platformId, tenantId: dineeTenantId, serviceToken },
          ),
          RUNTIME_CREDENTIAL_DEADLINE_MS,
        );
      } catch (err) {
        logger.error(
          "Runtime credential retrieval failed or timed out; no platform tools for this call",
          { callId: callSid, platformId, tenantId: dineeTenantId },
        );
      }

      if (credentialResult && credentialResult.resolution === "resolved") {
        const runtimeConfig = credentialResult.config;

        // Only a CONNECTED integration is trusted; any other status skips
        // decryption and binds no adapter (Req 7.3, Finding 2).
        if (runtimeConfig.status === "connected") {
          try {
            // Decrypt each declared credential field LOCALLY at bind time with
            // the platform's contract key salt (Req 7.4, 12.2). Never cached; a
            // missing/invalid key or malformed ciphertext throws here.
            const credentials: Record<string, string> = {};
            for (const field of definition.credentialFields) {
              const ciphertext =
                runtimeConfig.credentialsEncrypted[field.name];
              if (typeof ciphertext !== "string") {
                throw new Error(
                  `Missing ciphertext for credential '${field.name}'`,
                );
              }
              credentials[field.name] = decrypt(
                ciphertext,
                definition.contract.keySalt,
              );
            }

            // Build the adapter via the registry factory (Req 7.5). A factory
            // throw yields an unresolved result → no bind, no platform tools.
            const adapterCtx: AdapterConstructionContext = {
              baseUrl: runtimeConfig.baseUrl,
              platformTenantId: runtimeConfig.platformTenantId,
              credentials,
              config: (runtimeConfig.config ?? {}) as Record<string, unknown>,
              contract: definition.contract,
            };
            const adapterResolution = resolveAdapter(platformId, adapterCtx);

            if (adapterResolution.resolved) {
              // Adapter resolved: enable the platform-gated tool set (Req 6.4).
              enabledIntegrations = [platformId];

              // Runsheet-specific per-call session wiring. Runsheet is the first
              // adapter; its session binding builds the same clients + intake
              // meta as before, now from generically-decrypted credentials and
              // the generic config blob. The generic adapter wraps these same
              // clients, so the wire contract is unchanged (Req 11.1-11.3).
              if (platformId === "runsheet") {
                const rsConfig = adapterCtx.config;
                const apiClient = new RunsheetApiClient({
                  baseUrl: runtimeConfig.baseUrl,
                  apiKey: credentials.api_key,
                  tenantId: runtimeConfig.platformTenantId,
                });
                const intakeClient = new VoiceIntakeClient({
                  baseUrl: runtimeConfig.baseUrl,
                });
                runsheetBindingKit = {
                  apiClient,
                  intakeClient,
                  webhookSecret: credentials.webhook_secret,
                  config: rsConfig,
                  subSessions: definition.subSessions ?? [],
                };
                // Preserve the Auto_Submit tool gating: the distinct
                // runsheet_auto_submit integration id is enabled only when the
                // tenant's config opts in, so resolveToolSet exposes the same
                // tool set as before generalization (Req 11.1).
                if (rsConfig.autoSubmitEnabled === true) {
                  enabledIntegrations.push("runsheet_auto_submit");
                }
              }
            }
          } catch (err) {
            // Decrypt or adapter-construction failure: bind nothing, enable no
            // platform tools, continue the call (Req 7.6).
            enabledIntegrations = [];
            runsheetBindingKit = null;
            logger.error(
              "Failed to decrypt credentials or build adapter; no platform tools for this call",
              { callId: callSid, platformId, tenantId: dineeTenantId },
            );
          }
        } else {
          // Status other than connected: skip decryption, bind no adapter,
          // enable no platform tools, continue the call (Req 7.3).
          logger.warn(
            "Integration is not connected; no platform tools enabled for this call",
            { callId: callSid, platformId, tenantId: dineeTenantId },
          );
        }
      } else if (platformId) {
        logger.warn(
          "No usable connected integration resolved; no platform tools enabled",
          { callId: callSid, platformId, tenantId: dineeTenantId },
        );
      }
    }

    const callContext: ResolvedCallContext = {
      callSid,
      fromNumber,
      toNumber,
      // For runsheet calls the owning Dinee tenant identifies the integration;
      // restaurant/logistics flows keep using the called number as the tenant.
      tenantId: dineeTenantId || toNumber,
      conversationType,
      enabledIntegrations,
    };

    const prepared = prepareSession(callContext);

    // No pack owns the conversation type / no route mapping: do NOT open the
    // OpenAI socket. Record the audit entry and close the media stream (Req 3.5, 4.6).
    if (prepared.kind === "terminate") {
      logger.error("Session terminated before init; no Realtime session opened", {
        callId: callSid,
      });
      if (connection.readyState === WebSocket.OPEN) {
        connection.close();
      }
      return;
    }

    const sessionInit = prepared.init;

    // Req 17.1: Transport-level transcript correlation. Bridged packs (logistics
    // bridges an existing Module_Pack_System registration) attach a
    // correlationId to persisted turns and downstream events; non-bridged packs
    // (restaurant) do not. Derived from the resolved pack rather than a
    // hardcoded conversation-type prefix, so no vertical branching lives here.
    const usesCorrelation = Boolean(sessionInit.pack.moduleBridge);
    const correlationId = usesCorrelation ? generateCorrelationId() : undefined;

    // Tracks the arguments of the in-flight tool call so phase-transition
    // resolution can read status-dependent fields (e.g. upsert_order completed).
    let currentToolArgs: Record<string, unknown> = {};

    // Maps a permitted tool's successful outcome to the pack phase-transition
    // event, preserving the legacy per-tool transition rules that used to live
    // inline in this handler.
    const resolvePhaseEvent = (
      toolName: string,
      outcome: ToolOutcome,
    ): string | undefined => {
      if (outcome.status !== "ok") return undefined;
      const result = (outcome.result ?? {}) as Record<string, unknown>;
      const succeeded = result.success === true;
      switch (toolName) {
        // Restaurant transitions (legacy call-phase.ts events)
        case "get_restaurant_details":
          return succeeded ? "restaurant_verified" : undefined;
        case "generate_order_id":
          return "order_id_generated";
        case "upsert_order":
          return succeeded && currentToolArgs.status === "completed"
            ? "order_finalized"
            : undefined;
        // Logistics transitions (legacy logistics-call-phase.ts events)
        case "get_organization_details":
          return succeeded ? "org_verified" : undefined;
        case "create_shipment":
          return succeeded ? "shipment_created" : undefined;
        default: {
          // Pack tools (e.g. the runsheet fuel-intake tools) drive their own
          // transitions by returning a `phaseEvent` on a successful result. The
          // transport stays generic: it forwards that event to the phase engine
          // rather than hardcoding per-pack transition rules here.
          const event = result.phaseEvent;
          return typeof event === "string" && event.length > 0
            ? event
            : undefined;
        }
      }
    };

    // Runtime transcript side-effect (Req 18.1): confirmed human/AI turns are
    // appended to this buffer automatically by the session driver — there is no
    // model tool involved. The runsheet dispatch-review handler reads the
    // captured transcript from this same buffer (via the bound call session) so
    // the signed Intake_Contract submission carries the full transcript content
    // (Req 10.9, 18.2).
    //
    // Persistence to the Dinee-owned `transcripts` store (Req 18.2): for
    // Runsheet calls each confirmed turn is appended to the `transcripts` table
    // via `convex/runsheet/transcripts.appendTurn`, keyed by callSid and
    // associated with the derived transcriptId carried in the intake payload.
    // The mutation throws on failure, so the buffer records the failure and
    // retains the unpersisted turn in memory for retry (Req 18.3). Restaurant/
    // logistics calls persist through their existing wrapper path
    // (`saveTranscriptIfConfirmed` below), so no persister is attached for them
    // to avoid double-writing the same table.
    const runsheetTranscriptPersister: TranscriptPersister = async (
      persistCallSid,
      turn,
    ) => {
      // Throws on failure (network or server); the TranscriptBuffer catches it,
      // records the failure, and retains the turn for retry (Req 18.3).
      await convexClient.mutation(api.runsheet.transcripts.appendTurn, {
        callId: persistCallSid,
        role: turn.role,
        text: turn.text,
        at: turn.at,
        ...(correlationId ? { correlationId } : {}),
      });
    };
    const transcriptBuffer = isRunsheetCall
      ? new TranscriptBuffer({
          persister: runsheetTranscriptPersister,
          recordError: (persistCallSid, _turn, error) => {
            logger.error("Failed to persist transcript turn; retained for retry", {
              callId: persistCallSid,
              error,
            });
          },
        })
      : new TranscriptBuffer();

    const driver = new SessionDriver(callContext, sessionInit, {
      resolvePhaseEvent,
      transcriptBuffer,
      onAudit: (record: AuditRecord) => {
        logger.warn("Session audit", { callId: record.callId });
      },
    });

    // --- Per-call Runsheet session binding (Req 6.7-6.10, 15.x, 18.1) ---
    // Bind the per-call materials the globally-registered Runsheet handlers act
    // on. This happens AFTER `driver` + `transcriptBuffer` exist because the
    // getDraft/getTranscript accessors close over them. The credentials were
    // already decrypted and the clients constructed above (into
    // `runsheetBindingKit`) BEFORE tool gating, so binding here cannot fail on
    // decrypt — and if no kit was prepared, no Runsheet tools were enabled
    // either, so there is nothing to bind (Finding 1).
    if (runsheetBindingKit) {
      const { apiClient, intakeClient, webhookSecret, config, subSessions } =
        runsheetBindingKit;

      // Deterministic transcript id: mirrors `deriveTranscriptId(callSid)` from
      // convex/runsheet/transcripts. Inlined here to avoid pulling the Convex
      // server module (which imports ./_generated/server) into the node bundle.
      const transcriptId = "transcript:" + callSid;

      bindRunsheetCallSession(callSid, {
        apiClient,
        tenantConfig: {
          requiresPurchaseOrder: config.requiresPurchaseOrder === true,
        },
        intakeClient,
        intakeSecret: webhookSecret,
        intakeMeta: {
          // Runsheet Voice_Intake_Adapter currently supports schema version
          // "1.0" (X-Schema-Version); it rejects "1.0.0" with 422
          // UNSUPPORTED_SCHEMA_VERSION.
          schemaVersion: "1.0",
          transcriptId,
          idempotencyKey: callSid,
          recordingRef: null,
          agentId: conversationType,
          sessionId: callSid,
          callerPhone: fromNumber,
          reviewRequired: config.defaultReviewMode === "always_review",
        },
        getDraft: () => driver.draft as OrderDraft | undefined,
        getTranscript: () => [...transcriptBuffer.getTranscript(callSid)],
      });

      // Data-driven sub-session binding (Req 7.8, 11.4): bind each sub-session
      // the Platform_Definition declares for the resolved conversation type,
      // rather than a hardcoded `conversationType === "runsheet_driver_exception"`
      // check. For Runsheet this preserves the driver-exception sub-session bind
      // (identity verification + sensitive-action gating) exactly as before, and
      // records its release for socket-close cleanup (Req 7.7).
      for (const sub of selectSubSessionBindings(subSessions, conversationType)) {
        const binder = SUB_SESSION_BINDERS[sub.binderKey];
        if (!binder) {
          continue;
        }
        binder.bind({ callSid, apiClient, callerPhone: fromNumber });
        subSessionReleases.push(() => binder.release(callSid));
      }
    }

    // OpenAI socket
    const oaWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${NEXT_OPENAI_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );

    // Build the OpenAI session.update payload from the resolved pack (Req 3.3),
    // applied before the agent's first spoken response (Req 3.4).
    const initializeSession = () => {
      oaWs.send(
        JSON.stringify(
          buildSessionConfig(
            sessionInit.pack,
            conversationType,
            callContext.enabledIntegrations,
            { voice: VOICE },
          ),
        ),
      );
    };

    const greet = () => {
      oaWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Greet the caller and follow the system prompt.",
              },
            ],
          },
        }),
      );
      oaWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Helper function to handle interruptions
    const handleSpeechStartedEvent = () => {
      logger.info("Speech started - handling interruption", { callId: callSid });
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          logger.debug(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`,
            { callId: callSid }
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            logger.debug(
              `Sending truncation event: ${JSON.stringify(truncateEvent)}`,
              { callId: callSid }
            );
          oaWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reset the local states
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Helper function
    const sendMark = () =>
      streamSid &&
      connection.send(
        JSON.stringify({
          event: "mark",
          streamSid,
          mark: { name: "responsePart" },
        }),
      );

    // Helper function to save transcript if restaurant ID is confirmed
    // For logistics calls, saves with correlationId (Req 17.9)
    const saveTranscriptIfConfirmed = async (dialogue: string, speaker: 'human' | 'ai') => {
      // Runtime transcript side-effect (Req 18.1): append every confirmed turn
      // to the in-memory buffer keyed by callSid, in order, with no model tool
      // involved. This is independent of the Convex-persistence gating below;
      // the buffer is what the runsheet dispatch-review submission carries
      // (Req 10.9, 18.2). Persistence failures are retained for retry (Req 18.3).
      void driver.appendTranscript({
        role: speaker === "human" ? "caller" : "agent",
        text: dialogue,
        at: Date.now(),
      });

      if (usesCorrelation && correlationId) {
        try {
          await wrapperAddTranscriptDialogues({
            dialogue,
            speaker,
            callId: callSid,
            correlationId,
          });
        } catch (error) {
          logger.error("Error saving logistics transcript", { callId: callSid, correlationId });
        }
      } else if (restaurantIdConfirmed && currentRestaurantId) {
        try {
          await wrapperAddTranscriptDialogues({
            dialogue,
            speaker,
            callId: callSid
          });
        } catch (error) {
          logger.error("Error saving transcript", { callId: callSid });
        }
      }
    };

    // Listen for messages from Twilio WebSocket
    connection.on("message", (data: string | Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'media':
            latestMediaTimestamp = message.media.timestamp;
            if (SHOW_TIMING_MATH) logger.debug(`Received media message with timestamp: ${latestMediaTimestamp}ms`, { callId: callSid });

            if (oaWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: message.media.payload
              };
              oaWs.send(JSON.stringify(audioAppend));
            }
            break;

          case 'start':
            streamSid = message.start.streamSid;
            logger.info("Incoming stream has started", { callId: callSid });
            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'mark':
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;

          case 'stop':
            logger.info("Stream stopped", { callId: callSid });
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            logger.info(`Received non-media event: ${message.event}`, { callId: callSid });
            break;
        }
      } catch (error) {
        logger.error("Error processing Twilio message", { callId: callSid });
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) logger.debug("OpenAI event", { callId: callSid });

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        logger.debug("Human speaking (delta)", { callId: callSid });
        logger.debug(`Human speaking (delta): ${res.delta}`, { callId: callSid });
        // You can use delta for real-time display if needed
      }

      if (res.type === "conversation.item.input_audio_transcription.completed") {
        // Save the completed human transcript
        await saveTranscriptIfConfirmed(res.transcript, 'human');
      }

      // Function call from the model — delegated to the pack-driven session
      // driver, which gates membership + phase, executes via the tool executor,
      // and applies the declared phase transition (Req 3.6, 3.7, 3.8).
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments) as Record<string, unknown>;
        const toolName: string = res.name;
        currentToolArgs = args;

        const dispatch = await driver.handleFunctionCall({
          callId: res.call_id,
          name: toolName,
          args,
        });

        // Transport-level transcript gating: mark the restaurant verified once
        // get_restaurant_details succeeds so confirmed turns are persisted with
        // the resolved restaurant id (mirrors the legacy inline behavior).
        if (
          dispatch.kind === "executed" &&
          toolName === "get_restaurant_details" &&
          dispatch.outcome.status === "ok" &&
          (dispatch.outcome.result as Record<string, unknown> | undefined)?.success === true
        ) {
          restaurantIdConfirmed = true;
          currentRestaurantId =
            typeof args.restaurant_id === "string" ? args.restaurant_id : null;
        }

        oaWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: dispatch.output.callId,
              output: dispatch.output.output,
            },
          }),
        );
        oaWs.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      // Audio back to Twilio
      if (res.type === "response.audio.delta" && res.delta) {
        connection.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: res.delta },
          }),
        );

        // First delta from a new response starts the elapsed time counter
        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH) logger.debug(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`, { callId: callSid });
        }

        if (res.item_id) {
          lastAssistantItem = res.item_id;
        }

        sendMark();
        markQueue.push("responsePart");
      }

      // Handle speech interruption
      if (res.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

      // Capture AI responses from text content for transcription
      if (res.type === "response.content.done") {
        if (res.content && Array.isArray(res.content)) {
          const textContent = res.content.find((item: { type: string; text?: string }) => item.type === 'text');
          if (textContent && textContent.text) {
            // Save the AI response transcript
            await saveTranscriptIfConfirmed(textContent.text, 'ai');
          }
        }
      }

      // Fallback: capture any response that completes without text content
      if (res.type === "response.done" && res.response) {
        // Try to extract text from the response output
        if (res.response.output && res.response.output.length > 0) {
          const output = res.response.output[0];
          if (output.content && output.content.length > 0) {
            const textContent = output.content.find((item: { type: string; text?: string }) => item.type === 'text');
            if (textContent && textContent.text) {
              await saveTranscriptIfConfirmed(textContent.text, 'ai');
            }
          }
        }
      }
    });

    // OpenAI socket lifecycle
    oaWs.on("open", async () => {
      await wrapperUpsertCallData({
        callId: callSid,
        phoneNumber: fromNumber,
        status: "active",
        restaurantId: "unknown",
        // Req 11.3: Store conversationType on the calls table record
        conversationType,
        // Req 17.7: Store correlationId on the calls table record for voice sessions
        ...(correlationId && { correlationId }),
      });
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async () => {
      // Update the call status to completed
      await wrapperUpsertCallData({
        callId: callSid,
        status: "completed",
      });
    });
    oaWs.on("error", (err) => {
      logger.error("OpenAI socket error", { callId: callSid });
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      logger.info("Twilio socket closed", { callId: callSid });
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
      // Final best-effort drain of any transcript turns retained after a
      // persistence failure (Req 18.3) before dropping per-call state. Runs
      // asynchronously; if turns still fail they are dropped with the buffer,
      // having already been recorded as failed when first retained.
      void transcriptBuffer
        .retry(callSid)
        .catch(() => undefined)
        .finally(() => {
          transcriptBuffer.clear(callSid);
        });
      // Release the bound platform session + any data-driven sub-sessions so no
      // per-call state (or client built from decrypted credentials) outlives the
      // call, and every decrypted credential value is discarded with it
      // (Req 7.7). releaseRunsheetCallSession is a harmless no-op for an unbound
      // callSid; the sub-session releases are those collected at bind time from
      // the Platform_Definition's declared sub-sessions.
      releaseRunsheetCallSession(callSid);
      for (const release of subSessionReleases) {
        release();
      }
    });

    connection.on("error", err => {
      logger.error("Twilio socket error", { callId: callSid });
    });
  });


  // Callback route
  fastify.get("/media-stream-callback", { websocket: true }, async (connection, req) => {
    // Extract sessionId from query params to get callback context from Convex
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") || "";
    
    // Get and consume callback session from Convex (atomic, persistent)
    const callbackContext = sessionId 
      ? await convexClient.mutation(api.callbackSessions.getAndConsumeSession, { sessionId })
      : null;
    
    // Connection-specific state
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;

    // Call phase state machine — initial phase depends on callback reason.
    // Driven by the extracted restaurant phase machine (runtime/phaseEngine +
    // restaurant pack phase definitions) rather than the removed legacy
    // call-phase.ts module.
    let callPhase: string = callbackContext?.reason === "followup"
      ? RESTAURANT_VERIFIED_PHASE
      : callbackContext?.reason === "cancellation"
        ? ORDER_OPEN_PHASE
        : AWAIT_RESTAURANT_ID_PHASE;

    // OpenAI socket
    const oaWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${NEXT_OPENAI_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );
    
    let agentTools: Array<Record<string, unknown>> = [];
    let systemPrompt = "";
    
    if (callbackContext?.reason === "followup") {
      // Build the follow-up tool set from the restaurant pack tool definitions
      // (single source of truth) rather than a duplicated inline array. The
      // follow-up flow exposes the restaurant lookup + order-upsert tools.
      const followupToolNames = new Set(["get_restaurant_details", "upsert_order"]);
      agentTools = restaurantTools
        .filter((tool) => followupToolNames.has(tool.name))
        .map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));
      systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
    } else if (callbackContext?.reason === "cancellation") {
      systemPrompt = CANCELLATION_SYSTEM_PROMPT;
    }
    const initializeSession = () => {
      oaWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            turn_detection: { type: "server_vad" },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            voice: VOICE,
            instructions: systemPrompt,
            modalities: ["text", "audio"],
            temperature: 0.8,
            tools: agentTools,
          },
        }),
      );
    };

    const greet = () => {
      oaWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Greet the caller. The details of the order and the reason for the call is: <data>${callbackContext?.data || ""}</data><reason>${callbackContext?.reason || ""}</reason>`,
              },
            ],
          },
        }),
      );
      oaWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Helper function to handle interruptions
    const handleSpeechStartedEvent = () => {
      logger.info("Speech started - handling interruption", { callId: sessionId });
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          logger.debug(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`,
            { callId: sessionId }
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            logger.debug(
              `Sending truncation event: ${JSON.stringify(truncateEvent)}`,
              { callId: sessionId }
            );
          oaWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reset the local states
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Helper function
    const sendMark = () =>
      streamSid &&
      connection.send(
        JSON.stringify({
          event: "mark",
          streamSid,
          mark: { name: "responsePart" },
        }),
      );


    // Listen for messages from Twilio WebSocket
    connection.on("message", (data: string | Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'media':
            latestMediaTimestamp = message.media.timestamp;
            if (SHOW_TIMING_MATH) logger.debug(`Received media message with timestamp: ${latestMediaTimestamp}ms`, { callId: sessionId });

            if (oaWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: message.media.payload
              };
              oaWs.send(JSON.stringify(audioAppend));
            }
            break;

          case 'start':
            streamSid = message.start.streamSid;
            logger.info("Incoming stream has started", { callId: sessionId });
            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'mark':
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;

          case 'stop':
            logger.info("Stream stopped", { callId: sessionId });
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            logger.info(`Received non-media event: ${message.event}`, { callId: sessionId });
            break;
        }
      } catch (error) {
        logger.error("Error processing Twilio message", { callId: sessionId });
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) logger.debug("OpenAI event", { callId: sessionId });

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        // Delta events can be used for real-time display if needed
      }

      // Function call from the model
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments);
        const toolName: string = res.name;
        let output: Record<string, unknown> = { success: false };

        if (!isToolCallPermitted([...restaurantTools], toolName, callPhase).permitted) {
          logger.error("Tool rejected", {
            callId: sessionId,
          });
          output = { success: false, error: `Tool ${toolName} not allowed in phase ${callPhase}` };
        } else {
          try {
            switch (toolName) {
              case "get_restaurant_details":
                output = await wrapperGetRestaurantDetails(args.restaurant_id) as Record<string, unknown>;
                if (output.success) {
                  callPhase = nextRestaurantPhase(restaurantInboundPhases, callPhase, "restaurant_verified");
                }
                break;
              case "upsert_order":
                output = await wrapperUpsertOrders({
                  ...args,
                }) as Record<string, unknown>;
                if (output.success && args.status === "completed") {
                  callPhase = nextRestaurantPhase(restaurantInboundPhases, callPhase, "order_finalized");
                }
                break;
              case "generate_order_id":
                output = { orderId: generateOrderId(), publicOrderCode: generatePublicOrderCode() };
                callPhase = nextRestaurantPhase(restaurantInboundPhases, callPhase, "order_id_generated");
                break;
            }
          } catch (e) {
            output = { success: false, error: String(e) };
          }
        }

        oaWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: res.call_id,
              output: JSON.stringify(output),
            },
          }),
        );
        oaWs.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      // Audio back to Twilio
      if (res.type === "response.audio.delta" && res.delta) {
        connection.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: res.delta },
          }),
        );

        // First delta from a new response starts the elapsed time counter
        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH) logger.debug(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`, { callId: sessionId });
        }

        if (res.item_id) {
          lastAssistantItem = res.item_id;
        }

        sendMark();
        markQueue.push("responsePart");
      }

      // Handle speech interruption
      if (res.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

    });

    // OpenAI socket lifecycle
    oaWs.on("open", async () => {
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async () => {
      // Callback completed
    });
    oaWs.on("error", (err) => {
      logger.error("OpenAI socket error", { callId: sessionId });
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
    });

    connection.on("error", (err) => {
      logger.error("Twilio socket error", { callId: sessionId });
    });
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, url) => {
  if (err) {
    logger.error("Server startup failed");
    process.exit(1);
  }
  logger.info(`Server running at ${url}`);
});