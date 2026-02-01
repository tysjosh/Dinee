/**
 * Messaging Service Types and Interfaces
 * 
 * This module defines the types and interfaces for the messaging service infrastructure,
 * supporting WhatsApp Business API and SMS messaging for the Nigerian market.
 * 
 * @module messaging/types
 * @requirements 11.4 - WhatsApp Business API message templates for order confirmation
 * @requirements 12.5 - Status messages use approved WhatsApp Business API templates
 */

import type { Order } from "@/types/global.d";

// ============================================================================
// Message Channel and Status Types
// ============================================================================

/**
 * Supported messaging channels
 * - whatsapp: WhatsApp Business API for transactional messages
 * - sms: SMS fallback for customers without WhatsApp
 */
export type MessageChannel = 'whatsapp' | 'sms';

/**
 * Message delivery status values
 * - queued: Message is queued for sending
 * - sent: Message has been sent to the provider
 * - delivered: Message has been delivered to the recipient
 * - read: Message has been read by the recipient (WhatsApp only)
 * - failed: Message delivery failed
 */
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

// ============================================================================
// Message Template Types
// ============================================================================

/**
 * WhatsApp Business API message template
 * Templates must be pre-approved by Meta before use
 */
export interface MessageTemplate {
  /** Unique template identifier from WhatsApp Business API */
  templateId: string;
  /** Channel this template is for */
  channel: MessageChannel;
  /** Template name as registered with WhatsApp Business API */
  name: string;
  /** Language code (e.g., 'en', 'en_NG' for Nigerian English) */
  language: string;
  /** Template components (header, body, footer, buttons) */
  components: TemplateComponent[];
}

/**
 * Component of a message template
 */
export interface TemplateComponent {
  /** Type of component */
  type: 'header' | 'body' | 'footer' | 'button';
  /** Parameters to be substituted in the component */
  parameters: TemplateParameter[];
}

/**
 * Parameter for template substitution
 */
export interface TemplateParameter {
  /** Type of parameter value */
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document';
  /** The value to substitute */
  value: string;
}

// ============================================================================
// Opt-In Status Types
// ============================================================================

/**
 * Customer opt-in status for messaging channels
 */
export interface OptInStatus {
  /** Customer phone number */
  phoneNumber: string;
  /** Whether customer has opted in to WhatsApp messages */
  whatsappOptIn: boolean;
  /** Whether customer has opted in to SMS messages */
  smsOptIn: boolean;
  /** Timestamp when preferences were last updated */
  updatedAt: number;
}

// ============================================================================
// Message Result Types
// ============================================================================

/**
 * Result of sending a message
 */
export interface MessageResult {
  /** Whether the message was sent successfully */
  success: boolean;
  /** Message ID from the provider (if successful) */
  messageId?: string;
  /** Channel used to send the message */
  channel: MessageChannel;
  /** Current status of the message */
  status: MessageStatus;
  /** Error message if sending failed */
  error?: string;
}

// ============================================================================
// Messaging Service Interface
// ============================================================================

/**
 * Messaging service interface for sending transactional messages
 * This is the main interface for interacting with the messaging system
 * 
 * @requirements 11.4 - Use WhatsApp Business API message templates for order confirmation
 * @requirements 12.5 - Status messages use approved WhatsApp Business API templates
 */
export interface MessagingService {
  /**
   * Send order confirmation message to customer
   * @param order - The order to send confirmation for
   * @returns Promise resolving to the message result
   */
  sendOrderConfirmation(order: Order): Promise<MessageResult>;
  
  /**
   * Send order status update message to customer
   * @param order - The order being updated
   * @param status - The new status to communicate
   * @returns Promise resolving to the message result
   */
  sendStatusUpdate(order: Order, status: string): Promise<MessageResult>;
  
  /**
   * Check customer's opt-in status for messaging channels
   * @param phoneNumber - Customer's phone number
   * @returns Promise resolving to the opt-in status
   */
  checkOptInStatus(phoneNumber: string): Promise<OptInStatus>;
  
  /**
   * Update customer's opt-in status for a messaging channel
   * @param phoneNumber - Customer's phone number
   * @param channel - The messaging channel
   * @param optIn - Whether the customer is opting in or out
   */
  updateOptInStatus(phoneNumber: string, channel: MessageChannel, optIn: boolean): Promise<void>;
}

// ============================================================================
// WhatsApp Business API Types
// ============================================================================

/**
 * WhatsApp Business API configuration
 */
export interface WhatsAppConfig {
  /** WhatsApp Business Account ID */
  businessAccountId: string;
  /** Phone Number ID for sending messages */
  phoneNumberId: string;
  /** Access token for API authentication */
  accessToken: string;
  /** API version (e.g., 'v18.0') */
  apiVersion: string;
  /** Webhook verify token for incoming webhooks */
  webhookVerifyToken?: string;
}

/**
 * WhatsApp message request payload
 */
export interface WhatsAppMessageRequest {
  /** Messaging product (always 'whatsapp') */
  messaging_product: 'whatsapp';
  /** Recipient type (always 'individual') */
  recipient_type: 'individual';
  /** Recipient phone number in international format */
  to: string;
  /** Message type */
  type: 'template' | 'text' | 'interactive';
  /** Template details (for template messages) */
  template?: {
    name: string;
    language: {
      code: string;
    };
    components?: WhatsAppTemplateComponent[];
  };
  /** Text content (for text messages) */
  text?: {
    body: string;
    preview_url?: boolean;
  };
}

/**
 * WhatsApp template component for API request
 */
export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: WhatsAppTemplateParameter[];
}

/**
 * WhatsApp template parameter for API request
 */
export interface WhatsAppTemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
  };
  image?: {
    link: string;
  };
  document?: {
    link: string;
    filename?: string;
  };
}

/**
 * WhatsApp API response for sending messages
 */
export interface WhatsAppMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

/**
 * WhatsApp API error response
 */
export interface WhatsAppErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

// ============================================================================
// SMS Types
// ============================================================================

/**
 * SMS provider configuration
 */
export interface SMSConfig {
  /** SMS provider name */
  provider: 'twilio' | 'termii' | 'africas_talking';
  /** Account SID or API key */
  accountId: string;
  /** Auth token or API secret */
  authToken: string;
  /** Sender ID or phone number */
  senderId: string;
}

/**
 * SMS message request
 */
export interface SMSMessageRequest {
  /** Recipient phone number */
  to: string;
  /** Message content */
  body: string;
  /** Sender ID */
  from: string;
}

/**
 * SMS message response
 */
export interface SMSMessageResponse {
  /** Message ID from provider */
  messageId: string;
  /** Delivery status */
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Message Queue Types
// ============================================================================

/**
 * Queued message for retry handling
 */
export interface QueuedMessage {
  /** Unique message ID */
  id: string;
  /** Order ID associated with the message */
  orderId: string;
  /** Recipient phone number */
  phoneNumber: string;
  /** Message channel */
  channel: MessageChannel;
  /** Message type */
  type: 'order_confirmation' | 'status_update' | 'delivery_update' | 'cancellation';
  /** Template name to use */
  templateName: string;
  /** Template parameters */
  parameters: Record<string, string>;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Timestamp when message was queued */
  queuedAt: number;
  /** Timestamp of last retry attempt */
  lastAttemptAt?: number;
  /** Current status */
  status: MessageStatus;
  /** Error from last attempt */
  lastError?: string;
}

/**
 * Retry configuration for message delivery
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
}

// ============================================================================
// Template Registry Types
// ============================================================================

/**
 * Pre-defined template names for the application
 */
export type TemplateName = 
  | 'order_confirmation'
  | 'order_preparing'
  | 'order_dispatched'
  | 'order_delivered'
  | 'order_cancelled';

/**
 * Template registry entry
 */
export interface TemplateRegistryEntry {
  /** Template name in WhatsApp Business API */
  whatsappTemplateName: string;
  /** SMS message template (with {{placeholder}} syntax) */
  smsTemplate: string;
  /** Required parameters for the template */
  requiredParameters: string[];
  /** Language code */
  language: string;
}

/**
 * Template registry mapping template names to their configurations
 */
export type TemplateRegistry = Record<TemplateName, TemplateRegistryEntry>;
