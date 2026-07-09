/**
 * Campus VoiceDomainPack — assembly.
 *
 * Assembles the `campus` VoiceDomainPack: the single
 * `campus_agent_conversation` conversation type, the two read-only voice tools
 * (`campus_lookup_knowledge`, `campus_offer_creator_contact`), the
 * `greeting → conversing → wrap_up` phase machine, and the default
 * answer-only-from-knowledge prompt template (design §"`campus`
 * VoiceDomainPack").
 *
 * Like the restaurant pack, the campus flow is powered entirely by internal
 * Dinee/Convex functions and requires no external integration, so the pack
 * declares no `integrations`. It also declares no `moduleBridge`: both campus
 * tools are voice-only (no counterpart in an existing Module_Pack_System
 * tool-pack to reuse) and there is no pre-existing `campus` `VerticalPack` to
 * bridge to, so — as with restaurant — there is nothing to reuse and a bridge
 * would be vacuous. This mirrors the restaurant pack's "internal API, no
 * external integration" shape.
 *
 * This module provides the pack DEFINITION and its registration entry point
 * ({@link registerCampusVoicePack}). Registering the pack with the
 * VoiceDomainPack registry in `extend` mode (additive registration into the
 * shared registry alongside the restaurant/logistics/runsheet packs, without
 * replacing any existing pack) is done here (task 27.2). Injecting the per-call
 * config (voice, personality, knowledge, boundaries, creator-contact) resolved
 * from `campusAgents` + `Knowledge_Store.getGroundingContext` at session start,
 * and writing `campusAgentId` + duration on the `calls` record at call end,
 * lives in the Convex campus session service (`convex/campus/session.ts`), which
 * the Voice_Runtime consumes at call time (task 27.2).
 *
 * Requirements: 5.4, 5.5, 8.1, 8.3, 8.4, 8.5, 8.6, 8.8
 */

import type { VoiceDomainPack } from "@/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  type RegisterResult,
} from "@/lib/modules/voiceDomainPackRegistry";
import { createLogger } from "@/lib/logger";
import { campusConversationTypes } from "@/lib/modules/packs/campus/conversationTypes";
import { campusTools } from "@/lib/modules/packs/campus/tools";
import { campusPhases } from "@/lib/modules/packs/campus/phases";
import { CAMPUS_DEFAULT_PROMPT } from "@/lib/modules/packs/campus/prompts";

const logger = createLogger("campus-voice-pack");

/** Stable identifier for the campus voice domain pack. */
export const CAMPUS_VOICE_PACK_ID = "campus";

/**
 * The campus VoiceDomainPack. Bundles the campus conversation type, tools,
 * phases, and default prompt so the pack-driven Voice_Runtime can serve
 * knowledge-grounded Campus_Agent conversations. Per-call configuration is
 * resolved from `campusAgents` + `Knowledge_Store` at session start (task 27.2),
 * so the pack itself stays product-agnostic.
 */
export const campusVoicePack: VoiceDomainPack = {
  id: CAMPUS_VOICE_PACK_ID,
  name: "Campus Voice Agent",
  description:
    "Student-created knowledge-grounded voice agent: greets callers in the " +
    "agent's selected voice, answers strictly from the agent's approved " +
    "knowledge (and says it does not know otherwise), and offers the creator's " +
    "contact link on a routing match.",
  conversationTypes: [...campusConversationTypes],
  tools: [...campusTools],
  phases: campusPhases,
  defaultPrompt: CAMPUS_DEFAULT_PROMPT,
  escalationRules: [],
  integrations: [],
};

/**
 * Registers the campus VoiceDomainPack with the shared registry in `extend`
 * mode. Like the restaurant pack, campus declares no `moduleBridge` (both of its
 * tools are voice-only and there is no pre-existing `campus` Module_Pack_System
 * tool pack to reuse), so registration is purely additive: it inserts the pack
 * into the shared registry alongside the restaurant/logistics/runsheet packs
 * without replacing any of them, so the pack-driven session driver can resolve
 * the `campus_agent_conversation` type by lookup (Req 8.1).
 *
 * Registration is validated by {@link registerVoiceDomainPack}; unlike the
 * restaurant pack (which throws) this returns the {@link RegisterResult} so the
 * caller at platform startup can log a validation failure without aborting the
 * other packs' registration — mirroring the logistics/runsheet registration
 * shape. No tool handlers are wired here: the two campus tools are resolved from
 * per-call agent context injected by the session service at session start, so
 * there is no product-agnostic global handler to register (contrast the
 * restaurant pack, whose handlers are context-free).
 */
export function registerCampusVoicePack(): RegisterResult {
  const result = registerVoiceDomainPack(campusVoicePack);
  if (!result.ok) {
    logger.error("Failed to register campus voice domain pack", {
      code: result.error.code,
      detail: result.error.detail,
    });
    return result;
  }
  logger.info("Registered campus voice domain pack", {
    packId: CAMPUS_VOICE_PACK_ID,
  });
  return result;
}

export {
  campusConversationTypes,
  campusTools,
  campusPhases,
  CAMPUS_DEFAULT_PROMPT,
};
