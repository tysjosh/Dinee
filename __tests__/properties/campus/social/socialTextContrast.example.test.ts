// Feature: campus-social-loops, Task 19.4 — text-contrast tests.
//
// Validates: Requirements 8.9
//
// Req 8.9: WHEN the Social_Loops_Layer renders any page at a viewport width in
// the range 320 to 1280 CSS pixels, THE Campus_Platform SHALL present text with
// a contrast ratio of at least 4.5:1 against its background.
//
// The Campus surface is white-on-near-black (`bg-black text-white`). Text is
// expressed only through the approved white-opacity tokens in
// `APPROVED_TEXT_TOKENS`. Contrast is viewport-independent (a colour property),
// so proving the palette clears 4.5:1 against the near-black surface proves it
// across the whole 320–1280 px range. This test (a) computes the WCAG contrast
// ratio of every approved token composited over black and asserts ≥ 4.5:1, and
// (b) renders every screen and asserts no text uses a token dimmer than the
// approved floor.

import { describe, it, expect, vi } from "vitest";
import {
  APPROVED_TEXT_TOKENS,
  APPROVED_TEXT_MIN_OPACITY,
  MIN_CONTRAST_RATIO,
  compositeOver,
  contrastRatio,
  whiteTokenAlpha,
} from "@/components/campus/social/a11y";

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

import { renderAllSurfaces, extractTextWhiteTokens } from "./_socialSurfaceHarness";

/** The Campus surface background: pure black (`bg-black`). */
const BLACK = { r: 0, g: 0, b: 0 } as const;
const WHITE = { r: 255, g: 255, b: 255 } as const;

describe("Social surface text contrast — ≥ 4.5:1 320–1280 px (Req 8.9)", () => {
  it("every approved text token clears 4.5:1 against the near-black surface", () => {
    for (const token of APPROVED_TEXT_TOKENS) {
      const alpha = whiteTokenAlpha(token);
      expect(alpha, `${token} parses to a white alpha`).not.toBeNull();
      const rendered = compositeOver(WHITE, alpha as number, BLACK);
      const ratio = contrastRatio(rendered, BLACK);
      expect(ratio, `${token} contrast against black`).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    }
  });

  it("the approved-opacity floor itself clears 4.5:1", () => {
    const rendered = compositeOver(WHITE, APPROVED_TEXT_MIN_OPACITY, BLACK);
    expect(contrastRatio(rendered, BLACK)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("no rendered screen uses a text token dimmer than the approved floor", () => {
    const surfaces = renderAllSurfaces();
    for (const surface of surfaces) {
      const tokens = extractTextWhiteTokens(surface.html);
      for (const token of tokens) {
        const alpha = whiteTokenAlpha(token);
        expect(alpha, `${surface.name}: "${token}" is a white text token`).not.toBeNull();
        expect(
          alpha as number,
          `${surface.name}: "${token}" must be at least the approved opacity floor`,
        ).toBeGreaterThanOrEqual(APPROVED_TEXT_MIN_OPACITY);
        // And every such token is one the palette explicitly vetted.
        expect(
          APPROVED_TEXT_TOKENS as readonly string[],
          `${surface.name}: "${token}" is in the approved palette`,
        ).toContain(token);
      }
    }
  });

  it("contrast ratio is order-independent and bounded", () => {
    const grey = compositeOver(WHITE, 0.6, BLACK);
    expect(contrastRatio(grey, BLACK)).toBeCloseTo(contrastRatio(BLACK, grey), 10);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 0);
  });
});
