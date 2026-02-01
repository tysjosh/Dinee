/**
 * Delivery Service Module
 * 
 * Provides delivery tracking, rider assignment, status management,
 * and delivery time calculations for the Nigerian market.
 * 
 * @module delivery
 */

// Types
export type {
  DeliveryStatus,
  DeliveryInfo,
  DeliveryService,
  DeliveryServiceConfig,
  DeliveryOperationResult,
  Location,
  BranchDeliveryMetrics,
  StatusTransitionResult,
  RiderInfo,
  DeliveryTimeRecord,
} from "./types";

// Constants
export { VALID_STATUS_TRANSITIONS } from "./types";

// Service implementation
export {
  UnifiedDeliveryService,
  createDeliveryService,
  // Helper functions
  validateStatusTransition,
  isTerminalStatus,
  calculateDistance,
  calculateDeliveryTimeMinutes,
  calculateAverageDeliveryTime,
  buildDeliveryInfoFromOrder,
} from "./DeliveryService";

// Default export
export { default } from "./DeliveryService";
