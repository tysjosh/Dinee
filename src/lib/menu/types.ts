/**
 * Menu Import Module - Type Definitions
 * 
 * This module defines the types and interfaces for the menu import pipeline,
 * supporting CSV file parsing and Google Sheets URL fetching.
 * 
 * @module menu/types
 * @see Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

// ============================================================================
// Menu Import Row Types
// ============================================================================

/**
 * Represents a single row from a menu import source (CSV or Google Sheets)
 * 
 * @see Requirement 4.1: CSV columns - name, price, description, category, modifiers, isAvailable
 */
export interface MenuImportRow {
  /** Menu item name (required) */
  name: string;
  /** Price in Naira format - accepts "500", "500.00", "₦500", "₦500.00" */
  price: string;
  /** Optional description of the menu item */
  description?: string;
  /** Optional category for grouping menu items */
  category?: string;
  /** Optional modifiers in format "modifier1:price1,modifier2:price2" */
  modifiers?: string;
  /** Optional availability status - "true", "false", "yes", "no", "1", "0" */
  isAvailable?: string;
}

/**
 * Parsed modifier with name and price
 */
export interface ParsedModifier {
  name: string;
  price: number;
}

/**
 * Normalized menu item after parsing and validation
 */
export interface NormalizedMenuItem {
  name: string;
  price: number;
  description?: string;
  category?: string;
  modifiers?: ParsedModifier[];
  isAvailable: boolean;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error for a specific row and field
 * 
 * @see Requirement 4.6: Add row to error report with specific error messages
 */
export interface ValidationError {
  /** Row number (1-indexed) where the error occurred */
  row: number;
  /** Field name that failed validation */
  field: string;
  /** Human-readable error message */
  message: string;
  /** The invalid value that caused the error */
  value?: string;
}

/**
 * Validation warning for non-critical issues
 * 
 * @see Requirement 5.6: Duplicate names flagged as warning (not error)
 */
export interface ValidationWarning {
  /** Row number (1-indexed) where the warning occurred */
  row: number;
  /** Field name that triggered the warning */
  field: string;
  /** Human-readable warning message */
  message: string;
}

/**
 * Complete validation result for a menu import
 * 
 * @see Requirement 5.8: Return validation report with errors, warnings, valid count
 */
export interface MenuValidationResult {
  /** Whether all rows passed validation (no errors) */
  valid: boolean;
  /** List of validation errors */
  errors: ValidationError[];
  /** List of validation warnings */
  warnings: ValidationWarning[];
  /** Count of valid items */
  validCount: number;
  /** Total rows processed */
  totalRows: number;
}

// ============================================================================
// Import Result Types
// ============================================================================

/**
 * Failed row information for error reporting
 */
export interface FailedRow {
  /** Row number (1-indexed) that failed */
  row: number;
  /** Error message describing the failure */
  error: string;
  /** Original row data for retry purposes */
  data?: string;
}

/**
 * Result of a menu import operation
 * 
 * @see Requirement 4.7: Display error report with failed rows and retry option
 */
export interface ImportResult {
  /** Unique identifier for this import operation */
  importId: string;
  /** Total number of rows in the import */
  totalRows: number;
  /** Number of successfully imported rows */
  successCount: number;
  /** Number of failed rows */
  failedCount: number;
  /** Details of failed rows */
  failedRows: FailedRow[];
  /** Import status */
  status: ImportStatus;
}

/**
 * Status of an import operation
 */
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

// ============================================================================
// Price Parsing Types
// ============================================================================

/**
 * Result of parsing a Naira price string
 * 
 * @see Requirement 5.3: Validate price format accepts "500", "500.00", "₦500", "₦500.00"
 */
export interface PriceParseResult {
  /** Whether parsing was successful */
  success: boolean;
  /** Parsed numeric value (if successful) */
  value?: number;
  /** Error message (if unsuccessful) */
  error?: string;
}

// ============================================================================
// Google Sheets Types
// ============================================================================

/**
 * Parsed Google Sheets URL information
 */
export interface GoogleSheetInfo {
  /** The spreadsheet ID extracted from the URL */
  spreadsheetId: string;
  /** Optional sheet ID (gid parameter) */
  sheetId?: string;
}

/**
 * Result of fetching data from Google Sheets
 */
export interface GoogleSheetFetchResult {
  /** Whether the fetch was successful */
  success: boolean;
  /** Parsed rows (if successful) */
  rows?: MenuImportRow[];
  /** Error message (if unsuccessful) */
  error?: string;
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Menu Import Service interface
 * 
 * Provides methods for parsing menu data from various sources,
 * validating the data, and importing it into the system.
 * 
 * @see Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export interface IMenuImportService {
  /**
   * Parse a CSV file and extract menu rows
   * @param file - The CSV file to parse
   * @returns Promise resolving to array of menu import rows
   * @see Requirement 4.1: Accept CSV files with specified columns
   */
  parseCSV(file: File): Promise<MenuImportRow[]>;

  /**
   * Parse a Google Sheets URL and fetch menu data
   * @param url - The Google Sheets URL
   * @returns Promise resolving to array of menu import rows
   * @see Requirement 4.2: Accept Google Sheets URLs and fetch data
   */
  parseGoogleSheet(url: string): Promise<MenuImportRow[]>;

  /**
   * Validate an array of menu import rows
   * @param rows - The rows to validate
   * @returns Validation result with errors and warnings
   * @see Requirements: 4.3, 4.4, 5.1-5.8
   */
  validateRows(rows: MenuImportRow[]): MenuValidationResult;

  /**
   * Import validated menu rows into a branch
   * @param branchId - The branch to import into
   * @param rows - The validated rows to import
   * @returns Import result with success/failure counts
   * @see Requirement 4.9: Support batch imports up to 500 items
   */
  importMenu(branchId: string, rows: MenuImportRow[]): Promise<ImportResult>;

  /**
   * Retry importing previously failed rows
   * @param importId - The import ID to retry
   * @returns Import result for the retry operation
   * @see Requirement 4.8: Re-process only previously failed rows
   */
  retryFailedRows(importId: string): Promise<ImportResult>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Required columns for CSV import
 */
export const REQUIRED_COLUMNS = ['name', 'price'] as const;

/**
 * Optional columns for CSV import
 */
export const OPTIONAL_COLUMNS = ['description', 'category', 'modifiers', 'isAvailable'] as const;

/**
 * All valid columns for CSV import
 */
export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

/**
 * Maximum number of items per import batch
 * @see Requirement 4.9: Support batch imports up to 500 items
 */
export const MAX_IMPORT_BATCH_SIZE = 500;

/**
 * Validation constraints
 */
export const VALIDATION_CONSTRAINTS = {
  /** Minimum name length */
  NAME_MIN_LENGTH: 2,
  /** Maximum name length */
  NAME_MAX_LENGTH: 100,
  /** Maximum description length */
  DESCRIPTION_MAX_LENGTH: 500,
} as const;
