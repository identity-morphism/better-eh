import { saveResume } from "../data/resume";
import { preloadImage, touchImage } from "../fetch/images";
import { loader } from "../fetch/loader";
import { createPrefetcher } from "../fetch/prefetch";
import { isKey } from "../keymap";
import { log } from "../log";
import { priorityOf } from "../net/priority";
import { net } from "../net/queue";
import type { PageImageSlot } from "../page-image";
import { createPageImageSlot } from "../page-image";
import { clickIntent, readerLayout, swipeIntent } from "../reader-mode";
import { getSettings, onSettingsChange, updateSetting } from "../settings";
import shellHtml from "../shell.html" with { type: "text" };
import type { PageData } from "../types";
import type { ContinuousStack } from "../ui/continuous-stack";
import { createContinuousStack } from "../ui/continuous-stack";
import { el, icon, isEditableTarget } from "../ui/dom";
import { titleNodes } from "../ui/title";
import { showToast } from "../ui/toast";
import { applyViewMode, setCursorHidden } from "../view-mode";
import { ZoomController } from "../zoom";
import type { ViewContext } from "./context";
import { requireShell } from "./shell";

const HIDE_CURSOR_AFTER = 3000;
const SWIPE_MIN = 50;

/** Mount the full-screen reader for one viewer page. */
export function mountViewer(host: HTMLElement, pageData: PageData, ctx: ViewContext): void {
  host.innerHTML = shellHtml;

  const ui = {
    elReader: requireShell("reader"),
    elWrap: requireShell("img-wrap"),
    elImg: requireShell("main-img"),
    elSpread: requireShell("spread-img"),
    elContinuous: requireShell("continuous"),
    elTitle: requireShell("hud-title"),
    elCounter: requireShell("hud-counter"),
    elFileInfo: requireShell("file-info"),
    elGallery: requireShell("hud-gallery"),
    elFirst: requireShell("hud-first"),
    elPrev: requireShell("hud-prev"),
    elNext: requireShell("hud-next"),
    elLast: requireShell("hud-last"),
    elOriginal: requireShell("hud-original"),
    elForum: requireShell("hud-forum"),
    elSearch: requireShell("hud-search"),
    elHelp: requireShell("hud-help"),
    elError: requireShell("img-error"),
    elErrorText: requireShell("img-error-text"),
    elErrorRetry: requireShell("img-error-retry"),
  };
  // The shell ships empty containers; the icons come from the shared set, not text glyphs.
  ui.elGallery.append(icon("back"));
  ui.elFirst.append(icon("first"));
  ui.elPrev.append(icon("chevronLeft"));
  ui.elNext.append(icon("chevronRight"));
  ui.elLast.append(icon("last"));

  // One window owner per mount: a remount replaces it outright, and this view's abort cancels it
  // without touching any other instance. The deps read settings and queue state lazily.
  const prefetcher = createPrefetcher({
    viewerPage: (url, options) => loader.viewerPage(url, options),
    preloadImage,
    touchImage,
    retryWithNl: (page) => loader.retryWithNl(page),
    activeCount: () => net.activeCount,
    concurrency: () => getSettings().netConcurrency,
    depth: () => getSettings().prefetchCount,
    clock: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
    },
  });

  /**
   * A spread with no facing page should not keep the half-width slot reserved for one. The class
   * only takes effect under `body.reader-spread`, so single and continuous layouts ignore it.
   */
  const setSpreadSingle = (single: boolean): void => {
    ui.elWrap.classList.toggle("is-single", single);
  };

  const setHelp = (open: boolean): void => {
    ui.elHelp.hidden = !open;
  };

  let current = pageData;
  let chromePinned = false;
  let mainSlot: PageImageSlot<HTMLImageElement> | null = null;
  let companionSlot: PageImageSlot<HTMLImageElement> | null = null;
  let spreadCompanion: PageData | null = null;
  let spreadToken = 0;
  let navigationToken = 0;
  let stack: ContinuousStack<PageImageSlot<HTMLImageElement>> | null = null;
  let continuousIndex = 0;
  /** Last loaded page's height/width, used to reserve space before a lazy page arrives. */
  let continuousAspect = 1.4;
  let activeMode = getSettings().readerMode;
  let resumeTimer: number | undefined;
  let resumePage: PageData | null = null;

  /**
   * Everything the reader currently shows: the zoom target, the page the HUD and `R` act on, the
   * image `R` reloads, and every image a deep zoom may upgrade. One value, so single, spread and
   * continuous stop each deciding independently what “the current image” means.
   */
  interface ReaderSurface {
    readonly element: HTMLElement;
    readonly page: PageData;
    /** Reload the page `R` acts on; false when there is nothing to reload. */
    reload: () => boolean;
    /** Upgrade every visible image that has outgrown its served copy. */
    upgrade: (level: number) => void;
  }

  function makeSurface(
    element: HTMLElement,
    primary: PageImageSlot<HTMLImageElement>,
    visible: PageImageSlot<HTMLImageElement>[],
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

  /** The one value every surface consumer reads; refreshed only when what is visible changes. */
  let surface: ReaderSurface | null = null;

  const zoom = new ZoomController(
    ui.elReader,
    () => activeSurface().element,
    () => getSettings().fitHeight,
    ctx.signal,
    (level) => activeSurface().upgrade(level),
  );

  const updateTitleWidth = (): void => {
    const viewportWidth = window.innerWidth;
    const maxWidth = getSettings().fitHeight
      ? Math.max(220, (viewportWidth - ui.elImg.clientWidth) / 2 - 30)
      : Math.min(760, viewportWidth * 0.62);
    ui.elTitle.style.maxWidth = `${maxWidth}px`;
  };

  function createMainSlot(data: PageData): PageImageSlot<HTMLImageElement> {
    return createPageImageSlot(ui.elImg, {
      page: data,
      retry: (page) => loader.retryWithNl(page),
      maxRetries: getSettings().maxNlRetry,
      signal: ctx.signal,
      isCurrent: () => current === data && !readerLayout(getSettings().readerMode).continuous,
      onGiveUp: () => showError(),
      onLoaded: (loaded) => {
        hideError();
        if (ui.elImg.naturalWidth > 0) {
          continuousAspect = ui.elImg.naturalHeight / ui.elImg.naturalWidth;
        }
        log("image displayed", loaded.imgSrc);
      },
    });
  }

  function computeSurface(): ReaderSurface {
    const mode = getSettings().readerMode;
    if (mode === "continuous") {
      const pages = stack?.pages() ?? [];
      const entry = pages[continuousIndex] ?? pages[0];
      if (entry) {
        const slot = entry.view;
        return makeSurface(slot.img, slot, [slot]);
      }
    } else if (mode === "spread" && mainSlot !== null) {
      const spreadPrimary = mainSlot;
      const visible: PageImageSlot<HTMLImageElement>[] = [spreadPrimary];
      if (companionSlot !== null && !ui.elSpread.hidden) {
        visible.push(companionSlot);
      }
      return makeSurface(ui.elWrap, spreadPrimary, visible);
    }

    const primary = mainSlot ?? createMainSlot(current);
    return makeSurface(ui.elImg, primary, [primary]);
  }

  function refreshSurface(): void {
    surface = computeSurface();
  }

  function activeSurface(): ReaderSurface {
    surface ??= computeSurface();
    return surface;
  }

  function flushResume(): void {
    if (resumePage === null) {
      return;
    }
    saveResume(resumePage.galleryHref, {
      pageUrl: resumePage.viewerUrl,
      pageNum: resumePage.pageNum,
      counterText: resumePage.counterText,
    });
  }

  /** Throttle storage writes while scrolling a stack, but always keep the latest page. */
  function rememberPosition(data: PageData): void {
    resumePage = data;
    if (resumeTimer !== undefined) {
      return;
    }
    resumeTimer = window.setTimeout(() => {
      resumeTimer = undefined;
      flushResume();
    }, 750);
  }

  const hideError = (): void => {
    ui.elError.hidden = true;
  };

  const showError = (): void => {
    ui.elErrorText.textContent = `Page ${current.counterText} could not be loaded.`;
    ui.elError.hidden = false;
  };

  const syncNav = (data: PageData): void => {
    ui.elFirst.disabled = data.firstHref === null;
    ui.elPrev.disabled = data.prevHref === null;
    ui.elNext.disabled = data.nextHref === null;
    ui.elLast.disabled = data.lastHref === null;
  };

  /** Reload the visible image, bypassing the browser cache (native `R` / "Reload broken image"). */
  const reloadImage = (): void => {
    if (!activeSurface().reload()) {
      return;
    }
    hideError();
    showToast("Reloading image");
  };

  const goEnd = (direction: "first" | "last"): void => {
    const target = direction === "first" ? current.firstHref : current.lastHref;
    if (target) {
      ctx.navigate(target, { replace: true });
      return;
    }
    showToast(direction === "first" ? "First page" : "Last page");
  };

  const goSingle = (direction: "prev" | "next"): void => {
    const target = direction === "prev" ? current.prevHref : current.nextHref;
    if (target) {
      ctx.navigate(target, { replace: true });
      return;
    }
    showToast(direction === "prev" ? "First page" : "Last page");
  };

  async function goSpread(direction: "prev" | "next"): Promise<void> {
    const token = ++navigationToken;
    if (direction === "next") {
      let trailing = spreadCompanion;
      if (!trailing && current.nextHref) {
        trailing = await loader
          .viewerPage(current.nextHref, {
            priority: priorityOf("facing"),
            signal: ctx.signal,
          })
          .catch(() => null);
      }
      if (token !== navigationToken || ctx.signal.aborted) {
        return;
      }
      const target = trailing ? trailing.nextHref : current.nextHref;
      if (target) {
        ctx.navigate(target, { replace: true });
        return;
      }
      showToast("Last page");
      return;
    }

    const back = current.prevHref
      ? await loader
          .viewerPage(current.prevHref, {
            priority: priorityOf("facing"),
            signal: ctx.signal,
          })
          .catch(() => null)
      : null;
    if (token !== navigationToken || ctx.signal.aborted) {
      return;
    }
    const target = back ? back.prevHref : current.prevHref;
    if (target) {
      ctx.navigate(target, { replace: true });
      return;
    }
    showToast("First page");
  }

  function syncContinuousNav(): void {
    if (!readerLayout(getSettings().readerMode).continuous) {
      return;
    }
    const pages = stack?.pages() ?? [];
    ui.elPrev.disabled = continuousIndex <= 0;
    const state = stack?.state();
    // A failed fetch is retryable, so it must not disable Next or present itself as the end.
    ui.elNext.disabled = (state === undefined || state.done) && continuousIndex >= pages.length - 1;
  }

  function scrollToContinuous(index: number): void {
    const entry = stack?.pages()[index];
    if (!entry) {
      return;
    }
    entry.node.scrollIntoView({ block: "start" });
    continuousIndex = index;
    refreshSurface();
    ui.elCounter.textContent = entry.view.page.counterText;
    ui.elFileInfo.textContent = entry.view.page.fileInfo;
    syncContinuousNav();
    // A page scrolled into a zoomed stack needs its original too, not only the one that zoomed.
    activeSurface().upgrade(zoom.getZoomLevel());
  }

  async function goContinuous(direction: "prev" | "next"): Promise<void> {
    const active = stack;
    if (active === null) {
      return;
    }
    if (direction === "prev") {
      if (continuousIndex <= 0) {
        showToast("First page");
        return;
      }
      scrollToContinuous(continuousIndex - 1);
      return;
    }

    if (continuousIndex >= active.pages().length - 1) {
      const state = active.state();
      if (state.loading) {
        return;
      }
      if (!state.done) {
        const appended = state.failed ? await active.retry() : await active.loadNext();
        if (active !== stack || ctx.signal.aborted) {
          return;
        }
        if (!appended) {
          const after = active.state();
          if (after.failed) {
            showToast("Could not load the next page");
          } else if (after.done) {
            showToast("Last page");
          }
          syncContinuousNav();
          return;
        }
      }
    }

    if (continuousIndex >= active.pages().length - 1) {
      showToast("Last page");
      return;
    }
    scrollToContinuous(continuousIndex + 1);
  }

  const go = (direction: "prev" | "next"): void => {
    const mode = getSettings().readerMode;
    if (mode === "continuous") {
      void goContinuous(direction);
      return;
    }
    if (mode === "spread") {
      void goSpread(direction);
      return;
    }
    goSingle(direction);
  };

  function clearSpread(): void {
    spreadToken += 1;
    spreadCompanion = null;
    companionSlot = null;
    ui.elSpread.hidden = true;
    ui.elSpread.removeAttribute("src");
    setSpreadSingle(false);
    refreshSurface();
  }

  function renderSpread(data: PageData): void {
    clearSpread();
    const token = spreadToken;
    setSpreadSingle(data.nextHref === null);
    if (!readerLayout(getSettings().readerMode).spread || data.nextHref === null) {
      return;
    }

    void loader
      .viewerPage(data.nextHref, {
        priority: priorityOf("facing"),
        signal: ctx.signal,
      })
      .then((companion) => {
        if (
          ctx.signal.aborted ||
          token !== spreadToken ||
          !readerLayout(getSettings().readerMode).spread
        ) {
          return;
        }
        spreadCompanion = companion;
        ui.elSpread.hidden = false;
        setSpreadSingle(false);
        ui.elSpread.alt = `${companion.galleryTitle.primary} — page ${companion.counterText}`;
        companionSlot = createPageImageSlot(ui.elSpread, {
          page: companion,
          retry: (page) => loader.retryWithNl(page),
          maxRetries: getSettings().maxNlRetry,
          signal: ctx.signal,
          isCurrent: () => spreadCompanion === companion,
          onGiveUp: () => {
            ui.elSpread.hidden = true;
            setSpreadSingle(true);
            ui.elNext.disabled = data.nextHref === null;
            refreshSurface();
          },
        });
        companionSlot.show();
        ui.elNext.disabled = companion.nextHref === null;
        refreshSurface();
        // If the pair is already zoomed, the newly visible facing page needs its original too.
        activeSurface().upgrade(zoom.getZoomLevel());
      })
      .catch(() => {
        if (ctx.signal.aborted || token !== spreadToken) {
          return;
        }
        clearSpread();
        setSpreadSingle(true);
        ui.elNext.disabled = data.nextHref === null;
      });
  }

  function continuousPage(data: PageData): {
    node: HTMLElement;
    view: PageImageSlot<HTMLImageElement>;
  } {
    const node = el("div", { class: "reader-page" });
    const img = el("img", {
      class: "reader-page-img",
      alt: `${data.galleryTitle.primary} — page ${data.counterText}`,
      loading: "lazy",
    });
    const retry = el("button", {
      class: "btn btn-small reader-page-retry",
      type: "button",
      text: "Retry",
      style: "position: absolute; z-index: 1;",
    });
    retry.hidden = true;
    node.append(img, retry);
    // Lazy images have no intrinsic height before they load, which makes a fast scroll jump as
    // each page arrives. Reserve the previous page's aspect until this one can measure itself.
    node.style.minHeight = `${Math.round(window.innerWidth * continuousAspect)}px`;

    const slot = createPageImageSlot(img, {
      page: data,
      retry: (page) => loader.retryWithNl(page),
      maxRetries: getSettings().maxNlRetry,
      signal: ctx.signal,
      onGiveUp: () => {
        node.classList.add("is-failed");
        retry.hidden = false;
      },
      onLoaded: () => {
        node.classList.remove("is-failed");
        retry.hidden = true;
        node.style.removeProperty("min-height");
        if (img.naturalWidth > 0) {
          continuousAspect = img.naturalHeight / img.naturalWidth;
        }
      },
    });
    retry.addEventListener("click", () => {
      retry.hidden = true;
      node.classList.remove("is-failed");
      slot.show();
    });
    slot.show();
    return { node, view: slot };
  }

  function teardownContinuous(): void {
    stack?.stop();
    stack = null;
    continuousIndex = 0;
    ui.elContinuous.replaceChildren();
  }

  function startContinuous(data: PageData): void {
    teardownContinuous();
    stack = createContinuousStack<PageData, PageImageSlot<HTMLImageElement>>({
      container: ui.elContinuous,
      initial: data,
      next: data.nextHref,
      key: (page) => page.viewerUrl,
      signal: ctx.signal,
      load: (url, signal) =>
        loader.viewerPage(url, { priority: priorityOf("facing"), signal }).then((page) => ({
          items: [page],
          next: page.nextHref,
        })),
      render: continuousPage,
      onChange: () => syncContinuousNav(),
    });
    continuousIndex = 0;
    refreshSurface();
    syncContinuousNav();
  }

  function syncContinuousCounter(): void {
    const pages = stack?.pages() ?? [];
    if (!readerLayout(getSettings().readerMode).continuous || pages.length === 0) {
      return;
    }
    const midpoint = window.innerHeight / 2;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    pages.forEach((entry, index) => {
      const rect = entry.node.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - midpoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    const previous = continuousIndex;
    continuousIndex = best;
    if (best !== previous) {
      refreshSurface();
    }
    const visible = pages[best];
    if (visible) {
      ui.elCounter.textContent = visible.view.page.counterText;
      ui.elFileInfo.textContent = visible.view.page.fileInfo;
      rememberPosition(visible.view.page);
    }
    syncContinuousNav();
    if (best !== previous) {
      activeSurface().upgrade(zoom.getZoomLevel());
    }
  }

  let counterFrame: number | undefined;
  function onContinuousScroll(): void {
    if (!readerLayout(getSettings().readerMode).continuous || counterFrame !== undefined) {
      return;
    }
    counterFrame = window.requestAnimationFrame(() => {
      counterFrame = undefined;
      syncContinuousCounter();
    });
  }

  function showMain(data: PageData): void {
    mainSlot = createMainSlot(data);
    mainSlot.show();
    refreshSurface();
  }

  /** Show the containers and load the neighbours the selected mode needs. */
  function syncLayout(): void {
    const settings = getSettings();
    const layout = readerLayout(settings.readerMode);
    ui.elWrap.hidden = layout.continuous;
    ui.elContinuous.hidden = !layout.continuous;
    ui.elContinuous.style.setProperty("--reader-gap", `${settings.gap}px`);

    if (layout.continuous) {
      mainSlot = null;
      // The stack renders and loads the current page; the hidden single image must not fetch it
      // a second time.
      ui.elImg.removeAttribute("src");
      startContinuous(current);
      clearSpread();
      syncContinuousCounter();
      return;
    }

    teardownContinuous();
    if (layout.spread) {
      showMain(current);
      syncNav(current);
      renderSpread(current);
    } else {
      showMain(current);
      clearSpread();
      syncNav(current);
    }
  }

  function render(data: PageData): void {
    current = data;
    ui.elTitle.replaceChildren(titleNodes(data.galleryTitle));
    ui.elCounter.textContent = data.counterText;
    ui.elFileInfo.textContent = data.fileInfo;
    ui.elGallery.href = data.galleryHref;
    ui.elOriginal.hidden = data.originalHref === null;
    ui.elOriginal.href = data.originalHref ?? "";
    ui.elForum.hidden = data.forumHref === null;
    ui.elForum.href = data.forumHref ?? "";
    ui.elSearch.hidden = data.searchHref === null;
    ui.elSearch.href = data.searchHref ?? "";
    ui.elImg.alt = `${data.galleryTitle.primary} — page ${data.counterText}`;
    syncNav(data);
    hideError();

    // The layout owns which surface loads the page: the stack's first entry in continuous mode,
    // the main image otherwise, plus the facing page in spread.
    syncLayout();

    if (!getSettings().fitHeight && !readerLayout(getSettings().readerMode).continuous) {
      window.scrollTo(0, 0);
    }
    rememberPosition(data);
    log("rendered", data.counterText);
  }

  let cursorHidden = false;
  applyViewMode({
    viewer: true,
    fitHeight: getSettings().fitHeight,
    cursorHidden,
    readerMode: getSettings().readerMode,
    readingDirection: getSettings().readingDirection,
  });
  render(pageData);
  window.addEventListener("scroll", onContinuousScroll, { passive: true, signal: ctx.signal });

  const off = onSettingsChange((settings) => {
    applyViewMode({
      viewer: true,
      fitHeight: settings.fitHeight,
      cursorHidden,
      readerMode: settings.readerMode,
      readingDirection: settings.readingDirection,
    });
    ui.elContinuous.style.setProperty("--reader-gap", `${settings.gap}px`);
    updateTitleWidth();
    if (settings.readerMode !== activeMode) {
      activeMode = settings.readerMode;
      syncLayout();
    }
    zoom.updateZoom(null, settings.fitHeight);
  });
  ctx.signal.addEventListener("abort", off, { once: true });

  const resizeObserver = new ResizeObserver(updateTitleWidth);
  resizeObserver.observe(document.body);
  resizeObserver.observe(ui.elImg);
  ctx.signal.addEventListener("abort", () => resizeObserver.disconnect(), { once: true });

  let cursorTimer: number | undefined;
  const hideCursor = (): void => {
    if (chromePinned) {
      return;
    }
    cursorHidden = true;
    setCursorHidden(true);
  };
  const showCursor = (): void => {
    cursorHidden = false;
    setCursorHidden(false);
    clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(hideCursor, HIDE_CURSOR_AFTER);
  };
  window.addEventListener("mousemove", showCursor, { signal: ctx.signal });
  window.addEventListener("mousedown", showCursor, { signal: ctx.signal });
  ui.elReader.addEventListener("wheel", showCursor, { passive: true, signal: ctx.signal });
  showCursor();

  // A tap or swipe on touch reveals the chrome the same way a mouse move does.
  ui.elReader.addEventListener("pointerdown", showCursor, { signal: ctx.signal });

  const toggleChrome = (): void => {
    chromePinned = !chromePinned;
    document.body.classList.toggle("hud-pinned", chromePinned);
    if (chromePinned) {
      clearTimeout(cursorTimer);
      cursorHidden = false;
      setCursorHidden(false);
    } else {
      showCursor();
    }
  };
  ctx.signal.addEventListener("abort", () => document.body.classList.remove("hud-pinned"), {
    once: true,
  });

  let suppressClick = false;
  let swipeStart: { x: number; y: number } | null = null;
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { distance: number; zoom: number } | null = null;
  let panPoint: { x: number; y: number } | null = null;

  ui.elReader.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse") {
        return;
      }
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size === 2) {
        // A second touch always ends the swipe candidate, even in modes where pinch is not ours.
        swipeStart = null;
        panPoint = null;
        suppressClick = true;
        const [first, second] = [...activePointers.values()];
        if (
          first !== undefined &&
          second !== undefined &&
          getSettings().fitHeight &&
          getSettings().readerMode !== "continuous"
        ) {
          pinchStart = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            zoom: zoom.getZoomLevel(),
          };
        }
        return;
      }
      // A swipe that the browser did not follow with a click must not swallow the next tap.
      suppressClick = false;
      if (
        zoom.getZoomLevel() > 1 &&
        getSettings().fitHeight &&
        getSettings().readerMode !== "continuous"
      ) {
        // While zoomed, one finger pans instead of swiping to another page.
        swipeStart = null;
        panPoint = { x: event.clientX, y: event.clientY };
      } else {
        swipeStart = { x: event.clientX, y: event.clientY };
      }
    },
    { signal: ctx.signal },
  );
  ui.elReader.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "mouse" || !activePointers.has(event.pointerId)) {
        return;
      }
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchStart === null && panPoint !== null && activePointers.size === 1) {
        const dx = event.clientX - panPoint.x;
        const dy = event.clientY - panPoint.y;
        if (dx !== 0 || dy !== 0) {
          event.preventDefault();
          zoom.panBy(dx, dy);
          panPoint = { x: event.clientX, y: event.clientY };
          suppressClick = true;
        }
        return;
      }
      if (pinchStart === null || activePointers.size < 2) {
        return;
      }
      const [first, second] = [...activePointers.values()];
      if (first === undefined || second === undefined) {
        return;
      }
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (pinchStart.distance <= 0 || distance <= 0) {
        return;
      }
      event.preventDefault();
      zoom.setZoom(pinchStart.zoom * (distance / pinchStart.distance), getSettings().fitHeight);
      suppressClick = true;
    },
    { passive: false, signal: ctx.signal },
  );
  ui.elReader.addEventListener(
    "pointerup",
    (event) => {
      const pinching = pinchStart !== null;
      const panning = panPoint !== null;
      if (event.pointerType !== "mouse") {
        activePointers.delete(event.pointerId);
        if (activePointers.size < 2) {
          pinchStart = null;
        }
        panPoint = null;
      }
      if (pinching || panning) {
        swipeStart = null;
        suppressClick = true;
        return;
      }
      if (swipeStart === null || event.pointerType === "mouse") {
        swipeStart = null;
        return;
      }
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) {
        return;
      }
      const intent = swipeIntent(
        dx,
        SWIPE_MIN,
        getSettings().readerMode,
        getSettings().readingDirection,
      );
      if (intent === null) {
        return;
      }
      suppressClick = true;
      go(intent);
    },
    { signal: ctx.signal },
  );
  ui.elReader.addEventListener(
    "pointercancel",
    (event) => {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) {
        pinchStart = null;
      }
      swipeStart = null;
      panPoint = null;
    },
    { signal: ctx.signal },
  );

  ui.elReader.addEventListener(
    "click",
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("#hud, #page-info, #page-nav, #hud-help, #img-error")
      ) {
        return;
      }
      if (zoom.consumePanned() || suppressClick) {
        suppressClick = false;
        return;
      }
      const ratio = event.clientX / Math.max(1, window.innerWidth);
      const intent = clickIntent(ratio, getSettings().readerMode, getSettings().readingDirection);
      if (intent === "toggle") {
        toggleChrome();
      } else {
        go(intent);
      }
    },
    { signal: ctx.signal },
  );

  ui.elFirst.addEventListener("click", () => goEnd("first"), { signal: ctx.signal });
  ui.elPrev.addEventListener("click", () => go("prev"), { signal: ctx.signal });
  ui.elNext.addEventListener("click", () => go("next"), { signal: ctx.signal });
  ui.elLast.addEventListener("click", () => goEnd("last"), { signal: ctx.signal });
  ui.elForum.addEventListener(
    "click",
    (event) => {
      // Native copies the forum URL instead of opening it.
      if (ui.elForum.href === "" || !("clipboard" in navigator)) {
        return;
      }
      event.preventDefault();
      void navigator.clipboard.writeText(ui.elForum.href).then(
        () => showToast("Forum link copied"),
        () => showToast("Could not copy the forum link"),
      );
    },
    { signal: ctx.signal },
  );

  const returnToGallery = (): void => {
    const state = history.state as { fromGallery?: boolean } | null;
    if (state?.fromGallery === true) {
      // The gallery entry carries the scroll position from before the reader opened, including
      // the infinite-scroll session. Pop it instead of opening the site's paged thumbnail URL.
      history.back();
      return;
    }
    ctx.navigate(ui.elGallery.href);
  };

  ui.elGallery.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      returnToGallery();
    },
    { signal: ctx.signal },
  );

  ui.elErrorRetry.addEventListener(
    "click",
    () => {
      void (async () => {
        hideError();
        const retried = await loader.retryWithNl(current);
        if (ctx.signal.aborted) {
          return;
        }
        if (retried) {
          render(retried);
        } else {
          showError();
        }
      })();
    },
    { signal: ctx.signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toUpperCase();
        if (key === "=" || key === "+") {
          event.preventDefault();
          zoom.updateZoom(0.1, getSettings().fitHeight);
          return;
        }
        if (key === "-" || key === "_") {
          event.preventDefault();
          zoom.updateZoom(-0.1, getSettings().fitHeight);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          zoom.updateZoom(null, getSettings().fitHeight);
          return;
        }
      }

      // Holding a key may scroll or pan; it may not fire a request per repeat.
      const scrollKey = isKey(event, "up") || isKey(event, "down") || event.key === " ";
      if (event.repeat && !scrollKey) {
        return;
      }

      showCursor();

      if (zoom.handleKey(event, getSettings().fitHeight)) {
        return;
      }

      if (isKey(event, "fit")) {
        updateSetting("fitHeight", !getSettings().fitHeight);
      } else if (event.key === "?") {
        setHelp(ui.elHelp.hasAttribute("hidden"));
      } else if (isKey(event, "gallery") || event.key === "Escape") {
        // Escape dismisses the shortcut panel first; a second press leaves the reader.
        if (!ui.elHelp.hasAttribute("hidden")) {
          setHelp(false);
          return;
        }
        returnToGallery();
      } else if (event.key === " ") {
        // Native Space/Shift+Space: scroll most of a screen, then step at the edge.
        event.preventDefault();
        const step = Math.round(window.innerHeight * 0.75);
        if (event.shiftKey) {
          if (window.scrollY <= 0) {
            go("prev");
          } else {
            window.scrollBy(0, -step);
          }
        } else if (
          window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2
        ) {
          go("next");
        } else {
          window.scrollBy(0, step);
        }
      } else if (event.key === "r" || event.key === "R") {
        reloadImage();
      } else if (isKey(event, "up")) {
        if (!getSettings().fitHeight || getSettings().readerMode === "continuous") {
          event.preventDefault();
          window.scrollBy(0, -getSettings().scrollStep);
        }
      } else if (isKey(event, "down")) {
        if (!getSettings().fitHeight || getSettings().readerMode === "continuous") {
          event.preventDefault();
          window.scrollBy(0, getSettings().scrollStep);
        }
      } else if (isKey(event, "next")) {
        event.preventDefault();
        go("next");
      } else if (isKey(event, "prev")) {
        event.preventDefault();
        go("prev");
      }
    },
    { signal: ctx.signal },
  );

  ctx.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(cursorTimer);
      if (resumeTimer !== undefined) {
        window.clearTimeout(resumeTimer);
        resumeTimer = undefined;
      }
      flushResume();
      prefetcher.cancel();
      resizeObserver.disconnect();
      teardownContinuous();
      if (counterFrame !== undefined) {
        window.cancelAnimationFrame(counterFrame);
      }
      // The mount lifecycle resets view mode right after aborting this view.
      ui.elImg.removeAttribute("src");
      ui.elSpread.removeAttribute("src");
    },
    { once: true },
  );

  prefetcher.warm(pageData);
}
