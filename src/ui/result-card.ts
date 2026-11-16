/**
 * One result card, assembled once.
 *
 * Listings, the favorites view and the preview panel all describe the same gallery, so the article,
 * its cover, title, meta rows and the favorite mark wiring live here instead of being rebuilt (and
 * drifting) in each caller.
 */

import { folderColor } from "../data/favorites";
import type { FavoriteMark, ListItem } from "../types";
import { cardFactRows } from "./card-facts";
import { cardPreview } from "./card-preview";
import { el, icon } from "./dom";
import { favoriteButton } from "./favmenu";
import { createFavoriteState } from "./favorite-state";
import type { FavoriteSnapshot } from "./favorite-state";

/**
 * Tallest card cover, as height divided by width.
 *
 * Normal portrait covers sit near 1.4. Long-strip galleries can declare a thumbnail tens of times
 * taller than wide; preserving that literally made one masonry column thousands of pixels taller
 * than its neighbours. Extreme covers are capped and top-cropped instead.
 */
const MAX_COVER_ASPECT = 2.5;

/** Apply the site's favorite treatment (folder-coloured bar) to a posted-date node. */
function setFavoriteMark(node: HTMLElement, mark: FavoriteMark | null): void {
  node.classList.toggle("is-favorite", mark !== null);
  if (mark === null) {
    node.style.removeProperty("--fav-color");
    node.removeAttribute("title");
    return;
  }
  node.style.setProperty(
    "--fav-color",
    mark.slot === null ? "var(--color-accent)" : folderColor(mark.slot),
  );
  node.title = mark.folder === "" ? "In favorites" : `In favorites: ${mark.folder}`;
}

/**
 * Cover link for a result card.
 *
 * The site serves each list thumbnail at the gallery's own aspect (portrait or landscape) and pins
 * width/height on the `<img>`; carrying those keeps the card honest instead of cropping and
 * upscaling the cover to a fixed portrait box.
 */
function cardCover(item: ListItem): HTMLElement {
  const link = el("a", {
    class: "card-cover",
    href: item.href,
    "aria-label": item.title.primary,
    tabindex: "-1",
  });
  const missing = (): void => {
    link.replaceChildren("No cover");
    link.classList.add("is-missing");
  };

  if (item.coverSrc) {
    const image = el("img", {
      src: item.coverSrc,
      alt: "",
      loading: "lazy",
      decoding: "async",
      width: item.coverSize?.width ?? null,
      height: item.coverSize?.height ?? null,
    });
    const width = item.coverSize?.width;
    const height = item.coverSize?.height;
    if (
      width !== undefined &&
      width > 0 &&
      height !== undefined &&
      height / width > MAX_COVER_ASPECT
    ) {
      link.classList.add("is-tall-cover");
    }
    image.addEventListener("error", missing, { once: true });
    link.append(image);
  } else {
    missing();
  }
  return link;
}

/**
 * Title line.
 *
 * The site prints the leading metadata ("[artist]"), the translated title and the original one as
 * one wrapped line. The card splits that into three stacked pieces: the artist line, the translated
 * title with the two-line clamp, and the original title truncated to one line.
 */
function cardTitle(item: ListItem): HTMLElement {
  const title = el("a", { class: "card-title", href: item.href });
  for (const meta of item.title.leading) {
    title.append(el("span", { class: "card-artist", text: `${meta.text} ` }));
  }
  title.append(el("span", { class: "card-primary", text: item.title.primary }));
  if (item.title.secondary) {
    // The secondary title is its own stacked line (`.card-secondary`), never a pipe-separated run.
    title.append(el("span", { class: "card-secondary", text: item.title.secondary }));
  }
  return title;
}

/**
 * Category, rating, posted time, page count and the torrent link, in the order the site's own cards
 * use.
 */
function cardMeta(item: ListItem): HTMLElement {
  const meta = el(
    "div",
    { class: "card-meta" },
    ...cardFactRows(item, (text) => {
      const posted = el("span", { class: "card-posted", text });
      setFavoriteMark(posted, item.favorite);
      return posted;
    }),
  );
  if (item.torrentsHref) {
    // The site's green arrow: rows with torrents link to the torrent popup, the rest stay plain.
    meta.append(
      el(
        "a",
        {
          class: "card-torrent",
          href: item.torrentsHref,
          "data-native": "",
          target: "_blank",
          rel: "nofollow noopener",
          title: "Show torrents",
          "aria-label": "Show torrents",
        },
        icon("download"),
      ),
    );
  }
  return meta;
}

interface ResultCardOptions {
  /** Extra control laid over the cover, e.g. a selection checkbox. */
  cover?: HTMLElement;
  /** Show the favorite button and keep the posted-date mark in step (default true). */
  favorite?: boolean;
  /** Open the preview panel from a Preview button (default false). */
  preview?: boolean;
  /** Extra line under the meta row, e.g. a favorites note. */
  note?: string;
  /** Extra class on the article (base is `card`). */
  className?: string;
}

/**
 * Build one result card.
 *
 * The card, its preview and the favorite button all read one state, so the posted-date mark and
 * every label cannot disagree after a change. `signal` is the view lifetime; it aborts the preview
 * listeners.
 */
export function resultCard(
  item: ListItem,
  signal: AbortSignal,
  options: ResultCardOptions = {},
): HTMLElement {
  const favorite = createFavoriteState(item, item.favorite);
  const meta = cardMeta(item);
  const posted = meta.querySelector<HTMLElement>(".card-posted");
  const repaint = (snapshot: FavoriteSnapshot): void => {
    if (posted === null) {
      return;
    }
    setFavoriteMark(
      posted,
      snapshot.favorited === true ? { folder: snapshot.folder ?? "", slot: snapshot.slot } : null,
    );
  };
  repaint(favorite.get());
  const unsubscribe = favorite.subscribe(repaint);
  signal.addEventListener("abort", unsubscribe, { once: true });

  const article = el("article", {
    class: options.className === undefined ? "card" : `card ${options.className}`,
  });
  const cover = el("div", { class: "card-cover-wrap" }, cardCover(item));
  if (options.favorite !== false) {
    cover.append(favoriteButton(favorite, signal));
  }
  if (options.cover) {
    cover.append(options.cover);
  }

  const body = el(
    "div",
    { class: "card-body" },
    cardTitle(item),
    item.uploader ? el("div", { class: "card-uploader", text: item.uploader }) : null,
    meta,
  );
  if (options.note) {
    body.append(el("p", { class: "favorites-note", title: options.note, text: options.note }));
  }
  if (options.preview === true) {
    body.append(cardPreview(article, item, signal, favorite));
  }

  article.append(cover, body);
  return article;
}
