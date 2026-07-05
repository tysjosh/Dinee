"use node";

/**
 * Provider adapter factory.
 *
 * Maps TelecomProvider names to their concrete adapter implementations.
 * Vonage is left as a stub since it wasn't requested for this round.
 */

import type { ProviderAdapter } from "./types";
import type { TelecomProvider } from "../../shared/phoneProvisioningTypes";
import { createTwilioAdapter } from "./twilio";
import { createAfricasTalkingAdapter } from "./africasTalking";
import { createTermiiAdapter } from "./termii";

export type { ProviderAdapter } from "./types";

/** Vonage stub — returns errors indicating it's not yet wired. */
function createVonageStub(): ProviderAdapter {
  const notImplemented = (op: string) => ({
    success: false as const,
    error: `Vonage ${op} not yet implemented`,
    errorCode: "provider_not_implemented" as const,
  });

  return {
    async purchaseNumber() {
      return { ...notImplemented("purchaseNumber") };
    },
    async configureWebhook() {
      return { success: false, error: "Vonage configureWebhook not yet implemented" };
    },
    async releaseNumber() {
      return { success: false, error: "Vonage releaseNumber not yet implemented" };
    },
    async checkHealth() {
      return { healthStatus: "unreachable" as const, details: "Vonage adapter not implemented" };
    },
  };
}

const adapters: Record<TelecomProvider, () => ProviderAdapter> = {
  twilio: createTwilioAdapter,
  vonage: createVonageStub,
  africas_talking: createAfricasTalkingAdapter,
  termii: createTermiiAdapter,
};

export function getProviderAdapter(provider: TelecomProvider): ProviderAdapter {
  const factory = adapters[provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return factory();
}
