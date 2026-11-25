/**
 * One editor for saved searches and quick tags.
 *
 * Both are a name plus a query; the mode picks whether a click runs the query or toggles its terms
 * into the current draft, and the pin decides whether it also appears as a quick-tag button. A
 * quick tag always toggles, so pinning switches a run expression to toggle and switching a pinned
 * expression to run unpins it. The editor writes the whole list, so adding, renaming and removing
 * happen in one place. Query fields carry the same tag combobox as the search bar.
 */

import type { ExpressionMode, SavedExpression } from "../data/saved-expressions";
import { replaceExpressions, savedExpressions } from "../data/saved-expressions";
import { getSettings } from "../settings";
import { el, textInput } from "./dom";
import type { Popover } from "./popover";
import { openPopover } from "./popover";
import { attachTagCombobox } from "./tag-combobox";

const MODES: readonly { value: ExpressionMode; label: string }[] = [
  { value: "run", label: "Run search" },
  { value: "toggle", label: "Toggle terms" },
];
const TOGGLE_MODE_INDEX = MODES.findIndex((mode) => mode.value === "toggle");

function modeSelect(value: ExpressionMode, index: number): HTMLSelectElement {
  const select = el(
    "select",
    { class: "field-select expression-mode", "aria-label": `Expression ${index + 1} action` },
    ...MODES.map((mode) =>
      el("option", { value: mode.value, text: mode.label, selected: mode.value === value }),
    ),
  );
  return select;
}

interface ExpressionEditorOptions {
  /** Start with a new row carrying this query, focused, so saving it is one step. */
  seed?: string;
}

/** Open the shared editor anchored to the button that manages expressions. */
export function openExpressionEditor(
  anchor: HTMLElement,
  signal: AbortSignal,
  onSaved?: () => void,
  options: ExpressionEditorOptions = {},
): void {
  const draft: SavedExpression[] = savedExpressions().map((entry) => ({ ...entry }));
  const seed = options.seed?.trim() ?? "";
  if (seed !== "") {
    draft.push({ name: "", query: seed, mode: "run", pinned: false, savedAt: Date.now() });
  }
  const list = el("div", { class: "expression-list" });
  let panel: Popover | null = null;
  let rowSignal: AbortController | null = null;

  const focusQuery = (index: number): void => {
    list.querySelectorAll<HTMLInputElement>(".expression-query")[index]?.focus();
  };

  const renderRows = (focusIndex?: number): void => {
    // A repaint replaces every query input; retire the comboboxes attached to the old rows.
    rowSignal?.abort();
    const rows = new AbortController();
    rowSignal = rows;
    list.replaceChildren(
      ...draft.map((entry, index) => {
        const name = textInput({
          class: "field-input expression-input expression-name",
          value: entry.name,
          placeholder: "Name",
          "aria-label": `Expression ${index + 1} name`,
        });
        name.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, name: name.value };
          }
        });

        const query = textInput({
          class: "field-input expression-input expression-query",
          value: entry.query,
          placeholder: 'f:tag$ ~p:"other tag$"',
          "aria-label": `Expression ${index + 1} search`,
        });
        query.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, query: query.value };
          }
        });
        if (getSettings().tagSuggestions) {
          attachTagCombobox({ input: query, signal: rows.signal });
        }

        const mode = modeSelect(entry.mode, index);
        const pin = el("input", {
          type: "checkbox",
          checked: entry.pinned ? "checked" : null,
          "aria-label": `Show ${entry.name || "expression"} as a quick tag`,
        });

        mode.addEventListener("change", () => {
          const current = draft[index];
          if (current === undefined) {
            return;
          }
          const next: ExpressionMode =
            mode.options[mode.selectedIndex]?.value === "run" ? "run" : "toggle";
          // A quick tag has no run verb; changing a pinned row to run unpins it.
          const pinned = next === "toggle" && current.pinned;
          draft[index] = { ...current, mode: next, pinned };
          pin.checked = pinned;
        });
        pin.addEventListener("change", () => {
          const current = draft[index];
          if (current === undefined) {
            return;
          }
          // Pinning makes the expression a quick tag, and quick tags toggle their terms.
          const pinned = pin.checked === true;
          draft[index] = {
            ...current,
            pinned,
            mode: pinned ? "toggle" : current.mode,
          };
          if (pinned) {
            mode.selectedIndex = TOGGLE_MODE_INDEX;
          }
        });

        const remove = el("button", {
          class: "expression-remove",
          type: "button",
          text: "×",
          title: "Remove expression",
          "aria-label": `Remove expression ${index + 1}`,
        });
        remove.addEventListener("click", () => {
          draft.splice(index, 1);
          renderRows();
        });

        return el(
          "div",
          { class: "expression-row" },
          name,
          query,
          remove,
          el(
            "div",
            { class: "expression-options" },
            mode,
            el("label", { class: "check expression-pin" }, pin, el("span", { text: "Quick tag" })),
          ),
        );
      }),
    );
    if (focusIndex !== undefined) {
      focusQuery(focusIndex);
    }
  };

  const add = el("button", {
    class: "btn btn-ghost btn-small",
    type: "button",
    text: "+ Add",
  });
  add.addEventListener("click", () => {
    draft.push({
      name: "",
      query: "",
      mode: "run",
      pinned: false,
      savedAt: Date.now(),
    });
    renderRows(draft.length - 1);
  });

  const save = el("button", { class: "btn btn-small", type: "submit", text: "Save" });
  const cancel = el("button", {
    class: "btn btn-ghost btn-small",
    type: "button",
    text: "Cancel",
  });
  cancel.addEventListener("click", () => {
    panel?.close();
  });

  const form = el(
    "form",
    { class: "expression-editor" },
    el("p", { class: "expression-editor-title", text: "Saved searches and quick tags" }),
    el("p", {
      class: "expression-editor-hint",
      text: "Saved searches replace the search. Quick tags toggle their terms and also appear under the search field.",
    }),
    list,
    el(
      "div",
      { class: "expression-editor-actions" },
      add,
      el("span", { class: "expression-editor-spacer" }),
      cancel,
      save,
    ),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    replaceExpressions(
      draft.map((entry) => ({
        ...entry,
        name: entry.name.trim() || entry.query.trim(),
        query: entry.query.trim(),
      })),
    );
    onSaved?.();
    panel?.close();
  });

  renderRows();
  panel = openPopover({
    content: form,
    anchor,
    label: "Saved searches and quick tags",
    className: "expression-editor-panel",
    signal,
    autoFocus: true,
    onClose: () => {
      rowSignal?.abort();
      rowSignal = null;
    },
  });
  // The popover's auto-focus lands on the first field; a seeded row starts on its query instead.
  if (seed !== "") {
    focusQuery(draft.length - 1);
  }
}
