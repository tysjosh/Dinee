/**
 * Webhook Service Implementation
 * 
 * Handles webhook delivery for partner integrations with
 * exponential backoff retry logic.
 * 
 * @module partner-api/WebhookService
 * @requirements 21.5 - Webhook delivery for order and call events
 * @requirements 21.6 - Retry with exponential backoff (5 retries)
 */

import crypto from 'crypto';
import type {
  WebhookEvent,
  WebhookEventType,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookMetrics,
  PartnerApplication,
} from './types';
import {
  MAX_WEBHOOK_RETRIES,
  WEBHOOK_RETRY_DELAYS,
  API_VERSION,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Webhook service configuration
 */
export interface WebhookServiceConfig {
  /** Function to get partner by ID */
  getPartnerFn?: (partnerId: string) => PartnerApplication | undefined;
  /** Function to persist delivery record */
  persistDeliveryFn?: (delivery: WebhookDelivery) => Promise<void>;
  /** Function to update delivery record */
  updateDeliveryFn?: (deliveryId: string, updates: Partial<WebhookDelivery>) => Promise<void>;
  /** Timeout for webhook requests in ms */
  requestTimeoutMs?: number;
  /** Whether to process retries automatically */
  autoRetry?: boolean;
}

/**
 * Webhook creation parameters
 */
export interface CreateWebhookEventParams {
  type: WebhookEventType;
  data: Record<string, unknown>;
  partnerId?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate webhook signature
 */
function generateSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Calculate next retry delay using exponential backoff
 * @requirements 21.6 - Exponential backoff
 */
function getRetryDelay(attempt: number): number {
  const index = Math.min(attempt - 1, WEBHOOK_RETRY_DELAYS.length - 1);
  return WEBHOOK_RETRY_DELAYS[index] * 1000; // Convert to ms
}

// ============================================================================
// Webhook Service
// ============================================================================

/**
 * Webhook Service
 * 
 * Manages webhook event creation and delivery with retry logic.
 * 
 * @requirements 21.5 - Webhook delivery for order and call events
 * @requirements 21.6 - Retry with exponential backoff (5 retries)
 */
export class WebhookService {
  private config: WebhookServiceConfig;
  
  // In-memory storage
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private pendingRetries: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: WebhookServiceConfig = {}) {
    this.config = {
      requestTimeoutMs: 30000, // 30 seconds
      autoRetry: true,
      ...config,
    };
  }

  // ==========================================================================
  // Event Creation
  // ==========================================================================

  /**
   * Create a webhook event
   */
  createEvent(params: CreateWebhookEventParams): WebhookEvent {
    return {
      id: generateId('evt'),
      type: params.type,
      data: params.data,
      timestamp: Date.now(),
      apiVersion: API_VERSION,
    };
  }

  // ==========================================================================
  // Delivery Management
  // ==========================================================================

  /**
   * Queue a webhook for delivery
   * @requirements 21.5 - Webhook delivery for order and call events
   */
  async queueDelivery(
    partnerId: string,
    event: WebhookEvent,
    webhookUrl: string,
    webhookSecret?: string
  ): Promise<WebhookDelivery> {
    const delivery: WebhookDelivery = {
      id: generateId('dlv'),
      partnerId,
      event,
      url: webhookUrl,
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_WEBHOOK_RETRIES,
      createdAt: Date.now(),
    };

    this.deliveries.set(delivery.id, delivery);

    if (this.config.persistDeliveryFn) {
      await this.config.persistDeliveryFn(delivery);
    }

    // Attempt immediate delivery
    this.attemptDelivery(delivery.id, webhookSecret);

    return delivery;
  }

  /**
   * Attempt to deliver a webhook
   * @requirements 21.6 - Retry with exponential backoff
   */
  async attemptDelivery(
    deliveryId: string,
    webhookSecret?: string
  ): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      return false;
    }

    if (delivery.status === 'delivered') {
      return true;
    }

    if ((delivery.attempts ?? 0) >= (delivery.maxAttempts ?? 0)) {
      delivery.status = 'failed';
      await this.updateDelivery(delivery);
      return false;
    }

    delivery.attempts = (delivery.attempts ?? 0) + 1;
    delivery.lastAttemptAt = Date.now();
    delivery.status = 'retrying';

    try {
      const payload = JSON.stringify(delivery.event);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-ID': delivery.id,
        'X-Event-Type': delivery.event?.type ?? '',
        'X-Event-ID': delivery.event?.id ?? '',
        'X-Timestamp': (delivery.event?.timestamp ?? 0).toString(),
      };

      // Add signature if secret is provided
      if (webhookSecret) {
        headers['X-Signature'] = generateSignature(payload, webhookSecret);
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.requestTimeoutMs
      );

      const response = await fetch(delivery.url!, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      delivery.lastStatusCode = response.status;

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.completedAt = Date.now();
        await this.updateDelivery(delivery);
        
        return true;
      }

      // Non-2xx response
      delivery.lastError = `HTTP ${response.status}: ${response.statusText}`;
      
    } catch (error) {
      delivery.lastError = error instanceof Error ? error.message : 'Unknown error';
    }

    // Schedule retry if attempts remaining
    if ((delivery.attempts ?? 0) < (delivery.maxAttempts ?? 0) && this.config.autoRetry) {
      const delay = getRetryDelay(delivery.attempts ?? 0);
      delivery.nextRetryAt = Date.now() + delay;
      delivery.status = 'retrying';

      const timeoutId = setTimeout(() => {
        this.pendingRetries.delete(deliveryId);
        this.attemptDelivery(deliveryId, webhookSecret);
      }, delay);

      this.pendingRetries.set(deliveryId, timeoutId);
    } else if ((delivery.attempts ?? 0) >= (delivery.maxAttempts ?? 0)) {
      delivery.status = 'failed';
    }

    await this.updateDelivery(delivery);
    return false;
  }

  /**
   * Update delivery record
   */
  private async updateDelivery(delivery: WebhookDelivery): Promise<void> {
    this.deliveries.set(delivery.id, delivery);

    if (this.config.updateDeliveryFn) {
      await this.config.updateDeliveryFn(delivery.id, delivery);
    }
  }

  /**
   * Cancel pending retry for a delivery
   */
  cancelRetry(deliveryId: string): void {
    const timeout = this.pendingRetries.get(deliveryId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingRetries.delete(deliveryId);
    }
  }

  /**
   * Manually retry a failed delivery
   */
  async retryDelivery(
    deliveryId: string,
    webhookSecret?: string
  ): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return false;

    // Reset attempts for manual retry
    delivery.attempts = 0;
    delivery.status = 'pending';
    
    return this.attemptDelivery(deliveryId, webhookSecret);
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get delivery by ID
   */
  getDelivery(deliveryId: string): WebhookDelivery | undefined {
    return this.deliveries.get(deliveryId);
  }

  /**
   * Get deliveries for a partner
   */
  getDeliveriesForPartner(
    partnerId: string,
    options?: {
      status?: WebhookDeliveryStatus;
      limit?: number;
      startTime?: number;
      endTime?: number;
    }
  ): WebhookDelivery[] {
    let deliveries = Array.from(this.deliveries.values())
      .filter(d => d.partnerId === partnerId);

    if (options?.status) {
      deliveries = deliveries.filter(d => d.status === options.status);
    }

    if (options?.startTime) {
      deliveries = deliveries.filter(d => d.createdAt >= options.startTime!);
    }

    if (options?.endTime) {
      deliveries = deliveries.filter(d => d.createdAt <= options.endTime!);
    }

    // Sort by created time descending
    deliveries.sort((a, b) => b.createdAt - a.createdAt);

    if (options?.limit) {
      deliveries = deliveries.slice(0, options.limit);
    }

    return deliveries;
  }

  /**
   * Get pending deliveries
   */
  getPendingDeliveries(): WebhookDelivery[] {
    return Array.from(this.deliveries.values())
      .filter(d => d.status === 'pending' || d.status === 'retrying');
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  /**
   * Get webhook metrics for a partner
   * @requirements 21.7 - Display webhook delivery status
   */
  getMetrics(
    partnerId: string,
    startTime?: number,
    endTime?: number
  ): WebhookMetrics {
    const now = Date.now();
    const start = startTime || now - 24 * 60 * 60 * 1000;
    const end = endTime || now;

    const deliveries = Array.from(this.deliveries.values())
      .filter(d => 
        d.partnerId === partnerId &&
        d.createdAt >= start &&
        d.createdAt <= end
      );

    const byEventType: Record<WebhookEventType, number> = {} as Record<WebhookEventType, number>;
    let totalDeliveryTime = 0;
    let deliveredCount = 0;

    for (const delivery of deliveries) {
      if (delivery.event) {
        byEventType[delivery.event.type] = (byEventType[delivery.event.type] || 0) + 1;
      }
      
      if (delivery.status === 'delivered' && delivery.completedAt) {
        totalDeliveryTime += delivery.completedAt - delivery.createdAt;
        deliveredCount++;
      }
    }

    return {
      partnerId,
      period: { start, end },
      totalEvents: deliveries.length,
      delivered: deliveries.filter(d => d.status === 'delivered').length,
      failed: deliveries.filter(d => d.status === 'failed').length,
      pending: deliveries.filter(d => d.status === 'pending' || d.status === 'retrying').length,
      averageDeliveryTimeMs: deliveredCount > 0
        ? Math.round(totalDeliveryTime / deliveredCount)
        : 0,
      byEventType,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Clear all data (for testing)
   */
  clearAll(): void {
    // Cancel all pending retries
    for (const timeout of this.pendingRetries.values()) {
      clearTimeout(timeout);
    }
    this.pendingRetries.clear();
    this.deliveries.clear();
  }

  /**
   * Get all deliveries (for testing)
   */
  getAllDeliveries(): WebhookDelivery[] {
    return Array.from(this.deliveries.values());
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a WebhookService instance
 */
export function createWebhookService(
  config: WebhookServiceConfig = {}
): WebhookService {
  return new WebhookService(config);
}

// Singleton instance
let webhookServiceInstance: WebhookService | null = null;

/**
 * Get the singleton WebhookService instance
 */
export function getWebhookService(): WebhookService {
  if (!webhookServiceInstance) {
    webhookServiceInstance = createWebhookService();
  }
  return webhookServiceInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetWebhookService(): void {
  if (webhookServiceInstance) {
    webhookServiceInstance.clearAll();
  }
  webhookServiceInstance = null;
}

export default WebhookService;
