/**
 * useVoiceService Hook
 * 
 * Provides a React hook for integrating the VoiceService with Convex backend.
 * This hook creates a VoiceService instance configured to update call ASR data
 * in the Convex database.
 * 
 * @module hooks/useVoiceService
 * @requirements 16.1 - ASR providers supporting Nigerian English accent recognition
 * @requirements 16.2 - Language settings include "nigerian_english" as preference option
 * @requirements 16.4 - Log ASR confidence scores for Nigerian English transcriptions
 * @requirements 16.5 - Store languageDetected in calls table
 * @requirements 17.1 - ASR providers with Pidgin language support
 * @requirements 17.2 - Language settings include "pidgin" as preference option
 */

import { useMemo, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  createVoiceService,
  type VoiceServiceConfig,
  type LanguagePreference,
  type ASRConfidenceData,
  type VoiceConfig,
  type UnifiedVoiceService,
} from "@/lib/voice";

/**
 * Configuration options for the useVoiceService hook
 */
export interface UseVoiceServiceOptions {
  /** Voice configuration overrides */
  voiceConfig?: Partial<VoiceConfig>;
  /** Whether to enable automatic ASR data updates to Convex */
  enableConvexUpdates?: boolean;
}

/**
 * Return type for the useVoiceService hook
 */
export interface UseVoiceServiceReturn {
  /** The VoiceService instance */
  voiceService: UnifiedVoiceService;
  /** Update call ASR data in Convex */
  updateCallASRData: (data: ASRConfidenceData) => Promise<void>;
  /** Check if a language is supported */
  isLanguageSupported: (language: LanguagePreference) => boolean;
  /** Get supported languages */
  getSupportedLanguages: () => LanguagePreference[];
}

/**
 * Hook for using the VoiceService with Convex integration
 * 
 * Creates a VoiceService instance that automatically updates call ASR data
 * in the Convex database when transcriptions are performed.
 * 
 * @param options - Configuration options for the hook
 * @returns VoiceService instance and helper functions
 * 
 * @example
 * ```typescript
 * function CallTranscription({ callId }: { callId: string }) {
 *   const { voiceService, updateCallASRData } = useVoiceService({
 *     voiceConfig: {
 *       defaultLanguage: 'nigerian_english',
 *       confidenceThreshold: 0.7,
 *     },
 *   });
 * 
 *   const handleTranscribe = async (audioStream: ReadableStream) => {
 *     const result = await voiceService.transcribe(callId, audioStream);
 *     
 *     // ASR data is automatically updated in Convex
 *     if (voiceService.shouldTriggerFallback(result.confidence)) {
 *       // Handle fallback to WhatsApp/SMS
 *     }
 *   };
 * 
 *   return <div>...</div>;
 * }
 * ```
 */
export function useVoiceService(
  options: UseVoiceServiceOptions = {}
): UseVoiceServiceReturn {
  const { voiceConfig, enableConvexUpdates = true } = options;

  // Get the Convex mutation for updating call ASR data
  const updateCallASRDataMutation = useMutation(api.calls.updateCallASRData);

  // Create the update function that calls Convex
  const updateCallASRData = useCallback(
    async (data: ASRConfidenceData): Promise<void> => {
      if (!enableConvexUpdates) {
        return;
      }

      try {
        await updateCallASRDataMutation({
          callId: data.callId,
          asrConfidence: data.asrConfidence,
          languageDetected: data.languageDetected,
          fallbackTriggered: data.fallbackTriggered,
        });
      } catch (error) {
        console.error("[useVoiceService] Failed to update ASR data:", error);
        throw error;
      }
    },
    [updateCallASRDataMutation, enableConvexUpdates]
  );

  // Create the VoiceService instance with Convex integration
  const voiceService = useMemo(() => {
    const config: VoiceServiceConfig = {
      voiceConfig: {
        confidenceThreshold: 0.7, // Requirement 16.5: 70% threshold
        fallbackEnabled: true,
        preferredFallbackChannel: "whatsapp",
        defaultLanguage: "english",
        enableMetricsLogging: true,
        ...voiceConfig,
      },
      // Connect the VoiceService to Convex for ASR data updates
      updateCallASRDataFn: enableConvexUpdates ? updateCallASRData : undefined,
    };

    return createVoiceService(config);
  }, [voiceConfig, enableConvexUpdates, updateCallASRData]);

  // Helper function to check if a language is supported
  const isLanguageSupported = useCallback(
    (language: LanguagePreference): boolean => {
      return voiceService.isLanguageSupported(language);
    },
    [voiceService]
  );

  // Helper function to get supported languages
  const getSupportedLanguages = useCallback((): LanguagePreference[] => {
    return voiceService.getSupportedLanguages();
  }, [voiceService]);

  return {
    voiceService,
    updateCallASRData,
    isLanguageSupported,
    getSupportedLanguages,
  };
}

/**
 * Hook for getting ASR metrics from Convex
 * 
 * @param restaurantId - The restaurant ID to get metrics for
 * @returns ASR metrics query result
 */
export function useASRMetrics(restaurantId: string | undefined) {
  // This would use useQuery from convex/react
  // For now, we'll just return the type signature
  // The actual implementation would be:
  // return useQuery(api.calls.getASRMetrics, restaurantId ? { restaurantId } : "skip");
  return null;
}

export default useVoiceService;
