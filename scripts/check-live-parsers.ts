/**
 * Live-site parser canary.
 *
 * Fixtures are frozen copies of pages the site served once. This script fetches a handful of public
 * pages the app owns — a listing, the popular tab, a gallery, one of its pages and the toplist —
 * and runs the same parsers and sanity assertions the app uses, so a markup change is reported
 * before a reader hits the native fallback. It is advisory: the scheduled workflow opens an issue
 * instead of failing a pull request.
 *
 * Only public e-hentai.org pages are read, sequentially and with a small delay. The script never
 * prints page bodies, gallery tokens or image URLs.
 */

import { parseHTML } from "linkedom";

import { parseGalleryPage } from "../src/parse/gallery";
import { parseListPage } from "../src/parse/list";
import {
  assertGalleryPage,
  assertListPage,
  assertToplistPage,
  assertViewerPage,
} from "../src/parse/sanity";
import { parseToplist } from "../src/parse/toplist";
import { parseViewer } from "../src/parse/viewer";

const BASE = "https://e-hentai.org";
const USER_AGENT = "better-eh-live-check/1.0 (+https://github.com/identity-morphism/better-eh)";
const TIMEOUT_MS = 20_000;
const REQUEST_GAP_MS = 1_000;

interface FetchedPage {
  doc: Document;
  url: string;
}

async function fetchPage(path: string): Promise<FetchedPage> {
  const url = new URL(path, BASE).href;
  const response = await fetch(url, {
    headers: { accept: "text/html", "user-agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!/<html[\s>]/iu.test(text)) {
    throw new Error(`${url} did not return an HTML document`);
  }
  await Bun.sleep(REQUEST_GAP_MS);
  return { doc: parseHTML(text).document, url: response.url || url };
}

const failures: string[] = [];

async function check(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`ok ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    console.error(`fail ${label}: ${message}`);
  }
}

let firstGalleryHref: string | null = null;

await check("listing", async () => {
  const page = await fetchPage("/");
  const data = parseListPage(page.doc, page.url);
  assertListPage(data, page.doc);
  if (data.items.length === 0) {
    throw new Error("listing parsed no results");
  }
  firstGalleryHref = data.items[0]?.href ?? null;
});

await check("popular", async () => {
  const page = await fetchPage("/popular");
  const data = parseListPage(page.doc, page.url);
  assertListPage(data, page.doc);
});

let firstViewerHref: string | null = null;

await check("gallery", async () => {
  if (firstGalleryHref === null) {
    throw new Error("no gallery link was available from the listing");
  }
  const page = await fetchPage(firstGalleryHref);
  const data = parseGalleryPage(page.doc, page.url);
  assertGalleryPage(data);
  if (data.thumbs.length === 0) {
    throw new Error("gallery parsed no thumbnails");
  }
  firstViewerHref = data.firstPageHref ?? data.thumbs[0]?.href ?? null;
});

await check("viewer", async () => {
  if (firstViewerHref === null) {
    throw new Error("no page link was available from the gallery");
  }
  const page = await fetchPage(firstViewerHref);
  const data = parseViewer(page.doc, page.url);
  assertViewerPage(data);
});

await check("toplist", async () => {
  const page = await fetchPage("/toplist.php");
  const data = parseToplist(page.doc, page.url);
  assertToplistPage(data);
});

if (failures.length > 0) {
  console.error(`live parsers: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("live parsers: listing, popular, gallery, viewer and toplist all parsed");
