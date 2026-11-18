/**
 * Release size budget for the built userscript.
 *
 * CI runs this after `bun run build`. The raw limit keeps the bundle a sane size in the repository
 * and in reviews; the gzip limit tracks what a userscript manager actually downloads on install and
 * update. Both are hard ceilings: a breach fails the build with the measured sizes.
 */

import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUNDLE = join(import.meta.dir, "..", "dist", "better-eh.user.js");
const RAW_LIMIT_KIB = 680;
const GZIP_LIMIT_KIB = 165;
const KIB = 1024;

interface Measurement {
  label: "raw" | "gzip";
  bytes: number;
  limitBytes: number;
  limitKib: number;
}

function kib(bytes: number): string {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

const file = Bun.file(BUNDLE);
if (!(await file.exists())) {
  console.error(`bundle-size: ${BUNDLE} is missing; run \`bun run build\` first`);
  process.exit(1);
}

const source = new Uint8Array(await file.arrayBuffer());

const measurements: Measurement[] = [
  {
    label: "raw",
    bytes: source.byteLength,
    limitBytes: RAW_LIMIT_KIB * KIB,
    limitKib: RAW_LIMIT_KIB,
  },
  {
    label: "gzip",
    bytes: gzipSync(source).byteLength,
    limitBytes: GZIP_LIMIT_KIB * KIB,
    limitKib: GZIP_LIMIT_KIB,
  },
];

for (const measurement of measurements) {
  console.log(
    `bundle-size: ${measurement.label} ${measurement.bytes} bytes (${kib(measurement.bytes)}) ` +
      `of ${measurement.limitKib} KiB limit`,
  );
}

const breached = measurements.filter((measurement) => measurement.bytes > measurement.limitBytes);
if (breached.length > 0) {
  for (const measurement of breached) {
    const over = measurement.bytes - measurement.limitBytes;
    console.error(
      `bundle-size: ${measurement.label} exceeds the ${measurement.limitKib} KiB limit by ` +
        `${over} bytes (${kib(over)})`,
    );
  }
  process.exit(1);
}

console.log("bundle-size: within budget");
