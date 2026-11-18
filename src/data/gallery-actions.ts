import { LoginRequiredError } from "../fetch/errors";
import { postForm, postJson as postJsonRequest } from "../net/http";
import { isSiteHost } from "../site";
import type { GalleryApiConfig } from "../types";

/** Response of a successful `rategallery` call. */
interface RatingResult {
  average: number | null;
  votes: number | null;
  /** The rating the signed-in account now holds, in stars. */
  user: number | null;
}

/** Response of a successful `votecomment` call. */
interface CommentVote {
  id: number;
  score: number;
  vote: number;
}

/** Transport for gallery API POSTs; tests inject a recorder. */
export type GalleryPost = (url: string, body: unknown) => Promise<unknown>;

/** Optional transport overrides for gallery mutations. */
export interface GalleryActionDeps {
  post?: GalleryPost;
}

/** Read one field of a JSON response after checking that the field exists. */
function readField(data: unknown, key: string): unknown {
  if (typeof data !== "object" || data === null || !(key in data)) {
    return undefined;
  }
  // JSON payloads are string-keyed objects; the `in` check is the runtime shape check.
  const record = data as Record<string, unknown>;
  return record[key];
}

function readNumber(data: unknown, key: string): number | null {
  const value = readField(data, key);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function throwIfFailed(data: unknown, context: string): void {
  if (readField(data, "login") !== undefined) {
    throw new LoginRequiredError();
  }
  const error = readField(data, "error");
  if (typeof error === "string" && error !== "") {
    throw new Error(`${context}: ${error}`);
  }
}

/**
 * The endpoint arrives in the page's inline config, and the body carries the session's API key, so
 * it only counts when it resolves to the site's own domain (the API is a subdomain of it).
 */
function siteUrl(url: string): string {
  const resolved = new URL(url, location.href);
  if (resolved.protocol !== "https:" || !isSiteHost(resolved.hostname)) {
    throw new Error("Gallery request refused: the endpoint is not on this site.");
  }
  return resolved.href;
}

function postJson(url: string, body: unknown): Promise<unknown> {
  return postJsonRequest(siteUrl(url), body, {
    tag: "gallery-action",
    failure: "Gallery request failed",
  });
}

async function send(
  config: GalleryApiConfig,
  payload: Record<string, unknown>,
  deps: GalleryActionDeps,
): Promise<unknown> {
  const post = deps.post ?? postJson;
  return post(config.apiUrl, {
    apiuid: config.apiUid,
    apikey: config.apiKey,
    gid: config.gid,
    token: config.token,
    ...payload,
  });
}

/**
 * Rate the gallery. `stars` is the visual star count (0.5–5 in half steps); the API receives
 * `rating` on its native 1–10 half-star scale.
 */
export async function rateGallery(
  config: GalleryApiConfig,
  stars: number,
  deps: GalleryActionDeps = {},
): Promise<RatingResult> {
  const rating = Math.min(10, Math.max(1, Math.round(stars * 2)));
  const data = await send(config, { method: "rategallery", rating }, deps);
  throwIfFailed(data, "Could not rate gallery");
  return {
    average: readNumber(data, "rating_avg"),
    votes: readNumber(data, "rating_cnt"),
    user: readNumber(data, "rating_usr"),
  };
}

/** Vote a tag up or down. Tag panes and redirects in the response are deliberately ignored. */
export async function voteTag(
  config: GalleryApiConfig,
  tag: string,
  vote: 1 | -1,
  deps: GalleryActionDeps = {},
): Promise<void> {
  const data = await send(config, { method: "taggallery", tags: tag, vote }, deps);
  throwIfFailed(data, "Could not vote for tag");
}

/** Vote a gallery comment up or down and return its updated score. */
export async function voteComment(
  config: GalleryApiConfig,
  commentId: number,
  vote: 1 | -1,
  deps: GalleryActionDeps = {},
): Promise<CommentVote> {
  const data = await send(
    config,
    { method: "votecomment", comment_id: commentId, comment_vote: vote },
    deps,
  );
  throwIfFailed(data, "Could not vote for comment");

  const id = readNumber(data, "comment_id");
  const score = readNumber(data, "comment_score");
  const nextVote = readNumber(data, "comment_vote");
  if (id === null || score === null || nextVote === null) {
    throw new Error("Could not vote for comment: malformed response");
  }
  return { id, score, vote: nextVote };
}

/** Replace an existing comment's body through the same native form endpoint. */
export async function editComment(
  url: string,
  commentId: number,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  await postForm(
    url,
    new URLSearchParams({ commenttext_edit: text, edit_comment: String(commentId) }),
    { tag: "gallery-comment", failure: "Comment edit failed", signal },
  );
}

/** Post a gallery comment through the native form endpoint. */
export async function postComment(url: string, text: string, signal?: AbortSignal): Promise<void> {
  await postForm(url, new URLSearchParams({ commenttext_new: text }), {
    tag: "gallery-comment",
    failure: "Comment post failed",
    signal,
  });
}
