import type { ApiCredentials } from "./gallery";
import { parseApiCredentials } from "./gallery";
import { isChecked } from "./helpers";

/** One saved user tag and the state shown on `/mytags`. */
export interface UserTagState {
  /** Numeric id from the site's `usertag_<id>` block. */
  id: number;
  name: string;
  watched: boolean;
  hidden: boolean;
  /** Normalized `#rgb`/`#rrggbb`, or "" when the tag has no colour. */
  color: string;
  weight: number;
}

/** Everything the My Tags view renders for one page load. */
export interface MyTagsPage {
  /** Address this page was loaded from; the view posts changes back to it. */
  url: string;
  tags: readonly UserTagState[];
  /** Inline API credentials, or null when the page carries none. */
  api: ApiCredentials | null;
}

const DEFAULT_WEIGHT = 10;

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
      weight: Number.isFinite(weight) ? weight : DEFAULT_WEIGHT,
    });
  }
  return tags;
}

/** Parse `/mytags`: the saved tags plus the credentials its mutation API expects. */
export function parseMyTags(doc: Document, url: string): MyTagsPage {
  return {
    url,
    tags: parseUserTags(doc),
    api: parseApiCredentials(doc),
  };
}
