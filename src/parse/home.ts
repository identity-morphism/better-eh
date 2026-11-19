import { anchorHref, cleanText } from "./helpers";

export interface HomeLink {
  label: string;
  href: string;
}

export interface HomeNavLink extends HomeLink {
  /** True for the subnav item naming the current page. */
  active: boolean;
}

export interface HomeFact {
  label: string;
  value: string;
}

/** One titled block of the account overview, as `.homebox` renders it. */
export interface HomeSection {
  title: string;
  paragraphs: readonly string[];
  facts: readonly HomeFact[];
  links: readonly HomeLink[];
  /** Submit label of the section's form; the view sends the action to the native page. */
  action: string | null;
}

export interface HomePage {
  url: string;
  nav: readonly HomeNavLink[];
  sections: readonly HomeSection[];
}

/** A cell that reads as a value rather than a label: "12.34 MiB", "0", "+1", "= 5.12". */
const VALUE = /^[=+-]?\s*[\d,.]+\s*(?:[A-Za-z%/]+)?$/u;

/**
 * One label/value row. The site alternates the order: tracker and GP rows put the value first,
 * moderation rows put the label first, so the cell shapes decide which way round it is.
 */
function fact(left: Element, right: Element): HomeFact | null {
  const first = cleanText(left.textContent);
  const second = cleanText(right.textContent);
  if (first === "" || second === "") {
    return null;
  }
  if (VALUE.test(first) && !VALUE.test(second)) {
    return { label: second, value: first };
  }
  return { label: first, value: second };
}

function factsOf(homebox: Element): HomeFact[] {
  const facts: HomeFact[] = [];

  // A div stack rather than a table row: the moderation total and its value.
  for (const label of homebox.querySelectorAll("div")) {
    if (cleanText(label.textContent) !== "Current Moderation Power") {
      continue;
    }
    const value = cleanText(label.nextElementSibling?.textContent);
    if (value !== "") {
      facts.push({ label: "Current", value });
    }
  }

  for (const row of homebox.querySelectorAll("tr")) {
    const cells = [...row.children].filter((cell) => cell.tagName === "TD");
    if (cells.length === 2) {
      const [left, right] = cells;
      const parsed = left !== undefined && right !== undefined ? fact(left, right) : null;
      if (parsed !== null) {
        facts.push(parsed);
      }
      continue;
    }
    // EHTracker packs three value/label pairs into one row.
    if (cells.length === 6) {
      for (let index = 0; index < cells.length; index += 2) {
        const left = cells[index];
        const right = cells[index + 1];
        const parsed = left !== undefined && right !== undefined ? fact(left, right) : null;
        if (parsed !== null) {
          facts.push(parsed);
        }
      }
    }
  }

  return facts;
}

function paragraphsOf(homebox: Element): string[] {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const node of homebox.querySelectorAll("p")) {
    const text = cleanText(node.textContent);
    if (text !== "" && !seen.has(text)) {
      seen.add(text);
      paragraphs.push(text);
    }
  }
  return paragraphs;
}

function linksOf(homebox: Element, url: string): HomeLink[] {
  const links: HomeLink[] = [];
  for (const anchor of homebox.querySelectorAll("a[href]")) {
    // Links inside a sentence stay part of that sentence; only standalone links become buttons.
    if (anchor.closest("p") !== null) {
      continue;
    }
    const href = anchorHref(anchor, url);
    const label = cleanText(anchor.textContent);
    if (href !== null && label !== "") {
      links.push({ label, href });
    }
  }
  return links;
}

function actionOf(homebox: Element): string | null {
  const submit = homebox.querySelector<HTMLInputElement>('input[type="submit"]');
  const label = cleanText(submit?.value);
  if (label !== "") {
    return label;
  }
  const button = cleanText(homebox.querySelector("button")?.textContent);
  return button === "" ? null : button;
}

function sectionOf(title: string, homebox: Element, url: string): HomeSection {
  const paragraphs = paragraphsOf(homebox);
  const facts = factsOf(homebox);
  const links = linksOf(homebox, url);
  if (paragraphs.length === 0 && facts.length === 0 && links.length === 0) {
    // The toplist box is one sentence in a table cell, with no row shape to pair.
    const text = cleanText(homebox.textContent);
    if (text !== "") {
      paragraphs.push(text);
    }
  }
  return { title, paragraphs, facts, links, action: actionOf(homebox) };
}

function navOf(doc: Document, url: string): HomeNavLink[] {
  const current = new URL(url);
  const links: HomeNavLink[] = [];
  for (const anchor of doc.querySelectorAll("#lb a[href]")) {
    const label = cleanText(anchor.textContent);
    const href = anchorHref(anchor, url);
    if (href === null || label === "") {
      continue;
    }
    const target = new URL(href);
    links.push({
      label,
      href,
      active: target.pathname === current.pathname && target.search === current.search,
    });
  }
  return links;
}

/** Parse `/home.php`: the account subnav plus every titled stats box. */
export function parseHome(doc: Document, url: string): HomePage {
  const root = doc.querySelector(".stuffbox");
  const sections: HomeSection[] = [];
  if (root !== null) {
    for (const heading of root.querySelectorAll("h2")) {
      const homebox = heading.nextElementSibling;
      if (!homebox?.classList.contains("homebox")) {
        continue;
      }
      const title = cleanText(heading.textContent);
      if (title !== "") {
        sections.push(sectionOf(title, homebox, url));
      }
    }
  }
  return { url, nav: navOf(doc, url), sections };
}
