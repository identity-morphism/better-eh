import type { TorrentInfo } from "../data/gallery-torrents";
import { loadTorrentInfo } from "../data/gallery-torrents";
import type { GalleryTorrent, GalleryTorrentsPage } from "../parse/gallery-torrents";
import { el } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { listHeader } from "../ui/list-header";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { countText } from "../ui/text";
import { siteNav } from "../ui/topbar";
import type { ViewContext } from "./context";

/** Loader the Details button uses; tests inject a fake, production posts through the site form. */
export type LoadTorrentInfo = (
  pageUrl: string,
  gtid: string,
  signal: AbortSignal,
) => Promise<TorrentInfo>;

export interface GalleryTorrentsViewDeps {
  loadInfo?: LoadTorrentInfo;
}

function metaItem(label: string, value: string): HTMLElement {
  return el(
    "div",
    { class: "gallery-torrent-meta-item" },
    el("span", { class: "gallery-torrent-meta-label", text: label }),
    el("span", { class: "gallery-torrent-meta-value", text: value === "" ? "—" : value }),
  );
}

function infoRow(label: string, href: string | null): HTMLElement {
  return el(
    "div",
    { class: "gallery-torrent-info-row" },
    el("span", { class: "gallery-torrent-info-label", text: label }),
    href === null
      ? el("span", { class: "gallery-torrent-info-unavailable", text: "Not available" })
      : el("a", {
          class: "gallery-torrent-info-link",
          href,
          rel: "nofollow",
          text: "Download torrent",
        }),
  );
}

function infoNodes(info: TorrentInfo): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  nodes.push(
    el(
      "div",
      { class: "gallery-torrent-info" },
      infoRow("Personalized torrent", info.personalizedHref),
      infoRow("Redistributable torrent", info.redistributableHref),
    ),
  );
  if (info.comments !== "") {
    nodes.push(el("p", { class: "gallery-torrent-comments", text: info.comments }));
  }
  return nodes;
}

function loadingPanel(): HTMLElement {
  return el(
    "div",
    { class: "gallery-torrent-details", "aria-busy": "true" },
    el("p", { class: "gallery-torrent-loading", text: "Loading torrent details…" }),
  );
}

/**
 * Build one torrent row.
 *
 * The details POST only runs when the reader asks for it, and its result is kept for the life of
 * the card: opening it again toggles the panel instead of repeating the request.
 */
function torrentCard(
  page: GalleryTorrentsPage,
  torrent: GalleryTorrent,
  ctx: ViewContext,
  loadInfo: LoadTorrentInfo,
): HTMLElement {
  const name = torrent.name === "" ? "Torrent" : torrent.name;
  const title =
    torrent.downloadHref === null
      ? el("span", { class: "gallery-torrent-name", text: name })
      : el("a", {
          class: "gallery-torrent-name",
          href: torrent.downloadHref,
          rel: "nofollow",
          title: name,
          text: name,
        });

  const detailsSlot = el("div", { class: "gallery-torrent-details-slot", hidden: "" });
  const button = el("button", {
    class: "btn btn-small gallery-torrent-details-button",
    type: "button",
    "aria-expanded": "false",
    text: "Details",
  });

  let requested = false;
  let open = false;

  const show = (visible: boolean): void => {
    open = visible;
    detailsSlot.toggleAttribute("hidden", !visible);
    button.setAttribute("aria-expanded", String(visible));
    button.textContent = visible ? "Hide details" : "Details";
  };

  button.addEventListener(
    "click",
    () => {
      if (requested) {
        show(!open);
        return;
      }

      requested = true;
      show(true);
      button.disabled = true;
      const panel = loadingPanel();
      detailsSlot.replaceChildren(panel);

      void loadInfo(page.url, torrent.gtid, ctx.signal).then(
        (info) => {
          if (ctx.signal.aborted) {
            return;
          }
          panel.removeAttribute("aria-busy");
          panel.replaceChildren(...infoNodes(info));
          button.disabled = false;
        },
        (error: unknown) => {
          if (ctx.signal.aborted) {
            return;
          }
          panel.removeAttribute("aria-busy");
          panel.replaceChildren(
            el("p", {
              class: "gallery-torrent-error",
              role: "alert",
              text: errorText(error, "Torrent details could not be loaded."),
            }),
          );
          button.disabled = false;
        },
      );
    },
    { signal: ctx.signal },
  );

  return el(
    "article",
    { class: "gallery-torrent-card" },
    el("div", { class: "gallery-torrent-head" }, title, button),
    el(
      "div",
      { class: "gallery-torrent-meta" },
      metaItem("Posted", torrent.posted),
      metaItem("Size", torrent.size),
      metaItem("Seeds", String(torrent.seeds)),
      metaItem("Peers", String(torrent.peers)),
      metaItem("Downloads", String(torrent.downloads)),
      metaItem("Uploader", torrent.uploader),
    ),
    detailsSlot,
  );
}

function backLink(page: GalleryTorrentsPage): HTMLElement | null {
  if (page.galleryHref === null) {
    return null;
  }
  return el("a", {
    class: "gallery-torrents-back",
    href: page.galleryHref,
    text: "Back to gallery",
  });
}

/**
 * Render the gallery's torrent list.
 *
 * The site presents this as a small popup; the app renders it as a normal page so the tracker links
 * and each torrent's details are readable without a second window. On a phone the meta line wraps
 * under the name, and the details panel is a full-width block under its card.
 */
export function renderGalleryTorrents(
  host: HTMLElement,
  data: GalleryTorrentsPage,
  ctx: ViewContext,
  deps: GalleryTorrentsViewDeps = {},
): void {
  host.replaceChildren();

  const loadInfo: LoadTorrentInfo = deps.loadInfo ?? loadTorrentInfo;
  const root = el(
    "div",
    { id: "gallery-torrents", class: "gallery-torrents" },
    siteNav(ctx.signal),
  );
  root.append(
    listHeader({
      title: data.title === "" ? "Gallery torrents" : data.title,
      summary: [el("span", { text: countText(data.torrents.length, "torrent") })],
    }),
  );

  const back = backLink(data);
  if (back !== null) {
    root.append(back);
  }

  if (data.torrents.length === 0) {
    root.append(
      statePanel({
        text: "No torrents were found for this gallery.",
        actions: [nativePageAction()],
      }),
    );
  } else {
    const list = el("div", { class: "gallery-torrent-list" });
    for (const torrent of data.torrents) {
      list.append(torrentCard(data, torrent, ctx, loadInfo));
    }
    root.append(list);
  }

  host.append(root);
}
