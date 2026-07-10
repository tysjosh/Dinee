"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Group Chat Mode screen (`/campus/social/groups`). A Student_Creator starts a
 * session for an owned, published agent and shares its access-token link; a
 * Participant joins via the token and submits 1–500 char questions that receive
 * an asynchronous, grounded Group_Response. The access-denied state (missing /
 * invalid / revoked / mismatched token, disclosing no session content — Req 4.7),
 * the "session full" cap (Req 4.12), the "blocked" indication for policy-flagged
 * questions (Req 4.6), and the "closed" indication (Req 4.8) all surface here.
 *
 * Task 20.1: because starting a session shares the agent's interactions into a
 * Group_Chat_Session, the Sharing_Consent prompt is wired through `useSocial`
 * and the applicable consent is required before a session is created; without
 * it no session is created and nothing is shared (Req 7.8, 7.9).
 */

import React, { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSocial } from "./SocialContext";
import {
  Card,
  ConsentPrompt,
  Field,
  SocialButton,
  SocialInput,
  SocialTextarea,
  StatusNotice,
} from "./ui";

const GROUP_QUESTION_MAX = 500;

export function GroupChatScreen() {
  const { hasConsent, setConsent } = useSocial();
  const startSession = useAction(api.campus.social.groupchat.startSession);
  const joinSession = useMutation(api.campus.social.groupchat.joinSession);
  const submitQuestion = useAction(api.campus.social.groupchat.submitQuestion);
  const closeSession = useMutation(api.campus.social.groupchat.closeSession);

  const [agentId, setAgentId] = useState("");
  const [token, setToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState<{ tone: "warning" | "danger" | "neutral"; title: string; body?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const questionInvalid = question.length > GROUP_QUESTION_MAX;

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    // Starting a session shares the agent's interactions into a Group_Chat_Session,
    // so Sharing_Consent is required before the session is created (Req 7.8). When
    // it is absent, no session is created and nothing is shared (Req 7.9).
    if (!hasConsent("sharing")) {
      setNotice({ tone: "warning", title: "Sharing consent required", body: "Consent to sharing this agent into a group before starting a session." });
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      const res = await startSession({ agentId: agentId.trim() });
      if (res.started) {
        setToken(res.token);
        setSessionId(res.sessionId);
        setNotice({ tone: "neutral", title: "Session started", body: "Share the token below so friends can join." });
      } else {
        const map: Record<string, string> = {
          not_authenticated: "Sign in to start a session.",
          no_agent: "That agent no longer exists.",
          not_owner: "You can only start a session for an agent you own.",
          not_published: "That agent isn't published.",
        };
        setNotice({ tone: "warning", title: "Could not start session", body: map[res.reason] ?? res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setNotice(null);
    setBusy(true);
    try {
      const res = await joinSession({ token: token.trim() });
      if (res.admitted) {
        setSessionId(res.sessionId);
        setNotice({ tone: "neutral", title: "Joined", body: "You can ask the agent a question." });
      } else {
        const map: Record<string, string> = {
          access_denied: "This link is invalid or has been revoked.",
          session_closed: "This session is closed.",
          session_full: "This session is full.",
        };
        setNotice({ tone: "warning", title: "Access denied", body: map[res.reason] ?? res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Access denied", body: "This link is invalid or has been revoked." });
    } finally {
      setBusy(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (questionInvalid || question.trim().length === 0) return;
    setNotice(null);
    setBusy(true);
    try {
      const res = await submitQuestion({ token: token.trim(), body: question.trim() });
      if (res.posted) {
        setNotice({ tone: "neutral", title: "Question sent", body: "The agent will reply asynchronously." });
        setQuestion("");
      } else {
        const map: Record<string, string> = {
          blocked: "That question was withheld for a content-policy violation.",
          invalid: "Questions must be 1–500 characters.",
          session_closed: "This session is closed.",
          not_member: "Join the session before asking.",
          access_denied: "Access denied.",
          unavailable: "This agent isn't available.",
          consent_required: "This agent needs verified voice-clone consent.",
          call_minutes_exhausted: "This account is out of call minutes.",
          no_session: "This session no longer exists.",
          no_agent: "That agent no longer exists.",
        };
        setNotice({ tone: res.reason === "blocked" ? "danger" : "warning", title: res.reason === "blocked" ? "Message blocked" : "Not sent", body: map[res.reason] ?? res.message });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setNotice(null);
    try {
      await closeSession({ sessionId: sessionId.trim() });
      setNotice({ tone: "neutral", title: "Session closed", body: "No new questions will be accepted." });
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    }
  }

  return (
    <div className="space-y-6">
      {notice ? <StatusNotice tone={notice.tone} title={notice.title} body={notice.body} testId="group-notice" /> : null}

      {!hasConsent("sharing") ? (
        <ConsentPrompt
          kind="sharing"
          title="Sharing consent"
          body="Starting a group session shares your agent's responses into that group. Consent to sharing before you start."
          onGrant={() => setConsent("sharing", true)}
          onDecline={() => setConsent("sharing", false)}
        />
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-white">Start a group session</h2>
        <p className="mt-1 text-sm text-white/70">Drop your published agent into a group chat via a share link.</p>
        <form className="mt-4 space-y-3" onSubmit={handleStart}>
          <Field label="Your agent" htmlFor="group-agent">
            <SocialInput id="group-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="Agent ID" data-testid="group-agent" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SocialButton type="submit" disabled={busy || agentId.trim().length === 0 || !hasConsent("sharing")} data-testid="group-start" title={hasConsent("sharing") ? undefined : "Grant sharing consent first"}>
              Start session
            </SocialButton>
            {sessionId ? (
              <SocialButton type="button" variant="destructive" onClick={handleClose} data-testid="group-close">
                Close session
              </SocialButton>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white">Join &amp; ask</h2>
        <div className="mt-4 space-y-3">
          <Field label="Session token" htmlFor="group-token">
            <SocialInput id="group-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="access token" data-testid="group-token" />
          </Field>
          <SocialButton variant="outline" onClick={handleJoin} disabled={busy || token.trim().length === 0} data-testid="group-join">
            Join session
          </SocialButton>

          <form className="space-y-2" onSubmit={handleAsk}>
            <Field label="Your question" htmlFor="group-question" hint={`${question.length}/${GROUP_QUESTION_MAX}`}>
              <SocialTextarea
                id="group-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask the agent something…"
                invalid={questionInvalid}
                maxLength={GROUP_QUESTION_MAX + 50}
                data-testid="group-question"
              />
            </Field>
            {questionInvalid ? (
              <p className="text-xs text-white/70" role="alert">Questions must be 1–500 characters.</p>
            ) : null}
            <SocialButton type="submit" disabled={busy || question.trim().length === 0 || questionInvalid} data-testid="group-ask">
              Send question
            </SocialButton>
          </form>
        </div>
      </Card>
    </div>
  );
}

export default GroupChatScreen;
