/**
 * Feature: dinee-campus (Task 28.2)
 *
 * Student-facing selectable options for the onboarding / creation surface:
 * the available voice options and the available personality/tone presets
 * referenced by Requirement 2.3 ("a voice selection from the available voice
 * options; a personality/tone from the available tone options").
 *
 * These are pure, runtime-free constants. The voice ids intentionally match the
 * `defaultVoiceId` presets carried by the Template_Library
 * (`convex/campus/logic/templates.ts`) so a template's prefilled voice always
 * resolves to a real option.
 */

/** A single selectable voice option. */
export interface CampusVoiceOption {
  /** Stable id persisted as the Campus_Agent `voiceId`. */
  readonly id: string;
  /** Student-facing label. */
  readonly label: string;
  /** One-line description of how the voice sounds. */
  readonly description: string;
}

/** The available voice options a Student_Creator can pick from (Req 2.3). */
export const CAMPUS_VOICES: readonly CampusVoiceOption[] = [
  {
    id: "campus_voice_alloy",
    label: "Alloy",
    description: "Balanced and clear — an easy everyday voice.",
  },
  {
    id: "campus_voice_verse",
    label: "Verse",
    description: "Warm and expressive — great for personality.",
  },
  {
    id: "campus_voice_shimmer",
    label: "Shimmer",
    description: "Bright and upbeat — high energy.",
  },
  {
    id: "campus_voice_sol",
    label: "Sol",
    description: "Calm and steady — relaxed and grounded.",
  },
] as const;

/** A single selectable personality/tone preset. */
export interface CampusToneOption {
  /** The preset personality/tone text stored on the Campus_Agent. */
  readonly value: string;
  /** Short student-facing label for the preset. */
  readonly label: string;
}

/**
 * The available personality/tone presets (Req 2.3). A template prefills its own
 * descriptive tone; a Student_Creator can keep it, pick one of these presets, or
 * type their own. Any non-empty value satisfies the tone constraint.
 */
export const CAMPUS_TONES: readonly CampusToneOption[] = [
  { label: "Friendly", value: "Friendly, warm, and easygoing." },
  { label: "Hype", value: "Upbeat, energetic, and hype." },
  { label: "Chill", value: "Calm, relaxed, and low-key." },
  { label: "Funny", value: "Playful, witty, and quick with a joke." },
  { label: "Supportive", value: "Kind, patient, and encouraging." },
  { label: "Professional", value: "Clear, focused, and straightforward." },
] as const;

/** True iff `voiceId` is one of the available voice options. */
export function isKnownVoice(voiceId: string): boolean {
  return CAMPUS_VOICES.some((voice) => voice.id === voiceId);
}
