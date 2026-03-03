/**
 * Partner API Webhook Service
 * 
 * Implements webhook delivery for order and call events with retry logic
 * using exponential backoff (5 retries).
 * 
 * @module partner-api/webhook-service
 * @requirements 21.5 - Webhook delivery for events: order.created, order.updated, order.completed, call.started, call.ended
 * @requirements 21.6 - Retry failed deliveries up to 5 times with exponential backoff
 */

import crypto from 'crypto';
import type {
  WebhookSubscription,
  WebhookDelivery,
  WebhookPayload,
  WebhookEventType,
} from './types';
import { generateWebhookSignature } from './auth';
import {
  buildRunsheetBody,
  signRunsheet,
} from '../logistics/runsheet-webhook-mapper';

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of retry attempts */
export const MAX_RETRY_ATTEMPTS = 5;

/** Base delay for exponential backoff in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Maximum delay between retries in milliseconds (1 hour) */
export const MAX_RETRY_DELAY_MS = 3600000;

/** Webhook delivery timeout in milliseconds */
export const WEBHOOK_TIMEOUT_MS = 30000;

/** API version for webhook payloads */
export const API_VERSION = '2024-01-01';

// ============================================================================
// Webhook Payload Creation
// ============================================================================

/**
 * Create a webhook payload for an event
 * 
 * @param eventType - The type of event
 * @param data - The event data
 * @returns The webhook payload
 */
export function createWebhookPayload<T>(
  eventType: WebhookEventType,
  data: T
): WebhookPayload<T> {
  return {
    id: `evt_${crypto.randomBytes(16).toString('hex')}`,
    type: eventType,
    timestamp: Date.now(),
    apiVersion: API_VERSION,
    data,
  };
}

/**
 * Sign a webhook payload
 * 
 * @param payload - The payload to sign
 * @param secret - The webhook secret
 * @returns Object containing signature and timestamp
 */
export function signWebhookPayload(
  payload: WebhookPayload<unknown>,
  secret: string
): { signature: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify(payload);
  const signature = generateWebhookSignature(payloadString, secret, timestamp);
  
  return { signature, timestamp };
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Calculate delay for exponential backoff
 * 
 * @param attemptNumber - The current attempt number (1-based)
 * @returns Delay in milliseconds
 * 
 * @requirements 21.6 - Exponential backoff for retries
 */
export function calculateRetryDelay(attemptNumber: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at MAX_RETRY_DELAY_MS)
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber - 1);
  
  // Add jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  
  return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

/**
 * Determine if a delivery should be retried based on status code
 * 
 * @param statusCode - The HTTP status code
 * @returns Whether to retry
 */
export function shouldRetry(statusCode: number): boolean {
  // Retry on server errors (5xx) and some client errors
  if (statusCode >= 500) return true;
  
  // Retry on rate limiting
  if (statusCode === 429) return true;
  
  // Retry on timeout (represented as 0 or 408)
  if (statusCode === 0 || statusCode === 408) return true;
  
  // Don't retry on other client errors (4xx)
  return false;
}

// ============================================================================
// Webhook Delivery
// ============================================================================

/**
 * Deliver a webhook to a subscription endpoint
 * 
 * @param subscription - The webhook subscription
 * @param payload - The webhook payload
 * @returns Delivery result
 */
export async function deliverWebhook(
  subscription: WebhookSubscription,
  payload: WebhookPayload<unknown>
): Promise<{
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  duration: number;
}> {
  const mode = subscription.mode ?? "partner";

  if (mode === "runsheet") {
    return deliverRunsheetWebhook(subscription, payload);
  }

  return deliverPartnerWebhook(subscription, payload);
}

/**
 * Partner-mode delivery (existing behaviour).
 * Signs with `${timestamp}.${body}` and sends X-Webhook-Signature / X-Webhook-Timestamp.
 */
async function deliverPartnerWebhook(
  subscription: WebhookSubscription,
  payload: WebhookPayload<unknown>
): Promise<{
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  duration: number;
}> {
  const startTime = Date.now();
  const payloadString = JSON.stringify(payload);
  const { signature, timestamp } = signWebhookPayload(payload, subscription.secret);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp.toString(),
        'X-Webhook-Id': payload.id,
        'User-Agent': 'RestaurantPlatform-Webhook/1.0',
      },
      body: payloadString,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const duration = Date.now() - startTime;
    let responseBody: string | undefined;
    
    try {
      responseBody = await response.text();
    } catch {
      // Ignore response body read errors
    }
    
    return {
      success: response.ok,
      statusCode: response.status,
      responseBody,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('abort')) {
      return {
        success: false,
        statusCode: 408,
        error: 'Request timeout',
        duration,
      };
    }
    
    return {
      success: false,
      statusCode: 0,
      error: errorMessage,
      duration,
    };
  }
}

/**
 * Runsheet-mode delivery.
 * Builds the Runsheet envelope, signs the raw JSON body with HMAC-SHA256
 * (no timestamp prefix), and sends X-Dinee-Signature.
 *
 * tenant_id is sourced from the subscription record (server-authoritative)
 * rather than from client input to prevent spoofing.
 */
async function deliverRunsheetWebhook(
  subscription: WebhookSubscription,
  payload: WebhookPayload<unknown>
): Promise<{
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  duration: number;
}> {
  const startTime = Date.now();

  // Build Runsheet envelope — tenant_id comes from the subscription record
  const tenantId = subscription.tenantId ?? subscription.partnerId;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const envelope = buildRunsheetBody(payload.id, payload.type, tenantId, data);

  const raw = JSON.stringify(envelope);
  const sig = signRunsheet(raw, subscription.secret);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dinee-Signature": sig,
        "User-Agent": "Dinee-Webhook/1.0",
      },
      body: raw,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const duration = Date.now() - startTime;
    let responseBody: string | undefined;

    try {
      responseBody = await response.text();
    } catch {
      // Ignore response body read errors
    }

    return {
      success: response.ok,
      statusCode: response.status,
      responseBody,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("abort")) {
      return {
        success: false,
        statusCode: 408,
        error: "Request timeout",
        duration,
      };
    }

    return {
      success: false,
      statusCode: 0,
      error: errorMessage,
      duration,
    };
  }
}

/**
 * Deliver a webhook with retry logic
 * 
 * @param subscription - The webhook subscription
 * @param payload - The webhook payload
 * @param onAttempt - Callback for each attempt (for logging/tracking)
 * @returns Final delivery result
 * 
 * @requirements 21.6 - Retry failed deliveries up to 5 times with exponential backoff
 */
export async function deliverWebhookWithRetry(
  subscription: WebhookSubscription,
  payload: WebhookPayload<unknown>,
  onAttempt?: (attempt: number, result: Awaited<ReturnType<typeof deliverWebhook>>) => void
): Promise<WebhookDelivery> {
  const deliveryId = `del_${crypto.randomBytes(16).toString('hex')}`;
  let attemptCount = 0;
  let lastResult: Awaited<ReturnType<typeof deliverWebhook>> | null = null;
  
  while (attemptCount < MAX_RETRY_ATTEMPTS) {
    attemptCount++;
    
    // Wait before retry (except for first attempt)
    if (attemptCount > 1) {
      const delay = calculateRetryDelay(attemptCount);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    lastResult = await deliverWebhook(subscription, payload);
    
    // Call the attempt callback if provided
    if (onAttempt) {
      onAttempt(attemptCount, lastResult);
    }
    
    // If successful, return immediately
    if (lastResult.success) {
      return {
        id: deliveryId,
        subscriptionId: subscription.id,
        eventType: payload.type,
        payload: JSON.stringify(payload),
        statusCode: lastResult.statusCode,
        responseBody: lastResult.responseBody,
        attemptCount,
        success: true,
        createdAt: Date.now() - lastResult.duration,
        lastAttemptAt: Date.now(),
      };
    }
    
    // Check if we should retry
    if (!shouldRetry(lastResult.statusCode || 0)) {
      break;
    }
  }
  
  // All retries exhausted or non-retryable error
  return {
    id: deliveryId,
    subscriptionId: subscription.id,
    eventType: payload.type,
    payload: JSON.stringify(payload),
    statusCode: lastResult?.statusCode,
    responseBody: lastResult?.responseBody,
    attemptCount,
    success: false,
    error: lastResult?.error || `Failed after ${attemptCount} attempts`,
    createdAt: Date.now() - (lastResult?.duration || 0),
    lastAttemptAt: Date.now(),
  };
}

// ============================================================================
// Event Dispatching
// ============================================================================

/**
 * Dispatch an event to all matching subscriptions
 * 
 * @param eventType - The type of event
 * @param data - The event data
 * @param subscriptions - All webhook subscriptions
 * @param onDelivery - Callback for each delivery result
 * @returns Array of delivery results
 */
export async function dispatchEvent<T>(
  eventType: WebhookEventType,
  data: T,
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  // Filter subscriptions that are active and subscribed to this event
  const matchingSubscriptions = subscriptions.filter(
    sub => sub.isActive && sub.events.includes(eventType)
  );
  
  if (matchingSubscriptions.length === 0) {
    return [];
  }
  
  // Create the payload once
  const payload = createWebhookPayload(eventType, data);
  
  // Deliver to all matching subscriptions in parallel
  const deliveryPromises = matchingSubscriptions.map(async subscription => {
    const delivery = await deliverWebhookWithRetry(subscription, payload);
    
    if (onDelivery) {
      onDelivery(delivery);
    }
    
    return delivery;
  });
  
  return Promise.all(deliveryPromises);
}

// ============================================================================
// Order Event Helpers
// ============================================================================

/**
 * Dispatch order.created event
 */
export async function dispatchOrderCreated(
  order: {
    orderId: string;
    restaurantId: string;
    branchId?: string;
    customerName: string;
    items: Array<{ name: string; quantity: number; price: number }>;
    totalAmount: number;
    status: string;
  },
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  return dispatchEvent('order.created', order, subscriptions, onDelivery);
}

/**
 * Dispatch order.updated event
 */
export async function dispatchOrderUpdated(
  order: {
    orderId: string;
    restaurantId: string;
    branchId?: string;
    status: string;
    previousStatus?: string;
    updatedFields: string[];
  },
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  return dispatchEvent('order.updated', order, subscriptions, onDelivery);
}

/**
 * Dispatch order.completed event
 */
export async function dispatchOrderCompleted(
  order: {
    orderId: string;
    restaurantId: string;
    branchId?: string;
    customerName: string;
    totalAmount: number;
    completedAt: number;
  },
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  return dispatchEvent('order.completed', order, subscriptions, onDelivery);
}

// ============================================================================
// Call Event Helpers
// ============================================================================

/**
 * Dispatch call.started event
 */
export async function dispatchCallStarted(
  call: {
    callId: string;
    restaurantId: string;
    branchId?: string;
    phoneNumber?: string;
    startTime: number;
  },
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  return dispatchEvent('call.started', call, subscriptions, onDelivery);
}

/**
 * Dispatch call.ended event
 */
export async function dispatchCallEnded(
  call: {
    callId: string;
    restaurantId: string;
    branchId?: string;
    phoneNumber?: string;
    startTime: number;
    endTime: number;
    duration: number;
    orderId?: string;
  },
  subscriptions: WebhookSubscription[],
  onDelivery?: (delivery: WebhookDelivery) => void
): Promise<WebhookDelivery[]> {
  return dispatchEvent('call.ended', call, subscriptions, onDelivery);
}
