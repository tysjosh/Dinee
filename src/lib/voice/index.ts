/**
 * Voice Service Module
 * 
 * Provides ASR (Automatic Speech Recognition) capabilities with support for
 * Nigerian English and Pidgin languages.
 * 
 * @module voice
 * @requirements 16.1 - ASR providers supporting Nigerian English accent recognition
 * @requirements 16.2 - Language settings include "nigerian_english" as preference option
 * @requirements 17.1 - ASR providers with Pidgin language support
 * @requirements 17.2 - Language settings include "pidgin" as preference option
 */

// Types
export type {
  LanguagePreference,
  LanguageConfig,
  TranscriptionResult,
  TranscriptionAlternative,
  ASRProvider,
  VoiceService,
  VoiceConfig,
  FallbackResult,
  MessageChannel,
  VoiceServiceConfig,
  TranscriptionMetrics,
  AggregatedTranscriptionMetrics,
  ASRProviderConfig,
  TranscriptionOptions,
  AudioEncoding,
  NigerianExpressionMapping,
  PidginPhrase,
  VoiceError,
  VoiceErrorCode,
  ASRConfidenceData,
} from "./types";

// Constants
export {
  LANGUAGE_CONFIGS,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_TRANSCRIPTION_OPTIONS,
  COMMON_PIDGIN_PHRASES,
  COMMON_NIGERIAN_EXPRESSIONS,
} from "./types";

// Service implementation
export {
  UnifiedVoiceService,
  MockASRProvider,
  createVoiceService,
  createVoiceServiceFromEnv,
  isNigerianLanguage,
  getConfidenceThreshold,
  isValidLanguagePreference,
} from "./VoiceService";

// Fallback Service
export {
  FallbackService,
  createFallbackService,
  createFallbackServiceFromEnv,
  DEFAULT_FALLBACK_CONFIG,
  FallbackServiceWithContextTransfer,
  createFallbackServiceWithContextTransfer,
} from "./FallbackService";

// Fallback Service Types
export type {
  FallbackConfig,
  FallbackEvent,
  FallbackRequest,
  FallbackMetrics,
  ConversationContext,
  ChannelAvailability,
  FallbackServiceConfig,
} from "./FallbackService";

// Context Transfer Service
export {
  ContextTransferService,
  createContextTransferService,
  DEFAULT_CONTEXT_TRANSFER_CONFIG,
} from "./ContextTransferService";

// Context Transfer Service Types
export type {
  TransferableOrderState,
  ContextTransferRequest,
  ContextTransferResult,
  StoredConversationContext,
  ContextTransferConfig,
  ContextTransferServiceConfig,
  ContextTransferEvent,
} from "./ContextTransferService";

// Provider Routing Service
export {
  ProviderRoutingService,
  createProviderRoutingService,
  createProviderRoutingServiceFromEnv,
  DEFAULT_ROUTING_CONFIG,
  detectRegionFromPhone,
} from "./ProviderRoutingService";

// Provider Routing Service Types
export type {
  TelecomProvider,
  Region,
  ProviderStatus,
  CallQualityMetrics,
  ProviderHealth,
  RoutingRule,
  ProviderRoutingConfig,
  CallInitRequest,
  CallInitResult,
  ProviderMetrics,
  ABTestComparison,
  ProviderRoutingServiceConfig,
} from "./ProviderRoutingService";

// Default export
export { default } from "./VoiceService";
