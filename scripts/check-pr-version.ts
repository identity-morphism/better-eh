/**
 * Fails when a pull request moves the release version.
 *
 * Releases own the number: `bun run release <bump>` bumps `package.json`, rebuilds `dist/`, commits
 * and tags. A pull request that picks its own version collides with the next release, so CI checks
 * the field against the base commit and asks for the version to be left alone.
 */

interface PackageJson {
  version: string;
}

const ROOT = `${import.meta.dir}/..`;
const BASE = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "origin/master";

/** The message for a version that moved, or null when it is unchanged. */
export function versionDrift(
  baseVersion: string | undefined,
  currentVersion: string,
): string | null {
  if (baseVersion === currentVersion) {
    return null;
  }
  return (
    `package.json moved ${baseVersion ?? "<missing>"} -> ${currentVersion}. Leave "version" ` +
    "alone in a pull request; `bun run release <patch|minor|major>` bumps it, rebuilds dist/ and " +
    "tags the commit."
  );
}

function fail(message: string): never {
  console.error(`version: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const resolve = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--verify", `${BASE}^{commit}`],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (resolve.exitCode !== 0) {
    console.log(`version: cannot resolve ${BASE} in this clone, skipping`);
    return;
  }

  const baseFile = Bun.spawnSync({
    cmd: ["git", "show", `${BASE}:package.json`],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (baseFile.exitCode !== 0) {
    console.log(`version: ${BASE} has no package.json, skipping`);
    return;
  }

  const baseVersion = (JSON.parse(baseFile.stdout.toString()) as Partial<PackageJson>).version;
  const current = ((await Bun.file(`${ROOT}/package.json`).json()) as PackageJson).version;
  const drift = versionDrift(baseVersion, current);
  if (drift !== null) {
    fail(drift);
  }

  console.log(`version: ${current} unchanged from ${BASE}`);
}

if (import.meta.main) {
  await main();
}
