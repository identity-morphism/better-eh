/**
 * Publishes a scheduled tag-data refresh to master.
 *
 * The refresh rewrites `assets/*.bin`, regenerates the embedded core vocabulary and, for the
 * popularity snapshot, the bundle that inlines it. Master only accepts a push that already carries
 * the `check` status, and a commit created on a runner carries none, so a direct push is refused
 * with `GH006: Required status check "check" is expected`. The commit therefore goes to a scratch
 * branch first, `ci.yml` is dispatched against that branch — `workflow_dispatch` is the one event
 * the token recursion guard lets through — and only a green run pushes the same commit, now
 * carrying its `check`, to master.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CI_WORKFLOW = "ci.yml";
const TARGET_BRANCH = "master";
const PUBLISHED: Readonly<Record<string, true>> = {
  "assets/tag-counts.bin": true,
  "assets/tag-index.bin": true,
  "src/tags/core-vocabulary.ts": true,
  "dist/better-eh.user.js": true,
};

interface Options {
  branch: string;
  message: string;
}

interface Run {
  databaseId: number;
  headSha: string;
}

function redact(message: string): string {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  // Real tokens are 40 characters; shorter values are local probes and would shred ordinary words.
  return token.length < 16 ? message : message.replaceAll(token, "***");
}

function fail(message: string): never {
  console.error(`publish-data: ${redact(message)}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  let branch = "";
  let message = "";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--branch" && value !== undefined) {
      branch = value;
      index += 1;
    } else if (flag === "--message" && value !== undefined) {
      message = value;
      index += 1;
    } else {
      fail(`unknown argument ${flag}; expected --branch <name> --message <subject>`);
    }
  }
  if (branch === "" || message === "") {
    fail("usage: publish-data --branch <name> --message <subject>");
  }
  return { branch, message };
}

function read(args: readonly string[], env: Record<string, string> = {}): string {
  const result = Bun.spawnSync({
    cmd: [...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) {
    fail(`${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  // Untrimmed: `git status --porcelain` starts the first line with a significant space column.
  return result.stdout.toString();
}

function run(args: readonly string[], env: Record<string, string> = {}): void {
  const result = Bun.spawnSync({
    cmd: [...args],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) {
    fail(`${args.join(" ")} failed with exit code ${result.exitCode}`);
  }
}

function changedPaths(): string[] {
  return read(["git", "status", "--porcelain"])
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "");
}

async function waitForCiRun(
  sha: string,
  branch: string,
  auth: Record<string, string>,
): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const listing = read(
      [
        "gh",
        "run",
        "list",
        "--workflow",
        CI_WORKFLOW,
        "--branch",
        branch,
        "--event",
        "workflow_dispatch",
        "--limit",
        "20",
        "--json",
        "databaseId,headSha",
      ],
      auth,
    );
    const runs = (listing.trim() === "" ? [] : JSON.parse(listing)) as Run[];
    const match = runs.find((entry) => entry.headSha === sha);
    if (match) {
      return match.databaseId;
    }
    await Bun.sleep(5000);
  }
  fail(`no ${CI_WORKFLOW} run for ${sha.slice(0, 7)} appeared within five minutes`);
}

async function main(): Promise<void> {
  const { branch, message } = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token === undefined || token === "") {
    fail("GITHUB_TOKEN is required to dispatch ci.yml");
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository === undefined || repository === "") {
    fail("GITHUB_REPOSITORY is required; this script publishes from a workflow");
  }
  const auth = { GH_TOKEN: token, GH_REPO: repository };
  const remote = `https://x-access-token:${token}@github.com/${repository}.git`;

  console.log("publish-data: rebuilding the bundle from the refreshed data");
  run([process.execPath, "build.ts"]);

  const paths = changedPaths();
  if (paths.length === 0) {
    fail("nothing to publish; the refresh did not change its data");
  }
  const unexpected = paths.filter((path) => PUBLISHED[path] !== true);
  if (unexpected.length > 0) {
    fail(`unexpected changes outside the published data: ${unexpected.join(", ")}`);
  }

  run(["git", "add", ...paths]);
  run(["git", "commit", "-m", message]);
  const sha = read(["git", "rev-parse", "HEAD"]).trim();
  console.log(`publish-data: ${sha.slice(0, 7)} carries ${paths.join(", ")}`);

  run(["git", "push", "--force", remote, `HEAD:${branch}`]);
  run(["gh", "workflow", "run", CI_WORKFLOW, "--ref", branch], auth);
  const runId = await waitForCiRun(sha, branch, auth);
  console.log(`publish-data: ${CI_WORKFLOW} run ${runId} gates ${sha.slice(0, 7)}`);
  run(["gh", "run", "watch", String(runId), "--exit-status"], auth);

  run(["git", "push", remote, `${sha}:${TARGET_BRANCH}`]);
  console.log(`publish-data: ${sha.slice(0, 7)} is on ${TARGET_BRANCH} with its check`);
}

await main();
