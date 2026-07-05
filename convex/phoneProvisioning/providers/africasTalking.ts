"use node";

/**
 * Africa's Talking provider adapter for phone number provisioning.
 *
 * Uses the `africastalking` npm SDK for voice number management.
 * AT provides virtual phone numbers for voice in African markets
 * (Ghana, Kenya, South Africa).
 *
 * Env vars required:
 *   AT_API_KEY, AT_USERNAME
 *
 * Reference: https://developers.africastalking.com/docs/voice/overview
 *
 * Note: Africa's Talking virtual number provisioning is done through
 * their dashboard or support team for initial setup. The API allows
 * managing calls on those numbers. For programmatic number purchase,
 * we use their REST API directly.
 */

import type {
  ProviderAdapter,
  PurchaseResult,
  WebhookConfigResult,
  ReleaseResult,
  HealthCheckResult,
} from "./types";

const AT_BASE_URL = "https://voice.africastalking.com";
const AT_API_BASE = "https://api.africastalking.com/version1";

/** Country code → dialing prefix for AT markets */
const COUNTRY_PREFIXES: Record<string, string> = {
  GH: "+233",
  KE: "+254",
  ZA: "+27",
  NG: "+234",
};

/** Monthly cost estimates per country (USD) */
const MONTHLY_COSTS: Record<string, number> = {
  GH: 2.0,
  KE: 1.5,
  ZA: 2.5,
  NG: 2.0,
};

function getCredentials() {
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  if (!apiKey || !username) {
    throw new Error(
      "Africa's Talking credentials not configured (AT_API_KEY, AT_USERNAME)"
    );
  }
  return { apiKey, username };
}

function getAfricasTalkingClient() {
  const { apiKey, username } = getCredentials();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AfricasTalking = require("africastalking");
  return AfricasTalking({ apiKey, username });
}

export function createAfricasTalkingAdapter(): ProviderAdapter {
  return {
    async purchaseNumber(
      region: string,
      countryCode: string
    ): Promise<PurchaseResult> {
      const { apiKey, username } = getCredentials();

      // Africa's Talking number provisioning uses their REST API
      // to request a virtual number for voice in the target country.
      // POST to the checkout/virtual-numbers endpoint
      const response = await fetch(
        `${AT_BASE_URL}/checkout/virtual-numbers`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            apiKey,
          },
          body: new URLSearchParams({
            username,
            countryCode,
            type: "voice",
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        const statusCode = response.status;

        // Classify HTTP errors
        if (statusCode === 401 || statusCode === 403) {
          return {
            success: false,
            error: `Authentication failed: ${text}`,
            errorCode: "invalid_credentials",
          };
        }
        if (statusCode === 429) {
          return {
            success: false,
            error: `Rate limited: ${text}`,
            errorCode: "rate_limit",
          };
        }
        if (statusCode === 503 || statusCode === 502) {
          return {
            success: false,
            error: `Service unavailable: ${text}`,
            errorCode: "provider_unavailable",
          };
        }

        return {
          success: false,
          error: `AT API error (${statusCode}): ${text}`,
          errorCode: "provider_error",
        };
      }

      const data = await response.json();

      // AT returns the assigned virtual number
      const phoneNumber = data.phoneNumber || data.virtualNumber;
      if (!phoneNumber) {
        return {
          success: false,
          error: "No phone number returned from Africa's Talking",
          errorCode: "no_inventory",
        };
      }

      // Generate a SID-like identifier from the AT response
      const numberSid = `AT_${data.id || data.numberId || crypto.randomUUID().slice(0, 12)}`;

      return {
        success: true,
        numberSid,
        phoneNumber,
        monthlyCost: MONTHLY_COSTS[countryCode] ?? 2.0,
        currency: "USD",
        capabilities: ["voice"],
      };
    },

    async configureWebhook(
      numberSid: string,
      webhookUrl: string
    ): Promise<WebhookConfigResult> {
      const { apiKey, username } = getCredentials();

      // AT webhook configuration is done via their callback URL settings.
      // The voice callback URL is set at the application level or per-number.
      const response = await fetch(
        `${AT_BASE_URL}/callbackUrl/update`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            apiKey,
          },
          body: new URLSearchParams({
            username,
            phoneNumber: numberSid, // AT uses the phone number as identifier
            callbackUrl: webhookUrl,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Failed to configure AT webhook: ${text}`,
        };
      }

      return { success: true };
    },

    async releaseNumber(numberSid: string): Promise<ReleaseResult> {
      const { apiKey, username } = getCredentials();

      // Release the virtual number back to AT
      const response = await fetch(
        `${AT_BASE_URL}/checkout/virtual-numbers/release`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            apiKey,
          },
          body: new URLSearchParams({
            username,
            phoneNumber: numberSid,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          error: `Failed to release AT number: ${text}`,
        };
      }

      return { success: true };
    },

    async checkHealth(numberSid: string): Promise<HealthCheckResult> {
      const { apiKey, username } = getCredentials();

      // Check if the number is still active by querying AT
      try {
        const response = await fetch(
          `${AT_BASE_URL}/checkout/virtual-numbers/status?username=${encodeURIComponent(username)}&phoneNumber=${encodeURIComponent(numberSid)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              apiKey,
            },
          }
        );

        if (!response.ok) {
          return {
            healthStatus: "unreachable",
            details: `AT status check failed with HTTP ${response.status}`,
          };
        }

        const data = await response.json();
        const status = data.status?.toLowerCase();

        if (status === "active" || status === "ok") {
          // Check if callback URL is properly set
          if (!data.callbackUrl || data.callbackUrl === "") {
            return {
              healthStatus: "degraded",
              details: "Voice callback URL is not configured",
            };
          }
          return { healthStatus: "healthy" };
        }

        return {
          healthStatus: "unreachable",
          details: `Number status: ${status}`,
        };
      } catch (err) {
        return {
          healthStatus: "unreachable",
          details: err instanceof Error ? err.message : "Health check failed",
        };
      }
    },
  };
}
