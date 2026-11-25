import { afterEach, describe, expect, test } from "bun:test";

import { RateLimitedError } from "../../src/fetch/errors";
import type { RetryWithNlOptions, ViewerPageOptions } from "../../src/fetch/loader";
import type { Prefetcher, PrefetcherClock, PreloadedImage } from "../../src/fetch/prefetch";
import { createPrefetcher, PREFETCH_IDLE_MS } from "../../src/fetch/prefetch";
import { priorityOf } from "../../src/net/priority";
import type { PageData } from "../../src/types";
import { flushMicrotasks } from "../ui/async";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface ViewerCall {
  url: string;
  priority: number;
  tag: string;
  cancel: boolean;
  signal: AbortSignal | undefined;
}

/** A deterministic clock: `advance` runs every timer that became due, in order. */
class FakeClock implements PrefetcherClock {
  private nextHandle = 0;
  private current = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = ++this.nextHandle;
    this.timers.set(handle, { at: this.current + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advance(ms: number): void {
    this.current += ms;
    for (;;) {
      let dueHandle: number | undefined;
      let dueAt = Number.POSITIVE_INFINITY;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= this.current && timer.at < dueAt) {
          dueAt = timer.at;
          dueHandle = handle;
        }
      }
      if (dueHandle === undefined) {
        return;
      }
      const due = this.timers.get(dueHandle);
      this.timers.delete(dueHandle);
      due?.callback();
    }
  }

  get pending(): number {
    return this.timers.size;
  }
}

class FakeImage implements PreloadedImage {
  readonly src: string;
  private listeners: (() => void)[] = [];

  constructor(src: string) {
    this.src = src;
  }

  addEventListener(_type: "error", listener: () => void, _options?: { once?: boolean }): void {
    this.listeners.push(listener);
  }

  fire(): void {
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) {
      listener();
    }
  }
}

interface ImageSink {
  readonly preloaded: FakeImage[];
  readonly touched: string[];
  preloadImage(src: string): FakeImage;
  touchImage(src: string): void;
}

function imageSink(): ImageSink {
  const preloaded: FakeImage[] = [];
  const touched: string[] = [];
  return {
    preloaded,
    touched,
    preloadImage: (src) => {
      const image = new FakeImage(src);
      preloaded.push(image);
      return image;
    },
    touchImage: (src) => {
      touched.push(src);
    },
  };
}

/** A synthetic viewer chain with recorded starts and controllable gates/failures. */
class FakePages {
  readonly calls: ViewerCall[] = [];
  readonly started: string[] = [];
  private readonly name: string;
  private readonly total: number;
  private readonly gallery: number;
  private readonly gates = new Map<number, Deferred<PageData>>();
  private readonly failures = new Map<number, Error>();
  private active = 0;
  private highest = 0;

  get inFlight(): number {
    return this.active;
  }

  get maxInFlight(): number {
    return this.highest;
  }

  constructor(name: string, total: number) {
    this.name = name;
    this.total = total;
    this.gallery = 1000 + name.length;
  }

  urls(index: number): string {
    return `https://e.test/${this.name}/s/hash/${this.gallery}-${index}`;
  }

  image(index: number): string {
    return `https://img.test/${this.name}/${index}.jpg`;
  }

  index(url: string): number {
    const match = url.match(/-(\d+)(?:\?|$)/);
    return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  }

  page(index: number, imgSrc = this.image(index)): PageData {
    return {
      viewerUrl: this.urls(index),
      pageNum: index,
      counterText: `${index} / ${this.total}`,
      galleryTitle: { leading: [], primary: "Warm Title", secondary: null, trailing: [] },
      imgSrc,
      originalHref: null,
      nextHref: index < this.total ? this.urls(index + 1) : null,
      prevHref: index > 1 ? this.urls(index - 1) : null,
      fileInfo: "",
      galleryHref: `https://e.test/g/${this.gallery}/abc/`,
      nlToken: null,
      firstHref: null,
      lastHref: null,
      forumHref: null,
      searchHref: null,
    };
  }

  viewerPage = (url: string, options: ViewerPageOptions): Promise<PageData> => {
    this.calls.push({
      url,
      priority: options.priority ?? -1,
      tag: options.tag ?? "",
      cancel: options.cancel === true,
      signal: options.signal,
    });
    this.started.push(url);

    this.active += 1;
    this.highest = Math.max(this.highest, this.active);
    const settle = (): void => {
      this.active -= 1;
    };

    const index = this.index(url);
    const failure = this.failures.get(index);
    if (failure !== undefined) {
      return Promise.reject(failure).finally(settle);
    }

    const held = this.gates.get(index);
    if (held === undefined) {
      return Promise.resolve(this.page(index)).finally(settle);
    }

    const { promise, resolve, reject } = Promise.withResolvers<PageData>();
    const signal = options.signal;
    const onAbort = (): void => {
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return promise.finally(settle);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    held.promise.then(
      (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    return promise.finally(settle);
  };

  gate(index: number): void {
    this.gates.set(index, Promise.withResolvers<PageData>());
  }

  release(index: number): void {
    const held = this.gates.get(index);
    if (held === undefined) {
      return;
    }
    this.gates.delete(index);
    held.resolve(this.page(index));
  }

  releaseAll(): void {
    for (const [index, held] of this.gates) {
      held.resolve(this.page(index));
    }
    this.gates.clear();
  }

  fail(index: number, error: Error): void {
    this.failures.set(index, error);
  }
}

interface Controls {
  activeCount: number;
  concurrency: number;
  depth: number;
  retryResult: PageData | null;
}

interface Rig {
  readonly pages: FakePages;
  readonly clock: FakeClock;
  readonly images: ImageSink;
  readonly controls: Controls;
  readonly retries: PageData[];
  readonly retryOptions: (RetryWithNlOptions | undefined)[];
  readonly prefetcher: Prefetcher;
}

const rigs: Rig[] = [];

/** One prefetcher wired only to fakes; no global fetch, loader, queue or parser is involved. */
function createRig(name: string, total: number, depth = 1): Rig {
  const pages = new FakePages(name, total);
  const clock = new FakeClock();
  const images = imageSink();
  const retries: PageData[] = [];
  const retryOptions: (RetryWithNlOptions | undefined)[] = [];
  const controls: Controls = {
    activeCount: 0,
    concurrency: 2,
    depth,
    retryResult: null,
  };

  const prefetcher = createPrefetcher({
    viewerPage: pages.viewerPage,
    preloadImage: (src) => images.preloadImage(src),
    touchImage: (src) => images.touchImage(src),
    retryWithNl: (page, options) => {
      retries.push(page);
      retryOptions.push(options);
      return Promise.resolve(controls.retryResult);
    },
    activeCount: () => controls.activeCount,
    concurrency: () => controls.concurrency,
    depth: () => controls.depth,
    clock,
  });

  const rig: Rig = { pages, clock, images, controls, retries, retryOptions, prefetcher };
  rigs.push(rig);
  return rig;
}

function startedIndices(pages: FakePages): number[] {
  return pages.started.map((url) => pages.index(url));
}

afterEach(() => {
  for (const rig of rigs) {
    rig.prefetcher.cancel();
    rig.pages.releaseAll();
  }
  rigs.length = 0;
});

describe("prefetch scheduling", () => {
  test("idle debounce issues nothing before the delay and warms after it", async () => {
    const rig = createRig("debounce", 5, 1);

    rig.prefetcher.warm(rig.pages.page(3));
    expect(rig.pages.calls).toEqual([]);
    expect(rig.clock.pending).toBe(1);

    rig.clock.advance(PREFETCH_IDLE_MS - 1);
    expect(rig.pages.calls).toEqual([]);

    rig.clock.advance(1);
    await flushMicrotasks(500);

    const started = startedIndices(rig.pages);
    expect(started.filter((page) => page > 3)).toEqual([4]);
    expect(started.filter((page) => page < 3)).toEqual([2]);
    expect(started.sort((a, b) => a - b)).toEqual([2, 4]);
    expect(rig.pages.maxInFlight).toBe(1);
    expect(rig.pages.calls[0]).toMatchObject({
      priority: priorityOf("prefetch"),
      tag: "prefetch",
      cancel: true,
    });
    expect(rig.pages.calls[0]?.signal?.aborted).toBe(false);
    expect(rig.images.preloaded.map((image) => image.src).sort()).toEqual([
      rig.pages.image(2),
      rig.pages.image(4),
    ]);
  });

  test("a burst of navigation warms only the page it settles on", async () => {
    const rig = createRig("burst", 6, 1);

    for (const page of [1, 2, 3, 4, 5]) {
      rig.prefetcher.warm(rig.pages.page(page));
    }
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(rig.pages).sort()).toEqual([4, 6]);
    expect(rig.pages.calls).toHaveLength(2);
  });

  test("depth 0 warms nothing at all", async () => {
    const rig = createRig("zero", 6, 0);

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(300);
    await flushMicrotasks(500);

    expect(rig.pages.calls).toEqual([]);
    expect(rig.pages.started).toEqual([]);
    expect(rig.images.preloaded).toEqual([]);
    expect(rig.clock.pending).toBe(0);
  });

  test("each direction walks nearest-first and stops at the ends", async () => {
    const forward = createRig("ends", 6, 10);

    forward.prefetcher.warm(forward.pages.page(1));
    forward.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(forward.pages)).toEqual([2, 3, 4, 5, 6]);
    expect(forward.images.preloaded.map((image) => image.src).sort()).toEqual(
      [2, 3, 4, 5, 6].map((page) => forward.pages.image(page)),
    );

    const backward = createRig("ends-back", 6, 10);

    backward.prefetcher.warm(backward.pages.page(6));
    backward.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(backward.pages)).toEqual([5, 4, 3, 2, 1]);
    expect(backward.images.preloaded.map((image) => image.src).sort()).toEqual(
      [1, 2, 3, 4, 5].map((page) => backward.pages.image(page)),
    );
  });

  test("one request at a time: the backward walk waits for the forward request", async () => {
    const rig = createRig("serial", 6, 2);
    rig.pages.gate(4);

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(rig.pages)).toEqual([4]);
    expect(rig.pages.inFlight).toBe(1);
    await flushMicrotasks(500);
    expect(startedIndices(rig.pages)).toEqual([4]);

    rig.pages.release(4);
    await flushMicrotasks(500);

    // The chain releases the queued walks only after page 4 settles. Both directions then finish
    // in their own nearest-first order without ever overlapping.
    const started = startedIndices(rig.pages);
    expect(started.filter((page) => page >= 4)).toEqual([4, 5]);
    expect(started.filter((page) => page <= 2)).toEqual([2, 1]);
    expect(started.sort((a, b) => a - b)).toEqual([1, 2, 4, 5]);
    expect(rig.pages.maxInFlight).toBe(1);
  });

  test("a warm leaves one queue slot free", async () => {
    const rig = createRig("reserve", 6, 1);
    rig.controls.activeCount = rig.controls.concurrency - 1;

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);
    expect(rig.pages.calls).toEqual([]);

    rig.controls.activeCount = 0;
    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(rig.pages.calls.length).toBeGreaterThan(0);
  });

  test("cancel aborts its own signal and stops the chain", async () => {
    const rig = createRig("cancel", 6, 2);
    rig.pages.gate(2);

    rig.prefetcher.warm(rig.pages.page(1));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(rig.pages)).toEqual([2]);
    expect(rig.pages.inFlight).toBe(1);
    const call = rig.pages.calls[0];

    rig.prefetcher.cancel();
    expect(call?.signal?.aborted).toBe(true);
    await flushMicrotasks(500);

    expect(startedIndices(rig.pages)).toEqual([2]);
    expect(rig.images.preloaded).toEqual([]);

    rig.pages.release(2);
    await flushMicrotasks(500);
    expect(startedIndices(rig.pages)).toEqual([2]);
  });

  test("a throttle stops both directions instead of finishing the depth", async () => {
    const rig = createRig("limit", 10, 2);
    rig.pages.fail(4, new RateLimitedError("slow down"));

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(startedIndices(rig.pages)).toEqual([4]);
    expect(rig.images.preloaded).toEqual([]);
    expect(rig.clock.pending).toBe(0);
  });

  test("a failed warmed image retries once through the no-limit path", async () => {
    const rig = createRig("nl", 6, 1);

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    const original = rig.pages.image(4);
    const failed = rig.images.preloaded.find((image) => image.src === original);
    if (failed === undefined) {
      throw new Error("the warmed image was never preloaded");
    }

    const fixed = "https://img.test/nl/fixed.jpg";
    rig.controls.retryResult = { ...rig.pages.page(4), imgSrc: fixed };
    failed.fire();
    await flushMicrotasks(500);

    expect(rig.retries).toHaveLength(1);
    expect(rig.retries[0]?.imgSrc).toBe(original);
    expect(rig.retryOptions[0]).toMatchObject({ priority: priorityOf("prefetch") });
    expect(rig.images.preloaded.map((image) => image.src)).toContain(fixed);
  });

  test("warmed images are touched far-to-near for a small cache", async () => {
    const rig = createRig("touch", 6, 2);

    rig.prefetcher.warm(rig.pages.page(3));
    rig.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    // Deepest first, nearest last, so the two pages beside the reader survive eviction.
    expect(rig.images.touched).toEqual([
      rig.pages.image(1),
      rig.pages.image(5),
      rig.pages.image(2),
      rig.pages.image(4),
    ]);
  });

  test("two prefetchers keep independent generations and timers", async () => {
    const first = createRig("independent-a", 5, 1);
    const second = createRig("independent-b", 5, 1);

    first.prefetcher.warm(first.pages.page(3));
    second.prefetcher.warm(second.pages.page(3));
    first.prefetcher.cancel();
    first.clock.advance(PREFETCH_IDLE_MS);
    second.clock.advance(PREFETCH_IDLE_MS);
    await flushMicrotasks(500);

    expect(first.pages.calls).toEqual([]);
    expect(startedIndices(second.pages).sort()).toEqual([2, 4]);
  });
});
