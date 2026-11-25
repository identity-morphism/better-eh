import {
  copyKeymap,
  DEFAULT_KEYMAP,
  KEY_ACTIONS,
  MAX_KEY_LENGTH,
  MAX_KEYS_PER_ACTION,
  MODIFIER_KEYS,
} from "../keymap-schema";
import type { KeyAction, KeyMap } from "../keymap-schema";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "../settings";
import {
  applyScalar,
  BOOLEAN_FIELDS,
  clampNumber,
  NUMBER_FIELDS,
  SCALAR_KEYS,
  SELECT_FIELDS,
  validateScalar,
} from "../settings-schema";
import type { BooleanKey, NumberField, ScalarKey, SelectKey } from "../settings-schema";
import type { UserSettings } from "../types";
import { buttonEl, el } from "./dom";
import { createCheckbox, createSelect } from "./form-controls";
import type { CheckboxControl, SelectControl } from "./form-controls";
import { createSettingsDraft } from "./settings-draft";
import type { DraftBinding } from "./settings-draft";

const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  PAGEUP: "Page Up",
  PAGEDOWN: "Page Down",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
  ESCAPE: "Esc",
  ENTER: "Enter",
  TAB: "Tab",
};

const VISUALLY_HIDDEN = "settings-file-input";

export const USERSCRIPT_SETTINGS_SECTION_ID = "settings-userscript";

interface SettingsPanelDeps {
  /** Called after a control change or a draft reset/rebase, so the view can refresh its state. */
  onChange?: () => void;
  /** Replace file writing in tests. */
  exportFile?: (filename: string, contents: string) => void;
}

interface UserscriptSettingsPanel {
  element: HTMLElement;
  /** The panel's controls, composed by the view into the one shared settings draft. */
  bindings: readonly DraftBinding[];
  /** True when any control differs from the panel's own baseline. */
  isDirty(): boolean;
  /** Write the controls' values to the settings store. */
  apply(): void;
  /** Restore the values captured when the panel was rendered. */
  reset(): void;
}

type SettingsImportResult = { ok: true; settings: UserSettings } | { ok: false; error: string };

function cloneSettings(settings: Readonly<UserSettings>): UserSettings {
  return { ...settings, keymap: copyKeymap(settings.keymap) };
}

function assign<K extends keyof UserSettings>(
  target: UserSettings,
  key: K,
  value: UserSettings[K],
): void {
  target[key] = value;
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key;
}

function normalizeKey(value: string): string {
  if (value === " ") {
    return value;
  }
  return value.trim().toUpperCase();
}

function setStatus(node: HTMLElement, message: string, error = false): void {
  node.textContent = message;
  node.classList.remove("is-error");
  if (error) {
    node.classList.add("is-error");
  }
}

function downloadFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = el("a", { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Serialize values in the shape {@link parseSettingsJson} accepts. */
export function serializeSettings(settings: Readonly<UserSettings>): string {
  return JSON.stringify({ app: "better-eh", version: 1, values: settings }, null, 2);
}

type KeymapAssignment =
  | { ok: true; keymap: KeyMap; movedFrom: KeyAction | null; duplicate: boolean }
  | { ok: false; reason: "limit" | "conflict"; other: KeyAction | null };

/**
 * Bind one key under the policy the capture and import paths share: a key belongs to at most one
 * action, and an action holds at most {@link MAX_KEYS_PER_ACTION} keys.
 *
 * Capture uses `"move"`, so a key bound elsewhere moves to the action being edited. Import uses
 * `"reject"`, so a conflicting file is reported instead of silently reshaping the keymap.
 */
function assignKey(
  keymap: KeyMap,
  action: KeyAction,
  key: string,
  mode: "move" | "reject",
): KeymapAssignment {
  if (keymap[action].includes(key)) {
    return { ok: true, keymap, movedFrom: null, duplicate: true };
  }
  const other = KEY_ACTIONS.find(
    (candidate) => candidate.action !== action && keymap[candidate.action].includes(key),
  )?.action;
  if (mode === "reject" && other !== undefined) {
    return { ok: false, reason: "conflict", other };
  }
  if (keymap[action].length >= MAX_KEYS_PER_ACTION) {
    return { ok: false, reason: "limit", other: other ?? null };
  }
  const next = copyKeymap(keymap);
  if (other !== undefined) {
    next[other] = next[other].filter((value) => value !== key);
  }
  next[action] = [...next[action], key];
  return { ok: true, keymap: next, movedFrom: other ?? null, duplicate: false };
}

function parseKeymap(value: Record<string, unknown>): KeyMap | string {
  const modifierNames = new Set([...MODIFIER_KEYS].map((name) => name.toUpperCase()));
  const seen = new Set<KeyAction>();
  let imported = copyKeymap(DEFAULT_KEYMAP);
  for (const { action } of KEY_ACTIONS) {
    imported[action] = [];
  }

  for (const { action } of KEY_ACTIONS) {
    const raw = value[action];
    if (raw === undefined) {
      continue;
    }
    if (!Array.isArray(raw)) {
      return `The "${action}" bindings must be a list of keys.`;
    }
    seen.add(action);
    for (const entry of raw as unknown[]) {
      if (typeof entry !== "string") {
        return `The "${action}" bindings must be a list of keys.`;
      }
      const key = normalizeKey(entry);
      if (key === "" || key.length > MAX_KEY_LENGTH) {
        return `The "${action}" bindings contain an invalid key.`;
      }
      // The runtime compares `KeyboardEvent.key` and rejects every modified event, so a
      // combination can never match and is reported rather than stored as dead weight.
      if (key.includes("+") || modifierNames.has(key)) {
        return `The "${action}" bindings contain a modified key; only unmodified keys are supported.`;
      }
      const result = assignKey(imported, action, key, "reject");
      if (!result.ok) {
        return result.reason === "limit"
          ? `The "${action}" bindings allow at most ${MAX_KEYS_PER_ACTION} keys.`
          : `The key "${key}" is bound to more than one action.`;
      }
      imported = result.keymap;
    }
  }

  // An explicit assignment wins over the defaults (and cannot duplicate another explicit one).
  const keymap = copyKeymap(DEFAULT_KEYMAP);
  const explicitKeys = new Set<string>();
  for (const action of seen) {
    for (const key of imported[action]) {
      explicitKeys.add(key);
    }
  }
  for (const { action } of KEY_ACTIONS) {
    keymap[action] = seen.has(action)
      ? imported[action]
      : keymap[action].filter((key) => !explicitKeys.has(key));
  }
  return keymap;
}

/**
 * Parse an exported settings file.
 *
 * Missing values fall back to the built-in defaults, so a file written by an older version still
 * imports. Invalid types are reported instead of being silently dropped.
 */
export function parseSettingsJson(text: string): SettingsImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "That file does not contain a settings object." };
  }
  const record = raw as Record<string, unknown>;
  let values = record;
  if ("values" in record) {
    const nested = record.values;
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
      return { ok: false, error: `"values" must be a settings object.` };
    }
    values = nested as Record<string, unknown>;
  }
  const settings = cloneSettings(DEFAULT_SETTINGS);

  for (const key of SCALAR_KEYS) {
    const value = values[key];
    if (value === undefined) {
      continue;
    }
    const result = validateScalar(key, value);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    assign(settings, key, result.value);
  }

  const keymapValue = values.keymap;
  if (keymapValue !== undefined) {
    if (typeof keymapValue !== "object" || keymapValue === null || Array.isArray(keymapValue)) {
      return { ok: false, error: `"keymap" must be an object.` };
    }
    const keymap = parseKeymap(keymapValue as Record<string, unknown>);
    if (typeof keymap === "string") {
      return { ok: false, error: keymap };
    }
    settings.keymap = keymap;
  }

  return { ok: true, settings };
}

/**
 * Render the userscript's own settings.
 *
 * The panel returns its controls as draft bindings. The settings view composes them with the site
 * form's bindings into one draft, so Apply and Reset see both halves; the panel also keeps a draft
 * of its own so it can be used and tested in isolation. Controls only become persisted settings
 * when `apply` runs.
 */
export function renderUserscriptSettings(deps: SettingsPanelDeps = {}): UserscriptSettingsPanel {
  const bindings: DraftBinding[] = [];
  const toggles = new Map<BooleanKey, CheckboxControl>();
  const numbers = new Map<NumberField, HTMLInputElement>();
  const selects = new Map<SelectKey, SelectControl>();
  let synced = cloneSettings(getSettings());
  let keymapDraft = copyKeymap(synced.keymap);
  let capturing: KeyAction | null = null;
  let keymapHost: HTMLElement = el("div");

  const statusNode = el("p", {
    class: "status-line settings-backup-status",
    role: "status",
    "aria-live": "polite",
  });

  // Keymap notices live above the rows, so a rebuild does not discard the message.
  const keymapStatusNode = el("p", {
    class: "status-line settings-keymap-status",
    role: "status",
    "aria-live": "polite",
  });

  const keymapBinding: DraftBinding<KeyMap> = {
    key: "keymap",
    read: () => copyKeymap(keymapDraft),
    write: (value) => {
      keymapDraft = copyKeymap(value);
      capturing = null;
      renderKeymap();
    },
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  };
  bindings.push(keymapBinding);

  const change = (): void => {
    deps.onChange?.();
  };

  function readDraft(): UserSettings {
    const draft = cloneSettings(getSettings());
    for (const binding of bindings) {
      const value = binding.read();
      if (binding.key === "keymap") {
        draft.keymap = copyKeymap(value as KeyMap);
      } else {
        applyScalar(draft, binding.key as ScalarKey, value);
      }
    }
    return draft;
  }

  function stopCapture(): void {
    capturing = null;
    renderKeymap();
  }

  function addKey(action: KeyAction, key: string): void {
    const result = assignKey(keymapDraft, action, key, "move");
    if (!result.ok) {
      const other = result.other === null ? "another action" : actionLabel(result.other);
      setStatus(
        keymapStatusNode,
        result.reason === "limit"
          ? `Up to ${MAX_KEYS_PER_ACTION} keys per action; remove one first.`
          : `The key ${keyLabel(key)} is bound to ${other}.`,
        true,
      );
      return;
    }
    if (result.duplicate) {
      setStatus(keymapStatusNode, `${keyLabel(key)} is already bound to ${actionLabel(action)}.`);
      return;
    }
    keymapDraft = result.keymap;
    setStatus(
      keymapStatusNode,
      result.movedFrom === null
        ? `Bound ${keyLabel(key)} to ${actionLabel(action)}.`
        : `Moved ${keyLabel(key)} from ${actionLabel(result.movedFrom)} to ${actionLabel(action)}.`,
    );
    renderKeymap();
    change();
  }

  function removeKey(action: KeyAction, key: string): void {
    keymapDraft[action] = keymapDraft[action].filter((value) => value !== key);
    setStatus(keymapStatusNode, `Removed ${keyLabel(key)} from ${actionLabel(action)}.`);
    renderKeymap();
    change();
  }

  function actionLabel(action: KeyAction): string {
    return KEY_ACTIONS.find((field) => field.action === action)?.label ?? action;
  }

  function captureButton(action: KeyAction, label: string): HTMLButtonElement {
    const button = buttonEl({
      class: "settings-key-capture",
      text: "Add key",
      "aria-label": `Add a key for ${label}`,
    });
    button.addEventListener("click", () => {
      if (capturing === action) {
        stopCapture();
        return;
      }
      capturing = action;
      renderKeymap();
      const current = keymapHost.querySelector<HTMLButtonElement>(`[data-capture="${action}"]`);
      current?.focus();
    });
    button.addEventListener("keydown", (event) => {
      if (capturing !== action) {
        return;
      }
      const key = event.key;
      if (typeof key !== "string" || key === "") {
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        stopCapture();
        return;
      }
      // Tab and the modifiers belong to the browser, not to navigation.
      if (key === "Tab" || MODIFIER_KEYS.has(key)) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        event.preventDefault();
        setStatus(
          keymapStatusNode,
          "Only unmodified keys can be bound; modifiers belong to the browser.",
          true,
        );
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      addKey(action, normalizeKey(key));
      stopCapture();
    });
    button.dataset.capture = action;
    return button;
  }

  function renderKeymap(): void {
    const rows = KEY_ACTIONS.map(({ action, label }) => {
      const keys = keymapDraft[action].map((key) =>
        el(
          "span",
          { class: "settings-key" },
          el("span", { class: "settings-key-name", text: keyLabel(key) }),
          buttonEl({
            class: "settings-key-remove",
            text: "×",
            "aria-label": `Remove ${keyLabel(key)} from ${label}`,
            onclick: () => removeKey(action, key),
          }),
        ),
      );
      const button = captureButton(action, label);
      if (capturing === action) {
        button.textContent = "Press a key…";
        button.classList.add("capturing");
      }
      return el(
        "div",
        { class: "settings-key-row" },
        el("span", { class: "settings-key-label", text: label }),
        el("span", { class: "settings-keys", "aria-label": `${label} keys` }, ...keys),
        button,
      );
    });
    keymapHost.replaceChildren(...rows);
  }

  function renderBooleanFields(): HTMLElement {
    const items = BOOLEAN_FIELDS.map(({ key, label, hint }) => {
      const control = createCheckbox({
        id: `settings-userscript-${key}`,
        checked: synced[key],
      });
      toggles.set(key, control);
      bindings.push({
        key,
        read: control.readChecked,
        write: control.writeChecked,
      });
      return el(
        "div",
        { class: "settings-row" },
        control.element,
        el(
          "div",
          { class: "settings-row-text" },
          el("label", { for: `settings-userscript-${key}`, text: label }),
          el("span", { class: "settings-hint", text: hint }),
        ),
      );
    });
    return el("div", { class: "settings-rows settings-rows-roomy" }, ...items);
  }

  function renderSelectFields(): HTMLElement {
    const items = SELECT_FIELDS.map((field) => {
      const control = createSelect({
        class: "field-select settings-select",
        id: `settings-userscript-${field.key}`,
        value: synced[field.key],
        options: field.options,
      });
      selects.set(field.key, control);
      bindings.push({
        key: field.key,
        read: control.read,
        write: control.write,
      });
      return el(
        "div",
        { class: "settings-field" },
        el("label", {
          class: "eyebrow",
          for: `settings-userscript-${field.key}`,
          text: field.label,
        }),
        control.element,
        el("span", { class: "settings-hint", text: field.hint }),
      );
    });
    return el("div", { class: "settings-number-grid" }, ...items);
  }

  function renderNumberFields(): HTMLElement {
    const items = NUMBER_FIELDS.map((field) => {
      const input = el("input", {
        class: "field-input settings-number-input",
        type: "number",
        id: `settings-userscript-${field.key}`,
        min: field.min,
        max: field.max,
        step: 1,
        inputmode: "numeric",
      });
      numbers.set(field, input);
      bindings.push({
        key: field.key,
        read: () => {
          // An emptied field keeps the value it had when the form was last in sync, so the dirty
          // marker does not flicker while the user replaces the number. `Number("")` is 0, so this
          // has to test the text first or a cleared field would clamp to the minimum.
          const raw = input.value.trim();
          if (raw === "") {
            return synced[field.key];
          }
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? clampNumber(field.key, parsed) : synced[field.key];
        },
        write: (value) => {
          input.value = String(value);
        },
      });
      return el(
        "div",
        { class: "settings-field" },
        el("label", {
          class: "eyebrow",
          for: `settings-userscript-${field.key}`,
          text: field.label,
        }),
        input,
        el("span", { class: "settings-hint", text: field.hint }),
      );
    });
    return el("div", { class: "settings-number-grid" }, ...items);
  }

  function loadDraft(settings: UserSettings): void {
    for (const [key, control] of toggles) {
      control.writeChecked(settings[key]);
    }
    for (const [field, input] of numbers) {
      input.value = String(settings[field.key]);
    }
    for (const [key, control] of selects) {
      control.write(settings[key]);
    }
    keymapBinding.write(settings.keymap);
  }

  function exportSettings(): void {
    const contents = serializeSettings(readDraft());
    const write = deps.exportFile ?? downloadFile;
    write("better-eh-settings.json", contents);
    setStatus(statusNode, "Exported better-eh-settings.json.");
  }

  function importSettings(text: string): void {
    const result = parseSettingsJson(text);
    if (!result.ok) {
      setStatus(statusNode, result.error, true);
      return;
    }
    loadDraft(result.settings);
    setStatus(statusNode, "Imported settings; review the values and press Apply.");
    change();
  }

  const exportButton = buttonEl({ class: "btn btn-ghost settings-export", text: "Export JSON" });
  exportButton.addEventListener("click", exportSettings);

  const importButton = buttonEl({ class: "btn btn-ghost settings-import", text: "Import JSON" });
  const fileInput = el("input", {
    class: VISUALLY_HIDDEN,
    type: "file",
    accept: "application/json,.json",
    tabindex: -1,
    "aria-hidden": "true",
  });
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then(
      (text) => {
        importSettings(text);
        fileInput.value = "";
      },
      () => setStatus(statusNode, "Could not read that file.", true),
    );
  });

  const keymapReset = buttonEl({
    class: "btn btn-ghost settings-keymap-reset",
    text: "Reset keys",
  });
  keymapReset.addEventListener("click", () => {
    keymapDraft = copyKeymap(DEFAULT_KEYMAP);
    setStatus(keymapStatusNode, "Keys reset to defaults; press Apply to save.");
    renderKeymap();
    change();
  });

  keymapHost = el("div", { class: "settings-keymap" });
  renderKeymap();

  const keymapSection = el(
    "div",
    { class: "settings-panel-group" },
    el("h3", { class: "settings-subhead", text: "Keyboard shortcuts" }),
    keymapStatusNode,
    keymapHost,
    keymapReset,
  );

  const section = el(
    "section",
    {
      class: "settings-section settings-panel",
      id: USERSCRIPT_SETTINGS_SECTION_ID,
      "aria-labelledby": `${USERSCRIPT_SETTINGS_SECTION_ID}-title`,
    },
    el("h2", {
      class: "settings-title",
      id: `${USERSCRIPT_SETTINGS_SECTION_ID}-title`,
      text: "Better EH",
    }),
    el("p", {
      class: "settings-hint",
      text: "Userscript preferences stored in this browser. Changes apply after you press Apply.",
    }),
    el(
      "div",
      { class: "settings-panel-group" },
      el("h3", { class: "settings-subhead", text: "Reading and interface" }),
      renderBooleanFields(),
    ),
    el(
      "div",
      { class: "settings-panel-group" },
      el("h3", { class: "settings-subhead", text: "Reader layout" }),
      renderSelectFields(),
    ),
    el(
      "div",
      { class: "settings-panel-group" },
      el("h3", { class: "settings-subhead", text: "Sizing and network" }),
      renderNumberFields(),
    ),
    keymapSection,
    el(
      "div",
      { class: "settings-panel-group" },
      el("h3", { class: "settings-subhead", text: "Backup" }),
      el("div", { class: "settings-panel-actions" }, exportButton, importButton, fileInput),
      statusNode,
    ),
  );

  // Every edit marks the surrounding view dirty, whatever kind of control changed.
  for (const type of ["input", "change"] as const) {
    section.addEventListener(type, change);
  }

  loadDraft(synced);
  const engine = createSettingsDraft({ bindings, onChange: deps.onChange });

  return {
    element: section,
    bindings,
    isDirty: () => engine.isDirty(),
    apply: () => {
      const draft = readDraft();
      updateSettings(draft);
      loadDraft(draft);
      synced = cloneSettings(draft);
      engine.rebase();
    },
    reset: () => {
      engine.reset();
    },
  };
}
