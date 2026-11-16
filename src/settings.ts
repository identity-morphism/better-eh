import { isRecord } from "./guards";
import { copyKeymap, defaultKeymap, freezeKeymap, isKeyMapPatch } from "./keymap-schema";
import { applyScalar, defaultScalars, SCALAR_KEYS } from "./settings-schema";
import { createStore, gmStorage } from "./store";
import type { StoreOptions } from "./store";
import type { UserSettings } from "./types";

const STORAGE_KEY = "eh:settings:v2";
const VERSION = 2;

type Listener = (settings: Readonly<UserSettings>) => void;
type SettingsReader = (key: string) => unknown;

const listeners = new Set<Listener>();

export const DEFAULT_SETTINGS: UserSettings = Object.freeze({
  ...defaultScalars(),
  keymap: defaultKeymap(),
});

const gm = gmStorage();

function readStoredSetting(key: string): unknown {
  return gm.read(key);
}

function isStoredValues(value: unknown): value is Partial<UserSettings> {
  return isRecord(value);
}

/** Values from the pre-v2 keys, used when no v2 record exists. */
function legacyValues(read: SettingsReader): Partial<UserSettings> {
  const legacyFit = read("defaultFitHeight");
  const legacyDebug = read("debug");
  const legacyKeymap = read("keymap");
  return {
    fitHeight: typeof legacyFit === "boolean" ? legacyFit : DEFAULT_SETTINGS.fitHeight,
    debug: typeof legacyDebug === "boolean" ? legacyDebug : DEFAULT_SETTINGS.debug,
    keymap: isKeyMapPatch(legacyKeymap)
      ? { ...DEFAULT_SETTINGS.keymap, ...legacyKeymap }
      : DEFAULT_SETTINGS.keymap,
  };
}

/**
 * Store options for one reader: a missing or outdated record falls back to the pre-v2 keys, which
 * the first write then migrates into the shared envelope.
 */
function settingsOptions(read: SettingsReader): StoreOptions<Partial<UserSettings>> {
  return {
    key: STORAGE_KEY,
    version: VERSION,
    empty: () => legacyValues(read),
    guard: isStoredValues,
  };
}

function applyStoredScalars(target: UserSettings, values: Partial<UserSettings>): void {
  for (const key of SCALAR_KEYS) {
    applyScalar(target, key, values[key]);
  }
}

export function loadSettings(read: SettingsReader = readStoredSetting): Readonly<UserSettings> {
  // A read-only view of the caller's reader: nothing here writes.
  const values = createStore(settingsOptions(read), {
    read,
    write: () => undefined,
    remove: () => undefined,
  }).read();

  const merged: UserSettings = { ...DEFAULT_SETTINGS };
  applyStoredScalars(merged, values);
  const storedKeymap = isKeyMapPatch(values.keymap) ? values.keymap : DEFAULT_SETTINGS.keymap;
  return Object.freeze({
    ...merged,
    keymap: freezeKeymap({ ...DEFAULT_SETTINGS.keymap, ...storedKeymap }),
  });
}

const store = createStore(settingsOptions(readStoredSetting), gm);

let current: Readonly<UserSettings> = loadSettings();

export function getSettings(): Readonly<UserSettings> {
  return current;
}

/**
 * Apply several settings at once; listeners fire once for the merged snapshot.
 *
 * The keymap is copied first, so neither the caller's arrays nor the previous snapshot can be
 * mutated through the new one.
 */
export function updateSettings(patch: Partial<UserSettings>): void {
  const next: UserSettings = { ...current };
  for (const key of SCALAR_KEYS) {
    applyScalar(next, key, patch[key]);
  }
  if (patch.keymap !== undefined) {
    next.keymap = freezeKeymap(copyKeymap(patch.keymap));
  }
  current = Object.freeze(next);
  store.write(current);
  for (const listener of listeners) {
    listener(current);
  }
}

export function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
  updateSettings({ [key]: value });
}

export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
