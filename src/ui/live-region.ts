/** Live-region helpers shared by the toast, banner and favorite-status surfaces. */

/**
 * Write `text` into a live region through `write`.
 *
 * Assistive tech ignores an update that leaves a region's text identical, so a repeated message is
 * blanked for one frame first; it also ignores a node inserted already carrying its text, which is
 * why the write callback never runs before the node is in the document.
 */
export function announceInto(
  node: HTMLElement,
  text: string,
  write: (value: string) => void,
): void {
  if (text !== "" && node.textContent === text) {
    write("");
    window.setTimeout(() => write(text), 16);
    return;
  }
  write(text);
}
