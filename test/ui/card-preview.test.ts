import { beforeEach, describe, expect, test } from "bun:test";

import { parseSearchQuery } from "../../src/parse/query";
import type { ListPageData } from "../../src/types";
import { renderList } from "../../src/views/list";
import { installDom, mountHost, viewContext } from "./dom";
import { listItem } from "./fixtures";

const DATA: ListPageData = {
  url: "https://e-hentai.org/",
  items: [listItem()],
  prevHref: null,
  nextHref: null,
  resultText: "Found 1 result.",
};

function escape(): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: "Escape" });
  document.dispatchEvent(event);
}

describe("card preview", () => {
  let host: HTMLElement;

  beforeEach(() => {
    installDom();
    host = mountHost();
    const url = new URL("https://e-hentai.org/");
    renderList(host, DATA, parseSearchQuery(url), viewContext());
  });

  test("keeps the card's direct links and adds a preview trigger", () => {
    expect(host.querySelector<HTMLAnchorElement>(".card-title")?.getAttribute("href")).toBe(
      "/g/111/aaaa/",
    );
    const trigger = host.querySelector<HTMLButtonElement>(".card-preview-trigger");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  test("opens quick actions from the trigger and closes with Escape", () => {
    const trigger = host.querySelector<HTMLButtonElement>(".card-preview-trigger");
    trigger?.click();

    const panel = document.querySelector<HTMLElement>(".card-preview");
    expect(panel).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const text = panel?.textContent ?? "";
    expect(text).toContain("Alpha");
    expect(text).toContain("Extra");
    expect(text).toContain("Doujinshi");
    expect(text).toContain("alice74");
    expect(text).toContain("10 pages");

    const links = [...(panel?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/g/111/aaaa/",
      "https://e-hentai.org/gallerytorrents.php?gid=111&t=aaaa",
    ]);
    expect(panel?.querySelector(".fav-btn")).not.toBeNull();

    escape();
    expect(document.querySelector(".card-preview")).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  test("hovering the card never opens the preview", () => {
    const card = host.querySelector<HTMLElement>(".card");
    for (const pointerType of ["mouse", "touch"]) {
      const enter = new Event("pointerenter", { bubbles: false });
      Object.defineProperty(enter, "pointerType", { value: pointerType });
      card?.dispatchEvent(enter);
    }

    expect(document.querySelector(".card-preview")).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>(".card-preview-trigger")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
