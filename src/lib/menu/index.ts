/**
 * Menu Import Module
 * 
 * This module provides utilities for importing menu data from CSV files
 * and Google Sheets into the restaurant management system.
 * 
 * @module menu
 * @see Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
 */

// =============================================================================
// Service Exports
// =============================================================================

export {
  // Main service class
  MenuImportService,
  
  // Factory function
  createMenuImportService,
  
  // Error classes
  CSVParseError,
  GoogleSheetError,
  ImportBatchSizeError,
  
  // Utility functions
  parseNairaPrice as parseNairaPriceFromService,
  parseModifiers as parseModifiersFromService,
  serializeModifiers as serializeModifiersFromService,
  parseAvailability as parseAvailabilityFromService,
  parseGoogleSheetUrl,
  buildGoogleSheetCsvUrl,
  generateImportId,
} from './MenuImportService';

// =============================================================================
// Validator Exports
// =============================================================================

export {
  // Validator class
  MenuValidator,
  
  // Factory function
  createMenuValidator,
  
  // Utility functions (canonical exports)
  parseNairaPrice,
  formatNairaPrice,
  parseModifiers,
  serializeModifiers,
  parseAvailability,
} from './MenuValidator';

export type { MenuValidatorOptions } from './MenuValidator';

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Core types
  MenuImportRow,
  ParsedModifier,
  NormalizedMenuItem,
  
  // Validation types
  ValidationError,
  ValidationWarning,
  MenuValidationResult,
  
  // Import result types
  FailedRow,
  ImportResult,
  ImportStatus,
  
  // Price parsing types
  PriceParseResult,
  
  // Google Sheets types
  GoogleSheetInfo,
  GoogleSheetFetchResult,
  
  // Service interface
  IMenuImportService,
} from './types';

// =============================================================================
// Constant Exports
// =============================================================================

export {
  REQUIRED_COLUMNS,
  OPTIONAL_COLUMNS,
  ALL_COLUMNS,
  MAX_IMPORT_BATCH_SIZE,
  VALIDATION_CONSTRAINTS,
} from './types';
