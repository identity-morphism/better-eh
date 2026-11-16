import { getSettings, onSettingsChange } from "../settings";
import type { UserSettings } from "../types";

/** A view's sizing callback and the lifetime that owns it. */
interface ViewScaleOptions {
  signal: AbortSignal;
  apply: (settings: Readonly<UserSettings>) => void;
}

/**
 * Keep a view's responsive CSS variables in sync with settings and viewport width.
 *
 * `apply` runs once on mount, again whenever settings change, and once per animation frame for a
 * burst of resize events. Aborting `signal` detaches the settings subscription and the resize
 * listener and cancels any frame that has not run yet.
 */
export function bindViewScale({ signal, apply }: ViewScaleOptions): void {
  apply(getSettings());
  const off = onSettingsChange(apply);

  let frame = 0;
  const onResize = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => apply(getSettings()));
  };
  window.addEventListener("resize", onResize);

  const cleanup = (): void => {
    off();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
  };

  if (signal.aborted) {
    cleanup();
    return;
  }
  signal.addEventListener("abort", cleanup, { once: true });
}
