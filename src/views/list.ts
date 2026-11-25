import type { DateRange } from "../data/list-date";
import { filterByDateRange, isDateRangeActive, withDateRange } from "../data/list-date";
import { isListPanelOpen, saveListFilters, setListPanelOpen } from "../data/list-filters";
import { seekHref } from "../data/list-seek";
import type { SearchQuery } from "../parse/query";
import { buildSearchUrl, CATEGORIES, singleCategoryName, tagTokenFromHref } from "../parse/query";
import type { ListScope } from "../router";
import {
  getSearchDraft,
  isDocumentReload,
  setSearchDraftText,
  setSearchQuery,
  subscribeSearchDraft,
} from "../search-draft";
import type { ListItem, ListPageData } from "../types";
import { createCardGrid } from "../ui/card-grid";
import { el, icon } from "../ui/dom";
import { createSelect } from "../ui/form-controls";
import { listHeader } from "../ui/list-header";
import { createPagedRegion } from "../ui/paged-region";
import { pager } from "../ui/pager";
import { renderQuickTags } from "../ui/quick-tags";
import type { QuickTagsHandle } from "../ui/quick-tags";
import { resultCard } from "../ui/result-card";
import { nativePageAction, statePanel } from "../ui/state-panel";
import { countText, plural } from "../ui/text";
import { renderTopbar } from "../ui/topbar";
import type { PageSource, ViewContext } from "./context";

/** Optional route-owned page source so tests can drive appended pages without the network. */
interface ListViewDeps {
  pageSource?: PageSource<ListItem>;
}

/** The two names a listing wears: the heading above the grid and the tab title. */
interface ListLabels {
  /** Descriptive heading shown above the results. */
  heading: string;
  /** Document-title part; the route adapter prefixes the site name. */
  title: string;
}

/**
 * Name a listing once.
 *
 * The heading says what the result set is ("Currently popular"), while the tab title stays short
 * ("Popular") because browsers truncate it. The difference is intentional and lives here so the
 * grid and the tab cannot disagree; a `/tag/...` address carries its search text in the path, so
 * `pathTag` supplies the label when the query has none.
 */
export function listLabels(
  query: SearchQuery,
  scope: ListScope,
  pathTag: string | null,
): ListLabels {
  const text = query.text === "" ? (pathTag ?? "") : query.text;
  if (scope === "popular") {
    return { heading: "Currently popular", title: "Popular" };
  }
  if (scope === "watched") {
    return { heading: "Watched tag galleries", title: "Watched" };
  }
  if (scope === "uploader") {
    return { heading: "Uploader galleries", title: text === "" ? "Galleries" : text };
  }
  const category = singleCategoryName(query.cats);
  return {
    heading: text.trim()
      ? "Search results"
      : category === null
        ? "Gallery listings"
        : `${category} galleries`,
    title: text === "" ? (category ?? "Galleries") : text,
  };
}

function categoryChips(query: SearchQuery, ctx: ViewContext): HTMLElement {
  const row = el("div", { class: "cat-row", role: "group", "aria-label": "Categories" });

  const all = el("button", {
    class: "cat-chip",
    type: "button",
    "aria-pressed": String(query.cats === 0),
    title: "Enable every category",
    text: "All",
  });
  all.addEventListener(
    "click",
    () => {
      const next = { ...query, cats: 0 };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    },
    { signal: ctx.signal },
  );
  row.append(all);

  for (const category of CATEGORIES) {
    const enabled = (query.cats & category.bit) === 0;
    const chip = el("button", {
      class: `cat-chip ${category.cls}`,
      type: "button",
      "aria-pressed": String(enabled),
      title: enabled ? `Disable ${category.name}` : `Enable ${category.name}`,
      text: category.name,
    });
    chip.addEventListener(
      "click",
      () => {
        const next = { ...query, cats: query.cats ^ category.bit };
        saveListFilters(next);
        ctx.navigate(buildSearchUrl(next));
      },
      { signal: ctx.signal },
    );
    row.append(chip);
  }

  return row;
}

/** Filters that narrow the result set. */
function narrowCount(query: SearchQuery): number {
  let count = 0;
  if (query.rating > 0) {
    count++;
  }
  if (query.expunged) {
    count++;
  }
  if (query.torrent) {
    count++;
  }
  if (query.pageFrom.trim() || query.pageTo.trim()) {
    count++;
  }
  if (isDateRangeActive({ since: query.since, until: query.until })) {
    count++;
  }
  return count;
}

/** Switches that widen the result set; they are settings, not filters. */
function relaxedCount(query: SearchQuery): number {
  let count = 0;
  if (query.disableLanguage) {
    count++;
  }
  if (query.disableUploader) {
    count++;
  }
  if (query.disableTags) {
    count++;
  }
  return count;
}

function advancedPanel(query: SearchQuery, ctx: ViewContext): HTMLElement {
  const activeCount = narrowCount(query) + relaxedCount(query);

  const rating = createSelect({
    class: "field-select",
    ariaLabel: "Minimum rating",
    value: String(query.rating),
    options: [0, 2, 3, 4, 5].map((value) => ({
      value: String(value),
      label: value === 0 ? "Any rating" : `${value} stars`,
    })),
  });

  const pageFrom = el("input", {
    class: "field-input",
    type: "number",
    min: "0",
    placeholder: "min",
    value: query.pageFrom,
    "aria-label": "Minimum pages",
  });
  const pageTo = el("input", {
    class: "field-input",
    type: "number",
    min: "0",
    placeholder: "max",
    value: query.pageTo,
    "aria-label": "Maximum pages",
  });

  const sinceDate = el("input", {
    class: "field-input",
    type: "date",
    placeholder: "YYYY-MM-DD",
    title: "Show galleries posted on or after this day",
    value: query.since,
    "aria-label": "Posted since",
    style: "width: 10rem",
  });
  const untilDate = el("input", {
    class: "field-input",
    type: "date",
    placeholder: "YYYY-MM-DD",
    title: "Show galleries posted on or before this day",
    value: query.until,
    "aria-label": "Posted until",
    style: "width: 10rem",
  });

  const checkbox = (
    label: string,
    checked: boolean,
  ): { wrapper: HTMLElement; input: HTMLInputElement } => {
    const input = el("input", { type: "checkbox", checked: checked ? "checked" : null });
    return {
      wrapper: el("label", { class: "check" }, input, el("span", { text: label })),
      input,
    };
  };

  const expunged = checkbox("Include expunged", query.expunged);
  const torrent = checkbox("Require torrent", query.torrent);
  const disableLanguage = checkbox("Disable language filter", query.disableLanguage);
  const disableUploader = checkbox("Disable uploader filter", query.disableUploader);
  const disableTags = checkbox("Disable tag filter", query.disableTags);

  const apply = (): void => {
    const next = {
      ...query,
      rating: Number.parseInt(rating.read(), 10) || 0,
      pageFrom: pageFrom.value,
      pageTo: pageTo.value,
      since: sinceDate.value,
      until: untilDate.value,
      expunged: expunged.input.checked,
      torrent: torrent.input.checked,
      disableLanguage: disableLanguage.input.checked,
      disableUploader: disableUploader.input.checked,
      disableTags: disableTags.input.checked,
    };
    saveListFilters(next);
    ctx.navigate(buildSearchUrl(next));
  };

  const applyButton = el("button", {
    class: "btn btn-small",
    type: "submit",
    text: "Apply",
  });

  const reset = el("button", { class: "btn btn-ghost btn-small", type: "button", text: "Reset" });
  reset.addEventListener(
    "click",
    () => {
      const next = {
        ...query,
        rating: 0,
        pageFrom: "",
        pageTo: "",
        since: "",
        until: "",
        expunged: false,
        torrent: false,
        disableLanguage: false,
        disableUploader: false,
        disableTags: false,
      };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    },
    { signal: ctx.signal },
  );

  const form = el(
    "form",
    { class: "filters-grid" },
    el("label", { class: "field" }, el("span", { text: "Minimum rating" }), rating.element),
    el(
      "div",
      { class: "field" },
      el("span", { text: "Page count" }),
      el("div", { class: "field-row" }, pageFrom, el("span", { text: "to" }), pageTo),
    ),
    el("label", { class: "field" }, el("span", { text: "Posted since" }), sinceDate),
    el("label", { class: "field" }, el("span", { text: "Posted until" }), untilDate),
    el("div", { class: "check-row" }, expunged.wrapper, torrent.wrapper),
    el(
      "div",
      { class: "check-row" },
      disableLanguage.wrapper,
      disableUploader.wrapper,
      disableTags.wrapper,
    ),
    el(
      "div",
      { class: "filters-actions" },
      activeCount > 0 ? reset : null,
      applyButton,
      el("a", {
        class: "filters-native",
        href: `https://upld.${location.hostname}/image_lookup.php`,
        "data-native": "",
        target: "_blank",
        rel: "noopener",
        text: "File search",
        title: "Find galleries containing a file (native upload form)",
      }),
    ),
  );
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      apply();
    },
    { signal: ctx.signal },
  );

  const details = el(
    "details",
    { class: "filters", open: isListPanelOpen() ? "" : null },
    el(
      "summary",
      { class: "filters-summary" },
      icon("filter"),
      el("span", { text: "Filters" }),
      activeCount > 0 ? el("span", { class: "filters-count", text: String(activeCount) }) : "",
    ),
    form,
  );
  details.addEventListener(
    "toggle",
    () => {
      // The attribute, not the live property: test DOMs do not implement `details.open`.
      setListPanelOpen(details.hasAttribute("open"));
    },
    { signal: ctx.signal },
  );
  return details;
}

/** Mirror the field's draft into one line when it differs from the rendered results. */
function updateDraftNote(note: HTMLElement, applied: string, draft: string): void {
  const trimmed = draft.trim();
  if (trimmed === applied.trim()) {
    note.hidden = true;
    note.replaceChildren();
    return;
  }
  note.hidden = false;
  note.replaceChildren(
    "Showing results for ",
    el("strong", { text: applied.trim() || "everything" }),
    ". Press Enter to search ",
    el("strong", { text: trimmed || "everything" }),
    ".",
  );
}

/** Render a search/category results page. */
export function renderList(
  host: HTMLElement,
  data: ListPageData,
  query: SearchQuery,
  ctx: ViewContext,
  scope: ListScope = "search",
  deps: ListViewDeps = {},
): void {
  host.replaceChildren();

  // A native `/tag/...` landing has no `f_search` text. Fold that tag into the query so the
  // field, the filter chips, and every rebuilt URL agree about what is being searched. The parsed
  // page's URL is the base: the view never re-reads the ambient browser address.
  const pathTag = tagTokenFromHref(new URL(data.url).pathname, data.url);
  const urlText = query.text === "" ? (pathTag ?? "") : query.text;
  const urlQuery = urlText === query.text ? query : { ...query, text: urlText };

  // A reloaded page has no query in its URL, but the tab may still hold an unsubmitted draft.
  // Prefill the field and chips from it without pretending the rendered results match.
  const draftText = urlText === "" && isDocumentReload() ? getSearchDraft().text : urlText;
  const draftQuery = draftText === urlQuery.text ? urlQuery : { ...urlQuery, text: draftText };
  setSearchQuery(draftQuery);

  const search = (next: string): void => {
    setSearchQuery({ ...urlQuery, text: next });
    ctx.navigate(buildSearchUrl({ ...urlQuery, text: next }));
  };

  let quickTags: QuickTagsHandle | null = null;
  const applied = urlQuery.text;
  const note = el("p", { class: "draft-note", hidden: "" });
  const topbar = renderTopbar({ onSearch: search, signal: ctx.signal });
  updateDraftNote(note, applied, draftText);

  const unsubscribe = subscribeSearchDraft((state) => {
    updateDraftNote(note, applied, state.text);
    quickTags?.refresh(state.text);
  });
  ctx.signal.addEventListener("abort", unsubscribe, { once: true });

  const narrow = narrowCount(urlQuery);
  const relaxed = relaxedCount(urlQuery);

  // Posted-date ranges are client-side: the site's `seek` starts near `until`, then every page is
  // filtered here and paging stops once a page reaches past `since`.
  const range: DateRange = { since: urlQuery.since, until: urlQuery.until };
  const rangeActive = isDateRangeActive(range);
  const filtered = rangeActive ? filterByDateRange(data.items, range) : null;
  const shownItems = filtered?.items ?? data.items;
  const crossedSince = filtered?.crossedSince ?? false;
  let nextHref = data.nextHref;
  if (rangeActive) {
    nextHref = nextHref !== null && !crossedSince ? withDateRange(nextHref, range) : null;
  }

  // The fallback count has to describe what the grid currently shows, including pages appended
  // by infinite scroll. A site-provided result line is a total, so it stays fixed. While a range
  // filters the page in-app, that total would be a lie: show the number of rendered cards instead.
  const countNode = el("span", {
    text: rangeActive
      ? `${shownItems.length} shown`
      : (data.resultText ?? countText(data.items.length, "item")),
  });
  const header = listHeader({
    title: listLabels(urlQuery, scope, pathTag).heading,
    summary: [
      countNode,
      rangeActive
        ? el("span", {
            class: "badge date-filter-note",
            text: "Approximate while filtered.",
          })
        : null,
      narrow > 0 ? el("span", { class: "badge", text: countText(narrow, "filter") }) : null,
      relaxed > 0
        ? el("span", {
            class: "badge",
            text: `${relaxed} relaxed ${plural(relaxed, "filter")}`,
          })
        : null,
    ],
  });

  quickTags = renderQuickTags({
    getText: () => getSearchDraft().text,
    apply: setSearchDraftText,
    signal: ctx.signal,
  });

  const panel = el(
    "section",
    { class: "search-panel" },
    categoryChips(draftQuery, ctx),
    quickTags.element,
    advancedPanel(draftQuery, ctx),
  );

  const grid = createCardGrid(ctx.signal);
  grid.append(shownItems.map((item) => resultCard(item, ctx.signal)));

  const syncCount = (): void => {
    const cards = grid.element.querySelectorAll(".card").length;
    if (rangeActive) {
      countNode.textContent = `${cards} shown`;
    } else if (data.resultText === null) {
      countNode.textContent = countText(cards, "item");
    }
  };

  const footer = el("div");

  const clearFilters = (): void => {
    const cleared = {
      ...urlQuery,
      text: "",
      cats: 0,
      rating: 0,
      expunged: false,
      torrent: false,
      pageFrom: "",
      pageTo: "",
      since: "",
      until: "",
      disableLanguage: false,
      disableUploader: false,
      disableTags: false,
    };
    saveListFilters(cleared);
    ctx.navigate("/");
  };

  const canReset =
    urlQuery.text !== "" || urlQuery.cats !== 0 || narrow > 0 || relaxed > 0 || rangeActive;
  const empty =
    shownItems.length === 0
      ? statePanel({
          text: "No galleries were found on this page.",
          actions: [
            ...(canReset
              ? [
                  {
                    label: "Clear search and filters",
                    primary: true,
                    onClick: clearFilters,
                  },
                ]
              : []),
            nativePageAction(),
          ],
        })
      : null;

  host.append(topbar, note, header, panel);
  if (shownItems.length > 0) {
    // The cards are articles with no headings of their own; name their region for heading
    // navigation without adding visible chrome.
    host.append(el("h2", { class: "sr-only", text: "Results" }), grid.element);
    grid.refresh();
  }
  host.append(empty ?? footer);

  const pageSource = deps.pageSource;

  if (empty === null) {
    createPagedRegion<ListItem>({
      signal: ctx.signal,
      next: nextHref,
      initial: shownItems,
      key: (item) => item.gid,
      noun: "results",
      enabled: (settings) => settings.listInfiniteScroll,
      slot: footer,
      pager: (withNext) =>
        withNext
          ? pager({
              prev: data.prevHref,
              next: nextHref,
              label: "Result pages",
              seek: {
                go: (value) => ctx.navigate(seekHref(data.url, value)),
              },
            })
          : null,
      load: (url, signal) => {
        if (pageSource === undefined) {
          return Promise.reject(new Error("No next-page source for this list route."));
        }
        const request = pageSource(rangeActive ? withDateRange(url, range) : url, signal);
        if (!rangeActive) {
          return request;
        }
        return request.then((page) => {
          const kept = filterByDateRange(page.items, range);
          return {
            items: kept.items,
            next: kept.crossedSince || page.next === null ? null : withDateRange(page.next, range),
          };
        });
      },
      append: (incoming) => {
        const nodes = incoming.map((item) => resultCard(item, ctx.signal));
        grid.append(nodes);
        return () => grid.remove(nodes);
      },
      placeSentinel: (node) => footer.append(node),
      onSync: syncCount,
    });
  }
}
