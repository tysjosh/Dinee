// Feature: campus-social-loops, Property 4: Battle_Ranking is per-campus, descending by wins, bounded to 20, over the trailing 7 days, and excludes non-circulating agents
/**
 * Feature: campus-social-loops, Property 4: Battle_Ranking is per-campus,
 * descending by wins, bounded to 20, over the trailing 7 days, and excludes
 * non-circulating agents
 *
 * Validates: Requirements 1.8, 8.3
 *
 * Req 1.8: THE Battle_Service SHALL present a per-campus Battle_Ranking of
 * Campus_Agents ordered by descending Agent_Battle win count within a trailing
 * 7-day period, presenting at most the top 20 Campus_Agents and excluding any
 * Campus_Agent whose Visibility is private and any Campus_Agent in the removed,
 * blocked, or deleted Publish_State.
 * Req 8.3: Social-loops listings/rankings reuse the shared circulation exclusion
 * (published + public + matching campus).
 *
 * The pure function under test is {@link rankBattleWins}. The property asserts
 * the ranking is bounded to 20, ordered by descending wins (tie-broken by
 * ascending agentId), contains only published + public agents on the requested
 * campus with at least one win inside the trailing window, reports accurate win
 * counts, and is the true top-20 of the qualifying tally.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  rankBattleWins,
  MAX_BATTLE_RANKING_ENTRIES,
  BATTLE_RANKING_WINDOW_DAYS,
  type BattleWinRecord,
} from "../../../../convex/campus/social/logic/battles";
import {
  battleWinRecordsArb,
  campusTagArb,
  CLOCK_ANCHOR_MS,
} from "./arbitraries";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The true qualifying win tally per agent, computed independently. */
function trueWins(
  records: readonly BattleWinRecord[],
  campus: string,
  now: number,
  windowDays: number
): Map<string, number> {
  const windowStart = now - windowDays * MS_PER_DAY;
  const wins = new Map<string, number>();
  for (const r of records) {
    if (r.resolvedAt < windowStart || r.resolvedAt > now) continue;
    const discoverable = r.status === "published" && r.visibility === "public";
    const onCampus = r.campusTag === campus;
    if (!discoverable || !onCampus) continue;
    wins.set(r.agentId, (wins.get(r.agentId) ?? 0) + 1);
  }
  return wins;
}

describe("Property 4: Battle_Ranking is per-campus, descending by wins, bounded to 20, over the trailing 7 days, and excludes non-circulating agents", () => {
  it("returns a bounded, descending, campus-and-circulation-filtered, count-accurate top-20 ranking", () => {
    const now = CLOCK_ANCHOR_MS;
    fc.assert(
      fc.property(battleWinRecordsArb, campusTagArb, (records, campus) => {
        const result = rankBattleWins(
          records,
          campus,
          now,
          BATTLE_RANKING_WINDOW_DAYS
        );
        const expected = trueWins(
          records,
          campus,
          now,
          BATTLE_RANKING_WINDOW_DAYS
        );

        // Bounded to the top 20.
        expect(result.entries.length).toBeLessThanOrEqual(
          MAX_BATTLE_RANKING_ENTRIES
        );
        expect(result.entries.length).toBe(
          Math.min(expected.size, MAX_BATTLE_RANKING_ENTRIES)
        );

        // isEmpty flag is consistent.
        expect(result.isEmpty).toBe(result.entries.length === 0);

        const seen = new Set<string>();
        for (let i = 0; i < result.entries.length; i++) {
          const entry = result.entries[i];

          // Distinct agents.
          expect(seen.has(entry.agentId)).toBe(false);
          seen.add(entry.agentId);

          // Only qualifying agents appear, with accurate positive win counts.
          expect(expected.has(entry.agentId)).toBe(true);
          expect(entry.wins).toBe(expected.get(entry.agentId));
          expect(entry.wins).toBeGreaterThan(0);

          // Descending by wins; ties broken by ascending agentId.
          if (i > 0) {
            const prev = result.entries[i - 1];
            expect(prev.wins).toBeGreaterThanOrEqual(entry.wins);
            if (prev.wins === entry.wins) {
              expect(prev.agentId.localeCompare(entry.agentId)).toBeLessThan(0);
            }
          }
        }

        // The surfaced entries are the true top-20: no omitted qualifying agent
        // out-ranks the weakest surfaced entry.
        const minSurfaced =
          result.entries.length > 0
            ? result.entries[result.entries.length - 1].wins
            : Infinity;
        for (const [agentId, wins] of expected.entries()) {
          if (seen.has(agentId)) continue;
          expect(result.entries.length).toBe(MAX_BATTLE_RANKING_ENTRIES);
          expect(wins).toBeLessThanOrEqual(minSurfaced);
          if (wins === minSurfaced) {
            const last = result.entries[result.entries.length - 1].agentId;
            expect(last.localeCompare(agentId)).toBeLessThan(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("never surfaces a private, removed, blocked, deleted, or off-campus agent", () => {
    const now = CLOCK_ANCHOR_MS;
    fc.assert(
      fc.property(battleWinRecordsArb, campusTagArb, (records, campus) => {
        const result = rankBattleWins(
          records,
          campus,
          now,
          BATTLE_RANKING_WINDOW_DAYS
        );
        const circulating = new Set(
          records
            .filter(
              (r) =>
                r.status === "published" &&
                r.visibility === "public" &&
                r.campusTag === campus
            )
            .map((r) => r.agentId)
        );
        for (const entry of result.entries) {
          expect(circulating.has(entry.agentId)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
