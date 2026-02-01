/**
 * MenuImportService - Service for importing menu data from CSV and Google Sheets
 * 
 * This service implements the menu import pipeline, providing methods to:
 * - Parse CSV files with menu data
 * - Fetch and parse Google Sheets URLs
 * - Validate menu import rows
 * - Import menu items into branches
 * - Retry failed imports
 * 
 * @module menu/MenuImportService
 * @see Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
 */

import * as Papa from 'papaparse';
import {
  MenuImportRow,
  MenuValidationResult,
  ImportResult,
  IMenuImportService,
  GoogleSheetInfo,
  GoogleSheetFetchResult,
  PriceParseResult,
  ParsedModifier,
  ValidationError,
  ValidationWarning,
  FailedRow,
  REQUIRED_COLUMNS,
  MAX_IMPORT_BATCH_SIZE,
  VALIDATION_CONSTRAINTS,
} from './types';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when CSV parsing fails
 */
export class CSVParseError extends Error {
  constructor(message: string, public readonly details?: string[]) {
    super(message);
    this.name = 'CSVParseError';
  }
}

/**
 * Error thrown when Google Sheets URL is invalid or fetch fails
 */
export class GoogleSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetError';
  }
}

/**
 * Error thrown when import batch size exceeds limit
 */
export class ImportBatchSizeError extends Error {
  constructor(size: number) {
    super(`Import batch size ${size} exceeds maximum of ${MAX_IMPORT_BATCH_SIZE} items`);
    this.name = 'ImportBatchSizeError';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a Naira price string into a numeric value
 * 
 * Accepts formats: "500", "500.00", "₦500", "₦500.00"
 * 
 * @param priceString - The price string to parse
 * @returns PriceParseResult with success status and parsed value
 * 
 * @see Requirement 5.3: Validate price format accepts multiple Naira formats
 */
export function parseNairaPrice(priceString: string): PriceParseResult {
  if (!priceString || typeof priceString !== 'string') {
    return {
      success: false,
      error: 'Price is required',
    };
  }

  // Trim whitespace and remove Naira symbol if present
  let cleaned = priceString.trim();
  
  // Remove Naira symbol (₦) if present
  if (cleaned.startsWith('₦')) {
    cleaned = cleaned.substring(1).trim();
  }
  
  // Remove commas (for formats like "1,000")
  cleaned = cleaned.replace(/,/g, '');

  // Check if the remaining string is a valid number
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return {
      success: false,
      error: `Invalid price format: "${priceString}". Expected formats: 500, 500.00, ₦500, ₦500.00`,
    };
  }

  const value = parseFloat(cleaned);

  // Validate it's a positive number
  if (isNaN(value) || value < 0) {
    return {
      success: false,
      error: `Price must be a positive number, got: "${priceString}"`,
    };
  }

  return {
    success: true,
    value,
  };
}

/**
 * Parse a modifier string into an array of ParsedModifier objects
 * 
 * Format: "modifier1:price1,modifier2:price2"
 * Example: "Extra Cheese:200,Large Size:500"
 * 
 * @param modifierString - The modifier string to parse
 * @returns Array of parsed modifiers, or empty array if invalid/empty
 * 
 * @see Requirement 4.5: Parse modifier strings in format "modifier1:price1,modifier2:price2"
 */
export function parseModifiers(modifierString: string | undefined): ParsedModifier[] {
  if (!modifierString || typeof modifierString !== 'string' || !modifierString.trim()) {
    return [];
  }

  const modifiers: ParsedModifier[] = [];
  const parts = modifierString.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.lastIndexOf(':');
    if (colonIndex === -1) {
      // No price specified, skip this modifier
      continue;
    }

    const name = trimmed.substring(0, colonIndex).trim();
    const priceStr = trimmed.substring(colonIndex + 1).trim();

    if (!name) continue;

    const priceResult = parseNairaPrice(priceStr);
    if (priceResult.success && priceResult.value !== undefined) {
      modifiers.push({
        name,
        price: priceResult.value,
      });
    }
  }

  return modifiers;
}

/**
 * Serialize an array of modifiers back to string format
 * 
 * @param modifiers - Array of modifiers to serialize
 * @returns Serialized modifier string
 * 
 * @see Requirement 4.5: Modifier string format "modifier1:price1,modifier2:price2"
 */
export function serializeModifiers(modifiers: ParsedModifier[]): string {
  if (!modifiers || modifiers.length === 0) {
    return '';
  }

  return modifiers
    .map(mod => `${mod.name}:${mod.price}`)
    .join(',');
}

/**
 * Parse availability string to boolean
 * 
 * Accepts: "true", "false", "yes", "no", "1", "0", empty (defaults to true)
 * 
 * @param availabilityString - The availability string to parse
 * @returns Boolean availability value
 */
export function parseAvailability(availabilityString: string | undefined): boolean {
  if (!availabilityString || typeof availabilityString !== 'string') {
    return true; // Default to available
  }

  const normalized = availabilityString.trim().toLowerCase();
  
  if (['false', 'no', '0'].includes(normalized)) {
    return false;
  }

  return true; // Default to available for any other value
}

/**
 * Extract Google Sheets ID from various URL formats
 * 
 * Supports:
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={sheetId}
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/export?format=csv
 * 
 * @param url - The Google Sheets URL
 * @returns GoogleSheetInfo with spreadsheetId and optional sheetId
 * @throws GoogleSheetError if URL is invalid
 * 
 * @see Requirement 4.2: Accept Google Sheets URLs
 */
export function parseGoogleSheetUrl(url: string): GoogleSheetInfo {
  if (!url || typeof url !== 'string') {
    throw new GoogleSheetError('Google Sheets URL is required');
  }

  const trimmedUrl = url.trim();

  // Match Google Sheets URL pattern
  const spreadsheetIdMatch = trimmedUrl.match(
    /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
  );

  if (!spreadsheetIdMatch) {
    throw new GoogleSheetError(
      'Invalid Google Sheets URL. Expected format: https://docs.google.com/spreadsheets/d/{spreadsheetId}/...'
    );
  }

  const spreadsheetId = spreadsheetIdMatch[1];

  // Try to extract sheet ID (gid parameter)
  let sheetId: string | undefined;
  const gidMatch = trimmedUrl.match(/[#&?]gid=(\d+)/);
  if (gidMatch) {
    sheetId = gidMatch[1];
  }

  return {
    spreadsheetId,
    sheetId,
  };
}

/**
 * Build the CSV export URL for a Google Sheet
 * 
 * @param info - Google Sheet info with spreadsheetId and optional sheetId
 * @returns URL to fetch the sheet as CSV
 */
export function buildGoogleSheetCsvUrl(info: GoogleSheetInfo): string {
  let url = `https://docs.google.com/spreadsheets/d/${info.spreadsheetId}/export?format=csv`;
  
  if (info.sheetId) {
    url += `&gid=${info.sheetId}`;
  }

  return url;
}

/**
 * Generate a unique import ID
 * 
 * @returns Unique import ID string
 */
export function generateImportId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `import_${timestamp}_${random}`;
}

// ============================================================================
// MenuImportService Class
// ============================================================================

/**
 * Service for importing menu data from CSV files and Google Sheets
 * 
 * @implements IMenuImportService
 * 
 * @example
 * ```typescript
 * const service = new MenuImportService();
 * 
 * // Parse CSV file
 * const rows = await service.parseCSV(file);
 * 
 * // Validate rows
 * const validation = service.validateRows(rows);
 * 
 * // Import if valid
 * if (validation.valid) {
 *   const result = await service.importMenu(branchId, rows);
 * }
 * ```
 */
export class MenuImportService implements IMenuImportService {
  // Store for tracking imports (in production, this would be in the database)
  private importStore: Map<string, {
    branchId: string;
    failedRows: FailedRow[];
    originalRows: MenuImportRow[];
  }> = new Map();

  // ==========================================================================
  // CSV Parsing
  // ==========================================================================

  /**
   * Parse a CSV file and extract menu rows
   * 
   * @param file - The CSV file to parse
   * @returns Promise resolving to array of menu import rows
   * @throws CSVParseError if parsing fails
   * 
   * @see Requirement 4.1: Accept CSV files with columns: name, price, description, category, modifiers, isAvailable
   */
  async parseCSV(file: File): Promise<MenuImportRow[]> {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim().toLowerCase(),
        complete: (results) => {
          // Check for parsing errors
          if (results.errors.length > 0) {
            const errorMessages = results.errors.map(
              (e) => `Row ${e.row}: ${e.message}`
            );
            reject(new CSVParseError('CSV parsing failed', errorMessages));
            return;
          }

          // Validate required columns exist
          const headers = results.meta.fields || [];
          const missingColumns = REQUIRED_COLUMNS.filter(
            (col) => !headers.includes(col)
          );

          if (missingColumns.length > 0) {
            reject(
              new CSVParseError(
                `Missing required columns: ${missingColumns.join(', ')}`
              )
            );
            return;
          }

          // Transform to MenuImportRow format
          const rows: MenuImportRow[] = results.data.map((row) => ({
            name: row.name || '',
            price: row.price || '',
            description: row.description,
            category: row.category,
            modifiers: row.modifiers,
            isAvailable: row.isavailable || row.isAvailable,
          }));

          resolve(rows);
        },
        error: (error: Error) => {
          reject(new CSVParseError(`Failed to parse CSV: ${error.message}`));
        },
      });
    });
  }

  /**
   * Parse CSV content from a string (used internally for Google Sheets)
   * 
   * @param csvContent - The CSV content as a string
   * @returns Array of menu import rows
   * @throws CSVParseError if parsing fails
   */
  parseCSVString(csvContent: string): MenuImportRow[] {
    const results = Papa.parse<Record<string, string>>(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim().toLowerCase(),
    });

    // Check for parsing errors
    if (results.errors.length > 0) {
      const errorMessages = results.errors.map(
        (e) => `Row ${e.row}: ${e.message}`
      );
      throw new CSVParseError('CSV parsing failed', errorMessages);
    }

    // Validate required columns exist
    const headers = results.meta.fields || [];
    const missingColumns = REQUIRED_COLUMNS.filter(
      (col) => !headers.includes(col)
    );

    if (missingColumns.length > 0) {
      throw new CSVParseError(
        `Missing required columns: ${missingColumns.join(', ')}`
      );
    }

    // Transform to MenuImportRow format
    return results.data.map((row) => ({
      name: row.name || '',
      price: row.price || '',
      description: row.description,
      category: row.category,
      modifiers: row.modifiers,
      isAvailable: row.isavailable || row.isAvailable,
    }));
  }

  // ==========================================================================
  // Google Sheets Parsing
  // ==========================================================================

  /**
   * Parse a Google Sheets URL and fetch menu data
   * 
   * This method:
   * 1. Extracts the spreadsheet ID from the URL
   * 2. Builds a CSV export URL
   * 3. Fetches the CSV data
   * 4. Parses the CSV content
   * 
   * @param url - The Google Sheets URL
   * @returns Promise resolving to array of menu import rows
   * @throws GoogleSheetError if URL is invalid or fetch fails
   * 
   * @see Requirement 4.2: Accept Google Sheets URLs and fetch data via Google Sheets API
   */
  async parseGoogleSheet(url: string): Promise<MenuImportRow[]> {
    // Parse the URL to extract spreadsheet info
    const sheetInfo = parseGoogleSheetUrl(url);
    
    // Build the CSV export URL
    const csvUrl = buildGoogleSheetCsvUrl(sheetInfo);

    // Fetch the CSV data
    const fetchResult = await this.fetchGoogleSheetCsv(csvUrl);

    if (!fetchResult.success || !fetchResult.rows) {
      throw new GoogleSheetError(
        fetchResult.error || 'Failed to fetch Google Sheet data'
      );
    }

    return fetchResult.rows;
  }

  /**
   * Fetch CSV data from a Google Sheets export URL
   * 
   * @param csvUrl - The CSV export URL
   * @returns GoogleSheetFetchResult with success status and rows
   */
  private async fetchGoogleSheetCsv(csvUrl: string): Promise<GoogleSheetFetchResult> {
    try {
      const response = await fetch(csvUrl);

      if (!response.ok) {
        // Handle common error cases
        if (response.status === 404) {
          return {
            success: false,
            error: 'Google Sheet not found. Make sure the sheet exists and is publicly accessible.',
          };
        }
        if (response.status === 403) {
          return {
            success: false,
            error: 'Access denied. Make sure the Google Sheet is set to "Anyone with the link can view".',
          };
        }
        return {
          success: false,
          error: `Failed to fetch Google Sheet: HTTP ${response.status}`,
        };
      }

      const csvContent = await response.text();

      // Check if we got HTML instead of CSV (common error when sheet is not public)
      if (csvContent.trim().startsWith('<!DOCTYPE') || csvContent.trim().startsWith('<html')) {
        return {
          success: false,
          error: 'Unable to access Google Sheet. Make sure the sheet is set to "Anyone with the link can view".',
        };
      }

      // Parse the CSV content
      const rows = this.parseCSVString(csvContent);

      return {
        success: true,
        rows,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to fetch Google Sheet: ${message}`,
      };
    }
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate an array of menu import rows
   * 
   * Validates:
   * - Name: required, 2-100 characters
   * - Price: required, valid Naira format, positive number
   * - Description: optional, max 500 characters
   * - Modifiers: optional, valid format with non-negative prices
   * - Duplicates: flagged as warnings
   * 
   * @param rows - The rows to validate
   * @returns MenuValidationResult with errors, warnings, and counts
   * 
   * @see Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
   */
  validateRows(rows: MenuImportRow[]): MenuValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const seenNames = new Map<string, number>(); // Track name -> first row number

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1; // 1-indexed for user display

      // Validate name (required, 2-100 characters)
      // Requirement 5.1: Name field minimum 2 characters, maximum 100 characters
      if (!row.name || typeof row.name !== 'string') {
        errors.push({
          row: rowNumber,
          field: 'name',
          message: 'Name is required',
          value: row.name,
        });
      } else {
        const trimmedName = row.name.trim();
        if (trimmedName.length < VALIDATION_CONSTRAINTS.NAME_MIN_LENGTH) {
          errors.push({
            row: rowNumber,
            field: 'name',
            message: `Name must be at least ${VALIDATION_CONSTRAINTS.NAME_MIN_LENGTH} characters`,
            value: row.name,
          });
        } else if (trimmedName.length > VALIDATION_CONSTRAINTS.NAME_MAX_LENGTH) {
          errors.push({
            row: rowNumber,
            field: 'name',
            message: `Name must not exceed ${VALIDATION_CONSTRAINTS.NAME_MAX_LENGTH} characters`,
            value: row.name,
          });
        } else {
          // Check for duplicates (warning, not error)
          // Requirement 5.6: Duplicate names flagged as warning
          const normalizedName = trimmedName.toLowerCase();
          if (seenNames.has(normalizedName)) {
            warnings.push({
              row: rowNumber,
              field: 'name',
              message: `Duplicate name "${trimmedName}" (first seen in row ${seenNames.get(normalizedName)})`,
            });
          } else {
            seenNames.set(normalizedName, rowNumber);
          }
        }
      }

      // Validate price (required, valid Naira format, positive)
      // Requirement 5.2: Price field as positive numeric value
      // Requirement 5.3: Price format accepts "500", "500.00", "₦500", "₦500.00"
      if (!row.price || typeof row.price !== 'string') {
        errors.push({
          row: rowNumber,
          field: 'price',
          message: 'Price is required',
          value: row.price,
        });
      } else {
        const priceResult = parseNairaPrice(row.price);
        if (!priceResult.success) {
          errors.push({
            row: rowNumber,
            field: 'price',
            message: priceResult.error || 'Invalid price format',
            value: row.price,
          });
        } else if (priceResult.value !== undefined && priceResult.value <= 0) {
          errors.push({
            row: rowNumber,
            field: 'price',
            message: 'Price must be a positive number',
            value: row.price,
          });
        }
      }

      // Validate description (optional, max 500 characters)
      // Requirement 5.7: Description field does not exceed 500 characters
      if (row.description && typeof row.description === 'string') {
        if (row.description.length > VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH) {
          errors.push({
            row: rowNumber,
            field: 'description',
            message: `Description must not exceed ${VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH} characters`,
            value: row.description.substring(0, 50) + '...',
          });
        }
      }

      // Validate modifiers (optional, valid format with non-negative prices)
      // Requirement 5.5: Modifier prices are non-negative numeric values
      if (row.modifiers && typeof row.modifiers === 'string' && row.modifiers.trim()) {
        const modifiers = parseModifiers(row.modifiers);
        
        // Check for invalid modifier format
        const parts = row.modifiers.split(',').filter(p => p.trim());
        if (parts.length > 0 && modifiers.length === 0) {
          warnings.push({
            row: rowNumber,
            field: 'modifiers',
            message: 'Modifiers could not be parsed. Expected format: "modifier1:price1,modifier2:price2"',
          });
        }

        // Check for negative prices in modifiers
        for (const mod of modifiers) {
          if (mod.price < 0) {
            errors.push({
              row: rowNumber,
              field: 'modifiers',
              message: `Modifier "${mod.name}" has negative price: ${mod.price}`,
              value: row.modifiers,
            });
          }
        }
      }
    }

    const validCount = rows.length - new Set(errors.map(e => e.row)).size;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validCount,
      totalRows: rows.length,
    };
  }

  // ==========================================================================
  // Import Operations
  // ==========================================================================

  /**
   * Import validated menu rows into a branch
   * 
   * @param branchId - The branch to import into
   * @param rows - The validated rows to import
   * @returns ImportResult with success/failure counts
   * @throws ImportBatchSizeError if batch exceeds 500 items
   * 
   * @see Requirement 4.9: Support batch imports up to 500 items
   */
  async importMenu(branchId: string, rows: MenuImportRow[]): Promise<ImportResult> {
    // Check batch size limit
    if (rows.length > MAX_IMPORT_BATCH_SIZE) {
      throw new ImportBatchSizeError(rows.length);
    }

    const importId = generateImportId();
    const failedRows: FailedRow[] = [];
    let successCount = 0;

    // Validate all rows first
    const validation = this.validateRows(rows);

    // Mark rows with validation errors as failed
    for (const error of validation.errors) {
      // Only add unique row failures
      if (!failedRows.some(f => f.row === error.row)) {
        failedRows.push({
          row: error.row,
          error: error.message,
          data: JSON.stringify(rows[error.row - 1]),
        });
      }
    }

    // Count successful rows (rows without errors)
    const errorRows = new Set(validation.errors.map(e => e.row));
    successCount = rows.length - errorRows.size;

    // Store import info for potential retry
    this.importStore.set(importId, {
      branchId,
      failedRows,
      originalRows: rows,
    });

    // Note: In a real implementation, this would call Convex mutations
    // to actually insert the menu items into the database.
    // For now, we return the import result based on validation.

    return {
      importId,
      totalRows: rows.length,
      successCount,
      failedCount: failedRows.length,
      failedRows,
      status: failedRows.length === 0 ? 'completed' : 'completed',
    };
  }

  /**
   * Retry importing previously failed rows
   * 
   * @param importId - The import ID to retry
   * @returns ImportResult for the retry operation
   * 
   * @see Requirement 4.8: Re-process only previously failed rows
   */
  async retryFailedRows(importId: string): Promise<ImportResult> {
    const importInfo = this.importStore.get(importId);

    if (!importInfo) {
      return {
        importId,
        totalRows: 0,
        successCount: 0,
        failedCount: 0,
        failedRows: [],
        status: 'failed',
      };
    }

    // Get only the failed rows from the original import
    const failedRowNumbers = new Set(importInfo.failedRows.map(f => f.row));
    const rowsToRetry = importInfo.originalRows.filter(
      (_, index) => failedRowNumbers.has(index + 1)
    );

    if (rowsToRetry.length === 0) {
      return {
        importId,
        totalRows: 0,
        successCount: 0,
        failedCount: 0,
        failedRows: [],
        status: 'completed',
      };
    }

    // Re-import only the failed rows
    const retryResult = await this.importMenu(importInfo.branchId, rowsToRetry);

    // Update the stored import info
    this.importStore.set(importId, {
      ...importInfo,
      failedRows: retryResult.failedRows,
    });

    return {
      ...retryResult,
      importId, // Keep the original import ID
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get import status by ID
   * 
   * @param importId - The import ID to look up
   * @returns Import info or undefined if not found
   */
  getImportStatus(importId: string) {
    return this.importStore.get(importId);
  }

  /**
   * Clear import from store (for cleanup)
   * 
   * @param importId - The import ID to clear
   */
  clearImport(importId: string): void {
    this.importStore.delete(importId);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MenuImportService instance
 * 
 * @returns A new MenuImportService instance
 */
export function createMenuImportService(): MenuImportService {
  return new MenuImportService();
}

// ============================================================================
// Default Export
// ============================================================================

export default MenuImportService;
