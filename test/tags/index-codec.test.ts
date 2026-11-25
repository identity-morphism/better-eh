import { describe, expect, test } from "bun:test";

import { decodeTagVocabulary, encodeTagVocabulary } from "../../src/tags/index-codec";

describe("tag vocabulary codec", () => {
  test("round-trips sorted namespaces, front-coded keys and non-ASCII values", () => {
    const groups = new Map<string, readonly string[]>([
      ["female", ["big brevity", "big brother", "entry"]],
      ["language", ["english", "japanese"]],
      ["character", ["yashiro", "yy"]],
      ["artist", ["あいう", "あいえ"]],
    ]);

    expect([...(decodeTagVocabulary(encodeTagVocabulary(groups))?.entries() ?? [])]).toEqual([
      ["female", ["big brevity", "big brother", "entry"]],
      ["language", ["english", "japanese"]],
      ["character", ["yashiro", "yy"]],
      ["artist", ["あいう", "あいえ"]],
    ]);
  });

  test("rejects corrupt payloads instead of guessing", () => {
    const bytes = encodeTagVocabulary(new Map([["female", ["entry"]]]));

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
    badUtf8[badUtf8.length - 1] = 0xff;
    expect(decodeTagVocabulary(badUtf8)).toBeNull();

    // A hostile namespace count cannot make the decoder allocate wildly.
    const oversized = encodeTagVocabulary(new Map([["female", ["entry"]]]));
    new DataView(oversized.buffer).setUint16(5, 65_000, true);
    expect(decodeTagVocabulary(oversized)).toBeNull();
  });
});
