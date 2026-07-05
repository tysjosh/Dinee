/**
 * Agent-runtime health harness.
 *
 * An integration-style, end-to-end check that exercises the real Voice_Runtime
 * seams a live inbound call flows through, without opening a Twilio media stream
 * or an OpenAI Realtime socket. It composes the actual production functions:
 *
 *   1. **Phone-number lookup resolves a route** —
 *      {@link resolvePhoneToRoute} maps the called number to a
 *      {@link PhoneLookupResult} carrying a conversation route.
 *   2. **Call-phase state initializes** — {@link prepareSession} returns a
 *      `start` decision whose {@link SessionInit} carries the resolved pack's
 *      `initialPhase`.
 *   3. **Tool definitions load for the resolved domain** — the integration-gated
 *      tool set (via {@link resolveToolSet}, surfaced on `SessionInit.toolSet`)
 *      is non-empty for the resolved pack.
 *   4. **Out-of-set tool calls are rejected** — a {@link SessionDriver} dispatch
 *      of a tool absent from the resolved set is rejected (`not_in_set`), is not
 *      executed, and leaves the active phase unchanged.
 *
 * This harness is the code behind Req 1.12's agent-runtime health test. It
 * assumes the domain packs are already registered with the
 * VoiceDomainPack_Registry (as `index.ts` does at startup via
 * `registerRestaurantVoicePack()` / `registerLogisticsVoicePack()`); it performs
 * no registration itself so it can be pointed at the live registry.
 *
 * Requirements: 1.12
 */

import type { ConvexHttpClient } from "convex/browser";
import {
  resolvePhoneToRoute,
  type PhoneLookupResult,
} from "@/lib/call-routing/phone-lookup";
import { resolveToolSet } from "@/lib/modules/voiceDomainPackRegistry";
import {
  prepareSession,
  SessionDriver,
  type ResolvedCallContext,
} from "@/app/ws-server/runtime/session";

/** The four checks the agent-runtime health harness performs (Req 1.12). */
export type HealthCheckName =
  | "phone_lookup"
  | "phase_init"
  | "tools_loaded"
  | "out_of_set_rejected";

/** The outcome of a single health check. */
export interface HealthCheckResult {
  /** Which check this result describes. */
  name: HealthCheckName;
  /** Whether the check passed. */
  passed: boolean;
  /** A human-readable explanation of the outcome (for logs / a health endpoint). */
  detail: string;
}

/** Optional overrides for the synthetic call the harness drives. */
export interface HealthHarnessOptions {
  /** Synthetic Twilio call id; defaults to a generated `health-*` id. */
  callSid?: string;
  /** Calling-party number; defaults to a placeholder. */
  fromNumber?: string;
  /** Tenant id; defaults to the resolved route's org/restaurant id, else a placeholder. */
  tenantId?: string;
  /** Integrations enabled for the tenant, used for tool-set gating; defaults to `[]`. */
  enabledIntegrations?: string[];
  /** Optional callback reason passed to the phone lookup (subtype selection). */
  callbackReason?: string;
  /**
   * The tool name used to exercise out-of-set rejection. Defaults to a synthetic
   * name guaranteed to be absent from the resolved tool set.
   */
  outOfSetToolName?: string;
}

/** The full report produced by {@link runAgentRuntimeHealthCheck}. */
export interface AgentRuntimeHealthReport {
  /** True iff every check passed. */
  healthy: boolean;
  /** The number the harness looked up. */
  toNumber: string;
  /** The resolved route, or `null` if the lookup produced none. */
  route: PhoneLookupResult | null;
  /** The resolved conversation type (empty when no route resolved). */
  conversationType: string;
  /** The initial phase the session started in, or `null` if it did not start. */
  initialPhase: string | null;
  /** The names of the tools loaded for the resolved domain. */
  toolNames: string[];
  /** The individual check results, in execution order. */
  checks: HealthCheckResult[];
}

/**
 * Produces a tool name guaranteed not to appear in `existing`, so the
 * out-of-set rejection check exercises a genuinely unknown tool rather than one
 * that merely happens to be phase-gated.
 */
function syntheticOutOfSetToolName(existing: readonly string[]): string {
  let candidate = "__health_harness_unknown_tool__";
  const taken = new Set(existing);
  while (taken.has(candidate)) {
    candidate += "_x";
  }
  return candidate;
}

/**
 * Runs the agent-runtime health harness against a called number.
 *
 * Executes the four checks in order and short-circuits the dependent checks when
 * an earlier one fails (a call that never resolves a route cannot initialize a
 * phase, load tools, or gate a tool call), recording those as failed so the
 * report always describes all four checks.
 *
 * The harness never opens external sockets: it drives {@link SessionDriver}
 * purely in memory and dispatches only an out-of-set tool call, which gating
 * rejects before any handler runs.
 *
 * @param convexClient Convex client used by the phone lookup.
 * @param toNumber     The called (Dinee-managed) number to resolve.
 * @param options      Optional overrides for the synthetic call.
 * @returns A {@link AgentRuntimeHealthReport} describing all four checks.
 */
export async function runAgentRuntimeHealthCheck(
  convexClient: ConvexHttpClient,
  toNumber: string,
  options: HealthHarnessOptions = {}
): Promise<AgentRuntimeHealthReport> {
  const checks: HealthCheckResult[] = [];

  // 1. Phone-number lookup resolves a conversation route.
  const route = await resolvePhoneToRoute(
    convexClient,
    toNumber,
    options.callbackReason
  );
  const conversationType = route.conversationType ?? "";
  const routeResolved = conversationType.length > 0;
  checks.push({
    name: "phone_lookup",
    passed: routeResolved,
    detail: routeResolved
      ? `resolved ${toNumber} → ${conversationType} (${route.vertical})`
      : `no conversation route resolved for ${toNumber}`,
  });

  const ctx: ResolvedCallContext = {
    callSid: options.callSid ?? `health-${Date.now()}`,
    fromNumber: options.fromNumber ?? "+10000000000",
    toNumber,
    tenantId:
      options.tenantId ??
      route.organizationId ??
      route.restaurantId ??
      "health-tenant",
    conversationType,
    enabledIntegrations: options.enabledIntegrations ?? [],
  };

  // 2. Call-phase state initializes (prepareSession returns `start`).
  const prepared = prepareSession(ctx);
  if (prepared.kind !== "start") {
    checks.push({
      name: "phase_init",
      passed: false,
      detail: `session terminated before init: ${prepared.reason}`,
    });
    // Dependent checks cannot run without an initialized session.
    checks.push({
      name: "tools_loaded",
      passed: false,
      detail: "skipped: session did not initialize",
    });
    checks.push({
      name: "out_of_set_rejected",
      passed: false,
      detail: "skipped: session did not initialize",
    });
    return {
      healthy: false,
      toNumber,
      route,
      conversationType,
      initialPhase: null,
      toolNames: [],
      checks,
    };
  }

  const { init } = prepared;
  const phaseInitialized = init.initialPhase.length > 0;
  checks.push({
    name: "phase_init",
    passed: phaseInitialized,
    detail: phaseInitialized
      ? `session initialized in phase "${init.initialPhase}" (pack "${init.pack.id}")`
      : `session started without an initial phase (pack "${init.pack.id}")`,
  });

  // 3. Tool definitions load for the resolved domain. `init.toolSet` is the
  //    integration-gated set the runtime would expose; recompute it explicitly
  //    to assert the resolver agrees with what the session driver will gate on.
  const toolSet = resolveToolSet(init.pack, ctx.enabledIntegrations);
  const toolNames = toolSet.map((tool) => tool.name);
  const toolsLoaded = toolSet.length > 0;
  checks.push({
    name: "tools_loaded",
    passed: toolsLoaded,
    detail: toolsLoaded
      ? `loaded ${toolSet.length} tool(s) for pack "${init.pack.id}": ${toolNames.join(", ")}`
      : `no tools loaded for pack "${init.pack.id}"`,
  });

  // 4. Out-of-set tool calls are rejected without executing or changing phase.
  const outOfSetToolName =
    options.outOfSetToolName ?? syntheticOutOfSetToolName(toolNames);
  const driver = new SessionDriver(ctx, init);
  const phaseBefore = driver.phase;
  const dispatch = await driver.handleFunctionCall({
    callId: "health-out-of-set-call",
    name: outOfSetToolName,
    args: {},
  });
  const rejected =
    dispatch.kind === "rejected" && dispatch.reason === "not_in_set";
  const phasePreserved = driver.phase === phaseBefore;
  checks.push({
    name: "out_of_set_rejected",
    passed: rejected && phasePreserved,
    detail: rejected
      ? `out-of-set tool "${outOfSetToolName}" rejected (not_in_set); phase preserved as "${driver.phase}"`
      : `out-of-set tool "${outOfSetToolName}" was not rejected as expected (kind=${dispatch.kind})`,
  });

  return {
    healthy: checks.every((check) => check.passed),
    toNumber,
    route,
    conversationType,
    initialPhase: init.initialPhase,
    toolNames,
    checks,
  };
}
