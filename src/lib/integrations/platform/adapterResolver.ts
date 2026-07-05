// src/lib/integrations/platform/adapterResolver.ts
//
// Adapter_Resolver — bridges a call's resolved Platform_Id and its decrypted
// construction materials to a concrete Integration_Adapter, replacing the
// hardcoded `isRunsheetCall` branch in the Voice_Runtime.
//
// Resolution is fail-closed: an unregistered platform, or a factory that
// throws, yields `{ resolved: false }` so the runtime binds no adapter and
// enables no platform-gated tools for the call (Req 6.3).
//
// Requirements: 6.1, 6.2, 6.3, 6.4

import type { IntegrationAdapter } from "./adapter";
import { resolvePlatform } from "./registry";
import type { AdapterConstructionContext } from "./types";

export type AdapterResolution =
  | { resolved: true; adapter: IntegrationAdapter; platformId: string }
  | { resolved: false };

/**
 * Resolves an adapter for a call from its Platform_Id (Req 6.1, 6.2). Selects
 * the platform by id via the Integration_Registry rather than any hardcoded
 * platform branch. Returns an unresolved result for an unregistered platform
 * so the runtime enables no platform-gated tools (Req 6.3). When resolved, the
 * caller adds `platformId` to the call's enabledIntegrations so pack
 * `requiresIntegration` gating applies (Req 6.4).
 *
 * Fail-closed: if the platform's adapter factory throws while constructing the
 * adapter, this returns `{ resolved: false }` rather than propagating the
 * error, ensuring an unverifiable integration never drives a call (Req 6.3).
 */
export function resolveAdapter(
  platformId: string,
  ctx: AdapterConstructionContext,
): AdapterResolution {
  const resolution = resolvePlatform(platformId);
  if (!resolution.resolved) {
    return { resolved: false };
  }

  try {
    const adapter = resolution.definition.adapterFactory(ctx);
    return { resolved: true, adapter, platformId };
  } catch {
    return { resolved: false };
  }
}
