import type { PageData } from "../types";
import { anchorHref } from "./helpers";
import { parseTitle } from "./title";

/**
 * The viewer's "Reload broken image" anchor calls `nl('39629-498785')`; older markup passed the
 * token unquoted. The token is not numeric, so matching `nl(\d+)` never finds it.
 */
const NL_TOKEN = /\bnl\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/u;

function parseNlToken(doc: Document | HTMLElement): string | null {
  const anchor = doc.querySelector("#loadfail, a[onclick*='nl(']");
  const match = NL_TOKEN.exec(anchor?.getAttribute("onclick") ?? "");
  const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return token === "" ? null : token;
}

export function parseViewer(doc: Document | HTMLElement, viewerUrl: string): PageData {
  const [, pageHash = "", galleryId = "", rawNum = "1"] =
    viewerUrl.match(/\/s\/([^/]+)\/(\d+)-(\d+)/) ?? [];
  const pageNum = parseInt(rawNum, 10);

  const imgEl = doc.querySelector("#i3 a img, iframe + a img, .sni > a img");
  const imgSrc = imgEl?.getAttribute("src") ?? "";
  // Present only while the image server hands out a resized copy.
  const originalHref = anchorHref(doc.querySelector("a[href*='/fullimg/']"), viewerUrl);

  const nlToken = parseNlToken(doc);

  const anchorHrefs = [...doc.querySelectorAll<HTMLAnchorElement>('a[href*="/s/"]')].map((anchor) =>
    anchorHref(anchor, viewerUrl),
  );
  const hrefMatching = (n: number): string | null =>
    anchorHrefs.find((href) => href?.match(new RegExp(`-(${n})(\\?|$)`))) ?? null;

  const nextHref = (() => {
    const byNum = hrefMatching(pageNum + 1);
    if (byNum) {
      return byNum;
    }
    const i3Href = anchorHref(doc.querySelector("#i3 a"), viewerUrl);
    return i3Href && i3Href !== viewerUrl ? i3Href : null;
  })();

  const prevHref =
    pageNum <= 1
      ? null
      : (hrefMatching(pageNum - 1) ??
        (pageHash && galleryId
          ? `${new URL(viewerUrl).origin}/s/${pageHash}/${galleryId}-${pageNum - 1}`
          : null));

  const counterText =
    [...doc.querySelectorAll("div, span, td")]
      .find((el) => /^\d+ \/ \d+$/.test(el.textContent.trim()))
      ?.textContent.trim() ?? `${pageNum} / ?`;

  const fileInfo = (() => {
    for (const el of doc.querySelector("#i2")?.querySelectorAll("div, span") ?? []) {
      const t = el.textContent.trim();
      if (/\d+ x \d+/.test(t) && t.includes("::")) {
        return (t.split("\n")[0] ?? t).trim();
      }
    }
    return "";
  })();

  const galleryHref = anchorHref(doc.querySelector('a[href*="/g/"]'), viewerUrl) ?? "#";

  const totalPages = Number.parseInt(/\/\s*(\d+)\s*$/.exec(counterText)?.[1] ?? "", 10);
  const lastByImage = [...doc.querySelectorAll<HTMLAnchorElement>("a")].find((anchor) =>
    anchor.querySelector("img")?.getAttribute("src")?.includes("/l.png"),
  );
  const firstHref = pageNum <= 1 ? null : hrefMatching(1);
  const lastHref =
    Number.isFinite(totalPages) && totalPages > 0
      ? hrefMatching(totalPages)
      : anchorHref(lastByImage ?? null, viewerUrl);
  // The native link is a `prompt()` copy action, so the URL lives in the onclick string.
  const forumHref =
    anchorHref(doc.querySelector('a[href*="/forumtoken/"]'), viewerUrl) ??
    /'(https?:\/\/[^']*forumtoken[^']*)'/.exec(
      doc.querySelector('a[onclick*="forumtoken"]')?.getAttribute("onclick") ?? "",
    )?.[1] ??
    null;
  const searchHref = anchorHref(doc.querySelector('a[href*="f_shash="]'), viewerUrl);

  const galleryTitleElement = doc.querySelector("h1");
  const galleryTitle = galleryTitleElement?.textContent.trim() ?? "Untitled";
  const parsedTitle = parseTitle(galleryTitle);

  return {
    viewerUrl,
    pageNum,
    counterText,
    galleryTitle: parsedTitle,
    imgSrc,
    originalHref,
    nextHref,
    prevHref,
    firstHref,
    lastHref,
    fileInfo,
    galleryHref,
    nlToken,
    forumHref,
    searchHref,
  };
}
