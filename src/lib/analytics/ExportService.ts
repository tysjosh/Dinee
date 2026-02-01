/**
 * ExportService - Service for exporting data to CSV format
 * 
 * This service provides methods to export calls, orders, and funnel data to CSV,
 * with proper formatting for timestamps and currency.
 * 
 * @module analytics/ExportService
 * @see Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 22.8
 */

import { CallData, OrderData, AnalyticsFilter, FunnelStage } from './AnalyticsService';

// ============================================================================
// Types
// ============================================================================

/**
 * Export options for CSV generation
 */
export interface ExportOptions {
  /** Include header row (default: true) */
  includeHeader?: boolean;
  /** Date format for timestamps (default: ISO 8601) */
  dateFormat?: 'iso' | 'local';
  /** Currency symbol (default: ₦) */
  currencySymbol?: string;
  /** Filename for download */
  filename?: string;
}

/**
 * Export result
 */
export interface ExportResult {
  /** CSV content as string */
  content: string;
  /** Number of rows exported */
  rowCount: number;
  /** Filename */
  filename: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a timestamp as ISO 8601 string
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns ISO 8601 formatted string
 * 
 * @see Requirement 7.4: Format timestamps as ISO 8601
 */
export function formatTimestampISO(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toISOString();
}

/**
 * Format a timestamp as local date string
 * 
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Local date string
 */
export function formatTimestampLocal(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('en-NG');
}

/**
 * Format currency with Naira symbol
 * 
 * @param amount - Numeric amount
 * @param symbol - Currency symbol (default: ₦)
 * @returns Formatted currency string
 * 
 * @see Requirement 7.5: Format currency with ₦ prefix
 */
export function formatCurrency(amount?: number, symbol: string = '₦'): string {
  if (amount === undefined || amount === null) return '';
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 * 
 * @param value - Value to escape
 * @returns Escaped string safe for CSV
 */
export function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  
  const str = String(value);
  
  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Convert an array of objects to CSV string
 * 
 * @param data - Array of objects to convert
 * @param columns - Column definitions with key and header
 * @param options - Export options
 * @returns CSV string
 */
export function toCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: Array<{ key: keyof T; header: string; formatter?: (value: unknown) => string }>,
  options: ExportOptions = {}
): string {
  const { includeHeader = true } = options;
  const lines: string[] = [];

  // Header row
  if (includeHeader) {
    lines.push(columns.map(col => escapeCSVValue(col.header)).join(','));
  }

  // Data rows
  for (const row of data) {
    const values = columns.map(col => {
      const value = row[col.key];
      const formatted = col.formatter ? col.formatter(value) : value;
      return escapeCSVValue(formatted);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Trigger a file download in the browser
 * 
 * @param content - File content
 * @param filename - Filename for download
 * @param mimeType - MIME type (default: text/csv)
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = 'text/csv;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

// ============================================================================
// ExportService Class
// ============================================================================

/**
 * ExportService - Exports data to CSV format
 * 
 * @example
 * ```typescript
 * const service = new ExportService();
 * 
 * // Export calls to CSV
 * const result = service.exportCalls(calls, { filename: 'calls-export.csv' });
 * 
 * // Download the file
 * service.download(result);
 * ```
 */
export class ExportService {
  private defaultOptions: ExportOptions = {
    includeHeader: true,
    dateFormat: 'iso',
    currencySymbol: '₦',
  };

  /**
   * Export calls data to CSV
   * 
   * @param calls - Array of call data
   * @param options - Export options
   * @returns ExportResult with CSV content
   * 
   * @see Requirements: 7.1, 7.2, 7.4
   */
  exportCalls(calls: CallData[], options: ExportOptions = {}): ExportResult {
    const opts = { ...this.defaultOptions, ...options };
    const formatDate = opts.dateFormat === 'iso' ? formatTimestampISO : formatTimestampLocal;

    const columns: Array<{
      key: keyof CallData;
      header: string;
      formatter?: (value: unknown) => string;
    }> = [
      { key: 'callId', header: 'Call ID' },
      { key: 'restaurantId', header: 'Restaurant ID' },
      { key: 'branchId', header: 'Branch ID' },
      { key: 'status', header: 'Status' },
      { key: 'callStartTime', header: 'Start Time', formatter: (v) => formatDate(v as number) },
      { key: 'callEndTime', header: 'End Time', formatter: (v) => formatDate(v as number) },
      { key: 'duration', header: 'Duration (seconds)' },
      { key: 'orderId', header: 'Order ID' },
    ];

    const content = toCSV(calls as unknown as Record<string, unknown>[], columns, opts);
    const filename = opts.filename || `calls-export-${new Date().toISOString().split('T')[0]}.csv`;

    return {
      content,
      rowCount: calls.length,
      filename,
    };
  }

  /**
   * Export orders data to CSV
   * 
   * @param orders - Array of order data
   * @param options - Export options
   * @returns ExportResult with CSV content
   * 
   * @see Requirements: 7.1, 7.3, 7.4, 7.5
   */
  exportOrders(orders: OrderData[], options: ExportOptions = {}): ExportResult {
    const opts = { ...this.defaultOptions, ...options };
    const formatDate = opts.dateFormat === 'iso' ? formatTimestampISO : formatTimestampLocal;
    const symbol = opts.currencySymbol || '₦';

    const columns: Array<{
      key: keyof OrderData;
      header: string;
      formatter?: (value: unknown) => string;
    }> = [
      { key: 'orderId', header: 'Order ID' },
      { key: 'restaurantId', header: 'Restaurant ID' },
      { key: 'branchId', header: 'Branch ID' },
      { key: 'status', header: 'Status' },
      { key: 'totalAmount', header: 'Total Amount', formatter: (v) => formatCurrency(v as number, symbol) },
      { key: 'paymentMethod', header: 'Payment Method' },
      { key: 'paymentStatus', header: 'Payment Status' },
      { key: 'orderPlacementTime', header: 'Order Time', formatter: (v) => formatDate(v as number) },
    ];

    const content = toCSV(orders as unknown as Record<string, unknown>[], columns, opts);
    const filename = opts.filename || `orders-export-${new Date().toISOString().split('T')[0]}.csv`;

    return {
      content,
      rowCount: orders.length,
      filename,
    };
  }

  /**
   * Export combined calls and orders data
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param options - Export options
   * @returns Object with both export results
   */
  exportAll(
    calls: CallData[],
    orders: OrderData[],
    options: ExportOptions = {}
  ): { calls: ExportResult; orders: ExportResult } {
    const dateStr = new Date().toISOString().split('T')[0];
    
    return {
      calls: this.exportCalls(calls, {
        ...options,
        filename: options.filename ? `calls-${options.filename}` : `calls-export-${dateStr}.csv`,
      }),
      orders: this.exportOrders(orders, {
        ...options,
        filename: options.filename ? `orders-${options.filename}` : `orders-export-${dateStr}.csv`,
      }),
    };
  }

  /**
   * Download an export result as a file
   * 
   * @param result - Export result to download
   */
  download(result: ExportResult): void {
    downloadFile(result.content, result.filename);
  }

  /**
   * Export and immediately download calls data
   * 
   * @param calls - Array of call data
   * @param options - Export options
   */
  downloadCalls(calls: CallData[], options: ExportOptions = {}): void {
    const result = this.exportCalls(calls, options);
    this.download(result);
  }

  /**
   * Export and immediately download orders data
   * 
   * @param orders - Array of order data
   * @param options - Export options
   */
  downloadOrders(orders: OrderData[], options: ExportOptions = {}): void {
    const result = this.exportOrders(orders, options);
    this.download(result);
  }

  /**
   * Export funnel data to CSV
   * 
   * Exports funnel stage data with columns:
   * - Stage: The funnel stage name
   * - Count: Number of items at this stage
   * - Conversion Rate (%): Conversion rate from previous stage
   * - Drop-off Count: Number of drop-offs at this stage
   * - Average Time (seconds): Average time spent at this stage
   * 
   * @param stages - Array of funnel stage data
   * @param options - Export options
   * @returns ExportResult with CSV content
   * 
   * @see Requirements: 22.8
   * @see Property 26: CSV Export Format Compliance
   */
  exportFunnel(stages: FunnelStage[], options: ExportOptions = {}): ExportResult {
    const opts = { ...this.defaultOptions, ...options };

    // Define column mappings for funnel data
    const columns: Array<{
      key: keyof FunnelStage;
      header: string;
      formatter?: (value: unknown) => string;
    }> = [
      { 
        key: 'name', 
        header: 'Stage',
        formatter: (v) => this.formatStageName(v as string)
      },
      { key: 'count', header: 'Count' },
      { 
        key: 'conversionRate', 
        header: 'Conversion Rate (%)',
        formatter: (v) => {
          const rate = v as number;
          return rate.toFixed(2);
        }
      },
      { key: 'dropOffCount', header: 'Drop-off Count' },
      { key: 'averageTimeSeconds', header: 'Average Time (seconds)' },
    ];

    const content = toCSV(stages as unknown as Record<string, unknown>[], columns, opts);
    const filename = opts.filename || `funnel-export-${new Date().toISOString().split('T')[0]}.csv`;

    return {
      content,
      rowCount: stages.length,
      filename,
    };
  }

  /**
   * Export funnel data to CSV as a Blob
   * 
   * This method is useful for direct download or further processing.
   * Applies current dashboard filters to the data.
   * 
   * @param stages - Array of funnel stage data
   * @param filter - Optional analytics filter (for filename context)
   * @returns Blob containing CSV data
   * 
   * @see Requirements: 22.8
   * @see Property 26: CSV Export Format Compliance
   */
  exportFunnelToCSV(stages: FunnelStage[], filter?: AnalyticsFilter): Blob {
    // Build filename with filter context
    const dateStr = new Date().toISOString().split('T')[0];
    let filename = `funnel-export-${dateStr}`;
    
    if (filter?.restaurantId) {
      filename = `funnel-${filter.restaurantId}-${dateStr}`;
    } else if (filter?.branchId) {
      filename = `funnel-${filter.branchId}-${dateStr}`;
    }
    
    filename += '.csv';

    const result = this.exportFunnel(stages, { filename });
    return new Blob([result.content], { type: 'text/csv;charset=utf-8;' });
  }

  /**
   * Export and immediately download funnel data
   * 
   * @param stages - Array of funnel stage data
   * @param options - Export options
   */
  downloadFunnel(stages: FunnelStage[], options: ExportOptions = {}): void {
    const result = this.exportFunnel(stages, options);
    this.download(result);
  }

  /**
   * Format funnel stage name for display in CSV
   * 
   * Converts snake_case stage names to human-readable format
   * 
   * @param stageName - The stage name in snake_case
   * @returns Human-readable stage name
   */
  private formatStageName(stageName: string): string {
    const stageLabels: Record<string, string> = {
      'call_started': 'Calls Started',
      'order_initiated': 'Orders Initiated',
      'payment_started': 'Payment Started',
      'payment_completed': 'Payment Completed',
      'delivery_completed': 'Delivery Completed',
    };
    
    return stageLabels[stageName] || stageName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ExportService instance
 * 
 * @returns A new ExportService instance
 */
export function createExportService(): ExportService {
  return new ExportService();
}

// ============================================================================
// Default Export
// ============================================================================

export default ExportService;
