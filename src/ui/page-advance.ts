/**
 * The active endless-scroll region's next-page fetch.
 *
 * A history restore has to grow the document past whatever the region's chain cap allows, and the
 * region is created by a view that knows nothing about history. The region registers here while it
 * is mounted, so the restore can ask for one page at a time without holding a view reference.
 */

type Advance = () => Promise<boolean>;

let advance: Advance | null = null;

/** Register (or clear, with null) the mounted region's next-page fetch. */
export function setPageAdvance(next: Advance | null): void {
  advance = next;
}

/** Ask the mounted region for one more page; false when nothing can append. */
export function advancePage(): Promise<boolean> {
  return advance?.() ?? Promise.resolve(false);
}
