/**
 * Phone Number Provisioning — Scheduled Functions
 *
 * Convex scheduled functions for automated number lifecycle management:
 * - processQuarantineExpirations: Handles expired quarantine numbers
 * - replenishNumberPool: Maintains minimum pool levels per region
 * - runHealthChecks: Monitors assigned number health at providers
 *
 * Requirements: 4.5, 4.6, 5.1, 5.2, 5.3, 5.6, 7.1, 7.2, 7.3, 7.4,
 *               7.5, 7.6, 12.1, 12.2, 12.5
 */

import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import {
  DEFAULT_POOL_MIN,
  type ProvisioningRegion,
} from "../shared/phoneProvisioningTypes";
import { generateNumberId } from "./providerRouting";

// ─── Structured logger (mirrors mutations.ts / actions.ts pattern) ──────────

function createLogger(module: string) {
  const emit = (
    level: "info" | "warn" | "error",
    message: string,
    ctx?: Record<string, unknown>,
  ) => {
    const entry = {
      level,
      module,
      message,
      timestamp: new Date().toISOString(),
      ...ctx,
    };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  };
  return {
    info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
    warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
  };
}

const logger = createLogger("phoneProvisioning/scheduledFunctions");


/** Active regions to manage pools for */
const ACTIVE_REGIONS: ProvisioningRegion[] = [
  "nigeria",
  "ghana",
  "kenya",
  "south_africa",
  "default",
];

/** Region to country code mapping for pool replenishment purchases */
const REGION_COUNTRY_CODES: Record<ProvisioningRegion, string> = {
  nigeria: "NG",
  ghana: "GH",
  kenya: "KE",
  south_africa: "ZA",
  default: "US",
};

// ─── 1. processQuarantineExpirations ────────────────────────────────────────
// Req 4.5, 4.6, 12.1, 12.2, 12.5
//
// Runs every 6 hours. For each quarantined number whose quarantineExpiresAt
// has passed:
//   - If the pool for that region is below minimum → retain in pool (status "available")
//   - If the pool is at/above minimum → release back to provider (status "released")
//
// This is an internalAction because it needs to call both internal queries,
// internal mutations, and the releaseNumberAtProvider action.

export const processQuarantineExpirations = internalAction({
  args: {},
  handler: async (ctx) => {
    logger.info("Processing quarantine expirations", {
      action: "quarantine_expiry",
    });

    // Query expired quarantined numbers
    const expiredNumbers = await ctx.runQuery(
      internal.phoneProvisioning.queries.getExpiredQuarantineNumbers,
      {},
    );

    if (expiredNumbers.length === 0) {
      logger.info("No expired quarantine numbers to process", {
        action: "quarantine_expiry",
      });
      return { processed: 0, retained: 0, released: 0 };
    }

    let retained = 0;
    let released = 0;

    for (const number of expiredNumbers) {
      try {
        // Count available numbers in this region
        const availableCount = await ctx.runQuery(
          internal.phoneProvisioning.queries.getAvailableCountByRegion,
          { region: number.region },
        );

        if (availableCount < DEFAULT_POOL_MIN) {
          // Req 12.2 — pool below minimum: retain number as "available"
          await ctx.runMutation(
            internal.phoneProvisioning.mutations.retainQuarantinedNumber,
            { phoneNumberId: number.numberId },
          );

          logger.info("Quarantined number retained in pool", {
            action: "quarantine_expiry",
            numberId: number.numberId,
            phoneNumber: number.phoneNumber,
            provider: number.provider,
            region: number.region,
            availableCount,
            poolMinimum: DEFAULT_POOL_MIN,
            reason: "pool_below_minimum",
          });

          retained++;
        } else {
          // Req 12.1 — pool at/above minimum: release back to provider
          if (number.providerNumberSid) {
            const releaseResult = await ctx.runAction(
              internal.phoneProvisioning.actions.releaseNumberAtProvider,
              {
                provider: number.provider as any,
                providerNumberSid: number.providerNumberSid,
              },
            );

            if (!releaseResult.success) {
              logger.error("Failed to release number at provider", {
                action: "quarantine_expiry",
                numberId: number.numberId,
                phoneNumber: number.phoneNumber,
                provider: number.provider,
                error: releaseResult.error,
              });
              // Continue processing other numbers
              continue;
            }
          }

          // Mark as released in DB
          await ctx.runMutation(
            internal.phoneProvisioning.mutations.markNumberReleased,
            { phoneNumberId: number.numberId },
          );

          // Req 12.5 — log release
          logger.info("Quarantined number released to provider", {
            action: "quarantine_expiry",
            numberId: number.numberId,
            phoneNumber: number.phoneNumber,
            provider: number.provider,
            region: number.region,
            availableCount,
            poolMinimum: DEFAULT_POOL_MIN,
            reason: "quarantine_expired",
          });

          released++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error processing quarantine expiration for number", {
          action: "quarantine_expiry",
          numberId: number.numberId,
          phoneNumber: number.phoneNumber,
          error: message,
        });
      }
    }

    logger.info("Quarantine expiration processing complete", {
      action: "quarantine_expiry",
      processed: expiredNumbers.length,
      retained,
      released,
    });

    return { processed: expiredNumbers.length, retained, released };
  },
});


// ─── 2. replenishNumberPool ─────────────────────────────────────────────────
// Req 5.1, 5.2, 5.3, 5.6
//
// Runs every 1 hour. For each active region, counts available numbers.
// If below DEFAULT_POOL_MIN, purchases enough numbers to reach the minimum
// via purchaseNumberFromProvider, then inserts them via insertPhoneNumber.

export const replenishNumberPool = internalAction({
  args: {},
  handler: async (ctx) => {
    logger.info("Replenishing number pool", {
      action: "pool_replenish",
    });

    let totalPurchased = 0;

    for (const region of ACTIVE_REGIONS) {
      try {
        const availableCount = await ctx.runQuery(
          internal.phoneProvisioning.queries.getAvailableCountByRegion,
          { region },
        );

        if (availableCount >= DEFAULT_POOL_MIN) {
          continue; // Pool is healthy for this region
        }

        const deficit = DEFAULT_POOL_MIN - availableCount;
        const countryCode = REGION_COUNTRY_CODES[region];

        logger.info("Pool below minimum, purchasing numbers", {
          action: "pool_replenish",
          region,
          availableCount,
          poolMinimum: DEFAULT_POOL_MIN,
          deficit,
        });

        let purchased = 0;

        for (let i = 0; i < deficit; i++) {
          try {
            const result = await ctx.runAction(
              internal.phoneProvisioning.actions.purchaseNumberFromProvider,
              {
                provider: getRegionPrimaryProvider(region),
                region,
                countryCode,
              },
            );

            if (!result.success) {
              logger.error("Failed to purchase number for pool replenishment", {
                action: "pool_replenish",
                region,
                countryCode,
                error: result.error,
                purchasedSoFar: purchased,
                deficit,
              });
              // Continue trying to purchase remaining numbers
              continue;
            }

            // Insert the purchased number into the pool
            const numberId = generateNumberId();
            await ctx.runMutation(
              internal.phoneProvisioning.mutations.insertPhoneNumber,
              {
                numberId,
                phoneNumber: result.phoneNumber!,
                provider: getRegionPrimaryProvider(region),
                status: "available",
                capabilities: ["voice", "sms"],
                region,
                countryCode,
                createdAt: Date.now(),
                providerNumberSid: result.numberSid!,
                monthlyCost: result.monthlyCost!,
                currency: result.currency!,
                healthStatus: "healthy",
              },
            );

            logger.info("Number purchased and added to pool", {
              action: "pool_replenish",
              numberId,
              phoneNumber: result.phoneNumber,
              provider: getRegionPrimaryProvider(region),
              region,
              countryCode,
            });

            purchased++;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error("Error purchasing number for pool", {
              action: "pool_replenish",
              region,
              error: message,
              purchasedSoFar: purchased,
              deficit,
            });
          }
        }

        totalPurchased += purchased;

        if (purchased < deficit) {
          // Emit warning alert if we couldn't fully replenish
          logger.warn("Pool replenishment incomplete for region", {
            action: "pool_replenish",
            region,
            purchased,
            deficit,
            shortfall: deficit - purchased,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error replenishing pool for region", {
          action: "pool_replenish",
          region,
          error: message,
        });
      }
    }

    logger.info("Pool replenishment complete", {
      action: "pool_replenish",
      totalPurchased,
      regionsChecked: ACTIVE_REGIONS.length,
    });

    return { totalPurchased, regionsChecked: ACTIVE_REGIONS.length };
  },
});

/**
 * Helper: get the primary provider for a region.
 * Uses the same routing table logic as providerRouting.ts.
 */
function getRegionPrimaryProvider(
  region: ProvisioningRegion,
): "twilio" | "vonage" | "africas_talking" | "termii" {
  const providers: Record<ProvisioningRegion, "twilio" | "vonage" | "africas_talking" | "termii"> = {
    nigeria: "termii",
    ghana: "africas_talking",
    kenya: "africas_talking",
    south_africa: "africas_talking",
    default: "twilio",
  };
  return providers[region];
}


// ─── 3. runHealthChecks ─────────────────────────────────────────────────────
// Req 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
//
// Runs every 4 hours. Queries all "assigned" numbers, calls checkNumberHealth
// for each, updates healthStatus and lastHealthCheckAt, emits warning alert
// for unreachable numbers.

export const runHealthChecks = internalAction({
  args: {},
  handler: async (ctx) => {
    logger.info("Running health checks on assigned numbers", {
      action: "health_check",
    });

    const assignedNumbers = await ctx.runQuery(
      internal.phoneProvisioning.queries.getAssignedNumbers,
      {},
    );

    if (assignedNumbers.length === 0) {
      logger.info("No assigned numbers to health check", {
        action: "health_check",
      });
      return { checked: 0, healthy: 0, degraded: 0, unreachable: 0 };
    }

    let healthy = 0;
    let degraded = 0;
    let unreachable = 0;

    for (const number of assignedNumbers) {
      try {
        if (!number.providerNumberSid) {
          logger.warn("Skipping health check: no providerNumberSid", {
            action: "health_check",
            numberId: number.numberId,
            phoneNumber: number.phoneNumber,
          });
          continue;
        }

        // Req 7.1 — call provider API to check number health
        const healthResult = await ctx.runAction(
          internal.phoneProvisioning.actions.checkNumberHealth,
          {
            provider: number.provider as any,
            providerNumberSid: number.providerNumberSid,
          },
        );

        // Req 7.6 — update healthStatus and lastHealthCheckAt
        await ctx.runMutation(
          internal.phoneProvisioning.mutations.updateHealthStatus,
          {
            phoneNumberId: number.numberId,
            healthStatus: healthResult.healthStatus,
          },
        );

        // Track counts
        switch (healthResult.healthStatus) {
          case "healthy":
            // Req 7.5 — previously unhealthy number now healthy
            if (number.healthStatus !== "healthy") {
              logger.info("Number health restored", {
                action: "health_check",
                numberId: number.numberId,
                phoneNumber: number.phoneNumber,
                provider: number.provider,
                previousStatus: number.healthStatus,
                newStatus: "healthy",
              });
            }
            healthy++;
            break;

          case "degraded":
            // Req 7.4 — webhook misconfigured but number active
            logger.warn("Number health degraded", {
              action: "health_check",
              numberId: number.numberId,
              phoneNumber: number.phoneNumber,
              provider: number.provider,
              region: number.region,
              details: healthResult.details,
            });
            degraded++;
            break;

          case "unreachable":
            // Req 7.3 — unreachable: emit warning alert
            logger.warn("Number unreachable", {
              action: "health_check",
              numberId: number.numberId,
              phoneNumber: number.phoneNumber,
              provider: number.provider,
              region: number.region,
              details: healthResult.details,
            });

            await ctx.runMutation(api.monitoringAlerts.createAlert, {
              severity: "warning" as const,
              title: "Phone number unreachable",
              message: `Number ${number.phoneNumber} (${number.numberId}) is unreachable at provider ${number.provider}. ${healthResult.details ?? ""}`.trim(),
              metricType: "uptime_check" as const,
              currentValue: 0,
              threshold: 1,
              context: JSON.stringify({
                numberId: number.numberId,
                phoneNumber: number.phoneNumber,
                provider: number.provider,
                region: number.region,
                assignedToType: number.assignedToType,
                assignedToId: number.assignedToId,
              }),
            });

            unreachable++;
            break;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Error running health check for number", {
          action: "health_check",
          numberId: number.numberId,
          phoneNumber: number.phoneNumber,
          error: message,
        });
      }
    }

    logger.info("Health checks complete", {
      action: "health_check",
      checked: assignedNumbers.length,
      healthy,
      degraded,
      unreachable,
    });

    return {
      checked: assignedNumbers.length,
      healthy,
      degraded,
      unreachable,
    };
  },
});
