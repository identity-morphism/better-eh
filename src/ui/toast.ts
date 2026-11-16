import { el } from "./dom";
import { announceInto } from "./live-region";

const timers = new Map<HTMLElement, number>();

/** Long messages get more time on screen; 1.8s is only enough for two words. */
function durationFor(text: string): number {
  return Math.min(8000, Math.max(2000, text.length * 70));
}

/**
 * Show `text` in a live region, then clear it.
 *
 * The region is blanked for one frame before the new text lands: assistive tech ignores a text
 * change that leaves the node identical, and ignores nodes inserted already containing text.
 */
function present(node: HTMLElement, text: string, visibleClass: string): void {
  clearTimeout(timers.get(node));
  node.classList.remove(visibleClass);

  const reveal = (value: string): void => {
    node.textContent = value;
    if (value === "") {
      return;
    }
    node.classList.add(visibleClass);
    timers.set(
      node,
      window.setTimeout(() => {
        node.classList.remove(visibleClass);
        node.textContent = "";
      }, durationFor(value)),
    );
  };

  announceInto(node, text, reveal);
}

function ensureToast(): HTMLElement {
  const existing = document.getElementById("eh-toast");
  if (existing) {
    return existing;
  }
  const toast = el("div", {
    id: "eh-toast",
    class: "eh-toast",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  (document.getElementById("eh-root") ?? document.body).append(toast);
  return toast;
}

/** Show a short-lived status message. Uses the viewer HUD when present. */
export function showToast(text: string): void {
  const trimmed = text.trim();
  if (trimmed === "") {
    return;
  }

  const hudToast = document.getElementById("hud-toast");
  present(hudToast ?? ensureToast(), trimmed, "show");
}
