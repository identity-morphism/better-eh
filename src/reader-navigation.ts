import { loader } from "./fetch/loader";
import { priorityOf } from "./net/priority";
import type { PageImageSlot, PageImageSlotFactory } from "./page-image";
import { createPageImageSlotFactory } from "./page-image";
import type { PageIntent } from "./reader-mode";
import { clickIntent, swipeIntent } from "./reader-mode";
import { getSettings } from "./settings";
import type { PageData, ReaderMode, ReadingDirection } from "./types";
import type { ContinuousStack } from "./ui/continuous-stack";
import { createContinuousStack } from "./ui/continuous-stack";
import { buttonEl, el } from "./ui/dom";

export type ReaderDirection = "prev" | "next";
export type ReaderEnd = "first" | "last";

/** The image (or image pair) the zoom controller scales and the HUD reports. */
export interface ReaderSurface {
  readonly element: HTMLElement;
  readonly page: PageData;
  /** Reload the page `R` acts on; false when there is nothing to reload. */
  reload: () => boolean;
  /** Upgrade every visible image that has outgrown its served copy. */
  upgrade: (level: number) => void;
}

/** What the HUD controls should show for the adapter's current position. */
export interface ReaderHudState {
  readonly page: PageData;
  readonly first: boolean;
  readonly prev: boolean;
  readonly next: boolean;
  readonly last: boolean;
}

export interface ReaderNavigationOptions {
  signal: AbortSignal;
  /** Movement within the reader uses replace-navigation. */
  navigate: (url: string, options?: { replace?: boolean }) => void;
  toast: (text: string) => void;
  mainImage: HTMLImageElement;
  spreadImage: HTMLImageElement;
  /** The single/spread wrapper; hidden while the stack owns the layout. */
  spreadWrap: HTMLElement;
  continuousContainer: HTMLElement;
  /** Report the visible page and which HUD controls have targets. */
  onHud: (state: ReaderHudState) => void;
  /** The zoom surface changed (layout switch, spread companion, continuous scroll). */
  onSurfaceChange: () => void;
  /** A main/spread image loaded; the view hides its error panel and logs. */
  onImageLoaded: (page: PageData) => void;
  /** A main/spread image exhausted its retry ladder. */
  onImageError: (page: PageData) => void;
  /** Current zoom level, for images that just became visible. */
  zoomLevel: () => number;
}

export interface ReaderNavigation {
  /** Lay out `page` in the active adapter and load what that adapter needs. */
  show: (page: PageData) => void;
  /** Switch to another reader mode, re-showing the last page. */
  setMode: (mode: ReaderMode) => void;
  go: (direction: ReaderDirection) => void;
  goEnd: (end: ReaderEnd) => void;
  reload: () => boolean;
  upgrade: (level: number) => void;
  surface: () => ReaderSurface;
  currentPage: () => PageData;
  /** Continuous scroll bookkeeping; a no-op in the other modes. */
  handleScroll: () => void;
  /** Re-show the main image after its retry produced no new page. */
  retryMain: () => void;
  clickIntent: (ratio: number, direction: ReadingDirection) => PageIntent;
  swipeIntent: (
    dx: number,
    minDistance: number,
    direction: ReadingDirection,
  ) => ReaderDirection | null;
  /** True when the vertical stack owns the layout. */
  readonly continuous: boolean;
  stop: () => void;
}

interface ModeAdapter {
  show: (page: PageData) => void;
  go: (direction: ReaderDirection) => void;
  goEnd: (end: ReaderEnd) => void;
  reload: () => boolean;
  upgrade: (level: number) => void;
  surface: () => ReaderSurface;
  page: () => PageData;
  handleScroll: () => void;
  retryMain: () => void;
  stop: () => void;
}

function makeSurface(
  element: HTMLElement,
  primary: PageImageSlot<HTMLImageElement>,
  visible: readonly PageImageSlot<HTMLImageElement>[],
): ReaderSurface {
  return {
    element,
    get page() {
      return primary.page;
    },
    reload: () => primary.reload(),
    upgrade(level) {
      for (const slot of visible) {
        slot.upgrade(level);
      }
    },
  };
}

/** `1,234 KB :: 800 x 1200` — width x height, in CSS pixels, at the end of the info bar. */
const FILE_INFO_DIMENSIONS = /::\s*(\d+)\s*x\s*(\d+)/;

/** Pages measured around the current index while the cached geometry is stale. */
const GEOMETRY_SCAN = 3;

/** One page node and its document-space position; only tops and heights are needed. */
interface PageGeometry {
  readonly top: number;
  readonly height: number;
}

interface PageNode {
  readonly node: HTMLElement;
}

/** A nearby scan that can be reused until layout or the scroll position changes again. */
interface NearbyScan {
  readonly revision: number;
  readonly scroll: number;
  readonly viewport: number;
  readonly count: number;
  /** The page the scan chose; the current index is the cache key. */
  readonly index: number;
}

function pageAspect(data: PageData): number | null {
  const match = FILE_INFO_DIMENSIONS.exec(data.fileInfo);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  return match !== null && width > 0 && height > 0 ? height / width : null;
}

function nearestGeometryIndex(geometry: readonly PageGeometry[], point: number): number {
  // Last page whose top is at or above `point`; nearest-centre refinement only needs its
  // neighbours even when a page is much taller than the viewport.
  let low = 0;
  let high = geometry.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const entry = geometry[middle];
    if (entry !== undefined && entry.top <= point) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const pivot = low > 0 ? low - 1 : 0;
  return nearestInRange(
    geometry,
    point,
    Math.max(0, pivot - GEOMETRY_SCAN),
    Math.min(geometry.length - 1, pivot + GEOMETRY_SCAN),
  );
}

function nearestInRange(
  geometry: readonly PageGeometry[],
  point: number,
  from: number,
  to: number,
): number {
  let best = from;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let position = from; position <= to; position += 1) {
    const entry = geometry[position];
    if (entry === undefined) {
      continue;
    }
    const distance = Math.abs(entry.top + entry.height / 2 - point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = position;
    }
  }
  return best;
}

/**
 * Read only the pages around the current index.
 *
 * Returns null when the viewport centre left their combined vertical span, which is the signal to
 * measure every page once instead of trusting a stale cache.
 */
function nearestNearbyIndex(
  pages: readonly PageNode[],
  current: number,
  viewportCenter: number,
): number | null {
  const from = Math.max(0, current - GEOMETRY_SCAN);
  const to = Math.min(pages.length - 1, current + GEOMETRY_SCAN);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let position = from; position <= to; position += 1) {
    const entry = pages[position];
    if (entry === undefined) {
      continue;
    }
    const rect = entry.node.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = position;
    }
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return best >= 0 && viewportCenter >= top && viewportCenter <= bottom ? best : null;
}

function measureGeometry(pages: readonly PageNode[]): PageGeometry[] {
  const scroll = window.scrollY;
  return pages.map((entry) => {
    const rect = entry.node.getBoundingClientRect();
    return { top: rect.top + scroll, height: rect.height };
  });
}

function sameHud(previous: ReaderHudState, next: ReaderHudState): boolean {
  return (
    previous.page === next.page &&
    previous.first === next.first &&
    previous.prev === next.prev &&
    previous.next === next.next &&
    previous.last === next.last
  );
}

/**
 * The reader's movement seam: one adapter per mode, chosen when the mode is mounted, with HUD,
 * click, swipe, keyboard and layout sync all asking this module instead of re-reading the setting.
 */
export function createReaderNavigation(options: ReaderNavigationOptions): ReaderNavigation {
  const slotFactory: PageImageSlotFactory = createPageImageSlotFactory({
    retry: (page) => loader.retryWithNl(page, { signal: options.signal }),
    maxRetries: () => getSettings().maxNlRetry,
    signal: options.signal,
  });

  let mode: ReaderMode = getSettings().readerMode;
  let lastPage: PageData | null = null;
  let adapter: ModeAdapter;

  const reportHud = (
    page: PageData,
    source: PageData,
    next: boolean,
    prev = source.prevHref !== null,
  ): void => {
    options.onHud({
      page,
      first: source.firstHref !== null,
      prev,
      next,
      last: source.lastHref !== null,
    });
  };

  const navigateEnd = (base: PageData | null, end: ReaderEnd): void => {
    if (base === null) {
      return;
    }
    const target = end === "first" ? base.firstHref : base.lastHref;
    if (target !== null) {
      options.navigate(target, { replace: true });
      return;
    }
    options.toast(end === "first" ? "First page" : "Last page");
  };

  const singleAdapter = (): ModeAdapter => {
    let base: PageData | null = null;
    let slot: PageImageSlot<HTMLImageElement> | null = null;
    let surface: ReaderSurface | null = null;

    const createMain = (data: PageData): PageImageSlot<HTMLImageElement> =>
      slotFactory.create(options.mainImage, data, {
        isCurrent: () => mode === "single" && base === data,
        onLoaded: options.onImageLoaded,
        onGiveUp: () => options.onImageError(data),
      });

    const hud = (): void => {
      if (base === null) {
        return;
      }
      reportHud(slot?.page ?? base, base, base.nextHref !== null);
    };

    const show = (data: PageData): void => {
      base = data;
      options.spreadWrap.hidden = false;
      options.continuousContainer.hidden = true;
      slot = createMain(data);
      slot.show();
      surface = makeSurface(options.mainImage, slot, [slot]);
      options.onSurfaceChange();
      hud();
    };

    const go = (direction: ReaderDirection): void => {
      if (base === null) {
        return;
      }
      const target = direction === "prev" ? base.prevHref : base.nextHref;
      if (target !== null) {
        options.navigate(target, { replace: true });
        return;
      }
      options.toast(direction === "prev" ? "First page" : "Last page");
    };

    return {
      show,
      go,
      goEnd: (end) => navigateEnd(base, end),
      reload: () => slot?.reload() ?? false,
      upgrade: (level) => surface?.upgrade(level),
      surface: () => {
        if (surface === null) {
          throw new Error("reader surface is not mounted");
        }
        return surface;
      },
      page: () => slot?.page ?? base ?? lastPageOrThrow(),
      handleScroll: () => undefined,
      retryMain: () => {
        if (base !== null) {
          show(base);
        }
      },
      stop: () => undefined,
    };
  };

  const spreadAdapter = (): ModeAdapter => {
    let base: PageData | null = null;
    let mainSlot: PageImageSlot<HTMLImageElement> | null = null;
    let companionSlot: PageImageSlot<HTMLImageElement> | null = null;
    let companion: PageData | null = null;
    let surface: ReaderSurface | null = null;
    /** Invalidates a facing-page fetch when the mounted pair changes. */
    let pairToken = 0;
    /** Invalidates a movement that was overtaken by a newer movement. */
    let navigationToken = 0;

    const setSingle = (single: boolean): void => {
      options.spreadWrap.classList.toggle("is-single", single);
    };

    const visibleSlots = (): PageImageSlot<HTMLImageElement>[] => {
      if (mainSlot === null) {
        return [];
      }
      return companionSlot !== null && !options.spreadImage.hidden
        ? [mainSlot, companionSlot]
        : [mainSlot];
    };

    const syncSurface = (): void => {
      surface =
        mainSlot === null ? null : makeSurface(options.spreadWrap, mainSlot, visibleSlots());
      options.onSurfaceChange();
    };

    const hud = (): void => {
      if (base === null || mainSlot === null) {
        return;
      }
      const facingVisible = companion !== null && !options.spreadImage.hidden;
      reportHud(
        mainSlot.page,
        base,
        facingVisible && companion !== null ? companion.nextHref !== null : base.nextHref !== null,
      );
    };

    const createMain = (data: PageData): PageImageSlot<HTMLImageElement> =>
      slotFactory.create(options.mainImage, data, {
        isCurrent: () => mode === "spread" && base === data,
        onLoaded: options.onImageLoaded,
        onGiveUp: () => options.onImageError(data),
      });

    const clear = (): void => {
      pairToken += 1;
      companion = null;
      companionSlot = null;
      options.spreadImage.hidden = true;
      options.spreadImage.removeAttribute("src");
      setSingle(false);
    };

    const show = (data: PageData): void => {
      base = data;
      options.spreadWrap.hidden = false;
      options.continuousContainer.hidden = true;
      clear();
      setSingle(data.nextHref === null);
      mainSlot = createMain(data);
      mainSlot.show();
      syncSurface();
      hud();
      if (data.nextHref === null) {
        return;
      }

      const loadToken = pairToken;
      void loader
        .viewerPage(data.nextHref, {
          priority: priorityOf("facing"),
          signal: options.signal,
        })
        .then((facing) => {
          if (options.signal.aborted || loadToken !== pairToken || base === null) {
            return;
          }
          companion = facing;
          options.spreadImage.hidden = false;
          setSingle(false);
          options.spreadImage.alt = `${facing.galleryTitle.primary} — page ${facing.counterText}`;
          companionSlot = slotFactory.create(options.spreadImage, facing, {
            isCurrent: () => mode === "spread" && companion === facing,
            onGiveUp: () => {
              options.spreadImage.hidden = true;
              setSingle(true);
              syncSurface();
              hud();
            },
          });
          companionSlot.show();
          syncSurface();
          hud();
          // If the pair is already zoomed, the newly visible facing page needs its original too.
          surface?.upgrade(options.zoomLevel());
        })
        .catch(() => {
          if (options.signal.aborted || loadToken !== pairToken || base === null) {
            return;
          }
          clear();
          setSingle(true);
          syncSurface();
          hud();
        });
    };

    const go = (direction: ReaderDirection): void => {
      const from = base;
      if (from === null) {
        return;
      }
      const loadToken = ++navigationToken;
      if (direction === "next") {
        void (async () => {
          let trailing = companion;
          if (trailing === null && from.nextHref !== null) {
            trailing = await loader
              .viewerPage(from.nextHref, {
                priority: priorityOf("facing"),
                signal: options.signal,
              })
              .catch(() => null);
          }
          if (loadToken !== navigationToken || options.signal.aborted) {
            return;
          }
          const target = trailing !== null ? trailing.nextHref : from.nextHref;
          if (target !== null) {
            options.navigate(target, { replace: true });
            return;
          }
          options.toast("Last page");
        })();
        return;
      }

      void (async () => {
        const back =
          from.prevHref !== null
            ? await loader
                .viewerPage(from.prevHref, {
                  priority: priorityOf("facing"),
                  signal: options.signal,
                })
                .catch(() => null)
            : null;
        if (loadToken !== navigationToken || options.signal.aborted) {
          return;
        }
        // Page 1 has no previous, so stepping back from page 2 means page 1 itself.
        const target = back !== null ? (back.prevHref ?? back.viewerUrl) : from.prevHref;
        if (target !== null && target !== from.viewerUrl) {
          options.navigate(target, { replace: true });
          return;
        }
        options.toast("First page");
      })();
    };

    return {
      show,
      go,
      goEnd: (end) => navigateEnd(base, end),
      reload: () => mainSlot?.reload() ?? false,
      upgrade: (level) => surface?.upgrade(level),
      surface: () => {
        if (surface === null) {
          throw new Error("reader surface is not mounted");
        }
        return surface;
      },
      page: () => mainSlot?.page ?? base ?? lastPageOrThrow(),
      handleScroll: () => undefined,
      retryMain: () => {
        if (base === null) {
          return;
        }
        mainSlot = createMain(base);
        mainSlot.show();
        syncSurface();
      },
      stop: () => {
        clear();
        surface = null;
        options.spreadWrap.classList.remove("is-single");
      },
    };
  };

  const continuousAdapter = (): ModeAdapter => {
    let base: PageData | null = null;
    let stack: ContinuousStack<PageImageSlot<HTMLImageElement>> | null = null;
    let index = 0;
    let generation = 0;
    let aspect = 1.4;
    let frame: number | undefined;
    let surface: ReaderSurface | null = null;
    /** Document-space page tops/heights; null until a full measure is due. */
    let geometry: PageGeometry[] | null = null;
    /** Reused nearby scan, so an unchanged frame does not reread the same rects. */
    let nearbyScan: NearbyScan | null = null;
    /** Bumped whenever a page joins, loads, fails or the window resizes. */
    let layoutRevision = 0;
    let hudState: ReaderHudState | null = null;

    const invalidateGeometry = (): void => {
      geometry = null;
      nearbyScan = null;
      layoutRevision += 1;
    };

    const onResize = (): void => {
      invalidateGeometry();
    };
    window.addEventListener("resize", onResize, { passive: true });

    const renderPage = (
      data: PageData,
    ): {
      node: HTMLElement;
      view: PageImageSlot<HTMLImageElement>;
    } => {
      const node = el("div", { class: "reader-page" });
      const img = el("img", {
        class: "reader-page-img",
        alt: `${data.galleryTitle.primary} — page ${data.counterText}`,
        loading: "lazy",
        decoding: "async",
      });
      const retry = buttonEl({
        class: "btn btn-small reader-page-retry",
        text: "Retry",
        style: "position: absolute; z-index: 1;",
      });
      retry.hidden = true;
      node.append(img, retry);
      // Lazy images have no intrinsic height before they load, which makes a fast scroll jump as
      // each page arrives. Reserve this page's declared aspect from the info bar; without one,
      // fall back to the last measured/declared aspect against the viewport.
      const declared = pageAspect(data);
      if (declared !== null) {
        aspect = declared;
        const containerWidth = options.continuousContainer.clientWidth;
        const reserveWidth = containerWidth > 0 ? containerWidth : window.innerWidth;
        node.style.minHeight = `${Math.round(reserveWidth * declared)}px`;
      } else {
        node.style.minHeight = `${Math.round(window.innerWidth * aspect)}px`;
      }

      const loadGeneration = generation;
      const slot = slotFactory.create(img, data, {
        isCurrent: () => generation === loadGeneration,
        onGiveUp: () => {
          node.classList.add("is-failed");
          retry.hidden = false;
          invalidateGeometry();
        },
        onLoaded: () => {
          node.classList.remove("is-failed");
          retry.hidden = true;
          node.style.removeProperty("min-height");
          if (img.naturalWidth > 0) {
            aspect = img.naturalHeight / img.naturalWidth;
          }
          invalidateGeometry();
        },
      });
      retry.addEventListener(
        "click",
        () => {
          retry.hidden = true;
          node.classList.remove("is-failed");
          invalidateGeometry();
          slot.show();
        },
        { signal: options.signal },
      );
      slot.show();
      return { node, view: slot };
    };

    const hud = (): void => {
      if (base === null) {
        return;
      }
      const pages = stack?.pages() ?? [];
      const visible = pages[index]?.view.page ?? base;
      const state = stack?.state();
      const next: ReaderHudState = {
        page: visible,
        first: base.firstHref !== null,
        prev: index > 0,
        next: !((state === undefined || state.done) && index >= pages.length - 1),
        last: base.lastHref !== null,
      };
      if (hudState !== null && sameHud(hudState, next)) {
        return;
      }
      hudState = next;
      options.onHud(next);
    };

    const setSurface = (
      entry: { node: HTMLElement; view: PageImageSlot<HTMLImageElement> } | undefined,
    ): void => {
      surface = entry === undefined ? null : makeSurface(entry.view.img, entry.view, [entry.view]);
      options.onSurfaceChange();
    };

    const scrollTo = (next: number): void => {
      const entry = stack?.pages()[next];
      if (entry === undefined) {
        return;
      }
      entry.node.scrollIntoView({ block: "start" });
      index = next;
      setSurface(entry);
      hud();
      // A page scrolled into a zoomed stack needs its original too, not only the one that zoomed.
      surface?.upgrade(options.zoomLevel());
    };

    const teardown = (): void => {
      generation += 1;
      stack?.stop();
      stack = null;
      index = 0;
      surface = null;
      geometry = null;
      nearbyScan = null;
      hudState = null;
      options.continuousContainer.replaceChildren();
    };

    const show = (data: PageData): void => {
      base = data;
      options.spreadWrap.hidden = true;
      options.continuousContainer.hidden = false;
      // The hidden single/spread images must not keep fetching the page the stack owns.
      options.mainImage.removeAttribute("src");
      options.spreadImage.hidden = true;
      options.spreadImage.removeAttribute("src");
      teardown();
      stack = createContinuousStack<PageData, PageImageSlot<HTMLImageElement>>({
        container: options.continuousContainer,
        initial: data,
        next: data.nextHref,
        key: (page) => page.viewerUrl,
        signal: options.signal,
        load: (url, signal) =>
          loader.viewerPage(url, { priority: priorityOf("facing"), signal }).then((page) => ({
            items: [page],
            next: page.nextHref,
          })),
        render: renderPage,
        onChange: hud,
        onAppend: invalidateGeometry,
      });
      index = 0;
      setSurface(stack.pages()[0]);
      hud();
    };

    const sync = (): void => {
      const pages = stack?.pages() ?? [];
      if (pages.length === 0) {
        return;
      }
      const viewportCenter = window.innerHeight / 2;
      const scroll = window.scrollY;
      const documentCenter = scroll + viewportCenter;
      let best: number;

      if (geometry !== null && geometry.length === pages.length) {
        best = nearestGeometryIndex(geometry, documentCenter);
      } else if (
        nearbyScan !== null &&
        nearbyScan.revision === layoutRevision &&
        nearbyScan.scroll === scroll &&
        nearbyScan.viewport === window.innerHeight &&
        nearbyScan.count === pages.length &&
        nearbyScan.index === index
      ) {
        // An image load, a resize or an append invalidated the geometry, but nothing moved since
        // the last nearby scan. Reuse it rather than reading or measuring again.
        best = nearbyScan.index;
      } else {
        const nearby = nearestNearbyIndex(pages, index, viewportCenter);
        if (nearby !== null) {
          best = nearby;
          nearbyScan = {
            revision: layoutRevision,
            scroll,
            viewport: window.innerHeight,
            count: pages.length,
            index: nearby,
          };
        } else {
          // The centre left the neighbourhood: pay for one full measure, then binary search.
          geometry = measureGeometry(pages);
          nearbyScan = null;
          best = nearestGeometryIndex(geometry, documentCenter);
        }
      }

      const previous = index;
      index = best;
      if (best !== previous) {
        setSurface(pages[best]);
      }
      // The HUD memo makes this a no-op unless the page or its flags actually changed.
      hud();
      if (best !== previous) {
        surface?.upgrade(options.zoomLevel());
      }
    };

    const go = (direction: ReaderDirection): void => {
      const active = stack;
      if (active === null) {
        return;
      }
      if (direction === "prev") {
        if (index <= 0) {
          options.toast("First page");
          return;
        }
        scrollTo(index - 1);
        return;
      }

      void (async () => {
        if (index >= active.pages().length - 1) {
          const state = active.state();
          if (state.loading) {
            return;
          }
          if (!state.done) {
            const appended = state.failed ? await active.retry() : await active.loadNext();
            if (active !== stack || options.signal.aborted) {
              return;
            }
            if (!appended) {
              const after = active.state();
              if (after.failed) {
                options.toast("Could not load the next page");
              } else if (after.done) {
                options.toast("Last page");
              }
              hud();
              return;
            }
          }
        }

        if (index >= active.pages().length - 1) {
          options.toast("Last page");
          return;
        }
        scrollTo(index + 1);
      })();
    };

    return {
      show,
      go,
      goEnd: (end) => navigateEnd(base, end),
      reload: () => surface?.reload() ?? false,
      upgrade: (level) => surface?.upgrade(level),
      surface: () => {
        if (surface === null) {
          throw new Error("reader surface is not mounted");
        }
        return surface;
      },
      page: () => {
        const pages = stack?.pages() ?? [];
        return pages[index]?.view.page ?? base ?? lastPageOrThrow();
      },
      handleScroll: () => {
        if (frame !== undefined) {
          return;
        }
        frame = window.requestAnimationFrame(() => {
          frame = undefined;
          sync();
        });
      },
      retryMain: () => undefined,
      stop: () => {
        window.removeEventListener("resize", onResize);
        if (frame !== undefined) {
          window.cancelAnimationFrame(frame);
          frame = undefined;
        }
        teardown();
      },
    };
  };

  function lastPageOrThrow(): PageData {
    if (lastPage === null) {
      throw new Error("reader has no page");
    }
    return lastPage;
  }

  const makeAdapter = (next: ReaderMode): ModeAdapter =>
    next === "continuous"
      ? continuousAdapter()
      : next === "spread"
        ? spreadAdapter()
        : singleAdapter();

  adapter = makeAdapter(mode);

  return {
    show(page) {
      lastPage = page;
      adapter.show(page);
    },
    setMode(next) {
      if (next === mode) {
        return;
      }
      adapter.stop();
      mode = next;
      adapter = makeAdapter(next);
      if (lastPage !== null) {
        adapter.show(lastPage);
      }
    },
    go: (direction) => adapter.go(direction),
    goEnd: (end) => adapter.goEnd(end),
    reload: () => adapter.reload(),
    upgrade: (level) => adapter.upgrade(level),
    surface: () => adapter.surface(),
    currentPage: () => adapter.page(),
    handleScroll: () => adapter.handleScroll(),
    retryMain: () => adapter.retryMain(),
    clickIntent: (ratio, direction) => clickIntent(ratio, mode, direction),
    swipeIntent: (dx, minDistance, direction) => swipeIntent(dx, minDistance, mode, direction),
    get continuous() {
      return mode === "continuous";
    },
    stop: () => adapter.stop(),
  };
}
