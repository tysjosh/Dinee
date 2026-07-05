/**
 * Shared types for telecom provider adapters.
 *
 * Each provider adapter implements the ProviderAdapter interface,
 * giving the provisioning actions a uniform API regardless of
 * which telecom is being called.
 */

export interface PurchaseResult {
  success: boolean;
  numberSid?: string;
  phoneNumber?: string;
  monthlyCost?: number;
  currency?: string;
  capabilities?: string[];
  error?: string;
  errorCode?: string;
}

export interface WebhookConfigResult {
  success: boolean;
  error?: string;
}

export interface ReleaseResult {
  success: boolean;
  error?: string;
}

export interface HealthCheckResult {
  healthStatus: "healthy" | "degraded" | "unreachable";
  details?: string;
}

export interface ProviderAdapter {
  /** Purchase a phone number in the given region/country. */
  purchaseNumber(region: string, countryCode: string): Promise<PurchaseResult>;

  /** Configure the voice webhook URL for a purchased number. */
  configureWebhook(numberSid: string, webhookUrl: string): Promise<WebhookConfigResult>;

  /** Release a number back to the provider. */
  releaseNumber(numberSid: string): Promise<ReleaseResult>;

  /** Check health/reachability of a number at the provider. */
  checkHealth(numberSid: string): Promise<HealthCheckResult>;
}
