/**
 * Messaging Service Implementation
 * 
 * Implements the MessagingService interface to provide WhatsApp Business API
 * and SMS messaging capabilities for the Nigerian market.
 * 
 * @module messaging/MessagingService
 * @requirements 11.4 - Use WhatsApp Business API message templates for order confirmation
 * @requirements 12.5 - Status messages use approved WhatsApp Business API templates
 */

import type { Order } from "@/types/global.d";
import type {
  MessageChannel,
  MessageStatus,
  MessageResult,
  MessagingService,
  OptInStatus,
  WhatsAppConfig,
  WhatsAppMessageRequest,
  WhatsAppMessageResponse,
  WhatsAppErrorResponse,
  WhatsAppTemplateComponent,
  SMSConfig,
  SMSMessageRequest,
  RetryConfig,
  TemplateName,
  TemplateRegistry,
  TemplateRegistryEntry,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** WhatsApp Business API base URL */
const WHATSAPP_API_BASE_URL = "https://graph.facebook.com";

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/** Default WhatsApp API version */
const DEFAULT_API_VERSION = "v18.0";

// ============================================================================
// Template Registry
// ============================================================================

/**
 * Pre-defined message templates for the application
 * These templates must be registered and approved in WhatsApp Business Manager
 */
const DEFAULT_TEMPLATE_REGISTRY: TemplateRegistry = {
  order_confirmation: {
    whatsappTemplateName: "order_confirmation_v1",
    smsTemplate: "Order #{{orderId}} confirmed! {{restaurantName}} - Items: {{items}}. Total: ₦{{totalAmount}}. Est. delivery: {{estimatedTime}}",
    requiredParameters: ["orderId", "restaurantName", "items", "totalAmount", "estimatedTime"],
    language: "en",
  },
  order_preparing: {
    whatsappTemplateName: "order_preparing_v1",
    smsTemplate: "Your order #{{orderId}} from {{restaurantName}} is now being prepared!",
    requiredParameters: ["orderId", "restaurantName"],
    language: "en",
  },
  order_dispatched: {
    whatsappTemplateName: "order_dispatched_v1",
    smsTemplate: "Your order #{{orderId}} is on the way! Rider: {{riderName}}. Est. arrival: {{estimatedTime}}",
    requiredParameters: ["orderId", "riderName", "estimatedTime"],
    language: "en",
  },
  order_delivered: {
    whatsappTemplateName: "order_delivered_v1",
    smsTemplate: "Your order #{{orderId}} has been delivered. Thank you for ordering from {{restaurantName}}!",
    requiredParameters: ["orderId", "restaurantName"],
    language: "en",
  },
  order_cancelled: {
    whatsappTemplateName: "order_cancelled_v1",
    smsTemplate: "Your order #{{orderId}} has been cancelled. Reason: {{cancellationReason}}. Contact {{restaurantName}} for assistance.",
    requiredParameters: ["orderId", "cancellationReason", "restaurantName"],
    language: "en",
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format phone number to international format for WhatsApp
 * Handles Nigerian phone numbers (starting with 0 or +234)
 */
export function formatPhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phoneNumber.replace(/[^\d+]/g, "");
  
  // Handle Nigerian numbers
  if (cleaned.startsWith("0")) {
    // Convert 0xxx to 234xxx
    cleaned = "234" + cleaned.substring(1);
  } else if (cleaned.startsWith("+234")) {
    // Remove the + prefix
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith("+")) {
    // Remove + for other international numbers
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

/**
 * Format currency amount in Naira
 */
export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Format order items for message display
 */
export function formatOrderItems(items: Order["items"]): string {
  return items
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(", ");
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `MSG_${timestamp}_${random}`.toUpperCase();
}

// ============================================================================
// WhatsApp Client Class
// ============================================================================

/**
 * WhatsApp Business API client for sending messages
 */
export class WhatsAppClient {
  private config: WhatsAppConfig;
  private retryConfig: RetryConfig;

  constructor(config: WhatsAppConfig, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
    this.retryConfig = retryConfig;
  }

  /**
   * Get the API endpoint URL
   */
  private getApiUrl(): string {
    return `${WHATSAPP_API_BASE_URL}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
  }

  /**
   * Send a template message via WhatsApp Business API
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string,
    components?: WhatsAppTemplateComponent[]
  ): Promise<MessageResult> {
    const formattedPhone = formatPhoneNumber(to);
    
    const request: WhatsAppMessageRequest = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formattedPhone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: language,
        },
        components,
      },
    };

    return this.sendWithRetry(request);
  }

  /**
   * Send a text message via WhatsApp Business API
   * Note: Text messages can only be sent within 24-hour customer service window
   */
  async sendTextMessage(to: string, body: string): Promise<MessageResult> {
    const formattedPhone = formatPhoneNumber(to);
    
    const request: WhatsAppMessageRequest = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formattedPhone,
      type: "text",
      text: {
        body,
        preview_url: false,
      },
    };

    return this.sendWithRetry(request);
  }

  /**
   * Send message with retry logic and exponential backoff
   * @requirements 11.5 - Retry up to 3 times with exponential backoff
   */
  private async sendWithRetry(request: WhatsAppMessageRequest): Promise<MessageResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await this.sendRequest(request);
        
        if (response.messages && response.messages.length > 0) {
          return {
            success: true,
            messageId: response.messages[0].id,
            channel: "whatsapp",
            status: "sent",
          };
        }
        
        lastError = "No message ID returned from WhatsApp API";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }
        
        // Wait before retrying (except on last attempt)
        if (attempt < this.retryConfig.maxRetries) {
          const delay = calculateBackoffDelay(attempt, this.retryConfig);
          await sleep(delay);
        }
      }
    }

    return {
      success: false,
      channel: "whatsapp",
      status: "failed",
      error: lastError,
    };
  }

  /**
   * Send HTTP request to WhatsApp Business API
   */
  private async sendRequest(request: WhatsAppMessageRequest): Promise<WhatsAppMessageResponse> {
    const response = await fetch(this.getApiUrl(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json() as WhatsAppErrorResponse;
      throw new Error(
        `WhatsApp API error: ${errorData.error?.message || response.statusText} (code: ${errorData.error?.code || response.status})`
      );
    }

    return response.json() as Promise<WhatsAppMessageResponse>;
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Don't retry on authentication, permission, or invalid parameter errors
      return (
        message.includes("authentication") ||
        message.includes("permission") ||
        message.includes("invalid") ||
        message.includes("code: 100") || // Invalid parameter
        message.includes("code: 190") || // Invalid access token
        message.includes("code: 200")    // Permission error
      );
    }
    return false;
  }
}

// ============================================================================
// SMS Client Class
// ============================================================================

/**
 * SMS client for sending fallback messages
 * Supports multiple Nigerian SMS providers
 */
export class SMSClient {
  private config: SMSConfig;

  constructor(config: SMSConfig) {
    this.config = config;
  }

  /**
   * Send an SMS message
   */
  async sendMessage(to: string, body: string): Promise<MessageResult> {
    const formattedPhone = formatPhoneNumber(to);
    
    const request: SMSMessageRequest = {
      to: formattedPhone,
      body,
      from: this.config.senderId,
    };

    try {
      // Route to appropriate provider
      switch (this.config.provider) {
        case "twilio":
          return await this.sendViaTwilio(request);
        case "termii":
          return await this.sendViaTermii(request);
        case "africas_talking":
          return await this.sendViaAfricasTalking(request);
        default:
          return {
            success: false,
            channel: "sms",
            status: "failed",
            error: `Unsupported SMS provider: ${this.config.provider}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        channel: "sms",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown SMS error",
      };
    }
  }

  /**
   * Send SMS via Twilio
   */
  private async sendViaTwilio(request: SMSMessageRequest): Promise<MessageResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountId}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append("To", `+${request.to}`);
    formData.append("From", request.from);
    formData.append("Body", request.body);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${this.config.accountId}:${this.config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Twilio error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.sid,
      channel: "sms",
      status: "queued",
    };
  }

  /**
   * Send SMS via Termii (Nigerian SMS provider)
   */
  private async sendViaTermii(request: SMSMessageRequest): Promise<MessageResult> {
    const url = "https://api.ng.termii.com/api/sms/send";
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: request.to,
        from: request.from,
        sms: request.body,
        type: "plain",
        channel: "generic",
        api_key: this.config.authToken,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Termii error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      messageId: data.message_id,
      channel: "sms",
      status: "queued",
    };
  }

  /**
   * Send SMS via Africa's Talking
   */
  private async sendViaAfricasTalking(request: SMSMessageRequest): Promise<MessageResult> {
    const url = "https://api.africastalking.com/version1/messaging";
    
    const formData = new URLSearchParams();
    formData.append("username", this.config.accountId);
    formData.append("to", `+${request.to}`);
    formData.append("from", request.from);
    formData.append("message", request.body);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "apiKey": this.config.authToken,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Africa's Talking error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    const recipient = data.SMSMessageData?.Recipients?.[0];
    
    return {
      success: recipient?.status === "Success",
      messageId: recipient?.messageId,
      channel: "sms",
      status: recipient?.status === "Success" ? "queued" : "failed",
      error: recipient?.status !== "Success" ? recipient?.status : undefined,
    };
  }
}

// ============================================================================
// Template Renderer
// ============================================================================

/**
 * Renders message templates with parameter substitution
 */
export class TemplateRenderer {
  private registry: TemplateRegistry;

  constructor(registry: TemplateRegistry = DEFAULT_TEMPLATE_REGISTRY) {
    this.registry = registry;
  }

  /**
   * Get template entry by name
   */
  getTemplate(name: TemplateName): TemplateRegistryEntry | undefined {
    return this.registry[name];
  }

  /**
   * Render SMS template with parameters
   */
  renderSMSTemplate(name: TemplateName, parameters: Record<string, string>): string {
    const template = this.registry[name];
    if (!template) {
      throw new Error(`Template not found: ${name}`);
    }

    let message = template.smsTemplate;
    for (const [key, value] of Object.entries(parameters)) {
      message = message.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    return message;
  }

  /**
   * Build WhatsApp template components from parameters
   */
  buildWhatsAppComponents(
    name: TemplateName,
    parameters: Record<string, string>
  ): WhatsAppTemplateComponent[] {
    const template = this.registry[name];
    if (!template) {
      throw new Error(`Template not found: ${name}`);
    }

    // Build body component with text parameters
    const bodyParameters = template.requiredParameters.map((param) => ({
      type: "text" as const,
      text: parameters[param] || "",
    }));

    return [
      {
        type: "body",
        parameters: bodyParameters,
      },
    ];
  }

  /**
   * Validate that all required parameters are provided
   */
  validateParameters(name: TemplateName, parameters: Record<string, string>): string[] {
    const template = this.registry[name];
    if (!template) {
      return [`Template not found: ${name}`];
    }

    const missing: string[] = [];
    for (const param of template.requiredParameters) {
      if (!parameters[param]) {
        missing.push(param);
      }
    }

    return missing;
  }
}

// ============================================================================
// Unified Messaging Service Class
// ============================================================================

/**
 * Configuration for UnifiedMessagingService
 */
export interface MessagingServiceConfig {
  /** WhatsApp Business API configuration */
  whatsappConfig?: WhatsAppConfig;
  /** SMS provider configuration */
  smsConfig?: SMSConfig;
  /** Retry configuration */
  retryConfig?: RetryConfig;
  /** Template registry */
  templateRegistry?: TemplateRegistry;
  /** Function to check opt-in status from database */
  checkOptInFn?: (phoneNumber: string) => Promise<OptInStatus | null>;
  /** Function to update opt-in status in database */
  updateOptInFn?: (phoneNumber: string, channel: MessageChannel, optIn: boolean) => Promise<void>;
  /** Default estimated delivery time in minutes */
  defaultEstimatedDeliveryMinutes?: number;
  /** Restaurant name for messages (can be overridden per order) */
  defaultRestaurantName?: string;
}

/**
 * Unified Messaging Service
 * 
 * Provides a single interface for sending transactional messages via WhatsApp
 * and SMS. Handles opt-in checking, template rendering, and fallback logic.
 * 
 * @requirements 11.4 - Use WhatsApp Business API message templates for order confirmation
 * @requirements 12.5 - Status messages use approved WhatsApp Business API templates
 * 
 * @example
 * ```typescript
 * const messagingService = createMessagingService({
 *   whatsappConfig: {
 *     businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
 *     phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
 *     accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
 *     apiVersion: 'v18.0',
 *   },
 * });
 * 
 * // Send order confirmation
 * const result = await messagingService.sendOrderConfirmation(order);
 * ```
 */
export class UnifiedMessagingService implements MessagingService {
  private whatsappClient?: WhatsAppClient;
  private smsClient?: SMSClient;
  private templateRenderer: TemplateRenderer;
  private retryConfig: RetryConfig;
  private checkOptInFn?: MessagingServiceConfig["checkOptInFn"];
  private updateOptInFn?: MessagingServiceConfig["updateOptInFn"];
  private defaultEstimatedDeliveryMinutes: number;
  private defaultRestaurantName: string;

  constructor(config: MessagingServiceConfig = {}) {
    // Initialize WhatsApp client if config provided
    if (config.whatsappConfig) {
      this.whatsappClient = new WhatsAppClient(
        config.whatsappConfig,
        config.retryConfig || DEFAULT_RETRY_CONFIG
      );
    }

    // Initialize SMS client if config provided
    if (config.smsConfig) {
      this.smsClient = new SMSClient(config.smsConfig);
    }

    this.templateRenderer = new TemplateRenderer(config.templateRegistry);
    this.retryConfig = config.retryConfig || DEFAULT_RETRY_CONFIG;
    this.checkOptInFn = config.checkOptInFn;
    this.updateOptInFn = config.updateOptInFn;
    this.defaultEstimatedDeliveryMinutes = config.defaultEstimatedDeliveryMinutes || 45;
    this.defaultRestaurantName = config.defaultRestaurantName || "Restaurant";
  }

  /**
   * Send order confirmation message to customer
   * 
   * @requirements 11.2 - Send WhatsApp confirmation when order is placed and customer has opted in
   * @requirements 11.3 - Include order ID, restaurant name, items, total, estimated delivery time
   * @requirements 11.6 - Fall back to SMS if WhatsApp fails
   */
  async sendOrderConfirmation(order: Order): Promise<MessageResult> {
    const phoneNumber = order.phoneNumber;
    if (!phoneNumber) {
      return {
        success: false,
        channel: "whatsapp",
        status: "failed",
        error: "No phone number provided for order",
      };
    }

    // Check opt-in status
    const optInStatus = await this.checkOptInStatus(phoneNumber);
    
    // Build template parameters
    const parameters: Record<string, string> = {
      orderId: order.id,
      restaurantName: this.defaultRestaurantName,
      items: formatOrderItems(order.items),
      totalAmount: formatNaira(order.totalAmount),
      estimatedTime: `${this.defaultEstimatedDeliveryMinutes} minutes`,
    };

    // Try WhatsApp first if opted in
    if (optInStatus.whatsappOptIn && this.whatsappClient) {
      const template = this.templateRenderer.getTemplate("order_confirmation");
      if (template) {
        const components = this.templateRenderer.buildWhatsAppComponents(
          "order_confirmation",
          parameters
        );
        
        const result = await this.whatsappClient.sendTemplateMessage(
          phoneNumber,
          template.whatsappTemplateName,
          template.language,
          components
        );

        if (result.success) {
          return result;
        }

        // Log WhatsApp failure for fallback
        console.warn(`WhatsApp message failed for order ${order.id}: ${result.error}`);
      }
    }

    // Fall back to SMS if WhatsApp failed or not opted in
    if (optInStatus.smsOptIn && this.smsClient) {
      const smsBody = this.templateRenderer.renderSMSTemplate("order_confirmation", parameters);
      return await this.smsClient.sendMessage(phoneNumber, smsBody);
    }

    // No channel available
    return {
      success: false,
      channel: optInStatus.whatsappOptIn ? "whatsapp" : "sms",
      status: "failed",
      error: "Customer has not opted in to any messaging channel",
    };
  }

  /**
   * Send order status update message to customer
   * 
   * @requirements 12.1 - Send message when status changes to "preparing"
   * @requirements 12.2 - Send message when status changes to "dispatched" with rider info
   * @requirements 12.3 - Send message when status changes to "delivered"
   * @requirements 12.4 - Send message when order is cancelled with reason
   */
  async sendStatusUpdate(order: Order, status: string): Promise<MessageResult> {
    const phoneNumber = order.phoneNumber;
    if (!phoneNumber) {
      return {
        success: false,
        channel: "whatsapp",
        status: "failed",
        error: "No phone number provided for order",
      };
    }

    // Check opt-in status
    const optInStatus = await this.checkOptInStatus(phoneNumber);
    
    // Map status to template name
    const templateName = this.getTemplateNameForStatus(status);
    if (!templateName) {
      return {
        success: false,
        channel: "whatsapp",
        status: "failed",
        error: `No template defined for status: ${status}`,
      };
    }

    // Build template parameters based on status
    const parameters = this.buildStatusParameters(order, status);

    // Try WhatsApp first if opted in
    if (optInStatus.whatsappOptIn && this.whatsappClient) {
      const template = this.templateRenderer.getTemplate(templateName);
      if (template) {
        const components = this.templateRenderer.buildWhatsAppComponents(templateName, parameters);
        
        const result = await this.whatsappClient.sendTemplateMessage(
          phoneNumber,
          template.whatsappTemplateName,
          template.language,
          components
        );

        if (result.success) {
          return result;
        }

        console.warn(`WhatsApp status update failed for order ${order.id}: ${result.error}`);
      }
    }

    // Fall back to SMS
    if (optInStatus.smsOptIn && this.smsClient) {
      const smsBody = this.templateRenderer.renderSMSTemplate(templateName, parameters);
      return await this.smsClient.sendMessage(phoneNumber, smsBody);
    }

    return {
      success: false,
      channel: optInStatus.whatsappOptIn ? "whatsapp" : "sms",
      status: "failed",
      error: "Customer has not opted in to any messaging channel",
    };
  }

  /**
   * Map order status to template name
   */
  private getTemplateNameForStatus(status: string): TemplateName | null {
    const statusMap: Record<string, TemplateName> = {
      preparing: "order_preparing",
      dispatched: "order_dispatched",
      delivered: "order_delivered",
      cancelled: "order_cancelled",
    };

    return statusMap[status.toLowerCase()] || null;
  }

  /**
   * Build template parameters based on order status
   */
  private buildStatusParameters(order: Order, status: string): Record<string, string> {
    const baseParams: Record<string, string> = {
      orderId: order.id,
      restaurantName: this.defaultRestaurantName,
    };

    switch (status.toLowerCase()) {
      case "preparing":
        return baseParams;

      case "dispatched":
        return {
          ...baseParams,
          riderName: order.riderName || "Your rider",
          estimatedTime: `${this.defaultEstimatedDeliveryMinutes} minutes`,
        };

      case "delivered":
        return baseParams;

      case "cancelled":
        return {
          ...baseParams,
          cancellationReason: order.cancellationReason || "Order cancelled by restaurant",
        };

      default:
        return baseParams;
    }
  }

  /**
   * Check customer's opt-in status for messaging channels
   * 
   * @requirements 13.7 - Check customer preferences before sending any WhatsApp message
   */
  async checkOptInStatus(phoneNumber: string): Promise<OptInStatus> {
    // Use provided function if available
    if (this.checkOptInFn) {
      const status = await this.checkOptInFn(phoneNumber);
      if (status) {
        return status;
      }
    }

    // Default: no opt-in
    return {
      phoneNumber,
      whatsappOptIn: false,
      smsOptIn: false,
      updatedAt: Date.now(),
    };
  }

  /**
   * Update customer's opt-in status for a messaging channel
   * 
   * @requirements 13.4 - Update whatsappOptIn to false when STOP is received
   * @requirements 13.6 - Update whatsappOptIn to true when START is received
   */
  async updateOptInStatus(
    phoneNumber: string,
    channel: MessageChannel,
    optIn: boolean
  ): Promise<void> {
    if (this.updateOptInFn) {
      await this.updateOptInFn(phoneNumber, channel, optIn);
    }
  }

  /**
   * Check if WhatsApp is configured and available
   */
  isWhatsAppAvailable(): boolean {
    return !!this.whatsappClient;
  }

  /**
   * Check if SMS is configured and available
   */
  isSMSAvailable(): boolean {
    return !!this.smsClient;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a UnifiedMessagingService instance
 * 
 * @param config - Optional configuration for the messaging service
 * @returns UnifiedMessagingService instance
 * 
 * @example
 * ```typescript
 * // Basic usage with environment variables
 * const messagingService = createMessagingService();
 * 
 * // With full configuration
 * const messagingService = createMessagingService({
 *   whatsappConfig: {
 *     businessAccountId: 'your-business-account-id',
 *     phoneNumberId: 'your-phone-number-id',
 *     accessToken: 'your-access-token',
 *     apiVersion: 'v18.0',
 *   },
 *   smsConfig: {
 *     provider: 'termii',
 *     accountId: 'your-account-id',
 *     authToken: 'your-auth-token',
 *     senderId: 'YourBrand',
 *   },
 *   checkOptInFn: async (phoneNumber) => {
 *     // Fetch from database
 *     return await db.customerPreferences.getByPhone(phoneNumber);
 *   },
 * });
 * ```
 */
export function createMessagingService(
  config: MessagingServiceConfig = {}
): UnifiedMessagingService {
  return new UnifiedMessagingService(config);
}

/**
 * Create a MessagingService instance from environment variables
 * 
 * Expected environment variables:
 * - WHATSAPP_BUSINESS_ACCOUNT_ID
 * - WHATSAPP_PHONE_NUMBER_ID
 * - WHATSAPP_ACCESS_TOKEN
 * - WHATSAPP_API_VERSION (optional, defaults to v18.0)
 * - SMS_PROVIDER (optional: twilio, termii, africas_talking)
 * - SMS_ACCOUNT_ID
 * - SMS_AUTH_TOKEN
 * - SMS_SENDER_ID
 */
export function createMessagingServiceFromEnv(
  overrides: Partial<MessagingServiceConfig> = {}
): UnifiedMessagingService {
  const config: MessagingServiceConfig = { ...overrides };

  // Configure WhatsApp if environment variables are present
  if (
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN
  ) {
    config.whatsappConfig = {
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      apiVersion: process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION,
      webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    };
  }

  // Configure SMS if environment variables are present
  if (
    process.env.SMS_PROVIDER &&
    process.env.SMS_ACCOUNT_ID &&
    process.env.SMS_AUTH_TOKEN &&
    process.env.SMS_SENDER_ID
  ) {
    config.smsConfig = {
      provider: process.env.SMS_PROVIDER as "twilio" | "termii" | "africas_talking",
      accountId: process.env.SMS_ACCOUNT_ID,
      authToken: process.env.SMS_AUTH_TOKEN,
      senderId: process.env.SMS_SENDER_ID,
    };
  }

  return new UnifiedMessagingService(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default UnifiedMessagingService;
