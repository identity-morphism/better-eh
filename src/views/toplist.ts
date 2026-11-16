import type {
  ToplistCategory,
  ToplistEntry,
  ToplistPage,
  ToplistSection,
  ToplistTab,
} from "../parse/toplist";
import { el } from "../ui/dom";
import { trackJumpRow } from "../ui/jump-row";
import { listHeader } from "../ui/list-header";
import { pageHref, pager } from "../ui/pager";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { countText } from "../ui/text";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";

/** Ranks at or above this get the accent treatment on their badge. */
const PODIUM_RANKS = 3;

function sectionAnchor(index: number): string {
  return `toplist-section-${index}`;
}

function tabLink(tab: ToplistTab): HTMLElement {
  return el("a", {
    class: tab.active ? "toplist-tab is-active" : "toplist-tab",
    href: tab.href,
    "aria-current": tab.active ? "page" : null,
    text: tab.label,
  });
}

function tabStrip(tabs: readonly ToplistTab[]): HTMLElement {
  const groups = new Map<string, ToplistTab[]>();
  for (const tab of tabs) {
    const name = tab.group === "" ? "Toplists" : tab.group;
    const bucket = groups.get(name);
    if (bucket) {
      bucket.push(tab);
    } else {
      groups.set(name, [tab]);
    }
  }

  const strip = el("nav", { class: "toplist-tabs", "aria-label": "Toplist categories" });
  for (const [name, items] of groups) {
    strip.append(
      el(
        "div",
        { class: "toplist-tab-group" },
        el("h2", { class: "toplist-tab-group-title", text: name }),
        el("div", { class: "toplist-tab-links" }, ...items.map(tabLink)),
      ),
    );
  }
  return strip;
}

function rankBadge(rank: number): HTMLElement {
  return el("span", {
    class: rank <= PODIUM_RANKS ? "toplist-rank is-top" : "toplist-rank",
    text: `#${rank}`,
  });
}

function entryRow(entry: ToplistEntry): HTMLElement {
  const label =
    entry.href === null
      ? el("span", { class: "toplist-label", text: entry.label })
      : el("a", {
          class: entry.gid === null ? "toplist-label" : "toplist-label is-gallery",
          href: entry.href,
          text: entry.label,
        });

  const row = el(
    "li",
    { class: entry.gid === null ? "toplist-row" : "toplist-row is-gallery" },
    rankBadge(entry.rank),
    label,
  );
  if (entry.score !== null) {
    row.append(el("span", { class: "toplist-score", text: entry.score }));
  }
  if (entry.gid !== null) {
    const meta = el("div", { class: "toplist-meta" });
    if (entry.category) {
      meta.append(
        el("span", { class: `cat-badge ${entry.category.cls}`, text: entry.category.name }),
      );
    }
    if (entry.uploader !== null) {
      meta.append(
        entry.uploaderHref === null
          ? el("span", { text: entry.uploader })
          : el("a", { class: "toplist-uploader", href: entry.uploaderHref, text: entry.uploader }),
      );
    }
    if (entry.posted !== "") {
      meta.append(el("span", { text: entry.posted }));
    }
    if (entry.pages !== null) {
      meta.append(el("span", { text: countText(entry.pages, "page") }));
    }
    if (entry.torrentsHref !== null) {
      meta.append(
        el("a", {
          class: "toplist-torrents",
          href: entry.torrentsHref,
          "data-native": "",
          target: "_blank",
          rel: "nofollow noopener",
          text: "Torrents",
        }),
      );
    }
    if (meta.childElementCount > 0) {
      row.append(meta);
    }
  }
  return row;
}

function rowsList(entries: readonly ToplistEntry[]): HTMLOListElement {
  const rows = el("ol", { class: "toplist-rows" });
  for (const entry of entries) {
    rows.append(entryRow(entry));
  }
  return rows;
}

function sectionBlock(section: ToplistSection, index: number): HTMLElement {
  return el(
    "section",
    { class: "toplist-section", id: sectionAnchor(index), "aria-label": section.title },
    el("h2", { class: "toplist-section-title", text: section.title }),
    rowsList(section.entries),
  );
}

/** In-page jump list: the overview stacks many blocks, and the tab strip scrolls away. */
function jumpNav(
  sections: readonly ToplistSection[],
): { nav: HTMLElement; links: HTMLElement[] } | null {
  if (sections.length < 4) {
    return null;
  }
  const links = sections.map((section, index) =>
    el("a", {
      class: "toplist-jump-link",
      href: `#${sectionAnchor(index)}`,
      text: section.title,
    }),
  );
  return {
    nav: el("nav", { class: "toplist-jump", "aria-label": "Toplist sections" }, ...links),
    links,
  };
}

function summary(data: ToplistPage): string {
  if (data.kind === "category") {
    return countText(data.entries.length, "ranked entry", "ranked entries");
  }
  const selected = data.tabs.find((tab) => tab.active);
  return selected ? `${selected.group} · ${selected.label}` : "All categories";
}

function emptyState(): HTMLElement {
  return statePanel({
    text: "No toplists were found on this page.",
    actions: [nativePageAction()],
  });
}

function categoryBody(data: ToplistCategory, ctx: ViewContext): readonly HTMLElement[] {
  if (data.entries.length === 0) {
    return [emptyState()];
  }

  const nodes: HTMLElement[] = [
    el("section", { class: "toplist-section", "aria-label": data.title }, rowsList(data.entries)),
  ];
  if (data.pager) {
    nodes.push(
      pager({
        prev: data.pager.prevHref,
        next: data.pager.nextHref,
        info: `Page ${data.pager.page} of ${data.pager.pages}`,
        label: "Toplist pages",
        pages: {
          current: data.pager.page,
          total: data.pager.pages,
          href: (page) => pageHref(data.url, page, "p"),
        },
        jump: {
          current: data.pager.page,
          go: (page) => ctx.navigate(pageHref(data.url, page, "p")),
        },
      }),
    );
  }
  return nodes;
}

/** Render either toplist shape: the ranked overview blocks or one category list. */
export function renderToplist(host: HTMLElement, data: ToplistPage, ctx: ViewContext): void {
  host.replaceChildren();

  host.append(
    siteNav(ctx.signal),
    listHeader({
      title: data.kind === "category" ? data.title : "Toplists",
      summary: [el("span", { text: summary(data) })],
    }),
  );
  if (data.tabs.length > 0) {
    host.append(tabStrip(data.tabs));
  }

  switch (data.kind) {
    case "overview": {
      if (data.sections.length === 0) {
        host.append(emptyState());
        return;
      }
      const blocks = data.sections.map((section, index) => sectionBlock(section, index));
      const jump = jumpNav(data.sections);
      if (jump) {
        host.append(jump.nav);
      }
      host.append(el("div", { class: "toplist-sections" }, ...blocks));
      if (jump) {
        const activate = trackJumpRow(
          { row: jump.nav, links: jump.links, sections: blocks },
          ctx.signal,
        );
        jump.links.forEach((link, index) => {
          link.addEventListener(
            "click",
            (event) => {
              event.preventDefault();
              blocks[index]?.scrollIntoView({ block: "start" });
              history.replaceState(history.state, "", `#${sectionAnchor(index)}`);
              activate(index);
            },
            { signal: ctx.signal },
          );
        });
      }
      return;
    }
    case "category":
      host.append(...categoryBody(data, ctx));
      return;
  }
}
