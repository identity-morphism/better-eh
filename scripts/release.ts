import { join } from "node:path";

import {
  BUMPS,
  bumpVersion,
  compareVersions,
  DIST_PATH,
  isBump,
  isSemver,
  readHeaderVersion,
} from "./version.ts";

const ROOT = join(import.meta.dir, "..");
const PACKAGE_PATH = "package.json";

interface PackageJson {
  version: string;
}

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function run(cmd: readonly string[]): void {
  const result = Bun.spawnSync({
    cmd: [...cmd],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    fail(`${cmd.join(" ")} exited with code ${result.exitCode}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const push = args.includes("--push");
  const bumpArg = args.find((arg) => !arg.startsWith("--"));

  if (!bumpArg) {
    fail(`usage: bun run release <${BUMPS.join("|")}|X.Y.Z> [--push]`);
  }
  if (!isBump(bumpArg) && !isSemver(bumpArg)) {
    fail(`invalid version argument: ${bumpArg} (expected ${BUMPS.join("|")} or X.Y.Z)`);
  }

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "master") {
    fail(`release from master, not ${branch}`);
  }

  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    fail(`working tree is not clean:\n${dirty}`);
  }

  const pkg = (await Bun.file(join(ROOT, PACKAGE_PATH)).json()) as PackageJson;
  const current = pkg.version;
  const next = isBump(bumpArg) ? bumpVersion(current, bumpArg) : bumpArg;

  if (compareVersions(next, current) <= 0) {
    fail(`${next} is not greater than the current version ${current}`);
  }
  if (git(["tag", "-l", `v${next}`])) {
    fail(`tag v${next} already exists`);
  }

  console.log(`release: ${current} -> ${next}`);
  const raw = await Bun.file(join(ROOT, PACKAGE_PATH)).text();
  const rewritten = raw.replace(/("version":\s*")[^"]*(")/, `$1${next}$2`);
  if (rewritten === raw) {
    fail("could not rewrite the version field in package.json");
  }
  await Bun.write(join(ROOT, PACKAGE_PATH), rewritten);

  run([process.execPath, "build.ts"]);

  const bundle = await Bun.file(join(ROOT, DIST_PATH)).text();
  const built = readHeaderVersion(bundle);
  if (built !== next) {
    fail(`built bundle reports @version ${built ?? "<missing>"}, expected ${next}`);
  }

  git(["add", PACKAGE_PATH, DIST_PATH]);
  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const unexpected = staged.filter((path) => path !== PACKAGE_PATH && path !== DIST_PATH);
  if (unexpected.length > 0) {
    git(["reset"]);
    fail(`unexpected staged changes: ${unexpected.join(", ")}`);
  }

  git(["commit", "-m", `chore: release v${next}`]);
  git(["tag", "-a", `v${next}`, "-m", `v${next}`]);
  console.log(`release: committed and tagged v${next}`);

  if (push) {
    git(["push", "--atomic", "origin", "HEAD:master", `refs/tags/v${next}`]);
    console.log("release: pushed the commit and tag");
  } else {
    console.log(
      `release: run \`git push --atomic origin HEAD:master refs/tags/v${next}\` to publish the tag`,
    );
  }
}

await main();
