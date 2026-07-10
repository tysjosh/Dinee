"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Campus Quests screen (`/campus/social/quests`). Lets a user accept a quest and
 * shows Quest_Progress — which Quest_Steps are complete and which remain
 * incomplete (Req 6.7) — and complete steps. The "agent unavailable" indication
 * surfaces when acceptance or a step references a non-published agent
 * (Req 6.8, 6.9).
 */

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Card,
  Chip,
  EmptyState,
  Field,
  LoadingRow,
  SocialButton,
  SocialInput,
  StatusNotice,
} from "./ui";

interface StepView {
  readonly stepId: string;
  readonly description?: string;
  readonly complete: boolean;
}

interface QuestProgress {
  readonly questId?: string;
  readonly title?: string;
  readonly steps?: StepView[];
  readonly complete?: boolean;
  readonly exists?: boolean;
}

export function CampusQuestsScreen() {
  const [questId, setQuestId] = useState("");
  const trimmedId = questId.trim();

  const progress = useQuery(
    api.campus.social.quests.getQuestProgress,
    trimmedId.length > 0 ? { questId: trimmedId } : "skip",
  ) as QuestProgress | undefined;

  const acceptQuest = useMutation(api.campus.social.quests.acceptQuest);
  const completeStep = useMutation(api.campus.social.quests.completeStep);

  const [notice, setNotice] = useState<{ tone: "warning" | "danger" | "neutral"; title: string; body?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAccept() {
    setNotice(null);
    setBusy(true);
    try {
      const res = (await acceptQuest({ questId: trimmedId })) as { ok?: boolean; reason?: string };
      if (res?.ok === false) {
        setNotice({ tone: "warning", title: "Can't accept quest", body: res.reason === "agent_unavailable" ? "The offering agent is unavailable." : "Can't accept this quest." });
      } else {
        setNotice({ tone: "neutral", title: "Quest accepted", body: "Complete the steps below." });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(stepId: string) {
    setNotice(null);
    try {
      const res = (await completeStep({ questId: trimmedId, stepId })) as { changed?: boolean; reason?: string };
      if (res?.changed === false && res.reason === "agent_unavailable") {
        setNotice({ tone: "warning", title: "Agent unavailable", body: "The agent referenced by this step is unavailable." });
      }
    } catch {
      setNotice({ tone: "warning", title: "Temporarily unavailable", body: "Please try again in a moment." });
    }
  }

  const steps = progress?.steps ?? [];

  return (
    <div className="space-y-6">
      {notice ? <StatusNotice tone={notice.tone} title={notice.title} body={notice.body} testId="quest-notice" /> : null}

      <Card>
        <h2 className="text-lg font-semibold text-white">Find a quest</h2>
        <div className="mt-4 space-y-3">
          <Field label="Quest ID" htmlFor="quest-id">
            <SocialInput id="quest-id" value={questId} onChange={(e) => setQuestId(e.target.value)} placeholder="quest id" data-testid="quest-id" />
          </Field>
          <SocialButton onClick={handleAccept} disabled={busy || trimmedId.length === 0} data-testid="quest-accept">
            Accept quest
          </SocialButton>
        </div>
      </Card>

      <section aria-labelledby="quest-progress-heading">
        <h2 id="quest-progress-heading" className="text-lg font-semibold text-white">
          {progress?.title ?? "Progress"}
        </h2>
        <div className="mt-4">
          {trimmedId.length === 0 ? (
            <EmptyState testId="quest-prompt" title="Pick a quest" body="Enter a quest ID above to see its steps." />
          ) : progress === undefined ? (
            <LoadingRow label="Loading quest…" />
          ) : steps.length === 0 ? (
            <EmptyState testId="quest-empty" title="No steps to show" body="Accept a quest to start tracking your progress." />
          ) : (
            <ol className="space-y-3" data-testid="quest-steps">
              {steps.map((step, index) => (
                <li key={step.stepId}>
                  <Card className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-bold tabular-nums text-white/80" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-white">{step.description ?? step.stepId}</span>
                      <Chip tone={step.complete ? "success" : "neutral"}>
                        {step.complete ? "Complete" : "Incomplete"}
                      </Chip>
                    </span>
                    {!step.complete ? (
                      <SocialButton size="sm" variant="outline" onClick={() => handleComplete(step.stepId)} data-testid="quest-complete-step">
                        Mark done
                      </SocialButton>
                    ) : null}
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

export default CampusQuestsScreen;
