import type { KeyMap } from "./keymap-schema";
import type { ScalarSettings } from "./settings-schema";

export interface TitleMetadata {
  text: string;
  type: "artist" | "event" | "tag" | "parody" | "anthology" | "lang";
}

export interface ParsedTitle {
  leading: TitleMetadata[];
  primary: string;
  secondary: string | null;
  trailing: TitleMetadata[];
}

export interface PageData {
  viewerUrl: string;
  pageNum: number;
  counterText: string;
  galleryTitle: ParsedTitle;
  imgSrc: string;
  /** The site's "Download original" URL, when the viewer served a resized image. */
  originalHref: string | null;
  nextHref: string | null;
  prevHref: string | null;
  /** First and last pages of the gallery, as the native viewer's end arrows link them. */
  firstHref: string | null;
  lastHref: string | null;
  fileInfo: string;
  galleryHref: string;
  nlToken: string | null;
  /** Native "Get forum image link" page. */
  forumHref: string | null;
  /** Native "Show galleries with this image" search. */
  searchHref: string | null;
}

export interface TagRef {
  name: string;
  href: string;
  /** The site's editorial note after the tag's pipe, or null when the tag has none. */
  note: string | null;
}

export interface TagGroup {
  ns: string;
  tags: TagRef[];
}

export interface GalleryThumb {
  href: string;
  label: number;
  sprite: string;
  x: number;
  width: number;
  height: number;
  spriteCount: number;
}

/** One comment block from the gallery page. */
export interface GalleryComment {
  id: number;
  author: string;
  authorHref: string | null;
  posted: string;
  body: string;
  score: number | null;
  votes: string | null;
  uploader: boolean;
  /** The site rendered an Edit control, which it only does for the signed-in author. */
  editable: boolean;
}

/** Aggregate and per-user rating details. */
export interface GalleryRating {
  /** The gallery average, 0–5 stars. */
  average: number | null;
  votes: number | null;
  /**
   * The signed-in user's own rating in stars (0.5 steps), or null while they have not rated. The
   * site puts the average into `display_rating` until then, so only the rated class on
   * `#rating_image` tells the two apart.
   */
  user: number | null;
}

/** Native action links shown under the gallery metadata. */
export interface GalleryActions {
  archiverHref: string | null;
  torrentsHref: string | null;
  reportHref: string | null;
  expungeHref: string | null;
  renameHref: string | null;
}

/** Inline-script credentials the gallery API expects on every mutation. */
export interface GalleryApiConfig {
  apiUrl: string;
  apiUid: string;
  apiKey: string;
  gid: string;
  token: string;
}

/** One page's slice of the site's "Showing A - B of C" summary. */
export interface PageRange {
  start: number;
  end: number;
  total: number;
  /** Everything after the total, verbatim (e.g. " images"); empty when the line ends there. */
  suffix: string;
}

export interface GalleryData {
  url: string;
  gid: string;
  token: string;
  title: ParsedTitle;
  alternateTitle: string | null;
  category: { name: string; cls: string } | null;
  uploader: { name: string; href: string } | null;
  posted: string;
  parentHref: string | null;
  size: string;
  pageCount: number | null;
  favCount: number | null;
  rating: number | null;
  ratingCount: number | null;
  /** Favorite folder the gallery sits in, or null when it is not favorited. */
  favorite: FavoriteMark | null;
  tags: TagGroup[];
  thumbs: GalleryThumb[];
  coverSrc: string | null;
  /** Size `#gd1` declares for the cover; the cover box keeps this aspect instead of a fixed one. */
  coverSize: { width: number; height: number } | null;
  pageSummary: string;
  /** The same summary line parsed once; null when the page carries no recognizable range. */
  pageRange: PageRange | null;
  firstPageHref: string | null;
  prevHref: string | null;
  nextHref: string | null;
  comments: readonly GalleryComment[];
  /** Rating details beyond the legacy `rating`/`ratingCount` scalars. */
  ratingInfo: GalleryRating;
  actions: GalleryActions;
  /** The site's `Visible` metadata ("Yes"/"No"), or null when the row is absent. */
  visible: string | null;
  /** Null on pages without the inline API script (anonymous/older layouts). */
  apiConfig: GalleryApiConfig | null;
}

/** Favorite-folder mark the site paints on a result row's posted date. */
export interface FavoriteMark {
  /** Folder name the site prints in the mark's `title`. */
  folder: string;
  /** Favorite slot decoded from the mark's inline colour, or null when it is not a known slot. */
  slot: number | null;
}

export interface ListItem {
  href: string;
  gid: string;
  token: string;
  title: ParsedTitle;
  coverSrc: string | null;
  /** Size the site pins on the thumbnail, so the card keeps its aspect instead of cropping it. */
  coverSize: { width: number; height: number } | null;
  /** Average rating in half-star steps, or null when the site shows no stars. */
  rating: number | null;
  category: { name: string; cls: string } | null;
  uploader: string | null;
  /** Uploader profile link, when the row carries one. */
  uploaderHref: string | null;
  posted: string;
  pages: number | null;
  /** Torrent-search link the site shows on rows with torrents. */
  torrentsHref: string | null;
  /** Favorite folder mark, or null when the site showed none (signed out, or not favorited). */
  favorite: FavoriteMark | null;
}

export interface ListPageData {
  url: string;
  items: ListItem[];
  nextHref: string | null;
  prevHref: string | null;
  resultText: string | null;
}

/** Viewer layout: one page, a facing pair, or a vertical stack. */
export type ReaderMode = "single" | "spread" | "continuous";

/** Page order for spreads, click zones, and swipes. */
export type ReadingDirection = "ltr" | "rtl";

export interface UserSettings extends ScalarSettings {
  keymap: KeyMap;
}
