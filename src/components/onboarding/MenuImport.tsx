/**
 * MenuImport - Component for importing menu data from CSV or Google Sheets
 * 
 * This component provides a UI for:
 * - Uploading CSV files with menu data
 * - Entering Google Sheets URLs
 * - Displaying validation errors and retry options
 * 
 * @see Requirements: 4.7, 4.9, 4.10
 */

import React, { useState, useRef, useCallback } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Link2, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
  MenuImportService,
  MenuValidator,
  createMenuImportService,
  createMenuValidator,
  MenuImportRow,
  MenuValidationResult,
  ImportResult,
  ValidationError,
  ValidationWarning,
} from '@/lib/menu';

// ============================================================================
// Types
// ============================================================================

export interface MenuImportProps {
  /** Branch ID to import menu items into */
  branchId: string;
  /** Callback when import is successful */
  onImportSuccess?: (result: ImportResult) => void;
  /** Callback when import fails */
  onImportError?: (error: Error) => void;
  /** Optional class name */
  className?: string;
}

type ImportSource = 'csv' | 'google-sheets' | null;

interface ImportState {
  source: ImportSource;
  loading: boolean;
  rows: MenuImportRow[];
  validation: MenuValidationResult | null;
  importResult: ImportResult | null;
  error: string | null;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Source selection cards
 */
function SourceSelection({
  onSelectSource,
  disabled,
}: {
  onSelectSource: (source: ImportSource) => void;
  disabled: boolean;
}) {
  return (
    <div className={cn(
      "w-full grid grid-cols-1 md:grid-cols-2 gap-6 p-4",
      { "pointer-events-none opacity-50": disabled }
    )}>
      {/* CSV Upload */}
      <div
        className="group relative flex flex-col justify-center items-center h-full w-full card-minimal rounded-lg cursor-pointer hover:bg-white/5 transition-all duration-300 ease-in-out p-8 text-center"
        onClick={() => !disabled && onSelectSource('csv')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && onSelectSource('csv')}
        aria-label="Upload CSV file"
      >
        <Upload className="text-emerald-400 h-10 w-10 mb-4" />
        <h3 className="text-lg text-white text-minimal">Upload CSV</h3>
        <p className="text-sm text-white/70 mt-2 text-minimal">
          Import from a CSV file
        </p>
      </div>

      {/* Google Sheets */}
      <div
        className="group relative flex flex-col justify-center items-center h-full w-full card-minimal rounded-lg cursor-pointer hover:bg-white/5 transition-all duration-300 ease-in-out p-8 text-center"
        onClick={() => !disabled && onSelectSource('google-sheets')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && onSelectSource('google-sheets')}
        aria-label="Import from Google Sheets"
      >
        <div className="absolute top-3 right-3 bg-blue-500/10 text-blue-400 text-xs px-3 py-1 rounded-full border border-blue-500/20">
          Google
        </div>
        <FileSpreadsheet className="text-blue-400 h-10 w-10 mb-4" />
        <h3 className="text-lg text-white text-minimal">Google Sheets</h3>
        <p className="text-sm text-white/70 mt-2 text-minimal">
          Import from a public sheet
        </p>
      </div>
    </div>
  );
}

/**
 * CSV file upload form
 */
function CSVUploadForm({
  onFileSelect,
  onCancel,
  loading,
}: {
  onFileSelect: (file: File) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        onFileSelect(file);
      }
    }
  }, [onFileSelect]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  }, [onFileSelect]);

  return (
    <div className="w-full p-6 card-minimal rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg text-white text-minimal">Upload CSV File</h3>
        <button
          onClick={onCancel}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Cancel"
        >
          <X size={20} />
        </button>
      </div>

      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200",
          dragActive ? "border-emerald-400 bg-emerald-500/10" : "border-white/20 hover:border-white/40",
          loading && "pointer-events-none opacity-50"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleChange}
          className="hidden"
          disabled={loading}
        />
        
        {loading ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500/30 border-t-emerald-500 mb-4"></div>
            <p className="text-emerald-400 text-minimal">Processing...</p>
          </div>
        ) : (
          <>
            <Upload className="mx-auto h-12 w-12 text-white/40 mb-4" />
            <p className="text-white text-minimal mb-2">
              Drag and drop your CSV file here
            </p>
            <p className="text-white/60 text-sm text-minimal">
              or click to browse
            </p>
          </>
        )}
      </div>

      <div className="mt-4 p-4 bg-white/5 rounded-lg">
        <p className="text-sm text-white/70 text-minimal mb-2">Required columns:</p>
        <code className="text-xs text-emerald-400">name, price</code>
        <p className="text-sm text-white/70 text-minimal mt-2">Optional columns:</p>
        <code className="text-xs text-white/50">description, category, modifiers, isAvailable</code>
      </div>
    </div>
  );
}

/**
 * Google Sheets URL input form
 */
function GoogleSheetsForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (url: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onSubmit(url.trim());
    }
  };

  return (
    <div className="w-full p-6 card-minimal rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg text-white text-minimal">Import from Google Sheets</h3>
        <button
          onClick={onCancel}
          className="text-white/60 hover:text-white transition-colors"
          aria-label="Cancel"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="sheetsUrl" className="block text-sm text-white/70 mb-2 text-minimal">
            Google Sheets URL
          </label>
          <div className="relative">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/40" />
            <input
              id="sheetsUrl"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="input-dark w-full pl-10 pr-4 py-3 rounded-lg"
              disabled={loading}
              required
            />
          </div>
        </div>

        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-400 text-minimal">
            Make sure your Google Sheet is set to &quot;Anyone with the link can view&quot;
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-minimal btn-secondary-minimal px-6 py-2 rounded-lg text-minimal"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-minimal btn-primary-minimal px-6 py-2 rounded-lg text-minimal flex items-center gap-2"
            disabled={loading || !url.trim()}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                Fetching...
              </>
            ) : (
              <>
                <FileSpreadsheet size={16} />
                Import
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}


/**
 * Validation results display
 */
function ValidationResults({
  validation,
  onProceed,
  onCancel,
  loading,
}: {
  validation: MenuValidationResult;
  onProceed: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(false);

  return (
    <div className="w-full p-6 card-minimal rounded-lg">
      <h3 className="text-lg text-white text-minimal mb-4">Validation Results</h3>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white/5 rounded-lg text-center">
          <p className="text-2xl text-white font-semibold">{validation.totalRows}</p>
          <p className="text-sm text-white/60 text-minimal">Total Rows</p>
        </div>
        <div className="p-4 bg-emerald-500/10 rounded-lg text-center">
          <p className="text-2xl text-emerald-400 font-semibold">{validation.validCount}</p>
          <p className="text-sm text-emerald-400/60 text-minimal">Valid</p>
        </div>
        <div className={cn(
          "p-4 rounded-lg text-center",
          validation.errors.length > 0 ? "bg-red-500/10" : "bg-white/5"
        )}>
          <p className={cn(
            "text-2xl font-semibold",
            validation.errors.length > 0 ? "text-red-400" : "text-white"
          )}>
            {validation.errors.length}
          </p>
          <p className={cn(
            "text-sm text-minimal",
            validation.errors.length > 0 ? "text-red-400/60" : "text-white/60"
          )}>
            Errors
          </p>
        </div>
      </div>

      {/* Errors */}
      {validation.errors.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors w-full"
          >
            <AlertCircle size={16} />
            <span className="text-minimal">{validation.errors.length} Errors</span>
            {showErrors ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showErrors && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
              {validation.errors.map((error, index) => (
                <div key={index} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-sm text-red-400 text-minimal">
                    Row {error.row}: {error.message}
                  </p>
                  {error.value && (
                    <p className="text-xs text-red-400/60 mt-1 text-minimal">
                      Value: {error.value}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowWarnings(!showWarnings)}
            className="flex items-center gap-2 text-yellow-400 hover:text-yellow-300 transition-colors w-full"
          >
            <AlertCircle size={16} />
            <span className="text-minimal">{validation.warnings.length} Warnings</span>
            {showWarnings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showWarnings && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
              {validation.warnings.map((warning, index) => (
                <div key={index} className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-sm text-yellow-400 text-minimal">
                    Row {warning.row}: {warning.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
        <button
          onClick={onCancel}
          className="btn-minimal btn-secondary-minimal px-6 py-2 rounded-lg text-minimal"
          disabled={loading}
        >
          Cancel
        </button>
        <button
          onClick={onProceed}
          className="btn-minimal btn-primary-minimal px-6 py-2 rounded-lg text-minimal flex items-center gap-2"
          disabled={loading || validation.validCount === 0}
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
              Importing...
            </>
          ) : (
            <>
              <CheckCircle2 size={16} />
              Import {validation.validCount} Items
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Import results display
 */
function ImportResults({
  result,
  onRetry,
  onDone,
  loading,
}: {
  result: ImportResult;
  onRetry: () => void;
  onDone: () => void;
  loading: boolean;
}) {
  const hasFailures = result.failedCount > 0;

  return (
    <div className="w-full p-6 card-minimal rounded-lg">
      <div className="flex items-center gap-3 mb-6">
        {hasFailures ? (
          <AlertCircle className="h-8 w-8 text-yellow-400" />
        ) : (
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        )}
        <h3 className="text-lg text-white text-minimal">
          {hasFailures ? 'Import Completed with Errors' : 'Import Successful'}
        </h3>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white/5 rounded-lg text-center">
          <p className="text-2xl text-white font-semibold">{result.totalRows}</p>
          <p className="text-sm text-white/60 text-minimal">Total</p>
        </div>
        <div className="p-4 bg-emerald-500/10 rounded-lg text-center">
          <p className="text-2xl text-emerald-400 font-semibold">{result.successCount}</p>
          <p className="text-sm text-emerald-400/60 text-minimal">Imported</p>
        </div>
        <div className={cn(
          "p-4 rounded-lg text-center",
          hasFailures ? "bg-red-500/10" : "bg-white/5"
        )}>
          <p className={cn(
            "text-2xl font-semibold",
            hasFailures ? "text-red-400" : "text-white"
          )}>
            {result.failedCount}
          </p>
          <p className={cn(
            "text-sm text-minimal",
            hasFailures ? "text-red-400/60" : "text-white/60"
          )}>
            Failed
          </p>
        </div>
      </div>

      {/* Failed rows */}
      {hasFailures && (
        <div className="mb-6">
          <p className="text-sm text-white/70 text-minimal mb-2">Failed Rows:</p>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {result.failedRows.map((row, index) => (
              <div key={index} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400 text-minimal">
                  Row {row.row}: {row.error}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
        {hasFailures && (
          <button
            onClick={onRetry}
            className="btn-minimal btn-secondary-minimal px-6 py-2 rounded-lg text-minimal flex items-center gap-2"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Retry Failed
              </>
            )}
          </button>
        )}
        <button
          onClick={onDone}
          className="btn-minimal btn-primary-minimal px-6 py-2 rounded-lg text-minimal"
          disabled={loading}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * MenuImport - Main component for importing menu data
 * 
 * @see Requirements: 4.7, 4.9, 4.10
 */
export function MenuImport({
  branchId,
  onImportSuccess,
  onImportError,
  className,
}: MenuImportProps) {
  const [state, setState] = useState<ImportState>({
    source: null,
    loading: false,
    rows: [],
    validation: null,
    importResult: null,
    error: null,
  });

  const importService = useRef(createMenuImportService());
  const validator = useRef(createMenuValidator());

  // Handle source selection
  const handleSelectSource = (source: ImportSource) => {
    setState(prev => ({ ...prev, source, error: null }));
  };

  // Handle CSV file selection
  const handleCSVFile = async (file: File) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const rows = await importService.current.parseCSV(file);
      const validation = validator.current.validate(rows);

      setState(prev => ({
        ...prev,
        loading: false,
        rows,
        validation,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse CSV';
      setState(prev => ({
        ...prev,
        loading: false,
        error: message,
      }));
      onImportError?.(error instanceof Error ? error : new Error(message));
    }
  };

  // Handle Google Sheets URL
  const handleGoogleSheets = async (url: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const rows = await importService.current.parseGoogleSheet(url);
      const validation = validator.current.validate(rows);

      setState(prev => ({
        ...prev,
        loading: false,
        rows,
        validation,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Google Sheet';
      setState(prev => ({
        ...prev,
        loading: false,
        error: message,
      }));
      onImportError?.(error instanceof Error ? error : new Error(message));
    }
  };

  // Handle import
  const handleImport = async () => {
    setState(prev => ({ ...prev, loading: true }));

    try {
      const result = await importService.current.importMenu(branchId, state.rows);

      setState(prev => ({
        ...prev,
        loading: false,
        importResult: result,
      }));

      if (result.failedCount === 0) {
        onImportSuccess?.(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: message,
      }));
      onImportError?.(error instanceof Error ? error : new Error(message));
    }
  };

  // Handle retry
  const handleRetry = async () => {
    if (!state.importResult) return;

    setState(prev => ({ ...prev, loading: true }));

    try {
      const result = await importService.current.retryFailedRows(state.importResult.importId);

      setState(prev => ({
        ...prev,
        loading: false,
        importResult: result,
      }));

      if (result.failedCount === 0) {
        onImportSuccess?.(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Retry failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  };

  // Handle cancel/reset
  const handleCancel = () => {
    setState({
      source: null,
      loading: false,
      rows: [],
      validation: null,
      importResult: null,
      error: null,
    });
  };

  // Handle done
  const handleDone = () => {
    if (state.importResult) {
      onImportSuccess?.(state.importResult);
    }
    handleCancel();
  };

  return (
    <div className={cn("w-full min-h-40", className)}>
      {/* Error display */}
      {state.error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-minimal">{state.error}</p>
            <button
              onClick={handleCancel}
              className="text-sm text-red-400/60 hover:text-red-400 mt-2 text-minimal"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Import result view */}
      {state.importResult && (
        <ImportResults
          result={state.importResult}
          onRetry={handleRetry}
          onDone={handleDone}
          loading={state.loading}
        />
      )}

      {/* Validation view */}
      {!state.importResult && state.validation && (
        <ValidationResults
          validation={state.validation}
          onProceed={handleImport}
          onCancel={handleCancel}
          loading={state.loading}
        />
      )}

      {/* CSV upload form */}
      {!state.importResult && !state.validation && state.source === 'csv' && (
        <CSVUploadForm
          onFileSelect={handleCSVFile}
          onCancel={handleCancel}
          loading={state.loading}
        />
      )}

      {/* Google Sheets form */}
      {!state.importResult && !state.validation && state.source === 'google-sheets' && (
        <GoogleSheetsForm
          onSubmit={handleGoogleSheets}
          onCancel={handleCancel}
          loading={state.loading}
        />
      )}

      {/* Source selection */}
      {!state.importResult && !state.validation && !state.source && (
        <SourceSelection
          onSelectSource={handleSelectSource}
          disabled={state.loading}
        />
      )}
    </div>
  );
}

export default MenuImport;
