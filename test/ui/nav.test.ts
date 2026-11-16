import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import * as linkedom from "linkedom";

import { emptySearchQuery } from "../../src/parse/query";
import { setSearchQuery } from "../../src/search-draft";
import { closePopovers } from "../../src/ui/popover";
import { renderTopbar } from "../../src/ui/topbar";
import { installDom } from "./dom";

const ORIGIN = "https://e-hentai.org";

function keydown(props: Record<string, unknown>): Event {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

let document: Document;
let controllers: AbortController[];

function renderAt(href: string, signedIn: boolean): HTMLElement {
  Object.assign(globalThis, { location: new URL(href) });
  if (signedIn) {
    document.cookie = "ipb_member_id=42; path=/";
  }
  document.body.replaceChildren();
  const controller = new AbortController();
  controllers.push(controller);
  const topbar = renderTopbar({ onSearch: () => undefined, signal: controller.signal });
  document.body.append(topbar);
  return topbar;
}

function render(pathname: string, signedIn = false): HTMLElement {
  return renderAt(`${ORIGIN}${pathname}`, signedIn);
}

function topbarTabs(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".topbar-tab")];
}

/** Open More if needed and return the overflow destinations. */
function openMore(): HTMLAnchorElement[] {
  const more = document.querySelector<HTMLButtonElement>(".topbar-more");
  if (more === null) {
    throw new Error("missing More button");
  }
  if (more.getAttribute("aria-expanded") !== "true") {
    more.click();
  }
  return [...document.querySelectorAll<HTMLAnchorElement>(".topbar-more-link")];
}

/** The visible current-page marker, naming More when the active tab lives behind it. */
function activeLabels(): string[] {
  const labels = [...document.querySelectorAll<HTMLAnchorElement>(".topbar-tab.is-active")].map(
    (link) => link.textContent,
  );
  if (document.querySelector(".topbar-more.is-active") !== null) {
    labels.push("More");
  }
  return labels;
}

type TabZone = "primary" | "more";

interface ExpectedTab {
  label: string;
  href: string;
  zone: TabZone;
  /** Account tabs exist only for signed-in visitors. */
  signedIn?: boolean;
  /** A sister site, opened with `rel="noreferrer"`. */
  external?: boolean;
}

/** The one tab table the signed-in, signed-out and external-flag assertions all derive from. */
const EXPECTED_TABS: readonly ExpectedTab[] = [
  { label: "Front Page", href: "/", zone: "primary" },
  { label: "Watched", href: "/watched", zone: "primary" },
  { label: "Popular", href: "/popular", zone: "primary" },
  { label: "Torrents", href: "/torrents.php", zone: "primary" },
  { label: "Favorites", href: "/favorites.php", zone: "primary", signedIn: true },
  { label: "Settings", href: "/uconfig.php", zone: "more", signedIn: true },
  {
    label: "My Uploads",
    href: "https://upld.e-hentai.org/manage",
    zone: "more",
    signedIn: true,
    external: true,
  },
  { label: "My Tags", href: "/mytags", zone: "more", signedIn: true },
  { label: "My Home", href: "/home.php", zone: "more" },
  { label: "Toplists", href: "/toplist.php", zone: "more" },
  { label: "Bounties", href: "/bounty.php", zone: "more" },
  { label: "News", href: "/news.php", zone: "more" },
  { label: "LoFi", href: "/lofi/", zone: "more" },
  { label: "Forums", href: "https://forums.e-hentai.org/", zone: "more", external: true },
  { label: "Wiki", href: "https://ehwiki.org/", zone: "more", external: true },
  { label: "HentaiVerse", href: "https://hentaiverse.org/", zone: "more", external: true },
];

function expectedTabs(zone: TabZone, signedIn: boolean): ExpectedTab[] {
  return EXPECTED_TABS.filter((tab) => tab.zone === zone && (signedIn || !tab.signedIn));
}

beforeEach(() => {
  closePopovers();
  document = installDom();
  controllers = [];
  // linkedom has no text selection; the Ctrl/K handler calls `select()` after focusing.
  Object.defineProperty(linkedom.HTMLInputElement.prototype, "select", {
    value: () => undefined,
    configurable: true,
  });
  Object.assign(globalThis, {
    HTMLElement: linkedom.HTMLElement,
    HTMLInputElement: linkedom.HTMLInputElement,
    HTMLTextAreaElement: linkedom.HTMLTextAreaElement,
    HTMLSelectElement: linkedom.HTMLSelectElement,
  });
});

afterEach(() => {
  for (const controller of controllers) {
    controller.abort();
  }
  closePopovers();
});

describe("topbar navigation", () => {
  test("renders the signed-in primary tabs and the rest behind More", () => {
    render("/", true);

    const pair = (link: HTMLAnchorElement): [string | null, string | null] => [
      link.textContent,
      link.getAttribute("href"),
    ];
    expect(topbarTabs().map(pair)).toEqual(
      expectedTabs("primary", true).map(({ label, href }) => [label, href]),
    );
    expect(openMore().map(pair)).toEqual(
      expectedTabs("more", true).map(({ label, href }) => [label, href]),
    );
  });

  test("drops the account-only tabs but keeps My Home when signed out", () => {
    render("/", false);

    expect(topbarTabs().map((link) => link.textContent)).toEqual(
      expectedTabs("primary", false).map(({ label }) => label),
    );
    expect(openMore().map((link) => link.textContent)).toEqual(
      expectedTabs("more", false).map(({ label }) => label),
    );
  });

  test("marks exactly one tab active for its own path", () => {
    const cases: readonly [pathname: string, marker: string, menuLabel?: string][] = [
      ["/", "Front Page"],
      ["/watched", "Watched"],
      ["/watched/", "Watched"],
      ["/popular", "Popular"],
      ["/torrents.php", "Torrents"],
      ["/favorites.php", "Favorites"],
      ["/uconfig.php", "More", "Settings"],
      ["/mytags", "More", "My Tags"],
      ["/toplist.php", "More", "Toplists"],
      ["/home.php", "More", "My Home"],
      ["/lofi/", "More", "LoFi"],
    ];

    for (const [pathname, marker, menuLabel] of cases) {
      render(pathname, true);
      expect(activeLabels()).toEqual([marker]);

      if (menuLabel !== undefined) {
        const current = openMore().filter((link) => link.getAttribute("aria-current") === "page");
        expect(current.map((link) => link.textContent)).toEqual([menuLabel]);
        expect(current[0]?.classList.contains("is-active")).toBe(true);
      }
    }
  });

  test("marks no tab current on gallery and viewer paths", () => {
    // A gallery is reached through a tab but is not that tab; `aria-current` has to stay true.
    for (const pathname of [
      "/g/123456/abcdef1234/",
      "/s/abcdef1234/5-3",
      "/g/123456/abcdef1234",
      "/doujinshi",
    ]) {
      render(pathname, true);
      expect(activeLabels()).toEqual([]);
      expect(document.querySelector(".topbar-more")?.hasAttribute("aria-current")).toBe(false);
    }
  });

  test("flags the sister-site destinations as external", () => {
    render("/", true);

    const primary = topbarTabs();
    const overflow = openMore();
    const rendered = [...primary, ...overflow];
    expect(primary.every((link) => link.getAttribute("href")?.startsWith("/"))).toBe(true);
    expect(rendered).toHaveLength(EXPECTED_TABS.length);

    for (const tab of EXPECTED_TABS) {
      const link = rendered.find((candidate) => candidate.textContent === tab.label);
      if (link === undefined) {
        throw new Error(`missing tab: ${tab.label}`);
      }
      expect(link.getAttribute("href")).toBe(tab.href);
      expect(link.getAttribute("rel") === "noreferrer", tab.label).toBe(tab.external === true);
    }

    const uploads = rendered.find((link) => link.textContent === "My Uploads");
    expect(uploads?.querySelector("svg")).not.toBeNull();
    expect(uploads?.hasAttribute("aria-current")).toBe(false);
  });

  test("omits Toplists on ExHentai, which answers that path with a 404", () => {
    renderAt("https://exhentai.org/", true);
    expect(openMore().map((link) => link.textContent)).not.toContain("Toplists");

    renderAt(`${ORIGIN}/`, true);
    expect(openMore().map((link) => link.textContent)).toContain("Toplists");
  });

  test("derives the uploads host from the gallery in use", () => {
    renderAt("https://exhentai.org/", true);

    const uploads = openMore().find((link) => link.textContent === "My Uploads");
    expect(uploads?.getAttribute("href")).toBe("https://upld.exhentai.org/manage");
  });

  test("opens the More menu and closes it on Escape", () => {
    render("/");

    const more = document.querySelector<HTMLButtonElement>(".topbar-more");
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    more?.click();

    expect(document.querySelector(".topbar-more-panel")).not.toBeNull();
    expect(document.querySelectorAll(".topbar-more-link")).toHaveLength(8);
    expect(more?.getAttribute("aria-expanded")).toBe("true");

    document.body.dispatchEvent(keydown({ key: "Escape" }));

    expect(document.querySelector(".topbar-more-panel")).toBeNull();
    expect(more?.getAttribute("aria-expanded")).toBe("false");
  });

  test("closes the More menu when a destination is chosen", () => {
    render("/");

    document.querySelector<HTMLButtonElement>(".topbar-more")?.click();
    const link = document.querySelector<HTMLAnchorElement>(".topbar-more-link");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(document.querySelector(".topbar-more-panel")).toBeNull();
  });

  test("shows the filter chips again when the draft returns to the committed query", () => {
    setSearchQuery({ ...emptySearchQuery(), text: "fluffy" });
    render("/");

    const input = document.querySelector<HTMLInputElement>("input[name='f_search']");
    const filters = document.querySelector<HTMLElement>(".topbar-filters");
    if (!input || !filters) {
      throw new Error("missing search header");
    }
    expect(filters.hidden).toBe(false);

    input.value = "fluffy extra";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(filters.hidden).toBe(true);

    input.value = "fluffy";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(filters.hidden).toBe(false);
  });

  test("still handles the Ctrl/K shortcut", () => {
    render("/");

    // linkedom reports no `activeElement`, so the handler is observed through `preventDefault`.
    const shortcut = keydown({ key: "k", ctrlKey: true });
    document.body.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);

    const typo = keydown({ key: "k" });
    document.body.dispatchEvent(typo);
    expect(typo.defaultPrevented).toBe(false);
  });
});
