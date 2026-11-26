import { describe, expect, test } from "bun:test";

import { isKey } from "../src/keymap";
import { DEFAULT_KEYMAP } from "../src/keymap-schema";
import type { KeyMap } from "../src/keymap-schema";
import {
  DEFAULT_SETTINGS,
  getSettings,
  loadSettings,
  onSettingsChange,
  updateSetting,
  updateSettings,
} from "../src/settings";
import { NUMBER_FIELDS, SELECT_FIELDS } from "../src/settings-schema";
import type { ReaderMode, ReadingDirection, UserSettings } from "../src/types";
import { storedValue } from "./setup";

const STORAGE_KEY = "eh:settings:v2";

function readFrom(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key] ?? null;
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return { key, ...init } as KeyboardEvent;
}

describe("loadSettings", () => {
  test("falls back to defaults on empty storage", () => {
    const loaded = loadSettings(readFrom({}));

    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(loaded.keymap).toEqual(DEFAULT_KEYMAP);
  });

  test("merges stored v2 values over defaults", () => {
    const loaded = loadSettings(
      readFrom({
        [STORAGE_KEY]: { version: 2, values: { scrollStep: 400, debug: true } },
      }),
    );

    expect(loaded.scrollStep).toBe(400);
    expect(loaded.debug).toBe(true);
    expect(loaded.gap).toBe(DEFAULT_SETTINGS.gap);
    expect(loaded.keymap).toEqual(DEFAULT_KEYMAP);
  });

  test("merges a stored keymap over DEFAULT_KEYMAP and ignores a malformed one", () => {
    const merged = loadSettings(
      readFrom({
        [STORAGE_KEY]: {
          version: 2,
          values: { keymap: { next: ["N"], fit: [] } },
        },
      }),
    );

    expect(merged.keymap.next).toEqual(["N"]);
    expect(merged.keymap.fit).toEqual([]);
    expect(merged.keymap.prev).toEqual(DEFAULT_KEYMAP.prev);
    expect(merged.keymap.down).toEqual(DEFAULT_KEYMAP.down);

    const malformed = loadSettings(
      readFrom({
        [STORAGE_KEY]: { version: 2, values: { keymap: { next: 5 } } },
      }),
    );

    expect(malformed.keymap).toEqual(DEFAULT_KEYMAP);
  });

  test("normalizes stored v2 values through the schema", () => {
    const loaded = loadSettings(
      readFrom({
        [STORAGE_KEY]: {
          version: 2,
          values: { netConcurrency: 999, readerMode: "strip" },
        },
      }),
    );

    expect(loaded.netConcurrency).toBe(8);
    expect(loaded.readerMode).toBe(DEFAULT_SETTINGS.readerMode);
  });
});

describe("the settings schema", () => {
  test("keeps every default inside its declared bounds or options", () => {
    for (const field of NUMBER_FIELDS) {
      expect(field.default).toBeGreaterThanOrEqual(field.min);
      expect(field.default).toBeLessThanOrEqual(field.max);
    }
    for (const field of SELECT_FIELDS) {
      expect(field.options.some((option) => option.value === field.default)).toBe(true);
    }
  });
});

describe("the settings store", () => {
  test("clamps numbers to their schema bounds", () => {
    updateSetting("netConcurrency", 999);
    expect(getSettings().netConcurrency).toBe(8);

    updateSetting("gap", -5);
    expect(getSettings().gap).toBe(0);

    updateSetting("scrollStep", 12.4);
    expect(getSettings().scrollStep).toBe(20);
  });

  test("keeps the current value when a select gets an unknown option", () => {
    updateSetting("readerMode", "spread");
    updateSetting("readerMode", "strip" as unknown as ReaderMode);
    expect(getSettings().readerMode).toBe("spread");

    updateSetting("readingDirection", "rtl");
    updateSettings({ readingDirection: "up" as unknown as ReadingDirection });
    expect(getSettings().readingDirection).toBe("rtl");
  });

  test("keeps in-memory updates when the storage manager refuses writes", () => {
    const globals = globalThis as unknown as {
      GM_setValue: (key: string, value: unknown) => void;
    };
    const original = globals.GM_setValue;
    globals.GM_setValue = () => {
      throw new Error("storage denied");
    };
    try {
      updateSetting("scrollStep", 411);
    } finally {
      globals.GM_setValue = original;
    }

    expect(getSettings().scrollStep).toBe(411);
  });

  test("updateSetting replaces the snapshot, persists, notifies and unsubscribes", () => {
    const seen: Readonly<UserSettings>[] = [];
    const unsubscribe = onSettingsChange((settings) => {
      seen.push(settings);
    });

    const before = getSettings();
    updateSetting("scrollStep", 333);
    const after = getSettings();

    expect(after).not.toBe(before);
    expect(after.scrollStep).toBe(333);
    expect(seen).toEqual([after]);

    const persisted = storedValue(STORAGE_KEY) as {
      version: number;
      values: { scrollStep: number };
    };
    expect(persisted.version).toBe(2);
    expect(persisted.values.scrollStep).toBe(333);

    unsubscribe();
    updateSetting("scrollStep", 444);

    expect(seen).toEqual([after]);
    expect(getSettings().scrollStep).toBe(444);
  });

  test("snapshots are frozen and never alias the caller's keymap", () => {
    const custom: KeyMap = {
      ...DEFAULT_KEYMAP,
      next: ["N"],
      prev: ["P"],
      fit: ["F"],
      gallery: ["G"],
      up: ["U"],
      down: ["D"],
    };

    updateSetting("keymap", custom);
    custom.next.push("M");

    const snapshot = getSettings();
    expect(snapshot.keymap.next).toEqual(["N"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.keymap)).toBe(true);
    expect(Object.isFrozen(snapshot.keymap.next)).toBe(true);
    expect(Reflect.set(snapshot, "gap", 999)).toBe(false);
    expect(() => snapshot.keymap.next.push("Z")).toThrow();
    expect(getSettings().keymap.next).not.toContain("Z");
  });
});

describe("isKey", () => {
  test("matches a custom keymap case-insensitively and ignores unbound keys", () => {
    const custom: KeyMap = {
      ...DEFAULT_KEYMAP,
      next: ["N", "ARROWRIGHT"],
      prev: [],
      fit: ["F"],
      gallery: ["G"],
      up: ["U"],
      down: ["D"],
    };
    updateSetting("keymap", custom);

    expect(isKey(keyEvent("n"), "next")).toBe(true);
    expect(isKey(keyEvent("N"), "next")).toBe(true);
    expect(isKey(keyEvent("ArrowRight"), "next")).toBe(true);
    expect(isKey(keyEvent("d"), "next")).toBe(false);
    expect(isKey(keyEvent("a"), "prev")).toBe(false);
  });

  test("matches shifted symbols and keeps browser modifiers reserved", () => {
    updateSetting("keymap", DEFAULT_KEYMAP);

    expect(isKey(keyEvent("?", { shiftKey: true }), "help")).toBe(true);
    expect(isKey(keyEvent("Escape"), "gallery")).toBe(true);
    expect(isKey(keyEvent("Home"), "first")).toBe(true);
    expect(isKey(keyEvent("End"), "last")).toBe(true);
    expect(isKey(keyEvent("r", { ctrlKey: true }), "reload")).toBe(false);
    expect(isKey(keyEvent("r", { metaKey: true }), "reload")).toBe(false);
    expect(isKey(keyEvent("r", { altKey: true }), "reload")).toBe(false);
  });
});
