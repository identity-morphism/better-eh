/**
 * Line-coverage floor for `src/`.
 *
 * Runs the fixture suite with an lcov report, keeps the `src/` records, and fails when the whole
 * tree drops below {@link FLOOR}. CI runs this instead of the bare suite, so a change that adds
 * untested behaviour has to either cover it or lower the floor on purpose.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const COVERAGE_DIR = join(ROOT, ".cache", "coverage");
const FLOOR = 0.87;

interface Totals {
  found: number;
  hit: number;
}

function totals(lcov: string): Totals {
  const result: Totals = { found: 0, hit: 0 };
  for (const record of lcov.split("end_of_record")) {
    const path = /^SF:(.+)$/m.exec(record)?.[1]?.trim();
    if (!path?.startsWith("src/")) {
      continue;
    }
    result.found += Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
    result.hit += Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
  }
  return result;
}

rmSync(COVERAGE_DIR, { recursive: true, force: true });
mkdirSync(COVERAGE_DIR, { recursive: true });

const run = Bun.spawnSync({
  cmd: [
    process.execPath,
    "test",
    "--isolate",
    "--coverage-reporter=lcov",
    `--coverage-dir=${COVERAGE_DIR}`,
  ],
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
if (run.exitCode !== 0) {
  console.error("coverage: the test suite failed, so there is no report to judge");
  process.exit(1);
}

const { found, hit } = totals(await Bun.file(join(COVERAGE_DIR, "lcov.info")).text());
if (found === 0) {
  console.error("coverage: the report holds no src/ records");
  process.exit(1);
}

const ratio = hit / found;
const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
console.log(`coverage: src/ ${percent(ratio)} lines (${hit}/${found}), floor ${percent(FLOOR)}`);

if (ratio < FLOOR) {
  console.error(
    `coverage: ${percent(ratio)} is below the ${percent(FLOOR)} floor. Cover the new paths, or ` +
      "lower FLOOR in scripts/check-coverage.ts and say why in the pull request. " +
      "Run `bun test --coverage` for the per-file table.",
  );
  process.exit(1);
}
