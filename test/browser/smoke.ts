/**
 * Browser smoke gate: load the built userscript in Chromium against local E-Hentai fixtures.
 *
 * This exercises the parts unit tests cannot: the generated bundle boots at document-start, the
 * shell renders, the search field reaches the router, the tag combobox parses the compact
 * vocabulary asset, a gallery mounts from a page shaped like the site's, and axe finds no
 * accessibility violation inside the shell. Run with `bun run test:browser` after `bun run build`.
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

/** One fixture per route path, so each owned view boots from a page the parser recognizes. */
const FIXTURES: Record<string, string> = {
  "/": "list.html",
  "/g/123456/abcdef1234/": "gallery.html",
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
async function open(path: string): Promise<Page> {
  // axe borrows a page of its own, which playwright only allows inside a context.
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
  await serveAssets(page);
  await page.addInitScript({ content: gmShim });
  await page.addInitScript({ content: userscript });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
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

  const gallery = await open("/g/123456/abcdef1234/");
  await gallery.waitForSelector(".gallery-cover", { timeout: 15_000 });
  if ((await gallery.locator(".tag-section").count()) !== 1) {
    fail("gallery tag section did not render");
  }
  if ((await gallery.locator("#eh-view h1").count()) === 0) {
    fail("gallery title did not render");
  }
  await expectAccessible(gallery, "gallery");

  if (errors.length > 0) {
    fail(`page errors: ${errors.join(" | ")}`);
  }
  console.log("browser smoke passed: shell, search, tag combobox, gallery, axe");
} finally {
  await browser.close();
  await server.stop(true);
}
