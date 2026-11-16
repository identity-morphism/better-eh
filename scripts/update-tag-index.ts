/**
 * Refresh the compact tag vocabulary.
 *
 * Downloads the EhTagTranslation `db.html.json` release (about 7 MB), keeps only namespace ids and
 * sorted tag keys, and writes `assets/tag-index.bin`, the binary asset fetched at runtime.
 *
 * The weekly workflow commits just the binary, so vocabulary refreshes do not require a userscript
 * release.
 *
 * Bun run update:tag-index bun run update:tag-index --check
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { encodeTagVocabulary } from "../src/tags/index-codec";
import { vocabularyGroups } from "../src/tags/vocabulary";
import { bytesEqual, readExistingAsset } from "./asset-file";

const MIRRORS = [
  "https://cdn.jsdelivr.net/gh/EhTagTranslation/DatabaseReleases@master/db.html.json",
  "https://raw.githubusercontent.com/EhTagTranslation/DatabaseReleases/master/db.html.json",
] as const;
const ROOT = join(import.meta.dir, "..");
const ASSET_PATH = join(ROOT, "assets", "tag-index.bin");

async function download(): Promise<{ raw: unknown; source: string }> {
  for (const url of MIRRORS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        console.warn(`Mirror returned HTTP ${response.status}: ${url}`);
        continue;
      }
      return { raw: await response.json(), source: url };
    } catch (error) {
      console.warn(`Mirror failed: ${url}`, error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Could not download the tag vocabulary");
}

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");

  const { raw } = await download();
  const groups = vocabularyGroups(raw);
  const bytes = encodeTagVocabulary(groups);
  const tagCount = [...groups.values()].reduce((sum, keys) => sum + keys.length, 0);

  const revision =
    typeof raw === "object" && raw !== null && "head" in raw && typeof raw.head === "object"
      ? (() => {
          const head = raw.head;
          if (head === null || !("sha" in head) || typeof head.sha !== "string") {
            return "unknown";
          }
          return head.sha.slice(0, 12);
        })()
      : "unknown";

  const existingAsset = await readExistingAsset(ASSET_PATH);
  if (existingAsset !== null && bytesEqual(existingAsset, bytes)) {
    console.log(`Tag vocabulary unchanged: ${tagCount} tags, revision ${revision}`);
    return;
  }
  if (check) {
    console.error("Tag vocabulary is out of date; run `bun run update:tag-index`.");
    process.exit(1);
  }

  mkdirSync(join(ROOT, "assets"), { recursive: true });
  await Bun.write(ASSET_PATH, bytes);
  console.log(
    `Wrote assets/tag-index.bin: ${tagCount} tags, ${bytes.length} bytes (revision ${revision})`,
  );
}

if (import.meta.main) {
  await main();
}
