/**
 * Tool Pack Registry
 *
 * Maps business verticals to their voice agent tool packs.
 * The voice agent loads the appropriate tool pack at call initiation
 * based on the Business's vertical classification. Tools gated behind
 * an integration (e.g. "runsheet_connect") are filtered out when that
 * integration is not present in the Business's enabledModules.
 *
 * Requirements: 10.1, 10.5, 10.6, 10.7
 */

import type { ToolDefinition } from "./types";

const registry: Record<string, ToolDefinition[]> = {};

/**
 * Registers a tool pack for a given vertical.
 * Overwrites any previously registered pack for that vertical.
 */
export function registerToolPack(vertical: string, tools: ToolDefinition[]): void {
  registry[vertical] = tools;
}

/**
 * Returns tools for the given vertical, filtering out integration-gated tools
 * when the integration is not enabled (Req 10.7).
 *
 * Falls back to the general_services tool pack if no dedicated pack exists
 * for the requested vertical. Returns an empty array if neither is registered.
 */
export function getToolPack(
  vertical: string,
  enabledModules: string[]
): ToolDefinition[] {
  const tools = registry[vertical] ?? registry["general_services"] ?? [];
  return tools.filter((tool) => {
    if (tool.requiresIntegration) {
      return enabledModules.includes(tool.requiresIntegration);
    }
    return true;
  });
}

/**
 * Validates that a tool call is permitted for the active session (Req 10.6).
 *
 * Returns true only when the named tool appears in the resolved tool pack
 * for the given vertical and enabledModules. If the tool is not found,
 * the call should be rejected and the violation logged.
 */
export function validateToolCall(
  toolName: string,
  vertical: string,
  enabledModules: string[]
): boolean {
  const activePack = getToolPack(vertical, enabledModules);
  return activePack.some((t) => t.name === toolName);
}

/**
 * Clears all registered tool packs. Intended for testing only.
 */
export function clearRegistry(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}
