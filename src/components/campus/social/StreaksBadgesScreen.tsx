"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Streaks & Badges screen (`/campus/social/streaks`). Displays the user's
 * current Creator_Streak and Caller_Streak (as non-negative integers) and all
 * awarded Badges from the reused Gamification_Service profile projection, which
 * the surface renders within the 3-second budget (Req 5.7). Requires a signed-in
 * account; otherwise it prompts to sign in without disclosing another user's
 * data.
 */

import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSocial } from "./SocialContext";
import { Card, Chip, EmptyState, LoadingRow } from "./ui";

interface ProfileBadge {
  readonly badgeKey: string;
  readonly category?: string;
}

interface Profile {
  readonly creatorStreak: number;
  readonly callerStreak: number;
  readonly badges: ProfileBadge[];
}

export function StreaksBadgesScreen() {
  const { userId, isLoading } = useSocial();

  const profile = useQuery(
    api.campus.social.gamification.getGamificationProfile,
    userId ? { userId } : "skip",
  ) as Profile | undefined;

  if (isLoading) {
    return <LoadingRow label="Loading your profile…" />;
  }

  if (!userId) {
    return (
      <EmptyState
        testId="streaks-signed-out"
        title="Sign in to see your streaks"
        body="Your streaks and badges appear here once you sign in."
      />
    );
  }

  if (profile === undefined) {
    return <LoadingRow label="Loading your profile…" />;
  }

  const badges = profile.badges ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-white/70">Creator streak</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white" data-testid="creator-streak">
            {Math.max(0, profile.creatorStreak ?? 0)}
          </p>
          <p className="mt-1 text-xs text-white/60">consecutive days</p>
        </Card>
        <Card>
          <p className="text-sm text-white/70">Caller streak</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white" data-testid="caller-streak">
            {Math.max(0, profile.callerStreak ?? 0)}
          </p>
          <p className="mt-1 text-xs text-white/60">consecutive days</p>
        </Card>
      </div>

      <section aria-labelledby="badges-heading">
        <h2 id="badges-heading" className="text-lg font-semibold text-white">
          Badges
        </h2>
        <div className="mt-4">
          {badges.length === 0 ? (
            <EmptyState testId="badges-empty" title="No badges yet" body="Keep creating and calling to earn your first badge." />
          ) : (
            <ul className="flex flex-wrap gap-2" data-testid="badges-list">
              {badges.map((badge) => (
                <li key={badge.badgeKey}>
                  <Chip tone={badge.category === "caller" ? "primary" : "accent"}>
                    {badge.badgeKey.replace(/_/g, " ")}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export default StreaksBadgesScreen;
