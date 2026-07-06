/**
 * Provider Routing Service
 * 
 * Implements telecom provider routing with automatic failover and quality metrics.
 * Supports primary/secondary provider configuration and A/B testing.
 * 
 * @module voice/ProviderRoutingService
 * @requirements 19.1 - Support configuration of multiple telecom providers per region
 * @requirements 19.2 - Define primary and fallback providers for each region
 * @requirements 19.3 - Select provider based on routing rules
 * @requirements 19.4 - Automatic failover to secondary provider
 * @requirements 19.5 - Log provider selection and call quality metrics
 * @requirements 19.6 - Display call quality metrics by provider
 * @requirements 19.7 - Support A/B testing of providers for quality comparison
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Telecom provider identifier
 */
export type TelecomProvider = 
  | 'twilio'
  | 'vonage'
  | 'africas_talking'
  | 'termii'
  | 'mock';

/**
 * Region identifier for routing
 */
export type Region = 
  | 'nigeria'
  | 'ghana'
  | 'kenya'
  | 'south_africa'
  | 'default';

/**
 * Provider status
 */
export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * Call quality metrics for a single call
 * @requirements 19.5 - Log provider selection and call quality metrics
 */
export interface CallQualityMetrics {
  /** Unique call ID */
  callId: string;
  /** Provider used for the call */
  provider: TelecomProvider;
  /** Region of the call */
  region: Region;
  /** Call start timestamp */
  startTime: number;
  /** Call end timestamp */
  endTime?: number;
  /** Call duration in seconds */
  durationSeconds?: number;
  /** Audio quality score (0-100) */
  audioQualityScore?: number;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Packet loss percentage (0-100) */
  packetLossPercent?: number;
  /** Jitter in milliseconds */
  jitterMs?: number;
  /** Whether the call was successful */
  success: boolean;
  /** Error message if call failed */
  errorMessage?: string;
  /** Whether this was a failover call */
  isFailover: boolean;
  /** Original provider if failover occurred */
  originalProvider?: TelecomProvider;
  /** A/B test group if applicable */
  abTestGroup?: 'A' | 'B';
  /** Branch ID for analytics */
  branchId?: string;
  /** Restaurant ID for analytics */
  restaurantId?: string;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  /** Provider identifier */
  provider: TelecomProvider;
  /** Current status */
  status: ProviderStatus;
  /** Last health check timestamp */
  lastChecked: number;
  /** Success rate in the last hour (0-1) */
  successRate: number;
  /** Average latency in milliseconds */
  averageLatencyMs: number;
  /** Number of calls in the last hour */
  callsLastHour: number;
  /** Number of failures in the last hour */
  failuresLastHour: number;
  /** Error message if unhealthy */
  errorMessage?: string;
}

/**
 * Routing rule for a region
 * @requirements 19.2 - Define primary and fallback providers for each region
 */
export interface RoutingRule {
  /** Region this rule applies to */
  region: Region;
  /** Primary provider for this region */
  primaryProvider: TelecomProvider;
  /** Secondary/fallback provider */
  secondaryProvider: TelecomProvider;
  /** Whether A/B testing is enabled for this region */
  abTestEnabled: boolean;
  /** A/B test split ratio (0-1, percentage going to provider B) */
  abTestSplitRatio: number;
  /** Provider for A/B test group B (if different from primary) */
  abTestProviderB?: TelecomProvider;
  /** Whether this rule is active */
  isActive: boolean;
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Provider routing configuration
 * @requirements 19.1 - Support configuration of multiple telecom providers per region
 * @requirements 19.8 - Configuration updatable without system restart
 */
export interface ProviderRoutingConfig {
  /** Routing rules by region */
  routingRules: RoutingRule[];
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Number of consecutive failures before marking provider as unavailable */
  failureThreshold: number;
  /** Time window for failure counting in milliseconds */
  failureWindowMs: number;
  /** Whether automatic failover is enabled */
  autoFailoverEnabled: boolean;
  /** Minimum success rate before triggering failover (0-1) */
  minSuccessRateForFailover: number;
  /** Whether to log all provider selections */
  enableDetailedLogging: boolean;
}

/**
 * Call initiation request
 */
export interface CallInitRequest {
  /** Phone number to call */
  phoneNumber: string;
  /** Region for routing (auto-detected if not provided) */
  region?: Region;
  /** Branch ID for analytics */
  branchId?: string;
  /** Restaurant ID for analytics */
  restaurantId?: string;
  /** Force specific provider (bypasses routing rules) */
  forceProvider?: TelecomProvider;
  /** Metadata for the call */
  metadata?: Record<string, unknown>;
}

/**
 * Call initiation result
 */
export interface CallInitResult {
  /** Whether the call was initiated successfully */
  success: boolean;
  /** Call ID if successful */
  callId?: string;
  /** Provider used for the call */
  provider: TelecomProvider;
  /** Region used for routing */
  region: Region;
  /** Whether failover occurred */
  failoverOccurred: boolean;
  /** Original provider if failover occurred */
  originalProvider?: TelecomProvider;
  /** A/B test group if applicable */
  abTestGroup?: 'A' | 'B';
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp of the call initiation */
  timestamp: number;
}

/**
 * Aggregated provider metrics for dashboard
 * @requirements 19.6 - Display call quality metrics by provider
 */
export interface ProviderMetrics {
  /** Provider identifier */
  provider: TelecomProvider;
  /** Total calls in the period */
  totalCalls: number;
  /** Successful calls */
  successfulCalls: number;
  /** Failed calls */
  failedCalls: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average call duration in seconds */
  averageDurationSeconds: number;
  /** Average audio quality score (0-100) */
  averageAudioQuality: number;
  /** Average latency in milliseconds */
  averageLatencyMs: number;
  /** Average packet loss percentage */
  averagePacketLoss: number;
  /** Number of failover events to this provider */
  failoverInCount: number;
  /** Number of failover events from this provider */
  failoverOutCount: number;
  /** Time period start */
  periodStart: number;
  /** Time period end */
  periodEnd: number;
}

/**
 * A/B test comparison results
 * @requirements 19.7 - Support A/B testing of providers for quality comparison
 */
export interface ABTestComparison {
  /** Region being tested */
  region: Region;
  /** Provider A (control) */
  providerA: TelecomProvider;
  /** Provider B (variant) */
  providerB: TelecomProvider;
  /** Metrics for provider A */
  metricsA: ProviderMetrics;
  /** Metrics for provider B */
  metricsB: ProviderMetrics;
  /** Statistical significance (0-1) */
  statisticalSignificance: number;
  /** Recommended provider based on results */
  recommendedProvider: TelecomProvider;
  /** Confidence in recommendation (0-1) */
  confidence: number;
  /** Test start date */
  testStartDate: number;
  /** Test end date */
  testEndDate: number;
  /** Total sample size */
  totalSampleSize: number;
}

/**
 * Service configuration functions
 */
export interface ProviderRoutingServiceConfig {
  /** Initial routing configuration */
  config?: Partial<ProviderRoutingConfig>;
  /** Function to initiate a call with a specific provider */
  initiateCallFn?: (
    provider: TelecomProvider,
    phoneNumber: string,
    metadata?: Record<string, unknown>
  ) => Promise<{ success: boolean; callId?: string; error?: string }>;
  /** Function to check provider health */
  checkProviderHealthFn?: (
    provider: TelecomProvider
  ) => Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  /** Function to log call quality metrics */
  logMetricsFn?: (metrics: CallQualityMetrics) => Promise<void>;
  /** Function to persist routing configuration */
  persistConfigFn?: (config: ProviderRoutingConfig) => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: ProviderRoutingConfig = {
  routingRules: [
    {
      // Aligned with convex REGION_PROVIDER_ROUTING (single source of truth):
      // Nigeria uses Termii primary, Africa's Talking secondary.
      region: 'nigeria',
      primaryProvider: 'termii',
      secondaryProvider: 'africas_talking',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 1,
    },
    {
      region: 'ghana',
      primaryProvider: 'africas_talking',
      secondaryProvider: 'twilio',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 2,
    },
    {
      region: 'kenya',
      primaryProvider: 'africas_talking',
      secondaryProvider: 'twilio',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 3,
    },
    {
      region: 'south_africa',
      primaryProvider: 'twilio',
      secondaryProvider: 'vonage',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 4,
    },
    {
      region: 'default',
      primaryProvider: 'twilio',
      secondaryProvider: 'vonage',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 99,
    },
  ],
  healthCheckIntervalMs: 60000, // 1 minute
  failureThreshold: 3,
  failureWindowMs: 300000, // 5 minutes
  autoFailoverEnabled: true,
  minSuccessRateForFailover: 0.7,
  enableDetailedLogging: true,
};

/**
 * Nigerian phone number prefixes for region detection
 */
const NIGERIAN_PREFIXES = [
  '+234', '234', '0803', '0806', '0813', '0816', '0810', '0814',
  '0903', '0906', '0913', '0916', '0703', '0706', '0803', '0805',
  '0807', '0808', '0809', '0817', '0818', '0909', '0908',
];

/**
 * Ghana phone number prefixes
 */
const GHANA_PREFIXES = ['+233', '233', '020', '024', '054', '055', '059'];

/**
 * Kenya phone number prefixes
 */
const KENYA_PREFIXES = ['+254', '254', '07', '01'];

/**
 * South Africa phone number prefixes
 */
const SOUTH_AFRICA_PREFIXES = ['+27', '27', '06', '07', '08'];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique call ID
 */
function generateCallId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `CALL_${timestamp}_${random}`.toUpperCase();
}

/**
 * Detect region from phone number
 * @requirements 19.3 - Select provider based on routing rules
 */
export function detectRegionFromPhone(phoneNumber: string): Region {
  const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  // Check Nigerian prefixes
  if (NIGERIAN_PREFIXES.some(prefix => cleaned.startsWith(prefix))) {
    return 'nigeria';
  }
  
  // Check Ghana prefixes
  if (GHANA_PREFIXES.some(prefix => cleaned.startsWith(prefix))) {
    return 'ghana';
  }
  
  // Check Kenya prefixes
  if (KENYA_PREFIXES.some(prefix => cleaned.startsWith(prefix))) {
    return 'kenya';
  }
  
  // Check South Africa prefixes
  if (SOUTH_AFRICA_PREFIXES.some(prefix => cleaned.startsWith(prefix))) {
    return 'south_africa';
  }
  
  return 'default';
}

/**
 * Calculate statistical significance using chi-squared test approximation
 */
function calculateStatisticalSignificance(
  successA: number,
  totalA: number,
  successB: number,
  totalB: number
): number {
  if (totalA === 0 || totalB === 0) return 0;
  
  const rateA = successA / totalA;
  const rateB = successB / totalB;
  const pooledRate = (successA + successB) / (totalA + totalB);
  
  if (pooledRate === 0 || pooledRate === 1) return 0;
  
  const standardError = Math.sqrt(
    pooledRate * (1 - pooledRate) * (1 / totalA + 1 / totalB)
  );
  
  if (standardError === 0) return 0;
  
  const zScore = Math.abs(rateA - rateB) / standardError;
  
  // Approximate p-value from z-score (simplified)
  const pValue = Math.exp(-0.5 * zScore * zScore);
  
  return 1 - pValue;
}

// ============================================================================
// ProviderRoutingService Class
// ============================================================================

/**
 * Provider Routing Service
 * 
 * Manages telecom provider selection, automatic failover, and quality metrics
 * for voice calls in the Nigerian market.
 * 
 * @requirements 19.1 - Support configuration of multiple telecom providers per region
 * @requirements 19.2 - Define primary and fallback providers for each region
 * @requirements 19.3 - Select provider based on routing rules
 * @requirements 19.4 - Automatic failover to secondary provider
 * @requirements 19.5 - Log provider selection and call quality metrics
 */
export class ProviderRoutingService {
  private config: ProviderRoutingConfig;
  private providerHealth: Map<TelecomProvider, ProviderHealth> = new Map();
  private callMetrics: CallQualityMetrics[] = [];
  private recentFailures: Map<TelecomProvider, number[]> = new Map();
  
  // Configuration functions
  private initiateCallFn?: ProviderRoutingServiceConfig['initiateCallFn'];
  private checkProviderHealthFn?: ProviderRoutingServiceConfig['checkProviderHealthFn'];
  private logMetricsFn?: ProviderRoutingServiceConfig['logMetricsFn'];
  private persistConfigFn?: ProviderRoutingServiceConfig['persistConfigFn'];

  constructor(serviceConfig: ProviderRoutingServiceConfig = {}) {
    this.config = {
      ...DEFAULT_ROUTING_CONFIG,
      ...serviceConfig.config,
      routingRules: serviceConfig.config?.routingRules || DEFAULT_ROUTING_CONFIG.routingRules,
    };

    this.initiateCallFn = serviceConfig.initiateCallFn;
    this.checkProviderHealthFn = serviceConfig.checkProviderHealthFn;
    this.logMetricsFn = serviceConfig.logMetricsFn;
    this.persistConfigFn = serviceConfig.persistConfigFn;

    // Initialize provider health
    this.initializeProviderHealth();
  }

  /**
   * Initialize health status for all providers
   */
  private initializeProviderHealth(): void {
    const providers: TelecomProvider[] = ['twilio', 'vonage', 'africas_talking', 'termii', 'mock'];
    
    for (const provider of providers) {
      this.providerHealth.set(provider, {
        provider,
        status: 'healthy',
        lastChecked: Date.now(),
        successRate: 1.0,
        averageLatencyMs: 0,
        callsLastHour: 0,
        failuresLastHour: 0,
      });
      
      this.recentFailures.set(provider, []);
    }
  }

  // ============================================================================
  // Core Routing Methods
  // ============================================================================

  /**
   * Select the appropriate provider for a call
   * @requirements 19.3 - Select provider based on routing rules
   */
  selectProvider(request: CallInitRequest): {
    provider: TelecomProvider;
    region: Region;
    abTestGroup?: 'A' | 'B';
  } {
    // If provider is forced, use it
    if (request.forceProvider) {
      return {
        provider: request.forceProvider,
        region: request.region || detectRegionFromPhone(request.phoneNumber),
      };
    }

    // Detect region
    const region = request.region || detectRegionFromPhone(request.phoneNumber);

    // Find routing rule for region
    const rule = this.getRoutingRule(region);

    // Check if A/B testing is enabled
    if (rule.abTestEnabled && rule.abTestProviderB) {
      const isGroupB = Math.random() < rule.abTestSplitRatio;
      return {
        provider: isGroupB ? rule.abTestProviderB : rule.primaryProvider,
        region,
        abTestGroup: isGroupB ? 'B' : 'A',
      };
    }

    // Check primary provider health
    const primaryHealth = this.providerHealth.get(rule.primaryProvider);
    if (primaryHealth?.status === 'unavailable') {
      return {
        provider: rule.secondaryProvider,
        region,
      };
    }

    return {
      provider: rule.primaryProvider,
      region,
    };
  }

  /**
   * Get routing rule for a region
   */
  private getRoutingRule(region: Region): RoutingRule {
    const rule = this.config.routingRules
      .filter(r => r.isActive)
      .sort((a, b) => a.priority - b.priority)
      .find(r => r.region === region);

    if (rule) return rule;

    // Fall back to default rule
    const defaultRule = this.config.routingRules.find(r => r.region === 'default');
    if (defaultRule) return defaultRule;

    // Ultimate fallback
    return {
      region: 'default',
      primaryProvider: 'twilio',
      secondaryProvider: 'vonage',
      abTestEnabled: false,
      abTestSplitRatio: 0.5,
      isActive: true,
      priority: 99,
    };
  }

  /**
   * Initiate a call with automatic failover
   * @requirements 19.4 - Automatic failover to secondary provider
   */
  async initiateCall(request: CallInitRequest): Promise<CallInitResult> {
    const selection = this.selectProvider(request);
    const callId = generateCallId();
    const timestamp = Date.now();

    // Try primary provider
    const primaryResult = await this.tryInitiateCall(
      selection.provider,
      request.phoneNumber,
      callId,
      request.metadata
    );

    if (primaryResult.success) {
      // Log successful call
      await this.recordCallMetrics({
        callId,
        provider: selection.provider,
        region: selection.region,
        startTime: timestamp,
        success: true,
        isFailover: false,
        abTestGroup: selection.abTestGroup,
        branchId: request.branchId,
        restaurantId: request.restaurantId,
      });

      return {
        success: true,
        callId,
        provider: selection.provider,
        region: selection.region,
        failoverOccurred: false,
        abTestGroup: selection.abTestGroup,
        timestamp,
      };
    }

    // Record failure for primary provider
    this.recordProviderFailure(selection.provider);

    // Attempt failover if enabled
    if (this.config.autoFailoverEnabled) {
      const rule = this.getRoutingRule(selection.region);
      const secondaryProvider = rule.secondaryProvider;

      const secondaryResult = await this.tryInitiateCall(
        secondaryProvider,
        request.phoneNumber,
        callId,
        request.metadata
      );

      if (secondaryResult.success) {
        // Log successful failover
        await this.recordCallMetrics({
          callId,
          provider: secondaryProvider,
          region: selection.region,
          startTime: timestamp,
          success: true,
          isFailover: true,
          originalProvider: selection.provider,
          abTestGroup: selection.abTestGroup,
          branchId: request.branchId,
          restaurantId: request.restaurantId,
        });

        return {
          success: true,
          callId,
          provider: secondaryProvider,
          region: selection.region,
          failoverOccurred: true,
          originalProvider: selection.provider,
          abTestGroup: selection.abTestGroup,
          timestamp,
        };
      }

      // Record failure for secondary provider
      this.recordProviderFailure(secondaryProvider);
    }

    // Both providers failed
    await this.recordCallMetrics({
      callId,
      provider: selection.provider,
      region: selection.region,
      startTime: timestamp,
      success: false,
      isFailover: false,
      errorMessage: primaryResult.error || 'Call initiation failed',
      branchId: request.branchId,
      restaurantId: request.restaurantId,
    });

    return {
      success: false,
      provider: selection.provider,
      region: selection.region,
      failoverOccurred: this.config.autoFailoverEnabled,
      errorMessage: primaryResult.error || 'Call initiation failed on all providers',
      timestamp,
    };
  }

  /**
   * Try to initiate a call with a specific provider
   */
  private async tryInitiateCall(
    provider: TelecomProvider,
    phoneNumber: string,
    callId: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    if (this.initiateCallFn) {
      try {
        const result = await this.initiateCallFn(provider, phoneNumber, metadata);
        return { success: result.success, error: result.error };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ProviderRouting] Call initiation error:`, error);
        return { success: false, error: errorMessage };
      }
    }

    // Mock implementation for development
    return { success: true };
  }

  /**
   * Record a provider failure for health tracking
   * @requirements 19.4 - Detect provider failure and switch to secondary
   */
  private recordProviderFailure(provider: TelecomProvider): void {
    const failures = this.recentFailures.get(provider) || [];
    const now = Date.now();
    
    // Add new failure
    failures.push(now);
    
    // Remove old failures outside the window
    const windowStart = now - this.config.failureWindowMs;
    const recentFailures = failures.filter(t => t > windowStart);
    this.recentFailures.set(provider, recentFailures);

    // Check if threshold exceeded
    if (recentFailures.length >= this.config.failureThreshold) {
      this.markProviderUnavailable(provider);
    }

    // Update health metrics
    this.updateProviderHealth(provider);
  }

  /**
   * Mark a provider as unavailable
   */
  private markProviderUnavailable(provider: TelecomProvider): void {
    const health = this.providerHealth.get(provider);
    if (health) {
      health.status = 'unavailable';
      health.lastChecked = Date.now();
    }
  }

  /**
   * Update provider health based on recent metrics
   */
  private updateProviderHealth(provider: TelecomProvider): void {
    const health = this.providerHealth.get(provider);
    if (!health) return;

    const now = Date.now();
    const hourAgo = now - 3600000;

    // Get metrics from the last hour
    const recentMetrics = this.callMetrics.filter(
      m => m.provider === provider && m.startTime > hourAgo
    );

    health.callsLastHour = recentMetrics.length;
    health.failuresLastHour = recentMetrics.filter(m => !m.success).length;
    health.successRate = health.callsLastHour > 0
      ? (health.callsLastHour - health.failuresLastHour) / health.callsLastHour
      : 1.0;

    // Calculate average latency
    const latencies = recentMetrics
      .filter(m => m.latencyMs !== undefined)
      .map(m => m.latencyMs!);
    health.averageLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    // Update status based on success rate
    if (health.successRate < this.config.minSuccessRateForFailover) {
      health.status = 'degraded';
    } else if (health.status === 'degraded' && health.successRate >= 0.9) {
      health.status = 'healthy';
    }

    health.lastChecked = now;
  }

  /**
   * Record call quality metrics
   * @requirements 19.5 - Log provider selection and call quality metrics
   */
  private async recordCallMetrics(metrics: CallQualityMetrics): Promise<void> {
    this.callMetrics.push(metrics);

    // Update provider health
    this.updateProviderHealth(metrics.provider);

    // Log to external system if configured
    if (this.logMetricsFn) {
      try {
        await this.logMetricsFn(metrics);
      } catch (error) {
        // Silently handle logging failures
      }
    }
  }

  /**
   * Update call metrics when call ends
   */
  async updateCallMetrics(
    callId: string,
    updates: Partial<CallQualityMetrics>
  ): Promise<void> {
    const metrics = this.callMetrics.find(m => m.callId === callId);
    if (metrics) {
      Object.assign(metrics, updates);
      
      // Calculate duration if end time provided
      if (updates.endTime && metrics.startTime) {
        metrics.durationSeconds = (updates.endTime - metrics.startTime) / 1000;
      }

      // Update provider health
      this.updateProviderHealth(metrics.provider);

      // Log updated metrics
      if (this.logMetricsFn) {
        try {
          await this.logMetricsFn(metrics);
        } catch (error) {
          console.error('[ProviderRouting] Failed to log updated metrics:', error);
        }
      }
    }
  }

  // ============================================================================
  // Metrics and Analytics Methods
  // ============================================================================

  /**
   * Get aggregated metrics for a provider
   * @requirements 19.6 - Display call quality metrics by provider
   */
  getProviderMetrics(
    provider: TelecomProvider,
    startTime?: number,
    endTime?: number
  ): ProviderMetrics {
    const now = Date.now();
    const periodStart = startTime || now - 24 * 60 * 60 * 1000; // Default: last 24 hours
    const periodEnd = endTime || now;

    const metrics = this.callMetrics.filter(
      m => m.provider === provider &&
           m.startTime >= periodStart &&
           m.startTime <= periodEnd
    );

    const successfulCalls = metrics.filter(m => m.success);
    const failedCalls = metrics.filter(m => !m.success);

    // Calculate averages
    const durations = successfulCalls
      .filter(m => m.durationSeconds !== undefined)
      .map(m => m.durationSeconds!);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const audioScores = metrics
      .filter(m => m.audioQualityScore !== undefined)
      .map(m => m.audioQualityScore!);
    const avgAudioQuality = audioScores.length > 0
      ? audioScores.reduce((a, b) => a + b, 0) / audioScores.length
      : 0;

    const latencies = metrics
      .filter(m => m.latencyMs !== undefined)
      .map(m => m.latencyMs!);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    const packetLosses = metrics
      .filter(m => m.packetLossPercent !== undefined)
      .map(m => m.packetLossPercent!);
    const avgPacketLoss = packetLosses.length > 0
      ? packetLosses.reduce((a, b) => a + b, 0) / packetLosses.length
      : 0;

    return {
      provider,
      totalCalls: metrics.length,
      successfulCalls: successfulCalls.length,
      failedCalls: failedCalls.length,
      successRate: metrics.length > 0 ? successfulCalls.length / metrics.length : 0,
      averageDurationSeconds: avgDuration,
      averageAudioQuality: avgAudioQuality,
      averageLatencyMs: avgLatency,
      averagePacketLoss: avgPacketLoss,
      failoverInCount: metrics.filter(m => m.isFailover).length,
      failoverOutCount: metrics.filter(m => m.originalProvider === provider).length,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get metrics for all providers
   */
  getAllProviderMetrics(startTime?: number, endTime?: number): ProviderMetrics[] {
    const providers: TelecomProvider[] = ['twilio', 'vonage', 'africas_talking', 'termii'];
    return providers.map(p => this.getProviderMetrics(p, startTime, endTime));
  }

  /**
   * Get A/B test comparison results
   * @requirements 19.7 - Support A/B testing of providers for quality comparison
   */
  getABTestComparison(region: Region): ABTestComparison | null {
    const rule = this.getRoutingRule(region);
    
    if (!rule.abTestEnabled || !rule.abTestProviderB) {
      return null;
    }

    const now = Date.now();
    const testStart = now - 7 * 24 * 60 * 60 * 1000; // Last 7 days

    // Get metrics for group A (primary provider)
    const metricsA = this.callMetrics.filter(
      m => m.region === region &&
           m.abTestGroup === 'A' &&
           m.startTime >= testStart
    );

    // Get metrics for group B (test provider)
    const metricsB = this.callMetrics.filter(
      m => m.region === region &&
           m.abTestGroup === 'B' &&
           m.startTime >= testStart
    );

    const providerAMetrics = this.getProviderMetrics(rule.primaryProvider, testStart);
    const providerBMetrics = this.getProviderMetrics(rule.abTestProviderB, testStart);

    // Calculate statistical significance
    const significance = calculateStatisticalSignificance(
      metricsA.filter(m => m.success).length,
      metricsA.length,
      metricsB.filter(m => m.success).length,
      metricsB.length
    );

    // Determine recommended provider
    const scoreA = providerAMetrics.successRate * 0.5 + 
                   (providerAMetrics.averageAudioQuality / 100) * 0.3 +
                   (1 - Math.min(providerAMetrics.averageLatencyMs / 1000, 1)) * 0.2;
    const scoreB = providerBMetrics.successRate * 0.5 +
                   (providerBMetrics.averageAudioQuality / 100) * 0.3 +
                   (1 - Math.min(providerBMetrics.averageLatencyMs / 1000, 1)) * 0.2;

    return {
      region,
      providerA: rule.primaryProvider,
      providerB: rule.abTestProviderB,
      metricsA: providerAMetrics,
      metricsB: providerBMetrics,
      statisticalSignificance: significance,
      recommendedProvider: scoreA >= scoreB ? rule.primaryProvider : rule.abTestProviderB,
      confidence: Math.abs(scoreA - scoreB) * significance,
      testStartDate: testStart,
      testEndDate: now,
      totalSampleSize: metricsA.length + metricsB.length,
    };
  }

  /**
   * Get provider health status
   */
  getProviderHealth(provider: TelecomProvider): ProviderHealth | undefined {
    return this.providerHealth.get(provider);
  }

  /**
   * Get all provider health statuses
   */
  getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.providerHealth.values());
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Get current routing configuration
   */
  getConfig(): ProviderRoutingConfig {
    return { ...this.config };
  }

  /**
   * Update routing configuration
   * @requirements 19.8 - Configuration updatable without system restart
   */
  async updateConfig(updates: Partial<ProviderRoutingConfig>): Promise<void> {
    this.config = {
      ...this.config,
      ...updates,
    };

    // Persist configuration if function provided
    if (this.persistConfigFn) {
      try {
        await this.persistConfigFn(this.config);
      } catch (error) {
        // Silently handle persistence failures
      }
    }
  }

  /**
   * Update a specific routing rule
   */
  async updateRoutingRule(region: Region, updates: Partial<RoutingRule>): Promise<void> {
    const ruleIndex = this.config.routingRules.findIndex(r => r.region === region);
    
    if (ruleIndex >= 0) {
      this.config.routingRules[ruleIndex] = {
        ...this.config.routingRules[ruleIndex],
        ...updates,
      };
    } else {
      // Add new rule
      this.config.routingRules.push({
        region,
        primaryProvider: updates.primaryProvider || 'twilio',
        secondaryProvider: updates.secondaryProvider || 'vonage',
        abTestEnabled: updates.abTestEnabled || false,
        abTestSplitRatio: updates.abTestSplitRatio || 0.5,
        isActive: updates.isActive !== false,
        priority: updates.priority || 50,
        ...updates,
      });
    }

    // Persist configuration
    if (this.persistConfigFn) {
      try {
        await this.persistConfigFn(this.config);
      } catch (error) {
        // Silently handle persistence failures
      }
    }
  }

  /**
   * Enable A/B testing for a region
   * @requirements 19.7 - Support A/B testing of providers for quality comparison
   */
  async enableABTest(
    region: Region,
    providerB: TelecomProvider,
    splitRatio: number = 0.5
  ): Promise<void> {
    await this.updateRoutingRule(region, {
      abTestEnabled: true,
      abTestProviderB: providerB,
      abTestSplitRatio: splitRatio,
    });
  }

  /**
   * Disable A/B testing for a region
   */
  async disableABTest(region: Region): Promise<void> {
    await this.updateRoutingRule(region, {
      abTestEnabled: false,
    });
  }

  /**
   * Reset provider health (for recovery)
   */
  resetProviderHealth(provider: TelecomProvider): void {
    const health = this.providerHealth.get(provider);
    if (health) {
      health.status = 'healthy';
      health.lastChecked = Date.now();
      health.failuresLastHour = 0;
      health.successRate = 1.0;
    }
    this.recentFailures.set(provider, []);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get all call metrics (for testing/debugging)
   */
  getAllCallMetrics(): CallQualityMetrics[] {
    return [...this.callMetrics];
  }

  /**
   * Get call metrics for a specific call
   */
  getCallMetrics(callId: string): CallQualityMetrics | undefined {
    return this.callMetrics.find(m => m.callId === callId);
  }

  /**
   * Clear all metrics (for testing)
   */
  clearMetrics(): void {
    this.callMetrics = [];
    this.initializeProviderHealth();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a ProviderRoutingService instance
 * 
 * @param config - Optional configuration for the routing service
 * @returns ProviderRoutingService instance
 * 
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const routingService = createProviderRoutingService();
 * 
 * // With custom configuration
 * const routingService = createProviderRoutingService({
 *   config: {
 *     autoFailoverEnabled: true,
 *     failureThreshold: 5,
 *   },
 *   initiateCallFn: async (provider, phone) => {
 *     return await telecomApi.initiateCall(provider, phone);
 *   },
 * });
 * ```
 */
export function createProviderRoutingService(
  config: ProviderRoutingServiceConfig = {}
): ProviderRoutingService {
  return new ProviderRoutingService(config);
}

/**
 * Create a ProviderRoutingService instance from environment variables
 * 
 * Expected environment variables:
 * - PROVIDER_ROUTING_AUTO_FAILOVER (optional, default true)
 * - PROVIDER_ROUTING_FAILURE_THRESHOLD (optional, default 3)
 * - PROVIDER_ROUTING_MIN_SUCCESS_RATE (optional, default 0.7)
 * - PROVIDER_ROUTING_DETAILED_LOGGING (optional, default true)
 */
export function createProviderRoutingServiceFromEnv(
  overrides: Partial<ProviderRoutingServiceConfig> = {}
): ProviderRoutingService {
  const config: Partial<ProviderRoutingConfig> = {
    autoFailoverEnabled: process.env.PROVIDER_ROUTING_AUTO_FAILOVER !== 'false',
    failureThreshold: process.env.PROVIDER_ROUTING_FAILURE_THRESHOLD
      ? parseInt(process.env.PROVIDER_ROUTING_FAILURE_THRESHOLD, 10)
      : DEFAULT_ROUTING_CONFIG.failureThreshold,
    minSuccessRateForFailover: process.env.PROVIDER_ROUTING_MIN_SUCCESS_RATE
      ? parseFloat(process.env.PROVIDER_ROUTING_MIN_SUCCESS_RATE)
      : DEFAULT_ROUTING_CONFIG.minSuccessRateForFailover,
    enableDetailedLogging: process.env.PROVIDER_ROUTING_DETAILED_LOGGING !== 'false',
    ...overrides.config,
  };

  return new ProviderRoutingService({
    ...overrides,
    config,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default ProviderRoutingService;
