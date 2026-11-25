import { rememberQuery } from "../data/search-history";
import type { SearchDraft } from "../search-draft";
import { getSearchDraft, setSearchDraftText, subscribeSearchDraft } from "../search-draft";
import { isLoggedIn } from "../session";
import { getSettings } from "../settings";
import { FRONT_PATH, POPULAR_PATH, SITE_PATHS, WATCHED_PATH } from "../site";
import { toggleExpressionInSearch } from "../tags/model";
import { el, icon, isEditableTarget, searchInput } from "./dom";
import { syncScrollEdges, trackScrollEdges } from "./jump-row";
import { bindPopover } from "./popover";
import type { ChipAction } from "./search-chips";
import { renderSearchChips } from "./search-chips";
import { searchHistoryButton } from "./search-history";
import { attachTagCombobox } from "./tag-combobox";
import type { TagCombobox } from "./tag-combobox";

export interface TopbarOptions {
  /** Submit the search. */
  onSearch: (text: string) => void;
  /** Keep chip edits in the draft instead of submitting them (gallery pages). */
  draftChips?: boolean;
  /** View lifetime; cleans up the combobox portal, global listeners and the draft subscription. */
  signal?: AbortSignal;
}

/** One destination in the shared site tab bar. */
interface NavTab {
  label: string;
  href: string;
  external: boolean;
  active: boolean;
}

/** Where a tab points: an app pathname the router can intercept, or an absolute URL. */
type NavTarget = { kind: "internal"; path: string } | { kind: "external"; href: string };

interface NavSpec {
  key: string;
  label: string;
  target: NavTarget;
  /** Rendered in the always-visible row instead of behind the More button. */
  primary?: boolean;
  /** Account-only destination, hidden while signed out. */
  accountOnly?: boolean;
}

interface ResolvedTab extends NavTab {
  primary: boolean;
}

/** The forum, wiki and HentaiVerse are shared by both gallery domains. */
const FORUMS_URL = "https://forums.e-hentai.org/";
const WIKI_URL = "https://ehwiki.org/";
const HENTAIVERSE_URL = "https://hentaiverse.org/";

/** Toplists exist on e-hentai.org only; ExHentai answers `/toplist.php` with a 404. */
const TOPLIST_HOST = "e-hentai.org";

function hasToplists(host: string): boolean {
  return host === TOPLIST_HOST || host.endsWith(`.${TOPLIST_HOST}`);
}

/** A trailing slash never changes the match. */
function trimSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Match a tab path against the current pathname.
 *
 * Only an exact path match marks a tab current. A gallery, a viewer page or a tag listing is
 * reached _through_ a tab but is not that tab, and `aria-current="page"` has to stay truthful.
 */
function matchesPath(tabPath: string, pathname: string): boolean {
  return trimSlash(tabPath) === trimSlash(pathname);
}

/** Site order, as rendered in the native navbar. */
function navSpecs(host: string): readonly NavSpec[] {
  const specs: NavSpec[] = [
    {
      key: "front",
      label: "Front Page",
      target: { kind: "internal", path: FRONT_PATH },
      primary: true,
    },
    {
      key: "watched",
      label: "Watched",
      target: { kind: "internal", path: WATCHED_PATH },
      primary: true,
    },
    {
      key: "popular",
      label: "Popular",
      target: { kind: "internal", path: POPULAR_PATH },
      primary: true,
    },
    {
      key: "torrents",
      label: "Torrents",
      target: { kind: "internal", path: SITE_PATHS.torrents },
      primary: true,
    },
    {
      key: "favorites",
      label: "Favorites",
      target: { kind: "internal", path: SITE_PATHS.favorites },
      primary: true,
      accountOnly: true,
    },
    {
      key: "settings",
      label: "Settings",
      target: { kind: "internal", path: SITE_PATHS.uconfig },
      accountOnly: true,
    },
    {
      key: "uploads",
      label: "My Uploads",
      target: { kind: "external", href: `https://upld.${location.hostname}/manage` },
      accountOnly: true,
    },
    {
      key: "mytags",
      label: "My Tags",
      target: { kind: "internal", path: SITE_PATHS.myTags },
      accountOnly: true,
    },
    { key: "home", label: "My Home", target: { kind: "internal", path: SITE_PATHS.home } },
    { key: "toplist", label: "Toplists", target: { kind: "internal", path: SITE_PATHS.toplist } },
    { key: "bounty", label: "Bounties", target: { kind: "internal", path: "/bounty.php" } },
    { key: "news", label: "News", target: { kind: "internal", path: "/news.php" } },
    { key: "lofi", label: "LoFi", target: { kind: "internal", path: "/lofi/" } },
    { key: "forums", label: "Forums", target: { kind: "external", href: FORUMS_URL } },
    { key: "wiki", label: "Wiki", target: { kind: "external", href: WIKI_URL } },
    {
      key: "hentaiverse",
      label: "HentaiVerse",
      target: { kind: "external", href: HENTAIVERSE_URL },
    },
  ];
  return hasToplists(host) ? specs : specs.filter((spec) => spec.key !== "toplist");
}

function resolveTabs(pathname: string, signedIn: boolean, host: string): readonly ResolvedTab[] {
  const tabs: ResolvedTab[] = [];
  for (const spec of navSpecs(host)) {
    if (spec.accountOnly === true && !signedIn) {
      continue;
    }
    // The target union decides both the href and whether the tab can be the current page.
    const target = spec.target;
    tabs.push({
      label: spec.label,
      href: target.kind === "internal" ? target.path : target.href,
      external: target.kind === "external",
      active: target.kind === "internal" && matchesPath(target.path, pathname),
      primary: spec.primary === true,
    });
  }
  return tabs;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.userAgent);

function focusShortcut(input: HTMLInputElement, signal?: AbortSignal): void {
  if (!signal) {
    return;
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== "k" || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      input.focus();
      input.select();
    },
    { signal },
  );
}

function navLink(tab: NavTab, className: string): HTMLAnchorElement {
  const link = el("a", { class: className, href: tab.href, text: tab.label });
  if (tab.external) {
    link.setAttribute("rel", "noreferrer");
    link.append(icon("external"));
  }
  if (tab.active) {
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  }
  return link;
}

/**
 * Centre the current tab once the row is in the document and can be measured.
 *
 * A tab that is already fully visible stays put: centering a row that fits exactly walked the
 * leading tab off the left edge. The row's fade attributes follow the resulting scroll.
 */
function revealActiveTab(nav: HTMLElement, signal?: AbortSignal): void {
  const row = nav.querySelector<HTMLElement>(".topbar-tabs");
  if (row === null) {
    return;
  }
  trackScrollEdges(row, signal);
  const apply = (): void => {
    if (!nav.isConnected) {
      return;
    }
    const active = row.querySelector<HTMLElement>(".topbar-tab.is-active");
    if (active === null) {
      return;
    }
    const start = active.offsetLeft;
    if (start >= row.scrollLeft && start + active.offsetWidth <= row.scrollLeft + row.clientWidth) {
      return;
    }
    row.scrollLeft = Math.max(0, start - (row.clientWidth - active.offsetWidth) / 2);
    syncScrollEdges(row);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(apply);
  } else {
    apply();
  }
}

/**
 * The site tab bar on its own, for views that have no search header.
 *
 * Views that do render `renderTopbar` must not call this: the header already carries the nav.
 */
export function siteNav(signal?: AbortSignal): HTMLElement {
  const nav = renderNav(location.pathname, isLoggedIn(), signal);
  // Same sticky header as the search views, minus the search form: the brand and the back button
  // live in the tab row so the bar stays one line tall.
  nav.prepend(backButton(), brandLink());
  revealActiveTab(nav, signal);
  return el("header", { class: "topbar topbar-slim" }, nav);
}

/** Tab bar in the native site's order, with everything past the core tabs behind More. */
function renderNav(pathname: string, signedIn: boolean, signal?: AbortSignal): HTMLElement {
  const tabs = resolveTabs(pathname, signedIn, location.hostname);
  const row = el("div", { class: "topbar-tabs" });
  for (const tab of tabs) {
    if (tab.primary) {
      row.append(navLink(tab, "topbar-tab"));
    }
  }

  const overflow = tabs.filter((tab) => !tab.primary);
  const nav = el("nav", { class: "topbar-nav", "aria-label": "Site sections" }, row);
  if (overflow.length === 0) {
    return nav;
  }

  // Closing on activation keeps the panel from outliving the route change it starts.
  const moreButton = el("button", {
    class: "topbar-more btn btn-ghost btn-small",
    type: "button",
    text: "More",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  const popover = bindPopover(
    moreButton,
    (close) => {
      const content = el("div", { class: "topbar-more-list", role: "none" });
      for (const tab of overflow) {
        const link = navLink(tab, "topbar-more-link");
        link.setAttribute("role", "menuitem");
        link.addEventListener("click", close);
        content.append(link);
      }
      return { content };
    },
    {
      role: "menu",
      label: "More site sections",
      className: "topbar-more-panel",
      align: "end",
      autoFocus: true,
    },
    signal,
  );
  moreButton.addEventListener("click", () => popover.toggle());

  if (overflow.some((tab) => tab.active)) {
    // The current page lives behind More; say so instead of showing no active tab at all.
    moreButton.classList.add("is-active");
    moreButton.setAttribute("aria-current", "page");
  }

  nav.append(moreButton);
  return nav;
}

function backButton(): HTMLElement {
  return el(
    "button",
    {
      class: "icon-btn",
      type: "button",
      "aria-label": "Go back",
      title: "Back",
      onclick: () => {
        if (history.length > 1) {
          history.back();
        } else {
          location.href = "/";
        }
      },
    },
    icon("back"),
  );
}

function brandLink(): HTMLElement {
  // The visible mark is "E-H"; WCAG 2.5.3 requires the spoken name to contain it.
  return el("a", { class: "brand", href: "/", "aria-label": "E-H home" }, "E-H");
}

/** Shared site header used by the list and gallery views. */
export function renderTopbar(options: TopbarOptions): HTMLElement {
  const initial = getSearchDraft();
  const form = el("form", { class: "topbar-search", role: "search" });
  const input = searchInput({
    name: "f_search",
    value: initial.text,
    placeholder: "Search tags or titles",
    "aria-label": "Search tags or titles",
    "aria-keyshortcuts": "Control+K Meta+K",
  });

  const clear = el(
    "button",
    {
      class: "topbar-clear",
      type: "button",
      "aria-label": "Clear search",
      title: "Clear search",
      hidden: "hidden",
    },
    icon("close"),
  );

  const hint = el("kbd", {
    class: "kbd topbar-kbd",
    "aria-hidden": "true",
    text: IS_MAC ? "⌘K" : "Ctrl K",
  });

  let combobox: TagCombobox | null = null;

  const history = searchHistoryButton({
    getQuery: () => input.value,
    onPick: (text) => {
      setSearchDraftText(text);
      submit(text);
    },
    onToggle: (text) => {
      setSearchDraftText(toggleExpressionInSearch(getSearchDraft().text, text));
    },
    signal: options.signal ?? new AbortController().signal,
  });

  form.append(
    el("span", { class: "topbar-search-icon" }, icon("search")),
    input,
    clear,
    hint,
    history,
    el(
      "button",
      { class: "topbar-search-submit", type: "submit", "aria-label": "Search" },
      el("span", { class: "topbar-search-submit-icon" }, icon("search")),
      el("span", { class: "topbar-search-submit-label", text: "Search" }),
    ),
  );

  const filters = el("div", { class: "topbar-filters", hidden: "hidden" });
  let renderedText = "";

  /**
   * Gallery pages keep chip edits in the draft, so their chips are a view of the draft. Everywhere
   * else chips describe the committed query and hold still while the user types the next one.
   */
  const chipsFromDraft = options.draftChips === true;

  // The chips describe the committed query (or the draft on gallery pages), and the shortcut hint
  // only teaches while the field is idle and empty. Chips disappear while the field differs from
  // the text they describe, since their edits would rewrite the draft from stale state.
  function syncInputChrome(): void {
    filters.hidden = input.value !== renderedText || filters.childElementCount === 0;
    clear.hidden = input.value === "";
    hint.hidden = document.activeElement === input || input.value !== "";
    // A row rendered while hidden had no width to measure; sync its fades when it becomes visible.
    const row = filters.firstElementChild;
    if (!filters.hidden && row !== null) {
      syncScrollEdges(row as HTMLElement);
    }
  }
  input.addEventListener("focus", syncInputChrome);
  input.addEventListener("blur", syncInputChrome);

  const submit = (text: string): void => {
    rememberQuery(text);
    options.onSearch(text);
  };

  const applyChip = (text: string, action: ChipAction): void => {
    if (chipsFromDraft) {
      setSearchDraftText(text);
    } else {
      submit(text);
    }

    // The row may have been rebuilt, so the button that was activated no longer exists. Put focus
    // on the chip that took its place, or the one before it when the last chip was removed; only
    // an empty row falls back to the field.
    if (action.type === "clear") {
      input.focus();
      return;
    }
    const nodes = [...filters.querySelectorAll<HTMLElement>(".term-toggle")];
    (nodes[action.index] ?? nodes[action.index - 1] ?? input).focus();
  };

  function renderFilters(text: string): void {
    renderedText = text;
    const row = renderSearchChips(text, applyChip, options.signal);
    filters.replaceChildren();
    if (row !== null) {
      filters.append(row);
    }
    syncInputChrome();
  }

  function applyState(state: Readonly<SearchDraft>): void {
    if (input.value !== state.text) {
      input.value = state.text;
      combobox?.refresh();
    }
    const text = chipsFromDraft ? state.text : state.query.text;
    if (text !== renderedText) {
      renderFilters(text);
    } else {
      syncInputChrome();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(input.value);
  });

  input.addEventListener("input", () => {
    setSearchDraftText(input.value);
  });

  clear.addEventListener(
    "click",
    () => {
      setSearchDraftText("");
      // The portal keeps the old query's suggestions open otherwise: clearing the field does not
      // fire an `input` event, so the combobox never re-reads it.
      combobox?.refresh();
      input.focus();
    },
    { signal: options.signal },
  );

  combobox = getSettings().tagSuggestions
    ? attachTagCombobox({
        input,
        signal: options.signal,
        onCommit: () => setSearchDraftText(input.value),
      })
    : null;
  focusShortcut(input, options.signal);

  const back = backButton();
  const main = el("div", { class: "topbar-main" }, back, brandLink(), form);

  const nav = renderNav(location.pathname, isLoggedIn(), options.signal);
  revealActiveTab(nav, options.signal);
  const element = el("header", { class: "topbar" }, main, filters, nav);
  renderFilters(chipsFromDraft ? initial.text : initial.query.text);

  const unsubscribe = subscribeSearchDraft(applyState);
  const signal = options.signal;
  if (signal !== undefined) {
    if (signal.aborted) {
      unsubscribe();
    } else {
      signal.addEventListener("abort", unsubscribe, { once: true });
    }
  }

  return element;
}
