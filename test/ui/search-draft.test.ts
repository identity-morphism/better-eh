import { beforeEach, describe, expect, test } from "bun:test";

import { emptySearchQuery } from "../../src/parse/query";
import { getSearchDraft, setSearchDraftText, setSearchQuery } from "../../src/search-draft";
import { installDom } from "./dom";

const DRAFT_KEY = "eh:search-draft:v1";

/** A sessionStorage stand-in; the store adapter reads it lazily from the global. */
function installStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
      },
      removeItem: (key: string): void => {
        entries.delete(key);
      },
    },
  });
  return entries;
}

function storedDraft(entries: Map<string, string>): unknown {
  const raw = entries.get(DRAFT_KEY);
  if (raw === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("values" in parsed)) {
    return undefined;
  }
  return parsed.values;
}

beforeEach(() => {
  installDom();
});

describe("draft persistence", () => {
  test("keeps typing in memory and persists only when the page hides", () => {
    const entries = installStorage();
    try {
      setSearchQuery({ ...emptySearchQuery(), text: "committed" });
      setSearchDraftText("typed");
      expect(getSearchDraft().text).toBe("typed");
      // The keystroke has not reached storage yet.
      expect(storedDraft(entries)).toBe("committed");

      window.dispatchEvent(new Event("pagehide"));
      expect(storedDraft(entries)).toBe("typed");
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });

  test("flushes when the document becomes hidden", () => {
    const entries = installStorage();
    try {
      setSearchQuery({ ...emptySearchQuery(), text: "base" });
      setSearchDraftText("hidden draft");
      expect(storedDraft(entries)).toBe("base");

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(storedDraft(entries)).toBe("hidden draft");
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });
});
