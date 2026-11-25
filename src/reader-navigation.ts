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

    const goEnd = (end: ReaderEnd): void => {
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

    return {
      show,
      go,
      goEnd,
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

    const goEnd = (end: ReaderEnd): void => {
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

    return {
      show,
      go,
      goEnd,
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
      });
      const retry = buttonEl({
        class: "btn btn-small reader-page-retry",
        text: "Retry",
        style: "position: absolute; z-index: 1;",
      });
      retry.hidden = true;
      node.append(img, retry);
      // Lazy images have no intrinsic height before they load, which makes a fast scroll jump as
      // each page arrives. Reserve the previous page's aspect until this one can measure itself.
      node.style.minHeight = `${Math.round(window.innerWidth * aspect)}px`;

      const loadGeneration = generation;
      const slot = slotFactory.create(img, data, {
        isCurrent: () => generation === loadGeneration,
        onGiveUp: () => {
          node.classList.add("is-failed");
          retry.hidden = false;
        },
        onLoaded: () => {
          node.classList.remove("is-failed");
          retry.hidden = true;
          node.style.removeProperty("min-height");
          if (img.naturalWidth > 0) {
            aspect = img.naturalHeight / img.naturalWidth;
          }
        },
      });
      retry.addEventListener(
        "click",
        () => {
          retry.hidden = true;
          node.classList.remove("is-failed");
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
      reportHud(
        visible,
        base,
        !((state === undefined || state.done) && index >= pages.length - 1),
        index > 0,
      );
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
      const midpoint = window.innerHeight / 2;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      pages.forEach((entry, position) => {
        const rect = entry.node.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - midpoint);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = position;
        }
      });
      const previous = index;
      index = best;
      if (best !== previous) {
        setSurface(pages[best]);
      }
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

    const goEnd = (end: ReaderEnd): void => {
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

    return {
      show,
      go,
      goEnd,
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
