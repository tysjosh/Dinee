/**
 * Feature: dinee-campus (Task 2.1)
 *
 * `campusCopy` — the single source of truth for all student-facing strings in
 * the Dinee Campus surface: the landing promise + primary CTA, the onboarding
 * question and its seven option labels, and the per-field labels and
 * instructions used across onboarding/creation.
 *
 * This module is PURE and runtime-free (no Convex `ctx`, no I/O), so it can be
 * imported by both the Convex functions and the student-facing Next.js client
 * (via the `src/lib/campus/copy.ts` re-export), and exercised directly by the
 * copy property test.
 *
 * Covered behaviors:
 *   - 1.1: the landing promise text and a single primary CTA that begins the
 *     Onboarding_Flow.
 *   - 2.1: the first onboarding question "What do you want to create?" with the
 *     seven selectable option labels.
 *   - 2.6: the defined per-field labels and instructions for every field.
 *   - 1.6 / 2.6: the whole corpus excludes the Business_Terminology_Exclusion_List
 *     ("restaurant", "tenant", "branch") case-insensitively and includes the
 *     student-oriented terms "student" and "campus". The corpus is exposed as an
 *     enumerable structure ({@link getAllCampusCopyStrings}) so a lint/property
 *     check can iterate every string.
 */

/**
 * The seven Agent_Types offered at creation (Req 2.1, 2.3). Declared locally so
 * this copy module stays free of any Convex/schema dependency.
 */
export type CampusAgentType =
  | "ai_twin"
  | "study_agent"
  | "club_agent"
  | "campus_guide"
  | "funny_character"
  | "tutor_agent"
  | "advice_agent";

/**
 * The Business_Terminology_Exclusion_List — business-oriented terms that
 * student-facing text must never contain, matched case-insensitively (Req 1.6,
 * 2.6).
 */
export const BUSINESS_TERMINOLOGY_EXCLUSION_LIST = [
  "restaurant",
  "tenant",
  "branch",
] as const;

/**
 * The student-oriented terms the copy corpus as a whole must include (Req 1.6,
 * 2.6).
 */
export const REQUIRED_STUDENT_TERMS = ["student", "campus"] as const;

/** A single onboarding option: its display label and the Agent_Type it maps to. */
export interface OnboardingOption {
  readonly agentType: CampusAgentType;
  readonly label: string;
}

/** The label + one-line instruction for a single onboarding/creation field. */
export interface FieldCopy {
  /** Stable key used to correlate the copy with a validator/field. */
  readonly key: string;
  /** The student-facing label shown for the field (Req 2.6). */
  readonly label: string;
  /** The student-facing instruction/help text shown for the field (Req 2.6). */
  readonly instruction: string;
}

/** The full student-facing copy corpus. */
export interface CampusCopy {
  readonly landing: {
    /** The exact promise text required by Req 1.1. */
    readonly promise: string;
    /** Supporting subtext reinforcing the student/campus framing. */
    readonly subtext: string;
    /** The single primary call-to-action that begins the Onboarding_Flow (Req 1.1). */
    readonly primaryCta: string;
  };
  readonly onboarding: {
    /** The first onboarding question, exactly as required by Req 2.1. */
    readonly firstQuestion: string;
    /** The seven selectable options, in the order defined by Req 2.1. */
    readonly options: readonly OnboardingOption[];
  };
  /** Labels + instructions for every required field (Req 2.3, 2.6). */
  readonly requiredFields: readonly FieldCopy[];
  /** Labels + instructions for every optional field (Req 2.4, 2.6). */
  readonly optionalFields: readonly FieldCopy[];
}

/**
 * The single source of student-facing strings for Dinee Campus.
 *
 * The landing promise is the exact text mandated by Req 1.1. The seven
 * onboarding options are listed in the exact order and wording of Req 2.1. All
 * labels/instructions deliberately use student- and campus-oriented language and
 * avoid every term in the Business_Terminology_Exclusion_List.
 */
export const campusCopy: CampusCopy = {
  landing: {
    promise:
      "Create an AI voice agent. Give it knowledge, personality, and a call link. Share it with your campus.",
    subtext:
      "Built for students. Make an AI voice agent, then share it across your campus.",
    primaryCta: "Create your AI voice agent",
  },
  onboarding: {
    firstQuestion: "What do you want to create?",
    options: [
      { agentType: "ai_twin", label: "AI twin" },
      { agentType: "study_agent", label: "Study agent" },
      { agentType: "club_agent", label: "Club/event agent" },
      { agentType: "campus_guide", label: "Campus guide" },
      { agentType: "funny_character", label: "Funny character" },
      { agentType: "tutor_agent", label: "Tutor agent" },
      { agentType: "advice_agent", label: "Advice agent" },
    ],
  },
  requiredFields: [
    {
      key: "name",
      label: "Agent name",
      instruction: "Give your AI voice agent a name (1 to 50 characters).",
    },
    {
      key: "agentType",
      label: "What do you want to create?",
      instruction: "Pick the kind of agent you want to build.",
    },
    {
      key: "campus",
      label: "Campus or school",
      instruction: "Tell callers which campus or school this agent belongs to.",
    },
    {
      key: "voice",
      label: "Voice",
      instruction: "Choose the voice your agent speaks in.",
    },
    {
      key: "personalityTone",
      label: "Personality and tone",
      instruction: "Set how your agent sounds and behaves.",
    },
    {
      key: "knowledge",
      label: "Knowledge",
      instruction: "Add what your agent knows so it can answer questions.",
    },
    {
      key: "visibility",
      label: "Visibility",
      instruction: "Choose whether your agent is public or private.",
    },
    {
      key: "description",
      label: "Short description",
      instruction:
        "Describe your agent in a sentence or two (up to 280 characters).",
    },
    {
      key: "creatorDisplayName",
      label: "Your creator name",
      instruction: "The name other students see as the creator of this agent.",
    },
  ],
  optionalFields: [
    {
      key: "socialLink",
      label: "Instagram, TikTok, or link-in-bio",
      instruction: "Add a social link so callers can find you.",
    },
    {
      key: "clubName",
      label: "Club name",
      instruction: "Name the club or group this agent represents.",
    },
    {
      key: "courseCode",
      label: "Class or course code",
      instruction: "Add the class or course code this agent helps with.",
    },
    {
      key: "eventDate",
      label: "Event date",
      instruction: "Set the date of the event your agent is about.",
    },
    {
      key: "contactEmail",
      label: "Contact email",
      instruction: "Add an email address callers can reach you at.",
    },
    {
      key: "monetizationLink",
      label: "Monetization link",
      instruction: "Add a link where supporters can back your work.",
    },
  ],
};

/**
 * Returns every student-facing string in the copy corpus as a flat, enumerable
 * list (Req 1.6, 2.6). This is the enumeration a lint/property check iterates
 * to assert the Business_Terminology_Exclusion_List is excluded and the required
 * student terms are present. Pure and non-mutating.
 */
export function getAllCampusCopyStrings(copy: CampusCopy = campusCopy): string[] {
  const strings: string[] = [
    copy.landing.promise,
    copy.landing.subtext,
    copy.landing.primaryCta,
    copy.onboarding.firstQuestion,
  ];
  for (const option of copy.onboarding.options) {
    strings.push(option.label);
  }
  for (const field of [...copy.requiredFields, ...copy.optionalFields]) {
    strings.push(field.label, field.instruction);
  }
  return strings;
}

/**
 * True iff `value` contains any Business_Terminology_Exclusion_List term under
 * case-insensitive matching (Req 1.6, 2.6). Pure helper shared by the client
 * lint check and the copy property test.
 */
export function containsBusinessTerminology(value: string): boolean {
  const lower = value.toLowerCase();
  return BUSINESS_TERMINOLOGY_EXCLUSION_LIST.some((term) =>
    lower.includes(term)
  );
}

/**
 * True iff the copy corpus as a whole contains every required student-oriented
 * term under case-insensitive matching (Req 1.6, 2.6). Pure and non-mutating.
 */
export function corpusIncludesRequiredStudentTerms(
  copy: CampusCopy = campusCopy
): boolean {
  const haystack = getAllCampusCopyStrings(copy).join(" ").toLowerCase();
  return REQUIRED_STUDENT_TERMS.every((term) => haystack.includes(term));
}
