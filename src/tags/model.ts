/**
 * Search-expression grammar for E-Hentai's `f_search` field.
 *
 * A query is a whitespace-separated list of terms. A term may carry a sign (`-` exclude, `~`
 * weak/OR), a namespace prefix (`female:`), and a quoted value (`"big breasts$"`). The trailing `$`
 * forces an exact tag match and is kept inside the quotes, matching the site's own tag links.
 */

import { collapseWhitespace } from "../strings";

export type TagSign = "" | "~" | "-";

/** Signs in menu order: included first, then excluded, then optional. */
export const TAG_SIGNS: readonly TagSign[] = Object.freeze(["", "-", "~"]);

/**
 * How one sign reads on every search surface: the chip's glyph and class, the word in its
 * accessible name, and the action-menu label that switches a term to it.
 *
 * The chip row and the gallery tag menu present the same three choices, so the wording lives here
 * once instead of drifting between the two call sites.
 */
export interface SignPresentation {
  readonly glyph: string;
  readonly state: string;
  readonly chipClass: string;
  readonly action: string;
}

export const SIGN_PRESENTATION: Readonly<Record<TagSign, SignPresentation>> = Object.freeze({
  "": { glyph: "+", state: "included", chipClass: "term-chip", action: "Include in search" },
  "-": {
    glyph: "−",
    state: "excluded",
    chipClass: "term-chip is-excluded",
    action: "Exclude from search",
  },
  "~": {
    glyph: "~",
    state: "optional",
    chipClass: "term-chip is-or",
    action: "Make optional (OR)",
  },
});

export interface TagNamespace {
  readonly id: string;
  readonly label: string;
  /** Short namespace accepted by the site (`f:` for `female:`). */
  readonly alias: string;
  /** Popularity proxy used to break ranking ties between equally good matches. */
  readonly weight: number;
}

/**
 * The namespaces the site exposes, in suggestion-display order. `rows` is metadata rather than a
 * tag namespace, so it is absent.
 */
export const TAG_NAMESPACES: readonly TagNamespace[] = Object.freeze([
  { id: "female", label: "Female", alias: "f", weight: 9 },
  { id: "male", label: "Male", alias: "m", weight: 8.5 },
  { id: "mixed", label: "Mixed", alias: "x", weight: 8 },
  { id: "other", label: "Other", alias: "o", weight: 7 },
  { id: "location", label: "Location", alias: "loc", weight: 6 },
  { id: "parody", label: "Parody", alias: "p", weight: 3.3 },
  { id: "character", label: "Character", alias: "c", weight: 2.8 },
  { id: "artist", label: "Artist", alias: "a", weight: 2.5 },
  { id: "cosplayer", label: "Cosplayer", alias: "cos", weight: 2.4 },
  { id: "group", label: "Group", alias: "g", weight: 2.2 },
  { id: "language", label: "Language", alias: "l", weight: 2 },
  { id: "reclass", label: "Reclass", alias: "r", weight: 1 },
]);

const NAMESPACE_BY_NAME = new Map<string, TagNamespace>();
for (const namespace of TAG_NAMESPACES) {
  NAMESPACE_BY_NAME.set(namespace.id, namespace);
  NAMESPACE_BY_NAME.set(namespace.alias, namespace);
}

/** Resolve a full namespace name or its short alias. */
export function tagNamespace(name: string): TagNamespace | null {
  return NAMESPACE_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Case- and accent-insensitive form used for all matching. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Normalize a raw tag key the same way for downloads, caches, and the compact asset. */
export function cleanTagKey(key: string): string {
  return collapseWhitespace(key.replace(/_/gu, " ")).toLowerCase();
}

/** Canonical matching form of a tag key: cleaned, accent-folded and lowercased. */
export function normaliseTagKey(key: string): string {
  return fold(cleanTagKey(key));
}

/**
 * Identity of a tag across namespace aliases, quoting, case, underscores, whitespace and accents.
 * `tagId` in `db.ts` remains the raw-key storage key for saved usage and completions.
 */
export function tagIdentity(ns: string | TagNamespace, key: string): string {
  const id = typeof ns === "string" ? (tagNamespace(ns)?.id ?? ns.trim().toLowerCase()) : ns.id;
  return `${id}\u0000${normaliseTagKey(key)}`;
}

export interface SearchTerm {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly sign: TagSign;
  readonly nsRaw: string | null;
  readonly ns: TagNamespace | null;
  readonly value: string;
  readonly quoted: boolean;
  readonly exact: boolean;
}

function blankTerm(position: number): SearchTerm {
  return {
    start: position,
    end: position,
    raw: "",
    sign: "",
    nsRaw: null,
    ns: null,
    value: "",
    quoted: false,
    exact: false,
  };
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

function readSign(text: string, index: number): { sign: TagSign; next: number } {
  const char = text[index];
  if (char === "-" || char === "~") {
    return { sign: char, next: index + 1 };
  }
  return { sign: "", next: index };
}

function readTerm(text: string, start: number): SearchTerm {
  let index = start;
  const { sign, next } = readSign(text, index);
  index = next;

  // A namespace prefix is everything before the first colon, but only when that colon appears
  // outside of the value's quotes.
  let prefixEnd = index;
  while (prefixEnd < text.length && !isSpace(text[prefixEnd]) && text[prefixEnd] !== '"') {
    prefixEnd++;
  }
  const colon = text.indexOf(":", index);
  const nsRaw = colon !== -1 && colon < prefixEnd ? text.slice(index, colon) : null;
  if (nsRaw !== null) {
    index = colon + 1;
  }

  let value: string;
  let quoted = false;
  let exact = false;

  if (text[index] === '"') {
    quoted = true;
    index++;
    const close = text.indexOf('"', index);
    const valueEnd = close === -1 ? text.length : close;
    value = text.slice(index, valueEnd);
    index = close === -1 ? text.length : close + 1;
    if (value.endsWith("$")) {
      value = value.slice(0, -1);
      exact = true;
    }
    if (text[index] === "$") {
      exact = true;
      index++;
    }
  } else {
    const valueStart = index;
    while (index < text.length && !isSpace(text[index])) {
      index++;
    }
    let valueEnd = index;
    if (valueEnd > valueStart && text[valueEnd - 1] === "$") {
      valueEnd--;
      exact = true;
    }
    value = text.slice(valueStart, valueEnd);
  }

  return {
    start,
    end: index,
    raw: text.slice(start, index),
    sign,
    nsRaw,
    ns: nsRaw === null ? null : tagNamespace(nsRaw),
    value,
    quoted,
    exact,
  };
}

/** Split a search string into terms, preserving source ranges for later edits. */
export function parseSearchTerms(text: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && isSpace(text[index])) {
      index++;
    }
    if (index >= text.length) {
      break;
    }
    const term = readTerm(text, index);
    terms.push(term);
    index = Math.max(term.end, index + 1);
  }

  return terms;
}

/** The term the caret is editing, or an empty term at the caret when it sits between terms. */
export function termAt(text: string, caret: number): SearchTerm {
  const position = Math.max(0, Math.min(caret, text.length));
  for (const term of parseSearchTerms(text)) {
    if (position >= term.start && position <= term.end) {
      return term;
    }
  }
  return blankTerm(position);
}

/** Whether a term looks like a tag the site will interpret as `namespace:tag`. */
export function isTagTerm(term: SearchTerm): boolean {
  return term.ns !== null && term.value.trim() !== "";
}

interface TextEdit {
  readonly text: string;
  readonly caret: number;
  /** Range replaced in the original text and the exact string inserted there. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * Replace a term with `replacement`, keeping the rest of the query intact.
 *
 * Inserting at an empty position adds a separating space on either side when needed. Tag insertions
 * at the end of the query get a trailing space so the next tag can be typed immediately; namespace
 * completions pass `keepOpen` to avoid closing the term the user is still composing.
 */
export function replaceTerm(
  text: string,
  term: SearchTerm,
  replacement: string,
  keepOpen = false,
): TextEdit {
  const empty = term.start === term.end;
  let insert = replacement;

  if (empty) {
    const before = text.slice(0, term.start);
    const after = text.slice(term.end);
    if (before !== "" && !isSpace(before[before.length - 1])) {
      insert = ` ${insert}`;
    }
    if (!keepOpen && after !== "" && !isSpace(after[0])) {
      insert = `${insert} `;
    }
    if (!keepOpen && after === "") {
      insert = `${insert} `;
    }
    const next = `${before}${insert}${after}`;
    return {
      text: next,
      caret: before.length + insert.length,
      from: term.start,
      to: term.end,
      insert,
    };
  }

  const after = text.slice(term.end);
  if (!keepOpen && after === "") {
    insert = `${insert} `;
  } else if (!keepOpen && !isSpace(after[0])) {
    insert = `${insert} `;
  }

  const next = `${text.slice(0, term.start)}${insert}${after}`;
  return {
    text: next,
    caret: term.start + insert.length,
    from: term.start,
    to: term.end,
    insert,
  };
}

/** Remove a term and collapse the whitespace it leaves behind. */
export function removeTerm(text: string, term: SearchTerm): string {
  const before = text.slice(0, term.start).replace(/\s+$/u, "");
  const after = text.slice(term.end).replace(/^\s+/u, "");
  if (before !== "" && after !== "") {
    return `${before} ${after}`;
  }
  return before === "" ? after : before;
}

/** Rewrite a term's sign without touching the rest of the query. */
export function setTermSign(text: string, term: SearchTerm, sign: TagSign): string {
  const body = term.raw.slice(term.sign.length);
  return `${text.slice(0, term.start)}${sign}${body}${text.slice(term.end)}`;
}

/** Serialize a tag with the site's exact-match syntax, preferring the short namespace alias. */
export function formatTagToken(ns: string, key: string, sign: TagSign = ""): string {
  const value = collapseWhitespace(key);
  const prefix = tagNamespace(ns)?.alias ?? ns;
  const body = /\s/u.test(value) ? `"${value}$"` : `${value}$`;
  return `${sign}${prefix}:${body}`;
}

/**
 * Add a tag to a search query, or change how an applied tag is applied.
 *
 * A tag that is not in the query is added. A tag already carrying the requested sign is removed;
 * the opposite sign flips it (included ↔ excluded). This is the gallery-tag behavior: build a query
 * from the current search instead of replacing it.
 */
export function toggleTagInSearch(
  text: string,
  token: string,
  sign: TagSign = "",
  removeIfPresent = true,
): string {
  const incoming = parseSearchTerms(token)[0];
  if (incoming === undefined) {
    return text;
  }
  const namespace = incoming.ns;
  if (namespace === null || incoming.value === "") {
    return text;
  }

  const wanted = tagIdentity(namespace, incoming.value);
  for (const term of parseSearchTerms(text)) {
    if (term.ns === null) {
      continue;
    }
    if (tagIdentity(term.ns, term.value) !== wanted) {
      continue;
    }
    // Compare the signs themselves: `~` and no sign are different states, and the menu's
    // "Make optional" must not read an included term as already optional.
    if (term.sign === sign) {
      return removeIfPresent ? removeTerm(text, term) : text;
    }
    return setTermSign(text, term, sign);
  }

  const formatted = formatTagToken(namespace.id, incoming.value, sign);
  const trimmed = text.trim();
  return trimmed === "" ? formatted : `${trimmed} ${formatted}`;
}

/** Human-readable label for a term chip. */
export function termLabel(term: SearchTerm): string {
  if (term.ns !== null && term.value !== "") {
    return term.value;
  }
  if (term.ns === null && term.nsRaw !== null) {
    return `${term.nsRaw}:${term.value}`;
  }
  return term.value || term.raw.slice(term.sign.length);
}

/** Identity of a term for expression matching: sign, quoting and exact markers do not matter. */
function expressionKey(term: SearchTerm): string {
  return term.ns === null
    ? `v\u0000${fold(term.value)}`
    : `t\u0000${tagIdentity(term.ns, term.value)}`;
}

function expressionTerms(expression: string): SearchTerm[] {
  return parseSearchTerms(expression).filter((term) => term.value !== "");
}

/** Whether every term of `expression` already appears in `text`. */
export function containsExpression(text: string, expression: string): boolean {
  const wanted = expressionTerms(expression);
  if (wanted.length === 0) {
    return false;
  }
  const present = new Set(parseSearchTerms(text).map(expressionKey));
  return wanted.every((term) => present.has(expressionKey(term)));
}

/**
 * Add a whole quick-tag expression to a search, or remove it when all of its terms are present.
 *
 * A quick tag may combine several tags (`~f:lolicon$ ~f:"small breasts$"`), so each term is added
 * only when missing and every matching term is removed on the second click, matching the reference
 * script's button behavior.
 */
export function toggleExpressionInSearch(text: string, expression: string): string {
  const terms = expressionTerms(expression);
  if (terms.length === 0) {
    return text;
  }
  if (containsExpression(text, expression)) {
    let next = text;
    for (const term of terms) {
      const key = expressionKey(term);
      const located = parseSearchTerms(next).find((candidate) => expressionKey(candidate) === key);
      if (located !== undefined) {
        next = removeTerm(next, located);
      }
    }
    return next;
  }
  const present = new Set(parseSearchTerms(text).map(expressionKey));
  const missing = terms.filter((term) => !present.has(expressionKey(term)));
  const suffix = missing.map((term) => term.raw).join(" ");
  const trimmed = text.trim();
  return trimmed === "" ? suffix : `${trimmed} ${suffix}`;
}
