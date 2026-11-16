import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { decodeTagCountsFromBytes, tagKeyId } from "../../src/tags/tag-counts-codec";

const ASSET = join(import.meta.dir, "../../assets/tag-counts.bin");

describe("tag counts artifacts", () => {
  test("decodes the remote asset", async () => {
    const bytes = new Uint8Array(await Bun.file(ASSET).arrayBuffer());

    // A short file cannot carry the header and a non-trivial snapshot.
    expect(bytes.length).toBeGreaterThan(10_000);
    const counts = decodeTagCountsFromBytes(bytes);

    expect(counts).not.toBeNull();
    if (!counts) {
      throw new Error("expected the remote asset to decode");
    }
    expect(counts.counts.size).toBeGreaterThan(2_000);
    expect(counts.max).toBeGreaterThan(1_000_000);

    const english = counts.counts.get(tagKeyId("english")) ?? 0;
    expect(english).toBeGreaterThan(700_000);
  });
});
