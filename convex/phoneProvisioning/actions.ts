"use node";

/**
 * Phone Number Provisioning — Provider API Actions
 *
 * Convex actions for interacting with external telecom provider APIs.
 * Actions can perform side effects (HTTP calls to Twilio, Africa's Talking,
 * Termii) and call internal mutations/actions via ctx.runMutation / ctx.runAction.
 *
 * Provider adapters live in ./providers/ and implement a uniform interface.
 * Twilio uses its Node.js SDK, Africa's Talking uses its npm SDK + REST,
 * Termii uses direct REST API calls. Vonage is stubbed for future use.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.6, 4.3, 6.1,
 *               6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 8.1, 12.3, 12.4
 */

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { api } from "../_generated/api";
import { v } from "convex/values";
import {
  type TelecomProvider,
  type ProvisioningRegion,
  type HealthStatus,
  telecomProviderValidator,
  provisioningRegionValidator,
  MAX_PROVISION_ATTEMPTS,
} from "../shared/phoneProvisioningTypes";
import {
  generateNumberId,
  getNextProvider,
  getProviderOrder,
  classifyError,
  getBackoffDelay,
  validateE164,
} from "./providerRouting";
import { getProviderAdapter } from "./providers";

// ─── Structured logger (mirrors mutations.ts pattern) ───────────────────────

function createLogger(module: string) {
  const emit = (
    level: "info" | "warn" | "error",
    message: string,
    ctx?: Record<string, unknown>,
  ) => {
    const entry = { level, module, message, timestamp: new Date().toISOString(), ...ctx };
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

const logger = createLogger("phoneProvisioning/actions");

// ─── 1. purchaseNumberFromProvider ──────────────────────────────────────────
// Req 2.4, 2.7, 8.1
// Calls provider API to purchase a number, validates voice capability,
// returns number SID, E.164 number, monthly cost, currency.

export const purchaseNumberFromProvider = internalAction({
  args: {
    provider: telecomProviderValidator,
    region: v.string(),
    countryCode: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    success: boolean;
    numberSid?: string;
    phoneNumber?: string;
    monthlyCost?: number;
    currency?: string;
    error?: string;
    errorCode?: string;
  }> => {
    const { provider, region, countryCode } = args;

    logger.info("Purchasing number from provider", {
      action: "purchase",
      provider,
      region,
      countryCode,
    });

    try {
      const adapter = getProviderAdapter(provider as TelecomProvider);
      const result = await adapter.purchaseNumber(region, countryCode);

      if (!result.success) {
        logger.warn("Provider purchase failed", {
          action: "purchase",
          provider,
          region,
          countryCode,
          error: result.error,
          errorCode: result.errorCode,
        });
        return {
          success: false,
          error: result.error,
          errorCode: result.errorCode,
        };
      }

      // Req 2.7 — validate voice capability
      if (!result.capabilities || !result.capabilities.includes("voice")) {
        logger.warn("Purchased number lacks voice capability, rejecting", {
          action: "purchase",
          provider,
          numberSid: result.numberSid,
          phoneNumber: result.phoneNumber,
          capabilities: result.capabilities,
        });
        // Best-effort release of the non-voice number
        try {
          await adapter.releaseNumber(result.numberSid!);
        } catch {
          // cleanup is best-effort
        }
        return {
          success: false,
          error: "Number does not support voice capability",
          errorCode: "no_voice_capability",
        };
      }

      // Validate E.164 format
      if (!validateE164(result.phoneNumber!)) {
        logger.error("Provider returned invalid E.164 number", {
          action: "purchase",
          provider,
          phoneNumber: result.phoneNumber,
        });
        return {
          success: false,
          error: `Invalid E.164 format: ${result.phoneNumber}`,
          errorCode: "invalid_e164",
        };
      }

      logger.info("Number purchased successfully", {
        action: "purchase",
        provider,
        numberSid: result.numberSid,
        phoneNumber: result.phoneNumber,
        monthlyCost: result.monthlyCost,
        currency: result.currency,
        region,
        countryCode,
      });

      return {
        success: true,
        numberSid: result.numberSid,
        phoneNumber: result.phoneNumber,
        monthlyCost: result.monthlyCost,
        currency: result.currency,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to purchase number from provider", {
        action: "purchase",
        provider,
        region,
        countryCode,
        error: message,
      });
      return {
        success: false,
        error: message,
        errorCode: "provider_error",
      };
    }
  },
});


// ─── 2. configureWebhook ────────────────────────────────────────────────────
// Req 2.5, 4.3
// Sets voice webhook URL at the provider for a purchased number.

export const configureWebhook = internalAction({
  args: {
    provider: telecomProviderValidator,
    providerNumberSid: v.string(),
    webhookUrl: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    const { provider, providerNumberSid, webhookUrl } = args;

    logger.info("Configuring webhook for number", {
      action: "configure_webhook",
      provider,
      providerNumberSid,
      webhookUrl,
    });

    try {
      const adapter = getProviderAdapter(provider as TelecomProvider);
      const result = await adapter.configureWebhook(providerNumberSid, webhookUrl);

      if (!result.success) {
        logger.error("Failed to configure webhook", {
          action: "configure_webhook",
          provider,
          providerNumberSid,
          webhookUrl,
          error: result.error,
        });
        return result;
      }

      logger.info("Webhook configured successfully", {
        action: "configure_webhook",
        provider,
        providerNumberSid,
        webhookUrl,
      });

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to configure webhook", {
        action: "configure_webhook",
        provider,
        providerNumberSid,
        webhookUrl,
        error: message,
      });
      return { success: false, error: message };
    }
  },
});

// ─── 3. releaseNumberAtProvider ─────────────────────────────────────────────
// Req 12.3, 12.4
// Releases a number back to the telecom provider.

export const releaseNumberAtProvider = internalAction({
  args: {
    provider: telecomProviderValidator,
    providerNumberSid: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    const { provider, providerNumberSid } = args;

    logger.info("Releasing number at provider", {
      action: "release_at_provider",
      provider,
      providerNumberSid,
    });

    try {
      const adapter = getProviderAdapter(provider as TelecomProvider);
      const result = await adapter.releaseNumber(providerNumberSid);

      if (!result.success) {
        logger.error("Failed to release number at provider", {
          action: "release_at_provider",
          provider,
          providerNumberSid,
          error: result.error,
        });
        return result;
      }

      logger.info("Number released at provider successfully", {
        action: "release_at_provider",
        provider,
        providerNumberSid,
      });

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to release number at provider", {
        action: "release_at_provider",
        provider,
        providerNumberSid,
        error: message,
      });
      return { success: false, error: message };
    }
  },
});

// ─── 4. checkNumberHealth ───────────────────────────────────────────────────
// Req 7.1
// Queries provider for number status, returns health classification.

export const checkNumberHealth = internalAction({
  args: {
    provider: telecomProviderValidator,
    providerNumberSid: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    healthStatus: HealthStatus;
    details?: string;
  }> => {
    const { provider, providerNumberSid } = args;

    logger.info("Checking number health", {
      action: "health_check",
      provider,
      providerNumberSid,
    });

    try {
      const adapter = getProviderAdapter(provider as TelecomProvider);
      const result = await adapter.checkHealth(providerNumberSid);

      if (result.healthStatus !== "healthy") {
        logger.warn("Number health issue detected", {
          action: "health_check",
          provider,
          providerNumberSid,
          healthStatus: result.healthStatus,
          details: result.details,
        });
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Health check failed", {
        action: "health_check",
        provider,
        providerNumberSid,
        error: message,
      });
      return { healthStatus: "unreachable", details: message };
    }
  },
});


// ─── 5. executeProvisioning ─────────────────────────────────────────────────
// Req 2.1–2.7, 3.6, 6.1–6.6
// Orchestrates the full provisioning flow: read request → attempt purchase
// with provider failover → insert phoneNumbers record → assign to branch →
// configure webhook → mark completed. On failure: retry with backoff or
// fall back to shared number.

export const executeProvisioning = internalAction({
  args: {
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const { requestId } = args;

    logger.info("Executing provisioning", { action: "execute_provisioning", requestId });

    // ── Read the provisioning request from DB ──
    const request = await ctx.runQuery(
      internal.phoneProvisioning.queries.getProvisioningRequestInternal,
      { requestId },
    );

    if (!request) {
      logger.error("Provisioning request not found", {
        action: "execute_provisioning",
        requestId,
      });
      return { success: false, error: "Request not found" };
    }

    // Skip if already completed or failed
    if (request.status === "completed") {
      logger.info("Provisioning request already completed", {
        action: "execute_provisioning",
        requestId,
      });
      return { success: true, reason: "already_completed" };
    }

    if (request.status === "failed") {
      logger.info("Provisioning request already failed", {
        action: "execute_provisioning",
        requestId,
      });
      return { success: false, reason: "already_failed" };
    }

    // Mark request as in_progress
    await ctx.runMutation(
      internal.phoneProvisioning.mutations.updateProvisioningRequestStatus,
      {
        requestId,
        status: "in_progress",
        attemptCount: request.attemptCount + 1,
      },
    );

    const currentAttempt = request.attemptCount + 1;
    const region = request.region as ProvisioningRegion;

    // ── Determine which providers have been attempted ──
    // Build the list of attempted providers from the attempt count
    const providerOrder = getProviderOrder(region);
    const attemptedProviders: TelecomProvider[] = [];

    // If we've had previous attempts, mark those providers as attempted
    // Each attempt tries the next provider in order
    for (let i = 0; i < request.attemptCount; i++) {
      if (i < providerOrder.length) {
        attemptedProviders.push(providerOrder[i]);
      }
    }

    // Get the next provider to try
    const provider = getNextProvider(region, attemptedProviders);

    if (!provider) {
      // All providers exhausted — total failure
      logger.error("All providers exhausted for provisioning request", {
        action: "execute_provisioning",
        requestId,
        region,
        attemptCount: currentAttempt,
        attemptedProviders,
      });

      await handleTotalFailure(ctx, request, requestId, "All providers exhausted");
      return { success: false, reason: "all_providers_exhausted" };
    }

    // ── Attempt purchase from provider ──
    logger.info("Attempting purchase from provider", {
      action: "execute_provisioning",
      requestId,
      provider,
      region,
      countryCode: request.countryCode,
      attemptCount: currentAttempt,
    });

    const purchaseResult = await ctx.runAction(
      internal.phoneProvisioning.actions.purchaseNumberFromProvider,
      {
        provider,
        region: request.region,
        countryCode: request.countryCode,
      },
    );

    if (!purchaseResult.success) {
      // ── Purchase failed — classify error and decide retry vs fail ──
      const errorCode = purchaseResult.errorCode ?? "unknown_error";
      const errorType = classifyError(errorCode);

      logger.warn("Purchase attempt failed", {
        action: "execute_provisioning",
        requestId,
        provider,
        attemptCount: currentAttempt,
        error: purchaseResult.error,
        errorCode,
        errorType,
      });

      // Update request with error info
      await ctx.runMutation(
        internal.phoneProvisioning.mutations.updateProvisioningRequestError,
        {
          requestId,
          provider,
          lastError: purchaseResult.error ?? "Unknown error",
        },
      );

      // Req 6.4 — non-transient errors fail immediately
      if (errorType === "non_transient") {
        logger.error("Non-transient error, failing immediately", {
          action: "execute_provisioning",
          requestId,
          provider,
          errorCode,
        });

        await handleTotalFailure(
          ctx,
          request,
          requestId,
          `Non-transient error from ${provider}: ${purchaseResult.error}`,
        );
        return { success: false, reason: "non_transient_error" };
      }

      // Req 6.1, 6.2 — transient error: retry with backoff if attempts remain
      if (currentAttempt < MAX_PROVISION_ATTEMPTS) {
        const delay = getBackoffDelay(currentAttempt);

        logger.warn("Scheduling retry with backoff", {
          action: "execute_provisioning",
          requestId,
          attemptCount: currentAttempt,
          maxAttempts: MAX_PROVISION_ATTEMPTS,
          backoffDelayMs: delay,
          nextProvider: getNextProvider(region, [...attemptedProviders, provider]),
        });

        // Req 6.6 — log retry attempt
        // Schedule retry via ctx.scheduler.runAfter
        await ctx.scheduler.runAfter(
          delay,
          internal.phoneProvisioning.actions.executeProvisioning,
          { requestId },
        );

        return { success: false, reason: "retry_scheduled", delay };
      }

      // Max attempts reached — total failure
      await handleTotalFailure(
        ctx,
        request,
        requestId,
        `Max attempts (${MAX_PROVISION_ATTEMPTS}) reached. Last error: ${purchaseResult.error}`,
      );
      return { success: false, reason: "max_attempts_reached" };
    }

    // ── Purchase succeeded — create phone number record and assign ──
    const numberId = generateNumberId();
    const now = Date.now();

    // Insert phoneNumbers record
    await ctx.runMutation(
      internal.phoneProvisioning.mutations.insertPhoneNumber,
      {
        numberId,
        phoneNumber: purchaseResult.phoneNumber!,
        provider,
        status: "available",
        capabilities: ["voice", "sms"],
        region: request.region,
        countryCode: request.countryCode,
        createdAt: now,
        providerNumberSid: purchaseResult.numberSid!,
        monthlyCost: purchaseResult.monthlyCost!,
        currency: purchaseResult.currency!,
        healthStatus: "healthy",
      },
    );

    logger.info("Phone number record created", {
      action: "purchase",
      numberId,
      phoneNumber: purchaseResult.phoneNumber,
      provider,
      region: request.region,
      countryCode: request.countryCode,
      requestId,
    });

    // Assign number to branch
    const branchId = request.branchId ?? request.locationId;
    if (branchId && request.targetType === "branch") {
      await ctx.runMutation(
        internal.phoneProvisioning.mutations.assignNumberToBranch,
        { phoneNumberId: numberId, branchId },
      );
    }

    // Req 2.5 — configure voice webhook
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.dinee.com"}/api/incoming-call`;
    await ctx.runAction(
      internal.phoneProvisioning.actions.configureWebhook,
      {
        provider,
        providerNumberSid: purchaseResult.numberSid!,
        webhookUrl,
      },
    );

    // Mark provisioning request as completed
    await ctx.runMutation(
      internal.phoneProvisioning.mutations.completeProvisioningRequest,
      {
        requestId,
        phoneNumberId: numberId,
      },
    );

    logger.info("Provisioning completed successfully", {
      action: "execute_provisioning",
      requestId,
      numberId,
      phoneNumber: purchaseResult.phoneNumber,
      provider,
      region: request.region,
      branchId,
    });

    return {
      success: true,
      numberId,
      phoneNumber: purchaseResult.phoneNumber,
      provider,
    };
  },
});

// ─── Helper: handle total provisioning failure ──────────────────────────────
// Req 2.6, 3.6, 6.5

async function handleTotalFailure(
  ctx: {
    runMutation: (ref: any, args: any) => Promise<any>;
  },
  request: {
    branchId?: string;
    locationId?: string;
    region: string;
    countryCode: string;
    attemptCount: number;
  },
  requestId: string,
  errorMessage: string,
) {
  // Mark request as failed
  await ctx.runMutation(
    internal.phoneProvisioning.mutations.failProvisioningRequest,
    { requestId, lastError: errorMessage },
  );

  // Req 2.6, 6.5 — emit critical monitoring alert
  await ctx.runMutation(api.monitoringAlerts.createAlert, {
    severity: "critical" as const,
    title: "Phone number provisioning failed",
    message: `Provisioning request ${requestId} failed after ${request.attemptCount + 1} attempts: ${errorMessage}`,
    metricType: "error_rate" as const,
    currentValue: request.attemptCount + 1,
    threshold: MAX_PROVISION_ATTEMPTS,
    context: JSON.stringify({
      requestId,
      branchId: request.branchId,
      locationId: request.locationId,
      region: request.region,
      countryCode: request.countryCode,
    }),
  });

  // Req 3.6 — fall back to shared number (the branch keeps its existing
  // shared number configuration; no additional action needed since the
  // branch.phoneNumber field was never updated for this failed request)
  logger.error("Provisioning failed — branch will use shared number fallback", {
    action: "execute_provisioning",
    requestId,
    branchId: request.branchId,
    region: request.region,
    error: errorMessage,
  });
}
