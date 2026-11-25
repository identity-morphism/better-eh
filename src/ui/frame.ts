/**
 * One animation-frame seam for the UI.
 *
 * Browsers always have `requestAnimationFrame`; the linkedom test DOM does not. Without this
 * wrapper every coalescing module carried its own `typeof` fallback, with two different "pending"
 * sentinels. `null` here always means “already ran synchronously”.
 */

/** A scheduled frame, or null when the callback ran synchronously because rAF is missing. */
export type FrameHandle = number | null;

/** Run `callback` on the next frame, or synchronously when the environment has no rAF. */
export function requestFrame(callback: () => void): FrameHandle {
  if (typeof requestAnimationFrame !== "function") {
    callback();
    return null;
  }
  return requestAnimationFrame(callback);
}

/** Cancel a handle from {@link requestFrame}; a null handle is already settled. */
export function cancelFrame(handle: FrameHandle): void {
  if (handle !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
  }
}
