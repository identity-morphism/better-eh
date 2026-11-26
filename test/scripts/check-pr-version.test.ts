import { expect, test } from "bun:test";

import { versionDrift } from "../../scripts/check-pr-version";

test("accepts a version that did not move", () => {
  expect(versionDrift("1.1.1", "1.1.1")).toBeNull();
});

test("explains a moved version without changing it", () => {
  const message = versionDrift("1.1.1", "1.2.0");

  expect(message).toContain("1.1.1 -> 1.2.0");
  expect(message).toContain('Leave "version" alone');
});

test("reports a base commit without a version", () => {
  expect(versionDrift(undefined, "1.1.1")).toContain("<missing> -> 1.1.1");
});
