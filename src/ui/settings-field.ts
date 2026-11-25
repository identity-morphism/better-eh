/**
 * The markup shapes and draft registration the site settings form and the userscript panel share,
 * so their labels, hints and classes cannot drift apart.
 */

import { el } from "./dom";
import type { DraftBinding } from "./settings-draft";

/** Register one control's read/write pair with the draft. */
export function bindValue<T>(
  bindings: DraftBinding[],
  key: string,
  read: () => T,
  write: (value: T) => void,
): void {
  bindings.push({ key, read, write });
}

/** A stacked label/control/hint field; the hint is omitted when empty. */
export function labeledField(label: string, control: HTMLElement, hint = ""): HTMLElement {
  return el(
    "div",
    { class: "settings-field" },
    el("label", { class: "eyebrow", for: control.id, text: label }),
    control,
    hint === "" ? null : el("p", { class: "settings-hint", text: hint }),
  );
}

/** A choice row; a hint stacks under the label, as the userscript panel's toggles do. */
export function labeledRow(label: string, control: HTMLElement, hint = ""): HTMLElement {
  const caption = el("label", { for: control.id, text: label });
  const body =
    hint === ""
      ? caption
      : el(
          "div",
          { class: "settings-row-text" },
          caption,
          el("p", { class: "settings-hint", text: hint }),
        );
  return el("div", { class: "settings-row" }, control, body);
}
