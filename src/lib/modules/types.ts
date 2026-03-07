/**
 * Module boundary interface types for the AI Reception OS platform.
 *
 * Every Vertical Pack implements these interfaces to plug into the Core Platform.
 * The module boundary provides hooks for custom intents, tools, UI sections,
 * and analytics queries.
 *
 * Requirements: 3E.12, 9.1, 10.1
 */

/** The 6 supported business verticals on the platform. */
export type Vertical =
  | "general_services"
  | "healthcare"
  | "legal"
  | "hospitality"
  | "logistics"
  | "restaurant";

/**
 * A complete vertical pack that plugs into the Core Platform.
 * Each vertical implements one of these to provide domain-specific
 * workflows, UI components, and voice agent toolsets.
 */
export interface VerticalPack {
  /** Unique module identifier, e.g. "restaurant_pack" */
  moduleId: string;
  /** Which vertical this pack serves */
  vertical: Vertical;
  /** Prompt Pack for the voice agent */
  promptPack: PromptPack;
  /** Tool Pack for the voice agent */
  toolPack: ToolDefinition[];
  /** Dashboard UI section descriptors */
  uiSections: UISectionDescriptor[];
  /** Custom analytics query definitions */
  analyticsQueries: AnalyticsQueryDescriptor[];
  /** Custom intents handled by this pack */
  intents: IntentDefinition[];
  /** Integration hooks (optional) */
  integrationHooks?: IntegrationHook[];
}

/**
 * A set of AI agent system prompts, intent definitions, and conversation
 * scripts tailored to a specific Vertical.
 */
export interface PromptPack {
  systemPrompt: string;
  intents: IntentDefinition[];
  toneGuidance: string;
  greetingTemplate: string;
}

/** A single intent the voice agent can handle during a call. */
export interface IntentDefinition {
  name: string;
  description: string;
  requiredSlots: string[];
  /** Reference to the Convex function or API route */
  handler: string;
}

/** A backend tool available to the voice agent during calls. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  /** Convex function path */
  handler: string;
  /** e.g. "runsheet_connect" — tool is only available when this integration is enabled */
  requiresIntegration?: string;
}

/** Describes a single parameter for a ToolDefinition. */
export interface ToolParameter {
  type: string;
  description: string;
  required: boolean;
}

/** Describes a UI section that a vertical pack registers on the dashboard. */
export interface UISectionDescriptor {
  id: string;
  label: string;
  icon: string;
  tabId: string;
  /** Component path for dynamic import */
  component: string;
  requiredModule: string;
}

/** Describes a custom analytics query registered by a vertical pack. */
export interface AnalyticsQueryDescriptor {
  metricName: string;
  /** Convex query function path */
  query: string;
  vertical: Vertical;
}

/** An integration hook that fires on specific events. */
export interface IntegrationHook {
  /** e.g. "runsheet_connect" */
  integrationId: string;
  /** Event type */
  onEvent: string;
  /** Convex function path */
  handler: string;
}
