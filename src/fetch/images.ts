import { log, warn } from "../log";
import { getSettings, onSettingsChange } from "../settings";
import { createLru } from "./lru";

let preloadContainer: HTMLDivElement | null = null;

function ensurePreloadContainer(): HTMLDivElement {
  if (preloadContainer) {
    return preloadContainer;
  }
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.width = "1px";
  container.style.height = "1px";
  container.style.overflow = "hidden";
  container.style.opacity = "0";
  container.style.pointerEvents = "none";
  preloadContainer = container;
  document.body.append(preloadContainer);
  return preloadContainer;
}

/** Warm images kept in the DOM; the oldest is dropped from the DOM when the cache is full. */
const imgCache = createLru<string, HTMLImageElement>(getSettings().imgCacheLimit, (img, src) => {
  img.remove();
  log("evicted preload", src);
});

// A smaller cache limit drops the oldest preloaded images immediately; a larger one leaves the
// current entries in place and applies to later inserts.
onSettingsChange((settings) => {
  imgCache.setLimit(settings.imgCacheLimit);
});

/** Move an already-preloaded image to the newest end; a missing source is left alone. */
export function touchImage(src: string): void {
  imgCache.get(src);
}

/** Start loading an image into the hidden preload container, or return the cached one. */
export function preloadImage(src: string): HTMLImageElement {
  const cached = imgCache.get(src);
  if (cached) {
    return cached;
  }

  const container = ensurePreloadContainer();
  const img = document.createElement("img");
  // A speculative page must never compete with the image the reader is looking at.
  img.setAttribute("fetchpriority", "low");
  img.decoding = "async";
  img.onload = () => {
    void img.decode().then(
      () => log("preload + decode done", src),
      (error) => warn("preload decode failed", src, error),
    );
  };
  img.onerror = () => {
    // A broken image must not hold a slot: it can never satisfy a later `preloadImage` call.
    imgCache.delete(src);
    img.remove();
    warn("preload error", src);
  };
  img.src = src;
  container.append(img);
  imgCache.set(src, img);
  log("preloading", src);
  return img;
}
