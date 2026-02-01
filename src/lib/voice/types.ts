/**
 * Voice Service Types and Interfaces
 * 
 * This module defines the types and interfaces for the voice service infrastructure,
 * supporting Nigerian English and Pidgin language recognition with ASR provider abstraction.
 * 
 * @module voice/types
 * @requirements 16.1 - ASR providers supporting Nigerian English accent recognition
 * @requirements 16.2 - Language settings include "nigerian_english" as preference option
 * @requirements 17.1 - ASR providers with Pidgin language support
 * @requirements 17.2 - Language settings include "pidgin" as preference option
 */

// ============================================================================
// Language Preference Types
// ============================================================================

/**
 * Supported language preferences for voice recognition
 * 
 * - english: Standard English
 * - nigerian_english: English with Nigerian accent patterns and local expressions
 * - pidgin: Nigerian Pidgin English, a widely spoken creole language in Nigeria
 * - spanish: Spanish language support
 * - french: French language support
 * 
 * @requirements 16.2 - Include "nigerian_english" as a language preference option
 * @requirements 17.2 - Include "pidgin" as a language preference option
 */
export type LanguagePreference = 
  | 'english' 
  | 'nigerian_english' 
  | 'pidgin' 
  | 'spanish' 
  | 'french';

/**
 * Language configuration with display names and locale codes
 */
export interface LanguageConfig {
  /** Language preference key */
  preference: LanguagePreference;
  /** Human-readable display name */
  displayName: string;
  /** BCP 47 locale code for ASR configuration */
  localeCode: string;
  /** Whether this language is fully supported */
  isFullySupported: boolean;
  /** Description of the language variant */
  description?: string;
}

/**
 * Registry of supported languages with their configurations
 */
export const LANGUAGE_CONFIGS: Record<LanguagePreference, LanguageConfig> = {
  english: {
    preference: 'english',
    displayName: 'English',
    localeCode: 'en-US',
    isFullySupported: true,
    description: 'Standard American English',
  },
  nigerian_english: {
    preference: 'nigerian_english',
    displayName: 'Nigerian English',
    localeCode: 'en-NG',
    isFullySupported: true,
    description: 'English with Nigerian accent patterns and local expressions',
  },
  pidgin: {
    preference: 'pidgin',
    displayName: 'Nigerian Pidgin',
    localeCode: 'pcm',
    isFullySupported: true,
    description: 'Nigerian Pidgin English (Naija)',
  },
  spanish: {
    preference: 'spanish',
    displayName: 'Spanish',
    localeCode: 'es-ES',
    isFullySupported: true,
    description: 'Standard Spanish',
  },
  french: {
    preference: 'french',
    displayName: 'French',
    localeCode: 'fr-FR',
    isFullySupported: true,
    description: 'Standard French',
  },
};

// ============================================================================
// ASR Provider Interface
// ============================================================================

/**
 * Result of a transcription operation
 */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Confidence score (0-1) for the transcription */
  confidence: number;
  /** The language detected or used for transcription */
  language: LanguagePreference;
  /** Alternative transcriptions with their confidence scores */
  alternatives?: TranscriptionAlternative[];
  /** Duration of the audio in milliseconds */
  durationMs?: number;
  /** Whether the transcription is final or interim */
  isFinal?: boolean;
  /** Raw response from the ASR provider (for debugging) */
  rawResponse?: unknown;
}

/**
 * Alternative transcription result
 */
export interface TranscriptionAlternative {
  /** Alternative transcribed text */
  text: string;
  /** Confidence score for this alternative */
  confidence: number;
}

/**
 * ASR Provider interface for implementing speech recognition integrations
 * 
 * Each ASR provider (Google Speech-to-Text, AWS Transcribe, Azure Speech, etc.)
 * should implement this interface to provide a unified transcription API.
 * 
 * @requirements 16.1 - Integrate with ASR providers supporting Nigerian English
 * @requirements 17.1 - Integrate with ASR providers with Pidgin language support
 */
export interface ASRProvider {
  /** Name of the ASR provider */
  name: string;
  
  /** List of languages supported by this provider */
  supportedLanguages: LanguagePreference[];
  
  /**
   * Transcribe audio stream to text
   * 
   * @param audioStream - The audio stream to transcribe
   * @param language - The language preference for transcription
   * @returns Promise resolving to the transcription result
   */
  transcribe(
    audioStream: ReadableStream,
    language: LanguagePreference
  ): Promise<TranscriptionResult>;
  
  /**
   * Check if the provider supports a specific language
   * 
   * @param language - The language to check
   * @returns Whether the language is supported
   */
  supportsLanguage(language: LanguagePreference): boolean;
  
  /**
   * Get the provider's confidence threshold recommendation for a language
   * 
   * @param language - The language to get threshold for
   * @returns Recommended confidence threshold (0-1)
   */
  getRecommendedThreshold?(language: LanguagePreference): number;
}

// ============================================================================
// Voice Service Interface
// ============================================================================

/**
 * Message channel for fallback communication
 */
export type MessageChannel = 'whatsapp' | 'sms';

/**
 * Result of initiating a fallback to another channel
 */
export interface FallbackResult {
  /** Whether the fallback was triggered */
  triggered: boolean;
  /** The channel used for fallback */
  channel: MessageChannel;
  /** Conversation ID for the fallback channel */
  conversationId?: string;
  /** Error message if fallback failed */
  error?: string;
}

/**
 * Voice service configuration
 * @requirements 16.5 - Trigger fallback when confidence falls below 70%
 */
export interface VoiceConfig {
  /** 
   * Confidence threshold below which fallback is triggered (0-1, default 0.7)
   * @requirements 16.5 - Default threshold is 70% for Nigerian English
   */
  confidenceThreshold: number;
  /** Whether fallback to messaging is enabled */
  fallbackEnabled: boolean;
  /** Preferred channel for fallback communication */
  preferredFallbackChannel: MessageChannel;
  /** Default language preference */
  defaultLanguage: LanguagePreference;
  /** Whether to log transcription metrics */
  enableMetricsLogging: boolean;
}

/**
 * Default voice configuration
 * @requirements 16.5 - Trigger fallback when confidence falls below 70%
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  confidenceThreshold: 0.7, // Requirement 16.5: 70% threshold
  fallbackEnabled: true,
  preferredFallbackChannel: 'whatsapp',
  defaultLanguage: 'english',
  enableMetricsLogging: true,
};

/**
 * Voice Service interface for managing voice recognition operations
 * 
 * This is the main interface for interacting with the voice recognition system.
 * It provides transcription, fallback triggering, and language configuration.
 * 
 * @requirements 16.1 - Integrate with ASR providers supporting Nigerian English
 * @requirements 17.1 - Integrate with ASR providers with Pidgin language support
 */
export interface VoiceService {
  /**
   * Transcribe audio from a call
   * 
   * @param callId - The ID of the call
   * @param audioStream - The audio stream to transcribe
   * @returns Promise resolving to the transcription result
   */
  transcribe(
    callId: string,
    audioStream: ReadableStream
  ): Promise<TranscriptionResult>;
  
  /**
   * Check if fallback should be triggered based on confidence score
   * 
   * @param confidence - The confidence score from transcription
   * @returns Whether fallback should be triggered
   */
  shouldTriggerFallback(confidence: number): boolean;
  
  /**
   * Initiate fallback to messaging channel
   * 
   * @param callId - The ID of the call
   * @param phoneNumber - The customer's phone number
   * @returns Promise resolving to the fallback result
   */
  initiateFallback(
    callId: string,
    phoneNumber: string
  ): Promise<FallbackResult>;
  
  /**
   * Get the current language preference for a call
   * 
   * @param callId - The ID of the call
   * @returns The language preference
   */
  getLanguagePreference(callId: string): LanguagePreference;
  
  /**
   * Set the language preference for a call
   * 
   * @param callId - The ID of the call
   * @param language - The language preference to set
   */
  setLanguagePreference(callId: string, language: LanguagePreference): void;
}

// ============================================================================
// ASR Provider Configuration Types
// ============================================================================

/**
 * Configuration for an ASR provider
 */
export interface ASRProviderConfig {
  /** API key or credentials for the provider */
  apiKey?: string;
  /** API endpoint URL */
  endpoint?: string;
  /** Region for the provider (e.g., 'us-east-1' for AWS) */
  region?: string;
  /** Project ID (for Google Cloud) */
  projectId?: string;
  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Transcription request options
 */
export interface TranscriptionOptions {
  /** Language preference for transcription */
  language: LanguagePreference;
  /** Whether to enable automatic punctuation */
  enablePunctuation?: boolean;
  /** Whether to enable profanity filtering */
  enableProfanityFilter?: boolean;
  /** Whether to enable word-level timestamps */
  enableWordTimestamps?: boolean;
  /** Maximum number of alternatives to return */
  maxAlternatives?: number;
  /** Audio encoding format */
  encoding?: AudioEncoding;
  /** Sample rate in Hz */
  sampleRateHz?: number;
  /** Number of audio channels */
  channelCount?: number;
}

/**
 * Supported audio encoding formats
 */
export type AudioEncoding = 
  | 'LINEAR16'
  | 'FLAC'
  | 'MULAW'
  | 'AMR'
  | 'AMR_WB'
  | 'OGG_OPUS'
  | 'WEBM_OPUS'
  | 'MP3';

/**
 * Default transcription options
 */
export const DEFAULT_TRANSCRIPTION_OPTIONS: Partial<TranscriptionOptions> = {
  enablePunctuation: true,
  enableProfanityFilter: false,
  enableWordTimestamps: false,
  maxAlternatives: 3,
  encoding: 'LINEAR16',
  sampleRateHz: 16000,
  channelCount: 1,
};

// ============================================================================
// Transcription Metrics Types
// ============================================================================

/**
 * Metrics for a transcription operation
 */
export interface TranscriptionMetrics {
  /** Call ID */
  callId: string;
  /** Language used for transcription */
  language: LanguagePreference;
  /** Confidence score */
  confidence: number;
  /** Duration of the audio in milliseconds */
  durationMs: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** ASR provider used */
  provider: string;
  /** Whether fallback was triggered */
  fallbackTriggered: boolean;
  /** Timestamp of the transcription */
  timestamp: number;
}

/**
 * Aggregated transcription metrics for analytics
 */
export interface AggregatedTranscriptionMetrics {
  /** Total number of transcriptions */
  totalTranscriptions: number;
  /** Average confidence score */
  averageConfidence: number;
  /** Fallback trigger rate (0-1) */
  fallbackRate: number;
  /** Breakdown by language */
  byLanguage: Record<LanguagePreference, {
    count: number;
    averageConfidence: number;
    fallbackRate: number;
  }>;
  /** Breakdown by provider */
  byProvider: Record<string, {
    count: number;
    averageConfidence: number;
    averageProcessingTimeMs: number;
  }>;
}

// ============================================================================
// Nigerian Language Support Types
// ============================================================================

/**
 * Common Nigerian English expressions and their standard English equivalents
 * Used for improving transcription accuracy
 */
export interface NigerianExpressionMapping {
  /** Nigerian English expression */
  nigerianExpression: string;
  /** Standard English equivalent */
  standardEquivalent: string;
  /** Context where this expression is commonly used */
  context?: string;
}

/**
 * Common Pidgin phrases for ordering
 * Used for building phrase dictionaries
 * 
 * @requirements 17.4 - Maintain a Pidgin phrase dictionary for common ordering expressions
 */
export interface PidginPhrase {
  /** Pidgin phrase */
  pidgin: string;
  /** English translation */
  english: string;
  /** Category of the phrase (greeting, ordering, confirmation, etc.) */
  category: 'greeting' | 'ordering' | 'confirmation' | 'quantity' | 'payment' | 'other';
  /** Example usage */
  example?: string;
}

/**
 * Common Pidgin phrases for restaurant ordering
 */
export const COMMON_PIDGIN_PHRASES: PidginPhrase[] = [
  // Greetings
  { pidgin: 'How far', english: 'Hello / How are you', category: 'greeting' },
  { pidgin: 'Wetin dey', english: 'What is happening / What do you have', category: 'greeting' },
  { pidgin: 'I dey fine', english: 'I am fine', category: 'greeting' },
  
  // Ordering
  { pidgin: 'I wan order', english: 'I want to order', category: 'ordering' },
  { pidgin: 'Abeg give me', english: 'Please give me', category: 'ordering' },
  { pidgin: 'Make I get', english: 'Let me have', category: 'ordering' },
  { pidgin: 'I go take', english: 'I will take', category: 'ordering' },
  { pidgin: 'Wetin una get', english: 'What do you have', category: 'ordering' },
  { pidgin: 'E dey available', english: 'Is it available', category: 'ordering' },
  { pidgin: 'No wahala', english: 'No problem', category: 'ordering' },
  
  // Quantities
  { pidgin: 'One', english: 'One', category: 'quantity' },
  { pidgin: 'Two', english: 'Two', category: 'quantity' },
  { pidgin: 'Plenty', english: 'Many / A lot', category: 'quantity' },
  { pidgin: 'Small', english: 'A little / Small portion', category: 'quantity' },
  { pidgin: 'Big', english: 'Large portion', category: 'quantity' },
  
  // Confirmation
  { pidgin: 'Na so', english: 'That is correct', category: 'confirmation' },
  { pidgin: 'Yes o', english: 'Yes', category: 'confirmation' },
  { pidgin: 'No be so', english: 'That is not correct', category: 'confirmation' },
  { pidgin: 'E correct', english: 'It is correct', category: 'confirmation' },
  { pidgin: 'Oya', english: 'Okay / Let us proceed', category: 'confirmation' },
  
  // Payment
  { pidgin: 'How much', english: 'How much does it cost', category: 'payment' },
  { pidgin: 'I go pay', english: 'I will pay', category: 'payment' },
  { pidgin: 'Cash', english: 'Cash payment', category: 'payment' },
  { pidgin: 'Transfer', english: 'Bank transfer', category: 'payment' },
];

/**
 * Common Nigerian English expressions
 */
export const COMMON_NIGERIAN_EXPRESSIONS: NigerianExpressionMapping[] = [
  { nigerianExpression: 'I want to chop', standardEquivalent: 'I want to eat', context: 'ordering' },
  { nigerianExpression: 'Bring food come', standardEquivalent: 'Deliver the food', context: 'delivery' },
  { nigerianExpression: 'How much be this', standardEquivalent: 'How much is this', context: 'pricing' },
  { nigerianExpression: 'E don reach', standardEquivalent: 'It has arrived', context: 'delivery' },
  { nigerianExpression: 'Make una sharp', standardEquivalent: 'Please be quick', context: 'urgency' },
];

// ============================================================================
// ASR Confidence Data Types
// ============================================================================

/**
 * ASR confidence data for updating calls
 * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
 * @requirements 16.5 - Store languageDetected in calls table
 */
export interface ASRConfidenceData {
  /** The call ID to update */
  callId: string;
  /** ASR confidence score (0-1) */
  asrConfidence: number;
  /** Detected language */
  languageDetected: LanguagePreference;
  /** Whether fallback was triggered */
  fallbackTriggered: boolean;
}

// ============================================================================
// Voice Service Configuration Types
// ============================================================================

/**
 * Full configuration for the Voice Service
 */
export interface VoiceServiceConfig {
  /** Voice configuration */
  voiceConfig?: Partial<VoiceConfig>;
  /** ASR provider configuration */
  asrProviderConfig?: ASRProviderConfig;
  /** Custom ASR provider instance */
  asrProvider?: ASRProvider;
  /** Function to get call language preference from database */
  getCallLanguageFn?: (callId: string) => Promise<LanguagePreference | null>;
  /** Function to update call language preference in database */
  updateCallLanguageFn?: (callId: string, language: LanguagePreference) => Promise<void>;
  /** Function to log transcription metrics */
  logMetricsFn?: (metrics: TranscriptionMetrics) => Promise<void>;
  /** Function to initiate fallback messaging */
  initiateFallbackFn?: (callId: string, phoneNumber: string, channel: MessageChannel) => Promise<FallbackResult>;
  /** 
   * Function to update call with ASR confidence data
   * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
   */
  updateCallASRDataFn?: (data: ASRConfidenceData) => Promise<void>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Voice service error codes
 */
export type VoiceErrorCode =
  | 'TRANSCRIPTION_FAILED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_AUDIO_FORMAT'
  | 'FALLBACK_FAILED'
  | 'CONFIGURATION_ERROR';

/**
 * Voice service error
 */
export interface VoiceError {
  /** Error code */
  code: VoiceErrorCode;
  /** Error message */
  message: string;
  /** Original error if available */
  cause?: Error;
  /** Additional context */
  context?: Record<string, unknown>;
}
