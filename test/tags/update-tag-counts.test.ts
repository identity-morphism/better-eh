import { describe, expect, test } from "bun:test";

import { parseTagCountsCsv } from "../../scripts/update-tag-counts";

const CSV = [
  "tag_name,len",
  "language:english,800000",
  "language:latin,50",
  "female:entry,15000",
  "male:entry,2000",
  "artist:en,115",
  "group:en,7",
  "female:Big_brevity,20000",
  "male:big brevity,5000",
  "female:Pokémon,1200",
  "unknown:thing,999999",
  "rows:female,99",
  "female:low,10",
].join("\n");

describe("tag count source", () => {
  test("filters by count, keeps small namespaces, and merges tags", () => {
    const counts = parseTagCountsCsv(CSV, 1000);

    expect(counts.get("english")).toBe(800000);
    expect(counts.get("latin")).toBe(50);
    expect(counts.get("entry")).toBe(17000);
    expect(counts.get("big brevity")).toBe(25000);
    expect(counts.get("pokemon")).toBe(1200);
    expect(counts.has("en")).toBe(false);
    expect(counts.has("low")).toBe(false);
    expect(counts.has("thing")).toBe(false);
  });

  test("rejects an empty payload", () => {
    expect(() => parseTagCountsCsv("tag_name,len")).toThrow();
  });
});
