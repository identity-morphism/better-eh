/**
 * Fails when the checked-out version is not the newest release tag.
 *
 * `bun run release` bumps `package.json`, rebuilds `dist/`, commits and tags the same commit. A
 * version committed without its tag — or a tag that skips the version — is drift: the raw bundle
 * advertises a version no release exists for, and the next release has to guess which number is
 * free. Master therefore only ever carries versions that are already tagged.
 */

import { join } from "node:path";

import { DIST_PATH, newestReleaseTag, readHeaderVersion } from "./version.ts";

interface PackageJson {
  version: string;
}

const ROOT = join(import.meta.dir, "..");

function fail(message: string): never {
  console.error(`release-tag: ${message}`);
  process.exit(1);
}

const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as PackageJson;
const built = readHeaderVersion(await Bun.file(join(ROOT, DIST_PATH)).text());
if (built !== pkg.version) {
  fail(
    `dist reports @version ${built ?? "<missing>"} but package.json is ${pkg.version}; run build`,
  );
}

const tags = Bun.spawnSync({
  cmd: ["git", "tag", "--merged", "HEAD", "--list", "v*"],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});
if (tags.exitCode !== 0) {
  fail(`cannot list tags: ${tags.stderr.toString().trim() || "not a git checkout"}`);
}
const newest = newestReleaseTag(tags.stdout.toString().split("\n").filter(Boolean));
if (newest === null) {
  console.log(`release-tag: no release tags yet; package.json ${pkg.version} starts the series`);
  process.exit(0);
}
if (newest !== `v${pkg.version}`) {
  fail(
    `package.json is ${pkg.version} but the newest merged release tag is ${newest}; ` +
      "release versions are tagged where they are bumped. Run " +
      "`bun run release <patch|minor|major> --push` instead of committing a version on its own.",
  );
}
console.log(`release-tag: package.json ${pkg.version} matches ${newest} and the built dist`);
