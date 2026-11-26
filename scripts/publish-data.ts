/**
 * Publishes a scheduled tag-data refresh through a pull request.
 *
 * The refresh rewrites `assets/*.bin`, regenerates the embedded core vocabulary and, for the
 * popularity snapshot, the bundle that inlines it. Master requires the `check` status, and only a
 * run triggered by `push`, `pull_request`, `pull_request_review`, `pull_request_target`,
 * `deployment` or `deployment_status` reports a check that satisfies it: a `workflow_dispatch` run
 * counts for nothing, and a push or pull request made with `GITHUB_TOKEN` starts no run at all. The
 * refresh therefore rides `TAG_DATA_TOKEN`, a fine-grained token with contents and pull requests
 * write, which pushes the commit to a scratch branch, opens the pull request that makes `ci.yml`
 * run normally, waits for the required check and merges.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TARGET_BRANCH = "master";
const PUBLISHED: Readonly<Record<string, true>> = {
  "assets/tag-counts.bin": true,
  "assets/tag-index.bin": true,
  "src/tags/core-vocabulary.ts": true,
  "dist/better-eh.user.js": true,
};
const FAILED_CONCLUSION: Readonly<Record<string, true>> = {
  FAILURE: true,
  CANCELLED: true,
  TIMED_OUT: true,
  ACTION_REQUIRED: true,
  STARTUP_FAILURE: true,
};
const FAILED_STATE: Readonly<Record<string, true>> = { FAILURE: true, ERROR: true };
// `unstable` is mergeable: every required check passed and something optional is red.
const MERGEABLE_STATUS: Readonly<Record<string, true>> = { CLEAN: true, UNSTABLE: true };

interface Options {
  branch: string;
  message: string;
}

interface Checks {
  mergeStateStatus: string;
  statusCheckRollup: readonly RollupEntry[];
}

interface RollupEntry {
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
}

interface PullRequest {
  number: number;
}

function redact(message: string): string {
  const token = process.env.TAG_DATA_TOKEN ?? "";
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

function openPullRequest(message: string, branch: string, auth: Record<string, string>): number {
  const listing = read(
    ["gh", "pr", "list", "--head", branch, "--state", "open", "--limit", "1", "--json", "number"],
    auth,
  );
  const open = (listing.trim() === "" ? [] : JSON.parse(listing)) as PullRequest[];
  const existing = open[0];
  if (existing !== undefined) {
    console.log(`publish-data: reusing pull request #${existing.number}`);
    return existing.number;
  }
  const url = read(
    [
      "gh",
      "pr",
      "create",
      "--base",
      TARGET_BRANCH,
      "--head",
      branch,
      "--title",
      message,
      "--body",
      "Scheduled tag data refresh. The bundle is rebuilt because it inlines the core counts.",
    ],
    auth,
  ).trim();
  const number = Number(url.split("/").pop());
  if (!Number.isInteger(number) || number <= 0) {
    fail(`could not read a pull request number from ${url}`);
  }
  console.log(`publish-data: opened pull request #${number}`);
  return number;
}

async function waitForCheck(number: number, auth: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = JSON.parse(
      read(
        ["gh", "pr", "view", String(number), "--json", "mergeStateStatus,statusCheckRollup"],
        auth,
      ),
    ) as Checks;
    const failed = state.statusCheckRollup.filter((check) => {
      const conclusion = check.conclusion ?? "";
      const status = check.state ?? "";
      return FAILED_CONCLUSION[conclusion] === true || FAILED_STATE[status] === true;
    });
    if (failed.length > 0) {
      const names = failed.map((check) => check.name ?? check.context ?? "check");
      fail(`pull request #${number} has failing checks: ${names.join(", ")}`);
    }
    if (MERGEABLE_STATUS[state.mergeStateStatus] === true) {
      return;
    }
    await Bun.sleep(10000);
  }
  fail(`pull request #${number} carried no green check within fifteen minutes`);
}

async function main(): Promise<void> {
  const { branch, message } = parseArgs(process.argv.slice(2));
  const token = process.env.TAG_DATA_TOKEN;
  if (token === undefined || token === "") {
    fail("TAG_DATA_TOKEN is required: GITHUB_TOKEN pushes and pull requests start no check run");
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
  const number = openPullRequest(message, branch, auth);
  await waitForCheck(number, auth);
  run(
    [
      "gh",
      "pr",
      "merge",
      String(number),
      "--squash",
      "--delete-branch",
      "--match-head-commit",
      sha,
    ],
    auth,
  );
  console.log(`publish-data: squashed pull request #${number} into ${TARGET_BRANCH}`);
}

await main();
