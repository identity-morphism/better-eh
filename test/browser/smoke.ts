/**
 * Browser smoke gate: load the built userscript in Chromium against local E-Hentai fixtures.
 *
 * This exercises the parts unit tests cannot: the generated bundle boots at document-start, the
 * shell renders, the search field reaches the router, the tag combobox parses the compact
 * vocabulary asset, a gallery mounts from a page shaped like the site's, the reader mounts with its
 * HUD counter, the gallery torrent and My Tags views mount from their pages, a posted-date range
 * rewrites itself to the site's date cursor and still renders, a page the parser rejects reloads
 * natively, and axe finds no accessibility violation inside the shell. Run with `bun run
 * test:browser` after `bun run build`.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { chromium } from "playwright";

const ROOT = `${import.meta.dir}/../..`;

function fail(message: string): never {
  throw new Error(`browser smoke: ${message}`);
}

const userscript = await Bun.file(`${ROOT}/dist/better-eh.user.js`).text();
const assets: Record<string, Uint8Array> = {
  "tag-index.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-index.bin`).arrayBuffer()),
  "tag-counts.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-counts.bin`).arrayBuffer()),
};

/**
 * One fixture per route path, so each owned view boots from a page the parser recognizes. The
 * toplist entry is deliberately unparseable so boot must escape to the site's own page.
 */
const FIXTURES: Record<string, string> = {
  "/": "list.html",
  "/g/123456/abcdef1234/": "gallery.html",
  "/gallerytorrents.php": "gallerytorrents.html",
  "/mytags": "mytags.html",
  "/s/hash123/987654-2/": "viewer.html",
  // Served again for the fallback request, whose query keeps this pathname.
  "/toplist.php": "toplist-broken.html",
};

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const fixture = FIXTURES[new URL(request.url).pathname];
    if (fixture === undefined) {
      return new Response("not found", { status: 404 });
    }
    const body = await Bun.file(`${ROOT}/test/fixtures/${fixture}`).text();
    return new Response(body, {
      headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" },
    });
  },
});

const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch();
const errors: string[] = [];

const gmShim = `
  (() => {
    const store = Object.create(null);
    window.__ehStore = store;
    window.GM_getValue = (key, fallback) => (key in store ? store[key] : fallback);
    window.GM_setValue = (key, value) => { store[key] = value; };
    window.GM_addStyle = (css) => {
      const style = document.createElement("style");
      style.textContent = css;
      (document.head ?? document.documentElement).append(style);
      return style;
    };
    window.GM_registerMenuCommand = () => {};
  })();
`;

/** A fresh page with the manager shim and the built userscript, already navigated to `path`. */
async function open(
  path: string,
  waitUntil: "domcontentloaded" | "commit" = "domcontentloaded",
): Promise<Page> {
  // axe borrows a page of its own, which playwright only allows inside a context.
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  await serveAssets(page);
  await page.addInitScript({ content: gmShim });
  await page.addInitScript({ content: userscript });
  await page.goto(`${base}${path}`, { waitUntil });
  return page;
}

/** The whole shell against the WCAG A/AA rules axe can decide without a human. */
async function expectAccessible(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .include("#eh-root")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  if (violations.length === 0) {
    return;
  }
  const summary = violations
    .map((violation) => {
      const nodes = violation.nodes.map((node) => node.target.join(" ")).slice(0, 3);
      return `${violation.id} on ${nodes.join(", ")} (${violation.nodes.length} nodes)`;
    })
    .join(" | ");
  fail(`axe on ${label}: ${summary}`);
}

// The data assets are hosted outside the fixture origin, so serve the checked-in bytes for the
// mirrors the userscript asks for instead of depending on the repository being reachable.
async function serveAssets(page: Page): Promise<void> {
  await page.route(/\/assets\/tag-(?:index|counts)\.bin$/u, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const body = assets[name];
    return body
      ? route.fulfill({
          body: Buffer.from(body),
          headers: {
            "content-type": "application/octet-stream",
            "access-control-allow-origin": "*",
          },
        })
      : route.fulfill({ status: 404 });
  });
}

try {
  const list = await open("/");

  await list.waitForSelector(".card", { timeout: 15_000 });
  if ((await list.locator(".topbar-search input").count()) !== 1) {
    fail("search field did not render");
  }
  if ((await list.locator(".topbar-tab").count()) < 3) {
    fail("site tab bar did not render");
  }

  // The combobox loads the compact asset through the network and must produce suggestions.
  await list.fill(".topbar-search input", "big b");
  await list.waitForSelector(".tag-option", { timeout: 15_000 });
  const firstOption = await list.locator(".tag-option").first().innerText();
  if (!/big/i.test(firstOption)) {
    fail(`unexpected first tag suggestion: ${firstOption}`);
  }
  await list.keyboard.press("Escape");

  // Submitting the field goes through the router and re-renders the listing.
  await list.press(".topbar-search input", "Enter");
  await list.waitForURL(/f_search=big\+b|f_search=big%20b/u, { timeout: 15_000 });
  await list.waitForSelector(".card", { timeout: 15_000 });
  await expectAccessible(list, "list");

  // Boot turns the app-owned posted-date range into the site's date cursor: the listing opens at
  // the end of the range with `seek` set. `commit` returns before that redirect navigates, so the
  // initial response cannot abort the request under test.
  const range = await open("/?eh_since=2024-01-01&eh_until=2024-12-31", "commit");
  await range.waitForURL(/seek=2024-12-31/u, { timeout: 15_000 });
  await range.waitForSelector(".card", { timeout: 15_000 });

  const gallery = await open("/g/123456/abcdef1234/");
  await gallery.waitForSelector(".gallery-cover", { timeout: 15_000 });
  if ((await gallery.locator(".tag-section").count()) !== 1) {
    fail("gallery tag section did not render");
  }
  if ((await gallery.locator("#eh-view h1").count()) === 0) {
    fail("gallery title did not render");
  }
  await expectAccessible(gallery, "gallery");

  const reader = await open("/s/hash123/987654-2/");
  await reader.waitForSelector("#reader", { timeout: 15_000 });
  await reader.waitForFunction(
    () => (document.querySelector("#hud-counter")?.textContent ?? "").includes("2 / 3"),
    undefined,
    { timeout: 15_000 },
  );
  const counter = await reader.locator("#hud-counter").innerText();
  if (!counter.includes("2 / 3")) {
    fail(`unexpected reader counter: ${counter}`);
  }
  await expectAccessible(reader, "reader");

  const galleryTorrents = await open("/gallerytorrents.php?gid=987654&t=abcdef1234");
  await galleryTorrents.waitForSelector("#gallery-torrents", { timeout: 15_000 });
  if ((await galleryTorrents.locator(".gallery-torrent-card").count()) === 0) {
    fail("gallery torrent list did not render");
  }
  await expectAccessible(galleryTorrents, "gallery torrents");

  const myTags = await open("/mytags");
  await myTags.waitForSelector("#my-tags", { timeout: 15_000 });
  if ((await myTags.locator(".my-tags-row").count()) !== 2) {
    fail("My Tags rows did not render");
  }
  await expectAccessible(myTags, "my tags");

  // A page whose markup the parser rejects must reload itself natively instead of mounting an
  // empty shell. The fallback request keeps the pathname, so the fixture server serves it again;
  // `commit` returns before the fallback navigates, so that request cannot abort the initial goto.
  const broken = await open("/toplist.php", "commit");
  await broken.waitForURL(/eh_native=1/u, { timeout: 15_000 });
  await broken.waitForSelector("#native-fallback", { timeout: 15_000 });

  if (errors.length > 0) {
    fail(`page errors: ${errors.join(" | ")}`);
  }
  console.log(
    "browser smoke passed: list, gallery, reader, gallery torrents, My Tags, range, fallback, axe",
  );
} finally {
  await browser.close();
  await server.stop(true);
}
