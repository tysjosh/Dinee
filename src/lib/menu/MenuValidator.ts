/**
 * MenuValidator - Validation service for menu import data
 * 
 * This module provides comprehensive validation for menu import rows,
 * including name, price, description, modifiers, and duplicate detection.
 * 
 * @module menu/MenuValidator
 * @see Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import {
  MenuImportRow,
  MenuValidationResult,
  ValidationError,
  ValidationWarning,
  ParsedModifier,
  PriceParseResult,
  NormalizedMenuItem,
  VALIDATION_CONSTRAINTS,
} from './types';

// ============================================================================
// Price Parsing
// ============================================================================

/**
 * Parse a Naira price string into a numeric value
 * 
 * Accepts formats: "500", "500.00", "₦500", "₦500.00", "1,000", "₦1,000.00"
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
 * Format a numeric price as Naira string
 * 
 * @param price - The numeric price
 * @returns Formatted Naira string (e.g., "₦500.00")
 */
export function formatNairaPrice(price: number): string {
  return `₦${price.toFixed(2)}`;
}

// ============================================================================
// Modifier Parsing
// ============================================================================

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

// ============================================================================
// Availability Parsing
// ============================================================================

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

// ============================================================================
// MenuValidator Class
// ============================================================================

/**
 * Validation options for MenuValidator
 */
export interface MenuValidatorOptions {
  /** Whether to check for duplicate names (default: true) */
  checkDuplicates?: boolean;
  /** Whether to allow empty modifiers (default: true) */
  allowEmptyModifiers?: boolean;
  /** Custom minimum name length (default: 2) */
  minNameLength?: number;
  /** Custom maximum name length (default: 100) */
  maxNameLength?: number;
  /** Custom maximum description length (default: 500) */
  maxDescriptionLength?: number;
}

/**
 * MenuValidator - Validates menu import rows
 * 
 * Provides comprehensive validation for menu data including:
 * - Name validation (required, length constraints)
 * - Price validation (Naira format, positive values)
 * - Description validation (length constraints)
 * - Modifier validation (format, non-negative prices)
 * - Duplicate detection
 * 
 * @example
 * ```typescript
 * const validator = new MenuValidator();
 * const result = validator.validate(rows);
 * 
 * if (result.valid) {
 *   // All rows passed validation
 * } else {
 *   // Handle errors
 *   console.log(result.errors);
 * }
 * ```
 */
export class MenuValidator {
  private options: Required<MenuValidatorOptions>;

  constructor(options: MenuValidatorOptions = {}) {
    this.options = {
      checkDuplicates: options.checkDuplicates ?? true,
      allowEmptyModifiers: options.allowEmptyModifiers ?? true,
      minNameLength: options.minNameLength ?? VALIDATION_CONSTRAINTS.NAME_MIN_LENGTH,
      maxNameLength: options.maxNameLength ?? VALIDATION_CONSTRAINTS.NAME_MAX_LENGTH,
      maxDescriptionLength: options.maxDescriptionLength ?? VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH,
    };
  }

  /**
   * Validate an array of menu import rows
   * 
   * @param rows - The rows to validate
   * @returns MenuValidationResult with errors, warnings, and counts
   */
  validate(rows: MenuImportRow[]): MenuValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const seenNames = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      // Validate each field
      this.validateName(row, rowNumber, errors, warnings, seenNames);
      this.validatePrice(row, rowNumber, errors);
      this.validateDescription(row, rowNumber, errors);
      this.validateModifiers(row, rowNumber, errors, warnings);
    }

    const errorRows = new Set(errors.map(e => e.row));
    const validCount = rows.length - errorRows.size;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validCount,
      totalRows: rows.length,
    };
  }

  /**
   * Validate a single row
   * 
   * @param row - The row to validate
   * @param rowNumber - The row number (1-indexed)
   * @returns Validation result for this single row
   */
  validateSingle(row: MenuImportRow, rowNumber: number = 1): MenuValidationResult {
    return this.validate([row]);
  }

  /**
   * Normalize a menu import row to a NormalizedMenuItem
   * 
   * @param row - The row to normalize
   * @returns NormalizedMenuItem or null if validation fails
   */
  normalize(row: MenuImportRow): NormalizedMenuItem | null {
    const validation = this.validateSingle(row);
    
    if (!validation.valid) {
      return null;
    }

    const priceResult = parseNairaPrice(row.price);
    if (!priceResult.success || priceResult.value === undefined) {
      return null;
    }

    return {
      name: row.name.trim(),
      price: priceResult.value,
      description: row.description?.trim(),
      category: row.category?.trim(),
      modifiers: parseModifiers(row.modifiers),
      isAvailable: parseAvailability(row.isAvailable),
    };
  }

  /**
   * Normalize multiple rows, filtering out invalid ones
   * 
   * @param rows - The rows to normalize
   * @returns Array of normalized menu items (invalid rows excluded)
   */
  normalizeAll(rows: MenuImportRow[]): NormalizedMenuItem[] {
    const validation = this.validate(rows);
    const errorRows = new Set(validation.errors.map(e => e.row));

    return rows
      .map((row, index) => {
        if (errorRows.has(index + 1)) {
          return null;
        }
        return this.normalize(row);
      })
      .filter((item): item is NormalizedMenuItem => item !== null);
  }

  // ==========================================================================
  // Private Validation Methods
  // ==========================================================================

  private validateName(
    row: MenuImportRow,
    rowNumber: number,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    seenNames: Map<string, number>
  ): void {
    // Requirement 5.1: Name field minimum 2 characters, maximum 100 characters
    if (!row.name || typeof row.name !== 'string') {
      errors.push({
        row: rowNumber,
        field: 'name',
        message: 'Name is required',
        value: row.name,
      });
      return;
    }

    const trimmedName = row.name.trim();

    if (trimmedName.length < this.options.minNameLength) {
      errors.push({
        row: rowNumber,
        field: 'name',
        message: `Name must be at least ${this.options.minNameLength} characters`,
        value: row.name,
      });
      return;
    }

    if (trimmedName.length > this.options.maxNameLength) {
      errors.push({
        row: rowNumber,
        field: 'name',
        message: `Name must not exceed ${this.options.maxNameLength} characters`,
        value: row.name,
      });
      return;
    }

    // Requirement 5.6: Duplicate names flagged as warning
    if (this.options.checkDuplicates) {
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

  private validatePrice(
    row: MenuImportRow,
    rowNumber: number,
    errors: ValidationError[]
  ): void {
    // Requirement 5.2: Price field as positive numeric value
    // Requirement 5.3: Price format accepts "500", "500.00", "₦500", "₦500.00"
    if (!row.price || typeof row.price !== 'string') {
      errors.push({
        row: rowNumber,
        field: 'price',
        message: 'Price is required',
        value: row.price,
      });
      return;
    }

    const priceResult = parseNairaPrice(row.price);
    
    if (!priceResult.success) {
      errors.push({
        row: rowNumber,
        field: 'price',
        message: priceResult.error || 'Invalid price format',
        value: row.price,
      });
      return;
    }

    if (priceResult.value !== undefined && priceResult.value <= 0) {
      errors.push({
        row: rowNumber,
        field: 'price',
        message: 'Price must be a positive number',
        value: row.price,
      });
    }
  }

  private validateDescription(
    row: MenuImportRow,
    rowNumber: number,
    errors: ValidationError[]
  ): void {
    // Requirement 5.7: Description field does not exceed 500 characters
    if (row.description && typeof row.description === 'string') {
      if (row.description.length > this.options.maxDescriptionLength) {
        errors.push({
          row: rowNumber,
          field: 'description',
          message: `Description must not exceed ${this.options.maxDescriptionLength} characters`,
          value: row.description.substring(0, 50) + '...',
        });
      }
    }
  }

  private validateModifiers(
    row: MenuImportRow,
    rowNumber: number,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Requirement 5.5: Modifier prices are non-negative numeric values
    if (!row.modifiers || typeof row.modifiers !== 'string' || !row.modifiers.trim()) {
      return;
    }

    const modifiers = parseModifiers(row.modifiers);
    
    // Check for invalid modifier format
    const parts = row.modifiers.split(',').filter(p => p.trim());
    if (parts.length > 0 && modifiers.length === 0) {
      warnings.push({
        row: rowNumber,
        field: 'modifiers',
        message: 'Modifiers could not be parsed. Expected format: "modifier1:price1,modifier2:price2"',
      });
      return;
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

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MenuValidator instance
 * 
 * @param options - Validation options
 * @returns A new MenuValidator instance
 */
export function createMenuValidator(options?: MenuValidatorOptions): MenuValidator {
  return new MenuValidator(options);
}

// ============================================================================
// Default Export
// ============================================================================

export default MenuValidator;
