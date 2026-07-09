import { DiscoveryFeed } from "@/components/campus/DiscoveryFeed";

/**
 * Feature: dinee-campus (Task 31.1)
 *
 * Route `/campus/discover` — the discovery surface (Req 10.3, 10.4, 10.6, 10.7,
 * 10.8, 15.10, 15.11). Renders the client `DiscoveryFeed`, which lists public +
 * published Campus_Agents (paginated, filterable) and the per-campus
 * Campus_Leaderboard, both sourced from the `campus.discovery` Convex queries.
 */
export default function CampusDiscoverPage() {
  return <DiscoveryFeed />;
}
