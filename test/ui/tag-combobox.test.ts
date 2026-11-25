import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, updateSettings } from "../../src/settings";
import type { TagCompletionInput, TagIndex, TagUsage } from "../../src/tags/db";
import { buildTagIndex, tagId } from "../../src/tags/db";
import { attachTagCombobox } from "../../src/ui/tag-combobox";
import { deferred, until } from "./async";
import { installDom } from "./dom";
import { installFrameQueue } from "./frames";

const INDEX: TagIndex = buildTagIndex(
  {
    data: [
      {
        namespace: "female",
        data: { "big breasts": {}, "big brother": {}, "sole female": {} },
      },
      { namespace: "male", data: { "big dick": {} } },
    ],
  },
  1,
);

interface Harness {
  input: HTMLInputElement;
  used: string[];
  completions: TagCompletionInput[];
  open: () => void;
  refresh: () => void;
}

function harness(
  value = "",
  usage: ReadonlyMap<string, TagUsage> = new Map(),
  onCommit?: () => void,
  index: TagIndex = INDEX,
): Harness {
  const document = installDom();
  const prototype = Object.getPrototypeOf(document.createElement("div")) as {
    scrollIntoView?: () => void;
  };
  prototype.scrollIntoView = () => undefined;

  const input = document.createElement("input");
  input.value = value;
  document.body.append(input);

  const used: string[] = [];
  const completions: TagCompletionInput[] = [];
  const combobox = attachTagCombobox({
    input,
    onCommit,
    deps: {
      getIndex: () => index,
      loadIndex: () => Promise.resolve(index),
      getUsage: () => usage,
      recordUse: (ns, key) => {
        used.push(tagId(ns, key));
      },
      getCompletions: () => new Map(),
      recordCompletion: (confirmed) => {
        completions.push(confirmed);
      },
    },
  });

  return { input, used, completions, open: combobox.open, refresh: combobox.refresh };
}

function keydown(input: HTMLInputElement, key: string, init: { ctrlKey?: boolean } = {}): Event {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.assign(event, {
    key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: false,
    altKey: false,
    isComposing: false,
  });
  input.dispatchEvent(event);
  return event;
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

beforeEach(() => {
  installDom();
  updateSettings(DEFAULT_SETTINGS);
});

describe("tag combobox", () => {
  test("opens a labelled listbox with ranked, highlighted suggestions", () => {
    const { input, open } = harness("breasts");
    open();

    const first = options()[0];
    expect(first?.textContent).toContain("Female");
    expect(first?.textContent).toContain("big breasts");
    expect(first?.querySelector("mark")?.textContent).toBe("breasts");
    expect(first?.getAttribute("aria-selected")).toBe("false");

    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel?.getAttribute("aria-label")).toBe("Tag suggestions");
    const list = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(list?.getAttribute("aria-label")).toBe("Tag suggestions");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(list?.id ?? "");
  });

  test("reports recents and namespaces while the query is empty", () => {
    const usage = new Map<string, TagUsage>([
      [tagId("female", "sole female"), { count: 3, lastUsed: Date.now() }],
    ]);
    const { open } = harness("", usage);
    open();

    const text = document.querySelector<HTMLElement>('[role="dialog"]')?.textContent ?? "";
    expect(text).toContain("recent");
    expect(text).toContain("namespace");
  });

  test("opens on focus, stays open for a press on the input, and closes outside or on Escape", () => {
    const { input } = harness("breasts");

    input.dispatchEvent(new Event("focus"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    input.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");

    input.dispatchEvent(new Event("focus"));
    keydown(input, "Escape");
    expect(input.value).toBe("breasts");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("applies a tag with Enter, commits, and remembers the pick", () => {
    const commits: number[] = [];
    const { input, used, completions, open } = harness("breasts", new Map(), () => {
      commits.push(1);
    });
    open();

    keydown(input, "ArrowDown");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    keydown(input, "Enter");

    expect(input.value).toBe('f:"big breasts$" ');
    expect(used).toEqual([tagId("female", "big breasts")]);
    // The exact typed prefix is what becomes sticky next time.
    expect(completions).toEqual([
      { prefixNs: "", prefix: "breasts", ns: "female", key: "big breasts" },
    ]);
    expect(commits).toEqual([1]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("records a completion under the namespace it was typed in", () => {
    const { input, completions, open } = harness("female:big b");
    open();
    keydown(input, "ArrowDown");
    keydown(input, "Enter");

    expect(input.value).toBe('f:"big breasts$" ');
    expect(completions).toEqual([
      { prefixNs: "female", prefix: "big b", ns: "female", key: "big breasts" },
    ]);
  });

  test("Tab closes without applying the active option and does not swallow the key", () => {
    const commits: number[] = [];
    const { input, open } = harness("breasts", new Map(), () => {
      commits.push(1);
    });
    open();

    keydown(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id ?? null);
    const tab = keydown(input, "Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(commits).toEqual([]);
    expect(input.value).toBe("breasts");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("the footer exclusion toggle stays out of the tab order and applies an exclusion", () => {
    const { input, open } = harness("breasts");
    open();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const toggle = buttons.find((button) => button.textContent === "Exclude");
    expect(toggle?.getAttribute("tabindex")).toBe("-1");
    expect(buttons.find((button) => button.textContent === "Retry")?.getAttribute("tabindex")).toBe(
      "-1",
    );

    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    keydown(input, "ArrowDown");
    keydown(input, "Enter");
    expect(input.value).toBe('-f:"big breasts$" ');
  });

  test("applies an exclusion while Ctrl is held", () => {
    const { input, open } = harness("breasts");
    open();

    keydown(input, "Control");
    keydown(input, "ArrowDown", { ctrlKey: true });
    keydown(input, "Enter", { ctrlKey: true });

    expect(input.value).toBe('-f:"big breasts$" ');
  });

  test("completes a namespace and keeps suggesting inside it", () => {
    const { input, open } = harness("fem");
    open();

    options()[0]?.click();
    expect(input.value).toBe("f:");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(options().length).toBeGreaterThan(0);
    expect(options()[0]?.textContent).toContain("Female");
  });

  test("skips an identical render and coalesces typing into one frame", () => {
    const { input, open, refresh } = harness("breasts");
    open();

    const first = options()[0];
    refresh();
    expect(options()[0]).toBe(first);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const frames = installFrameQueue();
    try {
      input.value = "big";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.value = "big b";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(frames.pending.size).toBe(1);
      expect(options()[0]).toBe(first);

      frames.run();
      expect(options()[0]).not.toBe(first);
      expect(options()[0]?.textContent).toContain("big breasts");
    } finally {
      frames.restore();
    }
  });

  test("keyboard navigation flushes a queued render before moving", () => {
    const { input, open } = harness("big");
    open();
    const frames = installFrameQueue();
    try {
      input.value = "big b";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(frames.pending.size).toBe(1);

      keydown(input, "ArrowDown");
      expect(options()[0]?.textContent).toContain("big breasts");
      expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
      expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id ?? null);
    } finally {
      frames.restore();
    }
  });

  test("closing the panel cancels a queued render", () => {
    const { input, open } = harness("breasts");
    open();
    const frames = installFrameQueue();
    try {
      input.value = "big";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(frames.pending.size).toBe(1);

      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(frames.pending.size).toBe(0);
    } finally {
      frames.restore();
    }
  });

  test("renders loading once and then the error state", async () => {
    const doc = installDom();
    const prototype = Object.getPrototypeOf(doc.createElement("div")) as {
      scrollIntoView?: () => void;
    };
    prototype.scrollIntoView = () => undefined;

    const input = doc.createElement("input");
    input.value = "breasts";
    doc.body.append(input);
    const load = deferred<TagIndex>();
    const combobox = attachTagCombobox({
      input,
      deps: {
        getIndex: () => null,
        loadIndex: () => load.promise,
        getUsage: () => new Map(),
        recordUse: () => undefined,
        getCompletions: () => new Map(),
        recordCompletion: () => undefined,
      },
    });

    combobox.open();
    const message = doc.querySelector<HTMLElement>(".tag-combobox-state");
    expect(message?.textContent).toContain("Loading tags…");

    // The identical loading render is skipped instead of rebuilding the message.
    combobox.open();
    expect(doc.querySelector(".tag-combobox-state")).toBe(message);

    load.reject(new Error("offline"));
    await until(
      () => doc.querySelector(".tag-combobox-state")?.textContent.includes("unavailable") === true,
    );
    const retry = [...doc.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry?.hidden).toBe(false);
    combobox.open();
    expect(doc.querySelector(".tag-combobox-state")?.textContent).toContain("unavailable");
  });

  test("removes an already-applied tag when selected", () => {
    const { input, open } = harness('female:"big breasts$" female:big');
    open();

    const applied = options().find((node) =>
      node.getAttribute("aria-label")?.includes("already applied"),
    );
    expect(applied).toBeDefined();
    applied?.click();

    expect(input.value).toBe("female:big");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
