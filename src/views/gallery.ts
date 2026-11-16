import { isLoggedIn } from "../data/favorites";
import type { GalleryActionDeps } from "../data/gallery-actions";
import { postComment, voteTag } from "../data/gallery-actions";
import type { MyTagChange } from "../data/my-tags";
import { applyMyTag } from "../data/my-tags";
import { clearResume, getResume } from "../data/resume";
import type { DocumentOptions, HtmlResponse } from "../fetch/loader";
import { loader } from "../fetch/loader";
import { priorityOf } from "../net/priority";
import { formatPageRange, parseGalleryPage } from "../parse/gallery";
import { buildSearchUrl, tagTokenFromHref } from "../parse/query";
import { galleryGid } from "../parse/url";
import {
  getSearchDraft,
  setSearchDraftText,
  setSearchQuery,
  subscribeSearchDraft,
} from "../search-draft";
import type { SearchTerm, TagSign } from "../tags/model";
import { fold, parseSearchTerms, tagIdentity, toggleTagInSearch } from "../tags/model";
import type { GalleryApiConfig, GalleryData, GalleryThumb, TagRef } from "../types";
import type { ActionMenuItem } from "../ui/action-menu";
import { bindContextMenu, openActionMenu } from "../ui/action-menu";
import { appendChildren, el, icon, tagInput } from "../ui/dom";
import { errorText } from "../ui/error-text";
import { favoriteButton } from "../ui/favmenu";
import { createFavoriteState } from "../ui/favorite-state";
import { commentsSection } from "../ui/gallery-comments";
import type { CommentSectionDeps } from "../ui/gallery-comments";
import { ratingControl } from "../ui/gallery-rating";
import { openTagMenu } from "../ui/gallery-tag-menu";
import { createPagedRegion } from "../ui/paged-region";
import { pager } from "../ui/pager";
import { openPopup } from "../ui/popup-window";
import { starRow } from "../ui/stars";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { countText } from "../ui/text";
import { titleNodes } from "../ui/title";
import { showToast } from "../ui/toast";
import { renderTopbar } from "../ui/topbar";
import { bindViewScale } from "../ui/view-scale";
import type { PageSource, ViewContext } from "./context";

/** Optional transports so tests can drive mutations and refreshes without the network. */
export interface GalleryViewDeps extends GalleryActionDeps {
  /** Re-fetch the gallery document after a mutation; defaults to the shared loader. */
  loadDocument?: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  /** Route-owned next-page source for appended thumbnail pages. */
  pageSource?: PageSource<GalleryThumb>;
  /** Submit the native comment form; defaults to the real endpoint. */
  postComment?: (url: string, text: string, signal?: AbortSignal) => Promise<void>;
  /** Save an edited comment; defaults to the native edit endpoint. */
  editComment?: (
    url: string,
    commentId: number,
    text: string,
    signal?: AbortSignal,
  ) => Promise<void>;
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

interface TagActions {
  /** URL for a modified click, reflecting the live draft query. */
  href: (token: string, sign: TagSign) => string;
  /** Add, toggle or exclude the tag in the draft query. */
  add: (token: string, sign: TagSign) => void;
  /** Vote on the raw `namespace:tag` form, or add a comma-separated batch. */
  vote: (tag: string, vote: 1 | -1) => Promise<void>;
  addTags: (tags: string) => Promise<void>;
  /** Undefined on anonymous pages, which hide the tag menu. */
  config: GalleryApiConfig | null;
  /** My Tags mutations; undefined for anonymous pages. */
  watchTag?: (tag: string) => Promise<void>;
  hideTag?: (tag: string) => Promise<void>;
  colorTag?: (tag: string, color: string) => Promise<void>;
}

interface TagSection {
  element: HTMLElement;
  /** Recompute every link and applied state against the current draft query. */
  refresh: () => void;
}

/** Whether two terms name the same tag, regardless of alias, quoting or exact marker. */
function sameTag(a: SearchTerm, b: SearchTerm): boolean {
  if (a.nsRaw === null || b.nsRaw === null) {
    return a.nsRaw === b.nsRaw && fold(a.value) === fold(b.value);
  }
  const aNs = a.ns ?? a.nsRaw;
  const bNs = b.ns ?? b.nsRaw;
  return tagIdentity(aNs, a.value) === tagIdentity(bNs, b.value);
}

function tagState(term: SearchTerm): string {
  if (term.sign === "-") {
    return " — excluded from the search";
  }
  if (term.sign === "~") {
    return " — optional (OR) in the search";
  }
  return " — in the search";
}

/** Sentence-case the state phrase used inside a tooltip. */
function stateTitle(term: SearchTerm): string {
  const state = tagState(term).replace(/^ — /u, "");
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

/**
 * What a plain click does to a tag already in the query.
 *
 * An included or optional tag is dropped; an excluded tag is flipped back to inclusion. Saying
 * "remove" for every applied state sent excluded terms the wrong way.
 */
function tagHint(match: SearchTerm | undefined, actionsHint: string): string {
  if (match === undefined) {
    return `Click to add to search · Alt-click to exclude · Middle-click for results${actionsHint}`;
  }
  const click = match.sign === "-" ? "Click to include" : "Click to remove";
  const alt = match.sign === "-" ? "Alt-click to remove" : "Alt-click to exclude";
  return `${stateTitle(match)} · ${click} · ${alt} · Middle-click for results${actionsHint}`;
}

/** The tag plus the site's editorial note, for screen readers and the full-string tooltip. */
function tagLabel(tag: TagRef): string {
  return tag.note === null ? tag.name : `${tag.name} — ${tag.note}`;
}

/** Keep the site's original `name | note` string as context ahead of the interaction hint. */
function tagTitle(tag: TagRef, hint: string): string {
  return tag.note === null ? hint : `${tag.name} | ${tag.note} · ${hint}`;
}

function tagSection(data: GalleryData, actions: TagActions, ctx: ViewContext): TagSection {
  const section = el("section", { class: "tag-section", "aria-label": "Tags" });
  section.append(el("h2", { class: "tag-title", text: "Tags" }));
  const links: Array<{
    chip: HTMLAnchorElement;
    token: string;
    target: SearchTerm | null;
    tag: TagRef;
  }> = [];
  const actionsHint = actions.config === null ? "" : " · Right-click for tag actions";

  const refresh = (): void => {
    const terms = parseSearchTerms(getSearchDraft().text);
    for (const { chip, token, target, tag } of links) {
      chip.setAttribute("href", actions.href(token, ""));
      if (target === null) {
        continue;
      }
      const match = terms.find((term) => sameTag(term, target));
      chip.classList.toggle("is-added", match !== undefined);
      chip.classList.toggle("is-excluded", match?.sign === "-");
      chip.classList.toggle("is-or", match?.sign === "~");
      chip.title = tagTitle(tag, tagHint(match, actionsHint));
      const label = tagLabel(tag);
      chip.setAttribute(
        "aria-label",
        match === undefined ? label : `${label} — ${tagState(match).replace(/^ — /u, "")}`,
      );
    }
  };

  for (const group of data.tags) {
    const chips = el("div", { class: "tag-chips" });
    const nsClass = group.ns.replace(/[^a-z0-9_-]/gi, "");

    for (const tag of group.tags) {
      const token = tagTokenFromHref(tag.href, data.url);
      const target = token === null ? null : (parseSearchTerms(token)[0] ?? null);
      const chip = el(
        "a",
        {
          class: `tag-chip ns-${nsClass}`,
          href: token ? actions.href(token, "") : tag.href,
          "data-tag": `${group.ns}:${tag.name}`,
          title: tagTitle(
            tag,
            token ? tagHint(undefined, actionsHint) : `Open tag search${actionsHint}`,
          ),
          "aria-label": tag.note === null ? null : tagLabel(tag),
        },
        el("span", { class: "tag-name", text: tag.name }),
        tag.note === null ? null : el("span", { class: "tag-note", text: tag.note }),
      );
      if (actions.config !== null) {
        // The tag menu lives on the right button; it keeps the chip row compact.
        chip.setAttribute("aria-haspopup", "dialog");
      }

      if (token) {
        links.push({ chip, token, target, tag });
        const sign = (event: MouseEvent): TagSign => (event.altKey ? "-" : "");
        // Modified clicks open a new tab; refresh the href first so it carries draft tags.
        chip.addEventListener(
          "pointerdown",
          (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
            }
          },
          { signal: ctx.signal },
        );
        chip.addEventListener(
          "click",
          (event) => {
            if (event.button !== 0) {
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
              return;
            }
            event.preventDefault();
            actions.add(token, sign(event));
          },
          { signal: ctx.signal },
        );
      }

      if (actions.config !== null) {
        const openMenu = (): void => {
          openTagMenu(
            chip,
            { ns: group.ns, name: tag.name },
            tag.href,
            {
              vote: actions.vote,
              addTags: actions.addTags,
              add: actions.add,
              token,
              watchTag: actions.watchTag,
              hideTag: actions.hideTag,
              colorTag: actions.colorTag,
            },
            ctx.signal,
          );
        };
        bindContextMenu(chip, openMenu, ctx.signal);
        // Touch has no right-click. A visible trigger appears only on coarse/no-hover pointers, so
        // the desktop chip row stays a single line of tags.
        const trigger = el(
          "button",
          {
            class: "tag-menu-trigger",
            type: "button",
            "aria-label": `Tag actions for ${tag.name}`,
            "aria-haspopup": "dialog",
            title: "Tag actions",
            onclick: openMenu,
          },
          "⋯",
        );
        chips.append(el("span", { class: "tag-chip-wrap" }, chip, trigger));
      } else {
        chips.append(chip);
      }
    }

    section.append(
      el(
        "div",
        { class: "tag-row" },
        el("span", { class: `tag-ns ns-${nsClass}`, text: `${group.ns}:` }),
        chips,
      ),
    );
  }

  // The site's own tag form, so adding a tag is not hidden behind the per-tag menu.
  if (actions.config !== null) {
    const input = tagInput("field-input tag-add-input");
    const submit = el("button", { class: "btn btn-small", type: "submit", text: "Add tags" });
    const form = el("form", { class: "tag-add" }, input, submit);
    let adding = false;
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "" || adding) {
          return;
        }
        // Disabling the focused submit button would drop focus to <body>, and the refresh below
        // then has no idea the composer held it. Keep it enabled and guard the request instead.
        adding = true;
        submit.textContent = "Adding…";
        void actions
          .addTags(value)
          .then(() => {
            input.value = "";
          })
          .catch((error: unknown) => {
            // Keep the text so the action can be retried from the composer.
            if (!ctx.signal.aborted) {
              showToast(errorText(error));
            }
          })
          .finally(() => {
            adding = false;
            submit.textContent = "Add tags";
          });
      },
      { signal: ctx.signal },
    );
    // The composer starts in the chip column, under the namespace labels.
    section.append(
      el(
        "div",
        { class: "tag-row tag-add-row" },
        el("span", { class: "tag-ns", "aria-hidden": "true" }),
        form,
      ),
    );
  }

  refresh();

  return { element: section, refresh };
}

/** Signed-in site pages for the gallery, plus the reader's own escape hatch. */
function siteActionItems(data: GalleryData): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  const { archiverHref, torrentsHref, reportHref, expungeHref, renameHref } = data.actions;
  if (archiverHref !== null) {
    items.push({
      label: "Archive Download",
      href: archiverHref,
      native: true,
      popup: { width: 480, height: 320 },
    });
  }
  if (torrentsHref !== null) {
    items.push({
      label: "Torrent Download",
      href: torrentsHref,
      native: true,
      popup: { width: 610, height: 590 },
    });
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
    // another host, even though they load outside the app.
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
  const clear = el("button", {
    class: "gallery-resume-clear",
    type: "button",
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

  let tagsSection: TagSection | null = null;
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
    tagsSection?.refresh();
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
      ? statePanel({
          text: "No page thumbnails found for this gallery.",
          actions: [nativePageAction()],
        })
      : null;

  const load =
    deps.loadDocument ??
    ((url, documentOptions) =>
      loader.document(url, { priority: priorityOf("navigation"), ...documentOptions }));

  /** The one fresh fetch+parse of the gallery page used by post-mutation refreshes. */
  const reload = async (): Promise<GalleryData | null> => {
    const response = await load(data.url, { fresh: true, signal: ctx.signal });
    if (ctx.signal.aborted) {
      return null;
    }
    return parseGalleryPage(response.doc, response.url);
  };

  const commentDeps: CommentSectionDeps = {
    post: deps.post,
    postComment: deps.postComment ?? postComment,
    editComment: deps.editComment,
    refresh: async () => {
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

  const refreshTags = async (): Promise<void> => {
    const next = await reload();
    if (next === null) {
      return;
    }
    const nextSection = buildTags(next);
    if (nextSection === null) {
      return;
    }

    // The refresh replaces every chip, including the one whose menu (or the composer) held focus.
    // Remember which tag the user was acting on so it can take focus back afterwards.
    const previous = tagsSection?.element ?? null;
    let restoreTag: string | null = null;
    let restoreComposer = false;
    if (previous !== null) {
      const openChip = previous.querySelector<HTMLElement>('.tag-chip[aria-expanded="true"]');
      if (openChip?.dataset.tag !== undefined) {
        restoreTag = openChip.dataset.tag;
      } else {
        const active = document.activeElement;
        if (active != null && previous.contains(active)) {
          const chip = active.closest<HTMLElement>(".tag-chip");
          if (chip?.dataset.tag === undefined) {
            restoreComposer = true;
          } else {
            restoreTag = chip.dataset.tag;
          }
        }
      }
    }

    if (tagsSection === null) {
      host.insertBefore(nextSection.element, grid);
    } else {
      tagsSection.element.replaceWith(nextSection.element);
    }
    tagsSection = nextSection;

    const chip =
      restoreTag === null
        ? undefined
        : [...nextSection.element.querySelectorAll<HTMLElement>(".tag-chip")].find(
            (node) => node.dataset.tag === restoreTag,
          );
    if (chip !== undefined) {
      chip.focus();
    } else if (restoreTag !== null || restoreComposer) {
      nextSection.element.querySelector<HTMLElement>(".tag-add-input")?.focus();
    }
  };

  const runTagVote = async (tag: string, vote: 1 | -1): Promise<void> => {
    if (config === null) {
      return;
    }
    await voteTag(config, tag, vote, { post: deps.post });
    await refreshTags();
  };

  const runTagVoteBatch = async (tags: string): Promise<void> => {
    if (config === null) {
      return;
    }
    await voteTag(config, tags, 1, { post: deps.post });
    await refreshTags();
  };

  const runMyTag = async (tag: string, change: MyTagChange): Promise<void> => {
    if (config === null) {
      return;
    }
    const result = await applyMyTag(tag, change, {
      config,
      myTagsUrl: new URL("/mytags", data.url).href,
      loadDocument: load,
      post: deps.post,
      signal: ctx.signal,
    });
    showToast(result === "added" ? "Tag added to My Tags" : "My Tags updated");
  };

  const buildTags = (source: GalleryData): TagSection | null =>
    source.tags.length > 0
      ? tagSection(
          source,
          {
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
          },
          ctx,
        )
      : null;

  const tags = buildTags(data);
  tagsSection = tags;

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
  appendChildren(host, [topbar, header, tags?.element ?? null, emptyThumbs ?? navigation]);
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
