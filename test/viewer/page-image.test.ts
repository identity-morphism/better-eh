import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { PageImage, PageImageSlot, PageImageSlotHooks } from "../../src/page-image";
import { createPageImageSlotFactory, showPageImage } from "../../src/page-image";
import type { PageData } from "../../src/types";
import { installDom } from "../ui/dom";

const FIRST_SRC = "https://img.example/pages/1.jpg";
const SECOND_SRC = "https://img.example/pages/1-nl.jpg";
const THIRD_SRC = "https://img.example/pages/1-nl2.jpg";
const ORIGINAL_SRC = "https://img.example/original/1.png";

function page(overrides: Partial<PageData> = {}): PageData {
  return {
    viewerUrl: "https://e-hentai.org/s/hash/987654-1",
    pageNum: 1,
    counterText: "1 / 2",
    galleryTitle: { leading: [], primary: "Gallery", secondary: null, trailing: [] },
    imgSrc: FIRST_SRC,
    originalHref: null,
    nextHref: null,
    prevHref: null,
    fileInfo: "1,234 KB :: 800 x 1200",
    galleryHref: "https://e-hentai.org/g/987654/abcdef/",
    nlToken: "777",
    firstHref: null,
    lastHref: null,
    forumHref: null,
    searchHref: null,
    ...overrides,
  };
}

function fakeImage(overrides: Partial<PageImage> = {}): PageImage {
  const img: PageImage = {
    src: "",
    onload: null,
    onerror: null,
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    clientHeight: 0,
    getAttribute(this: PageImage, name: string): string | null {
      return name === "src" ? this.src : null;
    },
    ...overrides,
  };
  return img;
}

const errorEvent = new Event("error");
const loadEvent = new Event("load");

beforeEach(() => {
  installDom();
});

describe("showPageImage", () => {
  test("skips handlers when the element already shows this exact image", () => {
    const img = fakeImage({ src: FIRST_SRC, complete: true, naturalWidth: 800 });
    const retry = mock((data: PageData) => Promise.resolve(data));
    const onLoaded = mock(() => {});

    showPageImage({ img, page: page(), retry, maxRetries: 2, onGiveUp: () => {}, onLoaded });

    expect(img.src).toBe(FIRST_SRC);
    expect(img.onload).toBeNull();
    expect(img.onerror).toBeNull();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  test("reports the new image load when the element still shows the previous page", () => {
    // `complete` describes the old image here; the new source has not loaded yet.
    const img = fakeImage({
      src: "https://img.example/previous.jpg",
      complete: true,
      naturalWidth: 800,
    });
    const data = page();
    const retry = mock((retried: PageData) => Promise.resolve(retried));
    const onLoaded = mock(() => {});

    showPageImage({ img, page: data, retry, maxRetries: 2, onGiveUp: () => {}, onLoaded });

    expect(img.src).toBe(FIRST_SRC);
    img.onload?.(loadEvent);

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith(data);
    expect(retry).not.toHaveBeenCalled();
  });

  test("retries after the first error and keeps retrying from the returned page", async () => {
    const img = fakeImage();
    const first = page();
    const second = page({ imgSrc: SECOND_SRC, viewerUrl: "https://e-hentai.org/s/hash/987654-2" });
    const retry = mock(() => Promise.resolve(second));
    const onLoaded = mock(() => {});

    showPageImage({ img, page: first, retry, maxRetries: 3, onGiveUp: () => {}, onLoaded });

    expect(img.src).toBe(FIRST_SRC);
    const firstError = img.onerror;
    expect(typeof firstError).toBe("function");

    firstError?.(errorEvent);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(first);
    expect(img.onload).toBeNull();
    expect(img.onerror).toBeNull();

    await Promise.resolve();

    expect(img.src).toBe(SECOND_SRC);
    expect(img.onerror).not.toBe(firstError);
    expect(typeof img.onload).toBe("function");

    img.onload?.(loadEvent);

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith(second);

    // The next failure retries from the page the loader returned, not the original one.
    img.onerror?.(errorEvent);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenLastCalledWith(second);
  });

  test("gives up when retry has nothing to try", async () => {
    const img = fakeImage();
    const retry = mock(() => Promise.resolve(null));
    const onGiveUp = mock(() => {});

    showPageImage({ img, page: page(), retry, maxRetries: 2, onGiveUp });

    img.onerror?.(errorEvent);
    await Promise.resolve();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(img.src).toBe(FIRST_SRC);
    expect(img.onerror).toBeNull();
    expect(img.onload).toBeNull();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  test("reports a rejected retry instead of leaving it unhandled", async () => {
    const img = fakeImage();
    const retry = mock(() => Promise.reject(new Error("network down")));
    const onGiveUp = mock(() => {});

    showPageImage({ img, page: page(), retry, maxRetries: 2, onGiveUp });

    img.onerror?.(errorEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(img.onerror).toBeNull();
    expect(img.onload).toBeNull();
  });

  test("drops a retry that resolves after the element moved to another page", async () => {
    const nextSrc = "https://img.example/pages/9.jpg";
    const img = fakeImage();
    const first = page();
    const retriedPage = page({ imgSrc: SECOND_SRC });
    const gate = Promise.withResolvers<PageData>();
    const retry = mock(() => gate.promise);
    const onLoaded = mock(() => {});
    const onGiveUp = mock(() => {});
    let current = true;

    showPageImage({
      img,
      page: first,
      retry,
      maxRetries: 2,
      onGiveUp,
      onLoaded,
      isCurrent: () => current,
    });

    img.onerror?.(errorEvent);
    expect(retry).toHaveBeenCalledWith(first);
    expect(img.onload).toBeNull();
    expect(img.onerror).toBeNull();

    // A newer page takes over the element while the old retry is still in flight.
    const newerLoad = mock(() => {});
    const newerError = mock(() => {});
    img.src = nextSrc;
    img.onload = newerLoad;
    img.onerror = newerError;
    current = false;

    gate.resolve(retriedPage);
    await Promise.resolve();
    await Promise.resolve();

    expect(img.src).toBe(nextSrc);
    expect(img.onload).toBe(newerLoad);
    expect(img.onerror).toBe(newerError);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  test("drops a stale retry that resolves to null without giving up", async () => {
    const img = fakeImage();
    const gate = Promise.withResolvers<PageData | null>();
    const retry = mock(() => gate.promise);
    const onGiveUp = mock(() => {});
    let current = true;

    showPageImage({
      img,
      page: page(),
      retry,
      maxRetries: 2,
      onGiveUp,
      isCurrent: () => current,
    });

    img.onerror?.(errorEvent);
    current = false;
    gate.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(onGiveUp).not.toHaveBeenCalled();
  });

  test("does nothing once the page is stale, even on an instant cache hit", () => {
    const previousSrc = "https://img.example/pages/previous.jpg";
    const img = fakeImage({ src: previousSrc });
    const retry = mock(() => Promise.resolve(page()));
    const onLoaded = mock(() => {});
    const onGiveUp = mock(() => {});
    const existingLoad = mock(() => {});
    const existingError = mock(() => {});
    img.onload = existingLoad;
    img.onerror = existingError;

    showPageImage({
      img,
      page: page(),
      retry,
      maxRetries: 2,
      onGiveUp,
      onLoaded,
      isCurrent: () => false,
    });

    expect(img.src).toBe(previousSrc);
    expect(img.onload).toBe(existingLoad);
    expect(img.onerror).toBe(existingError);
    expect(retry).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();

    // The same source completing from cache must not report a load for the stale page.
    const cached = fakeImage({ src: FIRST_SRC, complete: true, naturalWidth: 800 });
    showPageImage({
      img: cached,
      page: page(),
      retry,
      maxRetries: 2,
      onGiveUp,
      onLoaded,
      isCurrent: () => false,
    });

    expect(cached.src).toBe(FIRST_SRC);
    expect(cached.onload).toBeNull();
    expect(cached.onerror).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  test("gives up exactly once when the retry budget is exhausted", async () => {
    const img = fakeImage();
    const first = page();
    const second = page({ imgSrc: SECOND_SRC });
    const third = page({ imgSrc: THIRD_SRC });
    const pages = [first, second, third];
    let retries = 0;
    const retry = mock(() => {
      retries++;
      return Promise.resolve(pages[retries] ?? null);
    });
    const onGiveUp = mock(() => {});

    showPageImage({ img, page: first, retry, maxRetries: 2, onGiveUp });

    img.onerror?.(errorEvent);
    await Promise.resolve();
    expect(img.src).toBe(SECOND_SRC);

    img.onerror?.(errorEvent);
    await Promise.resolve();
    expect(img.src).toBe(THIRD_SRC);
    expect(retry).toHaveBeenCalledTimes(2);

    const failingHandler = img.onerror;
    failingHandler?.(errorEvent);

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(img.onerror).toBeNull();
    expect(img.onload).toBeNull();

    failingHandler?.(errorEvent);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});

describe("createPageImageSlotFactory", () => {
  function slot(
    image: PageImage,
    overrides: Partial<PageData> = {},
    hooks: PageImageSlotHooks = {},
  ): PageImageSlot {
    return createPageImageSlotFactory({
      retry: () => Promise.resolve(null),
      maxRetries: () => 2,
    }).create(image, page({ nlToken: "777", originalHref: ORIGINAL_SRC, ...overrides }), hooks);
  }

  function probeSlot(
    image: PageImage,
    probe: PageImage,
    hooks: PageImageSlotHooks = {},
  ): PageImageSlot {
    return createPageImageSlotFactory({
      retry: () => Promise.resolve(null),
      maxRetries: () => 2,
      probe: () => probe,
    }).create(image, page({ originalHref: ORIGINAL_SRC }), hooks);
  }

  test("does not show a page once the slot is stale", () => {
    const img = fakeImage();
    const onLoaded = mock(() => {});
    const pageSlot = slot(img, {}, { onLoaded, isCurrent: () => false });

    pageSlot.show();

    expect(img.src).toBe("");
    expect(img.onload).toBeNull();
    expect(img.onerror).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  test("reloads with the page's native token and preserves other query parameters", () => {
    const img = fakeImage({ src: `${FIRST_SRC}?download=1&nl=old` });
    const pageSlot = slot(img);

    expect(pageSlot.reload()).toBe(true);
    expect(img.src).toBe(`${FIRST_SRC}?download=1&nl=777`);

    const plain = fakeImage({ src: FIRST_SRC });
    expect(slot(plain).reload()).toBe(true);
    expect(plain.src).toBe(`${FIRST_SRC}?nl=777`);
  });

  test("reports nothing to reload when the image has no source yet", () => {
    expect(slot(fakeImage()).reload()).toBe(false);
  });

  test("upgrades to the original once zoom outgrows the served copy", () => {
    const img = fakeImage({
      src: FIRST_SRC,
      naturalWidth: 800,
      naturalHeight: 1200,
      clientHeight: 400,
    });
    const probe = fakeImage({ naturalWidth: 1600, naturalHeight: 2400 });
    const pageSlot = probeSlot(img, probe);

    pageSlot.upgrade(3);
    expect(probe.src).toBe("");

    pageSlot.upgrade(3.1);
    expect(probe.src).toBe(ORIGINAL_SRC);

    probe.onload?.(loadEvent);
    expect(img.src).toBe(ORIGINAL_SRC);
  });

  test("keeps the served copy when the original has no more pixels", () => {
    const img = fakeImage({
      src: FIRST_SRC,
      naturalWidth: 800,
      naturalHeight: 1200,
      clientHeight: 400,
    });
    const probe = fakeImage({ naturalWidth: 800, naturalHeight: 1200 });
    const pageSlot = probeSlot(img, probe);

    pageSlot.upgrade(4);
    probe.onload?.(loadEvent);

    expect(img.src).toBe(FIRST_SRC);
  });

  test("drops a probe that resolves after the element moved on or the view aborted", () => {
    let current = true;
    const img = fakeImage({
      src: FIRST_SRC,
      naturalWidth: 800,
      naturalHeight: 1200,
      clientHeight: 400,
    });
    const probe = fakeImage({ naturalWidth: 1600, naturalHeight: 2400 });
    const pageSlot = probeSlot(img, probe, { isCurrent: () => current });

    pageSlot.upgrade(4);
    current = false;
    probe.onload?.(loadEvent);

    expect(img.src).toBe(FIRST_SRC);

    const controller = new AbortController();
    const abortedProbe = fakeImage({ naturalWidth: 1600, naturalHeight: 2400 });
    const abortedSlot = createPageImageSlotFactory({
      retry: () => Promise.resolve(null),
      maxRetries: () => 2,
      signal: controller.signal,
      probe: () => abortedProbe,
    }).create(img, page({ originalHref: ORIGINAL_SRC }));

    abortedSlot.upgrade(4);
    controller.abort();
    abortedProbe.onload?.(loadEvent);

    expect(img.src).toBe(FIRST_SRC);
  });
});
