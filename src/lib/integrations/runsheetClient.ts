import crypto from "crypto";

/**
 * Configuration for the Runsheet Connect integration.
 * API key is decrypted at runtime from the encrypted storage.
 */
export interface RunsheetConfig {
  apiKey: string; // Decrypted at runtime
  tenantMapping: Record<string, string>; // locationId → Runsheet hubId
  webhookUrl: string;
}

/**
 * Represents an inbound webhook event from the Runsheet API.
 */
export interface RunsheetWebhookEvent {
  eventId: string;
  eventType: "shipment_status" | "rider_assignment";
  timestamp: string; // ISO 8601
  signature: string;
  payload: Record<string, unknown>;
}

/**
 * Validates an HMAC-SHA256 webhook signature using timing-safe comparison
 * to prevent timing attacks. (Req 18.7)
 *
 * @param payload - The raw JSON payload string from the webhook request body
 * @param signature - The signature header value sent by Runsheet
 * @param secret - The stored webhook secret for this integration
 * @returns true if the signature is valid, false otherwise
 */
export function validateRunsheetSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Both buffers must be the same length for timingSafeEqual.
  // If lengths differ, the signature is invalid.
  const sigBuffer = Buffer.from(signature, "utf-8");
  const expectedBuffer = Buffer.from(expected, "utf-8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Client for interacting with the Runsheet logistics dispatch API.
 *
 * Handles webhook registration, shipment event pushing, and
 * webhook signature validation for the Runsheet Connect integration.
 *
 * Requirements: 7.4, 8.2, 18.7
 */
export class RunsheetClient {
  private config: RunsheetConfig;

  constructor(config: RunsheetConfig) {
    this.config = config;
  }

  /**
   * Registers a webhook subscription with the Runsheet API so that
   * shipment status and rider assignment events are pushed to our endpoint.
   * (Req 7.4)
   *
   * @returns The subscription ID from Runsheet
   */
  async registerWebhook(): Promise<{ subscriptionId: string }> {
    // TODO: Replace with actual Runsheet API call when API docs are available
    const response = await fetch("https://api.runsheet.com/v1/webhooks/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        url: this.config.webhookUrl,
        events: ["shipment_status", "rider_assignment"],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Runsheet webhook registration failed (${response.status}): ${errorBody}`
      );
    }

    const data = (await response.json()) as { subscriptionId: string };
    return { subscriptionId: data.subscriptionId };
  }

  /**
   * Pushes a shipment event to the Runsheet API for external tracking.
   * Used when the logistics tool pack's push_event_to_runsheet tool is invoked.
   * (Req 8.2)
   *
   * @param shipmentId - The Dinee shipment ID (mapped to Runsheet via tenantMapping)
   * @param event - The event payload to push
   */
  async pushShipmentEvent(
    shipmentId: string,
    event: Record<string, unknown>
  ): Promise<void> {
    // TODO: Replace with actual Runsheet API call when API docs are available
    const response = await fetch(
      `https://api.runsheet.com/v1/shipments/${encodeURIComponent(shipmentId)}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Runsheet push shipment event failed (${response.status}): ${errorBody}`
      );
    }
  }

  /**
   * Validates the HMAC-SHA256 signature on an inbound Runsheet webhook event.
   * Uses timing-safe comparison to prevent timing attacks. (Req 18.7)
   *
   * @param event - The webhook event containing the signature to validate
   * @param secret - The stored webhook secret for this Business's integration
   * @returns true if the signature is valid
   */
  async validateWebhookSignature(
    event: RunsheetWebhookEvent,
    secret: string
  ): Promise<boolean> {
    const payload = JSON.stringify(event.payload);
    return validateRunsheetSignature(payload, event.signature, secret);
  }
}
