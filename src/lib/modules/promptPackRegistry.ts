/**
 * Prompt Pack Registry
 *
 * Maps business verticals to their AI agent prompt packs.
 * The voice agent loads the appropriate prompt pack at call initiation
 * based on the Business's vertical classification.
 *
 * Requirements: 9.5, 9.7
 */

import type { PromptPack } from "./types";

const registry: Record<string, PromptPack> = {};

/**
 * Registers a prompt pack for a given vertical.
 * Overwrites any previously registered pack for that vertical.
 */
export function registerPromptPack(vertical: string, pack: PromptPack): void {
  registry[vertical] = pack;
}

/**
 * Returns the PromptPack for the given vertical.
 * Falls back to general_services if no dedicated pack exists (Req 9.7).
 */
export function getPromptPack(vertical: string): PromptPack {
  return registry[vertical] ?? registry["general_services"];
}

/**
 * Clears all registered prompt packs. Intended for testing only.
 */
export function clearRegistry(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}
