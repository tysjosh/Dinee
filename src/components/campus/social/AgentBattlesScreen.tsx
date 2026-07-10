"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Agent Battles screen (`/campus/social/battles`). Presents the per-campus
 * Battle_Ranking — descending by wins over the trailing 7 days, top 20,
 * excluding non-circulating agents (Req 1.8) — lets a Student_Creator open a
 * battle, and lets a Voter cast/change a vote on an open battle. Owner-vote
 * rejection, "could not be started", and validation indications surface from
 * the reused Battle_Service (Req 1.2, 1.5, 1.11); the reused Usage_Meter
 * "temporarily unavailable" state surfaces via {@link StatusNotice} (Req 8.5).
 *
 * Built entirely from the shared accessible primitives so the surface meets the
 * WCAG-AA obligations in Requirements 8.7–8.10.
 */

import React, { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSocial } from "./SocialContext";
import {
  Card,
  Chip,
  ConsentPrompt,
  EmptyState,
  Field,
  LoadingRow,
  SocialButton,
  SocialInput,
  SocialSelect,
  StatusNotice,
} from "./ui";

const BATTLE_FORMATS = [
  { value: "roast_battle", label: "Roast battle" },
  { value: "debate", label: "Debate" },
  { value: "trivia_showdown", label: "Trivia showdown" },
  { value: "advice_showdown", label: "Advice showdown" },
  { value: "club_pitch_battle", label: "Club pitch battle" },
] as const;

type Notice = { tone: "warning" | "danger" | "neutral"; title: string; body?: string };

const CREATE_FAIL_MESSAGES: Record<string, string> = {
  not_authenticated: "Sign in to open a battle.",
  participant_count: "Pick exactly two different agents.",
  duplicate_participant: "The two agents must be different.",
  participant_not_published: "Both agents must be published.",
  format: "Choose a valid battle format.",
  access_denied: "One of the agents can't be reached.",
  consent_required: "A real-person agent needs verified voice-clone consent.",
  call_minutes_exhausted: "This account is out of call minutes.",
  start_failed: "An agent couldn't respond. Nothing was opened for voting.",
  content_withheld: "A response was withheld by content screening.",
};

const VOTE_FAIL_MESSAGES: Record<string, string> = {
  battle_not_found: "That battle no longer exists.",
  owner_excluded: "Owners can't vote in their own battle.",
  voting_closed: "Voting has closed for this battle.",
  invalid_choice: "That agent isn't part of this battle.",
};

export function AgentBattlesScreen() {
  const { hasConsent, setConsent } = useSocial();
  const [campus, setCampus] = useState("");
  const trimmedCampus = campus.trim();

  const ranking = useQuery(
    api.campus.social.battles.getBattleRanking,
    trimmedCampus.length > 0 ? { campusTag: trimmedCampus } : "skip",
  );

  const createBattle = useAction(api.campus.social.battles.createBattle);
  const castVote = useMutation(api.campus.social.battles.castVote);

  const [format, setFormat] = useState<string>(BATTLE_FORMATS[0].value);
  const [agentA, setAgentA] = useState("");
  const [agentB, setAgentB] = useState("");
  const [voteBattleId, setVoteBattleId] = useState("");
  const [voteChoice, setVoteChoice] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await createBattle({
        format,
        participantAgentIds: [agentA.trim(), agentB.trim()],
      });
      if (res.created) {
        setNotice({ tone: "neutral", title: "Battle opened for voting", body: "Voting stays open for 24 hours." });
      } else {
        const detail = "invalidField" in res ? res.invalidField : res.reason;
        setNotice({ tone: "danger", title: "Battle could not be started", body: CREATE_FAIL_MESSAGES[detail] ?? "Please check the agents and try again." });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const res = await castVote({ battleId: voteBattleId.trim(), choiceAgentId: voteChoice.trim() });
      if (res.accepted) {
        setNotice({ tone: "neutral", title: "Vote counted", body: "You can change your vote until voting closes." });
      } else {
        setNotice({ tone: "warning", title: "Vote not counted", body: VOTE_FAIL_MESSAGES[res.reason] ?? "Vote not counted." });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    }
  }

  const entries = ranking?.entries ?? [];

  return (
    <div className="space-y-6">
      {notice ? <StatusNotice tone={notice.tone} title={notice.title} body={notice.body} testId="battle-notice" /> : null}

      {!hasConsent("sharing") ? (
        <ConsentPrompt
          kind="sharing"
          title="Share a battle clip?"
          body="A resolved battle can become a ready-to-post clip when both owners consent to sharing."
          onGrant={() => setConsent("sharing", true)}
          onDecline={() => setConsent("sharing", false)}
        />
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-white">Open a battle</h2>
        <p className="mt-1 text-sm text-white/70">
          Pit two published agents head-to-head. Each responds through the voice runtime, then students vote.
        </p>
        <form className="mt-4 space-y-3" onSubmit={handleCreate}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Agent A" htmlFor="battle-agent-a">
              <SocialInput id="battle-agent-a" value={agentA} onChange={(e) => setAgentA(e.target.value)} placeholder="Agent ID" data-testid="battle-agent-a" />
            </Field>
            <Field label="Agent B" htmlFor="battle-agent-b">
              <SocialInput id="battle-agent-b" value={agentB} onChange={(e) => setAgentB(e.target.value)} placeholder="Agent ID" data-testid="battle-agent-b" />
            </Field>
          </div>
          <Field label="Format" htmlFor="battle-format">
            <SocialSelect id="battle-format" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="battle-format">
              {BATTLE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SocialSelect>
          </Field>
          <SocialButton type="submit" disabled={submitting || agentA.trim() === "" || agentB.trim() === ""} data-testid="battle-create">
            {submitting ? "Starting…" : "Start battle"}
          </SocialButton>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white">Vote on a battle</h2>
        <form className="mt-4 space-y-3" onSubmit={handleVote}>
          <Field label="Battle ID" htmlFor="battle-vote-id">
            <SocialInput id="battle-vote-id" value={voteBattleId} onChange={(e) => setVoteBattleId(e.target.value)} placeholder="battle id" data-testid="battle-vote-id" />
          </Field>
          <Field label="Your pick (agent ID)" htmlFor="battle-vote-choice">
            <SocialInput id="battle-vote-choice" value={voteChoice} onChange={(e) => setVoteChoice(e.target.value)} placeholder="Agent ID" data-testid="battle-vote-choice" />
          </Field>
          <SocialButton type="submit" variant="outline" disabled={voteBattleId.trim() === "" || voteChoice.trim() === ""} data-testid="battle-vote">
            Cast vote
          </SocialButton>
        </form>
      </Card>

      <section aria-labelledby="battle-ranking-heading">
        <h2 id="battle-ranking-heading" className="text-lg font-semibold text-white">
          Battle ranking
        </h2>
        <p className="mt-1 text-sm text-white/70">Top 20 agents by wins in the last 7 days on this campus.</p>
        <div className="mt-4">
          <Field label="Campus tag" htmlFor="battle-campus">
            <SocialInput id="battle-campus" value={campus} onChange={(e) => setCampus(e.target.value)} placeholder="e.g. state-university" data-testid="battle-campus" />
          </Field>
        </div>
        <div className="mt-4">
          {trimmedCampus.length === 0 ? (
            <EmptyState testId="battle-prompt" title="Pick a campus" body="Enter a campus tag above to see its battle ranking." />
          ) : ranking === undefined ? (
            <LoadingRow label="Building the ranking…" />
          ) : entries.length === 0 || ranking.isEmpty ? (
            <EmptyState testId="battle-empty" title="No battles yet" body="No agents have won a battle here in the last 7 days. Be the first." />
          ) : (
            <ol className="space-y-3" data-testid="battle-ranking">
              {entries.map((entry, index) => (
                <li key={entry.agentId}>
                  <Card className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-bold tabular-nums text-white/80" aria-label={`Rank ${index + 1}`}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-white">{entry.agentId}</span>
                    </span>
                    <Chip tone="accent">{entry.wins} {entry.wins === 1 ? "win" : "wins"}</Chip>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

export default AgentBattlesScreen;
