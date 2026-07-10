"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Daily Challenges screen (`/campus/social/challenges`). Presents a
 * Daily_Challenge's Challenge_Leaderboard (descending by votes, tie-broken by
 * earliest submission, top 20, excluding non-circulating entries — Req 2.8),
 * lets a Student_Creator submit an entry and vote, and shows the empty-state
 * when no entries have been submitted (Req 2.10). Rejection reasons
 * ("closed", "already entered", "not owned/published") and the reused
 * Usage_Meter "temporarily unavailable" state surface as notices.
 *
 * Task 20.1: submitting a Challenge_Entry shares the agent's response on the
 * public leaderboard, so the Sharing_Consent prompt is wired through `useSocial`
 * and the applicable consent is required before an entry is submitted; without
 * it no entry is submitted and nothing is shared (Req 7.8, 7.9).
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
  SocialTextarea,
  StatusNotice,
} from "./ui";

type Notice = { tone: "warning" | "danger" | "neutral"; title: string; body?: string };

const SUBMIT_FAIL_MESSAGES: Record<string, string> = {
  not_authenticated: "Sign in to enter a challenge.",
  no_challenge: "This challenge no longer exists.",
  no_agent: "That agent no longer exists.",
  access_denied: "That agent can't be reached.",
  unavailable: "That agent isn't available.",
  invalid: "That entry is invalid.",
  consent_required: "A real-person agent needs verified voice-clone consent.",
  call_minutes_exhausted: "This account is out of call minutes.",
  not_owner: "You can only enter an agent you own.",
  not_published: "That agent isn't published.",
  submission_closed: "This challenge is closed for submissions.",
  already_entered: "That agent has already entered this challenge.",
  withheld_policy: "The response was withheld for a content-policy violation.",
  withheld_screening_error: "Screening could not complete. The entry was withheld.",
};

export function DailyChallengesScreen() {
  const { hasConsent, setConsent } = useSocial();
  const [challengeId, setChallengeId] = useState("");
  const trimmedId = challengeId.trim();

  const leaderboard = useQuery(
    api.campus.social.challenges.getChallengeLeaderboard,
    trimmedId.length > 0 ? { challengeId: trimmedId } : "skip",
  );

  const submitEntry = useAction(api.campus.social.challenges.submitEntry);
  const castChallengeVote = useMutation(api.campus.social.challenges.castChallengeVote);

  const [agentId, setAgentId] = useState("");
  const [responseText, setResponseText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A Challenge_Entry shares the agent's response to the public leaderboard,
    // so Sharing_Consent is required before the entry is submitted (Req 7.8).
    // Without it, no entry is submitted and nothing is shared (Req 7.9).
    if (!hasConsent("sharing")) {
      setNotice({ tone: "warning", title: "Sharing consent required", body: "Consent to sharing this entry before submitting it to the challenge." });
      return;
    }
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await submitEntry({
        challengeId: trimmedId,
        agentId: agentId.trim(),
        responseText: responseText.trim(),
      });
      if (res.accepted) {
        setNotice({ tone: "neutral", title: "Entry submitted", body: "Your agent's response is in the running." });
        setResponseText("");
      } else {
        setNotice({ tone: "warning", title: "Entry not accepted", body: SUBMIT_FAIL_MESSAGES[res.reason] ?? res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(entryId: string) {
    setNotice(null);
    try {
      const res = await castChallengeVote({ challengeId: trimmedId, entryId });
      if (!res.accepted) {
        setNotice({ tone: "warning", title: "Vote not counted", body: res.reason === "voting_closed" ? "Voting has closed." : res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    }
  }

  const found = leaderboard && leaderboard.found;
  const entries = found ? leaderboard.entries : [];
  const prompt = found ? leaderboard.prompt : undefined;

  return (
    <div className="space-y-6">
      {notice ? <StatusNotice tone={notice.tone} title={notice.title} body={notice.body} testId="challenge-notice" /> : null}

      {!hasConsent("sharing") ? (
        <ConsentPrompt
          kind="sharing"
          title="Sharing consent"
          body="Submitting an entry shares your agent's response on the public challenge leaderboard. Consent to sharing before you submit."
          onGrant={() => setConsent("sharing", true)}
          onDecline={() => setConsent("sharing", false)}
        />
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-white">Today&apos;s challenge</h2>
        {prompt ? (
          <p className="mt-1 text-sm text-white/80">{prompt}</p>
        ) : (
          <p className="mt-1 text-sm text-white/70">Enter a challenge ID to view its prompt and leaderboard.</p>
        )}
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <Field label="Challenge ID" htmlFor="challenge-id">
            <SocialInput id="challenge-id" value={challengeId} onChange={(e) => setChallengeId(e.target.value)} placeholder="challenge id" data-testid="challenge-id" />
          </Field>
          <Field label="Your agent" htmlFor="challenge-agent">
            <SocialInput id="challenge-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="Agent ID" data-testid="challenge-agent" />
          </Field>
          <Field label="Agent's response" htmlFor="challenge-response">
            <SocialTextarea id="challenge-response" value={responseText} onChange={(e) => setResponseText(e.target.value)} placeholder="What your agent says to the prompt…" data-testid="challenge-response" />
          </Field>
          <SocialButton type="submit" disabled={submitting || trimmedId.length === 0 || agentId.trim() === "" || responseText.trim() === "" || !hasConsent("sharing")} data-testid="challenge-submit" title={hasConsent("sharing") ? undefined : "Grant sharing consent first"}>
            {submitting ? "Submitting…" : "Submit entry"}
          </SocialButton>
        </form>
      </Card>

      <section aria-labelledby="challenge-leaderboard-heading">
        <h2 id="challenge-leaderboard-heading" className="text-lg font-semibold text-white">
          Leaderboard
        </h2>
        <div className="mt-4">
          {trimmedId.length === 0 ? (
            <EmptyState testId="challenge-prompt" title="Pick a challenge" body="Enter a challenge ID above to see its leaderboard." />
          ) : leaderboard === undefined ? (
            <LoadingRow label="Loading the leaderboard…" />
          ) : !found || entries.length === 0 ? (
            <EmptyState testId="challenge-empty" title="No entries yet" body="No entries have been submitted for this challenge yet." />
          ) : (
            <ol className="space-y-3" data-testid="challenge-leaderboard">
              {entries.map((entry, index) => (
                <li key={entry.entryId}>
                  <Card className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-bold tabular-nums text-white/80" aria-label={`Rank ${index + 1}`}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-white">{entry.agentId}</span>
                      <Chip tone="accent">{entry.votes} {entry.votes === 1 ? "vote" : "votes"}</Chip>
                    </span>
                    <SocialButton size="sm" variant="outline" onClick={() => handleVote(entry.entryId)} data-testid="challenge-vote">
                      Vote
                    </SocialButton>
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

export default DailyChallengesScreen;
