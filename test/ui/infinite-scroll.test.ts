import { beforeEach, describe, expect, test } from "bun:test";

import { parseGalleryPage } from "../../src/parse/gallery";
import { parseListPage } from "../../src/parse/list";
import { parseSearchQuery } from "../../src/parse/query";
import { updateSetting } from "../../src/settings";
import type { ListPageData } from "../../src/types";
import { infiniteScroll } from "../../src/ui/infinite-scroll";
import type { CursorPage } from "../../src/ui/page-cursor";
import { renderGallery } from "../../src/views/gallery";
import { renderList } from "../../src/views/list";
import { loadFixture, parseDocument } from "../dom";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";
import { installTestObservers, lastObserver, settle, TestObserver } from "./observers";

const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";

describe("infiniteScroll", () => {
  beforeEach(() => {
    installDom();
    installTestObservers();
  });

  test("caps a chained run and resumes from Load more", async () => {
    const appended: string[] = [];
    const calls: string[] = [];
    const pages: Record<string, CursorPage<string>> = {};
    for (let index = 1; index <= 6; index++) {
      pages[`/p${index}`] = {
        items: [`item${index}`],
        next: index === 6 ? null : `/p${index + 1}`,
      };
    }

    const controller = infiniteScroll<string>({
      next: "/p1",
      key: (value) => value,
      noun: "items",
      signal: new AbortController().signal,
      load: (url) => {
        calls.push(url);
        return Promise.resolve(pages[url] ?? { items: [], next: null });
      },
      append: (items) => appended.push(...items),
    });

    const observer = lastObserver();
    for (let attempt = 0; attempt < 4; attempt++) {
      observer.trigger(controller.element);
      await settle();
    }

    expect(calls).toEqual(["/p1", "/p2", "/p3"]);
    expect(appended).toEqual(["item1", "item2", "item3"]);
    const more = controller.element.querySelector<HTMLButtonElement>(".infinite-more");
    expect(more?.hidden).toBe(false);

    more?.click();
    await settle();

    expect(calls).toEqual(["/p1", "/p2", "/p3", "/p4"]);
    expect(appended).toEqual(["item1", "item2", "item3", "item4"]);
  });

  test("shows a retry after a failure and resumes from the same page", async () => {
    const appended: string[] = [];
    let attempt = 0;
    const controller = infiniteScroll<string>({
      next: "/p2",
      key: (value) => value,
      noun: "items",
      signal: new AbortController().signal,
      load: () => {
        attempt++;
        if (attempt === 1) {
          return Promise.reject(new Error("offline"));
        }
        return Promise.resolve({ items: ["b"], next: null });
      },
      append: (items) => appended.push(...items),
    });

    lastObserver().trigger(controller.element);
    await settle();

    const retry = controller.element.querySelector<HTMLButtonElement>(".infinite-retry");
    expect(retry?.hidden).toBe(false);
    expect(controller.element.querySelector(".infinite-status")?.textContent).toContain(
      "Could not load more items.",
    );
    expect(appended).toEqual([]);

    retry?.click();
    await settle();
    expect(appended).toEqual(["b"]);
    expect(attempt).toBe(2);
  });

  test("stops loading after stop()", async () => {
    let calls = 0;
    const controller = infiniteScroll<string>({
      next: "/p2",
      key: (value) => value,
      noun: "items",
      signal: new AbortController().signal,
      load: () => {
        calls++;
        return Promise.resolve({ items: ["b"], next: null });
      },
      append: () => undefined,
    });

    controller.stop();
    lastObserver().trigger(controller.element);
    await settle();
    expect(calls).toBe(0);
  });
});

describe("list infinite scroll", () => {
  let host: HTMLElement;

  beforeEach(() => {
    const document = installDom("https://e-hentai.org/?f_search=test");
    installTestObservers();
    updateSetting("listInfiniteScroll", false);
    host = mountHost(document);
  });

  const page: ListPageData = {
    url: "https://e-hentai.org/?f_search=test",
    items: [
      listItem({
        href: "/g/111/aaaa/",
        gid: "111",
        token: "aaaa",
        title: { leading: [], primary: "Alpha", secondary: "", trailing: [] },
        coverSrc: null,
        coverSize: null,
        rating: null,
        category: null,
        uploader: null,
        posted: "",
        torrentsHref: null,
      }),
    ],
    prevHref: null,
    nextHref: "https://e-hentai.org/?f_search=test&p=1",
    resultText: "Found 2 results.",
  };

  test("keeps the pager when off and appends the next page's cards when on", async () => {
    const nextDoc = parseDocument(
      '<!doctype html><html><body><table class="itg"><tbody><tr><td class="gl3c"><a href="/g/222/bbbb/">Beta</a></td></tr></tbody></table></body></html>',
    );
    const calls: string[] = [];
    const pageSource = (url: string) => {
      calls.push(url);
      const parsed = parseListPage(nextDoc, url);
      return Promise.resolve({ items: parsed.items, next: parsed.nextHref });
    };

    renderList(host, page, parseSearchQuery(new URL(page.url)), viewContext(), "search", {
      pageSource,
    });
    expect(host.querySelector(".pager")).not.toBeNull();
    expect(host.querySelector(".infinite-scroll")).toBeNull();
    expect(TestObserver.instances).toHaveLength(0);

    updateSetting("listInfiniteScroll", true);
    expect(host.querySelector(".pager")).toBeNull();
    expect(host.querySelectorAll(".card")).toHaveLength(1);

    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();

    expect(calls).toEqual(["https://e-hentai.org/?f_search=test&p=1"]);
    expect(host.querySelectorAll(".card")).toHaveLength(2);
    expect(host.textContent).toContain("Beta");

    updateSetting("listInfiniteScroll", false);
    expect(host.querySelectorAll(".card")).toHaveLength(1);
    expect(host.querySelector(".pager")).not.toBeNull();
  });

  test("keeps the fallback result count in step with appended pages", async () => {
    const nextDoc = parseDocument(
      '<!doctype html><html><body><table class="itg"><tbody><tr><td class="gl3c"><a href="/g/222/bbbb/">Beta</a></td></tr></tbody></table></body></html>',
    );
    const uncounted: ListPageData = { ...page, resultText: null };

    updateSetting("listInfiniteScroll", true);
    renderList(host, uncounted, parseSearchQuery(new URL(page.url)), viewContext(), "search", {
      pageSource: (url) => {
        const parsed = parseListPage(nextDoc, url);
        return Promise.resolve({ items: parsed.items, next: parsed.nextHref });
      },
    });

    const count = (): string | null | undefined =>
      host.querySelector(".list-summary span")?.textContent;
    expect(count()).toBe("1 item");

    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();
    expect(count()).toBe("2 items");

    updateSetting("listInfiniteScroll", false);
    expect(count()).toBe("1 item");
  });
});

describe("gallery infinite scroll", () => {
  let host: HTMLElement;

  beforeEach(() => {
    const document = installDom(GALLERY_URL);
    installTestObservers();
    updateSetting("galleryInfiniteScroll", false);
    host = mountHost(document);
  });

  test("appends the next thumbnail page and grows the summary", async () => {
    const fixture = await loadFixture("gallery.html");
    const data = parseGalleryPage(fixture, GALLERY_URL);
    const nextDoc = parseDocument(`<!doctype html><html><body>
      <div id="gdt">
        <a href="/s/spr1/123456-4"><div style="background-image:url('https://img.example/s2.jpg');width:100px;height:100px" title="Page 4"></div></a>
        <a href="/s/spr1/123456-5"><div style="background-image:url('https://img.example/s2.jpg');width:100px;height:100px" title="Page 5"></div></a>
      </div>
    </body></html>`);

    updateSetting("galleryInfiniteScroll", true);
    renderGallery(host, data, viewContext(), {
      pageSource: (url) => {
        const parsed = parseGalleryPage(nextDoc, url);
        return Promise.resolve({ items: parsed.thumbs, next: parsed.nextHref });
      },
    });

    const before = host.querySelectorAll(".thumb-cell").length;
    expect(host.querySelectorAll(".gallery-paging .pager-btn")).toHaveLength(0);
    expect(host.querySelector(".gallery-paging .pager-info")?.textContent).toBe(data.pageSummary);

    lastObserver().trigger(host.querySelector(".infinite-scroll") as Element);
    await settle();

    expect(host.querySelectorAll(".thumb-cell")).toHaveLength(before + 2);
    expect(host.textContent).toContain("Page 5");
    expect(host.querySelector(".gallery-paging .pager-info")?.textContent).toBe(
      "Showing 1 - 27 of 60",
    );

    updateSetting("galleryInfiniteScroll", false);
    expect(host.querySelectorAll(".thumb-cell")).toHaveLength(before);
    expect(host.querySelector(".gallery-paging .pager-info")?.textContent).toBe(data.pageSummary);
    expect(host.querySelectorAll(".gallery-paging .pager-btn").length).toBeGreaterThan(0);
  });
});
