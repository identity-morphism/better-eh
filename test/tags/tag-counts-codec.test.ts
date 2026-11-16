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
} from "../../src/tags/tag-counts-codec";

function corrupt(valid: Uint8Array, offset: number, value: number): Uint8Array {
  const bytes = valid.slice();
  bytes[offset] = value;
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("tag counts codec", () => {
  test("normalizes raw keys without changing the hash of normalized ones", () => {
    expect(tagKeyId("english")).toBe(639_850_257_191);
    expect(tagKeyId("Big_brevity")).toBe(tagKeyId("big brevity"));
    expect(tagKeyId("  big   brevity ")).toBe(tagKeyId("big brevity"));
    expect(tagKeyId("Pokémon")).toBe(tagKeyId("pokemon"));
  });

  test("quantizes on the log scale", () => {
    expect(quantiseCount(0, 1_000_000)).toBe(0);
    expect(quantiseCount(1_000_000, 1_000_000)).toBe(255);
    expect(quantiseCount(1_000, 1_000_000)).toBeGreaterThan(0);

    const max = 1_329_025;
    const reconstructed = dequantiseCount(quantiseCount(771_349, max), max);
    expect(Math.abs(reconstructed - 771_349) / 771_349).toBeLessThan(0.01);
  });

  test("round-trips a snapshot", () => {
    const counts = new Map([
      ["english", 771_349],
      ["big brevity", 1_329_025],
      ["entry", 16_348],
    ]);
    const decoded = decodeTagCountsFromBytes(encodeTagCountsBytes(counts));

    expect(decoded).not.toBeNull();
    if (!decoded) {
      throw new Error("expected decoded counts");
    }
    expect(decoded.max).toBe(1_329_025);
    expect(decoded.counts.size).toBe(3);
    expect(decoded.counts.get(tagKeyId("english"))).toBeGreaterThan(750_000);
    expect(decoded.counts.get(tagKeyId("english"))).toBeLessThan(790_000);
    expect(decoded.counts.get(tagKeyId("big brevity"))).toBe(1_329_025);
  });

  test("decodes the base64 payload", () => {
    const valid = encodeTagCountsBytes(new Map([["english", 771_349]]));
    const decoded = decodeTagCounts(toBase64(valid));

    expect(decoded?.max).toBe(771_349);
    expect(decoded?.counts.get(tagKeyId("english"))).toBeGreaterThan(750_000);
  });

  test("rejects empty input", () => {
    expect(() => encodeTagCountsBytes(new Map())).toThrow();
  });

  test("rejects corrupt payloads", () => {
    const valid = encodeTagCountsBytes(new Map([["english", 771_349]]));

    expect(decodeTagCounts("")).toBeNull();
    expect(decodeTagCounts("!!!")).toBeNull();
    expect(decodeTagCountsFromBytes(valid.slice(0, HEADER_BYTES + ENTRY_BYTES - 1))).toBeNull();
    expect(decodeTagCountsFromBytes(corrupt(valid, 0, 0x58))).toBeNull();
    expect(decodeTagCountsFromBytes(corrupt(valid, 4, 99))).toBeNull();
  });
});
