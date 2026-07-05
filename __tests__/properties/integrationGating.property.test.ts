/**
 * Feature: dinee-voice-platform, Property 7: Integration gating of the exposed tool set (honors module bridge)
 *
 * Validates: Requirements 4.4, 2.9
 *
 * resolveToolSet includes a tool iff it needs no integration or its required
 * integration is enabled, AND a reuse-mode moduleBridge never re-exposes a tool
 * that is disabled at the module level.
 *
 * Two facets of the single named property are exercised:
 *   A. No-bridge integration gating (Req 4.4): a tool is exposed iff it declares
 *      no required integration, or its required integration is enabled.
 *   B. Reuse-mode module-bridge gating (Req 2.9): the exposed voice tools are
 *      exactly those whose `reusesModuleTool` survives the module-level
 *      integration gating of the linked tool packs — a module-disabled tool is
 *      never re-exposed at the voice level.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type {
  VoiceDomainPack,
  VoiceToolDefinition,
} from "../../src/lib/modules/voiceDomainPack";
import type { ToolDefinition } from "../../src/lib/modules/types";
import { resolveToolSet, clearRegistry as clearVoiceRegistry } from "../../src/lib/modules/voiceDomainPackRegistry";
import {
  registerToolPack,
  getRegisteredToolPack,
  clearRegistry as clearModuleRegistry,
} from "../../src/lib/modules/toolPackRegistry";
import {
  registerPlatform,
  clearPlatformRegistry,
} from "../../src/lib/integrations/platform/registry";
import { resolveAdapter } from "../../src/lib/integrations/platform/adapterResolver";
import type {
  PlatformDefinition,
  TransportContract,
  AdapterConstructionContext,
} from "../../src/lib/integrations/platform/types";

// Pool of integration ids used across both facets.
const INTEGRATION_POOL = ["runsheet", "stripe", "gcal", "twilio"];

// The module-pack key the voice pack bridges to.
const BRIDGE_KEY = "logistics";

/** Builds a minimal valid VoiceDomainPack wrapping the given tools. */
function makePack(
  tools: VoiceToolDefinition[],
  moduleBridge?: VoiceDomainPack["moduleBridge"]
): VoiceDomainPack {
  return {
    id: "pack_under_test",
    name: "Pack Under Test",
    description: "",
    conversationTypes: [
      {
        type: "ct_main",
        initialPhase: "p1",
        transcriptMetadata: { fields: {} },
        fallbackBehavior: { kind: "escalate" },
      },
    ],
    tools,
    phases: [{ id: "p1", transitions: [] }],
    defaultPrompt: "prompt",
    escalationRules: [],
    integrations: [],
    moduleBridge,
  };
}

describe("Property 7: Integration gating of the exposed tool set (honors module bridge)", () => {
  beforeEach(() => {
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  // --- Facet A: no-bridge integration gating (Req 4.4) ---

  const noBridgeToolsArb = fc
    .array(
      fc.record({
        requiresIntegration: fc.option(fc.constantFrom(...INTEGRATION_POOL), {
          nil: undefined,
        }),
        readOnly: fc.boolean(),
      }),
      { minLength: 0, maxLength: 20 }
    )
    .map((specs) =>
      specs.map<VoiceToolDefinition>((spec, i) => ({
        name: `tool_${i}`,
        description: "d",
        parameters: { type: "object" },
        allowedPhases: ["p1"],
        readOnly: spec.readOnly,
        handler: `handler_${i}`,
        requiresIntegration: spec.requiresIntegration,
      }))
    );

  const enabledArb = fc.subarray(INTEGRATION_POOL, { minLength: 0 });

  it("exposes a tool iff it needs no integration or its integration is enabled", () => {
    fc.assert(
      fc.property(noBridgeToolsArb, enabledArb, (tools, enabled) => {
        clearVoiceRegistry();
        clearModuleRegistry();

        const pack = makePack(tools);
        const exposed = new Set(resolveToolSet(pack, enabled).map((t) => t.name));

        for (const tool of tools) {
          const shouldExpose =
            !tool.requiresIntegration ||
            enabled.includes(tool.requiresIntegration);
          expect(exposed.has(tool.name)).toBe(shouldExpose);
        }
      }),
      { numRuns: 100 }
    );
  });

  // --- Facet B: reuse-mode module-bridge gating (Req 2.9) ---

  // Generate module tools, then voice tools that reference them (plus a bogus
  // reference that maps to no module tool), plus a set of enabled integrations.
  const bridgeScenarioArb = fc
    .array(
      fc.record({
        requiresIntegration: fc.option(fc.constantFrom(...INTEGRATION_POOL), {
          nil: undefined,
        }),
      }),
      { minLength: 1, maxLength: 8 }
    )
    .map((specs) =>
      specs.map<ToolDefinition>((spec, i) => ({
        name: `mod_${i}`,
        description: "d",
        parameters: {},
        handler: `mod_handler_${i}`,
        requiresIntegration: spec.requiresIntegration,
      }))
    )
    .chain((moduleTools) => {
      const refPool = [...moduleTools.map((t) => t.name), "mod_absent"];
      const voiceToolsArb = fc
        .array(
          fc.record({
            ref: fc.constantFrom(...refPool),
            requiresIntegration: fc.option(
              fc.constantFrom(...INTEGRATION_POOL),
              { nil: undefined }
            ),
          }),
          { minLength: 0, maxLength: 12 }
        )
        .map((vspecs) =>
          vspecs.map<VoiceToolDefinition>((v, i) => ({
            name: `voice_${i}`,
            description: "d",
            parameters: { type: "object" },
            allowedPhases: ["p1"],
            readOnly: false,
            handler: `voice_handler_${i}`,
            reusesModuleTool: v.ref,
            requiresIntegration: v.requiresIntegration,
          }))
        );
      return fc.record({
        moduleTools: fc.constant(moduleTools),
        voiceTools: voiceToolsArb,
        enabled: fc.subarray(INTEGRATION_POOL, { minLength: 0 }),
      });
    });

  it("a reuse-mode bridge never re-exposes a tool disabled at the module level", () => {
    fc.assert(
      fc.property(bridgeScenarioArb, ({ moduleTools, voiceTools, enabled }) => {
        clearVoiceRegistry();
        clearModuleRegistry();
        registerToolPack(BRIDGE_KEY, moduleTools);

        const pack = makePack(voiceTools, {
          verticalPackId: BRIDGE_KEY,
          reuseToolPackIds: [BRIDGE_KEY],
          mode: "reuse",
        });

        const exposed = resolveToolSet(pack, enabled);

        // Module-level gated membership: the tools that survive module gating.
        const moduleGatedNames = new Set(
          getRegisteredToolPack(BRIDGE_KEY, enabled).map((t) => t.name)
        );

        // (1) Every exposed voice tool reuses a module tool that survived
        //     module-level gating AND passes its own voice-level gating.
        for (const tool of exposed) {
          expect(tool.reusesModuleTool).toBeDefined();
          expect(moduleGatedNames.has(tool.reusesModuleTool as string)).toBe(
            true
          );
          expect(
            !tool.requiresIntegration ||
              enabled.includes(tool.requiresIntegration)
          ).toBe(true);
        }

        // (2) A module tool disabled at the module level (its required
        //     integration is not enabled) is never re-exposed by any voice tool.
        const disabledModuleNames = moduleTools
          .filter(
            (mt) =>
              mt.requiresIntegration &&
              !enabled.includes(mt.requiresIntegration)
          )
          .map((mt) => mt.name);
        for (const disabledName of disabledModuleNames) {
          const reExposed = exposed.some(
            (t) => t.reusesModuleTool === disabledName
          );
          expect(reExposed).toBe(false);
        }

        // (3) A voice tool referencing an absent module tool is never exposed.
        expect(exposed.some((t) => t.reusesModuleTool === "mod_absent")).toBe(
          false
        );
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: multi-platform-voice-integrations, Property 13: Adapter resolution by Platform_Id
 *
 * Validates: Requirements 6.1, 6.2, 6.3
 *
 * For a registered platformId, resolveAdapter returns
 * { resolved: true, adapter, platformId } with adapter.platformId === platformId.
 * For an unregistered platformId, resolveAdapter returns { resolved: false }.
 *
 *
 * Feature: multi-platform-voice-integrations, Property 14: Platform-gated tools
 * require an enabled, connected integration
 *
 * Validates: Requirements 6.4, 8.5
 *
 * A tool that requiresIntegration for a platformId is enabled only when that
 * platformId is in the call's enabledIntegrations — which happens only when an
 * adapter is resolved AND the integration is connected. When no adapter is
 * resolved / not connected, the platform-gated tool is NOT enabled.
 */

// A well-formed Transport_Contract shared by the dummy platform definitions.
function makeContract(): TransportContract {
  return {
    authScheme: "bearer",
    readPathPrefix: "/voice",
    intakePath: "/voice-intake",
    timestampFormat: "iso-8601",
    schemaVersion: "1.0",
    tenantHeader: "X-Tenant",
  };
}

// Decrypted construction materials the resolver hands to the adapter factory.
function makeContext(): AdapterConstructionContext {
  return {
    baseUrl: "https://example.test",
    platformTenantId: "tenant-1",
    credentials: {},
    config: {},
    contract: makeContract(),
  };
}

/**
 * Builds a minimal valid Platform_Definition whose adapter factory produces an
 * adapter carrying the same platformId (captured via closure), so the resolver
 * can be asserted to preserve identity (Req 6.1).
 */
function makePlatformDefinition(platformId: string): PlatformDefinition {
  return {
    platformId,
    displayName: platformId,
    credentialFields: [],
    adapterFactory: (ctx) => ({
      platformId,
      contract: ctx.contract,
      readClient: { testCredential: async () => ({ valid: true }) },
      intakeClient: {
        submit: async () => ({ status: "accepted" as const, httpStatus: 200 }),
      },
    }),
    contract: makeContract(),
    runtimeServiceTokenEnvVar: `RUNTIME_TOKEN_${platformId}`,
  };
}

// Platform ids constrained to the registry's valid 1–64 char range.
const platformIdArb = fc.string({ minLength: 1, maxLength: 24 });

describe("Feature: multi-platform-voice-integrations, Property 13: Adapter resolution by Platform_Id", () => {
  beforeEach(() => {
    clearPlatformRegistry();
  });

  it("resolves registered platformIds to an adapter and reports unresolved for unregistered ids", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(platformIdArb, { minLength: 1, maxLength: 8 }),
        fc.array(platformIdArb, { minLength: 0, maxLength: 8 }),
        (registeredIds, probeIds) => {
          clearPlatformRegistry();

          for (const id of registeredIds) {
            const result = registerPlatform(makePlatformDefinition(id));
            expect(result.ok).toBe(true);
          }

          const registeredSet = new Set(registeredIds);
          const ctx = makeContext();

          // Registered ids resolve, preserving platformId identity (Req 6.1, 6.2).
          for (const id of registeredIds) {
            const resolution = resolveAdapter(id, ctx);
            expect(resolution.resolved).toBe(true);
            if (resolution.resolved) {
              expect(resolution.platformId).toBe(id);
              expect(resolution.adapter.platformId).toBe(id);
            }
          }

          // Probe ids resolve iff registered; unregistered ids are explicitly
          // unresolved so the runtime enables no platform-gated tools (Req 6.3).
          for (const id of probeIds) {
            const resolution = resolveAdapter(id, ctx);
            expect(resolution.resolved).toBe(registeredSet.has(id));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Feature: multi-platform-voice-integrations, Property 14: Platform-gated tools require an enabled, connected integration", () => {
  beforeEach(() => {
    clearPlatformRegistry();
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  it("exposes a platform-gated tool iff its adapter is resolved AND the integration is connected", () => {
    fc.assert(
      fc.property(
        platformIdArb, // the platform the gated tool requires
        fc.boolean(), // whether the platform is registered (adapter resolvable)
        fc.boolean(), // whether the integration is connected
        (platformId, registered, connected) => {
          clearPlatformRegistry();
          clearVoiceRegistry();
          clearModuleRegistry();

          if (registered) {
            expect(registerPlatform(makePlatformDefinition(platformId)).ok).toBe(
              true,
            );
          }

          const ctx = makeContext();
          const resolution = resolveAdapter(platformId, ctx);
          const resolved = resolution.resolved;

          // Mirror the ws-server binding decision: platformId is added to the
          // call's enabledIntegrations only when an adapter is resolved AND the
          // integration is connected (Req 6.4, 8.5).
          const enabledIntegrations: string[] =
            resolved && connected ? [platformId] : [];

          const gatedTool: VoiceToolDefinition = {
            name: "platform_gated_tool",
            description: "d",
            parameters: { type: "object" },
            allowedPhases: ["p1"],
            readOnly: false,
            handler: "gated_handler",
            requiresIntegration: platformId,
          };
          const ungatedTool: VoiceToolDefinition = {
            name: "ungated_tool",
            description: "d",
            parameters: { type: "object" },
            allowedPhases: ["p1"],
            readOnly: false,
            handler: "ungated_handler",
          };

          const pack = makePack([gatedTool, ungatedTool]);
          const exposed = new Set(
            resolveToolSet(pack, enabledIntegrations).map((t) => t.name),
          );

          // The platform-gated tool is enabled only when resolved AND connected.
          expect(exposed.has(gatedTool.name)).toBe(resolved && connected);
          // An ungated tool is always exposed, regardless of integration state.
          expect(exposed.has(ungatedTool.name)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
