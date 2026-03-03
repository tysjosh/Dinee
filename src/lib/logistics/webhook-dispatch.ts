/**
 * Logistics Webhook Dispatch — Atomic Idempotent Event Ingestion + Delivery
 *
 * Wraps `atomicInsertWebhookEvent` for logistics-specific webhook events.
 * Deduplicates by eventId and logs duplicates at warn level.
 * After successful insertion, delivers the event to all matching webhook
 * subscribers using the existing `webhookDeliveries` infrastructure.
 *
 * @module logistics/webhook-dispatch
 * @requirements 10.4, 10.5, 10.6, 10.7, 22.6, 25.1, 25.2, 25.3, 25.4, 25.5
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { createLogger } from "../logger";
import { dispatchEvent } from "../partner-api/webhook-service";
import type { WebhookEventType, WebhookSubscription } from "../partner-api/types";

const logger = createLogger("logistics/webhook-dispatch");

// ============================================================================
// Types
// ============================================================================

export interface LogisticsWebhookEventInput {
  /** Shipment ID — populates shipmentId, resourceType, and resourceId */
  shipmentId: string;
  /** Logistics event type, e.g. "shipment.created", "shipment.assigned" */
  eventType: string;
  /** JSON-serialized event payload */
  payload: string;
  /** Correlation request ID for end-to-end traceability (Req 22.6) */
  requestId: string;
  /**
   * Voice session correlation ID (Req 17.5, 17.11, 17.12).
   * When present (voice-originated), both requestId and correlationId are
   * included in the webhook payload. When absent (API-originated), only
   * requestId is included.
   */
  correlationId?: string;
}

export interface WebhookDispatchResult {
  inserted: boolean;
  alreadyProcessed?: boolean;
  id?: string;
  deliveries?: number;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Dispatch a logistics webhook event with atomic idempotency and subscriber delivery.
 *
 * 1. Calls `atomicInsertWebhookEvent` with `resourceType: "shipment"` and the
 *    shipmentId (Req 10.5, 10.6). If the event was already inserted (duplicate
 *    eventId), logs a warning and returns — no side effects (Req 25.1, 25.2).
 *
 * 2. On successful insertion, fetches active webhook subscriptions matching the
 *    event type and delivers via the existing retry infrastructure (Req 10.7).
 *    The originating requestId is included in the webhook payload (Req 22.6).
 */
export async function dispatchLogisticsWebhookEvent(
  convexClient: ConvexHttpClient,
  input: LogisticsWebhookEventInput
): Promise<WebhookDispatchResult> {
  const eventId = `${input.eventType}:${input.shipmentId}:${input.requestId}`;

  // Step 1: Atomic idempotent insertion into webhookEvents
  const result = await convexClient.mutation(
    api.webhookEvents.atomicInsertWebhookEvent,
    {
      eventId,
      provider: "paystack" as const, // placeholder — logistics events use shared infra
      eventType: input.eventType,
      payload: input.payload,
      verified: true,
      processed: false,
      shipmentId: input.shipmentId,
      resourceType: "shipment" as const,
      resourceId: input.shipmentId,
    }
  );

  if (!result.inserted) {
    logger.warn("Duplicate logistics webhook event skipped", {
      eventId,
      shipmentId: input.shipmentId,
      requestId: input.requestId,
    });
    return { inserted: false, alreadyProcessed: result.alreadyProcessed };
  }

  logger.info("Logistics webhook event inserted", {
    eventId,
    shipmentId: input.shipmentId,
    requestId: input.requestId,
  });

  // Step 2: Deliver to subscriber endpoints via existing infrastructure
  let deliveryCount = 0;
  try {
    const rawSubscriptions = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionsByEventType,
      { eventType: input.eventType }
    );

    if (rawSubscriptions.length > 0) {
      // Map Convex subscription records to the WebhookSubscription interface
      const subscriptions: WebhookSubscription[] = rawSubscriptions.map((s) => ({
        id: s.subscriptionId,
        partnerId: s.partnerId,
        url: s.url,
        secret: s.secret,
        events: s.events as WebhookEventType[],
        isActive: s.isActive,
        mode: (s.mode ?? "partner") as "partner" | "runsheet",
        tenantId: s.tenantId,
        createdAt: s.createdAt,
      }));

      // Build standardized envelope payload (Req 18.1–18.6)
      // Envelope: eventId, eventType, resourceType, resourceId, shipmentId, timestamp, requestId
      // Event-specific details wrapped in `data` object (Req 18.2)
      // Req 17.11: Voice-originated webhooks include both requestId and correlationId
      // Req 17.12: API-originated webhooks include requestId only (no correlationId)
      const eventPayload = JSON.parse(input.payload);
      const dataWithRequestId: Record<string, unknown> = {
        eventId,
        eventType: input.eventType,
        resourceType: "shipment",
        resourceId: input.shipmentId,
        shipmentId: input.shipmentId,
        timestamp: Date.now(),
        requestId: input.correlationId || input.requestId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        data: eventPayload,
      };

      const deliveries = await dispatchEvent(
        input.eventType as WebhookEventType,
        dataWithRequestId,
        subscriptions,
        (delivery) => {
          // Persist each delivery record to Convex for dashboard visibility
          convexClient
            .mutation(api.webhookDeliveries.createWebhookDelivery, {
              deliveryId: delivery.id,
              subscriptionId: delivery.subscriptionId ?? "",
              eventType: delivery.eventType ?? input.eventType,
              payload: delivery.payload ?? input.payload,
              statusCode: delivery.statusCode,
              responseBody: delivery.responseBody,
              attemptCount: delivery.attemptCount ?? 1,
              success: delivery.success ?? false,
              error: delivery.error,
            })
            .catch((err) => {
              logger.warn("Failed to persist webhook delivery record", {
                deliveryId: delivery.id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      );

      deliveryCount = deliveries.length;

      logger.info("Logistics webhook event delivered to subscribers", {
        eventId,
        shipmentId: input.shipmentId,
        requestId: input.requestId,
        deliveryCount,
        successCount: deliveries.filter((d) => d.success).length,
      });
    }
  } catch (deliveryError) {
    // Delivery failures should not fail the overall operation — the event
    // is already persisted and can be retried later.
    logger.error("Failed to deliver logistics webhook to subscribers", {
      eventId,
      shipmentId: input.shipmentId,
      requestId: input.requestId,
      error:
        deliveryError instanceof Error
          ? deliveryError.message
          : String(deliveryError),
    });
  }

  // Step 3: Mark the webhook event as processed
  try {
    await convexClient.mutation(api.webhookEvents.markWebhookEventAsProcessed, {
      eventId,
    });
  } catch (markError) {
    logger.warn("Failed to mark webhook event as processed", {
      eventId,
      error: markError instanceof Error ? markError.message : String(markError),
    });
  }

  return { inserted: true, id: result.id, deliveries: deliveryCount };
}
