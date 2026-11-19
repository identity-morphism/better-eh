import type { ApiCredentials } from "./gallery";
import { parseApiCredentials } from "./gallery";
import { cleanText, isChecked } from "./helpers";
import { safeUrl } from "./url";

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

/** One tag set choice in the native `tagset_form` selector. */
export interface TagsetChoice {
  /** Query value used by `?tagset=`; the site numbers sets from 1. */
  id: string;
  /** Option text, including the site's trailing tag count. */
  label: string;
  selected: boolean;
}

/** One named control on the tagset form, kept so an update round-trips unknown fields. */
export interface TagsetField {
  name: string;
  kind: "value" | "checkbox";
  /** Checkbox fields are "" when unchecked; value fields may legitimately be empty. */
  value: string;
}

/** The native tagset manager: one selected set plus every set the account owns. */
export interface TagsetState {
  choices: readonly TagsetChoice[];
  currentId: string;
  /** Display name from the page's `tagset_name` script variable, or the selected option text. */
  name: string;
  enabled: boolean;
  /** Normalized default colour, or "" for the site default. */
  color: string;
  /** Form target; the native form's action is empty, which resolves to the page URL. */
  action: string;
  /** Every field the form posts, in document order. */
  fields: readonly TagsetField[];
}

/** Everything the My Tags view renders for one page load. */
export interface MyTagsPage {
  /** Address this page was loaded from; the view posts changes back to it. */
  url: string;
  tags: readonly UserTagState[];
  /** The tagset manager, or null when the page has no tagset form. */
  tagsets: TagsetState | null;
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

/** A quoted string assigned to `var <key>` in one of the page's scripts. */
function scriptString(doc: Document, key: string): string | null {
  const pattern = new RegExp(`var\\s+${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`);
  for (const script of doc.querySelectorAll("script")) {
    const match = pattern.exec(script.textContent);
    const literal = match?.[1];
    if (literal === undefined) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(literal);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Drop the site's ` (N)` tag count from an option label. */
function optionName(label: string): string {
  return label.replace(/\s*\(\d+\)\s*$/u, "").trim();
}

/** Every named control on the tagset form, in document order. */
function parseTagsetFields(form: Element): TagsetField[] {
  const fields: TagsetField[] = [];
  for (const control of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    const name = control.getAttribute("name")?.trim() ?? "";
    if (name === "") {
      continue;
    }

    if (control.tagName === "INPUT") {
      const input = control as HTMLInputElement;
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      if (
        type === "submit" ||
        type === "button" ||
        type === "reset" ||
        type === "image" ||
        type === "file"
      ) {
        continue;
      }
      if (type === "checkbox") {
        fields.push({
          name,
          kind: "checkbox",
          value: isChecked(input) ? (input.getAttribute("value") ?? "on") : "",
        });
        continue;
      }
      if (type === "radio" && !isChecked(input)) {
        continue;
      }
      fields.push({ name, kind: "value", value: input.getAttribute("value") ?? "" });
      continue;
    }

    if (control.tagName === "SELECT") {
      const selected = control.querySelector("option[selected]") ?? control.querySelector("option");
      fields.push({
        name,
        kind: "value",
        value: selected?.getAttribute("value") ?? "",
      });
      continue;
    }

    fields.push({ name, kind: "value", value: control.textContent });
  }
  return fields;
}

/** The tagset selector and its current controls, or null when the page has no manager. */
export function parseTagset(doc: Document, url: string): TagsetState | null {
  const form = doc.getElementById("tagset_form");
  if (form === null) {
    return null;
  }

  const choices: TagsetChoice[] = [];
  for (const option of form.querySelectorAll("select option")) {
    const id = (option.getAttribute("value") ?? "").trim();
    if (id === "") {
      continue;
    }
    choices.push({
      id,
      label: cleanText(option.textContent),
      selected: option.hasAttribute("selected"),
    });
  }
  if (choices.length === 0) {
    return null;
  }

  const current = choices.find((choice) => choice.selected) ?? choices[0];
  if (current === undefined) {
    return null;
  }

  const fields = parseTagsetFields(form);
  const field = (name: string): TagsetField | undefined =>
    fields.find((candidate) => candidate.name === name);
  const enabledField = field("tagset_enable");
  const action = safeUrl(form.getAttribute("action") ?? "", url)?.href ?? url;

  return {
    choices,
    currentId: current.id,
    name: scriptString(doc, "tagset_name") ?? optionName(current.label),
    enabled: (enabledField?.value ?? "") !== "",
    color: normalizeColor(field("tagset_color")?.value ?? ""),
    action,
    fields,
  };
}

/** Parse `/mytags`: the saved tags, the tagset manager and the credentials the API expects. */
export function parseMyTags(doc: Document, url: string): MyTagsPage {
  return {
    url,
    tags: parseUserTags(doc),
    tagsets: parseTagset(doc, url),
    api: parseApiCredentials(doc),
  };
}
