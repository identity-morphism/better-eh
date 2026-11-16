import { log, warn } from "./log";
import type { PageData } from "./types";
import { nativeZoomLimit } from "./zoom";

/** The part of an image element page-image drives; `HTMLImageElement` satisfies it. */
export interface PageImage {
  src: string;
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  clientHeight: number;
  getAttribute(name: string): string | null;
}

interface ShowPageImageOptions {
  img: PageImage;
  page: PageData;
  /** Refetch the page when its image fails; `null` means there is nothing to retry. */
  retry: (page: PageData) => Promise<PageData | null>;
  maxRetries: number;
  /** Called once when the retry budget is exhausted. */
  onGiveUp: () => void;
  /** Called each time an image loads, including after a successful retry. */
  onLoaded?: (page: PageData) => void;
}

/**
 * Show one page's image, refetching through `retry` on load failure.
 *
 * The attempt count spans retries: the first error is attempt 1, the next attempt 2, and so on.
 * Handlers are replaced before every attempt, so a stale callback cannot act on a newer page.
 */
export function showPageImage({
  img,
  page,
  retry,
  maxRetries,
  onGiveUp,
  onLoaded,
}: ShowPageImageOptions): void {
  let gaveUp = false;

  const clearHandlers = (): void => {
    img.onload = null;
    img.onerror = null;
  };

  const render = (data: PageData, attempt: number): void => {
    clearHandlers();

    // Only the *same* source can be reported as an instant cache hit; a fresh `src` resets the
    // element, so `complete` would describe the previous page, not this one.
    if (img.src === data.imgSrc && img.complete && img.naturalWidth > 0) {
      log("instant from cache", data.imgSrc);
      onLoaded?.(data);
      return;
    }

    img.onload = () => {
      onLoaded?.(data);
    };
    img.onerror = () => {
      if (gaveUp) {
        return;
      }
      clearHandlers();
      warn(`image failed (attempt ${attempt + 1})`, data.imgSrc);
      if (attempt >= maxRetries) {
        gaveUp = true;
        warn("giving up");
        onGiveUp();
        return;
      }
      void retry(data)
        .then((retried) => {
          if (retried) {
            render(retried, attempt + 1);
            return;
          }
          if (!gaveUp) {
            gaveUp = true;
            warn("image retry unavailable");
            onGiveUp();
          }
        })
        .catch((error: unknown) => {
          if (gaveUp) {
            return;
          }
          gaveUp = true;
          warn("image retry failed", error);
          onGiveUp();
        });
    };
    img.src = data.imgSrc;
  };

  render(page, 0);
}

/** One page image and the actions the reader performs on it. */
export interface PageImageSlot<Img extends PageImage = PageImage> {
  readonly img: Img;
  /** The page currently shown, updated when a retry swaps the source. */
  readonly page: PageData;
  /** Load the page image, refetching on failure. */
  show: () => void;
  /** Refresh the source with a fresh native token; false when there is nothing to reload. */
  reload: () => boolean;
  /** Swap in the original file once `level` outgrows the served copy. */
  upgrade: (level: number) => void;
}

interface PageImageSlotOptions {
  page: PageData;
  retry: (page: PageData) => Promise<PageData | null>;
  maxRetries: number;
  onLoaded?: (page: PageData) => void;
  onGiveUp?: () => void;
  /** View lifetime; a probe that resolves after abort must not swap the source. */
  signal?: AbortSignal;
  /** Guards a stale original probe when the element is reused by a newer page. */
  isCurrent?: () => boolean;
  /** Probe factory, injectable so tests can drive the load without a network. */
  probe?: () => PageImage;
}

/**
 * Bind one image element to one page.
 *
 * The slot owns the per-page state the viewer would otherwise scatter across its mode branches: the
 * current page after a retry, the reload token, and the one-shot original upgrade, including the
 * probe that confirms the original actually has more pixels.
 */
export function createPageImageSlot<Img extends PageImage>(
  img: Img,
  {
    page: initialPage,
    retry,
    maxRetries,
    onLoaded,
    onGiveUp,
    signal,
    isCurrent,
    probe: createProbe,
  }: PageImageSlotOptions,
): PageImageSlot<Img> {
  let page = initialPage;
  let upgradePending = false;
  let upgradeFailed = false;
  let upgraded = false;

  const show = (): void => {
    showPageImage({
      img,
      page,
      retry,
      maxRetries,
      onGiveUp: onGiveUp ?? (() => undefined),
      onLoaded: (loaded) => {
        page = loaded;
        onLoaded?.(loaded);
      },
    });
  };

  const reload = (): boolean => {
    const source = img.getAttribute("src");
    if (source === null || source === "") {
      return false;
    }
    const base = source.replace(/([?&])nl=[^&]*/u, "");
    const token = page.nlToken ?? String(Date.now());
    img.src = `${base}${base.includes("?") ? "&" : "?"}nl=${token}`;
    return true;
  };

  const upgrade = (level: number): void => {
    if (upgradePending || upgradeFailed || upgraded) {
      return;
    }
    const source = page.originalHref;
    if (source === null || source === page.imgSrc) {
      return;
    }
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    if (level <= nativeZoomLimit(img.clientHeight * dpr, img.naturalHeight)) {
      return;
    }

    upgradePending = true;
    const probe: PageImage = createProbe ? createProbe() : new Image();
    probe.onload = () => {
      upgradePending = false;
      if (signal?.aborted || isCurrent?.() === false) {
        return;
      }
      // The link exists on resized pages; if the server still handed back the same pixels, keep
      // the current image instead of swapping sources for nothing.
      if (probe.naturalWidth <= img.naturalWidth && probe.naturalHeight <= img.naturalHeight) {
        upgradeFailed = true;
        return;
      }
      upgraded = true;
      // The source has pixels now; the CSS size and the zoom transform stay put.
      img.src = source;
      log("original image", source);
    };
    probe.onerror = () => {
      upgradePending = false;
      upgradeFailed = true;
    };
    probe.src = source;
  };

  return {
    img,
    get page() {
      return page;
    },
    show,
    reload,
    upgrade,
  };
}
