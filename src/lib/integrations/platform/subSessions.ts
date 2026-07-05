// src/lib/integrations/platform/subSessions.ts
//
// Pure sub-session selection predicate for data-driven per-call binding.
//
// The ws-server binds extra per-call sub-sessions (e.g. the Runsheet
// driver-exception identity-verification session) based on the resolved
// conversation type. Rather than a hardcoded conversation-type literal, the
// selection is driven entirely by the `PlatformDefinition.subSessions` data:
// a binding is selected iff its declared `conversationTypes` include the
// resolved conversation type (Req 7.8).
//
// This helper is extracted as a pure function so the selection logic is
// testable in isolation from the ws-server socket handler.

import type { SubSessionBinding } from "./types";

/**
 * Selects the sub-session bindings that apply to a resolved conversation type.
 *
 * The result is exactly those bindings whose `conversationTypes` include the
 * given `conversationType`, preserving input order. A conversation type not
 * covered by any binding selects zero bindings (Req 7.8).
 */
export function selectSubSessionBindings(
  subSessions: readonly SubSessionBinding[],
  conversationType: string,
): SubSessionBinding[] {
  return subSessions.filter((sub) =>
    sub.conversationTypes.includes(conversationType),
  );
}
