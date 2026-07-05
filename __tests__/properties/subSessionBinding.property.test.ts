/**
 * Feature: multi-platform-voice-integrations, Property 15: Sub-session binding is data-driven
 *
 * Validates: Requirements 7.8
 *
 * For a resolved conversation type, the set of sub-sessions bound equals exactly
 * those declared by the PlatformDefinition whose `conversationTypes` include that
 * conversation type. The selection is driven by data (the subSessions array),
 * never by a hardcoded conversation-type literal. A conversation type not covered
 * by any binding binds no sub-session.
 *
 * The pure selection predicate `selectSubSessionBindings(subSessions, conversationType)`
 * is exactly the logic the ws-server's per-call binding loop iterates, extracted
 * for isolated testing.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { selectSubSessionBindings } from "../../src/lib/integrations/platform/subSessions";
import type { SubSessionBinding } from "../../src/lib/integrations/platform/types";
import { runsheetPlatformDefinition } from "../../src/lib/integrations/runsheet/platform";

const NUM_RUNS = 100;

/** A small pool of conversation-type tokens so collisions are likely. */
const conversationTypeArb = fc.constantFrom(
  "runsheet_driver_exception",
  "restaurant_inbound_order",
  "logistics_status",
  "callback",
  "support",
  "ct_a",
  "ct_b",
  "ct_c",
);

/** An arbitrary SubSessionBinding with a set of conversation types + binderKey. */
const subSessionBindingArb: fc.Arbitrary<SubSessionBinding> = fc.record({
  conversationTypes: fc.array(conversationTypeArb, { maxLength: 5 }),
  binderKey: fc.string({ minLength: 1, maxLength: 12 }),
});

const subSessionsArb = fc.array(subSessionBindingArb, { maxLength: 8 });

describe("Property 15: Sub-session binding is data-driven", () => {
  it("selects exactly the bindings whose conversationTypes include the resolved type", () => {
    fc.assert(
      fc.property(subSessionsArb, conversationTypeArb, (subSessions, conversationType) => {
        const selected = selectSubSessionBindings(subSessions, conversationType);

        // The expected set, computed independently and purely from the data.
        const expected = subSessions.filter((s) =>
          s.conversationTypes.includes(conversationType),
        );

        // Exactly those bindings (same members, same order) are selected.
        expect(selected).toEqual(expected);

        // Every selected binding genuinely declares the conversation type...
        for (const sub of selected) {
          expect(sub.conversationTypes).toContain(conversationType);
        }
        // ...and every non-selected binding genuinely does not.
        const notSelected = subSessions.filter((s) => !selected.includes(s));
        for (const sub of notSelected) {
          expect(sub.conversationTypes).not.toContain(conversationType);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("binds no sub-session for a conversation type covered by no binding", () => {
    fc.assert(
      fc.property(subSessionsArb, conversationTypeArb, (subSessions, conversationType) => {
        // Restrict to a scenario where the conversation type appears in no binding.
        fc.pre(
          subSessions.every((s) => !s.conversationTypes.includes(conversationType)),
        );

        const selected = selectSubSessionBindings(subSessions, conversationType);
        expect(selected).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is truly data-driven: the same conversation type binds or not purely by declared data", () => {
    // Injecting the conversation type into a binding's conversationTypes must
    // make that binding selectable; removing it must make it unselectable —
    // proving selection depends on data, not a hardcoded literal.
    fc.assert(
      fc.property(subSessionBindingArb, conversationTypeArb, (base, conversationType) => {
        const including: SubSessionBinding = {
          binderKey: base.binderKey,
          conversationTypes: [...base.conversationTypes, conversationType],
        };
        const excluding: SubSessionBinding = {
          binderKey: base.binderKey,
          conversationTypes: base.conversationTypes.filter(
            (t) => t !== conversationType,
          ),
        };

        expect(selectSubSessionBindings([including], conversationType)).toEqual([
          including,
        ]);
        expect(
          selectSubSessionBindings([excluding], conversationType),
        ).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("concrete case: runsheet definition binds driver-exception sub-session for runsheet_driver_exception only", () => {
    const subSessions = runsheetPlatformDefinition.subSessions ?? [];

    // Binds the driver-exception sub-session for the driver-exception type.
    const forDriverException = selectSubSessionBindings(
      subSessions,
      "runsheet_driver_exception",
    );
    expect(forDriverException).toHaveLength(1);
    expect(forDriverException[0]?.binderKey).toBe("runsheet_driver_exception");

    // Binds nothing for other runsheet conversation types.
    for (const otherType of [
      "runsheet_inbound_order",
      "runsheet_status",
      "restaurant_inbound_order",
      "callback",
    ]) {
      expect(selectSubSessionBindings(subSessions, otherType)).toHaveLength(0);
    }
  });
});
