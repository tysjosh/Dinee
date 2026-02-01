/**
 * Fallback Service Implementation
 * 
 * Implements confidence-based fallback from voice to messaging channels (WhatsApp/SMS)
 * when ASR confidence falls below the configured threshold.
 * 
 * @module voice/FallbackService
 * @requirements 18.1 - Trigger fallback when ASR confidence falls below configurable threshold (default 60%)
 * @requirements 18.2 - Offer to continue via WhatsApp text ordering
 * @requirements 18.3 - Offer to continue via SMS if WhatsApp is unavailable
 */

import type {
  FallbackResult,
  MessageChannel,
  LanguagePreference,
} from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the FallbackService
 */
export interface FallbackConfig {
  /**
   * Confidence threshold below which fallback is triggered (0-1)
   * @requirements 18.1 - Default threshold is 60%
   * @default 0.6
   */
  confidenceThreshold: number;
  
  /**
   * Whether fallback functionality is enabled
   * @default true
   */
  fallbackEnabled: boolean;
  
  /**
   * Preferred channel for fallback communication
   * @requirements 18.2 - WhatsApp is the primary fallback channel
   * @default 'whatsapp'
   */
  preferredFallbackChannel: MessageChannel;
  
  /**
   * Whether to automatically fall back to SMS if WhatsApp is unavailable
   * @requirements 18.3 - Fall back to SMS if WhatsApp is unavailable
   * @default true
   */
  enableSMSFallback: boolean;
}

/**
 * Default fallback configuration
 * @requirements 18.1 - Default threshold is 60%
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  confidenceThreshold: 0.6, // Requirement 18.1: 60% default threshold
  fallbackEnabled: true,
  preferredFallbackChannel: "whatsapp",
  enableSMSFallback: true,
};

/**
 * Fallback event for analytics tracking
 * @requirements 18.5 - Log fallback events with original confidence score and selected fallback channel
 */
export interface FallbackEvent {
  /** Unique event ID */
  eventId: string;
  /** Call ID that triggered the fallback */
  callId: string;
  /** Customer phone number */
  phoneNumber: string;
  /** Original ASR confidence score that triggered fallback */
  originalConfidence: number;
  /** Configured confidence threshold */
  confidenceThreshold: number;
  /** Channel selected for fallback */
  selectedChannel: MessageChannel;
  /** Whether fallback was successful */
  success: boolean;
  /** Conversation ID in the fallback channel */
  conversationId?: string;
  /** Error message if fallback failed */
  error?: string;
  /** Language detected during the call */
  languageDetected?: LanguagePreference;
  /** Timestamp of the fallback event */
  timestamp: number;
  /** Branch ID for analytics */
  branchId?: string;
  /** Restaurant ID for analytics */
  restaurantId?: string;
}

/**
 * Fallback initiation request
 */
export interface FallbackRequest {
  /** Call ID */
  callId: string;
  /** Customer phone number */
  phoneNumber: string;
  /** Original ASR confidence score */
  confidence: number;
  /** Language detected during the call */
  languageDetected?: LanguagePreference;
  /** Branch ID for context */
  branchId?: string;
  /** Restaurant ID for context */
  restaurantId?: string;
  /** Conversation context to transfer */
  conversationContext?: ConversationContext;
}

/**
 * Conversation context for transfer to messaging channel
 * @requirements 18.4 - Transfer conversation context to the new channel
 */
export interface ConversationContext {
  /** Partial order items collected during the call */
  partialOrderItems?: Array<{
    name: string;
    quantity: number;
    price?: number;
  }>;
  /** Customer name if collected */
  customerName?: string;
  /** Delivery address if collected */
  deliveryAddress?: string;
  /** Special instructions if collected */
  specialInstructions?: string;
  /** Last transcript from the call */
  lastTranscript?: string;
  /** Call duration in seconds */
  callDurationSeconds?: number;
}

/**
 * Channel availability status
 */
export interface ChannelAvailability {
  /** Whether WhatsApp is available for the phone number */
  whatsappAvailable: boolean;
  /** Whether SMS is available for the phone number */
  smsAvailable: boolean;
  /** Reason if WhatsApp is unavailable */
  whatsappUnavailableReason?: string;
}

/**
 * Fallback service configuration functions
 */
export interface FallbackServiceConfig {
  /** Fallback configuration */
  config?: Partial<FallbackConfig>;
  
  /** Function to check channel availability for a phone number */
  checkChannelAvailabilityFn?: (phoneNumber: string) => Promise<ChannelAvailability>;
  
  /** Function to send WhatsApp fallback message */
  sendWhatsAppFallbackFn?: (
    phoneNumber: string,
    context: ConversationContext | undefined
  ) => Promise<{ success: boolean; conversationId?: string; error?: string }>;
  
  /** Function to send SMS fallback message */
  sendSMSFallbackFn?: (
    phoneNumber: string,
    context: ConversationContext | undefined
  ) => Promise<{ success: boolean; conversationId?: string; error?: string }>;
  
  /** Function to log fallback events for analytics */
  logFallbackEventFn?: (event: FallbackEvent) => Promise<void>;
  
  /** Function to check customer opt-in status */
  checkOptInStatusFn?: (phoneNumber: string) => Promise<{
    whatsappOptIn: boolean;
    smsOptIn: boolean;
  }>;
}

/**
 * Fallback metrics for dashboard display
 * @requirements 18.6 - Display fallback rate metrics in branch dashboard
 */
export interface FallbackMetrics {
  /** Total number of fallback events */
  totalFallbacks: number;
  /** Number of successful fallbacks */
  successfulFallbacks: number;
  /** Number of failed fallbacks */
  failedFallbacks: number;
  /** Fallback rate (fallbacks / total calls) */
  fallbackRate: number;
  /** Breakdown by channel */
  byChannel: {
    whatsapp: { count: number; successRate: number };
    sms: { count: number; successRate: number };
  };
  /** Average confidence score that triggered fallback */
  averageTriggerConfidence: number;
  /** Time period for metrics */
  periodStart: number;
  periodEnd: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique event ID for fallback tracking
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `FB_${timestamp}_${random}`.toUpperCase();
}

/**
 * Generate a unique conversation ID for the fallback channel
 */
function generateConversationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `CONV_${timestamp}_${random}`.toUpperCase();
}

/**
 * Format phone number for messaging (ensure international format)
 */
function formatPhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phoneNumber.replace(/[^\d+]/g, "");
  
  // Handle Nigerian numbers
  if (cleaned.startsWith("0")) {
    // Convert 0xxx to +234xxx
    cleaned = "+234" + cleaned.substring(1);
  } else if (!cleaned.startsWith("+")) {
    // Assume Nigerian number if no country code
    cleaned = "+234" + cleaned;
  }
  
  return cleaned;
}

// ============================================================================
// FallbackService Class
// ============================================================================

/**
 * Fallback Service
 * 
 * Manages confidence-based fallback from voice to messaging channels.
 * When ASR confidence falls below the configured threshold, this service
 * initiates a fallback to WhatsApp (primary) or SMS (secondary).
 * 
 * @requirements 18.1 - Trigger fallback when ASR confidence falls below configurable threshold
 * @requirements 18.2 - Offer to continue via WhatsApp text ordering
 * @requirements 18.3 - Offer to continue via SMS if WhatsApp is unavailable
 * 
 * @example
 * ```typescript
 * const fallbackService = createFallbackService({
 *   config: {
 *     confidenceThreshold: 0.6,
 *     fallbackEnabled: true,
 *     preferredFallbackChannel: 'whatsapp',
 *   },
 *   logFallbackEventFn: async (event) => {
 *     await db.fallbackEvents.insert(event);
 *   },
 * });
 * 
 * // Check if fallback should be triggered
 * if (fallbackService.shouldTriggerFallback(0.45)) {
 *   const result = await fallbackService.initiateFallback({
 *     callId: 'call-123',
 *     phoneNumber: '+2348012345678',
 *     confidence: 0.45,
 *   });
 * }
 * ```
 */
export class FallbackService {
  private config: FallbackConfig;
  private checkChannelAvailabilityFn?: FallbackServiceConfig["checkChannelAvailabilityFn"];
  private sendWhatsAppFallbackFn?: FallbackServiceConfig["sendWhatsAppFallbackFn"];
  private sendSMSFallbackFn?: FallbackServiceConfig["sendSMSFallbackFn"];
  private logFallbackEventFn?: FallbackServiceConfig["logFallbackEventFn"];
  private checkOptInStatusFn?: FallbackServiceConfig["checkOptInStatusFn"];
  
  // In-memory storage for fallback events (for metrics calculation)
  private fallbackEvents: FallbackEvent[] = [];

  constructor(serviceConfig: FallbackServiceConfig = {}) {
    // Merge default config with provided config
    this.config = {
      ...DEFAULT_FALLBACK_CONFIG,
      ...serviceConfig.config,
    };

    // Store configuration functions
    this.checkChannelAvailabilityFn = serviceConfig.checkChannelAvailabilityFn;
    this.sendWhatsAppFallbackFn = serviceConfig.sendWhatsAppFallbackFn;
    this.sendSMSFallbackFn = serviceConfig.sendSMSFallbackFn;
    this.logFallbackEventFn = serviceConfig.logFallbackEventFn;
    this.checkOptInStatusFn = serviceConfig.checkOptInStatusFn;
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Check if fallback should be triggered based on confidence score
   * 
   * @param confidence - The ASR confidence score (0-1)
   * @returns Whether fallback should be triggered
   * 
   * @requirements 18.1 - Trigger fallback when ASR confidence falls below configurable threshold (default 60%)
   */
  shouldTriggerFallback(confidence: number): boolean {
    // If fallback is disabled, never trigger
    if (!this.config.fallbackEnabled) {
      return false;
    }

    // Validate confidence is in valid range
    if (confidence < 0 || confidence > 1) {
      console.warn(
        `[FallbackService] Invalid confidence score: ${confidence}. Expected value between 0 and 1.`
      );
      // Treat invalid confidence as low confidence
      return true;
    }

    // Requirement 18.1: Trigger fallback when confidence falls below threshold
    return confidence < this.config.confidenceThreshold;
  }

  /**
   * Initiate fallback to messaging channel
   * 
   * Attempts to initiate fallback to WhatsApp first (primary channel),
   * then falls back to SMS if WhatsApp is unavailable.
   * 
   * @param request - The fallback request with call and customer details
   * @returns Promise resolving to the fallback result
   * 
   * @requirements 18.2 - Offer to continue via WhatsApp text ordering
   * @requirements 18.3 - Offer to continue via SMS if WhatsApp is unavailable
   * @requirements 18.5 - Log fallback events with original confidence score and selected fallback channel
   */
  async initiateFallback(request: FallbackRequest): Promise<FallbackResult> {
    const {
      callId,
      phoneNumber,
      confidence,
      languageDetected,
      branchId,
      restaurantId,
      conversationContext,
    } = request;

    const formattedPhone = formatPhoneNumber(phoneNumber);
    const eventId = generateEventId();
    const timestamp = Date.now();

    // Check channel availability
    const availability = await this.getChannelAvailability(formattedPhone);

    // Check customer opt-in status
    const optInStatus = await this.getOptInStatus(formattedPhone);

    // Determine which channel to use
    // Requirement 18.2: WhatsApp is the primary fallback channel
    let selectedChannel: MessageChannel = this.config.preferredFallbackChannel;
    let fallbackResult: FallbackResult;

    // Try WhatsApp first if available and customer opted in
    if (
      selectedChannel === "whatsapp" &&
      availability.whatsappAvailable &&
      optInStatus.whatsappOptIn
    ) {
      fallbackResult = await this.initiateWhatsAppFallback(
        formattedPhone,
        conversationContext
      );

      if (fallbackResult.triggered) {
        // Log successful WhatsApp fallback
        await this.logFallbackEvent({
          eventId,
          callId,
          phoneNumber: formattedPhone,
          originalConfidence: confidence,
          confidenceThreshold: this.config.confidenceThreshold,
          selectedChannel: "whatsapp",
          success: true,
          conversationId: fallbackResult.conversationId,
          languageDetected,
          timestamp,
          branchId,
          restaurantId,
        });

        return fallbackResult;
      }
    }

    // Requirement 18.3: Fall back to SMS if WhatsApp is unavailable
    if (
      this.config.enableSMSFallback &&
      availability.smsAvailable &&
      optInStatus.smsOptIn
    ) {
      selectedChannel = "sms";
      fallbackResult = await this.initiateSMSFallback(
        formattedPhone,
        conversationContext
      );

      if (fallbackResult.triggered) {
        // Log successful SMS fallback
        await this.logFallbackEvent({
          eventId,
          callId,
          phoneNumber: formattedPhone,
          originalConfidence: confidence,
          confidenceThreshold: this.config.confidenceThreshold,
          selectedChannel: "sms",
          success: true,
          conversationId: fallbackResult.conversationId,
          languageDetected,
          timestamp,
          branchId,
          restaurantId,
        });

        return fallbackResult;
      }
    }

    // No channel available or all attempts failed
    const errorMessage = this.getFailureReason(availability, optInStatus);
    
    // Log failed fallback
    await this.logFallbackEvent({
      eventId,
      callId,
      phoneNumber: formattedPhone,
      originalConfidence: confidence,
      confidenceThreshold: this.config.confidenceThreshold,
      selectedChannel,
      success: false,
      error: errorMessage,
      languageDetected,
      timestamp,
      branchId,
      restaurantId,
    });

    return {
      triggered: false,
      channel: selectedChannel,
      error: errorMessage,
    };
  }

  // ============================================================================
  // Channel-Specific Methods
  // ============================================================================

  /**
   * Initiate fallback via WhatsApp
   * @requirements 18.2 - Offer to continue via WhatsApp text ordering
   */
  private async initiateWhatsAppFallback(
    phoneNumber: string,
    context?: ConversationContext
  ): Promise<FallbackResult> {
    // Use provided function if available
    if (this.sendWhatsAppFallbackFn) {
      try {
        const result = await this.sendWhatsAppFallbackFn(phoneNumber, context);
        return {
          triggered: result.success,
          channel: "whatsapp",
          conversationId: result.conversationId,
          error: result.error,
        };
      } catch (error) {
        return {
          triggered: false,
          channel: "whatsapp",
          error: error instanceof Error ? error.message : "WhatsApp fallback failed",
        };
      }
    }

    // Default implementation: generate conversation ID
    const conversationId = generateConversationId();

    return {
      triggered: true,
      channel: "whatsapp",
      conversationId,
    };
  }

  /**
   * Initiate fallback via SMS
   * @requirements 18.3 - Offer to continue via SMS if WhatsApp is unavailable
   */
  private async initiateSMSFallback(
    phoneNumber: string,
    context?: ConversationContext
  ): Promise<FallbackResult> {
    // Use provided function if available
    if (this.sendSMSFallbackFn) {
      try {
        const result = await this.sendSMSFallbackFn(phoneNumber, context);
        return {
          triggered: result.success,
          channel: "sms",
          conversationId: result.conversationId,
          error: result.error,
        };
      } catch (error) {
        return {
          triggered: false,
          channel: "sms",
          error: error instanceof Error ? error.message : "SMS fallback failed",
        };
      }
    }

    // Default implementation: generate conversation ID
    const conversationId = generateConversationId();

    return {
      triggered: true,
      channel: "sms",
      conversationId,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get channel availability for a phone number
   */
  private async getChannelAvailability(phoneNumber: string): Promise<ChannelAvailability> {
    if (this.checkChannelAvailabilityFn) {
      try {
        return await this.checkChannelAvailabilityFn(phoneNumber);
      } catch (error) {
        // Fall through to default
      }
    }

    // Default: assume both channels are available
    return {
      whatsappAvailable: true,
      smsAvailable: true,
    };
  }

  /**
   * Get customer opt-in status
   */
  private async getOptInStatus(phoneNumber: string): Promise<{
    whatsappOptIn: boolean;
    smsOptIn: boolean;
  }> {
    if (this.checkOptInStatusFn) {
      try {
        return await this.checkOptInStatusFn(phoneNumber);
      } catch (error) {
        // Fall through to default
      }
    }

    // Default: assume opted in to both channels
    return {
      whatsappOptIn: true,
      smsOptIn: true,
    };
  }

  /**
   * Get failure reason based on availability and opt-in status
   */
  private getFailureReason(
    availability: ChannelAvailability,
    optInStatus: { whatsappOptIn: boolean; smsOptIn: boolean }
  ): string {
    const reasons: string[] = [];

    if (!availability.whatsappAvailable) {
      reasons.push(
        availability.whatsappUnavailableReason || "WhatsApp not available"
      );
    } else if (!optInStatus.whatsappOptIn) {
      reasons.push("Customer not opted in to WhatsApp");
    }

    if (!availability.smsAvailable) {
      reasons.push("SMS not available");
    } else if (!optInStatus.smsOptIn) {
      reasons.push("Customer not opted in to SMS");
    }

    return reasons.length > 0
      ? reasons.join("; ")
      : "No fallback channel available";
  }

  /**
   * Log a fallback event for analytics
   * @requirements 18.5 - Log fallback events with original confidence score and selected fallback channel
   */
  private async logFallbackEvent(event: FallbackEvent): Promise<void> {
    // Store in memory for metrics
    this.fallbackEvents.push(event);

    // Use provided logging function if available
    if (this.logFallbackEventFn) {
      try {
        await this.logFallbackEventFn(event);
      } catch (error) {
        // Silently handle logging failures
      }
    }
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Get the current fallback configuration
   */
  getConfig(): FallbackConfig {
    return { ...this.config };
  }

  /**
   * Update the fallback configuration
   */
  updateConfig(updates: Partial<FallbackConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  /**
   * Get the confidence threshold
   */
  getConfidenceThreshold(): number {
    return this.config.confidenceThreshold;
  }

  /**
   * Set the confidence threshold
   * @param threshold - New threshold value (0-1)
   */
  setConfidenceThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error(
        `Invalid confidence threshold: ${threshold}. Must be between 0 and 1.`
      );
    }
    this.config.confidenceThreshold = threshold;
  }

  /**
   * Check if fallback is enabled
   */
  isFallbackEnabled(): boolean {
    return this.config.fallbackEnabled;
  }

  /**
   * Enable or disable fallback
   */
  setFallbackEnabled(enabled: boolean): void {
    this.config.fallbackEnabled = enabled;
  }

  // ============================================================================
  // Metrics Methods
  // ============================================================================

  /**
   * Get fallback metrics for a time period
   * @requirements 18.6 - Display fallback rate metrics in branch dashboard
   */
  getMetrics(
    startTime?: number,
    endTime?: number,
    branchId?: string
  ): FallbackMetrics {
    const now = Date.now();
    const periodStart = startTime || now - 24 * 60 * 60 * 1000; // Default: last 24 hours
    const periodEnd = endTime || now;

    // Filter events by time period and optionally by branch
    let filteredEvents = this.fallbackEvents.filter(
      (event) => event.timestamp >= periodStart && event.timestamp <= periodEnd
    );

    if (branchId) {
      filteredEvents = filteredEvents.filter(
        (event) => event.branchId === branchId
      );
    }

    const totalFallbacks = filteredEvents.length;
    const successfulFallbacks = filteredEvents.filter((e) => e.success).length;
    const failedFallbacks = totalFallbacks - successfulFallbacks;

    // Calculate by channel
    const whatsappEvents = filteredEvents.filter(
      (e) => e.selectedChannel === "whatsapp"
    );
    const smsEvents = filteredEvents.filter((e) => e.selectedChannel === "sms");

    const whatsappSuccessful = whatsappEvents.filter((e) => e.success).length;
    const smsSuccessful = smsEvents.filter((e) => e.success).length;

    // Calculate average trigger confidence
    const averageTriggerConfidence =
      totalFallbacks > 0
        ? filteredEvents.reduce((sum, e) => sum + e.originalConfidence, 0) /
          totalFallbacks
        : 0;

    return {
      totalFallbacks,
      successfulFallbacks,
      failedFallbacks,
      fallbackRate: 0, // This would need total calls count from external source
      byChannel: {
        whatsapp: {
          count: whatsappEvents.length,
          successRate:
            whatsappEvents.length > 0
              ? whatsappSuccessful / whatsappEvents.length
              : 0,
        },
        sms: {
          count: smsEvents.length,
          successRate:
            smsEvents.length > 0 ? smsSuccessful / smsEvents.length : 0,
        },
      },
      averageTriggerConfidence,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get all fallback events (for testing/debugging)
   */
  getAllEvents(): FallbackEvent[] {
    return [...this.fallbackEvents];
  }

  /**
   * Get fallback events for a specific call
   */
  getEventsForCall(callId: string): FallbackEvent[] {
    return this.fallbackEvents.filter((event) => event.callId === callId);
  }

  /**
   * Get fallback events for a specific branch
   */
  getEventsForBranch(branchId: string): FallbackEvent[] {
    return this.fallbackEvents.filter((event) => event.branchId === branchId);
  }

  /**
   * Clear all events (for testing)
   */
  clearEvents(): void {
    this.fallbackEvents = [];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a FallbackService instance
 * 
 * @param config - Optional configuration for the fallback service
 * @returns FallbackService instance
 * 
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const fallbackService = createFallbackService();
 * 
 * // With custom configuration
 * const fallbackService = createFallbackService({
 *   config: {
 *     confidenceThreshold: 0.5,
 *     fallbackEnabled: true,
 *     preferredFallbackChannel: 'whatsapp',
 *     enableSMSFallback: true,
 *   },
 *   logFallbackEventFn: async (event) => {
 *     await db.fallbackEvents.insert(event);
 *   },
 * });
 * ```
 */
export function createFallbackService(
  config: FallbackServiceConfig = {}
): FallbackService {
  return new FallbackService(config);
}

/**
 * Create a FallbackService instance from environment variables
 * 
 * Expected environment variables:
 * - FALLBACK_CONFIDENCE_THRESHOLD (optional, default 0.6)
 * - FALLBACK_ENABLED (optional, default true)
 * - FALLBACK_PREFERRED_CHANNEL (optional, default 'whatsapp')
 * - FALLBACK_SMS_ENABLED (optional, default true)
 */
export function createFallbackServiceFromEnv(
  overrides: Partial<FallbackServiceConfig> = {}
): FallbackService {
  const config: Partial<FallbackConfig> = {
    confidenceThreshold: process.env.FALLBACK_CONFIDENCE_THRESHOLD
      ? parseFloat(process.env.FALLBACK_CONFIDENCE_THRESHOLD)
      : DEFAULT_FALLBACK_CONFIG.confidenceThreshold,
    fallbackEnabled: process.env.FALLBACK_ENABLED !== "false",
    preferredFallbackChannel:
      (process.env.FALLBACK_PREFERRED_CHANNEL as MessageChannel) || "whatsapp",
    enableSMSFallback: process.env.FALLBACK_SMS_ENABLED !== "false",
    ...overrides.config,
  };

  return new FallbackService({
    ...overrides,
    config,
  });
}

// ============================================================================
// Integration with ContextTransferService
// ============================================================================

import {
  ContextTransferService,
  createContextTransferService,
  type ContextTransferRequest,
  type ContextTransferResult,
  type TransferableOrderState,
} from "./ContextTransferService";

/**
 * Extended FallbackService with context transfer capabilities
 * 
 * This class extends the base FallbackService to include conversation
 * context transfer functionality when fallback is triggered.
 * 
 * @requirements 18.4 - Transfer conversation context to the new channel
 */
export class FallbackServiceWithContextTransfer extends FallbackService {
  private contextTransferService: ContextTransferService;

  constructor(
    fallbackConfig: FallbackServiceConfig = {},
    contextTransferService?: ContextTransferService
  ) {
    super(fallbackConfig);
    this.contextTransferService = contextTransferService || createContextTransferService();
  }

  /**
   * Initiate fallback with context transfer
   * 
   * This method extends the base initiateFallback to also transfer
   * the conversation context to the messaging channel.
   * 
   * @param request - The fallback request with conversation context
   * @returns Promise resolving to the fallback result with context transfer info
   * 
   * @requirements 18.4 - Transfer conversation context to the new channel
   */
  async initiateFallbackWithContext(
    request: FallbackRequest
  ): Promise<FallbackResult & { contextTransferred?: boolean }> {
    // First, initiate the basic fallback
    const fallbackResult = await this.initiateFallback(request);

    // If fallback was triggered and we have conversation context, transfer it
    if (
      fallbackResult.triggered &&
      fallbackResult.conversationId &&
      request.conversationContext
    ) {
      const transferRequest: ContextTransferRequest = {
        callId: request.callId,
        phoneNumber: request.phoneNumber,
        targetChannel: fallbackResult.channel,
        conversationContext: request.conversationContext,
        languageDetected: request.languageDetected,
        restaurantId: request.restaurantId,
        branchId: request.branchId,
      };

      const transferResult = await this.contextTransferService.transferContext(
        transferRequest
      );

      return {
        ...fallbackResult,
        conversationId: transferResult.conversationId || fallbackResult.conversationId,
        contextTransferred: transferResult.success,
      };
    }

    return {
      ...fallbackResult,
      contextTransferred: false,
    };
  }

  /**
   * Get the context transfer service for direct access
   */
  getContextTransferService(): ContextTransferService {
    return this.contextTransferService;
  }

  /**
   * Get stored context for a conversation
   */
  async getStoredContext(conversationId: string) {
    return this.contextTransferService.getStoredContext(conversationId);
  }

  /**
   * Update order state for a conversation
   */
  async updateOrderState(
    conversationId: string,
    updates: Partial<TransferableOrderState>
  ) {
    return this.contextTransferService.updateOrderState(conversationId, updates);
  }

  /**
   * Mark a conversation as completed
   */
  async markConversationCompleted(conversationId: string) {
    return this.contextTransferService.markCompleted(conversationId);
  }
}

/**
 * Create a FallbackServiceWithContextTransfer instance
 * 
 * @param fallbackConfig - Configuration for the fallback service
 * @param contextTransferService - Optional context transfer service instance
 * @returns FallbackServiceWithContextTransfer instance
 */
export function createFallbackServiceWithContextTransfer(
  fallbackConfig: FallbackServiceConfig = {},
  contextTransferService?: ContextTransferService
): FallbackServiceWithContextTransfer {
  return new FallbackServiceWithContextTransfer(fallbackConfig, contextTransferService);
}

// Re-export ContextTransferService types for convenience
export type {
  ContextTransferRequest,
  ContextTransferResult,
  TransferableOrderState,
};

// ============================================================================
// Default Export
// ============================================================================

export default FallbackService;
