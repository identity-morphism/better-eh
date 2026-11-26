interface NavigateOptions {
  replace?: boolean;
}

export interface ViewContext {
  signal: AbortSignal;
  navigate: (url: string, options?: NavigateOptions) => void;
  /** Re-run the current route, bypassing the document cache. */
  reload: () => void;
  /**
   * Drop the current route's cached parse. A view calls this after a mutation the cached page still
   * shows, so a later history move refetches instead of restoring the old state.
   */
  invalidate: () => void;
  /**
   * Register a guard that runs before this view is navigated away from. Returning `false` cancels
   * the navigation; pass `null` to clear it.
   */
  setLeaveGuard: (guard: (() => boolean) | null) => void;
}
