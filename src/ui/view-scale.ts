import { getSettings, onSettingsChange } from "../settings";
import type { UserSettings } from "../types";
import type { FrameHandle } from "./frame";
import { cancelFrame, requestFrame } from "./frame";

/** A view's sizing callback and the lifetime that owns it. */
interface ViewScaleOptions {
  signal: AbortSignal;
  apply: (settings: Readonly<UserSettings>) => void;
}

/**
 * Keep a view's responsive CSS variables in sync with settings and viewport width.
 *
 * `apply` runs once on mount, then at most once per animation frame for a burst of settings changes
 * or resize events, always with the settings current at frame time. Aborting `signal` detaches the
 * settings subscription and the resize listener and cancels any frame that has not run yet.
 */
export function bindViewScale({ signal, apply }: ViewScaleOptions): void {
  apply(getSettings());

  let frame: FrameHandle = null;
  const schedule = (): void => {
    if (frame !== null) {
      return;
    }
    frame = requestFrame(() => {
      frame = null;
      apply(getSettings());
    });
  };

  const off = onSettingsChange(schedule);
  window.addEventListener("resize", schedule, { passive: true });

  const cleanup = (): void => {
    off();
    cancelFrame(frame);
    frame = null;
    window.removeEventListener("resize", schedule);
  };

  if (signal.aborted) {
    cleanup();
    return;
  }
  signal.addEventListener("abort", cleanup, { once: true });
}
