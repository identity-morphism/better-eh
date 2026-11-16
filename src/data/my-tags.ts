/**
 * My Tags mutations: watch, hide, and colour a tag.
 *
 * The site stores user tags server-side. Watching/hiding/colouring an existing tag goes through the
 * `setusertag` JSON API, which needs the numeric user-tag id (only present on `/mytags`), so the
 * current list is fetched first. A tag that is not on that list is added through the native
 * `/mytags` form instead.
 */

import type { DocumentOptions, HtmlResponse } from "../fetch/loader";
import { postForm, postJson } from "../net/http";
import { isChecked } from "../parse/helpers";
import type { GalleryApiConfig } from "../types";
import type { GalleryPost } from "./gallery-actions";

interface UserTagState {
  id: number;
  name: string;
  watched: boolean;
  hidden: boolean;
  color: string;
  weight: number;
}

export interface MyTagChange {
  watched?: boolean;
  hidden?: boolean;
  /** `null` clears the colour; `undefined` keeps it. */
  color?: string | null;
}

interface MyTagDeps {
  config: GalleryApiConfig;
  myTagsUrl: string;
  loadDocument: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  post?: GalleryPost;
  addTag?: (url: string, body: URLSearchParams, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Accept `#rgb`/`#rrggbb` (or the same without `#`); anything else means "no colour". */
export function normalizeColor(color: string | null | undefined): string {
  if (color === null || color === undefined) {
    return "";
  }
  const value = color.trim().replace(/^#/, "");
  return /^[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(value) ? `#${value.toLowerCase()}` : "";
}

/** Parse the user tags rendered inside `/mytags`. */
export function parseUserTags(doc: Document): UserTagState[] {
  const tags: UserTagState[] = [];
  for (const block of doc.querySelectorAll<HTMLElement>("#usertags_outer > div[id^='usertag_']")) {
    const rawId = block.id.slice("usertag_".length);
    const id = Number.parseInt(rawId, 10);
    // The blank add-row uses `usertag_0`; it is not a saved tag.
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }
    const preview = block.querySelector<HTMLElement>(`#tagpreview_${id}`);
    const name = preview?.getAttribute("title")?.trim() ?? "";
    if (name === "") {
      continue;
    }
    const colorInput = block.querySelector<HTMLInputElement>(`#tagcolor_${id}`);
    const weightInput = block.querySelector<HTMLInputElement>(`#tagweight_${id}`);
    const weight = Number.parseInt(weightInput?.value ?? "", 10);
    tags.push({
      id,
      name,
      watched: isChecked(block.querySelector<HTMLInputElement>(`#tagwatch_${id}`)),
      hidden: isChecked(block.querySelector<HTMLInputElement>(`#taghide_${id}`)),
      color: normalizeColor(colorInput?.value ?? ""),
      weight: Number.isFinite(weight) ? weight : 10,
    });
  }
  return tags;
}

function throwIfFailed(data: unknown): void {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as Record<string, unknown>).error;
    if (typeof error === "string" && error !== "") {
      throw new Error(`Could not save tag: ${error}`);
    }
  }
}

async function postTagJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const data = await postJson(url, body, {
    tag: "my-tags",
    failure: "Tag request failed",
    signal,
  });
  throwIfFailed(data);
  return data;
}

async function addTagForm(url: string, body: URLSearchParams, signal?: AbortSignal): Promise<void> {
  await postForm(url, body, { tag: "my-tags", failure: "Could not save tag", signal });
}

/**
 * Apply one change to a tag, adding it when it is not already a user tag.
 *
 * Returns whether the tag was updated in place or added, which callers use for feedback.
 */
export async function applyMyTag(
  tag: string,
  change: MyTagChange,
  deps: MyTagDeps,
): Promise<"updated" | "added"> {
  const name = normalizeName(tag);
  if (name === "") {
    throw new Error("Missing tag name.");
  }
  const response = await deps.loadDocument(deps.myTagsUrl, { fresh: true, signal: deps.signal });
  if (deps.signal?.aborted) {
    return "updated";
  }
  const existing = parseUserTags(response.doc).find((entry) => normalizeName(entry.name) === name);

  if (existing) {
    let watched = change.watched ?? existing.watched;
    let hidden = change.hidden ?? existing.hidden;
    // The site treats watch and hide as mutually exclusive; the field just changed wins.
    if (change.watched === true) {
      hidden = false;
    } else if (change.hidden === true) {
      watched = false;
    }
    const next = {
      watched,
      hidden,
      color: change.color === undefined ? existing.color : normalizeColor(change.color),
    };
    const post = deps.post ?? ((url, body) => postTagJson(url, body, deps.signal));
    const data = await post(deps.config.apiUrl, {
      method: "setusertag",
      apiuid: deps.config.apiUid,
      apikey: deps.config.apiKey,
      tagid: existing.id,
      tagwatch: next.watched ? 1 : 0,
      taghide: next.hidden ? 1 : 0,
      tagcolor: next.color,
      tagweight: existing.weight,
    });
    throwIfFailed(data);
    return "updated";
  }

  const body = new URLSearchParams({
    usertag_action: "add",
    tagname_new: name,
    tagweight_new: "10",
    usertag_target: "0",
  });
  if (change.watched === true) {
    body.set("tagwatch_new", "on");
  }
  if (change.hidden === true) {
    body.set("taghide_new", "on");
  }
  const color = normalizeColor(change.color);
  if (color !== "") {
    body.set("tagcolor_new", color);
  }
  const add = deps.addTag ?? addTagForm;
  await add(deps.myTagsUrl, body, deps.signal);
  return "added";
}
