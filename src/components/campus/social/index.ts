/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Barrel exports for the Campus Social Loops surface components and context.
 */

export * from "./a11y";
export * from "./ui";
export { SocialProvider, useSocial } from "./SocialContext";
export type { SocialContextValue, ConsentKind, CompanionNotice } from "./SocialContext";
export { AgentBattlesScreen } from "./AgentBattlesScreen";
export { DailyChallengesScreen } from "./DailyChallengesScreen";
export { ShareClipsScreen } from "./ShareClipsScreen";
export { GroupChatScreen } from "./GroupChatScreen";
export { StreaksBadgesScreen } from "./StreaksBadgesScreen";
export { CampusQuestsScreen } from "./CampusQuestsScreen";

/**
 * The six social screens, keyed by their route slug, for the hub and tests.
 */
export const SOCIAL_SCREENS = [
  { slug: "battles", title: "Agent Battles", href: "/campus/social/battles", description: "Pit two agents head-to-head and vote." },
  { slug: "challenges", title: "Daily Challenges", href: "/campus/social/challenges", description: "Enter today's prompt and climb the leaderboard." },
  { slug: "clips", title: "Share Clips", href: "/campus/social/clips", description: "Turn a good call into a ready-to-post clip." },
  { slug: "groups", title: "Group Chat Mode", href: "/campus/social/groups", description: "Drop your agent into a group chat via a link." },
  { slug: "streaks", title: "Streaks & Badges", href: "/campus/social/streaks", description: "Track your streaks and earned badges." },
  { slug: "quests", title: "Campus Quests", href: "/campus/social/quests", description: "Take on lightweight discovery missions." },
] as const;
