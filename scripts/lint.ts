/**
 * `bun lint` through the pinned binary.
 *
 * Stable Bun has no `lint` subcommand, so `bun lint` falls back to the `lint` package script, which
 * calls this script again with another `--no-script` appended. That loop exits 0, so a mismatched
 * Bun turns the lint gate into a green no-op. The marker env turns the loop into one error.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PINNED = join(ROOT, "node_modules", ".bin", "bun");
const MARKER = "EH_BUN_LINT_ACTIVE";

if (process.env[MARKER] === "1") {
  console.error(
    `lint: ${PINNED} has no \`lint\` subcommand, so it resolved \`lint\` back to this script. ` +
      "The pin in package.json is a canary for exactly this reason; run `bun install` and retry.",
  );
  process.exit(1);
}

const result = Bun.spawnSync({
  cmd: [PINNED, "lint", "--no-script", ...process.argv.slice(2)],
  cwd: ROOT,
  env: { ...process.env, [MARKER]: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
