/**
 * Post-publication preflight.
 *
 * Run after the repository is public and the release tag is pushed. Confirms the raw/jsDelivr
 * assets are reachable with a CORS wildcard and that the published userscript carries the local
 * version, which is also the URL Tampermonkey's update check reads. The Sleazy Fork listing is
 * compared too, but only as a warning: its source sync is not instantaneous.
 */

import { join } from "node:path";

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

/** The one place the release preflight addresses its assets. */
export const RELEASE_URLS = { raw: RAW, cdn: CDN, latest: LATEST, sleazy: SLEAZY_FORK } as const;

/** A release check that could not confirm the published state. */
export class ReleaseCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCheckError";
  }
}

function require(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new ReleaseCheckError(message);
  }
}

async function checkAsset(
  fetchImpl: typeof fetch,
  url: string,
  log: (message: string) => void,
): Promise<void> {
  const response = await fetchImpl(url, { redirect: "follow" });
  require(response.status ===
    200, `${url} returned HTTP ${response.status} (repository public and tag pushed?)`);
  const allowOrigin = response.headers.get("access-control-allow-origin");
  require(allowOrigin ===
    "*", `${url} returned access-control-allow-origin: ${allowOrigin ?? "<missing>"}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  log(`ok ${url} (${length > 0 ? `${length} bytes` : "200"}, CORS *)`);
}

/**
 * Compare the version the Sleazy Fork listing serves.
 *
 * The listing syncs from this repository's bundle, so a mismatch only means its next sync has not
 * run yet. Report it without failing the publication check.
 */
async function checkListing(
  fetchImpl: typeof fetch,
  version: string,
  warn: (message: string) => void,
  log: (message: string) => void,
): Promise<void> {
  try {
    const response = await fetchImpl(SLEAZY_FORK, { redirect: "follow" });
    if (response.status !== 200) {
      warn(`warn ${SLEAZY_FORK} returned HTTP ${response.status}; listing unverified`);
      return;
    }
    const published = readHeaderVersion(await response.text());
    if (published === version) {
      log(`ok ${SLEAZY_FORK} (@version ${published})`);
      return;
    }
    warn(
      `warn ${SLEAZY_FORK} serves ${published ?? "<missing>"}, expected ${version}; ` +
        "the listing sync may not have run yet",
    );
  } catch (error) {
    warn(
      `warn could not check ${SLEAZY_FORK}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const pkg = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as PackageJson;

/**
 * Run the publication checks.
 *
 * Injectable so tests can drive the exact URL set and responses without the network.
 */
export async function verifyRelease(
  fetchImpl: typeof fetch = fetch,
  version: string = pkg.version,
  warn: (message: string) => void = console.warn,
  log: (message: string) => void = console.log,
): Promise<void> {
  for (const path of ASSETS) {
    await checkAsset(fetchImpl, `${RAW}/${path}`, log);
    await checkAsset(fetchImpl, `${CDN}/${path}`, log);
  }

  const userscript = await fetchImpl(`${RAW}/${USERSCRIPT}`, { redirect: "follow" });
  require(userscript.status === 200, `${RAW}/${USERSCRIPT} returned HTTP ${userscript.status}`);
  const published = readHeaderVersion(await userscript.text());
  require(published ===
    version, `published @version ${published ?? "<missing>"} does not match package.json ${version}`);
  log(`ok ${RAW}/${USERSCRIPT} (@version ${published})`);

  const latest = await fetchImpl(LATEST, { redirect: "follow" });
  require(latest.status ===
    200, `${LATEST} returned HTTP ${latest.status} (is the release published?)`);
  const latestVersion = readHeaderVersion(await latest.text());
  require(latestVersion ===
    version, `latest release asset is ${latestVersion ?? "<missing>"}, expected ${version}`);
  log(`ok ${LATEST} (@version ${latestVersion})`);

  await checkListing(fetchImpl, version, warn, log);
}

async function main(): Promise<void> {
  try {
    await verifyRelease();
    console.log("verify-release: all required publication checks passed");
  } catch (error) {
    console.error(`verify-release: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
