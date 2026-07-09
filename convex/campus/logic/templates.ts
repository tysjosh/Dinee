/**
 * Feature: dinee-campus (Task 4.1)
 *
 * Template_Library — pure, property-testable core (Requirement 3).
 *
 * This module carries NO Convex `ctx` and performs no I/O. It defines the
 * seven Agent_Type templates (one per type) and the pure `applyTemplate`
 * transform that prefills a creation draft with a template's presets. The
 * Convex layer (a future `convex/campus/templates.ts` / Creation_Service)
 * seeds the `campusTemplates` table from `CAMPUS_TEMPLATES` and delegates the
 * prefill behavior to `applyTemplate`, so the correctness properties are
 * directly testable against these functions.
 *
 * Covered behaviors:
 *   - 3.1: exactly one template per Agent_Type (all seven, incl. advice_agent).
 *   - 3.2: each template has a non-empty personality/tone, >=3 preview prompts,
 *     and >=1 knowledge-guidance entry.
 *   - 3.3: applying a template prefills every configurable Campus_Agent field
 *     with the template's corresponding preset value.
 *   - 3.5: a field override supplied by the creator replaces the preset value,
 *     so prefilled fields can be changed before publishing.
 */

/**
 * The Agent_Type classification chosen at creation. Mirrors
 * `campusAgents.agentType` / `campusTemplates.agentType` in the schema.
 */
export type AgentType =
  | "ai_twin"
  | "study_agent"
  | "club_agent"
  | "campus_guide"
  | "funny_character"
  | "tutor_agent"
  | "advice_agent";

/** The seven Agent_Types, in canonical order (Req 3.1). */
export const AGENT_TYPES: readonly AgentType[] = [
  "ai_twin",
  "study_agent",
  "club_agent",
  "campus_guide",
  "funny_character",
  "tutor_agent",
  "advice_agent",
] as const;

/**
 * Preset field values a template contributes to the prefilled draft (Req 3.3).
 * Mirrors `campusTemplates.presetFields` in the schema.
 */
export interface TemplatePresetFields {
  defaultDescription?: string;
  defaultVoiceId?: string;
}

/**
 * A Template_Library entry. Mirrors the `campusTemplates` table shape
 * (`templateId`, `agentType`, `personalityTone`, `previewPrompts`,
 * `knowledgeGuidance`, `presetFields`).
 */
export interface CampusTemplate {
  templateId: string;
  agentType: AgentType;
  /** Non-empty preset personality/tone value (Req 3.2). */
  personalityTone: string;
  /** At least 3 preview prompt examples (Req 3.2). */
  previewPrompts: string[];
  /** At least 1 Knowledge_Source guidance entry (Req 3.2). */
  knowledgeGuidance: string[];
  /** Preset prefill values (Req 3.3). */
  presetFields: TemplatePresetFields;
}

/**
 * The configurable Campus_Agent creation fields that a template can prefill.
 * All fields are optional so a partially-entered draft round-trips through
 * `applyTemplate` without loss (Req 3.3, 3.5).
 */
export interface CampusAgentDraft {
  name?: string;
  agentType?: AgentType;
  campusTag?: string;
  voiceId?: string;
  personalityTone?: string;
  description?: string;
  creatorDisplayName?: string;
  previewPrompts?: string[];
  visibility?: "public" | "private";
}

/**
 * The seven Agent_Type templates, exactly one per type (Req 3.1). Each entry
 * has a non-empty personality/tone, at least three preview prompts, and at
 * least one knowledge-guidance entry that references only concepts defined for
 * that template's Agent_Type (Req 3.2).
 */
export const CAMPUS_TEMPLATES: Record<AgentType, CampusTemplate> = {
  ai_twin: {
    templateId: "template_ai_twin",
    agentType: "ai_twin",
    personalityTone:
      "Warm, personable, and casual — sounds like you talking to a friend.",
    previewPrompts: [
      "What are you into these days?",
      "Tell me a little about yourself.",
      "What should I know before we hang out?",
    ],
    knowledgeGuidance: [
      "Add a short bio: who you are, your interests, and how you like to talk.",
      "List a few facts or stories you're happy for people to hear.",
    ],
    presetFields: {
      defaultDescription: "My AI twin — ask it anything you'd ask me.",
      defaultVoiceId: "campus_voice_alloy",
    },
  },
  study_agent: {
    templateId: "template_study_agent",
    agentType: "study_agent",
    personalityTone:
      "Encouraging, patient, and focused — keeps you on track without pressure.",
    previewPrompts: [
      "Quiz me on this week's topics.",
      "Explain this concept in simple terms.",
      "Help me make a study plan for finals.",
    ],
    knowledgeGuidance: [
      "Add your notes, key concepts, and definitions for the subject.",
      "Add practice questions and the topics you find most confusing.",
    ],
    presetFields: {
      defaultDescription: "Your study buddy — quizzes, explanations, and plans.",
      defaultVoiceId: "campus_voice_verse",
    },
  },
  club_agent: {
    templateId: "template_club_agent",
    agentType: "club_agent",
    personalityTone:
      "Upbeat, welcoming, and hype — gets people excited to join and show up.",
    previewPrompts: [
      "What does this club do?",
      "When and where is the next event?",
      "How do I join or get involved?",
    ],
    knowledgeGuidance: [
      "Add the club name, mission, and what members do.",
      "Add upcoming event details: dates, locations, and how to sign up.",
    ],
    presetFields: {
      defaultDescription: "Everything about our club and how to get involved.",
      defaultVoiceId: "campus_voice_shimmer",
    },
  },
  campus_guide: {
    templateId: "template_campus_guide",
    agentType: "campus_guide",
    personalityTone:
      "Friendly, helpful, and knowledgeable — like a senior showing you around.",
    previewPrompts: [
      "Where's the best place to study on campus?",
      "How do I get to the library from the quad?",
      "What's good to eat near campus?",
    ],
    knowledgeGuidance: [
      "Add campus locations, buildings, and how to get between them.",
      "Add tips about dining, study spots, and student services.",
    ],
    presetFields: {
      defaultDescription: "Your guide to getting around campus.",
      defaultVoiceId: "campus_voice_alloy",
    },
  },
  funny_character: {
    templateId: "template_funny_character",
    agentType: "funny_character",
    personalityTone:
      "Playful, witty, and over-the-top — always going for the laugh.",
    previewPrompts: [
      "Roast me (gently).",
      "Tell me a joke about campus life.",
      "Give me the most dramatic take on my day.",
    ],
    knowledgeGuidance: [
      "Add the character's backstory, catchphrases, and comedic style.",
      "Add topics and running jokes the character loves to riff on.",
    ],
    presetFields: {
      defaultDescription: "A ridiculous character here to make you laugh.",
      defaultVoiceId: "campus_voice_verse",
    },
  },
  tutor_agent: {
    templateId: "template_tutor_agent",
    agentType: "tutor_agent",
    personalityTone:
      "Clear, methodical, and supportive — breaks problems down step by step.",
    previewPrompts: [
      "Walk me through solving this problem.",
      "Where did I go wrong on this?",
      "Give me a similar practice problem.",
    ],
    knowledgeGuidance: [
      "Add the course material, worked examples, and problem-solving steps.",
      "Add common mistakes and how to correct them for this course.",
    ],
    presetFields: {
      defaultDescription: "A patient tutor for the course — step by step.",
      defaultVoiceId: "campus_voice_shimmer",
    },
  },
  advice_agent: {
    templateId: "template_advice_agent",
    agentType: "advice_agent",
    personalityTone:
      "Kind, thoughtful, and non-judgmental — listens first, then helps.",
    previewPrompts: [
      "I'm stressed about exams — any advice?",
      "How do I balance classes and a social life?",
      "Help me think through a tough decision.",
    ],
    knowledgeGuidance: [
      "Add the perspectives, values, and experiences the advice should draw on.",
      "Add resources or referrals to share when a topic is beyond your scope.",
    ],
    presetFields: {
      defaultDescription: "A friendly ear for campus life and everyday decisions.",
      defaultVoiceId: "campus_voice_alloy",
    },
  },
};

/**
 * Returns the single Template_Library entry for an Agent_Type (Req 3.1).
 */
export function getTemplate(agentType: AgentType): CampusTemplate {
  return CAMPUS_TEMPLATES[agentType];
}

/**
 * Returns all seven templates in canonical Agent_Type order (Req 3.1).
 */
export function listTemplates(): CampusTemplate[] {
  return AGENT_TYPES.map((type) => CAMPUS_TEMPLATES[type]);
}

/**
 * Prefills a creation draft with a template's preset values (Req 3.3), then
 * applies any creator-supplied field overrides on top so a prefilled field can
 * be changed before publishing (Req 3.5).
 *
 * Semantics:
 *   - Every configurable field the template defines is set from the template's
 *     corresponding preset value (`agentType`, `personalityTone`,
 *     `previewPrompts`, and — when present — `description` / `voiceId`).
 *   - Fields the base `draft` already holds that the template does not define
 *     (e.g. `name`, `campusTag`, `creatorDisplayName`, `visibility`) are
 *     preserved unchanged.
 *   - `overrides` replace preset values field-by-field. Only defined override
 *     values take effect; an `undefined` override never wipes a prefilled value.
 *
 * This is a pure function: it returns a new draft and never mutates its inputs.
 */
export function applyTemplate(
  draft: CampusAgentDraft,
  template: CampusTemplate,
  overrides: Partial<CampusAgentDraft> = {},
): CampusAgentDraft {
  // Start from the existing draft, then layer the template presets over it.
  const prefilled: CampusAgentDraft = {
    ...draft,
    agentType: template.agentType,
    personalityTone: template.personalityTone,
    previewPrompts: [...template.previewPrompts],
  };

  if (template.presetFields.defaultDescription !== undefined) {
    prefilled.description = template.presetFields.defaultDescription;
  }
  if (template.presetFields.defaultVoiceId !== undefined) {
    prefilled.voiceId = template.presetFields.defaultVoiceId;
  }

  // Field overrides replace preset values; ignore undefined overrides so they
  // never clear an already-prefilled field.
  for (const key of Object.keys(overrides) as (keyof CampusAgentDraft)[]) {
    const value = overrides[key];
    if (value !== undefined) {
      // Each key maps to its own field type; the assignment is sound because
      // `overrides` is a `Partial<CampusAgentDraft>`.
      (prefilled as Record<keyof CampusAgentDraft, unknown>)[key] = value;
    }
  }

  return prefilled;
}
