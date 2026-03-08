import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Clean up expired idempotency keys every hour.
 * Deletes records where expiresAt < now in batches of 100.
 *
 * Requirements: 21.5
 */
crons.interval(
  "cleanup expired idempotency keys",
  { hours: 1 },
  internal.logistics.idempotencyKeys.cleanupExpiredKeys
);

/**
 * Process pending webhook delivery retries every 60 seconds.
 * Queries by_next_retry_at index, attempts re-delivery, updates records.
 *
 * Requirements: 20.7
 */
crons.interval(
  "process webhook retries",
  { seconds: 60 },
  internal.webhookDeliveries.processRetries
);

/**
 * Compute daily KPI snapshots for all verticals.
 * Runs once per day at midnight UTC.
 *
 * Requirements: 15.6
 */
crons.daily(
  "compute daily KPI snapshots",
  { hourUTC: 0, minuteUTC: 5 },
  internal.kpiComputation.computeDailySnapshots
);

/**
 * Check for expired trial subscriptions daily.
 * Transitions trialing subs where trialEndsAt < now to past_due.
 *
 * Requirements: 4.1
 */
crons.daily(
  "check-trial-expiry",
  { hourUTC: 2, minuteUTC: 0 },
  internal.subscriptions.checkTrialExpiry
);

/**
 * Enforce past_due subscription policy daily.
 * Cancels subscriptions that have been past_due for 7+ days.
 *
 * Requirements: 4.5
 */
crons.daily(
  "enforce-past-due",
  { hourUTC: 3, minuteUTC: 0 },
  internal.subscriptions.enforcePastDue
);

/**
 * Apply pending plan changes on renewal daily.
 * Processes subscriptions with pendingPlanId where currentPeriodEnd has passed.
 *
 * Requirements: 6.5
 */
crons.daily(
  "apply-pending-plan-changes",
  { hourUTC: 4, minuteUTC: 0 },
  internal.subscriptions.applyPendingPlanChanges
);

/**
 * Process quarantine expirations every 6 hours.
 * Transitions expired quarantined numbers to "available" (retain in pool)
 * or "released" (release back to provider) based on pool levels.
 *
 * Requirements: 4.6
 */
crons.interval(
  "process quarantine expirations",
  { hours: 6 },
  internal.phoneProvisioning.scheduledFunctions.processQuarantineExpirations
);

/**
 * Replenish the phone number pool every hour.
 * Checks available number counts per region and purchases numbers
 * to bring pools back to the configured minimum level.
 *
 * Requirements: 5.2
 */
crons.interval(
  "replenish number pool",
  { hours: 1 },
  internal.phoneProvisioning.scheduledFunctions.replenishNumberPool
);

/**
 * Run health checks on assigned phone numbers every 4 hours.
 * Verifies each assigned number is active and properly configured
 * at the telecom provider, updating healthStatus accordingly.
 *
 * Requirements: 7.2
 */
crons.interval(
  "run phone number health checks",
  { hours: 4 },
  internal.phoneProvisioning.scheduledFunctions.runHealthChecks
);

export default crons;
