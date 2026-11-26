import { saveResume } from "../data/resume";
import { preloadImage, touchImage } from "../fetch/images";
import { loader } from "../fetch/loader";
import { createPrefetcher } from "../fetch/prefetch";
import { isKey } from "../keymap";
import { log } from "../log";
import { shouldSaveData } from "../net/connection";
import { net } from "../net/queue";
import type { ReaderHudState } from "../reader-navigation";
import { createReaderNavigation } from "../reader-navigation";
import { nativeUrl } from "../routes/identity";
import { getSettings, onSettingsChange, updateSetting } from "../settings";
import shellHtml from "../shell.html" with { type: "text" };
import type { PageData } from "../types";
import { icon, isEditableTarget } from "../ui/dom";
import { titleNodes } from "../ui/title";
import { showToast } from "../ui/toast";
import { applyViewMode, setCursorHidden } from "../view-mode";
import { ZoomController } from "../zoom";
import type { ViewContext } from "./context";
import { requireShell } from "./shell";

const HIDE_CURSOR_AFTER = 3000;
const SWIPE_MIN = 50;

/** The last HUD payload written to the DOM, so identical frames cost no writes. */
interface WrittenHud {
  page: PageData;
  first: boolean;
  prev: boolean;
  next: boolean;
  last: boolean;
}

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
    elSlideshow: requireShell("hud-slideshow"),
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
    elErrorNative: requireShell("img-error-native"),
  };
  // The shell ships empty containers; the icons come from the shared set, not text glyphs.
  ui.elGallery.append(icon("back"));
  ui.elSlideshow.append(icon("play", true));
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
    retryWithNl: (page, options) => loader.retryWithNl(page, options),
    activeCount: () => net.activeCount,
    concurrency: () => getSettings().netConcurrency,
    depth: () => getSettings().prefetchCount,
    saveData: () => shouldSaveData(getSettings().dataSaver),
    clock: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
    },
  });

  const setHelp = (open: boolean): void => {
    ui.elHelp.hidden = !open;
  };

  let chromePinned = false;
  let activeMode = getSettings().readerMode;
  let resumeTimer: number | undefined;
  let resumePage: PageData | null = null;
  let hudPage: PageData | null = null;
  let hudWritten: WrittenHud | null = null;

  const flushResume = (): void => {
    if (resumePage === null) {
      return;
    }
    saveResume(resumePage.galleryHref, {
      pageUrl: resumePage.viewerUrl,
      pageNum: resumePage.pageNum,
      counterText: resumePage.counterText,
    });
  };

  /** Throttle storage writes while scrolling a stack, but always keep the latest page. */
  const rememberPosition = (data: PageData): void => {
    resumePage = data;
    if (resumeTimer !== undefined) {
      return;
    }
    resumeTimer = window.setTimeout(() => {
      resumeTimer = undefined;
      flushResume();
    }, 750);
  };

  const hideError = (): void => {
    ui.elError.hidden = true;
  };

  const showError = (page: PageData): void => {
    ui.elErrorText.textContent = `Page ${page.counterText} could not be loaded.`;
    // Retry cannot help when the page carries no `nl` token, so the native view is the way out.
    ui.elErrorNative.href = nativeUrl(page.viewerUrl);
    ui.elErrorNative.textContent = "Open native page";
    ui.elError.hidden = false;
  };

  const navigation = createReaderNavigation({
    signal: ctx.signal,
    navigate: ctx.navigate,
    toast: showToast,
    mainImage: ui.elImg,
    spreadImage: ui.elSpread,
    spreadWrap: ui.elWrap,
    continuousContainer: ui.elContinuous,
    onHud: (state: ReaderHudState) => {
      const previous = hudWritten;
      if (
        previous !== null &&
        previous.page === state.page &&
        previous.first === state.first &&
        previous.prev === state.prev &&
        previous.next === state.next &&
        previous.last === state.last
      ) {
        return;
      }
      if (previous?.page !== state.page) {
        ui.elCounter.textContent = state.page.counterText;
        ui.elFileInfo.textContent = state.page.fileInfo;
      }
      if (previous?.first !== state.first) {
        ui.elFirst.disabled = !state.first;
      }
      if (previous?.prev !== state.prev) {
        ui.elPrev.disabled = !state.prev;
      }
      if (previous?.next !== state.next) {
        ui.elNext.disabled = !state.next;
      }
      if (previous?.last !== state.last) {
        ui.elLast.disabled = !state.last;
      }
      hudWritten = {
        page: state.page,
        first: state.first,
        prev: state.prev,
        next: state.next,
        last: state.last,
      };
      if (state.page !== hudPage) {
        hudPage = state.page;
        rememberPosition(state.page);
      }
    },
    onSurfaceChange: () => {
      zoom.syncSurface();
    },
    onImageLoaded: (page) => {
      hideError();
      log("image displayed", page.imgSrc);
    },
    onImageError: showError,
    zoomLevel: () => zoom.getZoomLevel(),
  });

  const zoom = new ZoomController(
    ui.elReader,
    () => navigation.surface().element,
    () => getSettings().fitHeight,
    ctx.signal,
    (level) => navigation.upgrade(level),
  );

  const updateTitleWidth = (): void => {
    const viewportWidth = window.innerWidth;
    const maxWidth = getSettings().fitHeight
      ? Math.max(220, (viewportWidth - ui.elImg.clientWidth) / 2 - 30)
      : Math.min(760, viewportWidth * 0.62);
    ui.elTitle.style.maxWidth = `${maxWidth}px`;
  };

  /** Reload the visible image, bypassing the browser cache (native `R` / "Reload broken image"). */
  const reloadImage = (): void => {
    if (!navigation.reload()) {
      return;
    }
    hideError();
    showToast("Reloading image");
  };

  /**
   * Refetch the page through the site's `nl` token, the way its own "Reload broken image" works.
   * When there is no token (or the refetch fails), show the image again instead of leaving the
   * error panel's Retry button inert; the image's own ladder reports a second failure.
   */
  const retryPage = (): void => {
    const page = navigation.currentPage();
    void (async () => {
      hideError();
      const retried = await loader.retryWithNl(page, { signal: ctx.signal });
      if (ctx.signal.aborted) {
        return;
      }
      if (retried) {
        render(retried);
        return;
      }
      navigation.retryMain();
    })();
  };

  const go = (direction: "prev" | "next"): void => {
    restartSlideshow();
    navigation.go(direction);
  };

  const goEnd = (direction: "first" | "last"): void => {
    restartSlideshow();
    navigation.goEnd(direction);
  };

  let slideshowActive = false;
  let slideshowTimer: number | null = null;

  function paintSlideshow(): void {
    const label = slideshowActive ? "Pause slideshow" : "Start slideshow";
    ui.elSlideshow.replaceChildren(icon(slideshowActive ? "pause" : "play", true));
    ui.elSlideshow.setAttribute("aria-label", label);
    ui.elSlideshow.setAttribute("aria-pressed", String(slideshowActive));
    ui.elSlideshow.title = label;
  }

  function scheduleSlideshow(): void {
    if (slideshowTimer !== null) {
      window.clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    if (!slideshowActive) {
      return;
    }
    const seconds = getSettings().slideshowSeconds;
    if (seconds <= 0) {
      stopSlideshow("Slideshow stopped");
      return;
    }
    slideshowTimer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      const current = navigation.currentPage();
      if (current.nextHref === null) {
        stopSlideshow("Last page");
        return;
      }
      go("next");
    }, seconds * 1000);
  }

  function restartSlideshow(): void {
    if (slideshowActive) {
      scheduleSlideshow();
    }
  }

  function stopSlideshow(message?: string): void {
    slideshowActive = false;
    if (slideshowTimer !== null) {
      window.clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    paintSlideshow();
    if (message !== undefined) {
      showToast(message);
    }
  }

  ui.elSlideshow.addEventListener(
    "click",
    () => {
      if (slideshowActive) {
        stopSlideshow();
        return;
      }
      if (getSettings().slideshowSeconds <= 0) {
        showToast("Set a slideshow interval in Settings");
        return;
      }
      const current = navigation.currentPage();
      if (current.nextHref === null) {
        showToast("Last page");
        return;
      }
      slideshowActive = true;
      paintSlideshow();
      scheduleSlideshow();
    },
    { signal: ctx.signal },
  );

  const stopOnSettings = onSettingsChange(() => {
    if (!slideshowActive) {
      return;
    }
    if (getSettings().slideshowSeconds <= 0) {
      stopSlideshow("Slideshow stopped");
    } else {
      restartSlideshow();
    }
  });
  ctx.signal.addEventListener("abort", stopOnSettings, { once: true });
  ctx.signal.addEventListener("abort", () => stopSlideshow(), { once: true });

  function render(data: PageData): void {
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
    if (data.nextHref === null && slideshowActive) {
      stopSlideshow("Last page");
    }
    ui.elImg.alt = `${data.galleryTitle.primary} — page ${data.counterText}`;
    hideError();

    // The active adapter owns which surface loads the page: the main image, the spread pair, or
    // the stack's first entry.
    navigation.show(data);

    if (!getSettings().fitHeight && !navigation.continuous) {
      window.scrollTo(0, 0);
    }
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
  ui.elContinuous.style.setProperty("--reader-gap", `${getSettings().gap}px`);
  render(pageData);
  window.addEventListener("scroll", () => navigation.handleScroll(), {
    passive: true,
    signal: ctx.signal,
  });

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
      navigation.setMode(settings.readerMode);
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
          !navigation.continuous
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
      if (zoom.getZoomLevel() > 1 && getSettings().fitHeight && !navigation.continuous) {
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
      const intent = navigation.swipeIntent(dx, SWIPE_MIN, getSettings().readingDirection);
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
        event.target.closest(
          "#hud, #page-info, #page-nav, #hud-help, #img-error, button, a, input, select, textarea, label",
        )
      ) {
        return;
      }
      if (zoom.consumePanned() || suppressClick) {
        suppressClick = false;
        return;
      }
      const ratio = event.clientX / Math.max(1, window.innerWidth);
      const intent = navigation.clickIntent(ratio, getSettings().readingDirection);
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

  ui.elErrorRetry.addEventListener("click", retryPage, { signal: ctx.signal });

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
      } else if (isKey(event, "help")) {
        setHelp(ui.elHelp.hasAttribute("hidden"));
      } else if (isKey(event, "gallery")) {
        // Escape dismisses the shortcut panel first; a second press leaves the reader.
        if (!ui.elHelp.hasAttribute("hidden")) {
          setHelp(false);
          return;
        }
        returnToGallery();
      } else if (isKey(event, "first")) {
        event.preventDefault();
        goEnd("first");
      } else if (isKey(event, "last")) {
        event.preventDefault();
        goEnd("last");
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
      } else if (isKey(event, "reload")) {
        reloadImage();
      } else if (isKey(event, "up")) {
        if (!getSettings().fitHeight || navigation.continuous) {
          event.preventDefault();
          window.scrollBy(0, -getSettings().scrollStep);
        }
      } else if (isKey(event, "down")) {
        if (!getSettings().fitHeight || navigation.continuous) {
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
      navigation.stop();
      ui.elImg.removeAttribute("src");
      ui.elSpread.removeAttribute("src");
    },
    { once: true },
  );

  prefetcher.warm(pageData);
}
