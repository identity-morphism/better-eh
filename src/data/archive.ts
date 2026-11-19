import { postForm } from "../net/http";
import type { ArchiveOption } from "../parse/archive";
import { parseArchiveDownloadHref } from "../parse/archive";

/** Loader the archive buttons use; tests inject a fake, production posts through the site form. */
export type StartArchiveDownload = (option: ArchiveOption, signal: AbortSignal) => Promise<string>;

export interface ArchiveDownloadDeps {
  /** Test seam for the POST; production goes through `postForm` like every site mutation. */
  post?: typeof postForm;
  /** Test seam for the confirmation fragment; production uses the browser parser. */
  parseHtml?: (html: string) => Document;
}

/**
 * Submit one archive form and return the URL the site prepared.
 *
 * The POST spends GP, so it only runs for an option the parser marked `available`; the caller keeps
 * the native page reachable for unknown prices.
 */
export async function startArchiveDownload(
  option: ArchiveOption,
  signal: AbortSignal,
  deps: ArchiveDownloadDeps = {},
): Promise<string> {
  const body = new URLSearchParams({ dltype: option.dltype, dlcheck: option.label });
  const response = await (deps.post ?? postForm)(option.action, body, {
    tag: "archive",
    failure: "Archive request failed",
    signal,
  });
  const html = await response.text();
  const doc = (deps.parseHtml ?? ((text) => new DOMParser().parseFromString(text, "text/html")))(
    html,
  );
  const href = parseArchiveDownloadHref(doc, option.action);
  if (href === null) {
    throw new Error("The site did not return an archive download link.");
  }
  return href;
}
