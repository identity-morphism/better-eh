import { describe, expect, test } from "bun:test";

import { clickIntent, swipeIntent } from "../../src/reader-mode";

describe("reader input intents", () => {
  test("maps click zones to next, prev or toggle per mode and reading direction", () => {
    expect(clickIntent(0.1, "single", "ltr")).toBe("prev");
    expect(clickIntent(0.9, "single", "ltr")).toBe("next");
    expect(clickIntent(0.1, "single", "rtl")).toBe("next");
    expect(clickIntent(0.9, "single", "rtl")).toBe("prev");
    expect(clickIntent(0.5, "single", "rtl")).toBe("toggle");

    // The stack's edge zones span the outer thirds and never mirror with direction.
    expect(clickIntent(0.2, "continuous", "ltr")).toBe("prev");
    expect(clickIntent(0.9, "continuous", "rtl")).toBe("next");
  });

  test("swipes mirror with direction and ignore short gestures", () => {
    expect(swipeIntent(-80, 50, "single", "ltr")).toBe("next");
    expect(swipeIntent(80, 50, "single", "ltr")).toBe("prev");
    expect(swipeIntent(-80, 50, "single", "rtl")).toBe("prev");
    expect(swipeIntent(-30, 50, "single", "ltr")).toBeNull();
    expect(swipeIntent(-80, 50, "continuous", "rtl")).toBe("next");
  });
});
