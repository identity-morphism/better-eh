import { beforeEach, describe, expect, test } from "bun:test";

import { parseHome } from "../../src/parse/home";
import { renderHome } from "../../src/views/home";
import { loadFixture } from "../dom";
import { installDom, mountHost, viewContext } from "./dom";

const HOME_URL = "https://e-hentai.org/home.php";
const fixture = await loadFixture("home.html");
const home = parseHome(fixture, HOME_URL);

function card(root: HTMLElement, title: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
  if (found === null) {
    throw new Error(`missing the ${title} card`);
  }
  return found;
}

describe("home view", () => {
  let host: HTMLElement;

  beforeEach(() => {
    installDom();
    host = mountHost();
  });

  test("heads the page and renders every account box", () => {
    renderHome(host, home, viewContext());

    expect(host.querySelector("h1")?.textContent).toBe("My Home");
    expect(host.querySelectorAll(".home-section")).toHaveLength(5);
    expect(
      [...host.querySelectorAll(".home-section-title")].map((node) => node.textContent),
    ).toEqual(["Image Limits", "EHTracker", "Total GP Gained", "Toplists", "Moderation Power"]);
  });

  test("marks the current account tab and links the rest", () => {
    renderHome(host, home, viewContext());

    const current = host.querySelector<HTMLAnchorElement>(".home-nav-link[aria-current='page']");
    expect(current?.textContent).toBe("Overview");
    expect([...host.querySelectorAll(".home-nav-link")].map((node) => node.textContent)).toContain(
      "My Tags",
    );
  });

  test("renders tracker facts, standalone links and the native action", () => {
    renderHome(host, home, viewContext());
    const tracker = card(host, "EHTracker");

    const facts = [...tracker.querySelectorAll<HTMLElement>(".home-fact")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(facts).toContainEqual(["uploaded", "12.34 MiB"]);
    expect(facts).toContainEqual(["seedmins", "8,726"]);

    const torrents = tracker.querySelector<HTMLAnchorElement>(".home-link");
    expect(torrents?.textContent).toBe("Show My Torrents");
    expect(torrents?.getAttribute("href")).toBe("https://e-hentai.org/torrents.php?u=12345");

    const action = tracker.querySelector<HTMLAnchorElement>(".home-action");
    expect(action?.textContent).toBe("Reset Torrent Key");
    expect(action?.getAttribute("href")).toBe("https://e-hentai.org/home.php?eh_native=1");
    expect(action?.hasAttribute("data-native")).toBe(true);
  });

  test("keeps a one-sentence box readable", () => {
    renderHome(host, home, viewContext());
    expect(card(host, "Toplists").querySelector(".home-text-line")?.textContent).toBe(
      "You are currently not featured on any toplists...",
    );
  });
});
