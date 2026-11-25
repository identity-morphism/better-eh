import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { decodeTagCountsFromBytes, tagKeyId } from "../../src/tags/tag-counts-codec";

const ASSET = join(import.meta.dir, "../../assets/tag-counts.bin");

describe("tag counts artifact", () => {
  test("decodes the committed snapshot into usable popularity", async () => {
    const bytes = new Uint8Array(await Bun.file(ASSET).arrayBuffer());
    const counts = decodeTagCountsFromBytes(bytes);

    expect(counts).not.toBeNull();
    if (!counts) {
      throw new Error("expected the remote asset to decode");
    }
    // The snapshot must cover the real vocabulary, not a handful of tags.
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(counts.counts.size).toBeGreaterThan(2_000);
    expect(counts.max).toBeGreaterThan(100_000);
    expect(counts.counts.get(tagKeyId("english"))).toBeGreaterThan(100_000);
  });
});
