import type { Child } from "./dom";
import { el } from "./dom";

interface ListHeaderOptions {
  title: string;
  /** One summary line or several badges. */
  summary: readonly Child[];
}

/** The shared heading row above every listing view. */
export function listHeader({ title, summary }: ListHeaderOptions): HTMLElement {
  return el(
    "div",
    { class: "list-header" },
    el("div", { class: "list-heading" }, el("h1", { text: title })),
    el("div", { class: "list-summary" }, ...summary),
  );
}
