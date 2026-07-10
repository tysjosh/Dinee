// Feature: campus-social-loops, Task 19.2 — example layout tests across 320–1280 px.
//
// Validates: Requirements 8.7
//
// Req 8.7: WHEN the Social_Loops_Layer renders any page at a viewport width in
// the range 320 to 1280 CSS pixels, THE Campus_Platform SHALL display all
// content without horizontal scrolling.
//
// The six social screens are built on the shared `SocialShell`, whose root
// applies the viewport-independent `NO_X_SCROLL_CONTAINER` contract
// (`w-full overflow-x-hidden`) and constrains the inner column with a fluid
// `mx-auto w-full max-w-*`. Because those utilities are width-independent, a
// surface that (a) clips horizontal overflow at its root and (b) contains no
// fixed pixel width wider than the 320 px floor cannot produce a horizontal
// scrollbar or clipping anywhere in the 320–1280 px range. This test renders
// every screen and asserts exactly those two structural guarantees.

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
  extractAllClassNames,
  classTokens,
} from "./_socialSurfaceHarness";

/** The mobile floor of the required responsive range (Req 8.7–8.10). */
const MIN_VIEWPORT_PX = 320;

let surfaces: ReturnType<typeof renderAllSurfaces>;

beforeEach(() => {
  surfaces = renderAllSurfaces();
});

describe("Social surface layout — no horizontal scrolling 320–1280 px (Req 8.7)", () => {
  it("renders all six screens plus the hub", () => {
    expect(surfaces.map((s) => s.name).sort()).toEqual(
      ["battles", "challenges", "clips", "groups", "hub", "quests", "streaks"].sort(),
    );
    for (const surface of surfaces) {
      expect(surface.html.length, `${surface.name} produced markup`).toBeGreaterThan(0);
    }
  });

  it("every surface clips horizontal overflow and uses a fluid full-width root", () => {
    for (const surface of surfaces) {
      // The shell root is the first element with the NO_X_SCROLL_CONTAINER contract.
      expect(surface.html, `${surface.name}: overflow-x-hidden`).toContain("overflow-x-hidden");
      expect(surface.html, `${surface.name}: w-full root`).toContain("w-full");
      // Fluid inner column: centered, full width, capped only by a max-width.
      expect(surface.html, `${surface.name}: fluid centered column`).toContain("mx-auto");
    }
  });

  it("no surface uses a fixed width wider than the 320 px viewport floor", () => {
    // A fixed `w-[Npx]` / `min-w-[Npx]` wider than the floor is the only way a
    // fluid, overflow-clipped column could still force horizontal scrolling.
    // `max-w-[...]` is a cap (shrinks below the viewport) and is intentionally
    // not flagged.
    const widthTokenRe = /^(?:min-)?w-\[(\d+)px\]$/;
    for (const surface of surfaces) {
      for (const cls of extractAllClassNames(surface.html)) {
        for (const token of classTokens(cls)) {
          const match = widthTokenRe.exec(token);
          if (match) {
            const px = Number(match[1]);
            expect(
              px,
              `${surface.name}: fixed width token "${token}" must fit the ${MIN_VIEWPORT_PX}px floor`,
            ).toBeLessThanOrEqual(MIN_VIEWPORT_PX);
          }
        }
      }
    }
  });

  it("does not force a minimum width on the viewport (no min-w-screen / oversized min-w)", () => {
    for (const surface of surfaces) {
      expect(surface.html, `${surface.name}: no min-w-screen`).not.toContain("min-w-screen");
      expect(surface.html, `${surface.name}: no w-screen forcing overflow`).not.toContain("w-screen");
    }
  });
});
