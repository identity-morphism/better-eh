/**
 * URL and gallery-identity helpers shared by the parsers and the router.
 *
 * This module imports nothing: the route table and every parser depend on it, so any import here
 * would close a cycle back through the views.
 */

/** Parse `value`, returning null instead of throwing on malformed input. */
export function safeUrl(value: string, base?: string | URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** A gallery address: `/g/<gid>/<hex token>/`. The router matches exactly this shape. */
export const GALLERY_PATH = /^\/g\/(\d+)\/([0-9a-f]+)\/?$/i;

/** The gallery id lead of a gallery link (`/g/<gid>/`), without validating the token. */
const GALLERY_ID_PATH = /^\/g\/(\d+)\//;

/** The gid and token that together name one gallery. */
export interface GalleryIdentity {
  gid: string;
  token: string;
}

/** Gallery id and token from an href or pathname, or null when it is not a gallery address. */
export function galleryIdentity(
  value: string | null | undefined,
  base?: string | URL,
): GalleryIdentity | null {
  const url = value === null || value === undefined ? null : safeUrl(value, base);
  const match = url === null ? null : GALLERY_PATH.exec(url.pathname);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { gid: match[1], token: match[2] };
}

/** In-app address of one gallery. */
export function galleryHref({ gid, token }: GalleryIdentity): string {
  return `/g/${gid}/${token}/`;
}

/** In-app torrent list for one gallery. */
export function galleryTorrentsHref({ gid, token }: GalleryIdentity): string {
  return `/gallerytorrents.php?gid=${gid}&t=${token}`;
}

/**
 * Gallery identity carried as query values, or null when either value is not gallery-shaped.
 *
 * The popups spell the token parameter differently (`token` on the archiver, `t` on the torrent
 * list), so the caller names both keys.
 */
export function queryGalleryIdentity(
  url: string,
  gidParam: string,
  tokenParam: string,
): GalleryIdentity | null {
  const parsed = safeUrl(url);
  const gid = parsed?.searchParams.get(gidParam) ?? "";
  const token = parsed?.searchParams.get(tokenParam) ?? "";
  return GALLERY_PATH.test(galleryHref({ gid, token })) ? { gid, token } : null;
}

/**
 * Gallery id from any gallery-shaped link.
 *
 * Parent links and torrent rows identify a gallery by id alone; their token need not be a full
 * gallery token, so only the `/g/<gid>/` lead is required.
 */
export function galleryGid(value: string | null | undefined, base?: string | URL): string | null {
  const url = value === null || value === undefined ? null : safeUrl(value, base);
  if (url === null) {
    return null;
  }
  return GALLERY_ID_PATH.exec(url.pathname)?.[1] ?? null;
}
