/**
 * FraudReviewDashboard - Dashboard component for fraud detection and review
 * 
 * This component provides:
 * - Stats overview (total signals, unique phones, blocked numbers, by signal type)
 * - Flagged numbers table with review actions
 * - Blocked numbers table with unblock option
 * - Review modal for manual disposition
 * - Filters by signal type, date range, and phone number search
 * 
 * @see Requirements: 25.5, 25.6, 25.7
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Search,
  Filter,
  X,
  ChevronDown,
  AlertTriangle,
  Ban,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  CreditCard,
  ShoppingCart,
  TrendingDown,
  Phone,
  Calendar,
  User,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Modal } from '@/components/ui/Modal';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

// ============================================================================
// Types
// ============================================================================

export interface FraudReviewDashboardProps {
  /** Optional class name */
  className?: string;
  /** Current reviewer ID/name for audit trail */
  reviewerId?: string;
}

type SignalType = 'repeated_failed_payments' | 'high_cancellation_rate' | 'unusual_order_pattern';
type Disposition = 'cleared' | 'blocked' | 'monitoring';
type TabType = 'flagged' | 'blocked';

interface FraudSignal {
  signalType: SignalType;
  signalCount: number;
  lastOccurrence: number;
  disposition?: Disposition;
  reviewedBy?: string;
  reviewedAt?: number;
}

interface FlaggedNumber {
  phoneNumber: string;
  totalSignalCount: number;
  signals: Array<{
    signalType: SignalType;
    signalCount: number;
    lastOccurrence: number;
  }>;
  lastOccurrence: number;
}

interface BlockedNumber {
  phoneNumber: string;
  signals: FraudSignal[];
  blockedAt: number;
}

interface ReviewState {
  phoneNumber: string;
  signals: FraudSignal[];
  disposition: Disposition;
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

const SIGNAL_TYPE_INFO: Record<SignalType, {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}> = {
  repeated_failed_payments: {
    label: 'Failed Payments',
    description: 'Multiple failed payment attempts',
    icon: CreditCard,
    color: 'text-red-400 bg-red-500/10 border-red-500/30',
  },
  high_cancellation_rate: {
    label: 'High Cancellations',
    description: 'Unusually high order cancellation rate',
    icon: XCircle,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  unusual_order_pattern: {
    label: 'Unusual Pattern',
    description: 'Suspicious ordering behavior detected',
    icon: AlertTriangle,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  },
};

const DISPOSITION_INFO: Record<Disposition, {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}> = {
  cleared: {
    label: 'Clear',
    description: 'Mark as legitimate - remove flags',
    icon: CheckCircle,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  blocked: {
    label: 'Block',
    description: 'Block this number from placing orders',
    icon: Ban,
    color: 'text-red-400 bg-red-500/10 border-red-500/30',
  },
  monitoring: {
    label: 'Monitor',
    description: 'Keep under observation',
    icon: Eye,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format phone number for display
 */
function formatPhoneNumber(phone: string): string {
  // Simple formatting - can be enhanced for Nigerian numbers
  if (phone.startsWith('+234')) {
    return phone.replace(/(\+234)(\d{3})(\d{3})(\d{4})/, '$1 $2 $3 $4');
  }
  return phone;
}

/**
 * Format date for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date with time for display
 */
function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get relative time string
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(timestamp);
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Stats card component
 */
function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-white/60',
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="card p-4 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs text-white/40 text-minimal mb-1">{title}</p>
          <p className="text-2xl font-semibold text-white">{value}</p>
          {subtitle && (
            <p className="text-xs text-white/40 mt-1">{subtitle}</p>
          )}
        </div>
        <div className={cn("p-2 rounded-lg bg-white/5", iconColor)}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

/**
 * Signal type badge component
 */
function SignalTypeBadge({ signalType, count }: { signalType: SignalType; count?: number }) {
  const info = SIGNAL_TYPE_INFO[signalType];
  const Icon = info.icon;
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs",
      info.color
    )}>
      <Icon size={12} />
      {info.label}
      {count !== undefined && count > 0 && (
        <span className="ml-1 font-medium">({count})</span>
      )}
    </span>
  );
}

/**
 * Empty state component
 */
function EmptyState({ 
  title, 
  description, 
  icon: Icon 
}: { 
  title: string; 
  description: string; 
  icon: React.ElementType;
}) {
  return (
    <div className="text-center py-12">
      <Icon className="h-12 w-12 text-white/20 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-white/60 text-sm max-w-md mx-auto">{description}</p>
    </div>
  );
}

/**
 * Tab button component
 */
function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
        active
          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          : "bg-white/5 text-white/60 hover:bg-white/10 border border-transparent"
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn(
          "px-1.5 py-0.5 rounded text-xs",
          active ? "bg-emerald-500/30" : "bg-white/10"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Flagged number row component
 */
function FlaggedNumberRow({
  item,
  onReview,
  onBlock,
}: {
  item: FlaggedNumber;
  onReview: () => void;
  onBlock: () => void;
}) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
            <Phone size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              {formatPhoneNumber(item.phoneNumber)}
            </p>
            <p className="text-xs text-white/40">
              Last activity: {getRelativeTime(item.lastOccurrence)}
            </p>
          </div>
        </div>
      </td>
      <td className="p-4">
        <div className="flex flex-wrap gap-1">
          {item.signals.map((signal) => (
            <SignalTypeBadge
              key={signal.signalType}
              signalType={signal.signalType}
              count={signal.signalCount}
            />
          ))}
        </div>
      </td>
      <td className="p-4 text-center">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 text-red-400 font-semibold text-sm">
          {item.totalSignalCount}
        </span>
      </td>
      <td className="p-4">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReview}
            className="btn btn-outline btn-sm"
          >
            <Eye size={14} className="mr-1" />
            Review
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onBlock}
            className="btn btn-destructive btn-sm"
          >
            <Ban size={14} className="mr-1" />
            Block
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Blocked number row component
 */
function BlockedNumberRow({
  item,
  onUnblock,
}: {
  item: BlockedNumber;
  onUnblock: () => void;
}) {
  const blockedBySignal = item.signals.find(s => s.reviewedBy);
  
  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
            <ShieldX size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              {formatPhoneNumber(item.phoneNumber)}
            </p>
          </div>
        </div>
      </td>
      <td className="p-4">
        <p className="text-sm text-white/60">
          {formatDateTime(item.blockedAt)}
        </p>
      </td>
      <td className="p-4">
        <p className="text-sm text-white/60">
          {blockedBySignal?.reviewedBy || 'System'}
        </p>
      </td>
      <td className="p-4">
        <div className="flex flex-wrap gap-1">
          {item.signals.map((signal) => (
            <SignalTypeBadge
              key={signal.signalType}
              signalType={signal.signalType}
              count={signal.signalCount}
            />
          ))}
        </div>
      </td>
      <td className="p-4">
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onUnblock}
            className="btn btn-outline btn-sm"
          >
            <RefreshCw size={14} className="mr-1" />
            Unblock
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Review modal content component
 */
function ReviewModalContent({
  reviewState,
  onDispositionChange,
  onNotesChange,
  onConfirm,
  onCancel,
  isSubmitting,
}: {
  reviewState: ReviewState;
  onDispositionChange: (disposition: Disposition) => void;
  onNotesChange: (notes: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Phone Number Header */}
      <div className="flex items-center gap-3 p-4 rounded-lg bg-white/5 border border-white/10">
        <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400">
          <Phone size={24} />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">
            {formatPhoneNumber(reviewState.phoneNumber)}
          </p>
          <p className="text-sm text-white/40">
            {reviewState.signals.length} signal type(s) detected
          </p>
        </div>
      </div>

      {/* Signals List */}
      <div>
        <h4 className="text-sm font-medium text-white mb-3">Detected Signals</h4>
        <div className="space-y-2">
          {reviewState.signals.map((signal) => {
            const info = SIGNAL_TYPE_INFO[signal.signalType];
            const Icon = info.icon;
            return (
              <div
                key={signal.signalType}
                className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg border", info.color)}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{info.label}</p>
                    <p className="text-xs text-white/40">{info.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-white">{signal.signalCount}</p>
                  <p className="text-xs text-white/40">occurrences</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Disposition Selection */}
      <div>
        <h4 className="text-sm font-medium text-white mb-3">Select Disposition</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.entries(DISPOSITION_INFO) as [Disposition, typeof DISPOSITION_INFO[Disposition]][]).map(
            ([disposition, info]) => {
              const Icon = info.icon;
              const isSelected = reviewState.disposition === disposition;
              return (
                <button
                  key={disposition}
                  type="button"
                  onClick={() => onDispositionChange(disposition)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border text-center transition-all",
                    isSelected
                      ? info.color
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                  )}
                >
                  <Icon size={24} />
                  <div>
                    <p className="text-sm font-medium">{info.label}</p>
                    <p className="text-xs text-white/40 mt-1">{info.description}</p>
                  </div>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Notes Field */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Reviewer Notes (Optional)
        </label>
        <textarea
          value={reviewState.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Add any notes about this review decision..."
          rows={3}
          className="input-dark w-full rounded-lg resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="btn btn-outline btn-md"
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={isSubmitting}
          loading={isSubmitting}
          className="btn btn-primary btn-md"
        >
          Confirm {DISPOSITION_INFO[reviewState.disposition].label}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FraudReviewDashboard - Main fraud review dashboard component
 * 
 * Displays fraud signals, flagged customers, and blocked numbers with
 * manual review and disposition capabilities.
 * 
 * @see Requirements: 25.5, 25.6, 25.7
 */
export function FraudReviewDashboard({
  className,
  reviewerId = 'admin',
}: FraudReviewDashboardProps) {
  // State
  const [activeTab, setActiveTab] = useState<TabType>('flagged');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSignalType, setFilterSignalType] = useState<SignalType | 'all'>('all');
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [blockingNumber, setBlockingNumber] = useState<string | null>(null);
  const [unblockingNumber, setUnblockingNumber] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Convex queries
  const fraudStats = useQuery(api.fraudSignals.getFraudStats);
  const flaggedNumbers = useQuery(api.fraudSignals.getFlaggedNumbers, {
    signalCountThreshold: 3,
  });
  const blockedNumbers = useQuery(api.fraudSignals.getBlockedNumbers);

  // Convex mutations
  const blockNumber = useMutation(api.fraudSignals.blockNumber);
  const unblockNumber = useMutation(api.fraudSignals.unblockNumber);
  const updateDisposition = useMutation(api.fraudSignals.updateDisposition);

  // Filter flagged numbers
  const filteredFlagged = useMemo(() => {
    if (!flaggedNumbers) return [];
    
    return flaggedNumbers.filter((item) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!item.phoneNumber.toLowerCase().includes(query)) {
          return false;
        }
      }
      
      // Signal type filter
      if (filterSignalType !== 'all') {
        if (!item.signals.some(s => s.signalType === filterSignalType)) {
          return false;
        }
      }
      
      return true;
    });
  }, [flaggedNumbers, searchQuery, filterSignalType]);

  // Filter blocked numbers
  const filteredBlocked = useMemo(() => {
    if (!blockedNumbers) return [];
    
    return blockedNumbers.filter((item) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!item.phoneNumber.toLowerCase().includes(query)) {
          return false;
        }
      }
      
      return true;
    });
  }, [blockedNumbers, searchQuery]);

  // Handlers
  const handleOpenReview = useCallback((item: FlaggedNumber) => {
    setReviewState({
      phoneNumber: item.phoneNumber,
      signals: item.signals.map(s => ({
        signalType: s.signalType,
        signalCount: s.signalCount,
        lastOccurrence: s.lastOccurrence,
      })),
      disposition: 'monitoring',
      notes: '',
    });
  }, []);

  const handleCloseReview = useCallback(() => {
    setReviewState(null);
  }, []);

  const handleDispositionChange = useCallback((disposition: Disposition) => {
    setReviewState(prev => prev ? { ...prev, disposition } : null);
  }, []);

  const handleNotesChange = useCallback((notes: string) => {
    setReviewState(prev => prev ? { ...prev, notes } : null);
  }, []);

  const handleConfirmReview = useCallback(async () => {
    if (!reviewState) return;
    
    setIsSubmitting(true);
    try {
      // Update disposition for each signal type
      for (const signal of reviewState.signals) {
        await updateDisposition({
          phoneNumber: reviewState.phoneNumber,
          signalType: signal.signalType,
          disposition: reviewState.disposition,
          reviewedBy: reviewerId,
        });
      }
      setReviewState(null);
    } catch (error) {
      console.error('Failed to update disposition:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [reviewState, reviewerId, updateDisposition]);

  const handleBlockNumber = useCallback(async () => {
    if (!blockingNumber) return;
    
    setIsSubmitting(true);
    try {
      await blockNumber({
        phoneNumber: blockingNumber,
        reviewedBy: reviewerId,
      });
      setBlockingNumber(null);
    } catch (error) {
      console.error('Failed to block number:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [blockingNumber, reviewerId, blockNumber]);

  const handleUnblockNumber = useCallback(async () => {
    if (!unblockingNumber) return;
    
    setIsSubmitting(true);
    try {
      await unblockNumber({
        phoneNumber: unblockingNumber,
        reviewedBy: reviewerId,
      });
      setUnblockingNumber(null);
    } catch (error) {
      console.error('Failed to unblock number:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [unblockingNumber, reviewerId, unblockNumber]);

  // Loading state
  const isLoading = fraudStats === undefined || flaggedNumbers === undefined || blockedNumbers === undefined;

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-500" />
            <p className="text-white/60 text-sm">Loading fraud data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Fraud Review</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Monitor and manage suspicious activity
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatsCard
          title="Total Signals"
          value={fraudStats?.totalSignals || 0}
          icon={ShieldAlert}
          iconColor="text-amber-400"
        />
        <StatsCard
          title="Unique Numbers"
          value={fraudStats?.uniquePhoneNumbers || 0}
          icon={Phone}
          iconColor="text-blue-400"
        />
        <StatsCard
          title="Blocked Numbers"
          value={fraudStats?.blockedPhoneNumbers || 0}
          icon={ShieldX}
          iconColor="text-red-400"
        />
        <StatsCard
          title="Pending Review"
          value={fraudStats?.byDisposition.pending_review || 0}
          icon={Clock}
          iconColor="text-purple-400"
        />
      </div>

      {/* Signal Type Breakdown */}
      <div className="card p-4">
        <h3 className="text-sm font-medium text-white mb-3">Signals by Type</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(Object.entries(SIGNAL_TYPE_INFO) as [SignalType, typeof SIGNAL_TYPE_INFO[SignalType]][]).map(
            ([type, info]) => {
              const Icon = info.icon;
              const count = fraudStats?.bySignalType[type] || 0;
              return (
                <div
                  key={type}
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className={cn("p-2 rounded-lg border", info.color)}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{info.label}</p>
                    <p className="text-xs text-white/40">{count} signals</p>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <TabButton
          active={activeTab === 'flagged'}
          onClick={() => setActiveTab('flagged')}
          count={flaggedNumbers?.length || 0}
        >
          <AlertTriangle size={16} />
          Flagged Numbers
        </TabButton>
        <TabButton
          active={activeTab === 'blocked'}
          onClick={() => setActiveTab('blocked')}
          count={blockedNumbers?.length || 0}
        >
          <Ban size={16} />
          Blocked Numbers
        </TabButton>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by phone number..."
              className="input-dark w-full pl-10 rounded-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          {/* Signal Type Filter (only for flagged tab) */}
          {activeTab === 'flagged' && (
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <select
                value={filterSignalType}
                onChange={(e) => setFilterSignalType(e.target.value as SignalType | 'all')}
                className="input-dark pl-10 pr-8 rounded-lg appearance-none cursor-pointer min-w-[180px]"
              >
                <option value="all">All Signal Types</option>
                {(Object.entries(SIGNAL_TYPE_INFO) as [SignalType, typeof SIGNAL_TYPE_INFO[SignalType]][]).map(
                  ([type, info]) => (
                    <option key={type} value={type}>{info.label}</option>
                  )
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Flagged Numbers Table */}
      {activeTab === 'flagged' && (
        <div className="card overflow-hidden">
          {filteredFlagged.length === 0 ? (
            flaggedNumbers?.length === 0 ? (
              <EmptyState
                title="No flagged numbers"
                description="No phone numbers have been flagged for suspicious activity. The system will automatically flag numbers when fraud signals are detected."
                icon={ShieldCheck}
              />
            ) : (
              <EmptyState
                title="No results found"
                description="No flagged numbers match your search criteria."
                icon={Search}
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Phone Number
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Signal Types
                    </th>
                    <th className="text-center p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Total Signals
                    </th>
                    <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFlagged.map((item) => (
                    <FlaggedNumberRow
                      key={item.phoneNumber}
                      item={item as FlaggedNumber}
                      onReview={() => handleOpenReview(item as FlaggedNumber)}
                      onBlock={() => setBlockingNumber(item.phoneNumber)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Blocked Numbers Table */}
      {activeTab === 'blocked' && (
        <div className="card overflow-hidden">
          {filteredBlocked.length === 0 ? (
            blockedNumbers?.length === 0 ? (
              <EmptyState
                title="No blocked numbers"
                description="No phone numbers have been blocked yet. Numbers can be blocked manually or automatically when fraud is confirmed."
                icon={ShieldCheck}
              />
            ) : (
              <EmptyState
                title="No results found"
                description="No blocked numbers match your search criteria."
                icon={Search}
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Phone Number
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Blocked Date
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Blocked By
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Signals
                    </th>
                    <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBlocked.map((item) => (
                    <BlockedNumberRow
                      key={item.phoneNumber}
                      item={item as BlockedNumber}
                      onUnblock={() => setUnblockingNumber(item.phoneNumber)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Review Modal */}
      <Modal
        isOpen={!!reviewState}
        onClose={handleCloseReview}
        title="Review Flagged Number"
        description="Review the fraud signals and select a disposition"
        size="lg"
      >
        {reviewState && (
          <ReviewModalContent
            reviewState={reviewState}
            onDispositionChange={handleDispositionChange}
            onNotesChange={handleNotesChange}
            onConfirm={handleConfirmReview}
            onCancel={handleCloseReview}
            isSubmitting={isSubmitting}
          />
        )}
      </Modal>

      {/* Block Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!blockingNumber}
        onClose={() => setBlockingNumber(null)}
        onConfirm={handleBlockNumber}
        title="Block Phone Number"
        message={`Are you sure you want to block ${blockingNumber ? formatPhoneNumber(blockingNumber) : 'this number'}? Calls from this number will be rejected or require human verification.`}
        confirmText="Block Number"
        cancelText="Cancel"
        variant="danger"
        loading={isSubmitting}
      />

      {/* Unblock Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!unblockingNumber}
        onClose={() => setUnblockingNumber(null)}
        onConfirm={handleUnblockNumber}
        title="Unblock Phone Number"
        message={`Are you sure you want to unblock ${unblockingNumber ? formatPhoneNumber(unblockingNumber) : 'this number'}? This will allow calls from this number to be processed normally.`}
        confirmText="Unblock Number"
        cancelText="Cancel"
        variant="warning"
        loading={isSubmitting}
      />
    </div>
  );
}

export default FraudReviewDashboard;
