/**
 * Accessible tag-search combobox.
 *
 * The dropdown is a portal so sticky headers cannot clip it. Suggestions complete the term under
 * the caret instead of only the last word: `-`, `~`, namespace prefixes, quoted values and text
 * after the caret are all preserved. Modifier or footer-button exclusion and already-applied tags
 * make repeat filters and negation one keystroke away.
 */

import { getSettings } from "../settings";
import type { TagCompletion, TagCompletionInput, TagIndex, TagUsage } from "../tags/db";
import {
  getTagIndex,
  loadTagIndex,
  onTagIndexChange,
  recordTagCompletion,
  recordTagUse,
  tagCompletions,
  tagUsage,
} from "../tags/db";
import type { SearchTerm, TagSign } from "../tags/model";
import { removeTerm, replaceTerm } from "../tags/model";
import { buildSuggestions, effectiveSign, suggestionInsertion } from "../tags/suggest";
import type { Suggestion, SuggestResult } from "../tags/suggest";
import { buttonEl, el } from "./dom";
import { openPopover } from "./popover";
import type { Popover } from "./popover";
import { countText } from "./text";

const LIMIT = 50;

let nextId = 0;

type LoadState = "idle" | "loading" | "ready" | "error";

interface TagComboboxDeps {
  getIndex: () => TagIndex | null;
  loadIndex: () => Promise<TagIndex>;
  getUsage: () => ReadonlyMap<string, TagUsage>;
  recordUse: (ns: string, key: string) => void;
  getCompletions: () => ReadonlyMap<string, TagCompletion>;
  recordCompletion: (input: TagCompletionInput) => void;
}

export interface TagComboboxOptions {
  input: HTMLInputElement;
  signal?: AbortSignal;
  /** Called after a tag is inserted or removed, once the input holds a committed term. */
  onCommit?: () => void;
  deps?: Partial<TagComboboxDeps>;
}

export interface TagCombobox {
  open: () => void;
  /** Recompute suggestions if the panel is open; stays closed otherwise. */
  refresh: () => void;
}

function inputCaret(input: HTMLInputElement): number {
  return input.selectionStart ?? input.value.length;
}

function setSelection(input: HTMLInputElement, position: number): void {
  const caret = Math.max(0, Math.min(position, input.value.length));
  if (typeof input.setSelectionRange === "function") {
    input.setSelectionRange(caret, caret);
    return;
  }
  try {
    input.selectionStart = caret;
    input.selectionEnd = caret;
  } catch {
    // Some embedders do not implement selection APIs; the value is still correct.
  }
}

function highlight(text: string, start: number, length: number): (Node | string)[] {
  if (start < 0 || length <= 0) {
    return [text];
  }
  const end = start + length;
  const nodes: (Node | string)[] = [
    text.slice(0, start),
    el("mark", { text: text.slice(start, end) }),
  ];
  if (end < text.length) {
    nodes.push(text.slice(end));
  }
  return nodes;
}

function nsClass(ns: string): string {
  return `ns-${ns.replace(/[^a-z0-9_-]/giu, "")}`;
}

/**
 * Attach the combobox to an input. Returns the open/refresh controller; the `signal` option also
 * tears down every listener and the portal panel.
 */
export function attachTagCombobox(options: TagComboboxOptions): TagCombobox {
  const { input } = options;
  const deps: TagComboboxDeps = {
    getIndex: options.deps?.getIndex ?? getTagIndex,
    loadIndex: options.deps?.loadIndex ?? loadTagIndex,
    getUsage: options.deps?.getUsage ?? tagUsage,
    recordUse: options.deps?.recordUse ?? recordTagUse,
    getCompletions: options.deps?.getCompletions ?? tagCompletions,
    recordCompletion: options.deps?.recordCompletion ?? recordTagCompletion,
  };
  const signal = options.signal;
  const panelId = `eh-tag-combobox-${nextId++}`;
  const listId = `${panelId}-list`;

  let popover: Popover | null = null;
  let list: HTMLDivElement | null = null;
  let countLabel: HTMLSpanElement | null = null;
  let excludeButton: HTMLButtonElement | null = null;
  let retryButton: HTMLButtonElement | null = null;
  let optionEls: HTMLElement[] = [];
  let index: TagIndex | null = null;
  let state: LoadState = "idle";
  let loading: Promise<void> | null = null;
  let result: SuggestResult | null = null;
  let active = -1;
  let excludeNext = false;
  let modifierExclude = false;
  let composing = false;
  let destroyed = false;
  let stopIndexWatch: (() => void) | null = null;

  // Parse the local cache at mount so the first focus renders without a visible stall. This never
  // touches the network.
  deps.getIndex();

  // A refreshed popularity snapshot rebuilds the index in the background. Refresh the open panel
  // when it lands; the next open reads the rebuilt index anyway.
  stopIndexWatch = onTagIndexChange(() => {
    if (destroyed) {
      return;
    }
    const latest = deps.getIndex();
    if (latest) {
      index = latest;
      if (state === "idle") {
        state = "ready";
      }
    }
    if (isOpen()) {
      render();
    }
  });

  function enabled(): boolean {
    return getSettings().tagSuggestions;
  }

  function isOpen(): boolean {
    return popover !== null;
  }

  function excludeActive(): boolean {
    return excludeNext || modifierExclude;
  }

  function setInputAttributes(expanded: boolean): void {
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-autocomplete", "list");
    if (expanded) {
      input.setAttribute("aria-controls", listId);
    } else {
      input.removeAttribute("aria-controls");
    }
    input.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (!expanded) {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function setActive(next: number): void {
    active = next;
    for (const [i, node] of optionEls.entries()) {
      const selected = i === active;
      node.classList.toggle("is-active", selected);
      node.setAttribute("aria-selected", selected ? "true" : "false");
    }
    const current = active >= 0 ? optionEls[active] : null;
    if (current) {
      input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function move(delta: number): void {
    if (!isOpen() || optionEls.length === 0) {
      return;
    }
    const count = optionEls.length;
    const start = active < 0 ? (delta > 0 ? -1 : 0) : active;
    setActive((start + delta + count) % count);
  }

  function row(suggestion: Suggestion, slot: number, sign: TagSign): HTMLElement {
    const id = `${panelId}-option-${slot}`;
    const node = el("div", {
      class: "tag-option",
      id,
      role: "option",
      "aria-selected": "false",
    });
    // The sign is only a visual glyph; the accessible name has to carry it too.
    const signLabel = sign === "-" ? "Exclude " : sign === "~" ? "Optional " : "";

    if (suggestion.kind === "namespace") {
      node.classList.add("is-namespace");
      node.append(
        el("span", { class: `tag-option-badge ${nsClass(suggestion.ns.id)}`, text: "ns" }),
        el("span", { class: "tag-option-key", text: suggestion.ns.label }),
        el("span", {
          class: "tag-option-meta",
          text: suggestion.tail === "" ? "namespace" : "complete namespace",
        }),
      );
      node.setAttribute(
        "aria-label",
        `${signLabel}Complete namespace ${suggestion.ns.id}${suggestion.tail === "" ? "" : ` with ${suggestion.tail}`}`,
      );
    } else {
      const { entry } = suggestion;
      if (sign !== "") {
        node.classList.add(sign === "-" ? "is-excluded" : "is-or");
        node.append(
          el("span", {
            class: "tag-option-sign",
            "aria-hidden": "true",
            text: sign === "-" ? "−" : "~",
          }),
        );
      }
      node.append(
        el("span", { class: `tag-option-badge ${nsClass(entry.ns.id)}`, text: entry.ns.label }),
      );

      const key = el("span", { class: "tag-option-key" });
      key.append(...highlight(entry.key, suggestion.matchStart, suggestion.matchLength));
      node.append(key);

      if (suggestion.applied) {
        node.classList.add("is-applied");
        node.append(el("span", { class: "tag-option-meta", text: "applied" }));
        node.setAttribute(
          "aria-label",
          `${entry.ns.label} ${entry.key}, already applied. Activate to remove.`,
        );
      } else if (suggestion.recent) {
        node.append(el("span", { class: "tag-option-meta", text: "recent" }));
        node.setAttribute(
          "aria-label",
          `${signLabel}${entry.ns.label} ${entry.key}, recently used`,
        );
      } else {
        node.setAttribute("aria-label", `${signLabel}${entry.ns.label} ${entry.key}`);
      }
    }

    node.addEventListener("pointerdown", (event) => {
      // Keep focus in the input; the click below performs the insertion.
      event.preventDefault();
    });
    node.addEventListener("pointermove", () => {
      if (active !== slot) {
        setActive(slot);
      }
    });
    node.addEventListener("click", () => {
      applyAt(slot);
    });
    return node;
  }

  function renderMessage(title: string, detail: string, retry: boolean): void {
    if (!list) {
      return;
    }
    optionEls = [];
    list.replaceChildren(
      el(
        "div",
        { class: "tag-combobox-state", role: "presentation" },
        el("strong", { text: title }),
        el("span", { text: detail }),
      ),
    );
    if (retryButton) {
      retryButton.hidden = !retry;
    }
  }

  function render(): void {
    if (!popover || !list) {
      return;
    }

    if (!enabled()) {
      close();
      return;
    }

    const latest = deps.getIndex();
    if (latest) {
      index = latest;
      if (state === "idle") {
        state = "ready";
      }
    }

    if (state === "loading" && !index) {
      list.setAttribute("aria-busy", "true");
      renderMessage("Loading tags…", "The tag vocabulary is downloaded once and cached.", false);
      if (countLabel) {
        countLabel.textContent = "Loading tag list…";
      }
      return;
    }

    list.removeAttribute("aria-busy");
    if (state === "error" && !index) {
      renderMessage(
        "Tag suggestions unavailable",
        "Search still works: type a tag and press Enter.",
        true,
      );
      if (countLabel) {
        countLabel.textContent = "Could not load the tag list";
      }
      return;
    }

    if (!index) {
      renderMessage("Tag suggestions unavailable", "Type a tag and press Enter.", false);
      return;
    }

    const caret = inputCaret(input);
    result = buildSuggestions(
      index,
      input.value,
      caret,
      deps.getUsage(),
      LIMIT,
      deps.getCompletions(),
    );
    const sign = effectiveSign(result.term, excludeActive());

    optionEls = [];
    const fragment = document.createDocumentFragment();
    for (const [slot, suggestion] of result.items.entries()) {
      const node = row(suggestion, slot, sign);
      optionEls.push(node);
      fragment.append(node);
    }

    list.replaceChildren();
    if (optionEls.length === 0) {
      const query = result.term.value.trim();
      renderMessage(
        "No matching tags",
        query === ""
          ? "Pick a namespace or type a tag name."
          : `Press Enter to search for “${query}” instead.`,
        false,
      );
    } else {
      list.append(fragment);
      if (retryButton) {
        retryButton.hidden = true;
      }
    }

    setActive(-1);
    if (countLabel) {
      if (result.empty) {
        const recent = result.items.filter((item) => item.kind === "tag" && item.recent).length;
        const namespaces = result.items.filter((item) => item.kind === "namespace").length;
        const parts: string[] = [];
        if (recent > 0) {
          parts.push(`${recent} recent`);
        }
        if (namespaces > 0) {
          parts.push(countText(namespaces, "namespace"));
        }
        countLabel.textContent = parts.join(" · ");
      } else {
        countLabel.textContent = countText(result.total, "match", "matches");
      }
    }

    if (excludeButton) {
      excludeButton.setAttribute("aria-pressed", excludeActive() ? "true" : "false");
    }
    popover.reposition();
  }

  function setInputValue(term: SearchTerm, replacement: string, keepOpen: boolean): void {
    const edit = replaceTerm(input.value, term, replacement, keepOpen);
    if (typeof input.setRangeText === "function") {
      input.setRangeText(edit.insert, edit.from, edit.to, "end");
    } else {
      input.value = edit.text;
    }
    setSelection(input, edit.caret);
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyAt(slot: number): void {
    const suggestion = result?.items[slot];
    const term = result?.term;
    if (!suggestion || !term) {
      return;
    }

    if (suggestion.kind === "tag" && suggestion.applied) {
      input.value = removeTerm(input.value, suggestion.applied);
      setSelection(input, input.value.length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      close();
      options.onCommit?.();
      return;
    }

    const sign = effectiveSign(term, excludeActive());
    if (suggestion.kind === "namespace") {
      // Clear the exclusion before the input event re-renders, so the open panel previews the
      // namespace with the sign the next term will actually use.
      excludeNext = false;
      setInputValue(term, suggestionInsertion(suggestion, sign), true);
      return;
    }

    excludeNext = false;
    setInputValue(term, suggestionInsertion(suggestion, sign), false);
    deps.recordUse(suggestion.entry.ns.id, suggestion.entry.key);
    deps.recordCompletion({
      prefixNs: term.ns?.id ?? "",
      prefix: term.value,
      ns: suggestion.entry.ns.id,
      key: suggestion.entry.key,
    });
    close();
    options.onCommit?.();
  }

  // ---------------------------------------------------------------- loading

  function startLoad(): void {
    if (loading || destroyed) {
      return;
    }
    const cached = deps.getIndex();
    if (cached) {
      index = cached;
      state = "ready";
      // Resolves immediately with the cached vocabulary, then refreshes the vocabulary in the
      // background. A rejection leaves the cached index usable.
      void deps.loadIndex().catch(() => {
        // Keep the cached vocabulary; the next focus retries.
      });
      if (isOpen()) {
        render();
      }
      return;
    }

    state = "loading";
    if (isOpen()) {
      render();
    }
    loading = deps
      .loadIndex()
      .then((built) => {
        index = built;
        state = "ready";
      })
      .catch(() => {
        state = "error";
      })
      .finally(() => {
        loading = null;
        if (isOpen()) {
          render();
        }
      });
  }

  // ---------------------------------------------------------------- panel

  function buildPanel(): void {
    if (popover) {
      return;
    }

    list = el("div", {
      class: "tag-combobox-list",
      id: listId,
      role: "listbox",
      "aria-label": "Tag suggestions",
    });

    countLabel = el("span", { class: "tag-combobox-count" });
    const hints = el("span", {
      class: "tag-combobox-hints",
      "aria-hidden": "true",
      text: "↑↓ move · Enter apply · Ctrl/Cmd exclude",
    });

    excludeButton = buttonEl({
      class: "tag-combobox-exclude tag-combobox-exclude-toggle",
      tabindex: "-1",
      "aria-pressed": "false",
      title: "Apply the next tag as an exclusion (hold Ctrl/Cmd)",
      text: "Exclude",
    });
    excludeButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    excludeButton.addEventListener("click", () => {
      excludeNext = !excludeNext;
      render();
    });

    retryButton = buttonEl({
      class: "tag-combobox-exclude is-retry",
      tabindex: "-1",
      text: "Retry",
      hidden: "hidden",
    });
    retryButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    retryButton.addEventListener("click", () => {
      state = "idle";
      startLoad();
    });

    const footer = el(
      "div",
      { class: "tag-combobox-foot" },
      countLabel,
      el("span", { class: "tag-combobox-actions" }, hints, retryButton, excludeButton),
    );

    const handle = openPopover({
      content: list,
      anchor: input,
      label: "Tag suggestions",
      className: "tag-combobox",
      // The panel's old minimum; placement widens it to the input when the field is wider.
      minWidth: 360,
      autoFocus: false,
      signal,
      onClose: () => {
        if (handle !== popover) {
          return;
        }
        popover = null;
        clearPanel();
      },
    });
    popover = handle;
    handle.element.id = panelId;
    handle.element.append(footer);
    // Keep presses inside the panel away from page-level handlers, as the manual panel did.
    handle.element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    setInputAttributes(true);
    startLoad();
    render();
  }

  function open(): void {
    if (destroyed || !enabled()) {
      return;
    }
    buildPanel();
    render();
  }

  /**
   * Drop every reference to the panel contents and reset the input's combobox attributes. Called
   * both by `close()` and by the popover's own dismissal, so it never touches the handle.
   */
  function clearPanel(): void {
    list = null;
    countLabel = null;
    excludeButton = null;
    retryButton = null;
    optionEls = [];
    result = null;
    active = -1;
    excludeNext = false;
    modifierExclude = false;
    setInputAttributes(false);
  }

  function close(): void {
    const handle = popover;
    if (!handle) {
      return;
    }
    // Close through the handle while `popover` still names it: restoring focus to the input fires
    // `focus`, and the open path must see a panel still present instead of rebuilding one.
    // `onClose` clears the state at the end of the handle's close, after focus restoration.
    handle.close();
    if (popover === handle) {
      popover = null;
      clearPanel();
    }
  }

  function destroy(): void {
    destroyed = true;
    stopIndexWatch?.();
    stopIndexWatch = null;
    close();
  }

  // --------------------------------------------------------------- events

  function onInput(): void {
    if (composing) {
      return;
    }
    if (!enabled()) {
      close();
      return;
    }
    if (isOpen()) {
      render();
    } else {
      open();
    }
  }

  function onFocus(): void {
    open();
  }

  function onBlur(): void {
    setTimeout(() => {
      if (destroyed) {
        return;
      }
      const focused = document.activeElement;
      if (focused !== input && popover?.element.contains(focused) !== true) {
        close();
      }
    }, 0);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled() || event.isComposing || composing) {
      return;
    }

    if (event.key === "Control" || event.key === "Meta") {
      if (!modifierExclude) {
        modifierExclude = true;
        render();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.altKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      if (!isOpen()) {
        open();
      }
      if (optionEls.length === 0) {
        return;
      }
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (!isOpen()) {
      return;
    }

    if (
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageDown" ||
      event.key === "PageUp"
    ) {
      // A modified Home/End belongs to the text field's selection, not the list.
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      if (optionEls.length === 0) {
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(optionEls.length - 1);
      } else {
        event.preventDefault();
        move(event.key === "PageDown" ? 8 : -8);
      }
      return;
    }

    if (event.key === "Enter") {
      if (active >= 0) {
        event.preventDefault();
        event.stopPropagation();
        applyAt(active);
        return;
      }
      close();
      return;
    }

    if (event.key === "Tab") {
      // Tab belongs to the browser: close without swallowing the key so focus keeps moving through
      // the page instead of being parked in the portal.
      close();
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Control" || event.key === "Meta") {
      if (modifierExclude) {
        modifierExclude = false;
        render();
      }
      return;
    }
    if (isOpen() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      render();
    }
  }

  function onCompositionStart(): void {
    composing = true;
  }

  function onCompositionEnd(): void {
    composing = false;
    if (enabled()) {
      open();
      render();
    }
  }

  function onClick(): void {
    if (!enabled() || composing) {
      return;
    }
    open();
    render();
  }

  input.addEventListener("input", onInput, { signal });
  input.addEventListener("focus", onFocus, { signal });
  input.addEventListener("blur", onBlur, { signal });
  input.addEventListener("keydown", onKeyDown, { signal });
  input.addEventListener("keyup", onKeyUp, { signal });
  input.addEventListener("click", onClick, { signal });
  input.addEventListener("compositionstart", onCompositionStart, { signal });
  input.addEventListener("compositionend", onCompositionEnd, { signal });
  window.addEventListener(
    "blur",
    () => {
      if (modifierExclude) {
        modifierExclude = false;
        if (isOpen()) {
          render();
        }
      }
    },
    { signal },
  );
  signal?.addEventListener("abort", destroy, { once: true });

  setInputAttributes(false);

  return {
    open,
    refresh: () => {
      if (isOpen()) {
        render();
      }
    },
  };
}
