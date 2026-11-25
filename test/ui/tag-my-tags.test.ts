import { beforeEach, describe, expect, test } from "bun:test";

import { openTagMenu } from "../../src/ui/gallery-tag-menu";
import { flushMicrotasks } from "./async";
import { installDom } from "./dom";

const flush = (): Promise<void> => flushMicrotasks(12);

describe("tag menu My Tags actions", () => {
  let anchor: HTMLButtonElement;
  let signal: AbortSignal;

  beforeEach(() => {
    installDom();
    anchor = document.createElement("button");
    document.body.append(anchor);
    signal = new AbortController().signal;
  });

  test("watch and colour controls run the handlers with the raw tag", async () => {
    const calls: Array<[string, string, string]> = [];
    const handlers = {
      vote: () => Promise.resolve(),
      addTags: () => Promise.resolve(),
      add: () => undefined,
      token: null,
      watchTag: (tag: string) => {
        calls.push(["watch", tag, ""]);
        return Promise.resolve();
      },
      hideTag: () => Promise.resolve(),
      colorTag: (tag: string, color: string) => {
        calls.push(["color", tag, color]);
        return Promise.resolve();
      },
    };

    openTagMenu(
      anchor,
      { ns: "female", name: "entry" },
      "https://e-hentai.org/tag/female:entry",
      handlers,
      signal,
    );
    const labels = [...document.querySelectorAll<HTMLButtonElement>("button")].map(
      (button) => button.textContent,
    );
    expect(labels).toContain("Watch tag");
    expect(labels).toContain("Hide tag");
    expect(labels).toContain("Apply colour");
    expect(document.querySelector<HTMLInputElement>('input[type="color"]')).not.toBeNull();

    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Watch tag")
      ?.click();
    await flush();
    expect(calls[0]).toEqual(["watch", "female:entry", ""]);

    // The menu closes on success; reopen it for the colour action.
    openTagMenu(
      anchor,
      { ns: "female", name: "entry" },
      "https://e-hentai.org/tag/female:entry",
      handlers,
      signal,
    );
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Apply colour")
      ?.click();
    await flush();

    expect(calls[1]?.[0]).toBe("color");
    expect(calls[1]?.[1]).toBe("female:entry");
    expect(calls[1]?.[2]).toMatch(/^#[0-9a-f]{6}$/u);
  });
});
