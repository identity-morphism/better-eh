/**
 * My Tags mutations: watch, hide, colour and weight a tag.
 *
 * The site stores user tags server-side. Editing an existing tag goes through the `setusertag` JSON
 * API, which needs the numeric user-tag id (only present on `/mytags`), so the current list is
 * fetched first unless the caller already has the row's state. A tag that is not on that list is
 * added through the native `/mytags` form instead.
 */

import type { DocumentOptions, HtmlResponse } from "../fetch/loader";
import { postForm, postJson } from "../net/http";
import type { ApiCredentials } from "../parse/gallery";
import type { TagsetField, TagsetState, UserTagState } from "../parse/my-tags";
import { normalizeColor, parseUserTags } from "../parse/my-tags";
import { collapseWhitespace } from "../strings";
import type { GalleryPost } from "./gallery-actions";

const DEFAULT_WEIGHT = 10;

/**
 * Rebuild the native tagset form body.
 *
 * Every parsed control is emitted in document order, with `overrides` replacing its current value.
 * Unknown fields therefore round-trip untouched, the same guarantee `uconfigBody` gives settings.
 */
function tagsetBody(
  fields: readonly TagsetField[],
  overrides: ReadonlyMap<string, string>,
): URLSearchParams {
  const body = new URLSearchParams();
  const emitted = new Set<string>();

  for (const field of fields) {
    const value = overrides.get(field.name) ?? field.value;
    emitted.add(field.name);
    if (field.kind === "checkbox" && value === "") {
      continue;
    }
    body.append(field.name, value);
  }

  // A control the parser did not see (a new site field) still carries the user's chosen action.
  for (const [name, value] of overrides) {
    if (!emitted.has(name)) {
      body.append(name, value);
    }
  }
  return body;
}

/** One tagset edit: a rename, an enable toggle, or a default-colour change. */
export interface TagsetChange {
  /** A display name; its presence selects the native form's `rename` action. */
  name?: string;
  enabled?: boolean;
  /** `null`/`""` clears the default colour. */
  color?: string | null;
}

export interface MyTagSaveDeps {
  /** Transport for the native tagset form; tests inject a recorder. */
  post?: (url: string, body: URLSearchParams, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export interface MyTagChange {
  watched?: boolean;
  hidden?: boolean;
  /** `null` clears the colour; `undefined` keeps it. */
  color?: string | null;
  /** -99..99; `undefined` keeps the current weight (10 when adding). */
  weight?: number;
}

/** Transports for My Tags page loads and mutations, and the menu actions that invoke them. */
export interface MyTagTransports {
  /** Fetch the page that holds the saved tag ids; defaults to the shared loader. */
  loadDocument?: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  /** Transport for the `setusertag` JSON API. */
  post?: GalleryPost;
  /** Transport for the native add-form POST. */
  addTag?: (url: string, body: URLSearchParams, signal?: AbortSignal) => Promise<void>;
  /** My Tags mutations from the gallery tag menu; omitted on anonymous pages. */
  watchTag?: (tag: string) => Promise<void>;
  hideTag?: (tag: string) => Promise<void>;
  colorTag?: (tag: string, color: string) => Promise<void>;
}

interface MyTagDeps extends MyTagTransports {
  config: ApiCredentials;
  myTagsUrl: string;
  /** Current tag state; when present the My Tags page is not fetched. */
  existing?: UserTagState;
  loadDocument: (url: string, options: DocumentOptions) => Promise<HtmlResponse>;
  signal?: AbortSignal;
}

function normalizeName(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}

/** Round a weight and keep it inside the site's -99..99 range; missing input means 10. */
export function normalizeWeight(weight: number | null | undefined): number {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) {
    return DEFAULT_WEIGHT;
  }
  return Math.min(99, Math.max(-99, Math.round(weight)));
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
 * Save the selected tagset through the page's own form.
 *
 * `change.name` selects the native `rename` action; otherwise the request updates the enable flag
 * and default colour. The form's other fields are preserved, and a malformed colour is rejected
 * before the POST.
 */
export async function saveTagset(
  tagset: TagsetState,
  change: TagsetChange,
  deps: MyTagSaveDeps = {},
): Promise<void> {
  const overrides = new Map<string, string>();
  const renaming = change.name !== undefined;
  overrides.set("tagset_action", renaming ? "rename" : "update");

  if (change.name !== undefined) {
    const name = change.name.trim();
    if (name === "") {
      throw new Error("Enter a tag set name.");
    }
    overrides.set("tagset_name", name);
  } else {
    overrides.set("tagset_name", "");
  }

  // A form without the enable control must not gain one through the override fallback.
  const hasEnable = tagset.fields.some((field) => field.name === "tagset_enable");
  if (change.enabled !== undefined && hasEnable) {
    overrides.set("tagset_enable", change.enabled ? "on" : "");
  }

  if (change.color !== undefined) {
    const raw = (change.color ?? "").trim();
    const color = normalizeColor(raw);
    if (raw !== "" && color === "") {
      throw new Error("Use a #rgb or #rrggbb colour, or leave the field empty.");
    }
    overrides.set("tagset_color", color);
  }

  const post =
    deps.post ??
    ((url: string, body: URLSearchParams, signal?: AbortSignal) =>
      postForm(url, body, {
        tag: "my-tags",
        failure: "Could not save tag set",
        signal,
      }).then(() => undefined));
  await post(tagset.action, tagsetBody(tagset.fields, overrides), deps.signal);
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

  let existing = deps.existing;
  if (existing === undefined) {
    const response = await deps.loadDocument(deps.myTagsUrl, { fresh: true, signal: deps.signal });
    if (deps.signal?.aborted) {
      return "updated";
    }
    existing = parseUserTags(response.doc).find((entry) => normalizeName(entry.name) === name);
  }
  if (deps.signal?.aborted) {
    return "updated";
  }

  if (existing !== undefined) {
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
      weight: change.weight === undefined ? existing.weight : normalizeWeight(change.weight),
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
      tagweight: next.weight,
    });
    throwIfFailed(data);
    return "updated";
  }

  const weight = change.weight === undefined ? DEFAULT_WEIGHT : normalizeWeight(change.weight);
  const body = new URLSearchParams({
    usertag_action: "add",
    tagname_new: name,
    tagweight_new: String(weight),
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
