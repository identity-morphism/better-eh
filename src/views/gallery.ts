import type { CommentTransports, GalleryActionDeps } from "../data/gallery-actions";
import { voteTag } from "../data/gallery-actions";
import type { MyTagChange } from "../data/my-tags";
import { applyMyTag, lookupUserTag } from "../data/my-tags";
import { clearResume, getResume } from "../data/resume";
import type { DocumentOptions, HtmlResponse } from "../fetch/loader";
import { loader } from "../fetch/loader";
import { priorityOf } from "../net/priority";
import { formatPageRange, parseGalleryPage } from "../parse/gallery";
import { buildSearchUrl } from "../parse/query";
import { galleryGid } from "../parse/url";
import {
  getSearchDraft,
  setSearchDraftText,
  setSearchQuery,
  subscribeSearchDraft,
} from "../search-draft";
import { isLoggedIn } from "../session";
import { SITE_PATHS } from "../site";
import { toggleTagInSearch } from "../tags/model";
import type { GalleryApiConfig, GalleryData, GalleryThumb } from "../types";
import type { ActionMenuItem } from "../ui/action-menu";
import { bindContextMenu, openActionMenu } from "../ui/action-menu";
import { appendChildren, buttonEl, el, icon } from "../ui/dom";
import { favoriteButton } from "../ui/favmenu";
import { createFavoriteState } from "../ui/favorite-state";
import { commentsSection } from "../ui/gallery-comments";
import type { CommentSectionDeps } from "../ui/gallery-comments";
import { ratingControl } from "../ui/gallery-rating";
import { createTagRow } from "../ui/gallery-tag-row";
import type { TagRow, TagRowActions } from "../ui/gallery-tag-row";
import type { PageSource } from "../ui/page-cursor";
import { createPagedRegion } from "../ui/paged-region";
import { pager } from "../ui/pager";
import { openPopup } from "../ui/popup-window";
import { starRow } from "../ui/stars";
import { nativeEmptyPanel, nativePageAction } from "../ui/state-panel";
import { countText } from "../ui/text";
import { titleNodes } from "../ui/title";
import { showToast } from "../ui/toast";
import { renderTopbar } from "../ui/topbar";
import { bindViewScale } from "../ui/view-scale";
import type { ViewContext } from "./context";

/** Optional transports so tests can drive mutations and refreshes without the network. */
export interface GalleryViewDeps extends GalleryActionDeps, CommentTransports {
  /** Re-fetch the gallery document after a mutation; defaults to the shared loader. */
  loadDocument?: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  /** Route-owned next-page source for appended thumbnail pages. */
  pageSource?: PageSource<GalleryThumb>;
}

/** Probe an image URL without inserting it, reporting the failure through `onError`. */
function probeImage(src: string, onError: () => void): void {
  const probe = el("img", { alt: "" });
  probe.addEventListener("error", onError, { once: true });
  probe.src = src;
}

function cover(data: GalleryData): HTMLElement {
  const node = el("div", { class: "gallery-cover" });
  if (!data.coverSrc) {
    node.classList.add("is-missing");
    node.textContent = "No cover";
    return node;
  }
  // The site's cover keeps whatever aspect `#gd1` declares: usually portrait, but a gallery whose
  // first page is landscape gets a landscape cover. Painting it as a CSS background with
  // `background-size: cover` in a fixed portrait box crops and upscales it, so pass the declared
  // size to the image and let it keep its own aspect.
  const image = el("img", {
    src: data.coverSrc,
    alt: "",
    decoding: "async",
    fetchpriority: "high",
    width: data.coverSize?.width ?? null,
    height: data.coverSize?.height ?? null,
  });
  image.addEventListener(
    "error",
    () => {
      node.classList.add("is-missing");
      node.textContent = "No cover";
    },
    { once: true },
  );
  node.append(image);
  return node;
}

/** Anonymous pages carry `apiuid = -1`; every mutation control stays hidden there. */
function writableConfig(data: GalleryData): GalleryApiConfig | null {
  const config = data.apiConfig;
  return config !== null && config.apiUid !== "-1" ? config : null;
}

/** Signed-in site pages for the gallery, plus the reader's own escape hatch. */
function siteActionItems(data: GalleryData): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  const { archiverHref, torrentsHref, reportHref, expungeHref, renameHref } = data.actions;
  if (archiverHref !== null) {
    items.push({ label: "Archive Download", href: archiverHref });
  }
  if (torrentsHref !== null) {
    items.push({ label: "Torrent Download", href: torrentsHref });
  }
  if (reportHref !== null) {
    items.push({ label: "Report Gallery", href: reportHref, native: true });
  }
  if (expungeHref !== null) {
    items.push({ label: "Petition to Expunge", href: expungeHref, native: true });
  }
  if (renameHref !== null) {
    items.push({
      label: "Petition to Rename",
      href: renameHref,
      native: true,
      popup: { width: 675, height: 415 },
    });
  }
  items.push(nativePageAction());
  return items;
}

/** The site's own action column, rendered beside the details on wide screens. */
function siteActionRail(items: readonly ActionMenuItem[]): HTMLElement {
  const rail = el("nav", { class: "gallery-rail", "aria-label": "Site actions" });
  rail.append(el("span", { class: "rail-label", text: "Site actions" }));
  for (const item of items) {
    if (item.href === undefined) {
      continue;
    }
    // Same affordance as the More menu, without an external glyph: these are site pages, not
    // another host.
    const href = item.href;
    const popup = item.popup;
    rail.append(
      el(
        "a",
        {
          class: "rail-link",
          href,
          "data-native": item.native === true ? "" : null,
          onclick: popup
            ? (event: Event) => {
                event.preventDefault();
                openPopup(href, popup.width, popup.height);
              }
            : null,
        },
        el("span", { text: item.label }),
      ),
    );
  }
  return rail;
}

function thumbTile(thumb: GalleryThumb): HTMLElement {
  const tile = el("a", {
    class: "thumb",
    href: thumb.href,
    "aria-label": `Page ${thumb.label}`,
  });
  tile.style.aspectRatio = `${thumb.width} / ${thumb.height}`;
  tile.style.setProperty("--sprite-x", `${thumb.x}px`);
  tile.style.setProperty("--sprite-w", `${thumb.width}px`);
  tile.style.setProperty("--sprite-count", String(thumb.spriteCount));
  tile.dataset.sprite = thumb.sprite;
  return el(
    "div",
    { class: "thumb-cell" },
    tile,
    el("span", { class: "thumb-page", text: `Page ${thumb.label}`, "aria-hidden": "true" }),
  );
}

function readAction(data: GalleryData): { href: string; label: string } | null {
  const url = new URL(data.url);
  const page = Number.parseInt(url.searchParams.get("p") ?? "0", 10) || 0;

  if (page === 0) {
    return data.firstPageHref ? { href: data.firstPageHref, label: "Read" } : null;
  }

  url.searchParams.delete("p");
  return { href: url.href, label: "Start from page 1" };
}

/**
 * Offer the last page read in this gallery. A small clear control removes the record without
 * opening the page; the entry expires on its own after {@link RESUME_TTL_MS}.
 */
function resumeAction(data: GalleryData, ctx: ViewContext): HTMLElement | null {
  const entry = getResume(data.url);
  if (entry === null) {
    return null;
  }
  const link = el(
    "a",
    {
      class: "btn btn-ghost gallery-resume",
      href: entry.pageUrl,
      title: `${entry.counterText} · saved ${new Date(entry.savedAt).toLocaleDateString()}`,
    },
    el("span", { text: `Resume page ${entry.pageNum}` }),
    icon("arrowRight"),
  );
  const clear = buttonEl({
    class: "gallery-resume-clear",
    text: "×",
    "aria-label": "Clear saved reading position",
    title: "Clear saved reading position",
  });
  const group = el("span", { class: "gallery-resume-group" }, link, clear);
  clear.addEventListener(
    "click",
    () => {
      clearResume(data.url);
      group.remove();
      showToast("Saved reading position cleared");
    },
    { signal: ctx.signal },
  );
  return group;
}

/** Render a gallery detail page. */
export function renderGallery(
  host: HTMLElement,
  data: GalleryData,
  ctx: ViewContext,
  deps: GalleryViewDeps = {},
): void {
  host.replaceChildren();

  let tagRow: TagRow | null = null;
  const topbar = renderTopbar({
    onSearch: (text) => {
      const next = { ...getSearchDraft().query, text };
      setSearchQuery(next);
      ctx.navigate(buildSearchUrl(next));
    },
    draftChips: true,
    signal: ctx.signal,
  });

  // Tag clicks and chip edits only touch the draft; every chip's link and applied state follows.
  const unsubscribe = subscribeSearchDraft(() => {
    tagRow?.refresh();
  });
  ctx.signal.addEventListener("abort", unsubscribe, { once: true });

  // The header button and the favorite count both read this one state, so a change made from
  // either surface keeps them in step without re-reading the page.
  const favoriteState = createFavoriteState(data, data.favorite, isLoggedIn());
  const favorite = favoriteButton(favoriteState, ctx.signal);
  const config = writableConfig(data);
  const siteItems = siteActionItems(data);
  const openSiteMenu = (anchor: HTMLElement): void => {
    openActionMenu({ anchor, label: "Site actions", items: siteItems, signal: ctx.signal });
  };

  const read = readAction(data);
  const resume = resumeAction(data, ctx);
  const actions = el(
    "div",
    { class: "gallery-actions" },
    read
      ? el(
          "a",
          { class: "btn btn-primary", href: read.href },
          el("span", { text: read.label }),
          icon("arrowRight"),
        )
      : el("span", { class: "btn is-disabled", text: "No pages" }),
    resume,
    favorite,
  );

  const meta = el("div", { class: "gallery-meta" });
  if (data.category) {
    meta.append(el("span", { class: `cat-badge ${data.category.cls}`, text: data.category.name }));
  }
  if (data.uploader) {
    meta.append(
      el("a", {
        class: "meta-link meta-dot",
        href: data.uploader.href,
        text: data.uploader.name,
      }),
    );
  }
  if (data.posted) {
    meta.append(el("span", { class: "meta-dot", text: data.posted }));
  }
  if (data.pageCount) {
    meta.append(el("span", { class: "meta-dot", text: countText(data.pageCount, "page") }));
  }
  if (data.size) {
    meta.append(el("span", { class: "meta-dot", text: data.size }));
  }
  // Signed-in pages carry the interactive rating control, which already shows the average; guests
  // get the same star row the result cards use.
  if (data.rating !== null && config === null) {
    const stars = starRow(data.rating);
    if (stars !== null) {
      stars.classList.add("meta-dot");
      meta.append(stars);
    }
    if (data.ratingCount) {
      meta.append(el("span", { class: "meta-dot", text: countText(data.ratingCount, "vote") }));
    }
  }
  if (data.favCount !== null) {
    const baseCount = data.favCount;
    const favoritedAtLoad = favoriteState.get().favorited === true;
    const count = el("span", { class: "meta-dot", text: countText(baseCount, "favorite") });
    const unsubscribeCount = favoriteState.subscribe((snapshot) => {
      const favorited = snapshot.favorited === true;
      const total =
        favorited === favoritedAtLoad ? baseCount : Math.max(0, baseCount + (favorited ? 1 : -1));
      count.textContent = countText(total, "favorite");
    });
    ctx.signal.addEventListener("abort", unsubscribeCount, { once: true });
    meta.append(count);
  }
  if (data.parentHref) {
    const parentGid = galleryGid(data.parentHref);
    meta.append(
      el("a", {
        class: "meta-link meta-dot",
        href: data.parentHref,
        text: parentGid === null ? "Parent gallery" : `Parent: ${parentGid}`,
      }),
    );
  }
  // "Visible: Yes" is the default and says nothing; a hidden gallery does.
  if (data.visible !== null && data.visible !== "Yes") {
    meta.append(el("span", { class: "meta-dot", text: `Visible: ${data.visible}` }));
  }

  const rating =
    config === null
      ? null
      : ratingControl({ config, rating: data.ratingInfo, post: deps.post, signal: ctx.signal });

  // Right-clicking the title opens the same menu as the rail's native escape hatch. The title is
  // programmatically focusable so closing the menu can return focus to it.
  const title = el("h1", { class: "gallery-title", tabindex: "-1" }, titleNodes(data.title));
  if (data.alternateTitle !== null) {
    // The site prints the original title inline after the translated one; `.title-primary` is the
    // block that owns the title line.
    title
      .querySelector(".title-primary")
      ?.append(el("span", { class: "title-alt", text: ` · ${data.alternateTitle}` }));
  }
  bindContextMenu(title, () => openSiteMenu(title), ctx.signal);

  const details = el("div", { class: "gallery-details" }, title, meta, rating ?? null, actions);

  const header = el(
    "section",
    { class: "gallery-header" },
    cover(data),
    details,
    siteActionRail(siteItems),
  );

  const grid = el("div", { class: "thumb-grid" });
  for (const thumb of data.thumbs) {
    grid.append(thumbTile(thumb));
  }

  const emptyThumbs =
    data.thumbs.length === 0
      ? nativeEmptyPanel("No page thumbnails found for this gallery.")
      : null;

  const load =
    deps.loadDocument ??
    ((url, documentOptions) =>
      loader.document(url, { priority: priorityOf("navigation"), ...documentOptions }));

  const fetchGallery = async (): Promise<GalleryData | null> => {
    const response = await load(data.url, { fresh: true, signal: ctx.signal });
    if (ctx.signal.aborted) {
      return null;
    }
    return parseGalleryPage(response.doc, response.url);
  };

  /** The one fresh fetch+parse of the gallery page used by post-mutation refreshes. */
  let pendingReload: Promise<GalleryData | null> | null = null;
  const reload = (): Promise<GalleryData | null> => {
    if (pendingReload !== null) {
      return pendingReload;
    }
    const run = fetchGallery();
    pendingReload = run;
    const settle = (): void => {
      if (pendingReload === run) {
        pendingReload = null;
      }
    };
    run.then(settle, settle);
    return run;
  };

  const commentDeps: CommentSectionDeps = {
    post: deps.post,
    postComment: deps.postComment,
    editComment: deps.editComment,
    refresh: async (page) => {
      if (page !== undefined) {
        replaceComments(parseGalleryPage(page.doc, page.url));
        return;
      }
      const next = await reload();
      if (next !== null) {
        replaceComments(next);
      }
    },
  };

  let commentsNode: HTMLElement | null = null;

  const buildComments = (source: GalleryData): HTMLElement | null =>
    source.comments.length > 0 || config !== null
      ? commentsSection({
          data: source,
          config,
          deps: commentDeps,
          signal: ctx.signal,
        })
      : null;

  function replaceComments(next: GalleryData): void {
    const section = buildComments(next);
    if (section === null) {
      return;
    }
    if (commentsNode === null) {
      host.append(section);
    } else {
      commentsNode.replaceWith(section);
    }
    commentsNode = section;
    // This only runs after a successful post. The old composer (and the submit button that held
    // focus) is gone, so leave the caret in the fresh composer instead of dropping it on <body>.
    section.querySelector<HTMLTextAreaElement>(".comment-input")?.focus();
  }

  const runTagVote = async (tag: string, vote: 1 | -1): Promise<void> => {
    if (config === null) {
      return;
    }
    // The tag row renders no vote state, so the vote is the only network work.
    await voteTag(config, tag, vote, { post: deps.post });
  };

  const runTagVoteBatch = async (tags: string): Promise<void> => {
    if (config === null) {
      return;
    }
    await voteTag(config, tags, 1, { post: deps.post });
  };

  const runMyTag = async (tag: string, change: MyTagChange): Promise<void> => {
    if (config === null) {
      return;
    }
    const result = await applyMyTag(tag, change, {
      config,
      myTagsUrl: new URL(SITE_PATHS.myTags, data.url).href,
      existing: lookupUserTag(tag),
      loadDocument: load,
      post: deps.post,
      signal: ctx.signal,
    });
    showToast(result === "added" ? "Tag added to My Tags" : "My Tags updated");
  };

  const tagActions: TagRowActions = {
    href: (token, sign) => {
      const current = getSearchDraft();
      return buildSearchUrl({
        ...current.query,
        text: toggleTagInSearch(current.text, token, sign, false),
      });
    },
    add: (token, sign) => {
      setSearchDraftText(toggleTagInSearch(getSearchDraft().text, token, sign));
    },
    // Rejections stay with the caller: the tag menu reports them inline.
    vote: (tag, vote) => runTagVote(tag, vote),
    addTags: (tags) => runTagVoteBatch(tags),
    watchTag: (tag) => runMyTag(tag, { watched: true }),
    hideTag: (tag) => runMyTag(tag, { hidden: true }),
    colorTag: (tag, color) => runMyTag(tag, { color }),
    config,
    text: () => getSearchDraft().text,
  };

  tagRow = createTagRow(data, tagActions, ctx.signal);

  commentsNode = buildComments(data);

  // Load sprite sheets only when tiles approach the viewport; probe each sheet once so a missing
  // sprite shows the tile's page number instead of an empty box. Tiles appended by infinite scroll
  // go through the same path.
  const missingSprites = new Set<string>();
  const probedSprites = new Set<string>();
  const spriteObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const tile = entry.target as HTMLElement;
        const sprite = tile.dataset.sprite;
        if (sprite) {
          tile.style.backgroundImage = `url("${sprite}")`;
          tile.classList.add("is-loaded");
        }
        spriteObserver.unobserve(tile);
      }
    },
    { rootMargin: "800px 0px" },
  );
  ctx.signal.addEventListener("abort", () => spriteObserver.disconnect(), { once: true });

  const enhanceTiles = (cells: readonly HTMLElement[]): void => {
    for (const cell of cells) {
      const tile = cell.querySelector<HTMLElement>(".thumb");
      const sprite = tile?.dataset.sprite;
      if (!tile || !sprite) {
        continue;
      }
      if (missingSprites.has(sprite)) {
        tile.classList.add("is-missing");
        continue;
      }
      if (!probedSprites.has(sprite)) {
        probedSprites.add(sprite);
        probeImage(sprite, () => {
          missingSprites.add(sprite);
          for (const candidate of grid.querySelectorAll<HTMLElement>(".thumb")) {
            if (candidate.dataset.sprite === sprite) {
              candidate.classList.add("is-missing");
              spriteObserver.unobserve(candidate);
            }
          }
        });
      }
      spriteObserver.observe(tile);
    }
  };
  enhanceTiles([...grid.children] as HTMLElement[]);

  const navigation = el("div", { class: "gallery-paging" });
  // The site prints the page summary and pager immediately above the thumbnails.
  appendChildren(host, [topbar, header, tagRow?.element ?? null, emptyThumbs ?? navigation]);
  if (data.thumbs.length > 0) {
    host.append(grid);
  }
  appendChildren(host, [commentsNode]);

  // Appended pages grow the grid, so the site's "Showing A - B of C" line must grow with it. Track
  // the appended count rather than the DOM's tiles: the site's range is the authority, and a page
  // can carry fewer (or more) tiles than its range implies.
  const pageRange = data.pageRange;
  let appendedThumbs = 0;
  const syncSummary = (): void => {
    const info = navigation.querySelector<HTMLElement>(".pager-info");
    if (info === null || pageRange === null || pageRange.total === 0) {
      return;
    }
    info.textContent = formatPageRange({
      ...pageRange,
      end: Math.min(pageRange.total, pageRange.end + appendedThumbs),
    });
  };

  if (emptyThumbs === null) {
    createPagedRegion<GalleryThumb>({
      signal: ctx.signal,
      next: data.nextHref,
      initial: data.thumbs,
      key: (thumb) => thumb.href,
      noun: "gallery pages",
      enabled: (settings) => settings.galleryInfiniteScroll,
      slot: navigation,
      onSync: syncSummary,
      pager: (withNext) => {
        const node = pager({
          prev: data.prevHref,
          // Scrolling loads the thumbnail pages the site's Next link would open.
          next: withNext ? data.nextHref : null,
          info: data.pageSummary,
          label: "Gallery pages",
        });
        node.classList.add("is-above");
        return node;
      },
      load: (url, signal) => {
        if (deps.pageSource === undefined) {
          return Promise.reject(new Error("No next-page source for this gallery route."));
        }
        return deps.pageSource(url, signal);
      },
      append: (thumbs) => {
        const cells = thumbs.map((thumb) => thumbTile(thumb));
        grid.append(...cells);
        enhanceTiles(cells);
        appendedThumbs += thumbs.length;
        return () => {
          for (const cell of cells) {
            cell.remove();
          }
          appendedThumbs -= thumbs.length;
        };
      },
      placeSentinel: (node) => {
        if (!node.hidden) {
          grid.after(node);
        }
      },
    });
  }

  bindViewScale({
    signal: ctx.signal,
    apply: (settings) => {
      const itemWidth = data.thumbs[0]?.width ?? 100;
      // Never upscale a sprite cell: the site serves gallery thumbnails at a fixed 200px width, so a
      // larger setting would only blur them.
      const size = Math.min(window.innerWidth <= 720 ? 110 : settings.galleryThumbSize, itemWidth);
      grid.style.setProperty("--thumb-size", `${size}px`);
      grid.style.setProperty("--gap", `${settings.gap}px`);
      grid.style.setProperty("--scale", String(size / itemWidth));
    },
  });
}
