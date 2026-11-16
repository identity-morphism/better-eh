import { describe, expect, test } from "bun:test";

import { seekHref } from "../../src/data/list-seek";

describe("listing seek", () => {
  test("drops cursors and any earlier seek", () => {
    expect(seekHref("https://e-hentai.org/?f_search=x&next=123&seek=2019", "2020-06")).toBe(
      "/?f_search=x&seek=2020-06",
    );
  });

  test("clears the seek when the value is empty", () => {
    expect(seekHref("https://e-hentai.org/doujinshi?seek=2020&prev=1", "  ")).toBe("/doujinshi");
  });
});
