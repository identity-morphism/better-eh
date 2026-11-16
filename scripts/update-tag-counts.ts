/**
 * Refresh the tag-popularity snapshot.
 *
 * Downloads the latest `e-hentai-tag-count` release, keeps the tags that can affect ranking (at
 * least {@link MIN_POPULARITY} galleries, plus every language and location tag), encodes them with
 * `tag-counts-codec`, and writes `assets/tag-counts.bin`, the binary asset fetched at runtime.
 *
 * The weekly workflow commits just the binary, so data refreshes do not require a userscript
 * release.
 *
 * Bun run update:tag-counts bun run update:tag-counts --check
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { normaliseTagKey, TAG_NAMESPACES } from "../src/tags/model";
import { encodeTagCountsBytes } from "../src/tags/tag-counts-codec";
import { bytesEqual, readExistingAsset } from "./asset-file";

const SOURCE_URL =
  "https://github.com/mokurin000/e-hentai-tag-count/releases/latest/download/tagname_count.csv.gz";
const ROOT = join(import.meta.dir, "..");
const ASSET_PATH = join(ROOT, "assets", "tag-counts.bin");
const MIN_POPULARITY = 1000;

/** Small namespaces whose complete vocabulary is kept regardless of count. */
const ALWAYS_INCLUDE: Readonly<Record<string, true>> = { language: true, location: true };

const NAMESPACE_IDS = new Set(TAG_NAMESPACES.map((namespace) => namespace.id));

/**
 * Parse the upstream `tag_name,len` CSV into normalized tag keys and counts.
 *
 * Counts are merged across namespaces because only the tag name affects ranking. Unknown namespaces
 * are ignored, and tags below the threshold are dropped unless their namespace is always kept.
 */
export function parseTagCountsCsv(csv: string, minCount = MIN_POPULARITY): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = csv.split("\n");

  for (let position = 1; position < lines.length; position++) {
    const line = lines[position];
    if (!line) {
      continue;
    }
    const comma = line.lastIndexOf(",");
    if (comma < 0) {
      continue;
    }
    const value = Number(line.slice(comma + 1));
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    const name = line.slice(0, comma).trim();
    const colon = name.indexOf(":");
    const namespace = colon > 0 ? name.slice(0, colon) : "other";
    if (!NAMESPACE_IDS.has(namespace)) {
      continue;
    }
    if (value < minCount && ALWAYS_INCLUDE[namespace] !== true) {
      continue;
    }

    const key = normaliseTagKey(colon > 0 ? name.slice(colon + 1) : name);
    if (key === "") {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + value);
  }

  if (counts.size === 0) {
    throw new Error("Tag count data is empty");
  }
  return counts;
}

function maxCount(counts: ReadonlyMap<string, number>): number {
  let max = 0;
  for (const count of counts.values()) {
    if (count > max) {
      max = count;
    }
  }
  return max;
}

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");

  // The stable `latest` URL redirects to a versioned asset; read the first redirect so the log
  // records which release was written.
  const head = await fetch(SOURCE_URL, { redirect: "manual" });
  const release =
    /\/download\/([^/]+)\//u.exec(head.headers.get("location") ?? "")?.[1] ?? "latest";

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Tag count download failed (HTTP ${response.status})`);
  }
  const csv = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString("utf8");
  if (!csv.startsWith("tag_name,")) {
    throw new Error("Tag count download was not the expected CSV");
  }

  const counts = parseTagCountsCsv(csv);
  const bytes = encodeTagCountsBytes(counts);
  const max = maxCount(counts);

  const existingAsset = await readExistingAsset(ASSET_PATH);
  if (existingAsset !== null && bytesEqual(existingAsset, bytes)) {
    console.log(`Tag counts unchanged: ${counts.size} tags, release ${release}`);
    return;
  }
  if (check) {
    console.error("Tag counts are out of date; run `bun run update:tag-counts`.");
    process.exit(1);
  }

  mkdirSync(join(ROOT, "assets"), { recursive: true });
  await Bun.write(ASSET_PATH, bytes);
  console.log(
    `Wrote assets/tag-counts.bin: ${counts.size} tags, max ${max}, ${bytes.length} bytes (release ${release})`,
  );
}

if (import.meta.main) {
  await main();
}
