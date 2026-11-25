import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { getSettings, updateSetting } from "../../src/settings";
import { resultCard } from "../../src/ui/result-card";
import { until } from "./async";
import { installDom } from "./dom";
import { stubNetwork } from "./favorites-network";
import { listItem } from "./fixtures";

const ITEM = listItem();

const realFetch = globalThis.fetch;
const interval = getSettings().netIntervalMs;

let document: Document;

/** Open the favorite menu and pick its first folder, i.e. "Read later". */
async function chooseFolder(
  anchor: HTMLButtonElement | null | undefined,
  done: () => boolean,
): Promise<void> {
  if (anchor === null || anchor === undefined) {
    throw new Error("missing favorite button");
  }
  anchor.click();
  await until(() => document.querySelector(".fav-grid .fav-item") !== null);
  const folder = document.querySelector<HTMLButtonElement>(".fav-grid .fav-item");
  if (folder === null) {
    throw new Error("the favorite folders never rendered");
  }
  folder.click();
  await until(done);
}

beforeEach(() => {
  // The queue's default spacing is the only reason these two-step flows would be slow.
  updateSetting("netIntervalMs", 0);
  document = installDom();
  stubNetwork();
});

afterAll(() => {
  globalThis.fetch = realFetch;
  updateSetting("netIntervalMs", interval);
});

describe("resultCard", () => {
  test("lays out a normal portrait and caps an extreme tall cover", () => {
    const article = resultCard(ITEM, new AbortController().signal);
    const cover = article.querySelector(".card-cover");

    expect(article.tagName).toBe("ARTICLE");
    expect(article.className).toBe("card");
    expect(cover).not.toBeNull();
    expect(cover?.className).not.toContain("is-tall-cover");
    expect(article.querySelector(".card-cover-wrap .fav-btn")).not.toBeNull();
    expect(article.querySelector(".card-body .card-title")).not.toBeNull();
    expect(article.querySelector(".card-posted")?.textContent).toBe("2024-01-01 12:00");

    const tall = resultCard(
      { ...ITEM, coverSize: { width: 250, height: 5000 } },
      new AbortController().signal,
    );
    expect(tall.querySelector(".card-cover")?.className).toContain("is-tall-cover");

    const unknown = resultCard({ ...ITEM, coverSize: null }, new AbortController().signal);
    expect(unknown.querySelector(".card-cover")?.className).not.toContain("is-tall-cover");
  });

  test("binds the parsed title, rating, pages and torrent link", () => {
    const article = resultCard(ITEM, new AbortController().signal);
    const title = article.querySelector(".card-title");
    expect(title?.querySelector(".card-artist")?.textContent).toBe("[Circle] ");
    expect(title?.querySelector(".card-primary")?.textContent).toBe("Alpha");
    expect(title?.querySelector(".card-secondary")?.textContent).toBe("Extra");

    const stars = article.querySelector(".rating-stars");
    expect(stars?.getAttribute("aria-label")).toBe("4 out of 5 stars");
    expect(stars?.querySelectorAll(".rating-half.is-on")).toHaveLength(8);
    expect(article.querySelector(".card-meta")?.textContent).toContain("10 pages");

    const torrent = article.querySelector<HTMLAnchorElement>(".card-torrent");
    expect(torrent?.getAttribute("href")).toBe(ITEM.torrentsHref);
    expect(torrent?.hasAttribute("data-native")).toBe(false);

    const cover = article.querySelector<HTMLImageElement>(".card-cover img");
    expect(cover?.getAttribute("width")).toBe("250");
    expect(cover?.getAttribute("height")).toBe("353");
  });

  test("renders unknown favorite state as today's neutral button", () => {
    const article = resultCard({ ...ITEM, favorite: null }, new AbortController().signal);

    const button = article.querySelector<HTMLElement>(".fav-btn");
    expect(button?.getAttribute("aria-label")).toBe("Favorite folders");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.classList.contains("is-favorite")).toBe(false);
    expect(button?.querySelector(".fav-label")?.textContent).toBe("Favorite");
  });

  test("the favorite button repaints the posted-date mark when the folder changes", async () => {
    document.cookie = "ipb_member_id=71";
    const article = resultCard(ITEM, new AbortController().signal);
    document.body.append(article);

    const posted = article.querySelector<HTMLElement>(".card-posted");
    expect(posted?.classList.contains("is-favorite")).toBe(false);

    await chooseFolder(
      article.querySelector<HTMLButtonElement>(".fav-btn"),
      () => posted?.classList.contains("is-favorite") === true,
    );

    expect(posted?.classList.contains("is-favorite")).toBe(true);
    expect(posted?.getAttribute("title")).toBe("In favorites: Read later");
    expect(posted?.style.getPropertyValue("--fav-color")).toBe("#c8c8c8");
    expect(article.querySelector(".fav-btn .fav-label")?.textContent).toBe("Read later");
  });

  test("favorite: false drops the button but keeps the cover and meta", () => {
    const article = resultCard(ITEM, new AbortController().signal, { favorite: false });

    expect(article.querySelector<HTMLButtonElement>(".fav-btn")).toBeNull();
    expect(article.querySelector(".card-cover img")).not.toBeNull();
    expect(article.querySelector(".card-meta .cat-badge")?.textContent).toBe("Doujinshi");
  });

  test("places the cover overlay and the note in their slots", () => {
    const select = document.createElement("label");
    select.className = "favorites-select";
    const article = resultCard(ITEM, new AbortController().signal, {
      favorite: false,
      className: "favorites-card",
      cover: select,
      note: "Read later",
    });

    expect(article.className).toBe("card favorites-card");
    expect(article.querySelector(".card-cover-wrap")?.lastElementChild).toBe(select);

    const body = article.querySelector(".card-body");
    const note = body?.querySelector(".favorites-note");
    expect(note?.textContent).toBe("Read later");
    expect(note?.getAttribute("title")).toBe("Read later");
    expect(body?.lastElementChild).toBe(note);
  });
});
