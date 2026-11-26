import { ParseMismatchError } from "../fetch/errors";
import type { GalleryData, ListPageData, PageData } from "../types";
import type { ArchivePage } from "./archive";
import type { FavoritesPage } from "./favorites";
import type { GalleryTorrentsPage } from "./gallery-torrents";
import { EMPTY_LIST, EMPTY_TORRENTS } from "./helpers";
import type { HomePage } from "./home";
import type { MyTagsPage } from "./my-tags";
import type { NewsPage } from "./news";
import type { ToplistPage } from "./toplist";
import type { TorrentPage } from "./torrents";
import type { UconfigSection } from "./uconfig";

/**
 * Post-parse checks for the owned views.
 *
 * Each view is written against one site layout. These checks reject a page whose markup no longer
 * produces the data the view needs, so the app can open the site's own page instead of rendering an
 * empty shell. A legitimate empty result set is not a mismatch.
 */

/** A viewer page must resolve the current page's image. */
export function assertViewerPage(data: PageData): void {
  if (data.imgSrc.trim() === "") {
    throw new ParseMismatchError("viewer", "the page image is missing");
  }
}

/** A gallery page must have page thumbnails and a parsed title. */
export function assertGalleryPage(data: GalleryData): void {
  if (data.thumbs.length === 0) {
    throw new ParseMismatchError("gallery", "the page thumbnails are missing");
  }
  if (data.title.primary.trim() === "") {
    throw new ParseMismatchError("gallery", "the gallery title is empty");
  }
}

/** A listing must carry the site's search chrome; an empty result set needs its notice. */
export function assertListPage(data: ListPageData, doc: Document): void {
  if (doc.querySelector(".searchtext, #searchbox, table.itg, .gl1t") === null) {
    throw new ParseMismatchError("list", "the search and results markup is missing");
  }
  if (data.items.length === 0 && !EMPTY_LIST.test(data.resultText ?? "")) {
    throw new ParseMismatchError("list", "there are no items and no empty-result notice");
  }
}

/** A news page must carry the news table and at least one section or entry. */
export function assertNewsPage(data: NewsPage, doc: Document): void {
  if (doc.querySelector("#nt") === null) {
    throw new ParseMismatchError("news", "the news table is missing");
  }
  if (data.status === null && data.changelog === null && data.entries.length === 0) {
    throw new ParseMismatchError("news", "there are no news sections or entries");
  }
}

/** A torrent index must carry the results table; an empty index needs its summary line. */
export function assertTorrentsPage(data: TorrentPage, doc: Document): void {
  if (doc.querySelector("table.itg") === null) {
    throw new ParseMismatchError("torrents", "the torrent table is missing");
  }
  if (data.rows.length > 0) {
    return;
  }
  // `parseTorrents` keeps only "Showing A - B of C" lines, so a plain notice is still on the page.
  const summary = data.summary ?? doc.querySelector("p.ip")?.textContent.trim() ?? "";
  if (!EMPTY_TORRENTS.test(summary)) {
    throw new ParseMismatchError("torrents", "there are no rows and no empty-result summary");
  }
}

/** The folder tab row is on every real favorites page, even when the active folder is empty. */
export function assertFavoritesPage(data: FavoritesPage): void {
  if (data.folders.length === 0) {
    throw new ParseMismatchError("favorites", "the favorite-folder tabs are missing");
  }
}

/** The overview lists sections; a category lists its ranked entries. */
export function assertToplistPage(data: ToplistPage): void {
  if (data.kind === "category") {
    if (data.entries.length === 0) {
      throw new ParseMismatchError("toplist", "the ranked entries are missing");
    }
    return;
  }
  if (data.sections.length === 0) {
    throw new ParseMismatchError("toplist", "the toplist sections are missing");
  }
}

/** The archive chooser always carries its container and at least one download form. */
export function assertArchivePage(data: ArchivePage, doc: Document): void {
  if (doc.getElementById("db") === null) {
    throw new ParseMismatchError("archive", "the archiver container is missing");
  }
  if (data.original === null && data.resample === null) {
    throw new ParseMismatchError("archive", "the archive download forms are missing");
  }
}

/** A settings page must resolve at least one section of the form. */
export function assertSettingsPage(data: readonly UconfigSection[]): void {
  if (data.length === 0) {
    throw new ParseMismatchError("settings", "the settings form is missing");
  }
}

/** My Home always carries the account boxes; the login wall and a changed layout do not. */
export function assertHomePage(data: HomePage, doc: Document): void {
  if (doc.querySelector(".stuffbox") === null) {
    throw new ParseMismatchError("home", "the account boxes are missing");
  }
  if (data.sections.length === 0) {
    throw new ParseMismatchError("home", "no account sections were parsed");
  }
}

/** The gallery torrent popup must carry its container; a gallery with no torrents needs a notice. */
export function assertGalleryTorrentsPage(data: GalleryTorrentsPage, doc: Document): void {
  const container = doc.getElementById("torrentinfo");
  if (container === null) {
    throw new ParseMismatchError("galleryTorrents", "the torrent container is missing");
  }
  if (data.torrents.length > 0) {
    return;
  }
  if (!EMPTY_TORRENTS.test(container.textContent)) {
    throw new ParseMismatchError("galleryTorrents", "there are no torrents and no empty notice");
  }
}

/** My Tags always renders its container; an empty tag list is a valid page. */
export function assertMyTagsPage(_data: MyTagsPage, doc: Document): void {
  if (doc.getElementById("usertags_outer") === null) {
    throw new ParseMismatchError("myTags", "the user-tag container is missing");
  }
}
