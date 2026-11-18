/**
 * Repository data assets: mirror hosts, fetch policy and refresh cadence.
 *
 * Both tag datasets are published as binary files in this repository rather than in the bundle, so
 * weekly data refreshes do not need a userscript release. Raw GitHub and jsDelivr both send CORS
 * headers, so plain `fetch` works without an `GM_xmlhttpRequest` grant.
 */

import { warn } from "../log";

/** How long a downloaded asset is trusted before a refresh is attempted. */
export const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a failed or completed refresh suppresses the next attempt. */
export const ASSET_RETRY_MS = 60 * 60 * 1000;

const DATA_REPO = "identity-morphism/better-eh";

/** The mirrors for one asset in `assets/`, in preference order. */
export function assetUrls(name: string): readonly [string, string] {
  return [
    `https://raw.githubusercontent.com/${DATA_REPO}/master/assets/${name}`,
    `https://cdn.jsdelivr.net/gh/${DATA_REPO}@master/assets/${name}`,
  ];
}

/** Both assets are a few hundred KB; anything past this is a bad mirror, not a slow download. */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Read a response body up to `limit` bytes, or null when it declares or delivers more. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get("content-length") ?? "0") > limit) {
    return null;
  }
  if (response.body === null) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let read = await reader.read();
  while (!read.done) {
    total += read.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
    read = await reader.read();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface AssetOptions {
  /** Sentence the per-mirror warnings start with, e.g. `"Tag count mirror"`. */
  label: string;
  /** Per-attempt deadline; omitted leaves the request unbounded. */
  timeoutMs?: number;
}

/**
 * Download one asset from the first mirror whose bytes decode.
 *
 * A mirror that answers with an HTTP error, invalid data or a network failure is logged and
 * skipped, so one blocked host cannot take the dataset down. Throws when every mirror fails.
 */
export async function fetchAsset<T>(
  urls: readonly string[],
  decode: (bytes: Uint8Array) => T | null,
  { label, timeoutMs }: AssetOptions,
): Promise<{ value: T; bytes: Uint8Array }> {
  for (const url of urls) {
    const controller = timeoutMs === undefined ? null : new AbortController();
    const timer = controller === null ? undefined : setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-cache",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/octet-stream" },
        ...(controller === null ? {} : { signal: controller.signal }),
      });
      if (!response.ok) {
        warn(`${label} returned ${response.status}`, url);
        continue;
      }
      const bytes = await readCapped(response, MAX_ASSET_BYTES);
      if (bytes === null) {
        warn(`${label} is larger than ${MAX_ASSET_BYTES} bytes`, url);
        continue;
      }
      const value = decode(bytes);
      if (value === null) {
        warn(`${label} returned invalid data`, url);
        continue;
      }
      return { value, bytes };
    } catch (error) {
      warn(`${label} failed`, url, error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Could not download ${label.toLowerCase()}`);
}
