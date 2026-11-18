import { LoginRequiredError } from "../fetch/errors";
import { priorityOf } from "./priority";
import { net } from "./queue";

/** Per-call differences between the site's POSTs. */
interface FormPostOptions {
  /** Queue tag, used for prioritisation and `purge`. */
  tag: string;
  /** Sentence the failure message starts with, e.g. `"Favorite request failed"`. */
  failure: string;
  /** View lifetime; aborts a queued or in-flight request. */
  signal?: AbortSignal;
}

/**
 * Send a POST through the request queue.
 *
 * Every mutation on the site is the same request: session cookie, critical priority, and a non-2xx
 * status turned into an error carrying the caller's failure label. The two exported helpers below
 * only choose the body encoding and how the response is read.
 */
async function post(
  url: string,
  body: BodyInit,
  contentType: string,
  options: FormPostOptions,
): Promise<Response> {
  const response = await net.fetch(url, {
    priority: priorityOf("critical"),
    tag: options.tag,
    signal: options.signal,
    init: {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { "Content-Type": contentType },
    },
  });

  if (!response.ok) {
    throw new Error(`${options.failure} (${response.status}).`);
  }
  // The site answers a dead session with HTTP 200 and its login form, so a status check alone
  // reports success for a mutation that never ran. A success body never carries a password field.
  if (isLoginWall(await response.clone().text())) {
    throw new LoginRequiredError();
  }
  return response;
}

/** True when the body is the site's login page rather than the result of the mutation. */
export function isLoginWall(body: string): boolean {
  return /<input[^>]+type=["']?password/i.test(body);
}

/**
 * POST an `application/x-www-form-urlencoded` body through the request queue.
 *
 * The response is returned for callers that have to inspect the body; non-2xx throws.
 */
export function postForm(
  url: string,
  body: URLSearchParams,
  options: FormPostOptions,
): Promise<Response> {
  return post(url, body, "application/x-www-form-urlencoded", options);
}

/**
 * POST a JSON body through the request queue.
 *
 * The site's gallery and user-tag APIs take JSON where the forms take URL encoding; the parsed body
 * is returned and non-2xx throws.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: FormPostOptions,
): Promise<unknown> {
  const response = await post(url, JSON.stringify(body), "application/json", options);
  return (await response.json()) as unknown;
}

const LIMIT_PATTERNS = [
  /image viewing limit/i,
  /not have sufficient gp/i,
  /opening pages too fast/i,
  /temporarily banned/i,
  /too many requests/i,
];

/** True when the body is the site's throttling or ban notice rather than a page. */
export function isRateLimitText(text: string): boolean {
  return LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when the body looks like an HTML document. */
export function isHtmlResponse(response: Response, text: string): boolean {
  const type = response.headers.get("content-type") ?? "";
  return type.includes("html") || /^\s*<(!doctype|html|head|body)/i.test(text);
}

/** Markers every real owned page carries; a wall/404 page has none of them. */
const PAGE_CONTENT_SELECTOR =
  "#gn, #gdt, #gdd, #i1, #i2, #i3, #profile_form, #usertags_outer, #torrentinfo, .itg";

function hasPageContent(doc: Document): boolean {
  return doc.querySelector(PAGE_CONTENT_SELECTOR) !== null;
}

/**
 * True when the parsed document is the site's login wall.
 *
 * The title fallback is only safe when the page has no real content: gallery titles are
 * uploader-controlled, so a gallery named "Sad Panda" must not be mistaken for the wall.
 */
export function isLoginPage(doc: Document): boolean {
  if (doc.querySelector("#sadpanda") !== null) {
    return true;
  }
  return !hasPageContent(doc) && /sad panda/i.test(doc.title);
}

/** Title suffix the site appends after the page name. */
const SITE_SUFFIX = /\s*[-–—|]\s*(?:e-hentai|exhentai)(?:\.org)?(?:\s+galleries)?\s*$/i;

const NOT_FOUND_HEADINGS: Record<string, true> = {
  "not found": true,
  "not available": true,
  "gallery not available": true,
};

/** Collapse whitespace and drop the site suffix so both title and heading compare as page names. */
function normalizeHeading(text: string): string {
  return text.replace(SITE_SUFFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A 404 can also arrive as a bare sentence with no heading at all. */
const NOT_FOUND_TEXT = /^(?:gallery not found|gallery not available|page not found|not found)\b/i;

/**
 * True when the parsed document is the host's own 404 page.
 *
 * The site answers with three different shapes: an HTML page titled "404" or "Not Found", a
 * "Gallery Not Available" page, and — for a gallery it never had — a ~170-byte plain-text body
 * ("Gallery not found. If you just added this gallery…"). A route that owns a path can be handed
 * any of them on initial load instead of an HTTP error.
 */
export function isNotFoundPage(doc: Document): boolean {
  // A real page whose uploader-chosen title happens to be "Not Found" or "404" still carries the
  // gallery/listing markers; only the host's own empty 404 shell lacks them.
  if (hasPageContent(doc)) {
    return false;
  }
  const title = normalizeHeading(doc.title);
  const heading = normalizeHeading(doc.querySelector("h1")?.textContent ?? "");
  const body = doc.body.textContent.trim();
  const bare = body.length > 0 && body.length < 800 && NOT_FOUND_TEXT.test(body);
  return (
    [title, heading].some((text) => /^404\b/.test(text) || NOT_FOUND_HEADINGS[text] === true) ||
    bare
  );
}
