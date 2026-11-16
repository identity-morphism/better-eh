import { join } from "node:path";

import { compareVersions, DIST_PATH, readHeaderVersion } from "./version.ts";

/**
 * Fails when the built userscript changed without its `@version` moving.
 *
 * Managers only update on a version change, so a `dist/` change that keeps the old version silently
 * never reaches installed copies.
 */

const ROOT = join(import.meta.dir, "..");

function git(args: readonly string[]): { code: number; out: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString().trim() };
}

const base = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "HEAD~1";

if (git(["rev-parse", "--verify", `${base}^{commit}`]).code !== 0) {
  console.log(`version: cannot resolve ${base} in this clone, skipping`);
  process.exit(0);
}

const changed = git(["diff", "--quiet", base, "HEAD", "--", DIST_PATH]).code !== 0;
if (!changed) {
  console.log(`version: ${DIST_PATH} unchanged since ${base}`);
  process.exit(0);
}

const current = readHeaderVersion(await Bun.file(join(ROOT, DIST_PATH)).text());
if (!current) {
  console.error(`version: ${DIST_PATH} has no @version in its userscript header`);
  process.exit(1);
}

const previous = readHeaderVersion(git(["show", `${base}:${DIST_PATH}`]).out);
if (!previous) {
  console.log(`version: ${DIST_PATH} is new since ${base}, nothing to compare`);
  process.exit(0);
}

if (compareVersions(current, previous) <= 0) {
  console.error(
    `version: ${DIST_PATH} changed since ${base} but @version stayed at ${current} ` +
      `(previous ${previous}). Run \`bun run release <patch|minor|major>\`.`,
  );
  process.exit(1);
}

console.log(`version: ${previous} -> ${current}`);
