// Feature: campus-social-loops, Task 19.3 — touch-target measurement tests.
//
// Validates: Requirements 8.8
//
// Req 8.8: WHEN the Social_Loops_Layer renders any page at a viewport width in
// the range 320 to 1280 CSS pixels, THE Campus_Platform SHALL present each
// interactive control with a minimum touch target size of 44 by 44 CSS pixels.
//
// Every interactive control on the six screens is built from the shared
// primitives, which apply the `TOUCH_TARGET` contract (`min-h-[44px]
// min-w-[44px]`). Because `min-height`/`min-width` are viewport-independent and
// override the design system's shorter `btn-sm`/`btn-md` heights, the 44×44
// floor holds uniformly across the whole 320–1280 px range. This test renders
// every screen, collects every rendered interactive control, and asserts each
// one carries the measured floor.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TOUCH_TARGET_MIN_PX } from "@/components/campus/social/a11y";

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
  classTokens,
} from "./_socialSurfaceHarness";

let surfaces: ReturnType<typeof renderAllSurfaces>;

beforeEach(() => {
  surfaces = renderAllSurfaces();
});

describe("Social surface touch targets — ≥ 44×44 CSS px 320–1280 px (Req 8.8)", () => {
  it("the measured floor is the WCAG-AA 44 px minimum", () => {
    expect(TOUCH_TARGET_MIN_PX).toBe(44);
  });

  it("every screen renders at least one interactive control (except a pure loading view)", () => {
    const withControls = surfaces.filter((s) => extractInteractive(s.html).length > 0);
    // The hub + battles/challenges/clips/groups/quests always render controls;
    // streaks may render a loading/sign-in view. So the vast majority have controls.
    expect(withControls.length).toBeGreaterThanOrEqual(6);
  });

  it("every interactive control on every screen presents a ≥ 44×44 px touch target", () => {
    const minH = `min-h-[${TOUCH_TARGET_MIN_PX}px]`;
    const minW = `min-w-[${TOUCH_TARGET_MIN_PX}px]`;
    for (const surface of surfaces) {
      for (const el of extractInteractive(surface.html)) {
        const tokens = classTokens(el.className);
        expect(
          tokens,
          `${surface.name}: <${el.tag}> must apply the ${TOUCH_TARGET_MIN_PX}px min-height`,
        ).toContain(minH);
        expect(
          tokens,
          `${surface.name}: <${el.tag}> must apply the ${TOUCH_TARGET_MIN_PX}px min-width`,
        ).toContain(minW);
      }
    }
  });
});
