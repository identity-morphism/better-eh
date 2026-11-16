import { parseGalleryPage } from "../../src/parse/gallery";
import type { GalleryData } from "../../src/types";
import type { ViewContext } from "../../src/views/context";
import { renderGallery } from "../../src/views/gallery";
import type { GalleryViewDeps } from "../../src/views/gallery";
import { loadFixture } from "../dom";
import { installDom, installNoopObservers, mountHost, viewContext } from "./dom";

/** The gallery URL every fixture is parsed against. */
export const GALLERY_URL = "https://e-hentai.org/g/123456/abcdef1234/";

export interface MountedGallery {
  document: Document;
  host: HTMLElement;
  data: GalleryData;
}

/**
 * Install the DOM and a fresh gallery host, then parse a fixture against {@link GALLERY_URL}.
 *
 * `prepare` runs on the parsed fixture document before the gallery parser sees it, so tests can add
 * the site elements (API credentials, tags, noted rows) their scenario needs.
 */
export async function mountGallery({
  fixture = "gallery.html",
  prepare,
}: {
  fixture?: string;
  prepare?: (doc: Document) => void;
} = {}): Promise<MountedGallery> {
  const document = installDom(GALLERY_URL);
  installNoopObservers();
  const source = await loadFixture(fixture);
  prepare?.(source);
  const data = parseGalleryPage(source, GALLERY_URL);
  const host = mountHost(document);
  return { document, host, data };
}

/** Render a mounted gallery with a context that goes nowhere. */
export function renderGalleryAt(
  host: HTMLElement,
  data: GalleryData,
  ctx: ViewContext = viewContext(),
  deps: GalleryViewDeps = {},
): void {
  renderGallery(host, data, ctx, deps);
}
