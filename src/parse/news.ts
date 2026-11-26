import { anchorHref, cleanText } from "./helpers";

export interface NewsBlock {
  title: string;
  href: string | null;
  paragraphs: readonly string[];
}

export interface NewsEntry extends NewsBlock {
  date: string;
  commentsLabel: string | null;
  commentsHref: string | null;
}

export interface NewsPage {
  url: string;
  status: NewsBlock | null;
  changelog: NewsBlock | null;
  entries: readonly NewsEntry[];
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Block-level tags whose boundaries become paragraph breaks. */
const BLOCK_TAGS: Readonly<Record<string, true>> = {
  DIV: true,
  P: true,
  LI: true,
  UL: true,
  OL: true,
  TABLE: true,
  TR: true,
  TD: true,
  H1: true,
  H2: true,
  H3: true,
};

function collectText(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    // Source indentation is not a paragraph; only `<br>` and block tags split.
    return (node.textContent ?? "").replace(/\s+/gu, " ");
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return "";
  }
  const element = node as Element;
  if (element.tagName === "BR") {
    return "\n";
  }
  const text = [...element.childNodes].map(collectText).join("");
  return BLOCK_TAGS[element.tagName] === true ? `\n${text}\n` : text;
}

/** Text of one news body, one cleaned line per paragraph; links become their labels. */
export function newsParagraphs(node: Element | null): string[] {
  if (node === null) {
    return [];
  }
  return collectText(node)
    .split("\n")
    .map(cleanText)
    .filter((line) => line !== "");
}

function blockFrom(container: Element | null, base: string): NewsBlock | null {
  if (container === null) {
    return null;
  }
  const titleNode = container.querySelector("h2 a");
  const body = container.querySelector(".nwi");
  const title = cleanText(titleNode?.textContent);
  if (title === "" || body === null) {
    return null;
  }
  return {
    title,
    href: anchorHref(titleNode, base),
    paragraphs: newsParagraphs(body),
  };
}

function entryFrom(container: Element, base: string): NewsEntry | null {
  const titleNode = container.querySelector(".newstitle a");
  const title = cleanText(titleNode?.textContent);
  if (title === "") {
    return null;
  }
  const comments = container.querySelector(".newslink a");
  const commentsLabel = cleanText(comments?.textContent);
  return {
    title,
    href: anchorHref(titleNode, base),
    date: cleanText(container.querySelector(".newsdate")?.textContent),
    paragraphs: newsParagraphs(container.querySelector(".newstext")),
    commentsLabel: commentsLabel === "" ? null : commentsLabel,
    commentsHref: anchorHref(comments ?? null, base),
  };
}

/** Parse `/news.php`: the status/changelog column and the announcement list. */
export function parseNews(doc: Document, url: string): NewsPage {
  const columns = doc.querySelectorAll("#nt td.nd");
  const side = columns[0] ?? null;
  const sections = side === null ? [] : [...side.querySelectorAll(".nwo")];
  const entries = [...doc.querySelectorAll("#nt .newstable")]
    .map((node) => entryFrom(node, url))
    .filter((entry): entry is NewsEntry => entry !== null);

  return {
    url,
    status: blockFrom(sections[0] ?? null, url),
    changelog: blockFrom(sections[1] ?? null, url),
    entries,
  };
}
