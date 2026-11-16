import type { ParsedTitle, TitleMetadata } from "../types";
import { el } from "./dom";

function metaNode(meta: TitleMetadata): HTMLElement {
  const node = el("span", { class: `meta-item meta-${meta.type}` });

  if (meta.type !== "artist") {
    node.textContent = meta.text;
    return node;
  }

  const match = /^(.*?)\(([^)]+)\)(.*)$/.exec(meta.text);
  if (!match) {
    node.textContent = meta.text;
    return node;
  }

  node.append(match[1] ?? "", el("span", { text: `(${match[2]})` }), match[3] ?? "");
  return node;
}

/** Render a parsed gallery title with the viewer's metadata hierarchy. */
export function titleNodes(title: ParsedTitle): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // Spans, not divs: the same fragment feeds the gallery heading and the reader's <h1>.
  const leading = el("span", { class: "title-meta-wrap" });
  for (const meta of title.leading) {
    leading.append(metaNode(meta));
  }

  const main = el("span", { class: "title-main" });
  main.append(el("span", { class: "title-primary", text: title.primary }));
  if (title.secondary) {
    main.append(
      // Non-breaking spaces keep the pipe attached to both titles; a plain space let the
      // secondary title wrap onto a line that starts with "|".
      el("span", { class: "title-sep", text: "\u00A0|\u00A0" }),
      el("span", { class: "title-secondary", text: title.secondary }),
    );
  }

  const trailing = el("span", { class: "title-meta-wrap" });
  for (const meta of title.trailing) {
    trailing.append(metaNode(meta));
  }

  fragment.append(leading, main, trailing);
  return fragment;
}
