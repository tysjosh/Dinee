"use client";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * `SocialProvider` / `useSocial` — the shared client context for the Campus
 * Social Loops surface (`src/app/campus/social/**`). It is a thin, domain-scoped
 * provider (matching the `CampusAgentContext` convention) that gives every
 * social screen:
 *
 *   - the current user identity + declared `ageBand` (from the additive
 *     `users.ageBand` field), resolved via {@link useCurrentUser};
 *   - the Recording_Consent / Sharing_Consent state and setters used to gate
 *     recording, Share_Clip generation, and sharing (Req 7.8, 7.9);
 *   - the companion overattachment notices (AI-identity reminder + take-a-break)
 *     computed from the reused pure {@link evaluateCompanionInteraction} core so
 *     the client presents exactly what the server enforces (Req 7.4, 7.5).
 *
 * All risky timing/decision logic is delegated to the shared pure module; this
 * context only holds presentation state.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  INITIAL_COMPANION_STATE,
  evaluateCompanionInteraction,
  type AgeBand,
  type CompanionState,
} from "../../../../convex/campus/social/logic/companion";
import type { AgentType } from "../../../../convex/campus/logic/validation";

/** The kinds of consent the social surface prompts for (Req 7.8, 7.9). */
export type ConsentKind = "recording" | "sharing";

/** A transient companion notice the surface must present (Req 7.4, 7.5). */
export interface CompanionNotice {
  identityReminder: boolean;
  breakNotice: boolean;
}

export interface SocialContextValue {
  /** Stable account key for owner-scoped queries, or null when signed out. */
  readonly userId: string | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  /** Declared age band; rows without the field are treated as "unknown". */
  readonly ageBand: AgeBand;

  /** Whether a given consent has been granted this session. */
  hasConsent(kind: ConsentKind): boolean;
  /** Grant/revoke a consent (used by the recording/sharing prompts). */
  setConsent(kind: ConsentKind, granted: boolean): void;

  /**
   * Register an interaction with a companion-style agent and return whether an
   * AI-identity reminder and/or a take-a-break notice must be shown now.
   * Backed by the reused {@link evaluateCompanionInteraction} core.
   */
  registerCompanionInteraction(
    agentId: string,
    agentType: AgentType,
    now?: number,
  ): CompanionNotice;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useCurrentUser();

  const userId = useMemo(() => {
    if (!user) return null;
    const u = user as unknown as {
      userId?: string;
      _id?: string;
      tenantId?: string;
    };
    return u.userId ?? u._id ?? u.tenantId ?? null;
  }, [user]);

  const ageBand = useMemo<AgeBand>(() => {
    const band = (user as unknown as { ageBand?: AgeBand } | null)?.ageBand;
    return band === "minor" || band === "adult" ? band : "unknown";
  }, [user]);

  const [consent, setConsentState] = useState<Record<ConsentKind, boolean>>({
    recording: false,
    sharing: false,
  });

  const hasConsent = useCallback(
    (kind: ConsentKind) => consent[kind],
    [consent],
  );

  const setConsent = useCallback((kind: ConsentKind, granted: boolean) => {
    setConsentState((prev) => ({ ...prev, [kind]: granted }));
  }, []);

  // Per-(agent) companion interaction state, kept in a ref so registering an
  // interaction does not trigger a render on its own.
  const companionStates = useRef<Map<string, CompanionState>>(new Map());

  const registerCompanionInteraction = useCallback(
    (agentId: string, agentType: AgentType, now: number = Date.now()) => {
      const prev =
        companionStates.current.get(agentId) ?? INITIAL_COMPANION_STATE;
      const decision = evaluateCompanionInteraction(prev, agentType, now);
      companionStates.current.set(agentId, decision.next);
      return {
        identityReminder: decision.showIdentityReminder,
        breakNotice: decision.showBreakNotice,
      };
    },
    [],
  );

  const value = useMemo<SocialContextValue>(
    () => ({
      userId,
      isAuthenticated,
      isLoading,
      ageBand,
      hasConsent,
      setConsent,
      registerCompanionInteraction,
    }),
    [
      userId,
      isAuthenticated,
      isLoading,
      ageBand,
      hasConsent,
      setConsent,
      registerCompanionInteraction,
    ],
  );

  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  );
}

/** Access the Social Loops context. Must be used within a {@link SocialProvider}. */
export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) {
    throw new Error("useSocial must be used within a SocialProvider");
  }
  return ctx;
}
