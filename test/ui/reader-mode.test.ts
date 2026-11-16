import { describe, expect, test } from "bun:test";

import { clickIntent, swipeIntent } from "../../src/reader-mode";

describe("reader input intents", () => {
  test("mirrors click edges in RTL reading order", () => {
    expect(clickIntent(0.1, "single", "ltr")).toBe("prev");
    expect(clickIntent(0.9, "single", "ltr")).toBe("next");
    expect(clickIntent(0.1, "single", "rtl")).toBe("next");
    expect(clickIntent(0.9, "single", "rtl")).toBe("prev");
    expect(clickIntent(0.5, "single", "rtl")).toBe("toggle");
  });

  test("continuous edges step one page from either side", () => {
    expect(clickIntent(0.1, "continuous", "ltr")).toBe("prev");
    expect(clickIntent(0.2, "continuous", "ltr")).toBe("prev");
    expect(clickIntent(0.2, "continuous", "rtl")).toBe("prev");
    expect(clickIntent(0.8, "continuous", "ltr")).toBe("next");
    expect(clickIntent(0.5, "continuous", "ltr")).toBe("toggle");
  });

  test("swipes mirror with direction and ignore short or vertical gestures", () => {
    expect(swipeIntent(-80, 50, "single", "ltr")).toBe("next");
    expect(swipeIntent(80, 50, "single", "ltr")).toBe("prev");
    expect(swipeIntent(-80, 50, "single", "rtl")).toBe("prev");
    expect(swipeIntent(80, 50, "single", "rtl")).toBe("next");
    expect(swipeIntent(-30, 50, "single", "ltr")).toBeNull();
    expect(swipeIntent(-80, 50, "continuous", "rtl")).toBe("next");
  });
});
