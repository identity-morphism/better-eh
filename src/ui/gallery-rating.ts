import type { GalleryPost } from "../data/gallery-actions";
import { rateGallery } from "../data/gallery-actions";
import type { GalleryApiConfig, GalleryRating } from "../types";
import { buttonEl, el } from "./dom";
import { errorText } from "./error-text";
import { HALF_STEPS, halfClass, litHalves, starGlyphs } from "./stars";
import { countText } from "./text";
import { showToast } from "./toast";

/** Inputs for {@link ratingControl}. */
interface RatingControlOptions {
  config: GalleryApiConfig;
  rating: GalleryRating;
  post?: GalleryPost;
  signal: AbortSignal;
}

/** Milliseconds the confirmation stays up before the average returns. */
const CONFIRM_MS = 2200;

/** Milliseconds the failure message stays up before the average returns. */
const FAILURE_MS = 3000;

function averageLabel(rating: GalleryRating): string {
  return rating.average === null ? "Not yet rated" : `Average: ${rating.average.toFixed(2)}`;
}

/** The half-star index (1–10) as text: "0.5", "3", "4.5". */
function halfText(half: number): string {
  return (half / 2).toFixed(1).replace(/\.0$/u, "");
}

/**
 * Five-star control split into ten half targets, the granularity the site accepts. Hovering or
 * focusing a half previews the rating up to it; a click posts it.
 */
export function ratingControl(options: RatingControlOptions): HTMLElement {
  const { config, rating, post, signal } = options;
  const label = el("span", {
    class: "rating-label",
    role: "status",
    text: averageLabel(rating),
  });
  const count = el("span", {
    class: "rating-count",
    text: rating.votes === null ? "" : countText(rating.votes, "vote"),
  });
  const stars = el("div", {
    class: "rating-stars",
    role: "group",
    "aria-label": "Rate this gallery",
  });
  /** One half cell per point on the scale, painted as filled or empty. */
  const cells: HTMLElement[] = [];
  /** Buttons and the half-cell range each one owns; coarse pointers own two cells per button. */
  const targets: { button: HTMLButtonElement; last: number }[] = [];
  let pending = false;
  let resetTimer: number | undefined;
  let current = rating.user;

  /** What the stars rest on: the viewer's rating, else the gallery average (as the site shows). */
  const restingValue = (): number | null => current ?? rating.average;

  /** Fill the first `value * 2` halves; `publish` also exposes the value as pressed state. */
  const paint = (value: number | null, publish: boolean): void => {
    const filled = value === null ? 0 : litHalves(value);
    cells.forEach((cell, index) => {
      cell.classList.toggle("is-on", index < filled);
    });
    if (publish) {
      // A coarse target reads as pressed only when every half it owns is filled; a fine half is
      // its own target, so `last === index` reproduces the old per-half behavior.
      for (const target of targets) {
        target.button.setAttribute("aria-pressed", target.last < filled ? "true" : "false");
      }
    }
  };

  const setValue = (value: number | null): void => {
    current = value;
    paint(value, true);
  };

  const preview = (half: number): void => {
    if (!pending) {
      paint(half / 2, false);
    }
  };

  const unpreview = (): void => {
    if (!pending) {
      paint(restingValue(), false);
    }
  };

  const destroy = (): void => {
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
    }
  };

  const submit = async (starCount: number): Promise<void> => {
    if (pending) {
      return;
    }
    const previous = current;
    pending = true;
    // Disabling the targets would drop focus to <body> as soon as one is clicked. The `pending`
    // guard already rejects a second submission, so expose the wait instead.
    stars.setAttribute("aria-busy", "true");
    label.textContent = "Saving…";
    paint(starCount, false);
    try {
      const result = await rateGallery(config, starCount, { post });
      if (signal.aborted) {
        return;
      }
      label.textContent = "Thanks for rating!";
      if (result.votes !== null) {
        count.textContent = countText(result.votes, "vote");
      }
      setValue(result.user ?? starCount);
      destroy();
      resetTimer = window.setTimeout(() => {
        label.textContent = averageLabel({
          ...rating,
          average: result.average ?? rating.average,
          user: result.user ?? starCount,
        });
      }, CONFIRM_MS);
    } catch (error) {
      if (!signal.aborted) {
        // Put the rejected rating back: the server did not accept it. The message is temporary so
        // the average (or "Not yet rated") comes back instead of being replaced for good.
        current = previous;
        paint(restingValue(), current !== null);
        label.textContent = "Rating failed.";
        destroy();
        resetTimer = window.setTimeout(() => {
          label.textContent = averageLabel(rating);
        }, FAILURE_MS);
        showToast(errorText(error));
      }
    } finally {
      pending = false;
      stars.removeAttribute("aria-busy");
    }
  };

  // `any-pointer` keeps touch working on hybrid laptops, where the primary pointer is still a
  // mouse and `(pointer: coarse)` would leave the untappable half targets in place.
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;

  if (coarse) {
    // Ten 10px half targets cannot be hit on touch (WCAG 2.5.8). One 24px button per star still
    // paints halves -- the average and the user's own rating -- but a tap rates whole stars.
    for (let star = 1; star <= 5; star++) {
      const text = `Rate ${star} ${star === 1 ? "star" : "stars"}`;
      const button = buttonEl({
        class: "rating-star",
        title: text,
        "aria-label": text,
        "aria-pressed": "false",
        onfocusin: () => preview(star * 2),
        onclick: () => {
          void submit(star);
        },
      });
      const firstCell = (star - 1) * 2;
      for (let offset = 0; offset < 2; offset++) {
        const cell = el("span", { class: halfClass(firstCell + offset + 1) });
        cell.append(...starGlyphs());
        cells.push(cell);
        button.append(cell);
      }
      targets.push({ button, last: firstCell + 1 });
      stars.append(button);
    }
  } else {
    // Two adjacent targets share each star glyph, so a half can be chosen exactly.
    for (let half = 1; half <= HALF_STEPS; half++) {
      const value = half / 2;
      const text = `Rate ${halfText(half)} ${value === 1 ? "star" : "stars"}`;
      const button = buttonEl({
        class: halfClass(half),
        title: text,
        "aria-label": text,
        "aria-pressed": "false",
        onpointerenter: () => preview(half),
        onfocusin: () => preview(half),
        onclick: () => {
          void submit(half / 2);
        },
      });
      button.append(...starGlyphs());
      cells.push(button);
      targets.push({ button, last: half - 1 });
      stars.append(button);
    }
  }
  stars.addEventListener("pointerleave", unpreview);
  stars.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !stars.contains(next)) {
      unpreview();
    }
  });
  // The average is display-only; only the viewer's own rating reads as pressed.
  paint(restingValue(), current !== null);

  signal.addEventListener("abort", destroy, { once: true });

  return el(
    "div",
    { class: "rating-control" },
    stars,
    el("span", { class: "rating-meta" }, label, count),
  );
}
