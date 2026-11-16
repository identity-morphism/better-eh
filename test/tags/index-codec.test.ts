import { describe, expect, test } from "bun:test";

import { decodeTagVocabulary, encodeTagVocabulary } from "../../src/tags/index-codec";

describe("tag vocabulary codec", () => {
  test("round-trips sorted namespaces and front-coded keys", () => {
    const groups = new Map<string, readonly string[]>([
      ["female", ["big breasts", "big brother", "enema"]],
      ["language", ["english", "japanese"]],
      ["character", ["yashiro", "yy"]],
    ]);
    const bytes = encodeTagVocabulary(groups);
    const decoded = decodeTagVocabulary(bytes);

    expect(decoded).not.toBeNull();
    expect([...(decoded?.entries() ?? [])]).toEqual([
      ["female", ["big breasts", "big brother", "enema"]],
      ["language", ["english", "japanese"]],
      ["character", ["yashiro", "yy"]],
    ]);
    // Front coding keeps a long shared prefix once instead of once per key.
    const shared = Array.from({ length: 100 }, (_, index) => `very long shared prefix ${index}`);
    const coded = encodeTagVocabulary(new Map([["artist", shared]]));
    expect(coded.length).toBeLessThan(shared.reduce((sum, key) => sum + key.length, 0));
  });

  test("preserves non-ASCII keys", () => {
    const groups = new Map<string, readonly string[]>([["artist", ["あいう", "あいえ"]]]);
    const decoded = decodeTagVocabulary(encodeTagVocabulary(groups));
    expect(decoded?.get("artist")).toEqual(["あいう", "あいえ"]);
  });

  test("rejects corrupt payloads instead of guessing", () => {
    const bytes = encodeTagVocabulary(new Map([["female", ["enema"]]]));

    const badMagic = bytes.slice();
    badMagic[0] = 0;
    expect(decodeTagVocabulary(badMagic)).toBeNull();

    const badVersion = bytes.slice();
    badVersion[4] = 9;
    expect(decodeTagVocabulary(badVersion)).toBeNull();

    expect(decodeTagVocabulary(bytes.slice(0, bytes.length - 1))).toBeNull();
    expect(decodeTagVocabulary(new Uint8Array([...bytes, 0]))).toBeNull();
    expect(decodeTagVocabulary(new Uint8Array())).toBeNull();

    const badUtf8 = encodeTagVocabulary(new Map([["female", ["ab"]]]));
    const suffixOffset = badUtf8.length - 1;
    badUtf8[suffixOffset] = 0xff;
    expect(decodeTagVocabulary(badUtf8)).toBeNull();
  });

  test("rejects oversized namespace counts", () => {
    const bytes = encodeTagVocabulary(new Map([["female", ["enema"]]]));
    new DataView(bytes.buffer).setUint16(5, 65_000, true);
    expect(decodeTagVocabulary(bytes)).toBeNull();
  });
});
