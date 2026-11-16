/**
 * Browser smoke gate: load the built userscript in Chromium against a local E-Hentai fixture.
 *
 * This exercises the parts unit tests cannot: the generated bundle boots at document-start, the
 * shell renders, the search field reaches the router, and the tag combobox parses the compact
 * vocabulary asset. Run with `bun run test:browser` after `bun run build`.
 */

import { chromium } from "playwright";

const ROOT = `${import.meta.dir}/../..`;

function fail(message: string): never {
  throw new Error(`browser smoke: ${message}`);
}

const userscript = await Bun.file(`${ROOT}/dist/better-eh.user.js`).text();
const fixture = await Bun.file(`${ROOT}/test/fixtures/list.html`).text();
const assets: Record<string, Uint8Array> = {
  "tag-index.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-index.bin`).arrayBuffer()),
  "tag-counts.bin": new Uint8Array(await Bun.file(`${ROOT}/assets/tag-counts.bin`).arrayBuffer()),
};

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(fixture, {
        headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const base = `http://127.0.0.1:${server.port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

// The data assets are hosted outside the fixture origin, so serve the checked-in bytes for the
// mirrors the userscript asks for instead of depending on the repository being reachable.
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

try {
  await page.addInitScript({ content: gmShim });
  await page.addInitScript({ content: userscript });
  await page.goto(base, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(".card", { timeout: 15_000 });
  if ((await page.locator(".topbar-search input").count()) !== 1) {
    fail("search field did not render");
  }
  if ((await page.locator(".topbar-tab").count()) < 3) {
    fail("site tab bar did not render");
  }

  // The combobox loads the compact asset through the network and must produce suggestions.
  await page.fill(".topbar-search input", "big b");
  await page.waitForSelector(".tag-option", { timeout: 15_000 });
  const firstOption = await page.locator(".tag-option").first().innerText();
  if (!/big/i.test(firstOption)) {
    fail(`unexpected first tag suggestion: ${firstOption}`);
  }
  await page.keyboard.press("Escape");

  // Submitting the field goes through the router and re-renders the listing.
  await page.press(".topbar-search input", "Enter");
  await page.waitForURL(/f_search=big\+b|f_search=big%20b/u, { timeout: 15_000 });
  await page.waitForSelector(".card", { timeout: 15_000 });

  if (errors.length > 0) {
    fail(`page errors: ${errors.join(" | ")}`);
  }
  console.log("browser smoke passed: shell, search, tag combobox");
} finally {
  await browser.close();
  await server.stop(true);
}
