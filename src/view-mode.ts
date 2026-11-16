import type { ReaderMode, ReadingDirection } from "./types";

/** Document-wide classes that describe which view is mounted. */
interface ViewMode {
  viewer: boolean;
  fitHeight: boolean;
  cursorHidden: boolean;
  readerMode: ReaderMode;
  readingDirection: ReadingDirection;
}

/**
 * Apply the body's view-mode classes in stylesheet order: `eh-viewer`, then `fit-h` or `fit-w`,
 * then the reader layout classes, with `no-cursor` left independent.
 *
 * The classes are toggled in sequence rather than rebuilt so unrelated body classes keep their
 * positions, and so the e2e gate sees the same order it did before this module existed.
 */
export function applyViewMode({
  viewer,
  fitHeight,
  cursorHidden,
  readerMode,
  readingDirection,
}: ViewMode): void {
  const { classList } = document.body;
  classList.toggle("eh-viewer", viewer);
  classList.toggle("fit-h", viewer && fitHeight);
  classList.toggle("fit-w", viewer && !fitHeight);
  classList.toggle("reader-spread", viewer && readerMode === "spread");
  classList.toggle("reader-continuous", viewer && readerMode === "continuous");
  classList.toggle("reader-rtl", viewer && readingDirection === "rtl");
  classList.toggle("no-cursor", cursorHidden);
}

/** Show or hide the pointer without touching the layout classes. */
export function setCursorHidden(hidden: boolean): void {
  document.body.classList.toggle("no-cursor", hidden);
}

/** Strip every view-mode class, leaving the body's base classes alone. */
export function resetViewMode(): void {
  document.body.classList.remove(
    "eh-viewer",
    "fit-h",
    "fit-w",
    "reader-spread",
    "reader-continuous",
    "reader-rtl",
    "no-cursor",
  );
}
