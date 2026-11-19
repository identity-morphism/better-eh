/**
 * Post-publication preflight.
 *
 * Run after the repository is public and the release tag is pushed. Confirms the raw/jsDelivr
 * assets are reachable with a CORS wildcard and that the published userscript carries the local
 * version, which is also the URL Tampermonkey's update check reads.
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
console.log("verify-release: all publication checks passed");
