import { memberId } from "../data/favorites";
import type { TorrentPage, TorrentRow, TorrentStatus } from "../parse/torrents";
import { el, searchInput } from "../ui/dom";
import { listHeader } from "../ui/list-header";
import { pageHref, pager } from "../ui/pager";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { countText } from "../ui/text";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";

const STATUS_OPTIONS: readonly { status: TorrentStatus; label: string }[] = [
  { status: "all", label: "All" },
  { status: "seeded", label: "Seeded" },
  { status: "unseeded", label: "Unseeded" },
];

interface FilterPatch {
  status?: TorrentStatus;
  mine?: boolean;
  search?: string;
}

/**
 * Clone the current URL with one filter applied.
 *
 * Every other parameter (search text, ordering) survives, while `page` is dropped because a new
 * filter starts a new result set.
 */
function filterUrl(baseUrl: string, patch: FilterPatch): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("page");

  if (patch.status !== undefined) {
    if (patch.status === "all") {
      url.searchParams.delete("s");
    } else {
      url.searchParams.set("s", patch.status);
    }
  }

  if (patch.mine === true) {
    const member = memberId();
    if (member !== null) {
      url.searchParams.set("u", member);
    }
  } else if (patch.mine === false) {
    url.searchParams.delete("u");
  }

  if (patch.search !== undefined) {
    if (patch.search.trim() === "") {
      url.searchParams.delete("search");
    } else {
      url.searchParams.set("search", patch.search.trim());
    }
  }

  return url.href;
}

/** Column sort the index exposes through `o`; null is the site's default newest-first order. */
function sortHref(baseUrl: string, key: string | null): string {
  const url = new URL(baseUrl);
  url.searchParams.delete("page");
  if (key === null) {
    url.searchParams.delete("o");
  } else {
    url.searchParams.set("o", key);
  }
  return url.href;
}

function searchForm(data: TorrentPage, ctx: ViewContext): HTMLElement {
  const input = searchInput({
    class: "field-input torrent-search-input",
    name: "search",
    value: data.search,
    placeholder: "Search torrents",
    "aria-label": "Search torrents",
  });
  const submit = el("button", { class: "btn btn-small", type: "submit", text: "Search" });
  const form = el("form", { class: "torrent-search", role: "search" }, input, submit);
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      ctx.navigate(filterUrl(data.url, { search: input.value }));
    },
    { signal: ctx.signal },
  );
  return form;
}

function statusFilter(data: TorrentPage, ctx: ViewContext): HTMLElement {
  const group = el("div", { class: "torrent-status", role: "group", "aria-label": "Status" });

  for (const option of STATUS_OPTIONS) {
    const button = el("button", {
      class: "btn btn-small torrent-filter-btn",
      type: "button",
      "aria-pressed": String(data.status === option.status),
      text: option.label,
    });
    button.addEventListener(
      "click",
      () => ctx.navigate(filterUrl(data.url, { status: option.status })),
      { signal: ctx.signal },
    );
    group.append(button);
  }

  return group;
}

function mineActive(data: TorrentPage): boolean {
  const member = memberId();
  return member !== null && data.uploaderFilter === member;
}

function mineToggle(data: TorrentPage, ctx: ViewContext): HTMLElement {
  const member = memberId();
  const input = el("input", {
    type: "checkbox",
    disabled: member === null ? "disabled" : null,
  });
  input.checked = mineActive(data);

  input.addEventListener(
    "change",
    () => ctx.navigate(filterUrl(data.url, { mine: input.checked })),
    {
      signal: ctx.signal,
    },
  );

  const label = el(
    "label",
    {
      class: "check torrent-filter-label torrent-mine",
      title: member === null ? "Sign in to see only your torrents" : "Show only your torrents",
    },
    input,
    el("span", { text: "Only my torrents" }),
  );
  if (member === null) {
    label.classList.add("is-disabled");
  }
  return label;
}

/** A filter applied by following an uploader link; it is not "my torrents" and needs a way out. */
function uploaderFilterNote(data: TorrentPage, ctx: ViewContext): HTMLElement | null {
  if (data.uploaderFilter === null || mineActive(data)) {
    return null;
  }
  const clear = el("button", {
    class: "btn btn-ghost btn-small",
    type: "button",
    text: "Clear",
  });
  clear.addEventListener("click", () => ctx.navigate(filterUrl(data.url, { mine: false })), {
    signal: ctx.signal,
  });
  return el(
    "div",
    { class: "torrent-filter-note" },
    el("span", { text: `Uploader #${data.uploaderFilter}` }),
    clear,
  );
}

function filterBar(data: TorrentPage, ctx: ViewContext): HTMLElement {
  const note = uploaderFilterNote(data, ctx);
  return el(
    "div",
    { class: "torrent-filters" },
    searchForm(data, ctx),
    el(
      "div",
      { class: "torrent-filter" },
      el("span", { class: "torrent-filter-label", text: "Status" }),
      statusFilter(data, ctx),
    ),
    mineToggle(data, ctx),
    note ?? null,
  );
}

function tableHead(data: TorrentPage): HTMLTableSectionElement {
  const row = el("tr");
  // `null` sorts by the site's default (newest first); the other keys are the site's own `o` values.
  const columns: readonly [string, string, string | null | undefined][] = [
    ["Added", "torrent-added", null],
    ["Torrent Name", "torrent-name", undefined],
    ["Gallery", "is-right torrent-gallery", undefined],
    ["Size", "is-right torrent-size", "bd"],
    ["Seeds", "is-right torrent-seeds", "sd"],
    ["Peers", "is-right torrent-peers", "dd"],
    ["DLs", "is-right torrent-downloads", "cd"],
    ["Uploader", "torrent-uploader", undefined],
  ];

  for (const [label, extra, key] of columns) {
    const cell = el("th", { class: `torrent-cell ${extra}`, scope: "col" });
    if (key === undefined) {
      cell.textContent = label;
    } else {
      const active = data.sort === key;
      cell.append(
        el("a", {
          class: active ? "torrent-sort is-active" : "torrent-sort",
          href: sortHref(data.url, key),
          text: label,
          title: key === null ? "Sort by newest" : `Sort by ${label.toLowerCase()}`,
          "aria-current": active ? "true" : null,
        }),
      );
    }
    row.append(cell);
  }

  return el("thead", {}, row);
}

function galleryCell(row: TorrentRow): HTMLTableCellElement {
  const cell = el("td", {
    class: "torrent-cell is-right torrent-gallery",
    "data-label": "Gallery",
    "aria-label": `Gallery: ${row.gid ?? "none"}`,
  });

  if (row.galleryHref !== null && row.gid !== null) {
    cell.append(el("a", { class: "torrent-link", href: row.galleryHref, text: row.gid }));
  } else {
    cell.append(el("span", { text: row.gid ?? "—" }));
  }

  return cell;
}

function uploaderCell(row: TorrentRow): HTMLTableCellElement {
  const cell = el("td", {
    class: "torrent-cell torrent-uploader",
    "data-label": "Uploader",
    "aria-label": `Uploader: ${row.uploader ?? "none"}`,
  });

  if (row.uploader === null) {
    cell.append(el("span", { text: "—" }));
  } else if (row.uploaderHref !== null) {
    cell.append(
      el("a", {
        class: "torrent-link torrent-uploader-text",
        href: row.uploaderHref,
        title: row.uploader,
        text: row.uploader,
      }),
    );
  } else {
    cell.append(
      el("span", { class: "torrent-uploader-text", title: row.uploader, text: row.uploader }),
    );
  }

  return cell;
}

function nameCell(row: TorrentRow): HTMLTableCellElement {
  const cell = el("td", { class: "torrent-cell torrent-name" });
  cell.append(
    row.torrentHref === null
      ? el("span", { class: "torrent-name-text", title: row.name, text: row.name })
      : el("a", {
          class: "torrent-name-text torrent-name-link",
          href: row.torrentHref,
          "data-native": "",
          rel: "nofollow",
          title: row.name,
          text: row.name,
        }),
  );
  return cell;
}

function torrentRow(row: TorrentRow): HTMLTableRowElement {
  return el(
    "tr",
    { class: "torrent-row" },
    el("td", {
      class: "torrent-cell torrent-added",
      "data-label": "Added",
      "aria-label": `Added: ${row.added}`,
      text: row.added,
    }),
    nameCell(row),
    galleryCell(row),
    // `data-label` draws the label when the phone layout stacks the row; `aria-label` keeps the
    // same name in the accessibility tree, where CSS generated content is not reliably exposed.
    el("td", {
      class: "torrent-cell is-right torrent-size",
      "data-label": "Size",
      "aria-label": `Size: ${row.size}`,
      text: row.size,
    }),
    el("td", {
      class: "torrent-cell is-right torrent-seeds",
      "data-label": "Seeds",
      "aria-label": `Seeds: ${row.seeds}`,
      text: String(row.seeds),
    }),
    el("td", {
      class: "torrent-cell is-right torrent-peers",
      "data-label": "Peers",
      "aria-label": `Peers: ${row.peers}`,
      text: String(row.peers),
    }),
    el("td", {
      class: "torrent-cell is-right torrent-downloads",
      "data-label": "Dls",
      "aria-label": `Downloads: ${row.downloads}`,
      text: String(row.downloads),
    }),
    uploaderCell(row),
  );
}

function torrentTable(data: TorrentPage): HTMLTableElement {
  const body = el("tbody");
  for (const row of data.rows) {
    body.append(torrentRow(row));
  }
  return el(
    "table",
    { class: "torrent-table" },
    el("caption", { class: "sr-only", text: "Torrents" }),
    tableHead(data),
    body,
  );
}

/** Render the torrent index with its filters, table and numeric pager. */
export function renderTorrents(host: HTMLElement, data: TorrentPage, ctx: ViewContext): void {
  host.replaceChildren();

  const header = listHeader({
    title: "Torrents",
    summary: [
      el("span", {
        text: data.summary ?? countText(data.rows.length, "torrent"),
      }),
    ],
  });

  const filtered = data.search !== "" || data.status !== "all" || data.uploaderFilter !== null;
  const body =
    data.rows.length === 0
      ? statePanel({
          text: filtered
            ? "No torrents match this filter."
            : "No torrents were found on this page.",
          actions: [
            ...(filtered ? [{ label: "Clear filters", primary: true, href: "/torrents.php" }] : []),
            nativePageAction(),
          ],
        })
      : el("div", { class: "torrent-table-wrap" }, torrentTable(data));

  host.append(siteNav(ctx.signal), header, filterBar(data, ctx), body);

  // The site's own pager shows the first and last page, so its last number is the page count.
  const total = data.pages[data.pages.length - 1] ?? data.page;
  if (total > 1) {
    host.append(
      pager({
        label: "Torrent pages",
        prev: null,
        next: null,
        pages: {
          current: data.page,
          total,
          href: (page) => pageHref(data.url, page, "page"),
        },
        jump: {
          current: data.page,
          go: (page) => ctx.navigate(pageHref(data.url, page, "page")),
        },
      }),
    );
  }
}
