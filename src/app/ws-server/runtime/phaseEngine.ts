/**
 * Generic pack-driven phase engine.
 *
 * A single, product-agnostic state machine driven by a pack's
 * {@link CallPhaseDefinition}[] and the transition events those phases declare.
 * This is the generic replacement that the two legacy call-phase modules
 * (`src/app/ws-server/call-phase.ts` and
 * `src/app/ws-server/logistics-call-phase.ts`) fold into during extraction.
 *
 * Requirements: 3.6
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/**
 * Computes the next phase for a session given the current phase and an event.
 *
 * Looks up the phase whose `id` equals `current`, then returns the `to` phase
 * of its first transition whose `event` matches. When the current phase is not
 * defined, or no transition in the current phase matches the event, the current
 * phase is returned unchanged.
 *
 * The function is pure and deterministic: it never mutates `phases` and always
 * returns a phase id (either the matched target or `current`).
 *
 * @param phases  The resolved pack's call-phase definitions.
 * @param current The active phase id.
 * @param event   The transition event to apply.
 * @returns The target phase id for a matching transition, or `current` otherwise.
 */
export function nextPhase(
  phases: CallPhaseDefinition[],
  current: string,
  event: string
): string {
  const activePhase = phases.find((phase) => phase.id === current);
  if (!activePhase) {
    return current;
  }

  const transition = activePhase.transitions.find(
    (candidate) => candidate.event === event
  );

  return transition ? transition.to : current;
}
