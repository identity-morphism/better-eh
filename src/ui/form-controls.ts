/**
 * The one adapter for option-bearing controls in the settings forms.
 *
 * Both the site's uconfig form and the userscript panel build their selects, radios and checkboxes
 * here, so the linkedom attribute workarounds and the fallback rules live in one place. Values are
 * always the plan the model resolved; the adapter never re-derives a selection.
 */

import { isChecked } from "../parse/helpers";
import { el } from "./dom";

interface SelectOptions {
  id?: string;
  name?: string;
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** The option to select; the first option when no option carries it. */
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
}

export interface SelectControl {
  element: HTMLSelectElement;
  read: () => string;
  write: (value: string) => void;
}

/**
 * The value of the selected option, falling back to the first option like the browser does.
 *
 * A browser keeps the `selected` attribute on the original default option after the user picks
 * another one, so the live selectedness has to win. A spec DOM exposes that through
 * `selectedIndex`/`value` in one read; the test DOM lacks a live index and derives `value` from the
 * stale attribute, so only then does the option scan (which reads live `selected`) run.
 */
function selectedValue(select: HTMLSelectElement): string {
  const live: unknown = select.value;
  if (typeof live === "string" && live !== "" && typeof select.selectedIndex === "number") {
    return live;
  }
  let first: string | undefined;
  let attributed: string | undefined;
  for (const option of select.querySelectorAll<HTMLOptionElement>("option")) {
    if (option.selected === true) {
      return option.value;
    }
    first ??= option.value;
    if (attributed === undefined && option.hasAttribute("selected")) {
      attributed = option.value;
    }
  }
  return attributed ?? first ?? "";
}

/** Select one option by value, moving the `selected` attribute and the live selection together. */
function setSelectValue(select: HTMLSelectElement, value: string): void {
  const options = [...select.querySelectorAll<HTMLOptionElement>("option")];
  // Move the attribute first and the live selection last: linkedom clears the whole selection when
  // a non-selected option is assigned `false`, so the chosen option must be set afterwards.
  for (const option of options) {
    if (option.value === value) {
      option.setAttribute("selected", "");
    } else {
      option.removeAttribute("selected");
    }
  }
  const chosen = options.find((option) => option.value === value);
  if (chosen) {
    chosen.selected = true;
  }
}

/** Build a select whose options carry the initial selection as an attribute. */
export function createSelect(options: SelectOptions): SelectControl {
  const select = el("select", {
    class: options.class,
    id: options.id,
    name: options.name,
    "aria-label": options.ariaLabel,
    disabled: options.disabled ? "" : null,
  });
  for (const option of options.options) {
    select.append(
      el("option", {
        value: option.value,
        text: option.label,
        selected: option.value === options.value ? "" : null,
        disabled: option.disabled ? "" : null,
      }),
    );
  }
  return {
    element: select,
    read: () => selectedValue(select),
    write: (value) => setSelectValue(select, value),
  };
}

interface ChoiceSpec {
  type: "radio" | "checkbox";
  value: string;
  checked: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
}

export interface CheckedControl {
  element: HTMLInputElement;
  readChecked: () => boolean;
  writeChecked: (checked: boolean) => void;
}

/** Build a radio or checkbox with its initial checked state as an attribute. */
export function createChoice(options: ChoiceSpec): CheckedControl {
  const element = el("input", {
    type: options.type,
    value: options.value,
    checked: options.checked ? "" : null,
    id: options.id,
    name: options.name,
    disabled: options.disabled ? "" : null,
  });
  return {
    element,
    readChecked: () => isChecked(element),
    writeChecked: (checked) => {
      element.checked = checked;
    },
  };
}

interface CheckboxOptions {
  id?: string;
  name?: string;
  disabled?: boolean;
  /** The submitted value while checked; `on` when omitted. */
  value?: string;
  checked?: boolean;
}

export interface CheckboxControl extends CheckedControl {
  /** The submitted value: `""` while unchecked, otherwise the input's value. */
  readValue: () => string;
  writeValue: (value: string) => void;
}

/** Build a checkbox whose draft value is its submitted value, `""` while unchecked. */
export function createCheckbox(options: CheckboxOptions): CheckboxControl {
  const choice = createChoice({
    type: "checkbox",
    value: options.value ?? "on",
    checked: options.checked ?? false,
    id: options.id,
    name: options.name,
    disabled: options.disabled,
  });
  return {
    ...choice,
    readValue: () => (choice.readChecked() ? choice.element.value : ""),
    writeValue: (value) => {
      choice.writeChecked(value !== "");
      if (value !== "") {
        choice.element.value = value;
      }
    },
  };
}
