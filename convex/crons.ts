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

export default crons;
