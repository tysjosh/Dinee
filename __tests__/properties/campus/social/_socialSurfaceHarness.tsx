// Feature: campus-social-loops (Tasks 19.2–19.5) — shared accessibility harness.
//
// Not a test file (no `*.test.ts` suffix, so vitest never collects it). It
// server-renders each of the six Campus Social Loops screens (plus the hub)
// inside the shared `SocialShell` and exposes:
//
//   - {@link renderAllSurfaces} — the static markup for every social surface, so
//     the layout / touch-target / contrast / focus tests exercise the real DOM
//     each screen produces (every interactive control on every screen), not a
//     hand-written fixture.
//   - {@link extractInteractive} — the interactive controls (button/a/input/
//     select/textarea) and their class lists, parsed from the static markup.
//   - {@link classTokens} / {@link extractTextWhiteTokens} — token helpers used
//     by the contrast + layout assertions.
//
// The three client dependencies the screens pull in (`convex/react`,
// `next/link`, and — transitively — `@/hooks/useCurrentUser`) are mocked by each
// test file via `vi.mock` before importing this harness, so `renderToStaticMarkup`
// runs in plain Node with no Convex provider, router, or DOM.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialProvider } from "@/components/campus/social/SocialContext";
import { SocialShell } from "@/components/campus/social/ui";
import { SocialHub } from "@/components/campus/social/SocialHub";
import { AgentBattlesScreen } from "@/components/campus/social/AgentBattlesScreen";
import { DailyChallengesScreen } from "@/components/campus/social/DailyChallengesScreen";
import { ShareClipsScreen } from "@/components/campus/social/ShareClipsScreen";
import { GroupChatScreen } from "@/components/campus/social/GroupChatScreen";
import { StreaksBadgesScreen } from "@/components/campus/social/StreaksBadgesScreen";
import { CampusQuestsScreen } from "@/components/campus/social/CampusQuestsScreen";

export interface RenderedSurface {
  /** Route slug of the surface, e.g. "battles" or "hub". */
  readonly name: string;
  /** Human title used in assertion messages. */
  readonly title: string;
  /** The static HTML the surface produces. */
  readonly html: string;
}

function shell(title: string, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <SocialProvider>
      <SocialShell title={title} subtitle="Accessibility harness render.">
        {node}
      </SocialShell>
    </SocialProvider>,
  );
}

/**
 * Render every social surface to static markup. The hub renders its own shell;
 * the six screens are wrapped in the shared shell exactly as their route pages
 * compose them (`<SocialShell><Screen /></SocialShell>`).
 */
export function renderAllSurfaces(): RenderedSurface[] {
  return [
    {
      name: "hub",
      title: "Campus Social",
      html: renderToStaticMarkup(
        <SocialProvider>
          <SocialHub />
        </SocialProvider>,
      ),
    },
    { name: "battles", title: "Agent Battles", html: shell("Agent Battles", <AgentBattlesScreen />) },
    { name: "challenges", title: "Daily Challenges", html: shell("Daily Challenges", <DailyChallengesScreen />) },
    { name: "clips", title: "Share Clips", html: shell("Share Clips", <ShareClipsScreen />) },
    { name: "groups", title: "Group Chat Mode", html: shell("Group Chat Mode", <GroupChatScreen />) },
    { name: "streaks", title: "Streaks & Badges", html: shell("Streaks & Badges", <StreaksBadgesScreen />) },
    { name: "quests", title: "Campus Quests", html: shell("Campus Quests", <CampusQuestsScreen />) },
  ];
}

/** The HTML tags treated as interactive controls for WCAG obligations. */
export const INTERACTIVE_TAGS = ["button", "a", "input", "select", "textarea"] as const;

export interface InteractiveEl {
  readonly tag: (typeof INTERACTIVE_TAGS)[number];
  readonly className: string;
}

/**
 * Parse every interactive control (with its class attribute) out of a chunk of
 * `renderToStaticMarkup` output. The output is well-formed, double-quoted markup,
 * so a tag-level scan is exact for the class-contract assertions.
 */
export function extractInteractive(html: string): InteractiveEl[] {
  const els: InteractiveEl[] = [];
  const tagRe = /<(button|a|input|select|textarea)\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1] as InteractiveEl["tag"];
    const attrs = m[2] ?? "";
    const classMatch = /class="([^"]*)"/.exec(attrs);
    els.push({ tag, className: classMatch ? classMatch[1] : "" });
  }
  return els;
}

/** Split a className string into its individual utility tokens. */
export function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

/** Every distinct class attribute value appearing anywhere in the markup. */
export function extractAllClassNames(html: string): string[] {
  const out: string[] = [];
  const re = /class="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Every `text-white` / `text-white/NN` token used anywhere in the markup. */
export function extractTextWhiteTokens(html: string): string[] {
  const tokens = new Set<string>();
  for (const cls of extractAllClassNames(html)) {
    for (const token of classTokens(cls)) {
      if (/^text-white(\/\d{1,3})?$/.test(token)) tokens.add(token);
    }
  }
  return [...tokens];
}
