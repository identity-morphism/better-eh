/**
 * Post-publication preflight.
 *
 * Run after the repository is public and the release tag is pushed. Confirms the raw/jsDelivr
 * assets are reachable with a CORS wildcard and that the published userscript carries the local
 * version, which is also the URL Tampermonkey's update check reads. The Sleazy Fork listing is
 * compared too, but only as a warning: its source sync is not instantaneous.
 */

import { readHeaderVersion } from "./version.ts";

interface PackageJson {
  version: string;
}

const REPO = "identity-morphism/better-eh";
const ASSETS = ["assets/tag-index.bin", "assets/tag-counts.bin"] as const;
const USERSCRIPT = "dist/better-eh.user.js";
const RAW = `https://raw.githubusercontent.com/${REPO}/master`;
const CDN = `https://cdn.jsdelivr.net/gh/${REPO}@master`;
const LATEST = `https://github.com/${REPO}/releases/latest/download/better-eh.user.js`;
const SLEAZY_FORK = "https://sleazyfork.org/en/scripts/606064-better-eh/code.user.js";

function fail(message: string): never {
  console.error(`verify-release: ${message}`);
  process.exit(1);
}

async function checkAsset(url: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (response.status !== 200) {
    fail(`${url} returned HTTP ${response.status} (repository public and tag pushed?)`);
  }
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (allowOrigin !== "*") {
    fail(`${url} returned access-control-allow-origin: ${allowOrigin ?? "<missing>"}`);
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  console.log(`ok ${url} (${length > 0 ? `${length} bytes` : "200"}, CORS *)`);
}

/**
 * Compare the version the Sleazy Fork listing serves.
 *
 * The listing syncs from this repository's bundle, so a mismatch only means its next sync has not
 * run yet. Report it without failing the publication check.
 */
async function checkListing(): Promise<void> {
  try {
    const response = await fetch(SLEAZY_FORK, { redirect: "follow" });
    if (response.status !== 200) {
      console.warn(`warn ${SLEAZY_FORK} returned HTTP ${response.status}; listing unverified`);
      return;
    }
    const published = readHeaderVersion(await response.text());
    if (published === pkg.version) {
      console.log(`ok ${SLEAZY_FORK} (@version ${published})`);
      return;
    }
    console.warn(
      `warn ${SLEAZY_FORK} serves ${published ?? "<missing>"}, expected ${pkg.version}; ` +
        "the listing sync may not have run yet",
    );
  } catch (error) {
    console.warn(`warn could not check ${SLEAZY_FORK}: ${(error as Error).message}`);
  }
}

const pkg = (await Bun.file("./package.json").json()) as PackageJson;

for (const path of ASSETS) {
  await checkAsset(`${RAW}/${path}`);
  await checkAsset(`${CDN}/${path}`);
}

const userscript = await fetch(`${RAW}/${USERSCRIPT}`, { redirect: "follow" });
if (userscript.status !== 200) {
  fail(`${RAW}/${USERSCRIPT} returned HTTP ${userscript.status}`);
}
const published = readHeaderVersion(await userscript.text());
if (published !== pkg.version) {
  fail(`published @version ${published ?? "<missing>"} does not match package.json ${pkg.version}`);
}
console.log(`ok ${RAW}/${USERSCRIPT} (@version ${published})`);

const latest = await fetch(LATEST, { redirect: "follow" });
if (latest.status !== 200) {
  fail(`${LATEST} returned HTTP ${latest.status} (is the release published?)`);
}
const latestVersion = readHeaderVersion(await latest.text());
if (latestVersion !== pkg.version) {
  fail(`latest release asset is ${latestVersion ?? "<missing>"}, expected ${pkg.version}`);
}
console.log(`ok ${LATEST} (@version ${latestVersion})`);

await checkListing();

console.log("verify-release: all required publication checks passed");
