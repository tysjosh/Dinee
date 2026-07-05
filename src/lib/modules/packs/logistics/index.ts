/**
 * Logistics VoiceDomainPack — assembly and registration.
 *
 * Assembles the extracted logistics prompt, tools, phases, and conversation
 * types into a {@link VoiceDomainPack} and registers it with the
 * VoiceDomainPack_Registry. The pack carries a {@link ModulePackBridge} that
 * REUSES the existing logistics `VerticalPack` / tool-pack registration
 * (registered under the `logistics` vertical key in
 * `src/lib/modules/toolPackRegistry.ts`) rather than duplicating it (Req 2.9).
 *
 * Bridge mode is `extend`: the five tools that have a counterpart in the
 * logistics tool-pack registration are reused through `reusesModuleTool`, and
 * the one voice-only tool (`get_organization_details`) is layered on top. This
 * keeps a single source of truth for logistics tool membership while adding the
 * voice-only concerns (prompts, phases, conversation types) the module-pack
 * system does not model.
 *
 * This is the pack side of the completed extraction (Req 1.4, 1.5, 1.6): the
 * legacy `src/app/ws-server/logistics-tools.ts`, `logistics-call-phase.ts`, and
 * the `isLogistics` branch in `index.ts` were removed in the legacy-removal step
 * (task 4.8), after the logistics compatibility test (task 4.4) passed; the
 * transport now delegates entirely to the pack-driven session driver.
 *
 * Requirements: 1.4, 1.6, 2.9
 */

import type {
  ModulePackBridge,
  VoiceDomainPack,
} from "@/lib/modules/voiceDomainPack";
import {
  registerVoiceDomainPack,
  type RegisterResult,
} from "@/lib/modules/voiceDomainPackRegistry";
import { hasToolPack } from "@/lib/modules/toolPackRegistry";
import { registerLogisticsPack } from "@/lib/modules/packs/logisticsPack";
import { logisticsConversationTypes } from "@/lib/modules/packs/logistics/conversationTypes";
import { logisticsTools } from "@/lib/modules/packs/logistics/tools";
import { logisticsPhases } from "@/lib/modules/packs/logistics/phases";
import { LOGISTICS_BOOKING_PROMPT } from "@/lib/modules/packs/logistics/prompts";
import { registerLogisticsHandlers } from "@/lib/modules/packs/logistics/handlers";

/** Unique id of the logistics VoiceDomainPack. */
export const LOGISTICS_PACK_ID = "logistics";

/**
 * The tool-pack registry key the logistics `VerticalPack` registers under. The
 * logistics pack registers its tool pack with `registerToolPack("logistics", …)`
 * (its `vertical`), so both the bridge's vertical reference and its reused
 * tool-pack reference use this key.
 */
const LOGISTICS_VERTICAL_KEY = "logistics";

/**
 * Bridge to the existing logistics Module_Pack_System registration (Req 2.9).
 * `extend` mode reuses the linked tool-pack membership for the five bridged
 * tools and adds the voice-only `get_organization_details` on top.
 */
const logisticsModuleBridge: ModulePackBridge = {
  verticalPackId: LOGISTICS_VERTICAL_KEY,
  reuseToolPackIds: [LOGISTICS_VERTICAL_KEY],
  mode: "extend",
};

/** The assembled logistics VoiceDomainPack. */
export const logisticsVoicePack: VoiceDomainPack = {
  id: LOGISTICS_PACK_ID,
  name: "Logistics",
  description:
    "Voice agent for a delivery and shipping company: shipment booking, status follow-up, and delivery-failure notifications, bridged to the existing logistics module pack.",
  conversationTypes: [...logisticsConversationTypes],
  tools: [...logisticsTools],
  phases: logisticsPhases,
  defaultPrompt: LOGISTICS_BOOKING_PROMPT,
  escalationRules: [],
  integrations: [],
  moduleBridge: logisticsModuleBridge,
};

/**
 * Registers the logistics VoiceDomainPack and its tool handlers.
 *
 * Ensures the bridged logistics tool-pack registration exists first (so the
 * `moduleBridge` reference resolves and is not rejected as
 * `unknown_module_bridge`), registers the tool handlers with the executor, then
 * registers the voice pack. Returns the {@link RegisterResult} so the caller can
 * surface a validation failure per Req 4.3.
 */
export function registerLogisticsVoicePack(): RegisterResult {
  // The bridge reuses the logistics tool-pack registration; make sure it is
  // present before registering the voice pack so the bridge reference resolves.
  if (!hasToolPack(LOGISTICS_VERTICAL_KEY)) {
    registerLogisticsPack();
  }
  registerLogisticsHandlers();
  return registerVoiceDomainPack(logisticsVoicePack);
}
