/**
 * Reader layout modes and the input intents they imply.
 *
 * The viewer owns the DOM; this module owns the decisions that are easy to get wrong: which
 * edge/gesture means "next" and which containers a mode uses. The body classes live in view-mode.
 * Keeping the decisions pure makes every transition table-testable without a mounted reader.
 */

import type { ReaderMode, ReadingDirection } from "./types";

export type PageIntent = "prev" | "next" | "toggle";

/**
 * Where a click at `ratio` of the viewport width goes. The middle third always pins the HUD, and
 * RTL mirrors the edges because "next" reads leftward.
 */
export function clickIntent(
  ratio: number,
  mode: ReaderMode,
  direction: ReadingDirection,
): PageIntent {
  if (ratio >= 0.3 && ratio <= 0.7) {
    return "toggle";
  }
  if (mode === "continuous") {
    // The stack scrolls; its edge zones still step one page at a time.
    return ratio < 0.5 ? "prev" : "next";
  }
  const forward = ratio > 0.7;
  const next = direction === "ltr" ? forward : !forward;
  return next ? "next" : "prev";
}

/** A horizontal swipe: `dx` is end minus start, in CSS pixels. */
export function swipeIntent(
  dx: number,
  minDistance: number,
  mode: ReaderMode,
  direction: ReadingDirection,
): "prev" | "next" | null {
  if (Math.abs(dx) < minDistance) {
    return null;
  }
  if (mode === "continuous") {
    // Vertical scrolling is native; a deliberate horizontal gesture still steps.
    return dx < 0 ? "next" : "prev";
  }
  const forward = dx < 0;
  return (direction === "ltr" ? forward : !forward) ? "next" : "prev";
}
