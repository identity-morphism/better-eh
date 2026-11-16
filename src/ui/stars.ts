import { el, icon } from "./dom";

/** Half-star targets in a five-star row; the site scores 1–10. */
export const HALF_STEPS = 10;

/** Number of half-star cells a five-point value lights, clamped to the row. */
export function litHalves(value: number): number {
  return Math.min(HALF_STEPS, Math.max(0, Math.round(value * 2)));
}

/** Class for one half target; the left and right halves share a glyph. */
export function halfClass(half: number): string {
  return `rating-half ${half % 2 === 1 ? "rating-half-left" : "rating-half-right"}`;
}

/** Filled and outline glyph pair shared by the rating control and read-only star rows. */
export function starGlyphs(): [SVGSVGElement, SVGSVGElement] {
  const outline = icon("star", false);
  outline.classList.add("rating-half-off");
  const filled = icon("star", true);
  filled.classList.add("rating-half-on");
  return [outline, filled];
}

/**
 * A read-only star row built from the rating control's half targets, so a 4.5 score lights four
 * stars and the left half of the fifth. Null when the item carries no rating.
 */
export function starRow(value: number | null): HTMLElement | null {
  if (value === null) {
    return null;
  }
  const lit = litHalves(value);
  const label = value.toFixed(1).replace(/\.0$/u, "");
  const row = el("span", {
    class: "rating-stars is-static",
    role: "img",
    "aria-label": `${label} out of 5 stars`,
  });

  for (let half = 1; half <= HALF_STEPS; half++) {
    const cell = el("span", {
      class: `${halfClass(half)}${half <= lit ? " is-on" : ""}`,
    });
    cell.append(...starGlyphs());
    row.append(cell);
  }
  return row;
}
