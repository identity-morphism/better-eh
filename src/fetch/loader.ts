import { log, warn } from "../log";
import { isHtmlResponse, isLoginPage, isRateLimitText } from "../net/http";
import type { Priority } from "../net/priority";
import { priorityOf } from "../net/priority";
import { net } from "../net/queue";
import { parseViewer } from "../parse/viewer";
import type { PageData } from "../types";
import { HttpError, LoginRequiredError, RateLimitedError } from "./errors";
import { createLru } from "./lru";

const DOC_CACHE_LIMIT = 24;
const PAGE_CACHE_LIMIT = 40;

export interface HtmlResponse {
  doc: Document;
  url: string;
}

export interface DocumentOptions {
  fresh?: boolean;
  priority?: Priority;
  signal?: AbortSignal;
  tag?: string;
}

export interface ViewerPageOptions {
  /** Abandon the wait only: a page already being fetched still lands in the cache. */
  signal?: AbortSignal;
  priority?: Priority;
  /** Queue tag, so prefetch traffic is recognisable; defaults to "viewer". */
  tag?: string;
  /**
   * Let `signal` abort the transport too, unless an ordinary caller has joined the load. Only
   * prefetch sets this: a navigation that shares the request always wins over the warm.
   */
  cancel?: boolean;
}

interface TransportOptions {
  priority?: Priority;
  tag?: string;
  signal?: AbortSignal;
}

type Transport = (url: string, options: TransportOptions) => Promise<Response>;

interface PageLoaderDeps {
  request: Transport;
  parseHtml: (text: string) => Document;
  /** Stop queued work when the site throttles us. */
  purgeQueue: () => void;
}

/** The one interface for loading a page's HTML or parsed viewer data. */
export interface PageLoader {
  /** Fetch and parse an HTML page, reusing cached documents unless `fresh`. */
  document(url: string, options?: DocumentOptions): Promise<HtmlResponse>;
  /**
   * Fetch and parse one viewer page, keyed by both requested and final URL.
   *
   * Concurrent callers share one request, so a prefetch and the navigation that lands on it open
   * the page once.
   */
  viewerPage(url: string, options?: ViewerPageOptions): Promise<PageData>;
  /** Cache already-parsed viewer data, as the shell does after the initial render. */
  seedViewerPage(url: string, data: PageData): void;
  /** Re-fetch a viewer page with its no-limit token; null when it has none or fails. */
  retryWithNl(page: PageData): Promise<PageData | null>;
}

/** Normalise an abort reason to an Error, so `transition` can recognise a cancelled load. */
function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
}

/** Throw away the wait, not the work, when the caller's navigation is superseded. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal.reason));
    const settle = (): void => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) {
      reject(abortError(signal.reason));
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    // Subscribed even after an abort, so the shared load never rejects unobserved.
    void promise.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: Error) => {
        settle();
        reject(error);
      },
    );
  });
}

/** One shared viewer load: a prefetch may own it, and a navigation may join it. */
interface InFlightPage {
  promise: Promise<PageData>;
  controller: AbortController;
  /** An ordinary caller joined, so cancelling the warm must not abort the shared transport. */
  protected: boolean;
  detach: () => void;
}

/** Build a loader around a transport and an HTML parser, with its caches and typed failures. */
export function createPageLoader(deps: PageLoaderDeps): PageLoader {
  const documents = createLru<string, HtmlResponse>(DOC_CACHE_LIMIT);
  const pages = createLru<string, PageData>(PAGE_CACHE_LIMIT);
  // One request per URL: a navigation that lands on a page the prefetcher already asked for
  // joins that request instead of opening the page a second time.
  const inFlight = new Map<string, InFlightPage>();

  function cachePage(data: PageData, requestedUrl: string): PageData {
    pages.set(data.viewerUrl, data);
    if (requestedUrl !== data.viewerUrl) {
      pages.set(requestedUrl, data);
    }
    log("cached viewer", data.viewerUrl, "| img:", data.imgSrc, "| nl:", data.nlToken);
    return data;
  }

  async function loadDocument(url: string, options: DocumentOptions = {}): Promise<HtmlResponse> {
    if (!options.fresh) {
      const cached = documents.get(url);
      if (cached) {
        log("html cache hit", url);
        return cached;
      }
    }

    const response = await deps.request(url, {
      priority: options.priority ?? priorityOf("navigation"),
      tag: options.tag ?? "html",
      signal: options.signal,
    });

    const finalUrl = response.url || url;
    const text = await response.text();

    // The site sometimes answers a throttle with 509/429 and the notice in the body. Read the body
    // before turning the status into a generic HttpError, or the notice is lost and the queued
    // prefetches keep hitting the throttle.
    if (!response.ok || !isHtmlResponse(response, text)) {
      if (isRateLimitText(text)) {
        deps.purgeQueue();
        throw new RateLimitedError(text);
      }
      if (!response.ok) {
        throw new HttpError(response.status, finalUrl);
      }
      throw new Error(text.slice(0, 300) || `Unexpected response from ${finalUrl}`);
    }

    const doc = deps.parseHtml(text);

    if (isLoginPage(doc)) {
      throw new LoginRequiredError();
    }

    const result: HtmlResponse = { doc, url: finalUrl };
    documents.set(url, result);
    if (finalUrl !== url) {
      documents.set(finalUrl, result);
    }
    return result;
  }

  function fetchViewerPage(
    url: string,
    priority: Priority,
    tag: string,
    cancelSignal?: AbortSignal,
  ): InFlightPage {
    log("fetching viewer →", url);
    const controller = new AbortController();
    const shared = (async () => {
      const { doc, url: finalUrl } = await loadDocument(url, {
        priority,
        tag,
        signal: controller.signal,
      });
      return cachePage(parseViewer(doc, finalUrl), url);
    })();

    const entry: InFlightPage = {
      promise: shared,
      controller,
      // A load nobody asked to own (a normal navigation) is never cancelled by someone else.
      protected: cancelSignal === undefined,
      detach: () => undefined,
    };

    const onAbort = (): void => {
      // A navigation joined this warm: its request must finish and cache, even if the prefetch
      // that started it has moved on.
      if (!entry.protected) {
        controller.abort(cancelSignal?.reason);
      }
    };
    if (cancelSignal !== undefined) {
      if (cancelSignal.aborted) {
        onAbort();
      } else {
        cancelSignal.addEventListener("abort", onAbort, { once: true });
        entry.detach = () => cancelSignal.removeEventListener("abort", onAbort);
      }
    }

    // A failed load must not leave its rejection behind for the next caller.
    const tracked = shared.finally(() => {
      entry.detach();
      if (inFlight.get(url) === entry) {
        inFlight.delete(url);
      }
    });
    entry.promise = tracked;
    inFlight.set(url, entry);
    return entry;
  }

  return {
    document: loadDocument,

    async viewerPage(url, options = {}) {
      const cached = pages.get(url);
      if (cached) {
        log("viewer cache hit", url);
        return cached;
      }

      let entry = inFlight.get(url);
      if (entry) {
        log("joining viewer fetch →", url);
        if (options.cancel !== true) {
          // The navigation now owns the outcome; cancelling the prefetch must not abort it.
          entry.protected = true;
        }
      } else {
        entry = fetchViewerPage(
          url,
          options.priority ?? priorityOf("facing"),
          options.tag ?? "viewer",
          options.cancel === true ? options.signal : undefined,
        );
      }
      return waitFor(entry.promise, options.signal);
    },

    seedViewerPage(url, data) {
      cachePage(data, url);
    },

    async retryWithNl(page) {
      if (!page.nlToken) {
        return null;
      }
      const retryUrl = `${page.viewerUrl.split("?")[0]}?nl=${page.nlToken}`;
      log("nl retry →", retryUrl);
      try {
        const { doc } = await loadDocument(retryUrl, {
          fresh: true,
          priority: priorityOf("critical"),
          tag: "viewer",
        });
        return cachePage(parseViewer(doc, page.viewerUrl), page.viewerUrl);
      } catch (error) {
        warn("nl retry fetch failed", error);
        return null;
      }
    },
  };
}

/** Production loader: queued transport, browser parser, shared queue purge. */
export const loader: PageLoader = createPageLoader({
  request: (url, options) => net.fetch(url, options),
  parseHtml: (text) => new DOMParser().parseFromString(text, "text/html"),
  purgeQueue: () => {
    net.purge((task) => task.tag !== "critical");
  },
});
