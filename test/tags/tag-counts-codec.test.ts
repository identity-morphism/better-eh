import { describe, expect, test } from "bun:test";

import {
  decodeTagCounts,
  decodeTagCountsFromBytes,
  dequantiseCount,
  encodeTagCountsBytes,
  ENTRY_BYTES,
  HEADER_BYTES,
  quantiseCount,
  tagKeyId,
  tagKeyIdFromFolded,
} from "../../src/tags/tag-counts-codec";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("tag counts codec", () => {
  test("hashes normalized keys and keeps their identity stable", () => {
    // The remote asset and every cached payload are keyed by this hash: changing it orphans both.
    expect(tagKeyId("english")).toBe(639_850_257_191);
    expect(tagKeyId("Big_Breasts")).toBe(tagKeyId("big breasts"));
    expect(tagKeyId("  big   breasts ")).toBe(tagKeyId("big breasts"));
    expect(tagKeyId("Pokémon")).toBe(tagKeyId("pokemon"));

    // The index keeps folded keys; hashing them directly must agree with the public entry point.
    expect(tagKeyIdFromFolded("big breasts")).toBe(tagKeyId("Big_Breasts"));
    expect(tagKeyIdFromFolded("pokemon")).toBe(tagKeyId("Pokémon"));
    expect(tagKeyIdFromFolded("")).toBe(tagKeyId(""));
  });

  test("quantizes on a log scale with bounded error", () => {
    expect(quantiseCount(0, 1_000_000)).toBe(0);
    expect(quantiseCount(1_000_000, 1_000_000)).toBe(255);

    const max = 1_329_025;
    const reconstructed = dequantiseCount(quantiseCount(771_349, max), max);
    expect(Math.abs(reconstructed - 771_349) / 771_349).toBeLessThan(0.01);
  });

  test("round-trips a snapshot through bytes and the base64 envelope", () => {
    const counts = new Map([
      ["english", 771_349],
      ["big breasts", 1_329_025],
      ["enema", 16_348],
    ]);
    const bytes = encodeTagCountsBytes(counts);

    const decoded = decodeTagCountsFromBytes(bytes);
    expect(decoded?.max).toBe(1_329_025);
    expect(decoded?.counts.get(tagKeyId("big breasts"))).toBe(1_329_025);
    expect(decoded?.counts.get(tagKeyId("english"))).toBeGreaterThan(750_000);
    expect(decoded?.counts.get(tagKeyId("english"))).toBeLessThan(790_000);

    expect(decodeTagCounts(toBase64(bytes))?.max).toBe(1_329_025);
  });

  test("writes an explicit denominator for a selected subset", () => {
    const decoded = decodeTagCountsFromBytes(
      encodeTagCountsBytes(new Map([["english", 771_349]]), 1_334_048),
    );

    expect(decoded?.max).toBe(1_334_048);
    expect(decoded?.counts.get(tagKeyId("english"))).toBeGreaterThan(750_000);
  });

  test("rejects empty input and corrupt payloads", () => {
    expect(() => encodeTagCountsBytes(new Map())).toThrow();

    const valid = encodeTagCountsBytes(new Map([["english", 771_349]]));
    expect(decodeTagCounts("")).toBeNull();
    expect(decodeTagCounts("!!!")).toBeNull();
    expect(decodeTagCountsFromBytes(valid.slice(0, HEADER_BYTES + ENTRY_BYTES - 1))).toBeNull();

    const badMagic = valid.slice();
    badMagic[0] = 0x58;
    expect(decodeTagCountsFromBytes(badMagic)).toBeNull();

    const badVersion = valid.slice();
    badVersion[4] = 99;
    expect(decodeTagCountsFromBytes(badVersion)).toBeNull();
  });
});
