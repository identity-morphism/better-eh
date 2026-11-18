import { LoginRequiredError } from "../fetch/errors";
import { loader } from "../fetch/loader";
import { postForm } from "../net/http";
import { priorityOf } from "../net/priority";

export interface FavoriteFolder {
  slot: number;
  name: string;
  color: string;
}

const FOLDER_COLORS = [
  "#c8c8c8",
  "#ff7b7b",
  "#ffb057",
  "#ffe066",
  "#7ee787",
  "#b6f36b",
  "#63e6e2",
  "#8fa8ff",
  "#c792ea",
  "#ff8fd1",
];

/** Theme colour for one favorite slot; unknown slots use the neutral folder colour. */
export function folderColor(slot: number): string {
  return FOLDER_COLORS[slot] ?? "#c8c8c8";
}

const CACHE_TTL = 24 * 60 * 60 * 1000;
let folderCache: { memberId: string; folders: FavoriteFolder[]; at: number } | null = null;

/** Member id of the signed-in account, or null when the site has no session cookie. */
export function memberId(): string | null {
  return /(?:^|; )ipb_member_id=(\d+)/.exec(document.cookie)?.[1] ?? null;
}

export function isLoggedIn(): boolean {
  return memberId() !== null;
}

const LOGIN_WALL_TEXT = /sign in|log in|login/i;
const FAVORITES_TEXT = /favorites/i;

/**
 * The site answers a failed mutation with HTTP 200 and the login wall. A favorites page in the body
 * means the action itself ran.
 */
function assertSignedIn(text: string): void {
  if (LOGIN_WALL_TEXT.test(text) && !FAVORITES_TEXT.test(text)) {
    throw new LoginRequiredError();
  }
}

/** Fetch and cache favorite folder names for the signed-in account. */
export async function getFolders(signal?: AbortSignal): Promise<FavoriteFolder[]> {
  const account = memberId();
  if (account === null) {
    return [];
  }

  if (folderCache?.memberId === account && Date.now() - folderCache.at < CACHE_TTL) {
    return folderCache.folders;
  }

  const { doc } = await loader.document(`${location.origin}/uconfig.php`, {
    priority: priorityOf("background"),
    tag: "folders",
    signal,
  });

  const inputs = doc.querySelectorAll('input[name^="favorite_"]');
  if (inputs.length === 0) {
    throw new LoginRequiredError();
  }

  const names: string[] = [];
  for (let slot = 0; slot < 10; slot++) {
    const input = doc.querySelector<HTMLInputElement>(`input[name="favorite_${slot}"]`);
    names.push(input?.value.trim() ?? "");
  }

  const folders = names.map((name, slot) => ({
    slot,
    name: name || `Folder ${slot}`,
    color: folderColor(slot),
  }));

  folderCache = { memberId: account, folders, at: Date.now() };
  return folders;
}

/** Add the gallery to a folder, or remove it when slot is null. */
export async function setFavorite(
  gallery: { gid: string; token: string },
  slot: number | null,
  note = "",
): Promise<void> {
  if (!isLoggedIn()) {
    throw new LoginRequiredError();
  }

  const url = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(gallery.gid)}&t=${encodeURIComponent(gallery.token)}&act=addfav`;
  const body = new URLSearchParams({
    favcat: slot === null ? "favdel" : String(slot),
    favnote: note,
    ...(slot === null ? {} : { apply: "Add to Favorites" }),
    update: "1",
  });

  const response = await postForm(url, body, {
    tag: "favorite",
    failure: "Favorite request failed",
  });

  assertSignedIn(await response.text());
}

/**
 * Note saved with the gallery's favorite.
 *
 * The gallery page does not render the note, so it is read from the site's own add-favorite dialog.
 * Submitting a favorite without it would blank an existing note on a folder move.
 */
export async function getFavoriteNote(
  gallery: { gid: string; token: string },
  signal?: AbortSignal,
): Promise<string> {
  if (!isLoggedIn()) {
    return "";
  }
  const url = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(gallery.gid)}&t=${encodeURIComponent(gallery.token)}&act=addfav`;
  // Fresh every time: the dialog is the only place the note is visible, so a cached copy from
  // before a note edit would post the old text back and overwrite it.
  const { doc } = await loader.document(url, {
    priority: priorityOf("background"),
    tag: "favnote",
    signal,
    fresh: true,
  });
  return doc.querySelector<HTMLTextAreaElement>('textarea[name="favnote"]')?.value ?? "";
}

const FAVORITE_SLOTS = 10;

/**
 * Submit the favorites page bulk form.
 *
 * `ddact` carries the operation (`delete` or `fav<slot>`) and every selected gallery repeats under
 * `modifygids[]`, matching the page's own `#favform` submission.
 */
async function submitBulk(
  action: string,
  gids: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  if (gids.length === 0) {
    return;
  }

  const body = new URLSearchParams({ ddact: action, apply: "Confirm" });
  for (const gid of gids) {
    body.append("modifygids[]", gid);
  }

  const response = await postForm(`${location.origin}/favorites.php`, body, {
    tag: "favorite",
    failure: "Favorite update failed",
    signal,
  });

  assertSignedIn(await response.text());
}

/** Remove the given galleries from favorites. */
export async function deleteFavorites(
  gids: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  await submitBulk("delete", gids, signal);
}

/** Move the given galleries into one favorite folder. */
export async function moveFavorites(
  gids: readonly string[],
  slot: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= FAVORITE_SLOTS) {
    throw new RangeError(`Invalid favorite folder slot: ${slot}`);
  }
  await submitBulk(`fav${slot}`, gids, signal);
}
