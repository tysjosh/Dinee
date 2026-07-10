/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Shared accessibility class contract for the Campus Social Loops surface
 * (`src/app/campus/social/**`). These constants encode the WCAG-AA obligations
 * from Requirements 8.7–8.10 as Tailwind v4 utility strings so that the exact
 * rules the accessibility tests (Tasks 19.2–19.5) exercise are the rules the
 * shared UI primitives ({@link ./ui}) apply at runtime — the same
 * "logic imported by both runtime and tests" discipline used across the rest of
 * Campus.
 *
 * The invariants are viewport-independent Tailwind utilities, so they hold
 * uniformly across the whole 320–1280 px range required by the spec:
 *
 *   - {@link TOUCH_TARGET} — a `min-h`/`min-w` floor of {@link TOUCH_TARGET_MIN_PX}
 *     CSS px on every interactive control (Req 8.8). `min-height`/`min-width`
 *     override the shorter `btn-sm`/`btn-md` heights, so even a small button is
 *     never below the floor at any width.
 *   - {@link FOCUS_RING} — a visible keyboard focus indicator via
 *     `focus-visible:` that does not rely on colour alone (Req 8.10).
 *   - {@link MOTION_SAFE_TRANSITION} — transitions gated behind `motion-reduce:`
 *     so reduced-motion users get no animation (Req 8.10).
 *   - {@link NO_X_SCROLL_CONTAINER} — the screen shell clips horizontal overflow
 *     and constrains width fluidly so there is never a horizontal scrollbar or
 *     clipping from 320 px up (Req 8.7).
 *   - {@link APPROVED_TEXT_TOKENS} — the white-on-dark text tokens whose contrast
 *     against the near-black Campus surface is ≥ 4.5:1 (Req 8.9).
 */

/** WCAG-AA minimum touch-target size in CSS pixels (Req 8.8). */
export const TOUCH_TARGET_MIN_PX = 44;

/** WCAG-AA minimum text contrast ratio (Req 8.9). */
export const MIN_CONTRAST_RATIO = 4.5;

/**
 * The touch-target floor applied to every interactive control. `min-h`/`min-w`
 * guarantee the {@link TOUCH_TARGET_MIN_PX} floor regardless of the design
 * system's smaller `btn-sm`/`btn-md` heights, at every viewport width.
 */
export const TOUCH_TARGET = "min-h-[44px] min-w-[44px]";

/**
 * A visible keyboard focus indicator for controls that are NOT the design
 * system `btn` (which already ships a `:focus-visible` ring in `globals.css`).
 * Uses `focus-visible:` so mouse clicks don't show the ring but keyboard focus
 * always does, offset against the dark surface for a clearly visible outline.
 */
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-black";

/** A colour transition that is disabled under `prefers-reduced-motion` (Req 8.10). */
export const MOTION_SAFE_TRANSITION =
  "transition-colors motion-reduce:transition-none";

/**
 * The screen shell contract: clip horizontal overflow and constrain width so
 * content never forces a horizontal scrollbar between 320 px and 1280 px
 * (Req 8.7). `w-full` + `max-w-*` + `overflow-x-hidden` is the same pattern the
 * existing `DiscoveryFeed` shell uses.
 */
export const NO_X_SCROLL_CONTAINER = "w-full overflow-x-hidden";

/**
 * White-on-dark text opacity tokens approved for meaningful text on the Campus
 * surface. Every entry is verified by the contrast test (Task 19.4) to clear
 * {@link MIN_CONTRAST_RATIO} against a near-black background; anything dimmer
 * (≤ `text-white/50`) is intentionally excluded from body text.
 */
export const APPROVED_TEXT_TOKENS = [
  "text-white",
  "text-white/90",
  "text-white/80",
  "text-white/70",
  "text-white/60",
] as const;

/** The opacity floor (as a fraction) for a white text token to be approved. */
export const APPROVED_TEXT_MIN_OPACITY = 0.6;

// ---------------------------------------------------------------------------
// Contrast helpers (pure) — used by the contrast test to prove the palette.
// ---------------------------------------------------------------------------

/** sRGB channel (0–255) → linearized channel per WCAG relative-luminance. */
function linearizeChannel(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(rgb: {
  r: number;
  g: number;
  b: number;
}): number {
  return (
    0.2126 * linearizeChannel(rgb.r) +
    0.7152 * linearizeChannel(rgb.g) +
    0.0722 * linearizeChannel(rgb.b)
  );
}

/** WCAG contrast ratio between two sRGB colours (order-independent). */
export function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alpha-composite a foreground colour over an opaque background (0–1 alpha).
 * Text tokens like `text-white/70` render white at reduced alpha over the
 * surface behind them, so contrast must be measured on the composited colour.
 */
export function compositeOver(
  fg: { r: number; g: number; b: number },
  alpha: number,
  bg: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

/** Parse a `text-white` / `text-white/NN` token to its white alpha (0–1). */
export function whiteTokenAlpha(token: string): number | null {
  if (token === "text-white") return 1;
  const match = /^text-white\/(\d{1,3})$/.exec(token);
  if (!match) return null;
  return Number(match[1]) / 100;
}
