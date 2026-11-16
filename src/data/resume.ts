/**
 * Per-gallery reading position.
 *
 * The record is intentionally small and local: gallery key → the viewer URL the reader stopped on.
 * Entries expire so a gallery opened months later does not offer a page from an old session, and
 * the store is bounded so browsing many galleries cannot grow userscript storage without limit.
 */

import { isRecord } from "../guards";
import { galleryIdentity } from "../parse/url";
import { createStore, gmStorage } from "../store";

const RESUME_KEY = "eh:resume:v1";
const VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RESUME_TTL_MS = 30 * DAY_MS;
export const RESUME_LIMIT = 100;

export interface ResumeEntry {
  /** Viewer URL that reopens the page. */
  pageUrl: string;
  pageNum: number;
  /** The site's "N / M" counter, shown on the resume control. */
  counterText: string;
  savedAt: number;
}

type Store = Record<string, ResumeEntry>;

/** Stable gallery identity from its `/g/<gid>/<token>/` URL. */
export function galleryKey(galleryUrl: string): string | null {
  const identity = galleryIdentity(galleryUrl);
  return identity === null ? null : `${identity.gid}/${identity.token}`;
}

function isEntry(value: unknown): value is ResumeEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.pageUrl === "string" &&
    typeof record.pageNum === "number" &&
    Number.isFinite(record.pageNum) &&
    typeof record.counterText === "string" &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt)
  );
}

const resumeStore = createStore<Record<string, unknown>>(
  { key: RESUME_KEY, version: VERSION, empty: () => ({}), guard: isRecord },
  gmStorage(),
);

function readStore(): Store {
  const store: Store = {};
  for (const [key, value] of Object.entries(resumeStore.read())) {
    if (isEntry(value)) {
      store[key] = value;
    }
  }
  return store;
}

function writeStore(store: Store): void {
  resumeStore.write(store);
}

/** The save position for this gallery, or null when absent or expired. */
export function getResume(galleryUrl: string, now = Date.now()): ResumeEntry | null {
  const key = galleryKey(galleryUrl);
  if (key === null) {
    return null;
  }
  const entry = readStore()[key];
  if (!entry || now - entry.savedAt >= RESUME_TTL_MS) {
    return null;
  }
  return entry;
}

/** Record the current page, dropping expired entries and the oldest beyond the limit. */
export function saveResume(
  galleryUrl: string,
  entry: Omit<ResumeEntry, "savedAt">,
  now = Date.now(),
): void {
  const key = galleryKey(galleryUrl);
  if (key === null || entry.pageUrl === "") {
    return;
  }
  const store = readStore();
  store[key] = { ...entry, savedAt: now };

  const live = Object.entries(store).filter(([, value]) => now - value.savedAt < RESUME_TTL_MS);
  if (live.length > RESUME_LIMIT) {
    live.sort((a, b) => b[1].savedAt - a[1].savedAt);
    live.length = RESUME_LIMIT;
  }
  writeStore(Object.fromEntries(live));
}

/** Forget the saved position for one gallery. */
export function clearResume(galleryUrl: string): void {
  const key = galleryKey(galleryUrl);
  if (key === null) {
    return;
  }
  const store = readStore();
  if (!(key in store)) {
    return;
  }
  delete store[key];
  writeStore(store);
}
