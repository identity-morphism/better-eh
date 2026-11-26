import { isRecord } from "./guards";

/**
 * Every bindable action, its label, and its factory defaults. `KeyAction` and `KeyMap` derive from
 * this table, so an action missing from a keymap is a compile error.
 */
export const KEY_ACTIONS = [
  { action: "next", label: "Next page", defaults: ["D", "ARROWRIGHT"] },
  { action: "prev", label: "Previous page", defaults: ["A", "ARROWLEFT"] },
  { action: "fit", label: "Toggle fit / natural width", defaults: ["F"] },
  { action: "gallery", label: "Back to gallery", defaults: ["Q", "ESCAPE"] },
  { action: "up", label: "Scroll up", defaults: ["W", "ARROWUP"] },
  { action: "down", label: "Scroll down", defaults: ["S", "ARROWDOWN"] },
  { action: "reload", label: "Reload image", defaults: ["R"] },
  { action: "help", label: "Toggle shortcuts", defaults: ["?"] },
  { action: "first", label: "First page", defaults: ["HOME"] },
  { action: "last", label: "Last page", defaults: ["END"] },
] as const satisfies readonly {
  action: string;
  label: string;
  defaults: readonly string[];
}[];

/** Every action the reader can bind. */
export type KeyAction = (typeof KEY_ACTIONS)[number]["action"];

/** One key list per action. */
export type KeyMap = Record<KeyAction, string[]>;

/**
 * One policy for captured and imported bindings: single keys of at most `MAX_KEY_LENGTH`
 * characters, and at most `MAX_KEYS_PER_ACTION` per action. Ctrl, Meta and Alt are reserved for the
 * browser and app shortcuts; Shift is part of the effective `KeyboardEvent.key` (`?`, `D`), so a
 * binding stores that key, never a modifier combination.
 */
export const MAX_KEYS_PER_ACTION = 6;
export const MAX_KEY_LENGTH = 20;

/** `KeyboardEvent.key` values that modify another key; capture ignores them. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "OS",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock",
]);

/** Whether present actions map to key-name lists; missing actions merge from defaults. */
export function isKeyMapPatch(value: unknown): value is Partial<KeyMap> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([action, keys]) =>
      KEY_ACTIONS.some((field) => field.action === action) &&
      Array.isArray(keys) &&
      keys.every((entry) => typeof entry === "string"),
  );
}

/** A mutable copy, so neither the caller nor the previous snapshot shares an array. */
export function copyKeymap(keymap: KeyMap): KeyMap {
  const copy = {} as KeyMap;
  for (const { action } of KEY_ACTIONS) {
    copy[action] = [...keymap[action]];
  }
  return copy;
}

/** Freeze every binding array and the map itself. */
export function freezeKeymap(keymap: KeyMap): KeyMap {
  for (const keys of Object.values(keymap)) {
    Object.freeze(keys);
  }
  return Object.freeze(keymap);
}

/** Build a fresh, frozen keymap from {@link KEY_ACTIONS}. */
export function defaultKeymap(): KeyMap {
  const keymap = {} as KeyMap;
  for (const { action, defaults } of KEY_ACTIONS) {
    keymap[action] = [...defaults];
  }
  return freezeKeymap(keymap);
}

/** The factory's frozen instance, used by the reset-to-defaults menu command. */
export const DEFAULT_KEYMAP: KeyMap = defaultKeymap();
