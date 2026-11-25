import type { Child } from "./dom";
import { el } from "./dom";

/**
 * One label/value pair, e.g. an archive's size or a torrent's seed count.
 *
 * The base classes live in `app.css`; a feature sheet adds only the layout that makes its rows
 * different. The value is wrapped so a link or a fallback notice keeps the same column.
 */
export function factRow(label: string, value: Child, className?: string): HTMLElement {
  return el(
    "div",
    { class: className === undefined ? "fact-row" : `fact-row ${className}` },
    el("span", { class: "fact-label", text: label }),
    el("span", { class: "fact-value" }, value),
  );
}
