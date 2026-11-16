import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { getSettings, updateSetting } from "../../src/settings";
import type { GalleryData } from "../../src/types";
import { until } from "./async";
import { stubNetwork } from "./favorites-network";
import { mountGallery, renderGalleryAt } from "./gallery-harness";

const realFetch = globalThis.fetch;
const interval = getSettings().netIntervalMs;

describe("gallery favorite button", () => {
  let host: HTMLElement;
  let data: GalleryData;

  beforeEach(async () => {
    ({ host, data } = await mountGallery({
      prepare: () => {
        updateSetting("netIntervalMs", 0);
        stubNetwork();
      },
    }));
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    updateSetting("netIntervalMs", interval);
  });

  test("names the favorite folder instead of the generic label", () => {
    document.cookie = "ipb_member_id=42";
    renderGalleryAt(host, data);

    const button = host.querySelector(".fav-btn");
    expect(button?.querySelector(".fav-label")?.textContent).toBe("Read later");
    expect(button?.getAttribute("aria-label")).toBe("Edit favorite");
  });

  test("falls back to Favorited when the site omits the folder name", () => {
    document.cookie = "ipb_member_id=42";
    renderGalleryAt(host, { ...data, favorite: { folder: "", slot: 2 } });

    expect(host.querySelector(".fav-label")?.textContent).toBe("Favorited");
  });

  test("keeps the state unknown while signed out even when the page carries a mark", () => {
    // The fixture is favorited; without a session the parsed mark must not claim a known state.
    expect(data.favorite).toEqual({ folder: "Read later", slot: 2 });
    renderGalleryAt(host, data);

    expect(host.querySelector(".fav-label")?.textContent).toBe("Favorite");
    expect(host.querySelector(".fav-btn")?.getAttribute("aria-label")).toBe("Favorite folders");
  });

  test("favoriting from the header updates its label and count without a reload", async () => {
    document.cookie = "ipb_member_id=42";
    renderGalleryAt(host, { ...data, favorite: null });

    const meta = (): string => host.querySelector(".gallery-meta")?.textContent ?? "";
    expect(meta()).toContain("42 favorites");
    expect(host.querySelector(".fav-label")?.textContent).toBe("Favorite");

    host.querySelector<HTMLButtonElement>(".fav-btn")?.click();
    await until(() => document.querySelector(".fav-grid .fav-item") !== null);
    const folder = [...document.querySelectorAll<HTMLButtonElement>(".fav-grid .fav-item")].find(
      (item) => item.textContent.includes("Read later"),
    );
    folder?.click();
    await until(() => host.querySelector(".fav-label")?.textContent === "Read later");

    expect(host.querySelector(".fav-label")?.textContent).toBe("Read later");
    expect(host.querySelector(".fav-btn")?.getAttribute("aria-label")).toBe("Edit favorite");
    expect(meta()).toContain("43 favorites");
  });
});
