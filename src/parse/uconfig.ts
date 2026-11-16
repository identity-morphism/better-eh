/**
 * Parse the site settings page (`/uconfig.php`).
 *
 * The page carries an unrelated `#profile_form` (display-name profiles) before the real settings
 * form. We read the settings form's container rather than the form element because the site's
 * broken language matrix can make an HTML parser close the form early; `#profile_form` contributes
 * no headings or `.optouter` blocks, so its fields never leak into the model.
 *
 * Sections follow the page's `<h2>` headings. A section's `anchor` is the `name` of the `<a>`
 * immediately before the heading, which is what the site's own jump links use.
 *
 * Rules derived from the live page:
 *
 * - A radio group becomes one field with `options`; the member `selected`/`disabled` flags come from
 *   the markup. `value` is the selected option, else the first enabled option. Disabled radios
 *   exist for donator-only choices, so they stay in the model and render disabled.
 * - A checkbox becomes its own field. The site submits the implicit `on` value only while the box is
 *   checked, so an unchecked box has `value === ""`; `uconfigBody` uses that to omit it. Checkboxes
 *   keep their block prompt, which lets the view group them (the language matrix, for example).
 * - Selects, text inputs and textareas are standalone controls (`prompt === ""`). Their `label` is a
 *   short text label from the markup when one precedes the control (e.g. `H@H Region:`).
 * - Hidden inputs (the `ct_*` category matrix) are kept verbatim so unmodified settings round-trip. A
 *   hidden input whose name matches a site category carries that category's descriptor, including
 *   the shown flag decoded from the site's `0 = shown` encoding.
 * - Checkbox helpers are never modelled: nameless boxes and boxes named `-` only toggle their
 *   neighbours in the site's own script.
 */

import { cleanText } from "./helpers";
import { CATEGORIES } from "./query";

/** One selectable value of a radio group or a `<select>`. */
interface UconfigOption {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}

/** The category a hidden `ct_*` switch controls, resolved from the site's category table. */
interface UconfigCategory {
  bit: number;
  name: string;
  cls: string;
  /** Whether the category is shown by default; the site posts `"0"` for shown and `"1"` for off. */
  shown: boolean;
}

/** One control, or one radio group, on the settings page. */
export interface UconfigField {
  name: string;
  kind: "radio" | "checkbox" | "select" | "text" | "textarea" | "hidden";
  prompt: string;
  label: string | null;
  /** For a radio group: the resolved option. For a checkbox: "" when unchecked. */
  value: string;
  options: readonly UconfigOption[];
  /** The category of a hidden `ct_*` switch; null for every other control. */
  category: UconfigCategory | null;
  /** A disabled control, or a radio group whose every option is disabled. */
  disabled: boolean;
}

/** One `<h2>` section of the settings form. */
export interface UconfigSection {
  anchor: string;
  title: string;
  fields: readonly UconfigField[];
}

interface MutableSection {
  anchor: string;
  title: string;
  fields: UconfigField[];
}

const SKIPPED_INPUT_TYPES: Record<string, true> = {
  submit: true,
  button: true,
  reset: true,
  image: true,
  file: true,
};

const INLINE_LABEL_TAGS: Record<string, true> = {
  SPAN: true,
  B: true,
  STRONG: true,
  EM: true,
  LABEL: true,
};

function isInput(node: Element): node is HTMLInputElement {
  return node.tagName === "INPUT";
}

function isSelect(node: Element): node is HTMLSelectElement {
  return node.tagName === "SELECT";
}

function isTextarea(node: Element): node is HTMLTextAreaElement {
  return node.tagName === "TEXTAREA";
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function textOrNull(value: string): string | null {
  const text = cleanText(value);
  return text === "" ? null : text;
}

/** Trim a short inline label and drop the colon the site appends to it. */
function normalizeLabel(value: string): string | null {
  return textOrNull(value.replace(/\s*[:：]\s*$/, ""));
}

function inputType(input: HTMLInputElement): string {
  return (input.getAttribute("type") ?? "text").toLowerCase();
}

/**
 * Text that immediately precedes a standalone control, either inline (`H@H Region: <select>`) or in
 * the previous table cell (`<td>Horizontal:</td><td><input>`).
 */
function leadingLabel(control: Element): string | null {
  const parent = control.parentElement;
  if (!parent) {
    return null;
  }

  let before = "";
  let sibling = control.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 3) {
      before = `${sibling.textContent}${before}`;
      sibling = sibling.previousSibling;
      continue;
    }
    if (isElement(sibling) && INLINE_LABEL_TAGS[sibling.tagName] === true) {
      before = `${sibling.textContent}${before}`;
      sibling = sibling.previousSibling;
      continue;
    }
    break;
  }

  const inline = normalizeLabel(before);
  if (inline !== null) {
    return inline;
  }

  if (parent.tagName === "TD") {
    const cell = parent.previousElementSibling;
    if (cell?.tagName === "TD") {
      return normalizeLabel(cell.textContent);
    }
  }
  return null;
}

/**
 * The explanatory text beside a `.vdtable` control.
 *
 * Settings such as thumbnail scaling and the tag thresholds put their meaning in the cell after the
 * input, not in a preceding label, so the input alone has no name.
 */
function explanationText(control: Element): string {
  const cell = control.closest("td");
  const next = cell?.nextElementSibling;
  return next?.tagName === "TD" ? cleanText(next.textContent) : "";
}

/** Row and column headers of a table checkbox, e.g. "Japanese · Original". */
function tableLabel(control: Element): string | null {
  const cell = control.closest("td");
  const row = cell?.parentElement;
  const table = row?.closest("table");
  const headers = table?.querySelector("tr");
  if (!cell || !row || !table || !headers) {
    return null;
  }

  const column = [...row.children].indexOf(cell);
  if (column < 0) {
    return null;
  }

  const rowLabel = cleanText(row.querySelector("td, th")?.textContent);
  const columnLabel = cleanText(headers.children[column]?.textContent);
  const parts = [rowLabel, columnLabel].filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

/** A checkbox's own label, falling back to the headers of the table cell that holds it. */
function checkboxLabel(input: HTMLInputElement): string | null {
  const own = textOrNull(input.closest("label")?.textContent ?? "");
  return own ?? tableLabel(input);
}

function radioOption(input: HTMLInputElement): UconfigOption {
  return {
    value: input.getAttribute("value") ?? "on",
    label: textOrNull(input.closest("label")?.textContent ?? "") ?? "",
    selected: input.hasAttribute("checked"),
    disabled: input.hasAttribute("disabled"),
  };
}

/** Normalized key so `ct_non-h` and "Non-H" agree. */
function categoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The site's hidden category switches: `"0"` shows the category, `"1"` excludes it. */
export function categorySwitchShown(value: string): boolean {
  return value === "0";
}

/** The hidden value that expresses a shown (or excluded) category. */
export function categorySwitchValue(shown: boolean): string {
  return shown ? "0" : "1";
}

/** The category a hidden input controls, or null when the input is something else. */
function categoryFor(name: string, value: string): UconfigCategory | null {
  if (!name.startsWith("ct_")) {
    return null;
  }
  const key = categoryKey(name.slice("ct_".length));
  const category = CATEGORIES.find((candidate) => categoryKey(candidate.name) === key);
  return category
    ? {
        bit: category.bit,
        name: category.name,
        cls: category.cls,
        shown: categorySwitchShown(value),
      }
    : null;
}

function radioField(
  name: string,
  inputs: readonly HTMLInputElement[],
  prompt: string,
): UconfigField {
  const options = inputs.map(radioOption);
  const selected = options.find((option) => option.selected);
  const enabled = options.find((option) => !option.disabled);
  return {
    name,
    kind: "radio",
    prompt,
    label: null,
    value: selected?.value ?? enabled?.value ?? "",
    options,
    category: null,
    disabled: options.length > 0 && options.every((option) => option.disabled),
  };
}

function checkboxField(input: HTMLInputElement, prompt: string): UconfigField {
  const checked = input.hasAttribute("checked");
  return {
    name: input.getAttribute("name") ?? "",
    kind: "checkbox",
    prompt,
    label: checkboxLabel(input),
    value: checked ? (input.getAttribute("value") ?? "on") : "",
    options: [],
    category: null,
    disabled: input.hasAttribute("disabled"),
  };
}

function selectField(select: HTMLSelectElement): UconfigField {
  const rawOptions = [...select.options].map((option) => ({
    value: option.value,
    label: cleanText(option.textContent),
    selected: option.hasAttribute("selected"),
    disabled: option.hasAttribute("disabled"),
  }));

  // A single select with no `selected` attribute selects its first option, exactly like a browser.
  let selectedIndex = -1;
  rawOptions.forEach((option, index) => {
    if (option.selected) {
      selectedIndex = index;
    }
  });
  const options =
    selectedIndex === -1 && rawOptions.length > 0
      ? rawOptions.map((option, index) => ({ ...option, selected: index === 0 }))
      : rawOptions;

  return {
    name: select.getAttribute("name") ?? "",
    kind: "select",
    prompt: "",
    label: leadingLabel(select),
    value: options.find((option) => option.selected)?.value ?? "",
    options,
    category: null,
    disabled: select.hasAttribute("disabled"),
  };
}

function textField(input: HTMLInputElement, prompt: string): UconfigField {
  return {
    name: input.getAttribute("name") ?? "",
    kind: "text",
    prompt: prompt === "" ? explanationText(input) : prompt,
    label: leadingLabel(input),
    value: input.getAttribute("value") ?? "",
    options: [],
    category: null,
    disabled: input.hasAttribute("disabled"),
  };
}

function textareaField(textarea: HTMLTextAreaElement, prompt: string): UconfigField {
  return {
    name: textarea.getAttribute("name") ?? "",
    kind: "textarea",
    prompt,
    label: leadingLabel(textarea),
    value: textarea.textContent,
    options: [],
    category: null,
    disabled: textarea.hasAttribute("disabled"),
  };
}

function hiddenField(input: HTMLInputElement): UconfigField {
  const name = input.getAttribute("name") ?? "";
  const value = input.getAttribute("value") ?? "";
  return {
    name,
    kind: "hidden",
    prompt: "",
    label: null,
    value,
    options: [],
    category: categoryFor(name, value),
    disabled: input.hasAttribute("disabled"),
  };
}

function parseBlock(block: Element, out: UconfigField[]): void {
  const prompt = cleanText(block.querySelector("p")?.textContent);
  const controls = [...block.querySelectorAll("input, select, textarea")];

  const radioGroups = new Map<string, HTMLInputElement[]>();
  for (const control of controls) {
    if (!isInput(control) || inputType(control) !== "radio") {
      continue;
    }
    const name = control.getAttribute("name");
    if (name === null || name.trim() === "" || name === "-") {
      continue;
    }
    const group = radioGroups.get(name);
    if (group) {
      group.push(control);
    } else {
      radioGroups.set(name, [control]);
    }
  }

  const emittedRadios = new Set<string>();
  for (const control of controls) {
    if (isInput(control)) {
      const type = inputType(control);
      const name = control.getAttribute("name");
      // Nameless and `-` boxes are the site's select-all helpers, not settings of their own.
      if (name === null || name.trim() === "" || name === "-") {
        continue;
      }
      if (SKIPPED_INPUT_TYPES[type] === true) {
        continue;
      }
      if (type === "radio") {
        if (emittedRadios.has(name)) {
          continue;
        }
        emittedRadios.add(name);
        out.push(radioField(name, radioGroups.get(name) ?? [control], prompt));
      } else if (type === "checkbox") {
        out.push(checkboxField(control, prompt));
      } else if (type === "hidden") {
        out.push(hiddenField(control));
      } else {
        out.push(textField(control, prompt));
      }
      continue;
    }
    const name = control.getAttribute("name");
    if (name === null || name.trim() === "" || name === "-") {
      continue;
    }
    if (isSelect(control)) {
      out.push(selectField(control));
    } else if (isTextarea(control)) {
      out.push(textareaField(control, prompt));
    }
  }
}

function settingsContainer(doc: Document): ParentNode | null {
  const submit = doc.querySelector('input[name="apply"]');
  let form = submit?.closest("form") ?? null;
  if (form?.getAttribute("id") === "profile_form") {
    form = null;
  }
  if (!form) {
    for (const candidate of doc.querySelectorAll("form")) {
      if (candidate.getAttribute("id") !== "profile_form") {
        form = candidate;
        break;
      }
    }
  }
  if (!form) {
    return doc.querySelector(".optouter") ? doc : null;
  }

  let scope: Element | null = form.parentElement;
  while (submit && scope && !scope.contains(submit)) {
    scope = scope.parentElement;
  }
  return scope ?? doc;
}

function sectionAnchor(heading: Element): string {
  const previous = heading.previousElementSibling;
  if (previous?.tagName !== "A") {
    return "";
  }
  return previous.getAttribute("name") ?? previous.getAttribute("id") ?? "";
}

/**
 * Parse the settings form into sections.
 *
 * Returns an empty list when the document has no settings form (for example the login wall).
 */
export function parseUconfig(doc: Document): readonly UconfigSection[] {
  const container = settingsContainer(doc);
  if (!container) {
    return [];
  }

  const sections: MutableSection[] = [];
  let current: MutableSection | null = null;

  // Document order: an `<h2>` opens a section, every `.optouter` after it belongs to that section.
  // Anchors without a heading (the site has one for "original images") are not new sections.
  for (const marker of container.querySelectorAll("h2, .optouter")) {
    if (marker.tagName === "H2") {
      current = {
        anchor: sectionAnchor(marker),
        title: cleanText(marker.textContent),
        fields: [],
      };
      sections.push(current);
    } else if (current) {
      parseBlock(marker, current.fields);
    }
  }

  return sections.filter((section) => section.fields.length > 0);
}

/**
 * Rebuild the POST body for the settings form.
 *
 * Walks every parsed field in document order and applies `overrides` (from the settings view). The
 * parser resolved each control's current value, so the body consumes `field.value` instead of
 * re-deriving a selection: a radio group posts exactly one value (override, else `value`); a
 * checkbox posts its value only when it is non-empty; hidden inputs and `apply=Apply` are always
 * present so an untouched page round-trips exactly.
 *
 * A checkbox override of `""` means the user unchecked the box; a non-empty override means the box
 * is checked and carries that value.
 */
export function uconfigBody(
  sections: readonly UconfigSection[],
  overrides: ReadonlyMap<string, string>,
): URLSearchParams {
  const body = new URLSearchParams();
  const emittedRadios = new Set<string>();

  for (const section of sections) {
    for (const field of section.fields) {
      const override = overrides.get(field.name);
      switch (field.kind) {
        case "radio": {
          if (emittedRadios.has(field.name)) {
            continue;
          }
          emittedRadios.add(field.name);
          body.append(field.name, override ?? field.value);
          break;
        }
        case "checkbox": {
          const value = override ?? field.value;
          if (value !== "") {
            body.append(field.name, value);
          }
          break;
        }
        case "select":
        case "text":
        case "textarea":
        case "hidden": {
          body.append(field.name, override ?? field.value);
          break;
        }
      }
    }
  }

  body.append("apply", "Apply");
  return body;
}
