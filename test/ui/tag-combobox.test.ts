import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, updateSettings } from "../../src/settings";
import type { TagCompletionInput, TagIndex, TagUsage } from "../../src/tags/db";
import { buildTagIndex, tagId } from "../../src/tags/db";
import { tagKeyId } from "../../src/tags/tag-counts-codec";
import { attachTagCombobox } from "../../src/ui/tag-combobox";
import { installDom } from "./dom";

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

  return { input, used, completions, open: combobox.open };
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
  return [...document.querySelectorAll<HTMLElement>(".tag-option")];
}

beforeEach(() => {
  installDom();
  updateSettings(DEFAULT_SETTINGS);
});

describe("tag combobox", () => {
  test("opens with popularity-ranked suggestions", () => {
    const popular = buildTagIndex(
      {
        data: [
          { namespace: "language", data: { english: {} } },
          { namespace: "artist", data: { en: {} } },
        ],
      },
      1,
      {
        counts: new Map([
          [tagKeyId("english"), 500],
          [tagKeyId("en"), 5],
        ]),
        max: 500,
      },
    );
    const { open } = harness("en", new Map(), undefined, popular);
    open();

    expect(options()[0]?.querySelector(".tag-option-key")?.textContent).toBe("english");
  });

  test("opens with ranked tag suggestions and highlights the match", () => {
    const { input, open } = harness("breasts");
    open();

    const rows = options();
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(first?.classList.contains("is-active")).toBe(false);
    expect(first?.querySelector(".tag-option-key")?.textContent).toBe("big breasts");
    expect(first?.querySelector(".tag-option-badge")?.textContent).toBe("Female");
    expect(first?.querySelector("mark")?.textContent).toBe("breasts");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  test("mounts the suggestion list in a labelled dialog wired to the input", () => {
    const { input, open } = harness("breasts");
    open();

    const panel = document.querySelector<HTMLElement>(".tag-combobox");
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-label")).toBe("Tag suggestions");
    expect(panel?.id).toMatch(/^eh-tag-combobox-\d+$/u);

    const list = panel?.querySelector<HTMLElement>('[role="listbox"]');
    expect(list?.id).toBe(`${panel?.id ?? ""}-list`);
    expect(input.getAttribute("aria-controls")).toBe(list?.id ?? "");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(panel?.querySelector(".tag-combobox-foot")).not.toBeNull();
  });

  test("stays open for a press on the input and closes for a press outside", () => {
    const { input, open } = harness("breasts");
    open();

    input.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".tag-combobox")).not.toBeNull();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".tag-combobox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("applies a tag with Enter, commits, and remembers the pick", () => {
    const commits: number[] = [];
    const { input, used, completions, open } = harness("breasts", new Map(), () => {
      commits.push(1);
    });
    open();

    keydown(input, "ArrowDown");
    expect(options()[0]?.classList.contains("is-active")).toBe(true);
    keydown(input, "Enter");

    expect(input.value).toBe('f:"big breasts$" ');
    expect(used).toEqual([tagId("female", "big breasts")]);
    // The exact typed prefix is what becomes sticky next time.
    expect(completions).toEqual([
      { prefixNs: "", prefix: "breasts", ns: "female", key: "big breasts" },
    ]);
    expect(commits).toEqual([1]);
    expect(document.querySelector(".tag-combobox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("records a namespace-scoped completion under that namespace", () => {
    const { input, completions, open } = harness("female:big b");
    open();
    keydown(input, "ArrowDown");
    keydown(input, "Enter");

    expect(completions).toEqual([
      { prefixNs: "female", prefix: "big b", ns: "female", key: "big breasts" },
    ]);
  });

  test("applies a suggestion on click", () => {
    const first = harness("breasts");
    first.open();
    options()[0]?.click();
    expect(first.input.value).toBe('f:"big breasts$" ');
  });

  test("Tab closes without applying the active option and does not swallow the key", () => {
    const commits: number[] = [];
    const { input, open } = harness("breasts", new Map(), () => {
      commits.push(1);
    });
    open();

    const rows = options();
    keydown(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id ?? "");

    const tab = keydown(input, "Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(commits).toEqual([]);
    expect(input.value).toBe("breasts");
    expect(document.querySelector(".tag-combobox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);

    // Focus can already sit on the input after the close, so a bare focus() may not emit a
    // second focus event; dispatch the browser's focus path directly.
    input.dispatchEvent(new Event("focus"));
    expect(document.querySelector(".tag-combobox")).not.toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  test("footer buttons stay out of the tab order and remain clickable", () => {
    const { open } = harness("breasts");
    open();

    const toggle = document.querySelector<HTMLButtonElement>(".tag-combobox-exclude-toggle");
    const retry = document.querySelector<HTMLButtonElement>(".is-retry");
    expect(toggle?.getAttribute("tabindex")).toBe("-1");
    expect(retry?.getAttribute("tabindex")).toBe("-1");

    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });

  test("replaces every word of a merged multi-word phrase", () => {
    const { input, open } = harness("big b");
    open();

    expect(options()).toHaveLength(2);
    keydown(input, "ArrowDown");
    keydown(input, "Enter");

    expect(input.value).toBe('f:"big breasts$" ');
  });

  test("applies an exclusion through the footer toggle", () => {
    const { input, open } = harness("breasts");
    open();

    document.querySelector<HTMLButtonElement>(".tag-combobox-exclude-toggle")?.click();
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

  test("previews exclusion while Ctrl is held", () => {
    const { input, open } = harness("breasts");
    open();

    keydown(input, "Control");
    expect(options()[0]?.classList.contains("is-excluded")).toBe(true);

    const up = new Event("keyup", { bubbles: true });
    Object.assign(up, { key: "Control" });
    input.dispatchEvent(up);
    expect(options()[0]?.classList.contains("is-excluded")).toBe(false);
  });

  test("completes a namespace and keeps suggesting inside it", () => {
    const { input, open } = harness("fem");
    open();

    options()[0]?.click();
    expect(input.value).toBe("f:");
    expect(document.querySelector(".tag-combobox")).not.toBeNull();

    const rows = options();
    expect(rows.length).toBe(3);
    expect(rows[0]?.querySelector(".tag-option-badge")?.textContent).toBe("Female");
  });

  test("removes an already-applied tag when selected", () => {
    const { input, open } = harness('female:"big breasts$" female:big');
    open();

    const applied = options().find((node) => node.classList.contains("is-applied"));
    expect(applied).not.toBeUndefined();
    applied?.click();

    expect(input.value).toBe("female:big");
    expect(document.querySelector(".tag-combobox")).toBeNull();
  });

  test("shows recents before namespaces for an empty query", () => {
    const usage = new Map<string, TagUsage>([
      [tagId("female", "sole female"), { count: 3, lastUsed: Date.now() }],
    ]);
    const { open } = harness("", usage);
    open();

    const rows = options();
    expect(rows[0]?.classList.contains("is-namespace")).toBe(false);
    expect(rows[0]?.querySelector(".tag-option-key")?.textContent).toBe("sole female");
    expect(rows[0]?.querySelector(".tag-option-meta")?.textContent).toBe("recent");
    expect(rows.some((node) => node.classList.contains("is-namespace"))).toBe(true);
  });

  test("Escape closes without changing the query", () => {
    const { input, open } = harness("breasts");
    open();

    keydown(input, "Escape");
    expect(input.value).toBe("breasts");
    expect(document.querySelector(".tag-combobox")).toBeNull();
  });
});
