"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * The Campus Social Loops hub at `/campus/social`. Links to the six engagement
 * screens using the shared accessible primitives, so it satisfies the same
 * WCAG-AA obligations (Req 8.7–8.10) as the screens themselves.
 */

import React from "react";
import { SOCIAL_SCREENS } from "./index";
import { SocialShell, SocialCardLink } from "./ui";

export function SocialHub() {
  return (
    <SocialShell
      title="Campus Social"
      subtitle="Battles, challenges, clips, group chats, streaks, and quests."
      backHref="/campus"
      backLabel="Campus"
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="social-hub">
        {SOCIAL_SCREENS.map((screen) => (
          <li key={screen.slug}>
            <SocialCardLink href={screen.href} data-testid={`social-link-${screen.slug}`}>
              <span className="block font-semibold text-white">{screen.title}</span>
              <span className="mt-1 block text-sm text-white/70">{screen.description}</span>
            </SocialCardLink>
          </li>
        ))}
      </ul>
    </SocialShell>
  );
}

export default SocialHub;
