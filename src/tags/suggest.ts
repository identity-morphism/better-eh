/**
 * Suggestion ranking for the tag search combobox.
 *
 * Matching runs over the compact in-memory index. A tag may contain spaces, while the search
 * grammar splits on whitespace, so the engine also tries the longest run of words that ends at the
 * caret: typing `big b` completes `big breasts` instead of offering every tag that starts with `b`.
 * Results are ranked by match quality (exact, prefix, word start, substring), gallery popularity,
 * namespace popularity, key length, and the user's own history.
 */

import type { TagCompletion, TagEntry, TagIndex, TagUsage } from "./db";
import { COMPLETION_HALF_LIFE_MS, COMPLETION_TTL_MS, completionId, tagId } from "./db";
import type { SearchTerm, TagNamespace, TagSign } from "./model";
import {
  fold,
  formatTagToken,
  parseSearchTerms,
  TAG_NAMESPACES,
  tagIdentity,
  termAt,
  termTagIdentity,
} from "./model";

const RECENT_LIMIT = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const POPULARITY_WEIGHT = 450;
const ALIAS_BOOST = 500;

type MatchKind = "exact" | "prefix" | "word" | "substring";

/**
 * High-confidence abbreviations that should work even before the popularity snapshot is available.
 * Language codes are the common case: typing `en` should complete `language:english`, not a
 * two-letter artist name.
 */
const LANGUAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ar: ["arabic"],
  bg: ["bulgarian"],
  cn: ["chinese"],
  cs: ["czech"],
  da: ["danish"],
  de: ["german"],
  el: ["greek"],
  en: ["english"],
  es: ["spanish"],
  et: ["estonian"],
  fa: ["persian"],
  fi: ["finnish"],
  fr: ["french"],
  he: ["hebrew"],
  hi: ["hindi"],
  hr: ["croatian"],
  hu: ["hungarian"],
  id: ["indonesian"],
  it: ["italian"],
  ja: ["japanese"],
  jp: ["japanese"],
  ko: ["korean"],
  kr: ["korean"],
  lt: ["lithuanian"],
  lv: ["latvian"],
  nl: ["dutch"],
  no: ["norwegian"],
  pl: ["polish"],
  pt: ["portuguese"],
  ro: ["romanian"],
  ru: ["russian"],
  sk: ["slovak"],
  sl: ["slovenian"],
  sr: ["serbian"],
  sv: ["swedish"],
  th: ["thai"],
  tr: ["turkish"],
  uk: ["ukrainian"],
  vi: ["vietnamese"],
  zh: ["chinese"],
};

/**
 * Gallery-common bookkeeping tags that users almost never search for. Their counts are real but
 * would otherwise put them above content tags for short prefixes (`re` -> `replaced`).
 */
const MAINTENANCE_TAGS: Readonly<Record<string, true>> = {
  "already uploaded": true,
  "extraneous ads": true,
  replaced: true,
};

interface TagSuggestion {
  readonly kind: "tag";
  readonly entry: TagEntry;
  readonly score: number;
  /** Offset of the matched query inside the folded tag key. */
  readonly matchStart: number;
  readonly matchLength: number;
  /** Set when the tag is already present elsewhere in the query. */
  readonly applied: SearchTerm | null;
  readonly recent: boolean;
}

interface NamespaceSuggestion {
  readonly kind: "namespace";
  readonly ns: TagNamespace;
  readonly score: number;
  /** Part of the term after `namespace:`; kept when completing a partially typed namespace. */
  readonly tail: string;
}

export type Suggestion = TagSuggestion | NamespaceSuggestion;

export interface SuggestResult {
  readonly term: SearchTerm;
  readonly items: readonly Suggestion[];
  /** Every matching tag, before the display limit. */
  readonly total: number;
  readonly empty: boolean;
}

function usageBoost(usage: ReadonlyMap<string, TagUsage>, entry: TagEntry, now: number): number {
  const use = usage.get(tagId(entry.ns.id, entry.key));
  if (!use) {
    return 0;
  }
  const age = Math.max(0, now - use.lastUsed) / DAY_MS;
  const recency = age < 1 ? 60 : age < 7 ? 40 : age < 30 ? 20 : 0;
  return Math.min(100, use.count * 10) + recency;
}

/**
 * A prefix-specific pick outweighs the popularity prior (450 at most), so choosing `enema` for `en`
 * sticks. The weight halves monthly and disappears after {@link COMPLETION_TTL_MS}.
 */
function completionBoost(
  completions: ReadonlyMap<string, TagCompletion>,
  entry: TagEntry,
  prefixNs: string,
  prefix: string,
  now: number,
): number {
  const remembered = completions.get(
    completionId({ prefixNs, prefix, ns: entry.ns.id, key: entry.key }),
  );
  if (!remembered) {
    return 0;
  }
  const age = Math.max(0, now - remembered.lastUsed);
  if (age >= COMPLETION_TTL_MS) {
    return 0;
  }
  const decay = Math.pow(0.5, age / COMPLETION_HALF_LIFE_MS);
  return (800 + Math.min(4, Math.max(0, remembered.count - 1)) * 100) * decay;
}

function scoreTag(
  entry: TagEntry,
  query: string,
  maxCount: number,
): { score: number; at: number } | null {
  const key = entry.folded;
  const at = key.indexOf(query);
  if (at < 0) {
    return null;
  }

  let score: number;
  let kind: MatchKind;
  if (key.length === query.length) {
    score = 1000;
    kind = "exact";
  } else if (at === 0) {
    score = 800;
    kind = "prefix";
  } else if (key[at - 1] === " ") {
    score = 500;
    kind = "word";
  } else if (query.length >= 2) {
    score = 260;
    kind = "substring";
  } else {
    return null;
  }

  score -= Math.min(at, 40) * 2;
  score -= Math.min(key.length, 100) * 0.8;
  score += entry.ns.weight * 2;

  const maintenance = entry.ns.id === "other" && Object.hasOwn(MAINTENANCE_TAGS, entry.folded);
  if (!maintenance && maxCount > 0 && entry.count > 0) {
    // Fill in partial matches less aggressively: a huge count must not turn a substring hit
    // (`en` inside `ai generated`) into a top suggestion.
    const factor = kind === "substring" ? 0.15 : kind === "word" ? 0.5 : 1;
    score += POPULARITY_WEIGHT * factor * (Math.log1p(entry.count) / Math.log1p(maxCount));
  }

  // Aliases are the offline fallback: when gallery counts are available they already rank the
  // common language tag, and applying both can over-promote codes that are common prefixes.
  if (maxCount === 0) {
    const aliases = Object.hasOwn(LANGUAGE_ALIASES, query) ? LANGUAGE_ALIASES[query] : undefined;
    if (aliases !== undefined && entry.ns.id === "language" && aliases.includes(entry.folded)) {
      score += ALIAS_BOOST;
    }
  }

  return { score, at };
}

function namespaceSuggestions(query: string, tail: string): NamespaceSuggestion[] {
  const matches =
    query === ""
      ? TAG_NAMESPACES
      : TAG_NAMESPACES.filter((ns) => ns.id.startsWith(query) || ns.alias.startsWith(query));
  return matches.map((ns) => ({
    kind: "namespace",
    ns,
    tail,
    score: 2000 + ns.weight,
  }));
}

function appliedTerms(terms: readonly SearchTerm[], phrase: SearchTerm): Map<string, SearchTerm> {
  const applied = new Map<string, SearchTerm>();
  for (const term of terms) {
    const id = termTagIdentity(term);
    if (id === null) {
      continue;
    }
    if (term.start >= phrase.start && term.end <= phrase.end) {
      continue;
    }
    if (!applied.has(id)) {
      applied.set(id, term);
    }
  }
  return applied;
}

/**
 * Resolve a saved usage id (`namespace\0rawKey`) without materialising the index's 45k-entry lookup
 * map. Namespace arrays are key-sorted, so a binary search finds a recent tag directly and an empty
 * query stays cheap when the user has a handful of recents. The lookup map remains a fallback for
 * an id the sorted arrays cannot resolve.
 */
function usageEntry(index: TagIndex, id: string): TagEntry | null {
  const separator = id.indexOf("\u0000");
  if (separator < 0) {
    return null;
  }
  const entries = index.byNamespace.get(id.slice(0, separator));
  if (entries === undefined) {
    return null;
  }
  const key = id.slice(separator + 1);
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle];
    if (entry === undefined) {
      break;
    }
    if (entry.key === key) {
      return entry;
    }
    if (entry.key < key) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return index.lookup.get(id) ?? null;
}

function recentEntries(
  index: TagIndex,
  usage: ReadonlyMap<string, TagUsage>,
  limit: number,
  now: number,
): TagEntry[] {
  return [...usage.entries()]
    .map(([id]) => {
      const entry = usageEntry(index, id);
      if (!entry) {
        return null;
      }
      return { entry, score: usageBoost(usage, entry, now) };
    })
    .filter((item): item is { entry: TagEntry; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

/** The ranking order shared by the full sort and the bounded shortlist. */
function compareRank(score: number, entry: TagEntry, otherScore: number, other: TagEntry): number {
  return (
    otherScore - score ||
    entry.key.length - other.key.length ||
    (entry.key < other.key ? -1 : entry.key > other.key ? 1 : 0) ||
    (entry.ns.id < other.ns.id ? -1 : 1)
  );
}

/** Insert into the score-ordered shortlist, dropping the worst entry past `limit`. */
function keepBestTag(items: TagSuggestion[], candidate: TagSuggestion, limit: number): void {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = items[middle];
    if (
      current !== undefined &&
      compareRank(candidate.score, candidate.entry, current.score, current.entry) < 0
    ) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  items.splice(low, 0, candidate);
  if (items.length > limit) {
    items.pop();
  }
}

function tagSuggestions(
  entries: readonly TagEntry[],
  query: string,
  applied: ReadonlyMap<string, SearchTerm>,
  usage: ReadonlyMap<string, TagUsage>,
  now: number,
  maxCount: number,
  prefixNs: string,
  completions: ReadonlyMap<string, TagCompletion>,
  limit: number,
): { items: TagSuggestion[]; total: number } {
  const items: TagSuggestion[] = [];
  let total = 0;
  // Empty maps are the common case (no picks yet); skip two id constructions per match then.
  const hasUsage = usage.size > 0;
  const hasCompletions = completions.size > 0;
  const hasApplied = applied.size > 0;

  for (const entry of entries) {
    const match = scoreTag(entry, query, maxCount);
    if (!match) {
      continue;
    }
    total++;
    if (limit <= 0) {
      continue;
    }
    const score =
      match.score +
      (hasUsage ? usageBoost(usage, entry, now) : 0) +
      (hasCompletions ? completionBoost(completions, entry, prefixNs, query, now) : 0);
    // Reject before building the suggestion: a match that cannot enter the shortlist must not
    // allocate its identity string or result object. Only the best `limit` can ever be displayed.
    const worst = items.length >= limit ? items[items.length - 1] : undefined;
    if (worst !== undefined && compareRank(score, entry, worst.score, worst.entry) >= 0) {
      continue;
    }
    keepBestTag(
      items,
      {
        kind: "tag",
        entry,
        score,
        matchStart: match.at,
        matchLength: query.length,
        // `entry.folded` is already `normaliseTagKey(entry.key)`, so the identity is a plain join;
        // rebuilding it through `tagIdentity` re-normalises every matching key on every keystroke.
        applied: hasApplied ? (applied.get(`${entry.ns.id}\u0000${entry.folded}`) ?? null) : null,
        recent: hasUsage && usage.has(tagId(entry.ns.id, entry.key)),
      },
      limit,
    );
  }

  return { items, total };
}

function tagItems(
  entries: readonly TagEntry[],
  applied: ReadonlyMap<string, SearchTerm>,
  usage: ReadonlyMap<string, TagUsage>,
): TagSuggestion[] {
  return entries.map((entry) => ({
    kind: "tag",
    entry,
    score: 0,
    matchStart: -1,
    matchLength: 0,
    applied: applied.get(tagIdentity(entry.ns, entry.key)) ?? null,
    recent: usage.has(tagId(entry.ns.id, entry.key)),
  }));
}

function searchPhrase(
  index: TagIndex,
  phrase: SearchTerm,
  terms: readonly SearchTerm[],
  usage: ReadonlyMap<string, TagUsage>,
  limit: number,
  now: number,
  completions: ReadonlyMap<string, TagCompletion>,
): SuggestResult {
  const applied = appliedTerms(terms, phrase);

  if (phrase.nsRaw !== null && phrase.ns === null) {
    const items = namespaceSuggestions(fold(phrase.nsRaw), phrase.value).slice(0, limit);
    return { term: phrase, items, total: items.length, empty: false };
  }

  if (phrase.ns !== null) {
    const namespace = phrase.ns;
    const entries = index.byNamespace.get(namespace.id) ?? [];
    const query = fold(phrase.value);

    if (query === "") {
      const recent = recentEntries(index, usage, RECENT_LIMIT, now).filter(
        (entry) => entry.ns.id === namespace.id,
      );
      const seen = new Set(recent.map((entry) => entry.key));
      const rest = entries
        .filter((entry) => !seen.has(entry.key))
        .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, Math.max(0, limit - recent.length));
      const items = tagItems([...recent, ...rest].slice(0, limit), applied, usage).map(
        (item, position) => ({
          ...item,
          recent: position < recent.length,
        }),
      );
      return { term: phrase, items, total: entries.length, empty: true };
    }

    const { items, total } = tagSuggestions(
      entries,
      query,
      applied,
      usage,
      now,
      index.maxCount,
      namespace.id,
      completions,
      limit,
    );
    return { term: phrase, items, total, empty: false };
  }

  const query = fold(phrase.value);
  if (query === "") {
    const recent = recentEntries(index, usage, RECENT_LIMIT, now);
    const tagItemsResult = tagItems(recent, applied, usage);
    const namespaces = namespaceSuggestions("", "");
    return {
      term: phrase,
      items: [...tagItemsResult, ...namespaces].slice(0, limit),
      total: tagItemsResult.length + namespaces.length,
      empty: true,
    };
  }

  const namespaces = namespaceSuggestions(query, "");
  const { items, total } = tagSuggestions(
    index.entries,
    query,
    applied,
    usage,
    now,
    index.maxCount,
    "",
    completions,
    limit,
  );
  return {
    term: phrase,
    items: [...namespaces, ...items].slice(0, limit),
    total: total + namespaces.length,
    empty: false,
  };
}

/**
 * Phrases that end at the caret, longest first. The active term is always last. Merging stops at a
 * namespace or sign on any word other than the first; a quoted or namespace-qualified active term
 * is self-contained.
 */
function phrases(text: string, terms: readonly SearchTerm[], active: SearchTerm): SearchTerm[] {
  const result: SearchTerm[] = [];
  const activeIndex = terms.findIndex(
    (term) => term.start === active.start && term.end === active.end,
  );
  const mergeable =
    activeIndex > 0 && active.value !== "" && active.ns === null && !active.quoted && !active.exact;

  if (mergeable) {
    for (let start = 0; start < activeIndex; start++) {
      const first = terms[start];
      if (!first || first.quoted || first.exact) {
        continue;
      }
      if (first.ns === null && first.value === "") {
        continue;
      }

      let valid = true;
      for (let position = start + 1; position < activeIndex; position++) {
        const part = terms[position];
        if (!part) {
          valid = false;
          break;
        }
        if (part.ns !== null || part.sign !== "" || part.quoted || part.exact) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        continue;
      }

      const value = terms
        .slice(start, activeIndex + 1)
        .map((part) => part.value)
        .filter((part) => part !== "")
        .join(" ");
      if (value === "") {
        continue;
      }

      const ns = first.ns;
      result.push({
        start: first.start,
        end: active.end,
        raw: text.slice(first.start, active.end),
        sign: active.sign || first.sign,
        nsRaw: ns === null ? null : ns.id,
        ns,
        value,
        quoted: false,
        exact: false,
      });
    }
  }

  result.push(active);
  return result;
}

/** Build the suggestion list for the phrase ending at the caret. */
export function buildSuggestions(
  index: TagIndex,
  text: string,
  caret: number,
  usage: ReadonlyMap<string, TagUsage> = new Map(),
  limit = 50,
  completions: ReadonlyMap<string, TagCompletion> = new Map(),
): SuggestResult {
  const now = Date.now();
  const terms = parseSearchTerms(text);
  const active = termAt(text, caret);
  let empty: SuggestResult | null = null;

  for (const phrase of phrases(text, terms, active)) {
    const result = searchPhrase(index, phrase, terms, usage, limit, now, completions);
    if (result.items.length > 0) {
      return result;
    }
    empty = result;
  }

  return empty ?? { term: active, items: [], total: 0, empty: active.value === "" };
}

/** The token a suggestion applies to the query. */
export function suggestionInsertion(suggestion: Suggestion, sign: TagSign): string {
  if (suggestion.kind === "namespace") {
    return `${sign}${suggestion.ns.alias}:${suggestion.tail}`;
  }
  return formatTagToken(suggestion.entry.ns.id, suggestion.entry.key, sign);
}

/** Resolve the effective sign for an insertion. */
export function effectiveSign(term: SearchTerm, exclude: boolean): TagSign {
  return exclude ? "-" : term.sign;
}
