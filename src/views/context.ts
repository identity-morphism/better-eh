interface NavigateOptions {
  replace?: boolean;
}

export type { CursorPage, PageSource } from "../ui/page-cursor";

export interface ViewContext {
  signal: AbortSignal;
  navigate: (url: string, options?: NavigateOptions) => void;
  /** Re-run the current route, bypassing the document cache. */
  reload: () => void;
  /**
   * Register a guard that runs before this view is navigated away from. Returning `false` cancels
   * the navigation; pass `null` to clear it.
   */
  setLeaveGuard: (guard: (() => boolean) | null) => void;
}
