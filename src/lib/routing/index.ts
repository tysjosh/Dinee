/**
 * Order Routing Module
 * 
 * Exports for multi-location order routing based on Nigerian phone area codes.
 * 
 * Requirements: 27.1, 27.2, 27.3, 27.4
 */

export { OrderRoutingService, default } from './OrderRoutingService';

export type {
  RoutingDecision,
  RoutingReason,
  AlternativeBranch,
  BranchAvailability,
  CustomerLocation,
  NigerianAreaCodeMapping,
  NigerianState,
  BranchForRouting,
  OperatingHours,
  DayHours,
  OrderRoutingResult,
  RoutingConfig,
} from './types';

export { DEFAULT_ROUTING_CONFIG } from './types';
