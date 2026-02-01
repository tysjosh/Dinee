/**
 * BillingDashboard - Dashboard component for subscription billing management
 * 
 * This component provides:
 * - Current plan display with upgrade/downgrade options
 * - Usage tracking with progress bars
 * - Billing history table
 * - Plan comparison section
 * - Billing reminders and alerts
 * 
 * @see Requirements: 26.5, 26.6
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  CreditCard,
  Calendar,
  TrendingUp,
  AlertTriangle,
  Check,
  X,
  ChevronRight,
  Download,
  Clock,
  Building2,
  Phone,
  ShoppingCart,
  UtensilsCrossed,
  Users,
  Star,
  Zap,
  Shield,
  MessageSquare,
  BarChart3,
  Code,
  Headphones,
  Mic,
  Globe,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Modal } from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import {
  SUBSCRIPTION_PLANS,
  getPlanById,
  formatNairaPrice,
  calculateYearlySavings,
  isUnlimited,
  getPlanComparisonData,
} from '@/lib/billing/SubscriptionService';
import type {
  SubscriptionPlan,
  Subscription,
  SubscriptionInvoice,
  BillingCycle,
} from '@/lib/billing/types';


// ============================================================================
// Types
// ============================================================================

export interface BillingDashboardProps {
  /** Restaurant ID for fetching subscription data */
  restaurantId: string;
  /** Optional class name */
  className?: string;
  /** Callback when plan change is requested */
  onChangePlan?: (planId: string, billingCycle: BillingCycle) => void;
}

interface UsageData {
  branchCount: number;
  callsThisPeriod: number;
  ordersThisPeriod: number;
  menuItemCount: number;
  teamMemberCount: number;
}

// ============================================================================
// Constants
// ============================================================================

const FEATURE_ICONS: Record<string, React.ElementType> = {
  whatsappMessaging: MessageSquare,
  smsMessaging: MessageSquare,
  advancedAnalytics: BarChart3,
  apiAccess: Code,
  prioritySupport: Headphones,
  customAgentVoice: Mic,
  multiLanguageSupport: Globe,
  upsellPrompts: TrendingUp,
  fraudDetection: Shield,
  csvExport: FileText,
};

const FEATURE_LABELS: Record<string, string> = {
  whatsappMessaging: 'WhatsApp Messaging',
  smsMessaging: 'SMS Messaging',
  advancedAnalytics: 'Advanced Analytics',
  apiAccess: 'API Access',
  prioritySupport: 'Priority Support',
  customAgentVoice: 'Custom AI Voice',
  multiLanguageSupport: 'Multi-Language Support',
  upsellPrompts: 'Upsell Prompts',
  fraudDetection: 'Fraud Detection',
  csvExport: 'CSV Export',
};

// ============================================================================
// Utility Functions
// ============================================================================

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
 * Calculate usage percentage
 */
function calculateUsagePercentage(used: number, limit: number): number {
  if (isUnlimited(limit)) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Get usage status color
 */
function getUsageStatusColor(percentage: number): string {
  if (percentage >= 90) return 'text-red-400 bg-red-500/10';
  if (percentage >= 75) return 'text-amber-400 bg-amber-500/10';
  return 'text-emerald-400 bg-emerald-500/10';
}

/**
 * Get progress bar color
 */
function getProgressBarColor(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500';
  if (percentage >= 75) return 'bg-amber-500';
  return 'bg-emerald-500';
}


// ============================================================================
// Sub-components
// ============================================================================

/**
 * Billing reminder alert banner
 * @see Requirements: 26.6 - Send billing reminders before subscription renewal
 */
function BillingReminderBanner({
  daysUntilRenewal,
  planName,
  amount,
}: {
  daysUntilRenewal: number;
  planName: string;
  amount: number;
}) {
  if (daysUntilRenewal > 7) return null;

  const isUrgent = daysUntilRenewal <= 3;

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 rounded-lg border",
        isUrgent
          ? "bg-red-500/10 border-red-500/30 text-red-400"
          : "bg-amber-500/10 border-amber-500/30 text-amber-400"
      )}
    >
      <div className={cn(
        "p-2 rounded-lg",
        isUrgent ? "bg-red-500/20" : "bg-amber-500/20"
      )}>
        <AlertTriangle size={20} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-white">
          {isUrgent ? 'Renewal Due Soon!' : 'Upcoming Renewal'}
        </p>
        <p className="text-xs text-white/60 mt-0.5">
          Your {planName} plan renews in {daysUntilRenewal} day{daysUntilRenewal !== 1 ? 's' : ''}.
          Amount due: {formatNairaPrice(amount)}
        </p>
      </div>
      <Button variant="outline" size="sm" className="btn btn-outline btn-sm">
        <CreditCard size={14} className="mr-1" />
        Pay Now
      </Button>
    </div>
  );
}

/**
 * Current plan card component
 */
function CurrentPlanCard({
  subscription,
  plan,
  onUpgrade,
  onDowngrade,
}: {
  subscription: Subscription;
  plan: SubscriptionPlan;
  onUpgrade: () => void;
  onDowngrade: () => void;
}) {
  const daysUntilRenewal = Math.ceil(
    (subscription.currentPeriodEnd - Date.now()) / (24 * 60 * 60 * 1000)
  );

  const statusBadge = {
    active: { variant: 'success' as const, label: 'Active' },
    trialing: { variant: 'info' as const, label: 'Trial' },
    past_due: { variant: 'error' as const, label: 'Past Due' },
    cancelled: { variant: 'neutral' as const, label: 'Cancelled' },
  };

  const status = statusBadge[subscription.status];

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
            {plan.isRecommended && (
              <Badge variant="info">
                <Star size={12} className="mr-1" />
                Recommended
              </Badge>
            )}
          </div>
          <p className="text-sm text-white/60">{plan.description}</p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-xs text-white/40 mb-1">Current Price</p>
          <p className="text-xl font-semibold text-white">
            {formatNairaPrice(
              subscription.billingCycle === 'yearly'
                ? plan.priceYearly
                : plan.priceMonthly
            )}
            <span className="text-sm text-white/40 font-normal">
              /{subscription.billingCycle === 'yearly' ? 'year' : 'month'}
            </span>
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-xs text-white/40 mb-1">Next Renewal</p>
          <p className="text-xl font-semibold text-white">
            {daysUntilRenewal}
            <span className="text-sm text-white/40 font-normal"> days</span>
          </p>
          <p className="text-xs text-white/40">{formatDate(subscription.currentPeriodEnd)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-4 border-t border-white/10">
        <Button
          variant="outline"
          size="sm"
          onClick={onDowngrade}
          className="btn btn-outline btn-sm"
          disabled={plan.id === 'starter'}
        >
          Downgrade
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onUpgrade}
          className="btn btn-primary btn-sm"
          disabled={plan.id === 'enterprise'}
        >
          <Zap size={14} className="mr-1" />
          Upgrade
        </Button>
      </div>
    </div>
  );
}


/**
 * Usage progress bar component
 */
function UsageProgressBar({
  label,
  icon: Icon,
  used,
  limit,
}: {
  label: string;
  icon: React.ElementType;
  used: number;
  limit: number;
}) {
  const percentage = calculateUsagePercentage(used, limit);
  const isUnlimitedPlan = isUnlimited(limit);

  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-white/40" />
          <span className="text-sm text-white/80">{label}</span>
        </div>
        <span className="text-sm text-white/60">
          {used.toLocaleString()}
          {!isUnlimitedPlan && (
            <span className="text-white/40"> / {limit.toLocaleString()}</span>
          )}
          {isUnlimitedPlan && (
            <span className="text-emerald-400 text-xs ml-1">Unlimited</span>
          )}
        </span>
      </div>
      {!isUnlimitedPlan && (
        <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all",
              getProgressBarColor(percentage)
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {!isUnlimitedPlan && percentage >= 75 && (
        <p className={cn(
          "text-xs mt-1",
          percentage >= 90 ? "text-red-400" : "text-amber-400"
        )}>
          {percentage >= 90 ? 'Limit almost reached!' : 'Approaching limit'}
        </p>
      )}
    </div>
  );
}

/**
 * Usage section component
 * @see Requirements: 26.5 - Display current plan, usage
 */
function UsageSection({
  usage,
  limits,
}: {
  usage: UsageData;
  limits: {
    maxBranches: number;
    maxCallsPerMonth: number;
    maxOrdersPerMonth: number;
    maxMenuItems: number;
    maxTeamMembers: number;
  };
}) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Usage This Period</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <UsageProgressBar
          label="Branches"
          icon={Building2}
          used={usage.branchCount}
          limit={limits.maxBranches}
        />
        <UsageProgressBar
          label="Calls"
          icon={Phone}
          used={usage.callsThisPeriod}
          limit={limits.maxCallsPerMonth}
        />
        <UsageProgressBar
          label="Orders"
          icon={ShoppingCart}
          used={usage.ordersThisPeriod}
          limit={limits.maxOrdersPerMonth}
        />
        <UsageProgressBar
          label="Menu Items"
          icon={UtensilsCrossed}
          used={usage.menuItemCount}
          limit={limits.maxMenuItems}
        />
        <UsageProgressBar
          label="Team Members"
          icon={Users}
          used={usage.teamMemberCount}
          limit={limits.maxTeamMembers}
        />
      </div>
    </div>
  );
}


/**
 * Invoice row component
 */
function InvoiceRow({ invoice }: { invoice: SubscriptionInvoice }) {
  const statusBadge = {
    pending: { variant: 'warning' as const, label: 'Pending' },
    paid: { variant: 'success' as const, label: 'Paid' },
    failed: { variant: 'error' as const, label: 'Failed' },
    refunded: { variant: 'neutral' as const, label: 'Refunded' },
  };

  const status = statusBadge[invoice.status];

  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/5 text-white/40">
            <FileText size={16} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">{invoice.invoiceId}</p>
            <p className="text-xs text-white/40">
              {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
            </p>
          </div>
        </div>
      </td>
      <td className="p-4">
        <p className="text-sm text-white/80">{formatDateTime(invoice.createdAt)}</p>
      </td>
      <td className="p-4">
        <p className="text-sm font-medium text-white">
          {formatNairaPrice(invoice.amount)}
        </p>
      </td>
      <td className="p-4">
        <Badge variant={status.variant}>{status.label}</Badge>
      </td>
      <td className="p-4">
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="btn btn-ghost btn-sm"
            title="Download Invoice"
          >
            <Download size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Billing history section component
 * @see Requirements: 26.5 - Display billing history
 */
function BillingHistorySection({ invoices }: { invoices: SubscriptionInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Billing History</h3>
        <div className="text-center py-8">
          <FileText className="h-12 w-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/60 text-sm">No invoices yet</p>
          <p className="text-white/40 text-xs mt-1">
            Your billing history will appear here after your first payment
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-white/10">
        <h3 className="text-lg font-semibold text-white">Billing History</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                Invoice
              </th>
              <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                Date
              </th>
              <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                Amount
              </th>
              <th className="text-left p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                Status
              </th>
              <th className="text-right p-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.invoiceId} invoice={invoice} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/**
 * Plan card for comparison
 */
function PlanComparisonCard({
  plan,
  isCurrentPlan,
  billingCycle,
  onSelect,
}: {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  billingCycle: BillingCycle;
  onSelect: () => void;
}) {
  const price = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
  const monthlyEquivalent = billingCycle === 'yearly' 
    ? Math.round(plan.priceYearly / 12) 
    : plan.priceMonthly;
  const savings = calculateYearlySavings(plan);

  return (
    <div
      className={cn(
        "card p-6 relative",
        isCurrentPlan && "ring-2 ring-emerald-500",
        plan.isRecommended && !isCurrentPlan && "ring-1 ring-blue-500/50"
      )}
    >
      {isCurrentPlan && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="success">Current Plan</Badge>
        </div>
      )}
      {plan.isRecommended && !isCurrentPlan && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="info">
            <Star size={12} className="mr-1" />
            Recommended
          </Badge>
        </div>
      )}

      <div className="text-center mb-6 pt-2">
        <h4 className="text-xl font-semibold text-white mb-1">{plan.name}</h4>
        <p className="text-sm text-white/60 mb-4">{plan.description}</p>
        <div className="mb-2">
          <span className="text-3xl font-bold text-white">
            {formatNairaPrice(monthlyEquivalent)}
          </span>
          <span className="text-white/40">/month</span>
        </div>
        {billingCycle === 'yearly' && (
          <p className="text-xs text-emerald-400">
            Save {formatNairaPrice(savings)}/year
          </p>
        )}
      </div>

      {/* Limits */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Branches</span>
          <span className="text-white font-medium">
            {isUnlimited(plan.limits.maxBranches) ? 'Unlimited' : plan.limits.maxBranches}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Calls/month</span>
          <span className="text-white font-medium">
            {isUnlimited(plan.limits.maxCallsPerMonth) ? 'Unlimited' : plan.limits.maxCallsPerMonth.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Orders/month</span>
          <span className="text-white font-medium">
            {isUnlimited(plan.limits.maxOrdersPerMonth) ? 'Unlimited' : plan.limits.maxOrdersPerMonth.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Menu items</span>
          <span className="text-white font-medium">
            {isUnlimited(plan.limits.maxMenuItems) ? 'Unlimited' : plan.limits.maxMenuItems}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Team members</span>
          <span className="text-white font-medium">
            {isUnlimited(plan.limits.maxTeamMembers) ? 'Unlimited' : plan.limits.maxTeamMembers}
          </span>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-2 mb-6 pt-4 border-t border-white/10">
        {Object.entries(plan.features).map(([key, enabled]) => {
          const Icon = FEATURE_ICONS[key] || Check;
          const label = FEATURE_LABELS[key] || key;
          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              {enabled ? (
                <Check size={14} className="text-emerald-400" />
              ) : (
                <X size={14} className="text-white/20" />
              )}
              <span className={enabled ? 'text-white/80' : 'text-white/40'}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <Button
        variant={isCurrentPlan ? 'outline' : 'primary'}
        fullWidth
        onClick={onSelect}
        disabled={isCurrentPlan}
        className={cn(
          "btn btn-md w-full",
          isCurrentPlan ? "btn-outline" : "btn-primary"
        )}
      >
        {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
      </Button>
    </div>
  );
}


/**
 * Plan comparison section
 */
function PlanComparisonSection({
  currentPlanId,
  billingCycle,
  onBillingCycleChange,
  onSelectPlan,
}: {
  currentPlanId: string;
  billingCycle: BillingCycle;
  onBillingCycleChange: (cycle: BillingCycle) => void;
  onSelectPlan: (planId: string) => void;
}) {
  const activePlans = SUBSCRIPTION_PLANS.filter(p => p.isActive);

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">Compare Plans</h3>
          <p className="text-sm text-white/60">Choose the plan that fits your needs</p>
        </div>
        
        {/* Billing cycle toggle */}
        <div className="flex rounded-lg bg-white/5 p-1">
          <button
            onClick={() => onBillingCycleChange('monthly')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              billingCycle === 'monthly'
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-white/60 hover:text-white/80"
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => onBillingCycleChange('yearly')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1",
              billingCycle === 'yearly'
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-white/60 hover:text-white/80"
            )}
          >
            Yearly
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
              Save 17%
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {activePlans.map((plan) => (
          <PlanComparisonCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={plan.id === currentPlanId}
            billingCycle={billingCycle}
            onSelect={() => onSelectPlan(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state when no subscription exists
 */
function NoSubscriptionState({ onSelectPlan }: { onSelectPlan: () => void }) {
  return (
    <div className="text-center py-12">
      <CreditCard className="h-16 w-16 text-white/20 mx-auto mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">No Active Subscription</h3>
      <p className="text-white/60 text-sm mb-6 max-w-md mx-auto">
        Choose a subscription plan to unlock all features and start managing your restaurant calls with AI.
      </p>
      <Button onClick={onSelectPlan} className="btn btn-primary btn-lg">
        <Zap size={18} className="mr-2" />
        Choose a Plan
      </Button>
    </div>
  );
}


// ============================================================================
// Main Component
// ============================================================================

/**
 * BillingDashboard - Main billing dashboard component
 * 
 * Displays subscription information, usage metrics, billing history,
 * and plan comparison for restaurant owners.
 * 
 * @see Requirements: 26.5 - Display current plan, usage, billing history
 * @see Requirements: 26.6 - Send billing reminders before subscription renewal
 */
export function BillingDashboard({
  restaurantId,
  className,
  onChangePlan,
}: BillingDashboardProps) {
  // State
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showPlanComparison, setShowPlanComparison] = useState(false);

  // Convex queries
  const subscription = useQuery(api.subscriptions.getSubscriptionByRestaurant, {
    restaurantId,
  });
  
  const invoices = useQuery(api.subscriptions.getInvoicesByRestaurant, {
    restaurantId,
    limit: 10,
  });

  // Get usage data if subscription exists
  const usageQuery = subscription ? {
    restaurantId,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
  } : null;
  
  const usage = useQuery(
    api.subscriptions.getSubscriptionUsage,
    usageQuery ?? 'skip'
  );

  // Derived state
  const plan = subscription ? getPlanById(subscription.planId) : null;
  
  const daysUntilRenewal = subscription
    ? Math.ceil((subscription.currentPeriodEnd - Date.now()) / (24 * 60 * 60 * 1000))
    : 0;

  const renewalAmount = plan
    ? (subscription?.billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly)
    : 0;

  // Handlers
  const handleSelectPlan = useCallback((planId: string) => {
    if (onChangePlan) {
      onChangePlan(planId, billingCycle);
    }
    setShowPlanComparison(false);
  }, [billingCycle, onChangePlan]);

  const handleUpgrade = useCallback(() => {
    setShowPlanComparison(true);
  }, []);

  const handleDowngrade = useCallback(() => {
    setShowPlanComparison(true);
  }, []);

  // Loading state
  const isLoading = subscription === undefined || invoices === undefined;

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-500" />
            <p className="text-white/60 text-sm">Loading billing information...</p>
          </div>
        </div>
      </div>
    );
  }

  // No subscription state
  if (!subscription || !plan) {
    return (
      <div className={cn("space-y-6", className)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-semibold text-white">Billing</h1>
        </div>

        <NoSubscriptionState onSelectPlan={() => setShowPlanComparison(true)} />

        {/* Plan Comparison */}
        <PlanComparisonSection
          currentPlanId=""
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          onSelectPlan={handleSelectPlan}
        />
      </div>
    );
  }

  // Usage data with defaults
  const usageData: UsageData = usage ?? {
    branchCount: 0,
    callsThisPeriod: 0,
    ordersThisPeriod: 0,
    menuItemCount: 0,
    teamMemberCount: 0,
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Billing</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Manage your subscription and billing
          </p>
        </div>
      </div>

      {/* Billing Reminder Banner */}
      <BillingReminderBanner
        daysUntilRenewal={daysUntilRenewal}
        planName={plan.name}
        amount={renewalAmount}
      />

      {/* Current Plan and Usage Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CurrentPlanCard
          subscription={subscription}
          plan={plan}
          onUpgrade={handleUpgrade}
          onDowngrade={handleDowngrade}
        />
        <UsageSection
          usage={usageData}
          limits={plan.limits}
        />
      </div>

      {/* Billing History */}
      <BillingHistorySection invoices={(invoices ?? []) as SubscriptionInvoice[]} />

      {/* Plan Comparison (collapsible) */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowPlanComparison(!showPlanComparison)}
          className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <span className="text-lg font-semibold text-white">Compare Plans</span>
          </div>
          <ChevronRight
            className={cn(
              "h-5 w-5 text-white/40 transition-transform",
              showPlanComparison && "rotate-90"
            )}
          />
        </button>
        
        {showPlanComparison && (
          <div className="p-6 pt-0 border-t border-white/10">
            <PlanComparisonSection
              currentPlanId={subscription.planId}
              billingCycle={billingCycle}
              onBillingCycleChange={setBillingCycle}
              onSelectPlan={handleSelectPlan}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default BillingDashboard;
