/**
 * The quick-tag editor.
 *
 * A quick tag is a name plus a search expression; clicking it toggles the expression's terms in the
 * current search. The editor writes the whole list, so adding, renaming and removing happen in one
 * place, and every query field carries the same tag combobox as the search bar.
 */

import type { QuickTag } from "../data/quick-tags";
import { quickTags, replaceQuickTags } from "../data/quick-tags";
import { getSettings } from "../settings";
import { el, textInput } from "./dom";
import type { Popover } from "./popover";
import { openPopover } from "./popover";
import { attachTagCombobox } from "./tag-combobox";

interface QuickTagEditorOptions {
  /** Start with a new row carrying this query, focused, so saving it is one step. */
  seed?: string;
}

/** Open the quick-tag editor anchored to the button that manages the tags. */
export function openQuickTagEditor(
  anchor: HTMLElement,
  signal: AbortSignal,
  onSaved?: () => void,
  options: QuickTagEditorOptions = {},
): void {
  const draft: QuickTag[] = quickTags().map((entry) => ({ ...entry }));
  const seed = options.seed?.trim() ?? "";
  if (seed !== "") {
    draft.push({ name: "", query: seed, savedAt: Date.now() });
  }
  const list = el("div", { class: "quick-tag-list" });
  let panel: Popover | null = null;
  let rowSignal: AbortController | null = null;

  const focusQuery = (index: number): void => {
    list.querySelectorAll<HTMLInputElement>(".quick-tag-query")[index]?.focus();
  };

  const renderRows = (focusIndex?: number): void => {
    // A repaint replaces every query input; retire the comboboxes attached to the old rows.
    rowSignal?.abort();
    const rows = new AbortController();
    rowSignal = rows;
    list.replaceChildren(
      ...draft.map((entry, index) => {
        const name = textInput({
          class: "field-input quick-tag-input quick-tag-name",
          value: entry.name,
          placeholder: "Name",
          "aria-label": `Quick tag ${index + 1} name`,
        });
        name.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, name: name.value };
          }
        });

        const query = textInput({
          class: "field-input quick-tag-input quick-tag-query",
          value: entry.query,
          placeholder: 'f:tag$ ~p:"other tag$"',
          "aria-label": `Quick tag ${index + 1} search`,
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

        const remove = el("button", {
          class: "quick-tag-remove",
          type: "button",
          text: "×",
          title: "Remove quick tag",
          "aria-label": `Remove quick tag ${index + 1}`,
        });
        remove.addEventListener("click", () => {
          draft.splice(index, 1);
          renderRows();
        });

        return el("div", { class: "quick-tag-row" }, name, query, remove);
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
    draft.push({ name: "", query: "", savedAt: Date.now() });
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
    { class: "quick-tag-editor" },
    el("p", { class: "quick-tag-editor-title", text: "Quick tags" }),
    el("p", {
      class: "quick-tag-editor-hint",
      text: "Click a quick tag to add its terms to the search, or remove them when all are present.",
    }),
    list,
    el(
      "div",
      { class: "quick-tag-editor-actions" },
      add,
      el("span", { class: "quick-tag-editor-spacer" }),
      cancel,
      save,
    ),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    replaceQuickTags(
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
    label: "Quick tags",
    className: "quick-tag-editor-panel",
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
