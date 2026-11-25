/**
 * The search a tab is building: the committed query plus the free-text draft.
 *
 * A gallery page carries no search parameters, so without this the query disappears as soon as a
 * result is opened. One module owns both halves, so views never push or copy them by hand: typing,
 * tag clicks and chip edits change the draft; submitting commits it. The records live in
 * `sessionStorage`, so they survive reloads and stay inside the tab's own origin, and the committed
 * query keeps the key the old context module used, so an open tab loses nothing.
 */

import type { Unsubscribe } from "./emitter";
import { createEmitter } from "./emitter";
import type { SearchQuery } from "./parse/query";
import { buildSearchUrl, emptySearchQuery, parseSearchQuery } from "./parse/query";
import { createStore, sessionStorageAdapter } from "./store";

/** The committed query keeps its pre-split key so a session written by the old code still reads. */
const QUERY_KEY = "eh:search-context:v1";
const QUERY_VERSION = 1;
const DRAFT_KEY = "eh:search-draft:v1";
const DRAFT_VERSION = 1;

/**
 * A keystroke should update the field instantly, not wait on storage. Writes coalesce, and a page
 * hiding or losing focus flushes the last text so a reload or a reopened tab sees it.
 */
const DRAFT_WRITE_DELAY_MS = 150;

const adapter = sessionStorageAdapter();

const queryStore = createStore<string>(
  {
    key: QUERY_KEY,
    version: QUERY_VERSION,
    empty: () => "",
    guard: (value): value is string => typeof value === "string",
  },
  adapter,
);

/** `null` means no draft was ever written, so the committed text seeds the draft. */
const draftStore = createStore<string | null>(
  {
    key: DRAFT_KEY,
    version: DRAFT_VERSION,
    empty: () => null,
    guard: (value): value is string | null => value === null || typeof value === "string",
  },
  adapter,
);

let draftTimer: number | null = null;
let pendingDraft: string | null = null;
let boundWindow: Window | null = null;
let boundDocument: Document | null = null;

/** Persist the newest draft now and cancel the timer that would have done it. */
function flushDraftWrite(): void {
  if (draftTimer !== null) {
    window.clearTimeout(draftTimer);
    draftTimer = null;
  }
  if (pendingDraft === null) {
    return;
  }
  const text = pendingDraft;
  pendingDraft = null;
  draftStore.write(text);
}

function flushWhenHidden(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    flushDraftWrite();
  }
}

/**
 * Bind the flush points to the current document.
 *
 * Tests replace the global window between cases; following the live object keeps the listener on
 * the page that is actually open and removes the one on the discarded document.
 */
function bindDraftLifecycle(): void {
  const view = typeof window === "undefined" ? null : window;
  if (view !== null && view !== boundWindow) {
    boundWindow?.removeEventListener("pagehide", flushDraftWrite);
    boundWindow?.removeEventListener("blur", flushDraftWrite);
    view.addEventListener("pagehide", flushDraftWrite);
    view.addEventListener("blur", flushDraftWrite);
    boundWindow = view;
  }
  const doc = typeof document === "undefined" ? null : document;
  if (doc !== null && doc !== boundDocument) {
    boundDocument?.removeEventListener("visibilitychange", flushWhenHidden);
    doc.addEventListener("visibilitychange", flushWhenHidden);
    boundDocument = doc;
  }
}

function scheduleDraftWrite(text: string): void {
  bindDraftLifecycle();
  pendingDraft = text;
  if (draftTimer !== null) {
    window.clearTimeout(draftTimer);
  }
  draftTimer = window.setTimeout(flushDraftWrite, DRAFT_WRITE_DELAY_MS);
}

function discardDraftWrite(): void {
  if (draftTimer !== null) {
    window.clearTimeout(draftTimer);
    draftTimer = null;
  }
  pendingDraft = null;
}

/** What the tab is searching for: the committed query and the text being edited. */
export interface SearchDraft {
  readonly query: SearchQuery;
  readonly text: string;
}

const draftChanged = createEmitter<Readonly<SearchDraft>>();
let cached: SearchDraft | null = null;

function parseStored(value: string): SearchQuery | null {
  if (value === "" || !URL.canParse(value, location.href)) {
    return null;
  }
  return parseSearchQuery(new URL(value, location.href));
}

function read(): SearchDraft {
  const query = parseStored(queryStore.read()) ?? emptySearchQuery();
  return { query, text: draftStore.read() ?? query.text };
}

/** True when this document was loaded by reloading the tab. */
export function isDocumentReload(): boolean {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

/** The tab's current search: committed query plus the draft text. */
export function getSearchDraft(): Readonly<SearchDraft> {
  cached ??= read();
  return cached;
}

/**
 * Commit `query` as the tab's search and make its text the draft.
 *
 * Persists both records for the rest of the tab session and notifies once, only when the committed
 * query or the text actually changed.
 */
export function setSearchQuery(query: SearchQuery): void {
  const previous = getSearchDraft();
  const next: SearchDraft = { query: { ...query }, text: query.text };
  const url = buildSearchUrl(next.query);

  discardDraftWrite();
  cached = next;
  queryStore.write(url);
  draftStore.write(next.text);

  if (previous.text !== next.text || buildSearchUrl(previous.query) !== url) {
    notify();
  }
}

/** Replace only the draft text, so an unsubmitted search survives navigation. */
export function setSearchDraftText(text: string): void {
  const previous = getSearchDraft();
  if (previous.text === text) {
    return;
  }

  cached = { query: previous.query, text };
  scheduleDraftWrite(text);
  notify();
}

/** Observe draft and committed changes. Returns the unsubscribe function. */
export function subscribeSearchDraft(
  listener: (state: Readonly<SearchDraft>) => void,
): Unsubscribe {
  return draftChanged.subscribe(listener);
}

function notify(): void {
  draftChanged.emit(getSearchDraft());
}

bindDraftLifecycle();
