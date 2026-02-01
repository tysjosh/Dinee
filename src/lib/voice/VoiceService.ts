/**
 * Voice Service Implementation
 * 
 * Implements the VoiceService interface to provide ASR (Automatic Speech Recognition)
 * capabilities with support for Nigerian English and Pidgin languages.
 * 
 * @module voice/VoiceService
 * @requirements 16.1 - Integrate with ASR providers supporting Nigerian English accent recognition
 * @requirements 16.2 - Include "nigerian_english" as a language preference option
 * @requirements 17.1 - Integrate with ASR providers with Pidgin language support
 * @requirements 17.2 - Include "pidgin" as a language preference option
 */

import type {
  LanguagePreference,
  TranscriptionResult,
  TranscriptionAlternative,
  ASRProvider,
  VoiceService,
  VoiceConfig,
  FallbackResult,
  MessageChannel,
  VoiceServiceConfig,
  TranscriptionMetrics,
  ASRProviderConfig,
  TranscriptionOptions,
  ASRConfidenceData,
  LANGUAGE_CONFIGS,
} from "./types";
import {
  DEFAULT_VOICE_CONFIG,
  DEFAULT_TRANSCRIPTION_OPTIONS,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** 
 * Default confidence threshold for fallback trigger
 * @requirements 16.5 - Trigger fallback when confidence falls below 70%
 */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** 
 * Language-specific confidence thresholds 
 * Nigerian English uses 70% threshold per requirement 16.5
 */
const LANGUAGE_CONFIDENCE_THRESHOLDS: Record<LanguagePreference, number> = {
  english: 0.7,
  nigerian_english: 0.7, // Requirement 16.5: 70% threshold for Nigerian English
  pidgin: 0.6, // Slightly lower for Pidgin due to limited training data
  spanish: 0.7,
  french: 0.7,
};

// ============================================================================
// Mock ASR Provider (for development/testing)
// ============================================================================

/**
 * Mock ASR Provider for development and testing
 * 
 * This provider simulates ASR responses for testing purposes.
 * In production, this would be replaced with actual ASR provider implementations
 * (Google Speech-to-Text, AWS Transcribe, Azure Speech, etc.)
 */
export class MockASRProvider implements ASRProvider {
  name = "mock";
  supportedLanguages: LanguagePreference[] = [
    "english",
    "nigerian_english",
    "pidgin",
    "spanish",
    "french",
  ];

  /**
   * Check if the provider supports a specific language
   */
  supportsLanguage(language: LanguagePreference): boolean {
    return this.supportedLanguages.includes(language);
  }

  /**
   * Get recommended confidence threshold for a language
   */
  getRecommendedThreshold(language: LanguagePreference): number {
    return LANGUAGE_CONFIDENCE_THRESHOLDS[language] || DEFAULT_CONFIDENCE_THRESHOLD;
  }

  /**
   * Transcribe audio stream (mock implementation)
   */
  async transcribe(
    audioStream: ReadableStream,
    language: LanguagePreference
  ): Promise<TranscriptionResult> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Generate mock transcription based on language
    const mockTranscriptions: Record<LanguagePreference, string> = {
      english: "I would like to order two plates of jollof rice",
      nigerian_english: "I want to order two plates of jollof rice please",
      pidgin: "Abeg give me two plate of jollof rice",
      spanish: "Quiero pedir dos platos de arroz jollof",
      french: "Je voudrais commander deux assiettes de riz jollof",
    };

    // Generate mock confidence based on language
    const baseConfidence = this.getRecommendedThreshold(language);
    const confidence = baseConfidence + Math.random() * 0.2;

    return {
      text: mockTranscriptions[language] || mockTranscriptions.english,
      confidence: Math.min(confidence, 1.0),
      language,
      alternatives: [
        {
          text: mockTranscriptions[language] || mockTranscriptions.english,
          confidence: Math.min(confidence - 0.1, 1.0),
        },
      ],
      isFinal: true,
      durationMs: 3000,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique conversation ID for fallback
 */
function generateConversationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `CONV_${timestamp}_${random}`.toUpperCase();
}

/**
 * Check if a language is a Nigerian language variant
 */
export function isNigerianLanguage(language: LanguagePreference): boolean {
  return language === "nigerian_english" || language === "pidgin";
}

/**
 * Get the appropriate confidence threshold for a language
 * 
 * Nigerian languages have lower thresholds due to the complexity
 * of accent recognition and limited training data.
 */
export function getConfidenceThreshold(
  language: LanguagePreference,
  customThreshold?: number
): number {
  if (customThreshold !== undefined) {
    return customThreshold;
  }
  return LANGUAGE_CONFIDENCE_THRESHOLDS[language] || DEFAULT_CONFIDENCE_THRESHOLD;
}

/**
 * Validate that a language preference is supported
 */
export function isValidLanguagePreference(language: string): language is LanguagePreference {
  const validLanguages: LanguagePreference[] = [
    "english",
    "nigerian_english",
    "pidgin",
    "spanish",
    "french",
  ];
  return validLanguages.includes(language as LanguagePreference);
}

// ============================================================================
// Unified Voice Service Class
// ============================================================================

/**
 * Unified Voice Service
 * 
 * Provides ASR transcription, language preference management, and fallback
 * triggering for the Nigerian market. Supports Nigerian English and Pidgin
 * language recognition.
 * 
 * @requirements 16.1 - Integrate with ASR providers supporting Nigerian English
 * @requirements 16.2 - Include "nigerian_english" as a language preference option
 * @requirements 17.1 - Integrate with ASR providers with Pidgin language support
 * @requirements 17.2 - Include "pidgin" as a language preference option
 * 
 * @example
 * ```typescript
 * const voiceService = createVoiceService({
 *   voiceConfig: {
 *     confidenceThreshold: 0.6,
 *     fallbackEnabled: true,
 *     preferredFallbackChannel: 'whatsapp',
 *     defaultLanguage: 'nigerian_english',
 *   },
 * });
 * 
 * // Transcribe audio
 * const result = await voiceService.transcribe(callId, audioStream);
 * 
 * // Check if fallback should be triggered
 * if (voiceService.shouldTriggerFallback(result.confidence)) {
 *   await voiceService.initiateFallback(callId, phoneNumber);
 * }
 * ```
 */
export class UnifiedVoiceService implements VoiceService {
  private config: VoiceConfig;
  private asrProvider: ASRProvider;
  
  // In-memory cache for call language preferences
  private callLanguagePreferences: Map<string, LanguagePreference> = new Map();
  
  // In-memory storage for transcription metrics
  private transcriptionMetrics: TranscriptionMetrics[] = [];
  
  // Configuration functions
  private getCallLanguageFn?: VoiceServiceConfig["getCallLanguageFn"];
  private updateCallLanguageFn?: VoiceServiceConfig["updateCallLanguageFn"];
  private logMetricsFn?: VoiceServiceConfig["logMetricsFn"];
  private initiateFallbackFn?: VoiceServiceConfig["initiateFallbackFn"];
  private updateCallASRDataFn?: VoiceServiceConfig["updateCallASRDataFn"];

  constructor(serviceConfig: VoiceServiceConfig = {}) {
    // Merge default config with provided config
    this.config = {
      ...DEFAULT_VOICE_CONFIG,
      ...serviceConfig.voiceConfig,
    };

    // Use provided ASR provider or create mock provider
    this.asrProvider = serviceConfig.asrProvider || new MockASRProvider();

    // Store configuration functions
    this.getCallLanguageFn = serviceConfig.getCallLanguageFn;
    this.updateCallLanguageFn = serviceConfig.updateCallLanguageFn;
    this.logMetricsFn = serviceConfig.logMetricsFn;
    this.initiateFallbackFn = serviceConfig.initiateFallbackFn;
    this.updateCallASRDataFn = serviceConfig.updateCallASRDataFn;
  }

  /**
   * Transcribe audio from a call
   * 
   * Uses the configured ASR provider to transcribe the audio stream.
   * Logs transcription metrics if enabled.
   * 
   * @param callId - The ID of the call
   * @param audioStream - The audio stream to transcribe
   * @returns Promise resolving to the transcription result
   * 
   * @requirements 16.1 - Use ASR providers supporting Nigerian English
   * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
   * @requirements 16.5 - Trigger fallback when confidence falls below 70%
   * @requirements 17.1 - Use ASR providers with Pidgin language support
   */
  async transcribe(
    callId: string,
    audioStream: ReadableStream
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    // Get language preference for this call
    const language = await this.resolveLanguagePreference(callId);
    
    // Check if the ASR provider supports the language
    if (!this.asrProvider.supportsLanguage(language)) {
      throw new Error(
        `ASR provider "${this.asrProvider.name}" does not support language "${language}"`
      );
    }

    try {
      // Perform transcription
      const result = await this.asrProvider.transcribe(audioStream, language);
      
      // Calculate processing time
      const processingTimeMs = Date.now() - startTime;
      
      // Determine if fallback should be triggered based on confidence
      // Requirement 16.5: Trigger fallback when confidence falls below 70%
      const fallbackTriggered = this.shouldTriggerFallback(result.confidence);
      
      // Update call with ASR confidence data in database
      // Requirement 16.4, 16.5: Store asrConfidence and languageDetected in calls table
      if (this.updateCallASRDataFn) {
        const asrData: ASRConfidenceData = {
          callId,
          asrConfidence: result.confidence,
          languageDetected: language,
          fallbackTriggered,
        };
        
        await this.updateCallASRDataFn(asrData).catch(() => {
          // Silently handle ASR data update failures
        });
      }
      
      // Log metrics if enabled
      if (this.config.enableMetricsLogging) {
        const metrics: TranscriptionMetrics = {
          callId,
          language,
          confidence: result.confidence,
          durationMs: result.durationMs || 0,
          processingTimeMs,
          provider: this.asrProvider.name,
          fallbackTriggered,
          timestamp: Date.now(),
        };
        
        this.transcriptionMetrics.push(metrics);
        
        if (this.logMetricsFn) {
          await this.logMetricsFn(metrics);
        }
      }

      return result;
    } catch (error) {
      // Re-throw transcription errors
      throw error;
    }
  }

  /**
   * Check if fallback should be triggered based on confidence score
   * 
   * Uses language-specific thresholds to determine if the confidence
   * is too low and fallback to messaging should be triggered.
   * 
   * @param confidence - The confidence score from transcription (0-1)
   * @returns Whether fallback should be triggered
   * 
   * @requirements 16.5 - Trigger fallback when confidence falls below 70%
   */
  shouldTriggerFallback(confidence: number): boolean {
    if (!this.config.fallbackEnabled) {
      return false;
    }
    
    // Requirement 16.5: Trigger fallback when confidence falls below threshold (default 70%)
    return confidence < this.config.confidenceThreshold;
  }

  /**
   * Check if fallback should be triggered for a specific language
   * 
   * Uses language-specific thresholds which may differ from the
   * global threshold.
   * 
   * @param confidence - The confidence score from transcription (0-1)
   * @param language - The language used for transcription
   * @returns Whether fallback should be triggered
   */
  shouldTriggerFallbackForLanguage(
    confidence: number,
    language: LanguagePreference
  ): boolean {
    if (!this.config.fallbackEnabled) {
      return false;
    }
    
    const threshold = getConfidenceThreshold(language, this.config.confidenceThreshold);
    return confidence < threshold;
  }

  /**
   * Initiate fallback to messaging channel
   * 
   * When ASR confidence is too low, this method initiates a fallback
   * to WhatsApp or SMS for order completion.
   * 
   * @param callId - The ID of the call
   * @param phoneNumber - The customer's phone number
   * @returns Promise resolving to the fallback result
   */
  async initiateFallback(
    callId: string,
    phoneNumber: string
  ): Promise<FallbackResult> {
    const channel = this.config.preferredFallbackChannel;
    
    // Use provided fallback function if available
    if (this.initiateFallbackFn) {
      return await this.initiateFallbackFn(callId, phoneNumber, channel);
    }
    
    // Default fallback implementation
    const conversationId = generateConversationId();
    
    return {
      triggered: true,
      channel,
      conversationId,
    };
  }

  /**
   * Get the current language preference for a call
   * 
   * Checks the in-memory cache first, then falls back to the
   * database lookup function if provided.
   * 
   * @param callId - The ID of the call
   * @returns The language preference
   */
  getLanguagePreference(callId: string): LanguagePreference {
    return this.callLanguagePreferences.get(callId) || this.config.defaultLanguage;
  }

  /**
   * Set the language preference for a call
   * 
   * Updates both the in-memory cache and the database if a
   * update function is provided.
   * 
   * @param callId - The ID of the call
   * @param language - The language preference to set
   * 
   * @requirements 16.2 - Support "nigerian_english" as language preference
   * @requirements 17.2 - Support "pidgin" as language preference
   */
  setLanguagePreference(callId: string, language: LanguagePreference): void {
    if (!isValidLanguagePreference(language)) {
      throw new Error(`Invalid language preference: ${language}`);
    }
    
    this.callLanguagePreferences.set(callId, language);
    
    // Update database if function provided
    if (this.updateCallLanguageFn) {
      this.updateCallLanguageFn(callId, language).catch(() => {
        // Silently handle language preference update failures
      });
    }
  }

  /**
   * Resolve the language preference for a call
   * 
   * Checks cache, then database, then falls back to default.
   */
  private async resolveLanguagePreference(callId: string): Promise<LanguagePreference> {
    // Check cache first
    const cached = this.callLanguagePreferences.get(callId);
    if (cached) {
      return cached;
    }
    
    // Try database lookup
    if (this.getCallLanguageFn) {
      const dbLanguage = await this.getCallLanguageFn(callId);
      if (dbLanguage) {
        this.callLanguagePreferences.set(callId, dbLanguage);
        return dbLanguage;
      }
    }
    
    // Fall back to default
    return this.config.defaultLanguage;
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Get the current voice configuration
   */
  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  /**
   * Update the voice configuration
   */
  updateConfig(updates: Partial<VoiceConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  /**
   * Get the current ASR provider
   */
  getASRProvider(): ASRProvider {
    return this.asrProvider;
  }

  /**
   * Set a new ASR provider
   */
  setASRProvider(provider: ASRProvider): void {
    this.asrProvider = provider;
  }

  /**
   * Get supported languages from the ASR provider
   */
  getSupportedLanguages(): LanguagePreference[] {
    return this.asrProvider.supportedLanguages;
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: LanguagePreference): boolean {
    return this.asrProvider.supportsLanguage(language);
  }

  // ============================================================================
  // Metrics Methods
  // ============================================================================

  /**
   * Get transcription metrics for a call
   */
  getMetricsForCall(callId: string): TranscriptionMetrics[] {
    return this.transcriptionMetrics.filter((m) => m.callId === callId);
  }

  /**
   * Get all transcription metrics
   */
  getAllMetrics(): TranscriptionMetrics[] {
    return [...this.transcriptionMetrics];
  }

  /**
   * Get metrics filtered by language
   */
  getMetricsByLanguage(language: LanguagePreference): TranscriptionMetrics[] {
    return this.transcriptionMetrics.filter((m) => m.language === language);
  }

  /**
   * Calculate average confidence for a language
   */
  getAverageConfidence(language?: LanguagePreference): number {
    const metrics = language
      ? this.getMetricsByLanguage(language)
      : this.transcriptionMetrics;
    
    if (metrics.length === 0) {
      return 0;
    }
    
    const totalConfidence = metrics.reduce((sum, m) => sum + m.confidence, 0);
    return totalConfidence / metrics.length;
  }

  /**
   * Calculate fallback rate
   */
  getFallbackRate(language?: LanguagePreference): number {
    const metrics = language
      ? this.getMetricsByLanguage(language)
      : this.transcriptionMetrics;
    
    if (metrics.length === 0) {
      return 0;
    }
    
    const fallbackCount = metrics.filter((m) => m.fallbackTriggered).length;
    return fallbackCount / metrics.length;
  }

  /**
   * Clear all metrics (for testing)
   */
  clearMetrics(): void {
    this.transcriptionMetrics = [];
  }

  /**
   * Clear language preferences cache (for testing)
   */
  clearLanguagePreferences(): void {
    this.callLanguagePreferences.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a UnifiedVoiceService instance
 * 
 * @param config - Optional configuration for the voice service
 * @returns UnifiedVoiceService instance
 * 
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const voiceService = createVoiceService();
 * 
 * // With custom configuration
 * const voiceService = createVoiceService({
 *   voiceConfig: {
 *     confidenceThreshold: 0.5,
 *     fallbackEnabled: true,
 *     preferredFallbackChannel: 'whatsapp',
 *     defaultLanguage: 'nigerian_english',
 *   },
 *   getCallLanguageFn: async (callId) => {
 *     return await db.calls.getLanguage(callId);
 *   },
 * });
 * ```
 */
export function createVoiceService(
  config: VoiceServiceConfig = {}
): UnifiedVoiceService {
  return new UnifiedVoiceService(config);
}

/**
 * Create a VoiceService instance from environment variables
 * 
 * Expected environment variables:
 * - VOICE_CONFIDENCE_THRESHOLD (optional, default 0.6)
 * - VOICE_FALLBACK_ENABLED (optional, default true)
 * - VOICE_FALLBACK_CHANNEL (optional, default 'whatsapp')
 * - VOICE_DEFAULT_LANGUAGE (optional, default 'english')
 * - VOICE_METRICS_ENABLED (optional, default true)
 */
export function createVoiceServiceFromEnv(
  overrides: Partial<VoiceServiceConfig> = {}
): UnifiedVoiceService {
  const voiceConfig: Partial<VoiceConfig> = {
    confidenceThreshold: process.env.VOICE_CONFIDENCE_THRESHOLD
      ? parseFloat(process.env.VOICE_CONFIDENCE_THRESHOLD)
      : DEFAULT_VOICE_CONFIG.confidenceThreshold,
    fallbackEnabled: process.env.VOICE_FALLBACK_ENABLED !== "false",
    preferredFallbackChannel: (process.env.VOICE_FALLBACK_CHANNEL as MessageChannel) || "whatsapp",
    defaultLanguage: (process.env.VOICE_DEFAULT_LANGUAGE as LanguagePreference) || "english",
    enableMetricsLogging: process.env.VOICE_METRICS_ENABLED !== "false",
    ...overrides.voiceConfig,
  };

  return new UnifiedVoiceService({
    ...overrides,
    voiceConfig,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default UnifiedVoiceService;
