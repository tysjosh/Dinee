/**
 * Fraud Detection Module
 * 
 * Provides fraud signal detection, customer behavior analysis,
 * and call blocking functionality for the restaurant call management platform.
 * 
 * @module fraud
 * @see Requirements: 25.1, 25.2, 25.4, 25.8
 */

// Types
export type {
  FraudSignalType,
  FraudDisposition,
  FraudDetectionThresholds,
  FraudOrderData,
  FraudSignal,
  FraudDetectionResult,
  CustomerFraudAnalysis,
  FraudDetectionService,
} from './types';

export { DEFAULT_FRAUD_THRESHOLDS } from './types';

// Fraud Detection Service
export {
  FraudDetectionServiceImpl,
  createFraudDetectionService,
} from './FraudDetectionService';

// Call Blocking Service
export type {
  CallBlockingAction,
  CallBlockingResult,
  CallBlockingConfig,
  CallBlockingService,
  FraudSignalSummary,
} from './CallBlockingService';

export {
  CallBlockingServiceImpl,
  createCallBlockingService,
  DEFAULT_CALL_BLOCKING_CONFIG,
} from './CallBlockingService';

export { default } from './FraudDetectionService';
