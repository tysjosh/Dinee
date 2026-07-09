// Feature: dinee-campus, Property 5: Applying a template prefills configurable fields with its presets
/**
 * Feature: dinee-campus, Property 5: Applying a template prefills configurable
 * fields with its presets
 *
 * Validates: Requirements 3.3, 3.5
 *
 * Req 3.3 — When a Student_Creator selects a template, the Agent_Creation_Flow
 * SHALL prefill every configurable Campus_Agent field with that template's
 * corresponding preset value.
 *
 * Req 3.5 — The Agent_Creation_Flow SHALL allow a Student_Creator to change any
 * prefilled field value originating from a template before publishing.
 *
 * The pure transform under test is {@link applyTemplate}. This property asserts:
 *   (a) With no overrides, every field the template defines (`agentType`,
 *       `personalityTone`, `previewPrompts`, and — when present —
 *       `description`/`voiceId`) equals the template's preset value.
 *   (b) Fields the template does not define (`name`, `campusTag`,
 *       `creatorDisplayName`, `visibility`) are preserved from the base draft.
 *   (c) A defined override replaces the corresponding preset value, while an
 *       `undefined` override never clears an already-prefilled field (Req 3.5).
 *   (d) `applyTemplate` is pure: it mutates neither the draft nor the template.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  applyTemplate,
  listTemplates,
  AGENT_TYPES,
  type AgentType,
  type CampusAgentDraft,
  type CampusTemplate,
} from "../../../convex/campus/logic/templates";

const TEMPLATES: CampusTemplate[] = listTemplates();

/** Arbitrary over the seven Template_Library entries. */
const templateArb: fc.Arbitrary<CampusTemplate> = fc.constantFrom(...TEMPLATES);

/**
 * Arbitrary base draft. Every configurable field is optional so we exercise
 * both the "field already present" and "field absent" cases. The values are
 * intentionally distinct from any template preset so that prefill/override
 * effects are observable.
 */
const draftArb: fc.Arbitrary<CampusAgentDraft> = fc.record(
  {
    name: fc.string(),
    agentType: fc.constantFrom<AgentType>(...AGENT_TYPES),
    campusTag: fc.string(),
    voiceId: fc.string().map((s) => `draft_voice_${s}`),
    personalityTone: fc.string().map((s) => `draft_tone_${s}`),
    description: fc.string().map((s) => `draft_desc_${s}`),
    creatorDisplayName: fc.string(),
    previewPrompts: fc.array(fc.string(), { maxLength: 4 }),
    visibility: fc.constantFrom<"public" | "private">("public", "private"),
  },
  { requiredKeys: [] }
);

/**
 * Arbitrary override set. Any subset of configurable fields may be provided,
 * and any provided value may be `undefined` (modelling an override object whose
 * key is present but carries no value). Override values are tagged so they are
 * distinguishable from both draft and template values.
 */
const overridesArb: fc.Arbitrary<Partial<CampusAgentDraft>> = fc.record(
  {
    name: fc.option(fc.string().map((s) => `ovr_name_${s}`), { nil: undefined }),
    agentType: fc.option(fc.constantFrom<AgentType>(...AGENT_TYPES), {
      nil: undefined,
    }),
    campusTag: fc.option(fc.string().map((s) => `ovr_tag_${s}`), {
      nil: undefined,
    }),
    voiceId: fc.option(fc.string().map((s) => `ovr_voice_${s}`), {
      nil: undefined,
    }),
    personalityTone: fc.option(fc.string().map((s) => `ovr_tone_${s}`), {
      nil: undefined,
    }),
    description: fc.option(fc.string().map((s) => `ovr_desc_${s}`), {
      nil: undefined,
    }),
    creatorDisplayName: fc.option(fc.string().map((s) => `ovr_name_${s}`), {
      nil: undefined,
    }),
    previewPrompts: fc.option(
      fc.array(fc.string().map((s) => `ovr_prompt_${s}`), { maxLength: 3 }),
      { nil: undefined }
    ),
    visibility: fc.option(fc.constantFrom<"public" | "private">("public", "private"), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] }
);

/** Fields defined by the template preset (always prefilled). */
const TEMPLATE_DEFINED_FIELDS: (keyof CampusAgentDraft)[] = [
  "agentType",
  "personalityTone",
  "previewPrompts",
];

/** Fields the template never defines (preserved from the base draft). */
const TEMPLATE_UNDEFINED_FIELDS: (keyof CampusAgentDraft)[] = [
  "name",
  "campusTag",
  "creatorDisplayName",
  "visibility",
];

describe("Property 5: Applying a template prefills configurable fields with its presets", () => {
  it("prefills every template-defined field with the template's preset value (no overrides)", () => {
    fc.assert(
      fc.property(draftArb, templateArb, (draft, template) => {
        const result = applyTemplate(draft, template);

        expect(result.agentType).toBe(template.agentType);
        expect(result.personalityTone).toBe(template.personalityTone);
        expect(result.previewPrompts).toEqual(template.previewPrompts);

        if (template.presetFields.defaultDescription !== undefined) {
          expect(result.description).toBe(
            template.presetFields.defaultDescription
          );
        }
        if (template.presetFields.defaultVoiceId !== undefined) {
          expect(result.voiceId).toBe(template.presetFields.defaultVoiceId);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("preserves fields the template does not define", () => {
    fc.assert(
      fc.property(draftArb, templateArb, (draft, template) => {
        const result = applyTemplate(draft, template);
        for (const field of TEMPLATE_UNDEFINED_FIELDS) {
          expect(result[field]).toEqual(draft[field]);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("lets a defined override replace the preset, while undefined overrides never clear a prefilled field (Req 3.5)", () => {
    fc.assert(
      fc.property(
        draftArb,
        templateArb,
        overridesArb,
        (draft, template, overrides) => {
          const prefilledOnly = applyTemplate(draft, template);
          const result = applyTemplate(draft, template, overrides);

          for (const field of Object.keys(prefilledOnly).concat(
            Object.keys(overrides)
          ) as (keyof CampusAgentDraft)[]) {
            const overrideValue = overrides[field];
            if (overrideValue !== undefined) {
              // A defined override wins field-by-field.
              expect(result[field]).toEqual(overrideValue);
            } else {
              // No effective override → value matches the prefilled result.
              expect(result[field]).toEqual(prefilledOnly[field]);
            }
          }

          // Template-defined fields are never left empty after prefill.
          for (const field of TEMPLATE_DEFINED_FIELDS) {
            expect(result[field]).not.toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("is pure: it mutates neither the draft nor the template", () => {
    fc.assert(
      fc.property(
        draftArb,
        templateArb,
        overridesArb,
        (draft, template, overrides) => {
          const draftSnapshot = structuredClone(draft);
          const templateSnapshot = structuredClone(template);

          applyTemplate(draft, template, overrides);

          expect(draft).toEqual(draftSnapshot);
          expect(template).toEqual(templateSnapshot);
        }
      ),
      { numRuns: 100 }
    );
  });
});
