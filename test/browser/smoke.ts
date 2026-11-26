/**
 * Browser smoke gate: load the built userscript in real browsers against local E-Hentai fixtures.
 *
 * This is the part unit tests cannot cover: the generated bundle boots at document-start, the shell
 * takes over the site's document, every owned view mounts, the search field reaches the router, the
 * tag combobox parses the compact vocabulary asset, the gallery and reader interact, a signed-in
 * favorite survives a history round trip, a posted-date range rewrites itself to the site's date
 * cursor, a page the parser rejects reloads natively, and axe finds no accessibility violation in
 * the shell or an open panel. Chromium also runs a phone viewport and forced-colors/reduced-motion
 * emulation. `SMOKE_BROWSERS=chromium,firefox` widens the core checks.
 *
 * Run with `bun run test:browser` after `bun run build`.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium, devices, firefox, webkit } from "playwright";

const ROOT = `${import.meta.dir}/../..`;

function fail(message: string): never {
  throw new Error(`browser smoke: ${message}`);
}

const userscript = await Bun.file(`${ROOT}/dist/better-eh.user.js`).text();
const assets: Record<string, Uint8Array> = {
  "tag-index.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-index.bin`).arrayBuffer()),
  "tag-counts.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-counts.bin`).arrayBuffer()),
};

/** One fixture per route path, so each owned view boots from a page the parser recognizes. */
const FIXTURES: Record<string, string> = {
  "/": "list.html",
  "/popular": "list.html",
  "/watched": "list-watched.html",
  "/doujinshi": "list.html",
  "/tag/female:big_brevity": "list.html",
  "/uploader/alice74": "list-uploader.html",
  "/g/111/aaaa/": "gallery.html",
  "/g/222/bbbb/": "gallery-api.html",
  "/g/123456/abcdef1234/": "gallery.html",
  "/gallerytorrents.php": "gallerytorrents.html",
  "/archiver.php": "archive.html",
  "/mytags": "mytags.html",
  "/s/hash123/987654-2/": "viewer.html",
  "/s/hash123/987654-3": "viewer-last.html",
  "/toplist.php": "toplist.html",
  "/favorites.php": "favorites.html",
  "/torrents.php": "torrents.html",
  "/home.php": "home.html",
  "/uconfig.php": "uconfig.html",
  "/news.php": "news.html",
};

/** The favorite folder names `getFolders` reads from the site's user settings page. */
const FOLDER_INPUTS = Array.from(
  { length: 10 },
  (_, slot) => `<input name="favorite_${slot}" value="${slot === 0 ? "Read later" : ""}">`,
).join("");

/** Gallery GETs per pathname, so a cache bypass is observable without a stateful fixture. */
const hits = new Map<string, number>();

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);

    if (url.pathname === "/gallerypopups.php") {
      return new Response("favorites", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/uconfig.php") {
      const body = await Bun.file(`${ROOT}/test/fixtures/uconfig.html`).text();
      return new Response(body.replace("</body>", `<div hidden>${FOLDER_INPUTS}</div></body>`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const name =
      url.pathname === "/toplist.php" && url.searchParams.has("broken")
        ? "toplist-broken.html"
        : FIXTURES[url.pathname];
    if (name === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(await Bun.file(`${ROOT}/test/fixtures/${name}`).text(), {
      headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" },
    });
  },
});

const base = `http://127.0.0.1:${server.port}`;

const ENGINES = { chromium, firefox, webkit } as const;
type BrowserName = keyof typeof ENGINES;

interface OpenOptions {
  path: string;
  browser: Browser;
  waitUntil?: "domcontentloaded" | "commit";
  mobile?: boolean;
  forcedColors?: "active" | "none";
  reducedMotion?: "reduce" | "no-preference";
  signedIn?: boolean;
}

const errors: string[] = [];

/** Console errors that belong to the fixtures, the intentional native fallback, or a missing image. */
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /parse mismatch, opening the native page/i,
];

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
async function open(options: OpenOptions): Promise<{ page: Page; context: BrowserContext }> {
  const { browser, path } = options;
  const device = options.mobile === true ? devices["Pixel 7"] : undefined;
  const context = await browser.newContext({
    ...(device ?? { viewport: { width: 1100, height: 900 } }),
    ...(options.forcedColors === undefined ? {} : { forcedColors: options.forcedColors }),
    ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
  });
  if (options.signedIn !== false) {
    await context.addCookies([{ name: "ipb_member_id", value: "42", url: base }]);
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    // The broken-toplist scenario intentionally rejects the page and opens the native fallback.
    if (path.includes("broken=1") && text.includes("ParseMismatchError")) {
      return;
    }
    if (!IGNORED_CONSOLE.some((pattern) => pattern.test(text))) {
      errors.push(`${path}: console: ${text}`);
    }
  });
  await serveAssets(page);
  // The gallery fixture's inline API config points at the real host; answer it locally.
  await page.route("**/api.php", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ rating_avg: 4.61, rating_cnt: 11, rating_usr: 3 }),
    }),
  );
  await page.addInitScript({ content: gmShim });
  await page.addInitScript({ content: userscript });
  await page.goto(`${base}${path}`, { waitUntil: options.waitUntil ?? "domcontentloaded" });
  return { page, context };
}

/** The shell against the WCAG A/AA rules axe can decide without a human. */
async function expectAccessible(
  page: Page,
  label: string,
  selector = "#eh-root",
  disabledRules: readonly string[] = [],
): Promise<void> {
  const builder = new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  for (const rule of disabledRules) {
    builder.disableRules(rule);
  }
  const { violations } = await builder.analyze();
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

async function waitForGallery(page: Page): Promise<void> {
  await page.waitForSelector(".gallery-cover", { timeout: 15_000 });
}

async function openList(page: Page): Promise<void> {
  await page.waitForSelector(".card", { timeout: 15_000 });
}

/** One full pass: every owned view, the main interactions, the cache round trip and axe. */
async function runFull(browser: Browser): Promise<void> {
  const { page: list, context: listContext } = await open({ path: "/", browser });
  await openList(list);
  if ((await list.locator(".topbar-search input").count()) !== 1) {
    fail("search field did not render");
  }
  if ((await list.locator(".topbar-tab").count()) < 3) {
    fail("site tab bar did not render");
  }

  // The combobox loads the compact asset through the network and must produce suggestions.
  await list.fill(".topbar-search input", "big b");
  await list.waitForFunction(
    () => (document.querySelector(".tag-option")?.textContent ?? "").toLowerCase().includes("big"),
    undefined,
    { timeout: 15_000 },
  );
  await expectAccessible(list, "list with tag suggestions", "body");
  await list.keyboard.press("Escape");

  await list.locator("details.filters summary").click();
  await expectAccessible(list, "list with filters open");
  await list.locator("details.filters summary").click();

  // Submitting the field goes through the router and re-renders the listing.
  await list.press(".topbar-search input", "Enter");
  await list.waitForURL(/f_search=big\+b|f_search=big%20b/u, { timeout: 15_000 });
  await openList(list);
  await expectAccessible(list, "list");
  await listContext.close();

  const filtered = await open({ path: "/?f_search=test&f_srdd=4&f_sfl=on", browser });
  await filtered.page.waitForSelector(".filters-active", { timeout: 15_000 });
  const filtersSummary = await filtered.page.locator(".filters-active").innerText();
  if (filtersSummary !== "4★ minimum · Language filter off") {
    fail(`unexpected active filter summary: ${filtersSummary}`);
  }
  await filtered.context.close();

  // Boot turns the app-owned posted-date range into the site's date cursor.
  const range = await open({
    path: "/?eh_since=2024-01-01&eh_until=2024-12-31",
    browser,
    waitUntil: "commit",
  });
  await range.page.waitForURL(/seek=2024-12-31/u, { timeout: 15_000 });
  await openList(range.page);
  await range.context.close();

  const gallery = await open({ path: "/g/123456/abcdef1234/", browser });
  await waitForGallery(gallery.page);
  if ((await gallery.page.locator(".tag-section").count()) !== 1) {
    fail("gallery tag section did not render");
  }
  if ((await gallery.page.locator("#eh-view h1").count()) === 0) {
    fail("gallery title did not render");
  }
  await expectAccessible(gallery.page, "gallery");
  await gallery.page.locator(".fav-btn").click();
  await gallery.page.waitForSelector(".fav-item", { timeout: 15_000 });
  await expectAccessible(gallery.page, "gallery favorite menu", "body");
  await gallery.page.keyboard.press("Escape");
  await gallery.context.close();

  const tagGallery = await open({ path: "/g/222/bbbb/", browser });
  await waitForGallery(tagGallery.page);
  await tagGallery.page.locator(".tag-chip").first().dispatchEvent("contextmenu");
  await tagGallery.page.waitForSelector(".tag-menu-panel", { timeout: 15_000 });
  await expectAccessible(tagGallery.page, "gallery tag menu", "body");
  await tagGallery.page.keyboard.press("Escape");
  await tagGallery.context.close();

  const reader = await open({ path: "/s/hash123/987654-2/", browser });
  await reader.page.waitForSelector("#reader", { timeout: 15_000 });
  await reader.page.waitForFunction(
    () => (document.querySelector("#hud-counter")?.textContent ?? "").includes("2 / 3"),
    undefined,
    { timeout: 15_000 },
  );
  await reader.page.keyboard.press("?");
  await reader.page.waitForSelector("#hud-help:not([hidden])", { timeout: 15_000 });
  await expectAccessible(reader.page, "reader shortcuts");
  await reader.page.keyboard.press("Escape");
  await reader.page.keyboard.press("ArrowRight");
  await reader.page.waitForURL(/-3\/?$/u, { timeout: 15_000 });
  await reader.page.waitForFunction(
    () => (document.querySelector("#hud-counter")?.textContent ?? "").includes("3 / 3"),
    undefined,
    { timeout: 15_000 },
  );
  await expectAccessible(reader.page, "reader");
  await reader.context.close();

  const views: readonly {
    path: string;
    selector: string;
    label: string;
    count?: number;
  }[] = [
    { path: "/favorites.php", selector: ".favorites-tabs", label: "favorites" },
    { path: "/toplist.php", selector: ".toplist-section", label: "toplist" },
    { path: "/torrents.php", selector: ".torrent-row", label: "torrents", count: 3 },
    { path: "/home.php", selector: ".home-section", label: "home" },
    { path: "/uconfig.php", selector: ".settings-section", label: "settings" },
    { path: "/news.php", selector: ".news-card", label: "news", count: 2 },
    {
      path: "/gallerytorrents.php?gid=987654&t=abcdef1234",
      selector: ".gallery-torrent-card",
      label: "gallery torrents",
    },
    {
      path: "/archiver.php?gid=123456&token=abcdef1234",
      selector: ".archive-option",
      label: "archive",
      count: 2,
    },
    { path: "/mytags", selector: "#my-tags", label: "my tags" },
  ];
  for (const view of views) {
    const opened = await open({ path: view.path, browser });
    await opened.page.waitForSelector(view.selector, { timeout: 15_000 });
    if (view.count !== undefined) {
      const found = await opened.page.locator(view.selector).count();
      if (found !== view.count) {
        fail(`${view.label}: expected ${view.count} rows, found ${found}`);
      }
    }
    await expectAccessible(opened.page, view.label);
    await opened.context.close();
  }

  // A signed-in favorite must survive the route cache. Removing it marks the gallery stale, so the
  // next visit is a real fetch; the remembered mark also wins over the fixture's old parse.
  hits.delete("/g/111/aaaa/");
  const cache = await open({ path: "/", browser });
  const firstCover = cache.page.locator(".card-cover").first();
  if ((await firstCover.count()) !== 1) {
    fail("list card cover did not render");
  }
  await firstCover.click();
  await waitForGallery(cache.page);
  if (hits.get("/g/111/aaaa/") !== 1) {
    fail(`expected one gallery load, got ${hits.get("/g/111/aaaa/") ?? 0}`);
  }
  await cache.page.locator(".fav-btn").click();
  await cache.page.waitForSelector(".fav-item.fav-remove", { timeout: 15_000 });
  await cache.page.locator(".fav-item.fav-remove").click();
  await cache.page.waitForFunction(
    () => document.querySelector(".fav-label")?.textContent === "Favorite",
    undefined,
    { timeout: 15_000 },
  );
  await cache.page.goBack();
  await openList(cache.page);
  await cache.page.locator(".card-cover").first().click();
  await waitForGallery(cache.page);
  const label = await cache.page.locator(".fav-label").innerText();
  if (label !== "Favorite") {
    fail(`favorite mark did not survive the cached page: ${label}`);
  }
  if (hits.get("/g/111/aaaa/") !== 2) {
    fail(`invalidated gallery was not refetched: ${hits.get("/g/111/aaaa/") ?? 0} loads`);
  }
  await expectAccessible(cache.page, "gallery after a history round trip");
  await cache.context.close();

  // A page whose markup the parser rejects must reload itself natively instead of mounting an
  // empty shell. The fallback request keeps the pathname and query.
  const broken = await open({ path: "/toplist.php?broken=1", browser, waitUntil: "commit" });
  await broken.page.waitForURL(/eh_native=1/u, { timeout: 15_000 });
  await broken.page.waitForSelector("#native-fallback", { timeout: 15_000 });
  await broken.context.close();

  if (errors.length > 0) {
    fail(`page errors: ${errors.join(" | ")}`);
  }
}

/** A shorter pass for a second engine: every page shape, no axe or scroll choreography. */
async function runCore(browser: Browser, name: string): Promise<void> {
  for (const path of ["/", "/g/111/aaaa/", "/s/hash123/987654-2/", "/favorites.php"] as const) {
    const opened = await open({ path, browser });
    const selector =
      path === "/"
        ? ".card"
        : path.startsWith("/g/")
          ? ".gallery-cover"
          : path.startsWith("/s/")
            ? "#reader"
            : ".favorites-tabs";
    await opened.page.waitForSelector(selector, { timeout: 15_000 });
    await opened.context.close();
  }
  if (errors.length > 0) {
    fail(`${name} page errors: ${errors.join(" | ")}`);
  }
}

/** Phone viewport and user-preference emulation, which a desktop render cannot catch. */
async function runMobile(browser: Browser): Promise<void> {
  const list = await open({ path: "/", browser, mobile: true });
  await openList(list.page);
  if (!(await list.page.evaluate(() => matchMedia("(pointer: coarse)").matches))) {
    fail("phone context did not report a coarse pointer");
  }
  await expectAccessible(list.page, "mobile list");
  await list.context.close();

  const gallery = await open({ path: "/g/222/bbbb/", browser, mobile: true });
  await waitForGallery(gallery.page);
  if ((await gallery.page.locator(".rating-star").count()) !== 5) {
    fail("coarse pointer did not collapse the rating to five stars");
  }
  await expectAccessible(gallery.page, "mobile gallery");
  await gallery.context.close();

  const reader = await open({ path: "/s/hash123/987654-2/", browser, mobile: true });
  await reader.page.waitForSelector("#reader", { timeout: 15_000 });
  await expectAccessible(reader.page, "mobile reader");
  await reader.context.close();

  const forced = await open({
    path: "/",
    browser,
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await openList(forced.page);
  // The OS owns the palette in forced-colors mode; the contrast rule cannot judge it.
  await expectAccessible(forced.page, "forced-colors list", "#eh-root", ["color-contrast"]);
  await forced.context.close();

  if (errors.length > 0) {
    fail(`mobile/preference errors: ${errors.join(" | ")}`);
  }
}

const BROWSER_NAMES = (process.env.SMOKE_BROWSERS ?? "chromium")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");

try {
  for (const name of BROWSER_NAMES) {
    const engine = Object.hasOwn(ENGINES, name) ? ENGINES[name as BrowserName] : undefined;
    if (engine === undefined) {
      fail(`unknown SMOKE_BROWSERS entry: ${name}`);
    }
    const browser = await engine.launch();
    try {
      if (name === "chromium") {
        await runFull(browser);
        await runMobile(browser);
      } else {
        await runCore(browser, name);
      }
    } finally {
      await browser.close();
    }
  }
  const views =
    "list, gallery, reader, favorites, toplist, torrents, home, settings, archive, news, My Tags";
  console.log(
    `browser smoke passed (${BROWSER_NAMES.join(",")}): ${views}, cache round trip, mobile, axe`,
  );
} finally {
  await server.stop(true);
}
