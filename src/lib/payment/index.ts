/**
 * Payment Module
 * 
 * This module provides payment service infrastructure for the Nigerian market,
 * supporting Paystack, Flutterwave, and Cash-on-Delivery (COD) payment methods.
 * 
 * @module payment
 */

// Export all types and interfaces
export type {
  // Core types
  PaymentMethod,
  PaymentStatus,
  
  // Result interfaces
  PaymentInitResult,
  PaymentVerifyResult,
  WebhookResult,
  
  // Provider and service interfaces
  PaymentProvider,
  PaymentService,
  
  // Configuration and record types
  PaymentProviderConfig,
  PaymentTransaction,
  CODCollection,
  CODReconciliationSummary,
} from './types';

// Export Paystack provider
export { PaystackProvider, createPaystackProvider } from './PaystackProvider';

// Export Flutterwave provider
export { FlutterwaveProvider, createFlutterwaveProvider } from './FlutterwaveProvider';

// Export unified payment service
export { 
  UnifiedPaymentService, 
  createPaymentService,
  initializeCODPayment,
  type CODPaymentResult,
} from './PaymentServiceImpl';
