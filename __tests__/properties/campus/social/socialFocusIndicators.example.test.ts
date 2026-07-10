// Feature: campus-social-loops, Task 19.5 — keyboard focus-indicator tests.
//
// Validates: Requirements 8.10
//
// Req 8.10: WHEN the Social_Loops_Layer renders any page at a viewport width in
// the range 320 to 1280 CSS pixels, THE Campus_Platform SHALL display a visible
// focus indicator on each interactive control that receives keyboard focus.
//
// Every interactive control on the six screens is built from the shared
// primitives, which carry a visible keyboard focus indicator by one of three
// vetted mechanisms:
//   - the design-system `btn` utility (its `:focus-visible` ring, globals.css);
//   - the design-system `input` utility (its `:focus` ring, globals.css); or
//   - the explicit `FOCUS_RING` contract (`focus-visible:ring-2 …`) on non-btn
//     links (e.g. the selectable card links).
// This test renders every screen and asserts each interactive control carries
// at least one of those focus mechanisms, and that animated transitions are
// gated behind `motion-reduce:` so reduced-motion users still get the indicator
// without motion.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => async () => ({}),
  useAction: () => async () => ({}),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ children, href, className, ...rest }: Record<string, unknown>) =>
      createElement(
        "a",
        { href: typeof href === "string" ? href : "#", className, ...rest },
        children as never,
      ),
  };
});

import {
  renderAllSurfaces,
  extractInteractive,
  extractAllClassNames,
  classTokens,
} from "./_socialSurfaceHarness";

let surfaces: ReturnType<typeof renderAllSurfaces>;

beforeEach(() => {
  surfaces = renderAllSurfaces();
});

/** A control has a visible keyboard focus indicator via a vetted mechanism. */
function hasFocusIndicator(tokens: string[]): boolean {
  const hasBtn = tokens.includes("btn");
  const hasInput = tokens.includes("input");
  const hasFocusRing = tokens.some((t) => t.startsWith("focus-visible:ring"));
  return hasBtn || hasInput || hasFocusRing;
}

describe("Social surface focus indicators — visible on keyboard focus 320–1280 px (Req 8.10)", () => {
  it("every interactive control carries a visible focus indicator", () => {
    for (const surface of surfaces) {
      for (const el of extractInteractive(surface.html)) {
        const tokens = classTokens(el.className);
        expect(
          hasFocusIndicator(tokens),
          `${surface.name}: <${el.tag}> class="${el.className}" must expose a visible focus indicator (btn / input / focus-visible:ring)`,
        ).toBe(true);
      }
    }
  });

  it("every animated transition is gated behind motion-reduce (Req 8.10 reduced motion)", () => {
    for (const surface of surfaces) {
      for (const cls of extractAllClassNames(surface.html)) {
        const tokens = classTokens(cls);
        if (tokens.some((t) => t.startsWith("transition"))) {
          expect(
            tokens,
            `${surface.name}: class="${cls}" animates a transition and must honour motion-reduce`,
          ).toContain("motion-reduce:transition-none");
        }
        if (tokens.includes("animate-spin")) {
          expect(
            tokens,
            `${surface.name}: class="${cls}" spins and must honour motion-reduce`,
          ).toContain("motion-reduce:animate-none");
        }
      }
    }
  });
});
