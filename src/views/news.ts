import type { NewsBlock, NewsEntry, NewsPage } from "../parse/news";
import { el } from "../ui/dom";
import { pageScaffold } from "../ui/page-scaffold";
import type { ViewContext } from "./context";

const FORUM_LINK = { target: "_blank", rel: "nofollow noopener" } as const;

function titleNode(block: NewsBlock): HTMLElement {
  return block.href === null
    ? el("span", { text: block.title })
    : el("a", { ...FORUM_LINK, class: "news-title-link", href: block.href, text: block.title });
}

function paragraphs(blocks: readonly string[]): readonly HTMLElement[] {
  return blocks.map((text) => el("p", { class: "news-paragraph", text }));
}

function sideCard(block: NewsBlock): HTMLElement {
  return el(
    "section",
    { class: "news-section", "aria-label": block.title },
    el("h2", { class: "news-title" }, titleNode(block)),
    ...paragraphs(block.paragraphs),
  );
}

function entryCard(entry: NewsEntry): HTMLElement {
  const card = el(
    "article",
    { class: "news-card", "aria-label": entry.title },
    el("h2", { class: "news-title" }, titleNode(entry)),
  );
  if (entry.date !== "") {
    card.append(el("p", { class: "news-date", text: entry.date }));
  }
  card.append(...paragraphs(entry.paragraphs));
  if (entry.commentsHref !== null) {
    card.append(
      el("a", {
        ...FORUM_LINK,
        class: "news-comments",
        href: entry.commentsHref,
        text: entry.commentsLabel ?? "Comments",
      }),
    );
  }
  return card;
}

/** Render the site news, changelog and status without the legacy table layout. */
export function renderNews(host: HTMLElement, data: NewsPage, ctx: ViewContext): void {
  pageScaffold(host, {
    title: "News",
    summary: [
      el("span", {
        text:
          data.entries.length === 0 ? "Site status and changelog" : "Site status and announcements",
      }),
    ],
    signal: ctx.signal,
  });

  const layout = el("div", { class: "news-layout" });
  const side = el("aside", { class: "news-aside", "aria-label": "Site status and changelog" });
  if (data.status !== null) {
    side.append(sideCard(data.status));
  }
  if (data.changelog !== null) {
    side.append(sideCard(data.changelog));
  }
  if (side.childElementCount > 0) {
    layout.append(side);
  }

  if (data.entries.length > 0) {
    layout.append(el("div", { class: "news-list" }, ...data.entries.map(entryCard)));
  }
  host.append(layout);
}
