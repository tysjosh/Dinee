/**
 * Feature: dinee-campus (Task 7.1)
 *
 * Pure, property-testable core for the Share_Service: Call_Link slug
 * generation/resolution, the share-format set (copy-link, QR, SMS/iMessage,
 * Instagram/TikTok/Snapchat, embeddable card), the Instagram/TikTok/Snapchat
 * Share_Card, and the Call_Clip gating decision. These functions carry NO
 * Convex `ctx` and perform no I/O, so they can be exercised directly by unit
 * and property tests and imported by the Convex `share.ts` service that wraps
 * them with persistence + storage.
 *
 * Covered behaviors:
 *   - 6.8 / 7.1: a Call_Link slug is unique across all Campus_Agents and
 *     round-trips (resolves) to the owning agent.
 *   - 7.3 / 7.4: the share-format set — copy-link action, QR payload, SMS /
 *     iMessage, Instagram/TikTok/Snapchat social formats, and an embeddable
 *     card — where every link-bearing format embeds the Call_Link URL.
 *   - 15.14: the Share_Card is produced in Instagram, TikTok, and Snapchat
 *     formats and contains the agent name, Campus_Tag, Agent_Type, the visible
 *     "AI voice agent" label, and the Call_Link, reusing the same social-format
 *     assembly as the share formats so the content stays consistent (7.3).
 *   - 15.12 / 15.13: a Call_Clip is produced only when the source call was
 *     recorded AND the caller acknowledged the recording notice; otherwise the
 *     request is declined with `clip_unavailable`. A produced clip carries the
 *     "AI voice agent" label and attribution to the Campus_Agent.
 */

import type { AgentType } from "./validation";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * The visible label every Campus_Agent surface (profile, Share_Card, Call_Clip)
 * must carry so a Caller always knows they are interacting with an AI voice
 * agent (Req 6.3, 15.12, 15.14).
 */
export const AI_VOICE_AGENT_LABEL = "AI voice agent";

/**
 * The route prefix an Agent_Profile_Page lives under. A Call_Link is this
 * prefix joined with the agent's unique slug, so opening the link resolves to
 * the profile page (Req 6.8, 7.1, 7.6).
 */
export const CAMPUS_AGENT_PATH_PREFIX = "/campus/a/";

/** Fallback base for a slug whose name reduces to the empty string. */
const SLUG_FALLBACK = "agent";

// ---------------------------------------------------------------------------
// Slug generation & resolution (Req 6.8, 7.1)
// ---------------------------------------------------------------------------

/** The minimal agent shape needed to assign a Call_Link slug. */
export interface AgentSlugInput {
  /** Stable, unique public id of the Campus_Agent. */
  agentId: string;
  /** The agent name the human-readable slug base is derived from. */
  name: string;
}

/** An agent paired with the unique Call_Link slug assigned to it. */
export interface AgentWithSlug {
  agentId: string;
  slug: string;
}

/**
 * Reduces an agent name to a URL-safe slug base: lowercased, non-alphanumeric
 * runs collapsed to single hyphens, leading/trailing hyphens trimmed. An empty
 * result (e.g. a name of only punctuation) falls back to {@link SLUG_FALLBACK}.
 * Pure and deterministic.
 */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : SLUG_FALLBACK;
}

/**
 * A short, deterministic, URL-safe token derived from an agent id, used to
 * disambiguate slugs whose name bases collide. Uses a stable string hash so
 * the same agent id always yields the same token. Pure.
 */
export function slugDisambiguator(agentId: string): string {
  let hash = 5381;
  for (let i = 0; i < agentId.length; i++) {
    // djb2: hash * 33 + char, kept in the unsigned 32-bit range.
    hash = (hash * 33 + agentId.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Generates a Call_Link slug for one agent that is unique with respect to a set
 * of already-used slugs (Req 7.1). Deterministic: the same name + agent id +
 * existing set always produce the same slug.
 *
 * Strategy: prefer the clean name base; on collision append a deterministic
 * token derived from the agent id; if that still collides, append an
 * incrementing integer suffix. The result is guaranteed not to be in
 * `existingSlugs`.
 */
export function generateUniqueSlug(
  input: AgentSlugInput,
  existingSlugs: Iterable<string>
): string {
  const used = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);
  const base = slugifyName(input.name);
  if (!used.has(base)) {
    return base;
  }
  const disambiguated = `${base}-${slugDisambiguator(input.agentId)}`;
  if (!used.has(disambiguated)) {
    return disambiguated;
  }
  let counter = 2;
  let candidate = `${disambiguated}-${counter}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${disambiguated}-${counter}`;
  }
  return candidate;
}

/**
 * Assigns a unique Call_Link slug to every agent in a set (Req 7.1).
 * Deterministic over the input order: each slug is unique across the whole set,
 * so the resulting `slug → agentId` mapping is one-to-one and round-trips
 * (Req 6.8). Pure and non-mutating.
 */
export function assignSlugs(agents: readonly AgentSlugInput[]): AgentWithSlug[] {
  const used = new Set<string>();
  const assigned: AgentWithSlug[] = [];
  for (const agent of agents) {
    const slug = generateUniqueSlug(agent, used);
    used.add(slug);
    assigned.push({ agentId: agent.agentId, slug });
  }
  return assigned;
}

/**
 * Resolves a Call_Link slug to the owning agent (Req 6.8, 7.1). Returns the
 * matching agent, or `undefined` when no agent carries that slug (the caller
 * maps `undefined` to the unavailable-or-invalid response of Req 7.8). Pure.
 */
export function resolveSlug<T extends { slug: string }>(
  slug: string,
  agents: readonly T[]
): T | undefined {
  return agents.find((agent) => agent.slug === slug);
}

// ---------------------------------------------------------------------------
// Call_Link construction (Req 7.1, 7.6)
// ---------------------------------------------------------------------------

/**
 * Builds the absolute Call_Link URL for a slug given the platform base URL
 * (e.g. `https://dinee.app`). Any trailing slash on the base is normalized so
 * the joined URL has exactly one separator. Pure and deterministic.
 */
export function buildCallLink(slug: string, baseUrl: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  return `${trimmedBase}${CAMPUS_AGENT_PATH_PREFIX}${slug}`;
}

// ---------------------------------------------------------------------------
// Social caption (shared by share formats and the Share_Card) (Req 7.3, 15.14)
// ---------------------------------------------------------------------------

/** The three social platforms Campus produces share formats / cards for. */
export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "snapchat"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** The identity fields a share format / Share_Card is assembled from. */
export interface ShareAgent {
  name: string;
  campusTag: string;
  agentType: AgentType;
  slug: string;
}

/**
 * Assembles the shared social caption used by both the social share formats and
 * the Share_Card so the two stay consistent (Req 7.3, 15.14). The caption names
 * the agent, carries the "AI voice agent" label and Campus_Tag, and embeds the
 * Call_Link. Pure and deterministic.
 */
export function assembleSocialCaption(callLink: string, agent: ShareAgent): string {
  return (
    `Call ${agent.name} — an ${AI_VOICE_AGENT_LABEL} on ${agent.campusTag}. ` +
    `${callLink}`
  );
}

// ---------------------------------------------------------------------------
// Share formats (Req 7.3, 7.4)
// ---------------------------------------------------------------------------

/** A single social share format (Instagram / TikTok / Snapchat). */
export interface SocialShareFormat {
  platform: SocialPlatform;
  /** Caption text that embeds the Call_Link (Req 7.3). */
  caption: string;
  /** The embedded Call_Link URL (Req 7.3). */
  callLink: string;
}

/**
 * The full share-format set for a published Campus_Agent (Req 7.3, 7.4). Every
 * link-bearing format embeds the Call_Link URL.
 */
export interface ShareFormats {
  /** The canonical Call_Link the other formats embed. */
  callLink: string;
  /** Copy-link action payload — the URL placed on the clipboard (Req 7.3, 7.5). */
  copyLink: { url: string };
  /** QR code payload — encodes the Call_Link (Req 7.3). */
  qr: { payload: string };
  /** SMS / iMessage share body embedding the Call_Link (Req 7.3). */
  sms: { body: string };
  /** Instagram social share format (Req 7.3). */
  instagram: SocialShareFormat;
  /** TikTok social share format (Req 7.3). */
  tiktok: SocialShareFormat;
  /** Snapchat social share format (Req 7.3). */
  snapchat: SocialShareFormat;
  /** Embeddable visual card whose markup embeds the Call_Link (Req 7.4). */
  embedCard: { html: string };
}

/** Assembles one social share format for a platform (Req 7.3). Pure. */
function assembleSocialFormat(
  platform: SocialPlatform,
  callLink: string,
  agent: ShareAgent
): SocialShareFormat {
  return {
    platform,
    caption: assembleSocialCaption(callLink, agent),
    callLink,
  };
}

/**
 * Assembles the complete share-format set for a published Campus_Agent
 * (Req 7.3, 7.4). Every link-bearing format (copy-link, QR, SMS, each social
 * format, embed card) embeds the Call_Link URL. Pure and deterministic.
 */
export function assembleShareFormats(agent: ShareAgent, baseUrl: string): ShareFormats {
  const callLink = buildCallLink(agent.slug, baseUrl);
  return {
    callLink,
    copyLink: { url: callLink },
    qr: { payload: callLink },
    sms: {
      body: `Call my ${AI_VOICE_AGENT_LABEL} "${agent.name}": ${callLink}`,
    },
    instagram: assembleSocialFormat("instagram", callLink, agent),
    tiktok: assembleSocialFormat("tiktok", callLink, agent),
    snapchat: assembleSocialFormat("snapchat", callLink, agent),
    embedCard: {
      html:
        `<a class="dinee-campus-embed" href="${callLink}">` +
        `${agent.name} · ${AI_VOICE_AGENT_LABEL} · ${agent.campusTag}</a>`,
    },
  };
}

// ---------------------------------------------------------------------------
// Share_Card (Req 15.14)
// ---------------------------------------------------------------------------

/**
 * One platform variant of the Share_Card. Contains the agent name, Campus_Tag,
 * Agent_Type, the visible "AI voice agent" label, and the Call_Link (Req
 * 15.14). The `caption` is the same social caption used by the share formats so
 * the Share_Card stays consistent with them (Req 7.3).
 */
export interface ShareCardFormat {
  platform: SocialPlatform;
  agentName: string;
  campusTag: string;
  agentType: AgentType;
  /** Always {@link AI_VOICE_AGENT_LABEL} (Req 15.14). */
  label: string;
  callLink: string;
  caption: string;
}

/** The Share_Card produced in Instagram, TikTok, and Snapchat formats (Req 15.14). */
export interface ShareCard {
  instagram: ShareCardFormat;
  tiktok: ShareCardFormat;
  snapchat: ShareCardFormat;
}

/** Assembles one Share_Card platform variant (Req 15.14). Pure. */
function assembleShareCardFormat(
  platform: SocialPlatform,
  callLink: string,
  agent: ShareAgent
): ShareCardFormat {
  return {
    platform,
    agentName: agent.name,
    campusTag: agent.campusTag,
    agentType: agent.agentType,
    label: AI_VOICE_AGENT_LABEL,
    callLink,
    caption: assembleSocialCaption(callLink, agent),
  };
}

/**
 * Assembles the Share_Card in all three social formats for a published
 * Campus_Agent (Req 15.14). Every variant contains the agent name, Campus_Tag,
 * Agent_Type, the "AI voice agent" label, and the Call_Link, reusing the same
 * social-format caption assembly as {@link assembleShareFormats} for
 * consistency (Req 7.3). Pure and deterministic.
 */
export function assembleShareCard(agent: ShareAgent, baseUrl: string): ShareCard {
  const callLink = buildCallLink(agent.slug, baseUrl);
  return {
    instagram: assembleShareCardFormat("instagram", callLink, agent),
    tiktok: assembleShareCardFormat("tiktok", callLink, agent),
    snapchat: assembleShareCardFormat("snapchat", callLink, agent),
  };
}

// ---------------------------------------------------------------------------
// Call_Clip gating (Req 15.12, 15.13)
// ---------------------------------------------------------------------------

/**
 * The request context for producing a Call_Clip from a completed voice
 * conversation (Req 15.12, 15.13).
 */
export interface CallClipRequest {
  callId: string;
  agentId: string;
  agentName: string;
  /** True iff call recording was enabled for the source call (Req 15.12). */
  recordingEnabled: boolean;
  /** True iff the Caller acknowledged the recording notice (Req 15.12, 12.7). */
  callerAcknowledgedRecording: boolean;
}

/** Attribution to the Campus_Agent carried by a produced Call_Clip (Req 15.12). */
export interface CallClipAttribution {
  agentId: string;
  agentName: string;
}

/** A produced Call_Clip: carries the "AI voice agent" label + agent attribution. */
export interface ProducedCallClip {
  callId: string;
  /** Always {@link AI_VOICE_AGENT_LABEL} (Req 15.12). */
  label: string;
  attribution: CallClipAttribution;
}

/**
 * The gating decision for a Call_Clip request (Req 15.12, 15.13):
 *   - `produced: true` with the labelled, attributed clip when the source call
 *     was recorded and the Caller acknowledged the recording notice.
 *   - `produced: false` with reason `clip_unavailable` otherwise, including a
 *     message that clips are available only for recorded calls.
 */
export type CallClipDecision =
  | { produced: true; clip: ProducedCallClip }
  | { produced: false; reason: "clip_unavailable"; message: string };

/**
 * The message returned when a Call_Clip cannot be produced (Req 15.13).
 */
export const CLIP_UNAVAILABLE_MESSAGE =
  "A clip is available only for recorded calls.";

/**
 * Decides whether a Call_Clip may be produced (Req 15.12, 15.13). A clip is
 * produced only when the source call was recorded AND the Caller acknowledged
 * the recording notice; a produced clip carries the "AI voice agent" label and
 * attribution to the Campus_Agent. Any other case (not recorded, or the notice
 * was declined) is declined with `clip_unavailable`. Pure and deterministic.
 */
export function decideCallClip(request: CallClipRequest): CallClipDecision {
  if (request.recordingEnabled && request.callerAcknowledgedRecording) {
    return {
      produced: true,
      clip: {
        callId: request.callId,
        label: AI_VOICE_AGENT_LABEL,
        attribution: {
          agentId: request.agentId,
          agentName: request.agentName,
        },
      },
    };
  }
  return {
    produced: false,
    reason: "clip_unavailable",
    message: CLIP_UNAVAILABLE_MESSAGE,
  };
}
