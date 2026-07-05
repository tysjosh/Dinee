/**
 * Restaurant VoiceDomainPack — assembly and registration.
 *
 * Assembles the restaurant flow, extracted from the legacy Voice_Runtime
 * (`src/app/ws-server/index.ts`, `tools.ts`, `call-phase.ts`,
 * `server-constants.ts`), into a single {@link VoiceDomainPack} expressed
 * against the pack contract (Req 1.4, 1.6): the restaurant prompts, the inbound
 * tool set, and the inbound phase machine, plus the conversation types the pack
 * owns.
 *
 * This is a GRADUAL extraction step: the legacy runtime path remains intact and
 * authoritative until the restaurant compatibility test (task 4.2) verifies the
 * extracted behavior matches the Phase 0 baseline. Only then does legacy removal
 * (task 4.8) proceed. Registering this pack here does not remove or alter the
 * legacy branch.
 *
 * The restaurant flow uses the internal Dinee API and requires no external
 * integration, so the pack declares no `integrations` and no `moduleBridge`
 * (the logistics extraction in task 4.3 is the one that bridges an existing
 * Module_Pack_System registration).
 *
 * Requirements: 1.4, 1.6
 */

import type { VoiceDomainPack } from "@/lib/modules/voiceDomainPack";
import { registerVoiceDomainPack } from "@/lib/modules/voiceDomainPackRegistry";
import { createLogger } from "@/lib/logger";
import { restaurantConversationTypes } from "@/lib/modules/packs/restaurant/conversationTypes";
import { restaurantTools } from "@/lib/modules/packs/restaurant/tools";
import { restaurantInboundPhases } from "@/lib/modules/packs/restaurant/phases";
import { RESTAURANT_DEFAULT_PROMPT } from "@/lib/modules/packs/restaurant/prompts";
import { registerRestaurantVoiceHandlers } from "@/lib/modules/packs/restaurant/handlers";

const logger = createLogger("restaurant-voice-pack");

/** Stable identifier for the restaurant voice domain pack. */
export const RESTAURANT_VOICE_PACK_ID = "restaurant";

/**
 * The restaurant VoiceDomainPack. Bundles the extracted prompts, tools, phases,
 * and conversation types so the pack-driven runtime can serve the restaurant
 * inbound-order, follow-up, and cancellation flows without any inline branching.
 */
export const restaurantVoicePack: VoiceDomainPack = {
  id: RESTAURANT_VOICE_PACK_ID,
  name: "Restaurant Voice Agent",
  description:
    "Restaurant call-taking voice agent: greets callers, verifies the restaurant, " +
    "captures and updates food orders, and records the live transcript.",
  conversationTypes: [...restaurantConversationTypes],
  tools: [...restaurantTools],
  phases: restaurantInboundPhases,
  defaultPrompt: RESTAURANT_DEFAULT_PROMPT,
  escalationRules: [],
  integrations: [],
};

/**
 * Registers the restaurant VoiceDomainPack with the registry and wires its tool
 * handlers into the runtime tool executor. Call during platform initialization.
 *
 * Registration is validated by {@link registerVoiceDomainPack}; a validation
 * failure is surfaced (thrown) so a misassembled pack fails fast at startup
 * rather than silently going unregistered.
 */
export function registerRestaurantVoicePack(): void {
  const result = registerVoiceDomainPack(restaurantVoicePack);
  if (!result.ok) {
    throw new Error(
      `Failed to register restaurant voice pack: ${result.error.code} (${result.error.detail})`
    );
  }
  registerRestaurantVoiceHandlers();
  logger.info("Registered restaurant voice domain pack", {
    packId: RESTAURANT_VOICE_PACK_ID,
  });
}
