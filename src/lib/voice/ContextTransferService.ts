/**
 * Context Transfer Service Implementation
 * 
 * Handles the transfer of conversation context from voice calls to messaging channels
 * (WhatsApp/SMS) when fallback is triggered due to low ASR confidence.
 * 
 * @module voice/ContextTransferService
 * @requirements 18.4 - Transfer conversation context to the new channel
 */

import type {
  MessageChannel,
  LanguagePreference,
} from "./types";
import type { ConversationContext, FallbackEvent } from "./FallbackService";

// ============================================================================
// Types
// ============================================================================

/**
 * Order state that can be transferred across channels
 */
export interface TransferableOrderState {
  /** Partial order items collected during the call */
  items: Array<{
    name: string;
    quantity: number;
    price?: number;
    modifiers?: Array<{ name: string; price: number }>;
  }>;
  /** Customer name if collected */
  customerName?: string;
  /** Customer phone number */
  customerPhone: string;
  /** Delivery address if collected */
  deliveryAddress?: string;
  /** Special instructions if collected */
  specialInstructions?: string;
  /** Restaurant ID */
  restaurantId?: string;
  /** Branch ID */
  branchId?: string;
  /** Estimated total amount */
  estimatedTotal?: number;
}

/**
 * Context transfer request
 */
export interface ContextTransferRequest {
  /** Call ID being transferred from */
  callId: string;
  /** Customer phone number */
  phoneNumber: string;
  /** Target messaging channel */
  targetChannel: MessageChannel;
  /** Conversation context from the call */
  conversationContext: ConversationContext;
  /** Language detected during the call */
  languageDetected?: LanguagePreference;
  /** Restaurant ID for context */
  restaurantId?: string;
  /** Branch ID for context */
  branchId?: string;
}

/**
 * Context transfer result
 */
export interface ContextTransferResult {
  /** Whether the transfer was successful */
  success: boolean;
  /** Conversation ID in the new channel */
  conversationId?: string;
  /** Message ID of the initial message sent */
  messageId?: string;
  /** Error message if transfer failed */
  error?: string;
  /** The channel used for transfer */
  channel: MessageChannel;
  /** Timestamp of the transfer */
  timestamp: number;
}

/**
 * Stored context for a transferred conversation
 */
export interface StoredConversationContext {
  /** Unique context ID */
  contextId: string;
  /** Original call ID */
  callId: string;
  /** Conversation ID in the messaging channel */
  conversationId: string;
  /** Customer phone number */
  phoneNumber: string;
  /** Target channel */
  channel: MessageChannel;
  /** Transferable order state */
  orderState: TransferableOrderState;
  /** Language preference */
  languagePreference?: LanguagePreference;
  /** Restaurant ID */
  restaurantId?: string;
  /** Branch ID */
  branchId?: string;
  /** When the context was created */
  createdAt: number;
  /** When the context expires (for cleanup) */
  expiresAt: number;
  /** Whether the order has been completed */
  isCompleted: boolean;
}

/**
 * Configuration for the ContextTransferService
 */
export interface ContextTransferConfig {
  /** How long to keep transferred context (in milliseconds) */
  contextExpirationMs: number;
  /** Whether to include order summary in initial message */
  includeOrderSummary: boolean;
  /** Default language for messages */
  defaultLanguage: LanguagePreference;
}

/**
 * Service configuration functions
 */
export interface ContextTransferServiceConfig {
  /** Configuration options */
  config?: Partial<ContextTransferConfig>;
  /** Function to send WhatsApp message */
  sendWhatsAppMessageFn?: (
    phoneNumber: string,
    message: string,
    language?: LanguagePreference
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  /** Function to send SMS message */
  sendSMSMessageFn?: (
    phoneNumber: string,
    message: string
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  /** Function to store context in database */
  storeContextFn?: (context: StoredConversationContext) => Promise<void>;
  /** Function to retrieve context from database */
  getContextFn?: (conversationId: string) => Promise<StoredConversationContext | null>;
  /** Function to update context in database */
  updateContextFn?: (contextId: string, updates: Partial<StoredConversationContext>) => Promise<void>;
  /** Function to log transfer events */
  logTransferEventFn?: (event: ContextTransferEvent) => Promise<void>;
}

/**
 * Context transfer event for analytics
 */
export interface ContextTransferEvent {
  /** Event ID */
  eventId: string;
  /** Call ID */
  callId: string;
  /** Conversation ID in new channel */
  conversationId?: string;
  /** Phone number */
  phoneNumber: string;
  /** Target channel */
  channel: MessageChannel;
  /** Whether transfer was successful */
  success: boolean;
  /** Number of items transferred */
  itemCount: number;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: number;
  /** Restaurant ID */
  restaurantId?: string;
  /** Branch ID */
  branchId?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configuration
 */
export const DEFAULT_CONTEXT_TRANSFER_CONFIG: ContextTransferConfig = {
  contextExpirationMs: 24 * 60 * 60 * 1000, // 24 hours
  includeOrderSummary: true,
  defaultLanguage: "english",
};

/**
 * Message templates for different languages
 */
const TRANSFER_MESSAGE_TEMPLATES: Record<LanguagePreference, {
  greeting: string;
  orderSummary: string;
  continuePrompt: string;
  noItems: string;
}> = {
  english: {
    greeting: "Hello! We noticed you were having trouble with our voice ordering system.",
    orderSummary: "Here's what we have so far from your order:",
    continuePrompt: "Please reply to continue your order or type 'START OVER' to begin fresh.",
    noItems: "You can start your order by telling us what you'd like.",
  },
  nigerian_english: {
    greeting: "Hello! We noticed you were having trouble with our voice ordering system.",
    orderSummary: "Here's what we have so far from your order:",
    continuePrompt: "Please reply to continue your order or type 'START OVER' to begin fresh.",
    noItems: "You can start your order by telling us what you'd like.",
  },
  pidgin: {
    greeting: "How far! We see say the voice ordering no dey work well for you.",
    orderSummary: "Na wetin we don get from your order so far:",
    continuePrompt: "Reply make we continue your order or type 'START OVER' to begin again.",
    noItems: "You fit start your order by telling us wetin you wan chop.",
  },
  spanish: {
    greeting: "¡Hola! Notamos que tuvo problemas con nuestro sistema de pedidos por voz.",
    orderSummary: "Esto es lo que tenemos hasta ahora de su pedido:",
    continuePrompt: "Por favor responda para continuar su pedido o escriba 'EMPEZAR DE NUEVO'.",
    noItems: "Puede comenzar su pedido diciéndonos qué le gustaría.",
  },
  french: {
    greeting: "Bonjour! Nous avons remarqué que vous avez eu des difficultés avec notre système de commande vocale.",
    orderSummary: "Voici ce que nous avons jusqu'à présent de votre commande:",
    continuePrompt: "Veuillez répondre pour continuer votre commande ou tapez 'RECOMMENCER'.",
    noItems: "Vous pouvez commencer votre commande en nous disant ce que vous souhaitez.",
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique context ID
 */
function generateContextId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `CTX_${timestamp}_${random}`.toUpperCase();
}

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `TRF_${timestamp}_${random}`.toUpperCase();
}

/**
 * Generate a unique conversation ID
 */
function generateConversationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `CONV_${timestamp}_${random}`.toUpperCase();
}

/**
 * Format currency in Naira
 */
function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Build order summary message from items
 */
function buildOrderSummary(
  items: TransferableOrderState["items"],
  language: LanguagePreference
): string {
  if (items.length === 0) {
    return "";
  }

  const itemLines = items.map((item) => {
    let line = `• ${item.quantity}x ${item.name}`;
    if (item.price) {
      line += ` - ${formatNaira(item.price * item.quantity)}`;
    }
    if (item.modifiers && item.modifiers.length > 0) {
      const modifierNames = item.modifiers.map((m) => m.name).join(", ");
      line += ` (${modifierNames})`;
    }
    return line;
  });

  return itemLines.join("\n");
}

/**
 * Build the initial transfer message
 */
function buildTransferMessage(
  orderState: TransferableOrderState,
  language: LanguagePreference
): string {
  const templates = TRANSFER_MESSAGE_TEMPLATES[language] || TRANSFER_MESSAGE_TEMPLATES.english;
  const parts: string[] = [];

  // Greeting
  parts.push(templates.greeting);
  parts.push("");

  // Order summary if items exist
  if (orderState.items.length > 0) {
    parts.push(templates.orderSummary);
    parts.push(buildOrderSummary(orderState.items, language));
    parts.push("");

    // Show estimated total if available
    if (orderState.estimatedTotal) {
      parts.push(`Total: ${formatNaira(orderState.estimatedTotal)}`);
      parts.push("");
    }
  } else {
    parts.push(templates.noItems);
    parts.push("");
  }

  // Continue prompt
  parts.push(templates.continuePrompt);

  return parts.join("\n");
}

/**
 * Convert ConversationContext to TransferableOrderState
 */
function contextToOrderState(
  context: ConversationContext,
  phoneNumber: string,
  restaurantId?: string,
  branchId?: string
): TransferableOrderState {
  const items = (context.partialOrderItems || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price,
  }));

  // Calculate estimated total
  const estimatedTotal = items.reduce((sum, item) => {
    return sum + (item.price || 0) * item.quantity;
  }, 0);

  return {
    items,
    customerName: context.customerName,
    customerPhone: phoneNumber,
    deliveryAddress: context.deliveryAddress,
    specialInstructions: context.specialInstructions,
    restaurantId,
    branchId,
    estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
  };
}

// ============================================================================
// ContextTransferService Class
// ============================================================================

/**
 * Context Transfer Service
 * 
 * Manages the transfer of conversation context from voice calls to messaging
 * channels when fallback is triggered. Maintains order state across channels
 * and provides a seamless transition for customers.
 * 
 * @requirements 18.4 - Transfer conversation context to the new channel
 * 
 * @example
 * ```typescript
 * const contextTransferService = createContextTransferService({
 *   sendWhatsAppMessageFn: async (phone, message) => {
 *     return await whatsappClient.sendTextMessage(phone, message);
 *   },
 *   storeContextFn: async (context) => {
 *     await db.conversationContexts.insert(context);
 *   },
 * });
 * 
 * // Transfer context when fallback is triggered
 * const result = await contextTransferService.transferContext({
 *   callId: 'call-123',
 *   phoneNumber: '+2348012345678',
 *   targetChannel: 'whatsapp',
 *   conversationContext: {
 *     partialOrderItems: [{ name: 'Jollof Rice', quantity: 2 }],
 *     customerName: 'John',
 *   },
 * });
 * ```
 */
export class ContextTransferService {
  private config: ContextTransferConfig;
  private sendWhatsAppMessageFn?: ContextTransferServiceConfig["sendWhatsAppMessageFn"];
  private sendSMSMessageFn?: ContextTransferServiceConfig["sendSMSMessageFn"];
  private storeContextFn?: ContextTransferServiceConfig["storeContextFn"];
  private getContextFn?: ContextTransferServiceConfig["getContextFn"];
  private updateContextFn?: ContextTransferServiceConfig["updateContextFn"];
  private logTransferEventFn?: ContextTransferServiceConfig["logTransferEventFn"];

  // In-memory storage for contexts (for testing/development)
  private storedContexts: Map<string, StoredConversationContext> = new Map();
  
  // In-memory storage for transfer events (for metrics)
  private transferEvents: ContextTransferEvent[] = [];

  constructor(serviceConfig: ContextTransferServiceConfig = {}) {
    this.config = {
      ...DEFAULT_CONTEXT_TRANSFER_CONFIG,
      ...serviceConfig.config,
    };

    this.sendWhatsAppMessageFn = serviceConfig.sendWhatsAppMessageFn;
    this.sendSMSMessageFn = serviceConfig.sendSMSMessageFn;
    this.storeContextFn = serviceConfig.storeContextFn;
    this.getContextFn = serviceConfig.getContextFn;
    this.updateContextFn = serviceConfig.updateContextFn;
    this.logTransferEventFn = serviceConfig.logTransferEventFn;
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Transfer conversation context to a messaging channel
   * 
   * @param request - The context transfer request
   * @returns Promise resolving to the transfer result
   * 
   * @requirements 18.4 - Transfer conversation context to the new channel
   */
  async transferContext(request: ContextTransferRequest): Promise<ContextTransferResult> {
    const {
      callId,
      phoneNumber,
      targetChannel,
      conversationContext,
      languageDetected,
      restaurantId,
      branchId,
    } = request;

    const timestamp = Date.now();
    const conversationId = generateConversationId();
    const contextId = generateContextId();
    const eventId = generateEventId();

    // Convert context to transferable order state
    const orderState = contextToOrderState(
      conversationContext,
      phoneNumber,
      restaurantId,
      branchId
    );

    // Determine language for messages
    const language = languageDetected || this.config.defaultLanguage;

    // Build the transfer message
    const message = buildTransferMessage(orderState, language);

    // Send message to the target channel
    let sendResult: { success: boolean; messageId?: string; error?: string };

    if (targetChannel === "whatsapp") {
      sendResult = await this.sendWhatsAppMessage(phoneNumber, message, language);
    } else {
      sendResult = await this.sendSMSMessage(phoneNumber, message);
    }

    // Create stored context
    const storedContext: StoredConversationContext = {
      contextId,
      callId,
      conversationId,
      phoneNumber,
      channel: targetChannel,
      orderState,
      languagePreference: language,
      restaurantId,
      branchId,
      createdAt: timestamp,
      expiresAt: timestamp + this.config.contextExpirationMs,
      isCompleted: false,
    };

    // Store context if send was successful
    if (sendResult.success) {
      await this.storeContext(storedContext);
    }

    // Log transfer event
    const transferEvent: ContextTransferEvent = {
      eventId,
      callId,
      conversationId: sendResult.success ? conversationId : undefined,
      phoneNumber,
      channel: targetChannel,
      success: sendResult.success,
      itemCount: orderState.items.length,
      error: sendResult.error,
      timestamp,
      restaurantId,
      branchId,
    };

    await this.logTransferEvent(transferEvent);

    // Return result
    return {
      success: sendResult.success,
      conversationId: sendResult.success ? conversationId : undefined,
      messageId: sendResult.messageId,
      error: sendResult.error,
      channel: targetChannel,
      timestamp,
    };
  }

  /**
   * Get stored context for a conversation
   * 
   * @param conversationId - The conversation ID
   * @returns The stored context or null if not found
   */
  async getStoredContext(conversationId: string): Promise<StoredConversationContext | null> {
    // Try database first
    if (this.getContextFn) {
      const context = await this.getContextFn(conversationId);
      if (context) {
        return context;
      }
    }

    // Fall back to in-memory storage
    return this.storedContexts.get(conversationId) || null;
  }

  /**
   * Update order state for a conversation
   * 
   * @param conversationId - The conversation ID
   * @param updates - Updates to apply to the order state
   */
  async updateOrderState(
    conversationId: string,
    updates: Partial<TransferableOrderState>
  ): Promise<void> {
    const context = await this.getStoredContext(conversationId);
    if (!context) {
      throw new Error(`Context not found for conversation: ${conversationId}`);
    }

    const updatedOrderState: TransferableOrderState = {
      ...context.orderState,
      ...updates,
    };

    // Update in database
    if (this.updateContextFn) {
      await this.updateContextFn(context.contextId, {
        orderState: updatedOrderState,
      });
    }

    // Update in-memory storage
    this.storedContexts.set(conversationId, {
      ...context,
      orderState: updatedOrderState,
    });
  }

  /**
   * Mark a conversation as completed
   * 
   * @param conversationId - The conversation ID
   */
  async markCompleted(conversationId: string): Promise<void> {
    const context = await this.getStoredContext(conversationId);
    if (!context) {
      return;
    }

    // Update in database
    if (this.updateContextFn) {
      await this.updateContextFn(context.contextId, {
        isCompleted: true,
      });
    }

    // Update in-memory storage
    this.storedContexts.set(conversationId, {
      ...context,
      isCompleted: true,
    });
  }

  /**
   * Add items to an existing conversation's order
   * 
   * @param conversationId - The conversation ID
   * @param items - Items to add
   */
  async addItems(
    conversationId: string,
    items: TransferableOrderState["items"]
  ): Promise<void> {
    const context = await this.getStoredContext(conversationId);
    if (!context) {
      throw new Error(`Context not found for conversation: ${conversationId}`);
    }

    const updatedItems = [...context.orderState.items, ...items];
    const estimatedTotal = updatedItems.reduce((sum, item) => {
      return sum + (item.price || 0) * item.quantity;
    }, 0);

    await this.updateOrderState(conversationId, {
      items: updatedItems,
      estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
    });
  }

  // ============================================================================
  // Channel-Specific Methods
  // ============================================================================

  /**
   * Send WhatsApp message
   */
  private async sendWhatsAppMessage(
    phoneNumber: string,
    message: string,
    language?: LanguagePreference
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.sendWhatsAppMessageFn) {
      try {
        return await this.sendWhatsAppMessageFn(phoneNumber, message, language);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "WhatsApp send failed",
        };
      }
    }

    // Default implementation (mock)
    return {
      success: true,
      messageId: `WA_${Date.now().toString(36)}`,
    };
  }

  /**
   * Send SMS message
   */
  private async sendSMSMessage(
    phoneNumber: string,
    message: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.sendSMSMessageFn) {
      try {
        return await this.sendSMSMessageFn(phoneNumber, message);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "SMS send failed",
        };
      }
    }

    // Default implementation (mock)
    return {
      success: true,
      messageId: `SMS_${Date.now().toString(36)}`,
    };
  }

  // ============================================================================
  // Storage Methods
  // ============================================================================

  /**
   * Store context
   */
  private async storeContext(context: StoredConversationContext): Promise<void> {
    // Store in database
    if (this.storeContextFn) {
      try {
        await this.storeContextFn(context);
      } catch (error) {
        // Silently handle storage failures
      }
    }

    // Store in memory
    this.storedContexts.set(context.conversationId, context);
  }

  /**
   * Log transfer event
   */
  private async logTransferEvent(event: ContextTransferEvent): Promise<void> {
    // Store in memory for metrics
    this.transferEvents.push(event);

    // Log to database
    if (this.logTransferEventFn) {
      try {
        await this.logTransferEventFn(event);
      } catch (error) {
        // Silently handle logging failures
      }
    }
  }

  // ============================================================================
  // Metrics Methods
  // ============================================================================

  /**
   * Get transfer metrics for a time period
   */
  getTransferMetrics(
    startTime?: number,
    endTime?: number,
    branchId?: string
  ): {
    totalTransfers: number;
    successfulTransfers: number;
    failedTransfers: number;
    successRate: number;
    averageItemCount: number;
    byChannel: Record<MessageChannel, { count: number; successRate: number }>;
  } {
    const now = Date.now();
    const periodStart = startTime || now - 24 * 60 * 60 * 1000;
    const periodEnd = endTime || now;

    let filteredEvents = this.transferEvents.filter(
      (event) => event.timestamp >= periodStart && event.timestamp <= periodEnd
    );

    if (branchId) {
      filteredEvents = filteredEvents.filter((event) => event.branchId === branchId);
    }

    const totalTransfers = filteredEvents.length;
    const successfulTransfers = filteredEvents.filter((e) => e.success).length;
    const failedTransfers = totalTransfers - successfulTransfers;

    const whatsappEvents = filteredEvents.filter((e) => e.channel === "whatsapp");
    const smsEvents = filteredEvents.filter((e) => e.channel === "sms");

    const averageItemCount =
      totalTransfers > 0
        ? filteredEvents.reduce((sum, e) => sum + e.itemCount, 0) / totalTransfers
        : 0;

    return {
      totalTransfers,
      successfulTransfers,
      failedTransfers,
      successRate: totalTransfers > 0 ? successfulTransfers / totalTransfers : 0,
      averageItemCount,
      byChannel: {
        whatsapp: {
          count: whatsappEvents.length,
          successRate:
            whatsappEvents.length > 0
              ? whatsappEvents.filter((e) => e.success).length / whatsappEvents.length
              : 0,
        },
        sms: {
          count: smsEvents.length,
          successRate:
            smsEvents.length > 0
              ? smsEvents.filter((e) => e.success).length / smsEvents.length
              : 0,
        },
      },
    };
  }

  /**
   * Get all transfer events (for testing/debugging)
   */
  getAllTransferEvents(): ContextTransferEvent[] {
    return [...this.transferEvents];
  }

  /**
   * Get all stored contexts (for testing/debugging)
   */
  getAllStoredContexts(): StoredConversationContext[] {
    return Array.from(this.storedContexts.values());
  }

  /**
   * Clear all data (for testing)
   */
  clearAll(): void {
    this.storedContexts.clear();
    this.transferEvents = [];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a ContextTransferService instance
 * 
 * @param config - Optional configuration for the service
 * @returns ContextTransferService instance
 */
export function createContextTransferService(
  config: ContextTransferServiceConfig = {}
): ContextTransferService {
  return new ContextTransferService(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default ContextTransferService;
