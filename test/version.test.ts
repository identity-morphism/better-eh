import { describe, expect, test } from "bun:test";

import { newestReleaseTag } from "../scripts/version";

describe("newestReleaseTag", () => {
  test("orders by version, not by tag name", () => {
    expect(newestReleaseTag(["v1.9.0", "v1.10.0", "v1.2.3"])).toBe("v1.10.0");
  });

  test("ignores tags that are not release versions", () => {
    expect(newestReleaseTag(["nightly-2026", "v2", "v1.2.0-rc1", "v1.0.0"])).toBe("v1.0.0");
  });

  test("returns null when no tag is a release", () => {
    expect(newestReleaseTag([])).toBeNull();
    expect(newestReleaseTag(["nightly"])).toBeNull();
  });
});
