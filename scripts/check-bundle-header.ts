/**
 * Release bundle header contract.
 *
 * CI runs this after `bun run build`. A userscript manager reads only the metadata block, so a
 * build that drops a match, a grant or the update URLs installs a bundle that never updates or
 * cannot reach its own storage. The version must also match `package.json`, which the release
 * workflow assumes when it compares the tag, the package and the published header.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist", "better-eh.user.js");
const REPO = "identity-morphism/better-eh";
const USERSCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/master/dist/better-eh.user.js`;
const HEADER_START = "// ==UserScript==";
const HEADER_END = "// ==/UserScript==";
const META_LINE = /^\/\/\s*@([A-Za-z-]+)(?:\s+(.*?))?\s*$/u;

interface PackageJson {
  version: string;
}

type Meta = ReadonlyMap<string, readonly string[]>;

/** Metadata whose value must appear at least once. */
const REQUIRED_VALUES: readonly (readonly [string, string])[] = [
  ["name", "Better EH"],
  ["namespace", `https://github.com/${REPO}`],
  ["updateURL", USERSCRIPT_URL],
  ["downloadURL", USERSCRIPT_URL],
  ["run-at", "document-start"],
  ["license", "MIT"],
];

const REQUIRED_MATCHES = ["https://e-hentai.org/*", "https://exhentai.org/*"] as const;

const REQUIRED_GRANTS = [
  "GM_addStyle",
  "GM_getValue",
  "GM_setValue",
  "GM_registerMenuCommand",
] as const;

/** Split the userscript block into its metadata values; null when the block is missing. */
function parseHeader(source: string): Meta | null {
  if (!source.startsWith(`${HEADER_START}\n`)) {
    return null;
  }
  const end = source.indexOf(HEADER_END);
  if (end === -1) {
    return null;
  }
  const meta = new Map<string, string[]>();
  for (const line of source.slice(0, end).split("\n")) {
    const match = META_LINE.exec(line);
    const key = match?.[1];
    if (key === undefined) {
      continue;
    }
    const value = match?.[2] ?? "";
    meta.set(key, [...(meta.get(key) ?? []), value]);
  }
  return meta;
}

function hasValue(meta: Meta, key: string, value: string): boolean {
  return meta.get(key)?.includes(value) === true;
}

const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as PackageJson;
const header = parseHeader(await Bun.file(BUNDLE).text());
if (header === null) {
  console.error(`bundle-header: ${BUNDLE} has no userscript metadata block`);
  process.exit(1);
}

const failures: string[] = [];
if (!hasValue(header, "version", pkg.version)) {
  failures.push(`@version must be ${pkg.version}`);
}
for (const [key, value] of REQUIRED_VALUES) {
  if (!hasValue(header, key, value)) {
    failures.push(`@${key} must be ${value}`);
  }
}
for (const pattern of REQUIRED_MATCHES) {
  if (!hasValue(header, "match", pattern)) {
    failures.push(`@match must include ${pattern}`);
  }
}
for (const grant of REQUIRED_GRANTS) {
  if (!hasValue(header, "grant", grant)) {
    failures.push(`@grant must include ${grant}`);
  }
}
if (!header.has("noframes")) {
  failures.push("@noframes is missing");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`bundle-header: ${failure}`);
  }
  process.exit(1);
}
console.log(
  `bundle-header: v${pkg.version}, ${REQUIRED_MATCHES.length} matches, ` +
    `${REQUIRED_GRANTS.length} grants, update URLs ok`,
);
