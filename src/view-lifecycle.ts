import type { Route } from "./router";

/** Side effects the mount lifecycle performs; injected so tests can observe every step. */
export interface ViewLifecycleDeps {
  /** The element views render into; null before the shell exists. */
  host: () => HTMLElement | null;
  /** Close transient panels owned by the previous view. */
  closePanels: () => void;
  resetViewMode: () => void;
  /** Track the sticky chrome in `root`; returns the disposer for the previous mount. */
  trackSticky: (root: HTMLElement) => () => void;
  scrollTo: (y: number) => void;
  /** Defer a scroll until after layout; `requestAnimationFrame` in production. */
  scheduleScroll?: (fn: () => void) => void;
  /**
   * Restore a saved position while lazily appended content grows the document. Returns a disposer
   * that stops the retries when the next mount or a user scroll takes over.
   */
  restoreScroll?: (y: number) => () => void;
}

interface MountRequest {
  route: Route;
  title: string;
  /**
   * A number restores that scroll position after layout, null starts at the top, and omitting it
   * leaves the scroll position alone (error and login mounts do not move the page).
   */
  scrollY?: number | null;
  /** Move focus to the view host after a user-initiated navigation; the cold load stays unfocused. */
  focus?: boolean;
  render: (host: HTMLElement, signal: AbortSignal) => void;
}

export interface ViewLifecycle {
  /**
   * Tear down the previous mount, render the new one and return its abort signal. Returns null when
   * the host is gone; nothing is rendered or torn down in that case.
   */
  mount(request: MountRequest): AbortSignal | null;
  /** The route the mounted view renders, or null before the first mount. */
  currentRoute(): Route | null;
  /** Register the guard that runs before leaving this view; null clears it. */
  setLeaveGuard(guard: (() => boolean) | null): void;
  /** True when leaving the current view is allowed. */
  guard(): boolean;
}

/**
 * Own the mount/teardown sequence for the single view host.
 *
 * A mount aborts the previous view, forgets its leave guard and sticky tracker, resets view mode,
 * clears the host, renders, titles the document, starts sticky tracking and restores scroll only
 * when asked. Every path through the app renders through this one sequence.
 */
export function createViewLifecycle(deps: ViewLifecycleDeps): ViewLifecycle {
  let controller: AbortController | null = null;
  let stickyDispose: (() => void) | null = null;
  let restoreStop: (() => void) | null = null;
  let leaveGuard: (() => boolean) | null = null;
  let current: Route | null = null;
  const schedule =
    deps.scheduleScroll ??
    ((fn: () => void) => {
      requestAnimationFrame(fn);
    });

  return {
    mount(request) {
      restoreStop?.();
      restoreStop = null;

      const host = deps.host();
      if (host === null) {
        return null;
      }

      deps.closePanels();
      controller?.abort();
      controller = new AbortController();
      current = request.route;
      leaveGuard = null;

      deps.resetViewMode();
      stickyDispose?.();
      stickyDispose = null;
      host.replaceChildren();

      request.render(host, controller.signal);
      document.title = request.title;
      stickyDispose = deps.trackSticky(host);

      if (request.focus === true) {
        host.focus({ preventScroll: true });
      }

      if (typeof request.scrollY === "number") {
        const y = request.scrollY;
        if (y > 0 && deps.restoreScroll) {
          restoreStop = deps.restoreScroll(y);
        } else {
          schedule(() => {
            deps.scrollTo(y);
          });
        }
      } else if (request.scrollY === null) {
        deps.scrollTo(0);
      }

      return controller.signal;
    },

    currentRoute() {
      return current;
    },

    setLeaveGuard(guard) {
      leaveGuard = guard;
    },

    guard() {
      return leaveGuard === null || leaveGuard();
    },
  };
}
