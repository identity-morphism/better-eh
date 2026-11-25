import { beforeEach, describe, expect, test } from "bun:test";

import { pager } from "../../src/ui/pager";
import { installDom } from "./dom";

beforeEach(() => {
  installDom();
});

describe("pager", () => {
  test("renders previous and next links with the page info", () => {
    const nav = pager({ prev: "/?p=1", next: "/?p=3", info: "Page 2", label: "Pagination" });

    expect(nav.tagName).toBe("NAV");
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

  test("keeps info without a disabled placeholder for a missing direction", () => {
    const infoOnly = pager({ prev: null, next: null, info: "1-20 of 20", label: "Gallery pages" });
    expect(infoOnly.querySelectorAll(".pager-btn")).toHaveLength(0);
    expect(infoOnly.querySelector(".pager-info")?.textContent).toBe("1-20 of 20");

    const oneWay = pager({ prev: "/?p=1", next: null, info: "Page 2", label: "Pagination" });
    expect(oneWay.querySelectorAll(".pager-btn")).toHaveLength(1);
    expect(oneWay.querySelector("a.pager-btn")?.getAttribute("href")).toBe("/?p=1");
    expect(oneWay.textContent).not.toContain("Next");
  });

  test("hides a bar with nothing to show", () => {
    const bare = pager({ prev: null, next: null, label: "Gallery pages" });
    expect(bare.hidden).toBe(true);
    expect(bare.querySelectorAll("a, .pager-info")).toHaveLength(0);

    const single = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 1, total: 1, href: () => "/" },
    });
    expect(single.hidden).toBe(true);
    expect(single.querySelectorAll(".pager-num")).toHaveLength(0);
  });

  test("numbers the ends, the current page and its neighbours", () => {
    const middle = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 5, total: 10, href: (page) => `/?page=${page - 1}` },
    });

    expect(middle.hidden).toBe(false);
    expect([...middle.querySelectorAll(".pager-nums > *")].map((node) => node.textContent)).toEqual(
      ["1", "…", "4", "5 (current page)", "6", "…", "10"],
    );
    expect(
      [...middle.querySelectorAll<HTMLAnchorElement>("a.pager-num")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/?page=0", "/?page=3", "/?page=5", "/?page=9"]);
    expect(middle.querySelector(".pager-num.is-current")?.getAttribute("aria-current")).toBe(
      "page",
    );

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

    const contiguous = pager({
      prev: null,
      next: null,
      label: "Pagination",
      pages: { current: 3, total: 5, href: (page) => `/?page=${page - 1}` },
    });
    expect(contiguous.querySelectorAll(".pager-gap")).toHaveLength(0);
    expect(
      [...contiguous.querySelectorAll(".pager-nums > *")].map((node) => node.textContent),
    ).toEqual(["1", "2", "3 (current page)", "4", "5"]);

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

  test("jump submits a one-based page number and is omitted on a single page", () => {
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

    const single = pager({
      prev: null,
      next: null,
      label: "Pagination",
      jump: { current: 1, go: () => undefined },
    });
    expect(single.querySelector(".pager-jump")).toBeNull();
  });
});
