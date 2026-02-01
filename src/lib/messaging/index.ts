/**
 * Messaging Module
 * 
 * This module provides messaging service infrastructure for the Nigerian market,
 * supporting WhatsApp Business API and SMS messaging for transactional messages.
 * 
 * @module messaging
 * @requirements 11.4 - WhatsApp Business API message templates for order confirmation
 * @requirements 12.5 - Status messages use approved WhatsApp Business API templates
 */

// Export all types and interfaces
export type {
  // Channel and status types
  MessageChannel,
  MessageStatus,
  
  // Template types
  MessageTemplate,
  TemplateComponent,
  TemplateParameter,
  
  // Opt-in types
  OptInStatus,
  
  // Result types
  MessageResult,
  
  // Service interface
  MessagingService,
  
  // WhatsApp types
  WhatsAppConfig,
  WhatsAppMessageRequest,
  WhatsAppMessageResponse,
  WhatsAppErrorResponse,
  WhatsAppTemplateComponent,
  WhatsAppTemplateParameter,
  
  // SMS types
  SMSConfig,
  SMSMessageRequest,
  SMSMessageResponse,
  
  // Queue types
  QueuedMessage,
  RetryConfig,
  
  // Template registry types
  TemplateName,
  TemplateRegistry,
  TemplateRegistryEntry,
} from './types';

// Export WhatsApp client
export { WhatsAppClient } from './MessagingService';

// Export SMS client
export { SMSClient } from './MessagingService';

// Export template renderer
export { TemplateRenderer } from './MessagingService';

// Export unified messaging service
export {
  UnifiedMessagingService,
  createMessagingService,
  createMessagingServiceFromEnv,
  type MessagingServiceConfig,
} from './MessagingService';

// Export helper functions
export {
  formatPhoneNumber,
  formatNaira,
  formatOrderItems,
} from './MessagingService';
