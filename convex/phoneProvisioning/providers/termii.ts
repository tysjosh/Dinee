/**
 * Termii provider adapter for phone number provisioning.
 *
 * Termii provides dedicated virtual numbers for the Nigerian market.
 * Their API is REST-based (no SDK needed).
 *
 * Termii's primary strength is SMS/messaging, but they support
 * voice via text-to-speech delivery. For inbound voice routing,
 * the number is configured with a webhook callback.
 *
 * Env vars required:
 *   TERMII_API_KEY
 *
 * Reference: https://developer.termii.com/
 */

import type {
  ProviderAdapter,
  PurchaseResult,
  WebhookConfigResult,
  ReleaseResult,
  HealthCheckResult,
} from "./types";

const TERMII_BASE_URL = "https://v3.api.termii.com";

function getApiKey(): string {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) {
    throw new Error("Termii credentials not configured (TERMII_API_KEY)");
  }
  return apiKey;
}

async function termiiRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const apiKey = getApiKey();
  const url = `${TERMII_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const requestBody = body ? { ...body, api_key: apiKey } : { api_key: apiKey };

  const response = await fetch(url, {
    method,
    headers,
    body: method !== "GET" ? JSON.stringify(requestBody) : undefined,
  });

  let data: Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    data = { raw: await response.text() };
  }

  return { ok: response.ok, status: response.status, data };
}

export function createTermiiAdapter(): ProviderAdapter {
  return {
    async purchaseNumber(
      region: string,
      countryCode: string
    ): Promise<PurchaseResult> {
      // Termii dedicated number provisioning
      // Request a dedicated number for voice/SMS in Nigeria
      const { ok, status, data } = await termiiRequest(
        "/api/numbers/buy",
        "POST",
        {
          country_code: countryCode,
          type: "voice",
          capabilities: ["voice", "sms"],
        }
      );

      if (!ok) {
        // Classify errors
        if (status === 401 || status === 403) {
          return {
            success: false,
            error: `Authentication failed: ${JSON.stringify(data)}`,
            errorCode: "invalid_credentials",
          };
        }
        if (status === 402) {
          return {
            success: false,
            error: `Insufficient funds: ${JSON.stringify(data)}`,
            errorCode: "insufficient_funds",
          };
        }
        if (status === 429) {
          return {
            success: false,
            error: `Rate limited: ${JSON.stringify(data)}`,
            errorCode: "rate_limit",
          };
        }
        if (status === 503 || status === 502) {
          return {
            success: false,
            error: `Service unavailable: ${JSON.stringify(data)}`,
            errorCode: "provider_unavailable",
          };
        }
        if (status === 404 || (data.message && String(data.message).includes("no number"))) {
          return {
            success: false,
            error: `No numbers available: ${JSON.stringify(data)}`,
            errorCode: "no_inventory",
          };
        }

        return {
          success: false,
          error: `Termii API error (${status}): ${JSON.stringify(data)}`,
          errorCode: "provider_error",
        };
      }

      const phoneNumber = (data.phone_number || data.number || data.phoneNumber) as string;
      if (!phoneNumber) {
        return {
          success: false,
          error: "No phone number returned from Termii",
          errorCode: "no_inventory",
        };
      }

      const numberSid = `TM_${(data.id || data.number_id || crypto.randomUUID().slice(0, 12)) as string}`;

      return {
        success: true,
        numberSid,
        phoneNumber,
        monthlyCost: 0.4,
        currency: "USD",
        capabilities: ["voice", "sms"],
      };
    },

    async configureWebhook(
      numberSid: string,
      webhookUrl: string
    ): Promise<WebhookConfigResult> {
      // Configure the voice/inbound webhook for the Termii number
      const { ok, data } = await termiiRequest(
        "/api/numbers/webhook",
        "POST",
        {
          number_id: numberSid.replace("TM_", ""),
          webhook_url: webhookUrl,
          webhook_type: "voice",
        }
      );

      if (!ok) {
        return {
          success: false,
          error: `Failed to configure Termii webhook: ${JSON.stringify(data)}`,
        };
      }

      return { success: true };
    },

    async releaseNumber(numberSid: string): Promise<ReleaseResult> {
      const { ok, data } = await termiiRequest(
        "/api/numbers/release",
        "POST",
        {
          number_id: numberSid.replace("TM_", ""),
        }
      );

      if (!ok) {
        return {
          success: false,
          error: `Failed to release Termii number: ${JSON.stringify(data)}`,
        };
      }

      return { success: true };
    },

    async checkHealth(numberSid: string): Promise<HealthCheckResult> {
      try {
        const apiKey = getApiKey();
        const numberId = numberSid.replace("TM_", "");

        const response = await fetch(
          `${TERMII_BASE_URL}/api/numbers/status?api_key=${encodeURIComponent(apiKey)}&number_id=${encodeURIComponent(numberId)}`,
          { method: "GET", headers: { "Content-Type": "application/json" } }
        );

        if (!response.ok) {
          return {
            healthStatus: "unreachable",
            details: `Termii status check failed with HTTP ${response.status}`,
          };
        }

        const data = await response.json();
        const status = String(data.status || "").toLowerCase();

        if (status === "active" || status === "ok") {
          if (!data.webhook_url) {
            return {
              healthStatus: "degraded",
              details: "Webhook URL is not configured",
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
