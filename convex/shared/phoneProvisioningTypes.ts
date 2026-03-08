import { v } from "convex/values";

// ─── Type Aliases ────────────────────────────────────────────────────────────

/** Phone number lifecycle status (Req 1.1) */
export type NumberStatus =
  | "available"
  | "assigned"
  | "releasing"
  | "released"
  | "quarantined"
  | "failed";

/** Health check result (Req 7.3–7.6) */
export type HealthStatus = "healthy" | "degraded" | "unreachable";

/** Telephony capabilities a number may support (Req 2.7) */
export type NumberCapability = "voice" | "sms" | "mms" | "fax";

/** What entity a number is assigned to (Req 1.2) */
export type AssignedToType = "branch" | "location";

/** Provisioning request lifecycle (Req 1.5) */
export type ProvisioningRequestStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

/** Supported telecom providers (Req 2.1) */
export type TelecomProvider =
  | "twilio"
  | "vonage"
  | "africas_talking"
  | "termii";

/** Region identifiers for provider routing (Req 2.1) */
export type ProvisioningRegion =
  | "nigeria"
  | "ghana"
  | "kenya"
  | "south_africa"
  | "default";

// ─── Convex Validators ──────────────────────────────────────────────────────

export const numberStatusValidator = v.union(
  v.literal("available"),
  v.literal("assigned"),
  v.literal("releasing"),
  v.literal("released"),
  v.literal("quarantined"),
  v.literal("failed")
);

export const healthStatusValidator = v.union(
  v.literal("healthy"),
  v.literal("degraded"),
  v.literal("unreachable")
);

export const numberCapabilityValidator = v.union(
  v.literal("voice"),
  v.literal("sms"),
  v.literal("mms"),
  v.literal("fax")
);

export const assignedToTypeValidator = v.union(
  v.literal("branch"),
  v.literal("location")
);

export const provisioningRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed")
);

export const telecomProviderValidator = v.union(
  v.literal("twilio"),
  v.literal("vonage"),
  v.literal("africas_talking"),
  v.literal("termii")
);

export const provisioningRegionValidator = v.union(
  v.literal("nigeria"),
  v.literal("ghana"),
  v.literal("kenya"),
  v.literal("south_africa"),
  v.literal("default")
);

// ─── Provider Routing Table (Req 2.1, 2.2, 2.3) ────────────────────────────

export interface ProviderRoute {
  primary: TelecomProvider;
  secondary: TelecomProvider;
  tertiary: TelecomProvider[];
}

export const PROVIDER_ROUTING_TABLE: Record<ProvisioningRegion, ProviderRoute> =
  {
    nigeria: {
      primary: "termii",
      secondary: "africas_talking",
      tertiary: ["twilio", "vonage"],
    },
    ghana: {
      primary: "africas_talking",
      secondary: "twilio",
      tertiary: ["vonage", "termii"],
    },
    kenya: {
      primary: "africas_talking",
      secondary: "twilio",
      tertiary: ["vonage", "termii"],
    },
    south_africa: {
      primary: "africas_talking",
      secondary: "twilio",
      tertiary: ["vonage", "termii"],
    },
    default: {
      primary: "twilio",
      secondary: "vonage",
      tertiary: ["africas_talking", "termii"],
    },
  };

// ─── Constants (Req 4.4, 5.1, 6.1, 6.2) ────────────────────────────────────

/** 30 days in milliseconds — quarantine cooling-off period */
export const QUARANTINE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 2_592_000_000

/** Minimum number of available numbers to keep per region */
export const DEFAULT_POOL_MIN = 5;

/** Maximum total attempts per provisioning request (1 initial + 4 retries) */
export const MAX_PROVISION_ATTEMPTS = 5;

/** Exponential backoff delays in ms: 5s, 30s, 2m, 10m */
export const BACKOFF_DELAYS = [5_000, 30_000, 120_000, 600_000] as const;

// ─── E.164 Validation ───────────────────────────────────────────────────────

/**
 * E.164 phone number format: + followed by 1–15 digits.
 * Example: +2348012345678
 */
export const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/** Returns true when `phoneNumber` is valid E.164 format. */
export function isValidE164(phoneNumber: string): boolean {
  return E164_REGEX.test(phoneNumber);
}

// ─── Error Classification (Req 6.1, 6.4) ────────────────────────────────────

/** Error types that should NOT trigger a retry. */
const NON_TRANSIENT_ERRORS = new Set([
  "invalid_credentials",
  "account_suspended",
  "insufficient_funds",
  "authentication_failed",
  "authorization_failed",
  "account_disabled",
]);

/**
 * Classify a provisioning error as transient (retryable) or non-transient.
 *
 * Non-transient errors include credential / account / billing issues that
 * won't resolve on their own. Everything else (timeouts, rate limits,
 * temporary unavailability, no inventory) is treated as transient.
 */
export function classifyError(
  errorCode: string
): "transient" | "non_transient" {
  return NON_TRANSIENT_ERRORS.has(errorCode) ? "non_transient" : "transient";
}
