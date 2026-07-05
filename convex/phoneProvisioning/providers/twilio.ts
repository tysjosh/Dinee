/**
 * Twilio provider adapter for phone number provisioning.
 *
 * Uses the Twilio Node.js SDK (already installed) to:
 * - Search and purchase local phone numbers
 * - Configure voice webhook URLs
 * - Release (delete) numbers
 * - Check number health via fetch
 *
 * Env vars required:
 *   NEXT_TWILIO_SID, NEXT_TWILIO_AUTH_TOKEN
 *
 * Reference: https://www.twilio.com/docs/phone-numbers/api
 */

import type {
  ProviderAdapter,
  PurchaseResult,
  WebhookConfigResult,
  ReleaseResult,
  HealthCheckResult,
} from "./types";

/** ISO country code → Twilio country code (same format). */
const COUNTRY_MAP: Record<string, string> = {
  US: "US",
  GB: "GB",
  NG: "NG",
  GH: "GH",
  KE: "KE",
  ZA: "ZA",
};

function getTwilioClient() {
  const accountSid = process.env.NEXT_TWILIO_SID;
  const authToken = process.env.NEXT_TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured (NEXT_TWILIO_SID, NEXT_TWILIO_AUTH_TOKEN)");
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twilio = require("twilio");
  return twilio(accountSid, authToken);
}

export function createTwilioAdapter(): ProviderAdapter {
  return {
    async purchaseNumber(region: string, countryCode: string): Promise<PurchaseResult> {
      const client = getTwilioClient();
      const twilioCountry = COUNTRY_MAP[countryCode] ?? countryCode;

      // 1. Search for available local numbers with voice capability
      const available = await client
        .availablePhoneNumbers(twilioCountry)
        .local.list({
          voiceEnabled: true,
          limit: 1,
        });

      if (!available || available.length === 0) {
        return {
          success: false,
          error: `No voice-enabled numbers available in ${twilioCountry}`,
          errorCode: "no_inventory",
        };
      }

      const candidate = available[0];

      // 2. Purchase the number
      const purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: candidate.phoneNumber,
      });

      // 3. Build capabilities list
      const capabilities: string[] = [];
      if (purchased.capabilities?.voice) capabilities.push("voice");
      if (purchased.capabilities?.sms) capabilities.push("sms");
      if (purchased.capabilities?.mms) capabilities.push("mms");
      if (purchased.capabilities?.fax) capabilities.push("fax");

      // Req 2.7 — reject if no voice
      if (!capabilities.includes("voice")) {
        // Release the number we just bought since it lacks voice
        try {
          await client.incomingPhoneNumbers(purchased.sid).remove();
        } catch {
          // best-effort cleanup
        }
        return {
          success: false,
          error: "Purchased number does not support voice capability",
          errorCode: "no_voice_capability",
        };
      }

      return {
        success: true,
        numberSid: purchased.sid,
        phoneNumber: purchased.phoneNumber,
        // Twilio pricing: ~$1/mo for US local, varies by country
        // The actual price comes from the Twilio pricing API, but
        // for provisioning we use a reasonable default per country.
        monthlyCost: getMonthlyPrice(countryCode),
        currency: "USD",
        capabilities,
      };
    },

    async configureWebhook(numberSid: string, webhookUrl: string): Promise<WebhookConfigResult> {
      const client = getTwilioClient();
      await client.incomingPhoneNumbers(numberSid).update({
        voiceUrl: webhookUrl,
        voiceMethod: "POST",
      });
      return { success: true };
    },

    async releaseNumber(numberSid: string): Promise<ReleaseResult> {
      const client = getTwilioClient();
      await client.incomingPhoneNumbers(numberSid).remove();
      return { success: true };
    },

    async checkHealth(numberSid: string): Promise<HealthCheckResult> {
      const client = getTwilioClient();
      const number = await client.incomingPhoneNumbers(numberSid).fetch();

      if (!number) {
        return { healthStatus: "unreachable", details: "Number not found at Twilio" };
      }

      // Check if voice URL is configured
      if (!number.voiceUrl || number.voiceUrl === "") {
        return {
          healthStatus: "degraded",
          details: "Voice webhook URL is not configured",
        };
      }

      // Check capabilities
      if (!number.capabilities?.voice) {
        return {
          healthStatus: "unreachable",
          details: "Number has lost voice capability",
        };
      }

      return { healthStatus: "healthy" };
    },
  };
}

function getMonthlyPrice(countryCode: string): number {
  const prices: Record<string, number> = {
    US: 1.15,
    GB: 1.15,
    NG: 3.0,
    GH: 3.0,
    KE: 3.0,
    ZA: 2.0,
  };
  return prices[countryCode] ?? 1.15;
}
