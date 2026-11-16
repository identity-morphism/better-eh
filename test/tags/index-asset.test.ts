import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { decodeTagVocabulary } from "../../src/tags/index-codec";
import { TAG_NAMESPACES } from "../../src/tags/model";

const ASSET = join(import.meta.dir, "../../assets/tag-index.bin");

describe("remote tag vocabulary asset", () => {
  test("decodes every known namespace from the committed binary", async () => {
    const bytes = new Uint8Array(await Bun.file(ASSET).arrayBuffer());
    const groups = decodeTagVocabulary(bytes);

    expect(groups).not.toBeNull();
    if (!groups) {
      throw new Error("expected the vocabulary asset to decode");
    }
    expect(bytes.length).toBeLessThan(500_000);
    expect(groups.size).toBe(TAG_NAMESPACES.length);

    const known = new Set(TAG_NAMESPACES.map((namespace) => namespace.id));
    for (const id of groups.keys()) {
      expect(known.has(id)).toBe(true);
    }
    expect(groups.get("female")).toContain("big breasts");
    expect(groups.get("language")).toContain("english");
    expect(groups.get("other")).toContain("full color");
    expect([...groups.values()].reduce((sum, keys) => sum + keys.length, 0)).toBeGreaterThan(
      40_000,
    );
  });
});
