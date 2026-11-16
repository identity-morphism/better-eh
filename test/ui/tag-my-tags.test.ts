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

  test("shows watch, hide, and colour controls when handlers exist", () => {
    openTagMenu(
      anchor,
      { ns: "female", name: "enema" },
      "https://e-hentai.org/tag/female:enema",
      {
        vote: () => Promise.resolve(),
        addTags: () => Promise.resolve(),
        add: () => undefined,
        token: "f:enema$",
        watchTag: () => Promise.resolve(),
        hideTag: () => Promise.resolve(),
        colorTag: () => Promise.resolve(),
      },
      signal,
    );

    const labels = [...document.querySelectorAll(".tag-menu-item")].map((node) => node.textContent);
    expect(labels).toContain("Watch tag");
    expect(labels).toContain("Hide tag");
    expect(labels).toContain("Apply colour");
    expect(document.querySelector(".tag-menu-color")).not.toBeNull();
  });

  test("watch and colour run the handlers with the raw tag", async () => {
    const calls: Array<[string, string, string]> = [];
    openTagMenu(
      anchor,
      { ns: "female", name: "enema" },
      "https://e-hentai.org/tag/female:enema",
      {
        vote: () => Promise.resolve(),
        addTags: () => Promise.resolve(),
        add: () => undefined,
        token: null,
        watchTag: (tag) => {
          calls.push(["watch", tag, ""]);
          return Promise.resolve();
        },
        colorTag: (tag, color) => {
          calls.push(["color", tag, color]);
          return Promise.resolve();
        },
      },
      signal,
    );

    [...document.querySelectorAll<HTMLButtonElement>(".tag-menu-item")]
      .find((button) => button.textContent === "Watch tag")
      ?.click();
    await flush();

    // The menu closes on success; reopen it for the colour action.
    openTagMenu(
      anchor,
      { ns: "female", name: "enema" },
      "https://e-hentai.org/tag/female:enema",
      {
        vote: () => Promise.resolve(),
        addTags: () => Promise.resolve(),
        add: () => undefined,
        token: null,
        colorTag: (tag, color) => {
          calls.push(["color", tag, color]);
          return Promise.resolve();
        },
      },
      signal,
    );
    [...document.querySelectorAll<HTMLButtonElement>(".tag-menu-item")]
      .find((button) => button.textContent === "Apply colour")
      ?.click();
    await flush();

    expect(calls[0]).toEqual(["watch", "female:enema", ""]);
    expect(calls[1]?.[0]).toBe("color");
    expect(calls[1]?.[1]).toBe("female:enema");
    expect(calls[1]?.[2]).toMatch(/^#[0-9a-f]{6}$/u);
  });
});
