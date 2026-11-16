import { beforeEach, describe, expect, test } from "bun:test";

import { pager } from "../../src/ui/pager";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

describe("pager", () => {
  test("renders both links when previous and next pages exist", () => {
    const nav = pager({ prev: "/?p=1", next: "/?p=3", info: "Page 2", label: "Pagination" });

    expect(nav.tagName).toBe("NAV");
    expect(nav.className).toBe("pager");
    expect(nav.getAttribute("aria-label")).toBe("Pagination");
    expect(nav.hidden).toBe(false);

    const links = nav.querySelectorAll("a.pager-btn");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("/?p=1");
    expect(links[0]?.textContent).toBe("Previous");
    expect(links[1]?.getAttribute("href")).toBe("/?p=3");
    expect(links[1]?.textContent).toBe("Next");

    expect(nav.querySelector(".pager-info")?.textContent).toBe("Page 2");
  });

  test("hides a bar with nothing to show", () => {
    const nav = pager({ prev: null, next: null, label: "Gallery pages" });

    expect(nav.hidden).toBe(true);
    expect(nav.querySelectorAll("a")).toHaveLength(0);
    expect(nav.querySelectorAll(".pager-btn")).toHaveLength(0);
    expect(nav.querySelectorAll(".pager-info")).toHaveLength(0);
  });

  test("keeps info on a single page and omits the missing direction", () => {
    const nav = pager({ prev: null, next: null, info: "1-20 of 20", label: "Gallery pages" });

    expect(nav.hidden).toBe(false);
    expect(nav.querySelectorAll(".pager-btn")).toHaveLength(0);
    expect(nav.querySelector(".pager-info")?.textContent).toBe("1-20 of 20");
  });

  test("mixes a link and info without a disabled placeholder", () => {
    const nav = pager({ prev: "/?p=1", next: null, info: "Page 2", label: "Pagination" });
    const [prev, info] = [...nav.children];

    expect(prev?.tagName).toBe("A");
    expect(prev?.getAttribute("href")).toBe("/?p=1");
    expect(info?.className).toBe("pager-info");
    expect(nav.querySelectorAll(".pager-btn")).toHaveLength(1);
    expect(nav.textContent).not.toContain("Next");
  });

  test("numbers the ends, the current page and its neighbours", () => {
    const nav = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 5, total: 10, href: (page) => `/?page=${page - 1}` },
    });

    expect(nav.hidden).toBe(false);
    expect(nav.querySelectorAll(".pager-btn")).toHaveLength(0);
    expect([...nav.querySelectorAll(".pager-nums > *")].map((node) => node.textContent)).toEqual([
      "1",
      "…",
      "4",
      "5 (current page)",
      "6",
      "…",
      "10",
    ]);

    const links = [...nav.querySelectorAll<HTMLAnchorElement>("a.pager-num")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/?page=0",
      "/?page=3",
      "/?page=5",
      "/?page=9",
    ]);
    expect(nav.querySelector(".pager-num.is-current")?.getAttribute("aria-current")).toBe("page");
  });

  test("does not leave a gap at the first or last page", () => {
    const first = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 1, total: 10, href: (page) => `/?page=${page - 1}` },
    });
    expect([...first.querySelectorAll(".pager-nums > *")].map((node) => node.textContent)).toEqual([
      "1 (current page)",
      "2",
      "…",
      "10",
    ]);

    const last = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 10, total: 10, href: (page) => `/?page=${page - 1}` },
    });
    expect([...last.querySelectorAll(".pager-nums > *")].map((node) => node.textContent)).toEqual([
      "1",
      "…",
      "9",
      "10 (current page)",
    ]);
  });

  test("collapses no gap when the window is contiguous", () => {
    const nav = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 3, total: 5, href: (page) => `/?page=${page - 1}` },
    });

    expect(nav.querySelectorAll(".pager-gap")).toHaveLength(0);
    expect([...nav.querySelectorAll(".pager-nums > *")].map((node) => node.textContent)).toEqual([
      "1",
      "2",
      "3 (current page)",
      "4",
      "5",
    ]);
  });

  test("hides the numbered bar on a single page", () => {
    const nav = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 1, total: 1, href: () => "/" },
    });

    expect(nav.hidden).toBe(true);
    expect(nav.querySelectorAll(".pager-num")).toHaveLength(0);
  });

  test("jump/seek submits a one-based page number", () => {
    const pages: number[] = [];
    const nav = pager({
      prev: "/?p=1",
      next: "/?p=3",
      label: "Pagination",
      jump: { current: 2, go: (page) => pages.push(page) },
    });

    const input = nav.querySelector<HTMLInputElement>(".pager-jump-input");
    expect(input?.value).toBe("2");
    expect(input?.getAttribute("aria-label")).toBe("Jump to page");

    if (input) {
      input.value = "9";
    }
    nav
      .querySelector<HTMLFormElement>(".pager-jump")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(pages).toEqual([9]);

    if (input) {
      input.value = "0";
    }
    nav
      .querySelector<HTMLFormElement>(".pager-jump")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(pages).toEqual([9]);
  });

  test("omits jump on a single-page bar", () => {
    const nav = pager({
      prev: null,
      next: null,
      label: "Pagination",
      jump: { current: 1, go: () => undefined },
    });
    expect(nav.querySelector(".pager-jump")).toBeNull();
  });
});
