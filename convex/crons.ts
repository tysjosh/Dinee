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

export default crons;
