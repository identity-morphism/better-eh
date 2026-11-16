// ==UserScript==
// @name         Better EH
// @namespace    https://github.com/identity-morphism/better-eh
// @version      1.0.1
// @description  A userscript that reskins E-Hentai and ExHentai into one consistent, image-first interface: galleries, listings, favorites, toplists, torrents and the reader, with tag autocomplete, previews and prefetching.
// @author       identity-morphism
// @icon         https://api.iconify.design/ph/book-open-bold.svg
// @updateURL    https://raw.githubusercontent.com/identity-morphism/better-eh/master/dist/better-eh.user.js
// @downloadURL  https://raw.githubusercontent.com/identity-morphism/better-eh/master/dist/better-eh.user.js
// @match        https://e-hentai.org/*
// @match        https://exhentai.org/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  // src/guards.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isUnknownArray(value) {
    return Array.isArray(value);
  }

  // src/tags/model.ts
  var TAG_NAMESPACES = Object.freeze([
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
    { id: "reclass", label: "Reclass", alias: "r", weight: 1 }
  ]);
  var NAMESPACE_BY_NAME = new Map;
  for (const namespace of TAG_NAMESPACES) {
    NAMESPACE_BY_NAME.set(namespace.id, namespace);
    NAMESPACE_BY_NAME.set(namespace.alias, namespace);
  }
  function tagNamespace(name) {
    return NAMESPACE_BY_NAME.get(name.trim().toLowerCase()) ?? null;
  }
  function fold(text) {
    return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
  }
  function cleanTagKey(key) {
    return key.replace(/_/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase();
  }
  function normaliseTagKey(key) {
    return fold(cleanTagKey(key));
  }
  function tagIdentity(ns, key) {
    const id = typeof ns === "string" ? tagNamespace(ns)?.id ?? ns.trim().toLowerCase() : ns.id;
    return `${id}\x00${normaliseTagKey(key)}`;
  }
  function blankTerm(position) {
    return {
      start: position,
      end: position,
      raw: "",
      sign: "",
      nsRaw: null,
      ns: null,
      value: "",
      quoted: false,
      exact: false
    };
  }
  function isSpace(char) {
    return char !== undefined && /\s/u.test(char);
  }
  function readSign(text, index) {
    const char = text[index];
    if (char === "-" || char === "~") {
      return { sign: char, next: index + 1 };
    }
    return { sign: "", next: index };
  }
  function readTerm(text, start) {
    let index = start;
    const { sign, next } = readSign(text, index);
    index = next;
    let prefixEnd = index;
    while (prefixEnd < text.length && !isSpace(text[prefixEnd]) && text[prefixEnd] !== '"') {
      prefixEnd++;
    }
    const colon = text.indexOf(":", index);
    const nsRaw = colon !== -1 && colon < prefixEnd ? text.slice(index, colon) : null;
    if (nsRaw !== null) {
      index = colon + 1;
    }
    let value;
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
      exact
    };
  }
  function parseSearchTerms(text) {
    const terms = [];
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
  function termAt(text, caret) {
    const position = Math.max(0, Math.min(caret, text.length));
    for (const term of parseSearchTerms(text)) {
      if (position >= term.start && position <= term.end) {
        return term;
      }
    }
    return blankTerm(position);
  }
  function isTagTerm(term) {
    return term.ns !== null && term.value.trim() !== "";
  }
  function replaceTerm(text, term, replacement, keepOpen = false) {
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
        insert
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
      insert
    };
  }
  function removeTerm(text, term) {
    const before = text.slice(0, term.start).replace(/\s+$/u, "");
    const after = text.slice(term.end).replace(/^\s+/u, "");
    if (before !== "" && after !== "") {
      return `${before} ${after}`;
    }
    return before === "" ? after : before;
  }
  function setTermSign(text, term, sign) {
    const body = term.raw.slice(term.sign.length);
    return `${text.slice(0, term.start)}${sign}${body}${text.slice(term.end)}`;
  }
  function formatTagToken(ns, key, sign = "") {
    const value = key.trim().replace(/\s+/gu, " ");
    const prefix = tagNamespace(ns)?.alias ?? ns;
    const body = /\s/u.test(value) ? `"${value}$"` : `${value}$`;
    return `${sign}${prefix}:${body}`;
  }
  function toggleTagInSearch(text, token, sign = "", removeIfPresent = true) {
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
      if (term.sign === "-" === (sign === "-")) {
        return removeIfPresent ? removeTerm(text, term) : text;
      }
      return setTermSign(text, term, sign);
    }
    const formatted = formatTagToken(namespace.id, incoming.value, sign);
    const trimmed = text.trim();
    return trimmed === "" ? formatted : `${trimmed} ${formatted}`;
  }
  function termLabel(term) {
    if (term.ns !== null && term.value !== "") {
      return term.value;
    }
    if (term.ns === null && term.nsRaw !== null) {
      return `${term.nsRaw}:${term.value}`;
    }
    return term.value || term.raw.slice(term.sign.length);
  }
  function expressionKey(term) {
    return term.ns === null ? `v\x00${fold(term.value)}` : `t\x00${tagIdentity(term.ns, term.value)}`;
  }
  function expressionTerms(expression) {
    return parseSearchTerms(expression).filter((term) => term.value !== "");
  }
  function containsExpression(text, expression) {
    const wanted = expressionTerms(expression);
    if (wanted.length === 0) {
      return false;
    }
    const present = new Set(parseSearchTerms(text).map(expressionKey));
    return wanted.every((term) => present.has(expressionKey(term)));
  }
  function toggleExpressionInSearch(text, expression) {
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

  // src/parse/url.ts
  function safeUrl(value, base) {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }
  var GALLERY_PATH = /^\/g\/(\d+)\/([0-9a-f]+)\/?$/i;
  var GALLERY_ID_PATH = /^\/g\/(\d+)\//;
  function galleryIdentity(value, base) {
    const url = value === null || value === undefined ? null : safeUrl(value, base);
    const match = url === null ? null : GALLERY_PATH.exec(url.pathname);
    if (!match?.[1] || !match[2]) {
      return null;
    }
    return { gid: match[1], token: match[2] };
  }
  function galleryGid(value, base) {
    const url = value === null || value === undefined ? null : safeUrl(value, base);
    if (url === null) {
      return null;
    }
    return GALLERY_ID_PATH.exec(url.pathname)?.[1] ?? null;
  }

  // src/parse/query.ts
  var CATEGORIES = [
    { bit: 2, name: "Doujinshi", cls: "ct2" },
    { bit: 4, name: "Manga", cls: "ct3" },
    { bit: 8, name: "Artist CG", cls: "ct4" },
    { bit: 16, name: "Game CG", cls: "ct5" },
    { bit: 512, name: "Western", cls: "cta" },
    { bit: 256, name: "Non-H", cls: "ct9" },
    { bit: 32, name: "Image Set", cls: "ct6" },
    { bit: 64, name: "Cosplay", cls: "ct7" },
    { bit: 128, name: "Asian Porn", cls: "ct8" },
    { bit: 1, name: "Misc", cls: "ct1" }
  ];
  function singleCategoryName(cats) {
    const enabled = CATEGORIES.filter((category) => (cats & category.bit) === 0);
    return enabled.length === 1 ? enabled[0]?.name ?? null : null;
  }
  function emptySearchFilters() {
    return {
      cats: 0,
      rating: 0,
      expunged: false,
      torrent: false,
      pageFrom: "",
      pageTo: "",
      disableLanguage: false,
      disableUploader: false,
      disableTags: false
    };
  }
  function emptySearchQuery() {
    return { text: "", ...emptySearchFilters() };
  }
  function parseSearchQuery(url) {
    const params = url.searchParams;
    return {
      text: params.get("f_search") ?? "",
      cats: Number.parseInt(params.get("f_cats") ?? "0", 10) || 0,
      rating: Number.parseInt(params.get("f_srdd") ?? "0", 10) || 0,
      expunged: params.has("f_sh"),
      torrent: params.has("f_sto"),
      pageFrom: params.get("f_spf") ?? "",
      pageTo: params.get("f_spt") ?? "",
      disableLanguage: params.has("f_sfl"),
      disableUploader: params.has("f_sfu"),
      disableTags: params.has("f_sft")
    };
  }
  function hasAdvancedFilters(query) {
    return query.rating > 0 || query.expunged || query.torrent || query.pageFrom.trim() !== "" || query.pageTo.trim() !== "" || query.disableLanguage || query.disableUploader || query.disableTags;
  }
  function writeSearchFilters(params, query) {
    if (query.cats !== 0) {
      params.set("f_cats", String(query.cats));
    }
    if (query.rating > 0) {
      params.set("f_srdd", String(query.rating));
    }
    if (query.expunged) {
      params.set("f_sh", "on");
    }
    if (query.torrent) {
      params.set("f_sto", "on");
    }
    const pageFrom = query.pageFrom.trim();
    if (pageFrom) {
      params.set("f_spf", pageFrom);
    }
    const pageTo = query.pageTo.trim();
    if (pageTo) {
      params.set("f_spt", pageTo);
    }
    if (query.disableLanguage) {
      params.set("f_sfl", "on");
    }
    if (query.disableUploader) {
      params.set("f_sfu", "on");
    }
    if (query.disableTags) {
      params.set("f_sft", "on");
    }
    if (hasAdvancedFilters(query)) {
      params.set("advsearch", "1");
    }
  }
  function buildSearchUrl(query) {
    const params = new URLSearchParams;
    const text = query.text.trim();
    if (text) {
      params.set("f_search", text);
    }
    writeSearchFilters(params, query);
    const search = params.toString();
    return search ? `/?${search}` : "/";
  }
  function categoryFromClass(cls) {
    if (!cls) {
      return null;
    }
    return CATEGORIES.find((category) => category.cls === cls) ?? null;
  }
  function tagTokenFromHref(href, base) {
    const url = safeUrl(href, base);
    return url ? tagTokenFromUrl(url) : null;
  }
  function uploaderTokenFromHref(href, base) {
    const url = safeUrl(href, base);
    return url ? uploaderTokenFromUrl(url) : null;
  }
  function tagTokenFromUrl(url) {
    const match = /^\/tag\/([^:]+):(.+)$/.exec(url.pathname);
    if (!match) {
      return null;
    }
    const namespace = match[1] ?? "";
    let value;
    try {
      value = decodeURIComponent((match[2] ?? "").replace(/\+/g, " ")).trim();
    } catch {
      return null;
    }
    if (!value) {
      return null;
    }
    return formatTagToken(namespace, value);
  }
  function uploaderTokenFromUrl(url) {
    const match = /^\/uploader\/([^/]+)\/?$/.exec(url.pathname);
    if (!match?.[1]) {
      return null;
    }
    let name;
    try {
      name = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
    } catch {
      return null;
    }
    if (!name) {
      return null;
    }
    return formatTagToken("uploader", name);
  }

  // src/routes/identity.ts
  var VIEWER_PATH = /^\/s\/[^/]+\/\d+-\d+\/?$/;
  var UPLOADER_PATH = /^\/uploader\/[^/]+\/?$/;
  var LIST_PATHS = {
    "/": 0,
    "/doujinshi": 2,
    "/manga": 4,
    "/artistcg": 8,
    "/gamecg": 16,
    "/western": 512,
    "/non-h": 256,
    "/imageset": 32,
    "/cosplay": 64,
    "/asianporn": 128,
    "/misc": 1
  };
  var ALL_CATEGORY_BITS = CATEGORIES.reduce((bits, category) => bits | category.bit, 0);
  function categoryPathBit(pathname) {
    return LIST_PATHS[pathname] ?? null;
  }
  var SCOPE_PATHS = {
    "/popular": "popular",
    "/watched": "watched"
  };
  function nativeUrl(href = location.href) {
    const url = new URL(href);
    url.searchParams.set("eh_native", "1");
    return url.href;
  }

  // src/store.ts
  function isEnvelope(value) {
    if (!isRecord(value)) {
      return false;
    }
    return typeof value.version === "number" && "values" in value;
  }
  function createStore(options, adapter) {
    const { key, version, empty, guard } = options;
    return {
      read() {
        try {
          const stored = adapter.read(key);
          if (isEnvelope(stored)) {
            return stored.version === version && guard(stored.values) ? stored.values : empty();
          }
          return guard(stored) ? stored : empty();
        } catch {
          return empty();
        }
      },
      write(value) {
        try {
          adapter.write(key, { version, values: value });
        } catch {}
      }
    };
  }
  function gmStorage() {
    const globals = globalThis;
    return {
      read(key) {
        try {
          return globals.GM_getValue?.(key, undefined);
        } catch {
          return;
        }
      },
      write(key, value) {
        try {
          globals.GM_setValue?.(key, value);
        } catch {}
      },
      remove(key) {
        try {
          if (globals.GM_deleteValue) {
            globals.GM_deleteValue(key);
            return;
          }
          globals.GM_setValue?.(key, null);
        } catch {}
      }
    };
  }
  function decodeWebStorage(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  function sessionStorageAdapter() {
    const storage = () => {
      try {
        return typeof globalThis.sessionStorage === "undefined" ? undefined : globalThis.sessionStorage;
      } catch {
        return;
      }
    };
    return {
      read(key) {
        try {
          const raw = storage()?.getItem(key) ?? null;
          return raw === null ? undefined : decodeWebStorage(raw);
        } catch {
          return;
        }
      },
      write(key, value) {
        try {
          storage()?.setItem(key, JSON.stringify(value));
        } catch {}
      },
      remove(key) {
        try {
          storage()?.removeItem(key);
        } catch {}
      }
    };
  }

  // src/data/list-filters.ts
  var KEY = "eh:list-filters:v1";
  var PANEL_KEY = "eh:list-filters-open:v1";
  var VERSION = 1;
  var FILTER_PARAMS = [
    "f_cats",
    "f_srdd",
    "f_sh",
    "f_sto",
    "f_spf",
    "f_spt",
    "f_sfl",
    "f_sfu",
    "f_sft"
  ];
  function isStoredFilters(value) {
    return isRecord(value);
  }
  var filters = createStore({ key: KEY, version: VERSION, empty: () => ({}), guard: isStoredFilters }, gmStorage());
  var panel = createStore({
    key: PANEL_KEY,
    version: VERSION,
    empty: () => false,
    guard: (value) => typeof value === "boolean"
  }, gmStorage());
  function getListFilters() {
    return { ...emptySearchFilters(), ...filters.read() };
  }
  function saveListFilters(query) {
    filters.write({ ...emptySearchFilters(), ...query });
  }
  function isListPanelOpen() {
    return panel.read();
  }
  function setListPanelOpen(open) {
    panel.write(open);
  }
  function hasFilters(prefs) {
    const params = new URLSearchParams;
    writeSearchFilters(params, prefs);
    return params.toString() !== "";
  }
  function applyPersistedListFilters(route) {
    if (route.kind !== "list" || route.scope !== "search" && route.scope !== "uploader") {
      return route;
    }
    const url = new URL(route.url);
    const pathBit = categoryPathBit(url.pathname);
    if (pathBit !== null && pathBit !== 0) {
      return route;
    }
    if (FILTER_PARAMS.some((name) => url.searchParams.has(name))) {
      return route;
    }
    const prefs = getListFilters();
    if (!hasFilters(prefs)) {
      return route;
    }
    writeSearchFilters(url.searchParams, prefs);
    return {
      ...route,
      url: url.href,
      query: { ...parseSearchQuery(url), text: route.query.text }
    };
  }

  // src/fetch/errors.ts
  function isAbortError(error) {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
  }

  class HttpError extends Error {
    status;
    url;
    constructor(status, url) {
      super(`HTTP ${status}`);
      this.name = "HttpError";
      this.status = status;
      this.url = url;
    }
  }

  class LoginRequiredError extends Error {
    constructor() {
      super("Login required");
      this.name = "LoginRequiredError";
    }
  }

  class RateLimitedError extends Error {
    text;
    constructor(text) {
      super("Rate limited");
      this.name = "RateLimitedError";
      this.text = text;
    }
  }

  class RequestPurgedError extends Error {
    constructor() {
      super("Request purged");
      this.name = "RequestPurgedError";
    }
  }

  // src/keymap-schema.ts
  var KEY_ACTIONS = [
    { action: "next", label: "Next page", defaults: ["D", "ARROWRIGHT"] },
    { action: "prev", label: "Previous page", defaults: ["A", "ARROWLEFT"] },
    { action: "fit", label: "Toggle fit / natural width", defaults: ["F"] },
    { action: "gallery", label: "Back to gallery", defaults: ["Q"] },
    { action: "up", label: "Scroll up", defaults: ["W", "ARROWUP"] },
    { action: "down", label: "Scroll down", defaults: ["S", "ARROWDOWN"] }
  ];
  var MAX_KEYS_PER_ACTION = 6;
  var MAX_KEY_LENGTH = 20;
  var MODIFIER_KEYS = new Set([
    "Alt",
    "AltGraph",
    "CapsLock",
    "Control",
    "Fn",
    "FnLock",
    "Hyper",
    "Meta",
    "NumLock",
    "OS",
    "ScrollLock",
    "Shift",
    "Super",
    "Symbol",
    "SymbolLock"
  ]);
  function isKeyMapPatch(value) {
    if (!isRecord(value)) {
      return false;
    }
    return Object.entries(value).every(([action, keys]) => KEY_ACTIONS.some((field) => field.action === action) && Array.isArray(keys) && keys.every((entry) => typeof entry === "string"));
  }
  function copyKeymap(keymap) {
    const copy = {};
    for (const { action } of KEY_ACTIONS) {
      copy[action] = [...keymap[action]];
    }
    return copy;
  }
  function freezeKeymap(keymap) {
    for (const keys of Object.values(keymap)) {
      Object.freeze(keys);
    }
    return Object.freeze(keymap);
  }
  function defaultKeymap() {
    const keymap = {};
    for (const { action, defaults } of KEY_ACTIONS) {
      keymap[action] = [...defaults];
    }
    return freezeKeymap(keymap);
  }
  var DEFAULT_KEYMAP = defaultKeymap();

  // src/settings-schema.ts
  var SETTINGS_SCHEMA = {
    fitHeight: {
      control: "boolean",
      key: "fitHeight",
      default: true,
      label: "Fit image to the screen height",
      hint: "The viewer's default; F toggles it per page."
    },
    debug: {
      control: "boolean",
      key: "debug",
      default: false,
      label: "Debug logging",
      hint: "Log requests and reader state to the console."
    },
    scrollStep: {
      control: "number",
      key: "scrollStep",
      default: 220,
      min: 20,
      max: 5000,
      label: "Scroll step",
      hint: "Pixels moved by the natural-width scroll keys."
    },
    prefetchCount: {
      control: "number",
      key: "prefetchCount",
      default: 2,
      min: 0,
      max: 10,
      label: "Prefetch depth",
      hint: "Pages warmed in each direction; 0 disables it. Needs two or more network slots."
    },
    maxNlRetry: {
      control: "number",
      key: "maxNlRetry",
      default: 4,
      min: 0,
      max: 10,
      label: "Image retries",
      hint: "Attempts per image before the fallback view is shown."
    },
    imgCacheLimit: {
      control: "number",
      key: "imgCacheLimit",
      default: 20,
      min: 1,
      max: 200,
      label: "Image cache",
      hint: "Decoded images kept in memory; keep at least twice the prefetch depth."
    },
    listThumbSize: {
      control: "number",
      key: "listThumbSize",
      default: 220,
      min: 120,
      max: 480,
      label: "List thumbnail size",
      hint: "Target width of a feed card in pixels."
    },
    galleryThumbSize: {
      control: "number",
      key: "galleryThumbSize",
      default: 200,
      min: 80,
      max: 400,
      label: "Gallery thumbnail size",
      hint: "Target width of a gallery thumbnail in pixels."
    },
    listInfiniteScroll: {
      control: "boolean",
      key: "listInfiniteScroll",
      default: false,
      label: "Infinite scroll on feeds",
      hint: "Append the next listing page while scrolling."
    },
    galleryInfiniteScroll: {
      control: "boolean",
      key: "galleryInfiniteScroll",
      default: false,
      label: "Infinite scroll in galleries",
      hint: "Append thumbnails while scrolling."
    },
    gap: {
      control: "number",
      key: "gap",
      default: 12,
      min: 0,
      max: 64,
      label: "Grid gap",
      hint: "Space between cards and thumbnails."
    },
    netConcurrency: {
      control: "number",
      key: "netConcurrency",
      default: 2,
      min: 1,
      max: 8,
      label: "Network concurrency",
      hint: "Requests allowed on the wire at once; prefetch only uses a spare slot."
    },
    netIntervalMs: {
      control: "number",
      key: "netIntervalMs",
      default: 450,
      min: 0,
      max: 1e4,
      label: "Request interval",
      hint: "Minimum milliseconds between request starts."
    },
    netTimeoutMs: {
      control: "number",
      key: "netTimeoutMs",
      default: 15000,
      min: 1000,
      max: 120000,
      label: "Request timeout",
      hint: "Milliseconds before a request is aborted."
    },
    tagSuggestions: {
      control: "boolean",
      key: "tagSuggestions",
      default: true,
      label: "Tag suggestions",
      hint: "Show the tag combobox while typing in the search bar."
    },
    readerMode: {
      control: "select",
      key: "readerMode",
      default: "single",
      label: "Reader layout",
      hint: "Single page, facing pair, or a vertical stack.",
      options: [
        { value: "single", label: "Single page" },
        { value: "spread", label: "Spread (two pages)" },
        { value: "continuous", label: "Continuous scroll" }
      ]
    },
    readingDirection: {
      control: "select",
      key: "readingDirection",
      default: "ltr",
      label: "Page direction",
      hint: "Right-to-left mirrors spreads, click zones, and swipes.",
      options: [
        { value: "ltr", label: "Left to right" },
        { value: "rtl", label: "Right to left" }
      ]
    }
  };
  var SCALAR_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA));
  function fieldsOf(control) {
    return SCALAR_KEYS.map((key) => SETTINGS_SCHEMA[key]).filter((field) => field.control === control);
  }
  var BOOLEAN_FIELDS = fieldsOf("boolean");
  var NUMBER_FIELDS = fieldsOf("number");
  var SELECT_FIELDS = fieldsOf("select");
  function defaultScalars() {
    const defaults = {};
    for (const key of SCALAR_KEYS) {
      defaults[key] = SETTINGS_SCHEMA[key].default;
    }
    return defaults;
  }
  function clampNumber(key, value) {
    const field = SETTINGS_SCHEMA[key];
    return Math.min(field.max, Math.max(field.min, Math.round(value)));
  }
  function optionList(options) {
    const values = options.map((option) => option.value);
    if (values.length <= 2) {
      return values.join(" or ");
    }
    return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
  }
  function validateScalar(key, value) {
    const field = SETTINGS_SCHEMA[key];
    if (field.control === "boolean") {
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `"${key}" must be true or false.` };
    }
    if (field.control === "number") {
      return typeof value === "number" && Number.isFinite(value) ? { ok: true, value: clampNumber(field.key, value) } : { ok: false, error: `"${key}" must be a number.` };
    }
    const options = field.options;
    return options.some((option) => option.value === value) ? { ok: true, value } : { ok: false, error: `"${key}" must be ${optionList(options)}.` };
  }
  function applyScalar(target, key, value) {
    const result = validateScalar(key, value);
    if (!result.ok) {
      return false;
    }
    target[key] = result.value;
    return true;
  }

  // src/settings.ts
  var STORAGE_KEY = "eh:settings:v2";
  var VERSION2 = 2;
  var listeners = new Set;
  var DEFAULT_SETTINGS = Object.freeze({
    ...defaultScalars(),
    keymap: defaultKeymap()
  });
  var gm = gmStorage();
  function readStoredSetting(key) {
    return gm.read(key);
  }
  function isStoredValues(value) {
    return isRecord(value);
  }
  function legacyValues(read) {
    const legacyFit = read("defaultFitHeight");
    const legacyDebug = read("debug");
    const legacyKeymap = read("keymap");
    return {
      fitHeight: typeof legacyFit === "boolean" ? legacyFit : DEFAULT_SETTINGS.fitHeight,
      debug: typeof legacyDebug === "boolean" ? legacyDebug : DEFAULT_SETTINGS.debug,
      keymap: isKeyMapPatch(legacyKeymap) ? { ...DEFAULT_SETTINGS.keymap, ...legacyKeymap } : DEFAULT_SETTINGS.keymap
    };
  }
  function settingsOptions(read) {
    return {
      key: STORAGE_KEY,
      version: VERSION2,
      empty: () => legacyValues(read),
      guard: isStoredValues
    };
  }
  function applyStoredScalars(target, values) {
    for (const key of SCALAR_KEYS) {
      applyScalar(target, key, values[key]);
    }
  }
  function loadSettings(read = readStoredSetting) {
    const values = createStore(settingsOptions(read), {
      read,
      write: () => {
        return;
      },
      remove: () => {
        return;
      }
    }).read();
    const merged = { ...DEFAULT_SETTINGS };
    applyStoredScalars(merged, values);
    const storedKeymap = isKeyMapPatch(values.keymap) ? values.keymap : DEFAULT_SETTINGS.keymap;
    return Object.freeze({
      ...merged,
      keymap: freezeKeymap({ ...DEFAULT_SETTINGS.keymap, ...storedKeymap })
    });
  }
  var store = createStore(settingsOptions(readStoredSetting), gm);
  var current = loadSettings();
  function getSettings() {
    return current;
  }
  function updateSettings(patch) {
    const next = { ...current };
    for (const key of SCALAR_KEYS) {
      applyScalar(next, key, patch[key]);
    }
    if (patch.keymap !== undefined) {
      next.keymap = freezeKeymap(copyKeymap(patch.keymap));
    }
    current = Object.freeze(next);
    store.write(current);
    for (const listener of listeners) {
      listener(current);
    }
  }
  function updateSetting(key, value) {
    updateSettings({ [key]: value });
  }
  function onSettingsChange(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // src/log.ts
  var LOG_TAG = "[Better EH]";
  function log(...args) {
    if (getSettings().debug) {
      console.log(LOG_TAG, ...args);
    }
  }
  function warn(...args) {
    if (getSettings().debug) {
      console.warn(LOG_TAG, ...args);
    }
  }

  // src/ui/dom.ts
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      if (key === "class") {
        node.className = String(value);
      } else if (key === "text") {
        node.textContent = String(value);
      } else if (key === "style") {
        node.style.cssText = String(value);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
    appendChildren(node, children);
    return node;
  }
  function appendChildren(parent, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) {
        continue;
      }
      parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  function textInput(props = {}) {
    return el("input", {
      type: "text",
      autocomplete: "off",
      autocapitalize: "none",
      autocorrect: "off",
      spellcheck: "false",
      ...props
    });
  }
  function searchInput(props = {}) {
    return textInput({ type: "search", enterkeyhint: "search", ...props });
  }
  function tagInput(className) {
    return textInput({
      class: className,
      name: "new_tags",
      placeholder: "Add tags, comma separated",
      "aria-label": "New tags",
      maxlength: "200"
    });
  }
  var ICON_PATHS = {
    back: "M15 18l-6-6 6-6",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2l-4.35-4.35",
    star: "M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9L12 2.5z",
    external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
    warning: "M12 3L2 21h20L12 3zm0 6v6m0 3v.5",
    close: "M6 6l12 12M18 6L6 18",
    filter: "M3 5h18l-7 8v6l-4 2v-8L3 5z",
    arrowRight: "M5 12h14m-6-6 6 6-6 6",
    arrowLeft: "M19 12H5m6-6-6 6 6 6",
    chevronLeft: "M15 6l-6 6 6 6",
    chevronRight: "M9 6l6 6-6 6",
    first: "M18 6l-6 6 6 6M11 6l-6 6 6 6",
    last: "M6 6l6 6-6 6M13 6l6 6-6 6",
    download: "M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M5 19h14",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
    eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
  };
  function icon(name, filled = false) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", filled ? "0" : "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", filled ? "currentColor" : "none");
    svg.append(path);
    return svg;
  }
  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  // src/ui/live-region.ts
  function announceInto(node, text, write) {
    if (text !== "" && node.textContent === text) {
      write("");
      window.setTimeout(() => write(text), 16);
      return;
    }
    write(text);
  }

  // src/ui/toast.ts
  var timers = new Map;
  function durationFor(text) {
    return Math.min(8000, Math.max(2000, text.length * 70));
  }
  function present(node, text, visibleClass) {
    clearTimeout(timers.get(node));
    node.classList.remove(visibleClass);
    const reveal = (value) => {
      node.textContent = value;
      if (value === "") {
        return;
      }
      node.classList.add(visibleClass);
      timers.set(node, window.setTimeout(() => {
        node.classList.remove(visibleClass);
        node.textContent = "";
      }, durationFor(value)));
    };
    announceInto(node, text, reveal);
  }
  function ensureToast() {
    const existing = document.getElementById("eh-toast");
    if (existing) {
      return existing;
    }
    const toast = el("div", {
      id: "eh-toast",
      class: "eh-toast",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    });
    (document.getElementById("eh-root") ?? document.body).append(toast);
    return toast;
  }
  function showToast(text) {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    const hudToast = document.getElementById("hud-toast");
    present(hudToast ?? ensureToast(), trimmed, "show");
  }

  // src/menu.ts
  function enabledToast(label) {
    return (enabled) => `${label} ${enabled ? "enabled" : "disabled"}`;
  }
  var TOGGLE_COMMANDS = [
    {
      key: "fitHeight",
      command: "Toggle fit-height / natural-width",
      toast: (fitHeight) => `Default mode: ${fitHeight ? "fit-height" : "natural-width"}`
    },
    { key: "debug", command: "Toggle debug mode", toast: enabledToast("Debug mode") },
    {
      key: "listInfiniteScroll",
      command: "Toggle infinite scroll (feed)",
      toast: enabledToast("Feed infinite scroll")
    },
    {
      key: "galleryInfiniteScroll",
      command: "Toggle infinite scroll (gallery)",
      toast: enabledToast("Gallery infinite scroll")
    },
    {
      key: "tagSuggestions",
      command: "Toggle tag suggestions",
      toast: enabledToast("Tag suggestions")
    }
  ];
  function defaultKeySummary() {
    return KEY_ACTIONS.map(({ action, label }) => `${label}: ${DEFAULT_KEYMAP[action].join("/")}`).join(", ");
  }
  function registerMenuCommands() {
    for (const { key, command, toast } of TOGGLE_COMMANDS) {
      GM_registerMenuCommand(command, () => {
        const next = !getSettings()[key];
        updateSetting(key, next);
        showToast(toast(next));
      });
    }
    GM_registerMenuCommand("Reset keymap to defaults", () => {
      if (confirm(`Reset all keys to defaults?

${defaultKeySummary()}`)) {
        updateSetting("keymap", DEFAULT_KEYMAP);
        showToast("Keymap reset to defaults");
      }
    });
  }

  // src/net/priority.ts
  var VALUES = {
    critical: 10,
    navigation: 8,
    facing: 7,
    append: 6,
    background: 4,
    prefetch: 2
  };
  function priorityOf(requestClass) {
    return VALUES[requestClass];
  }

  // src/net/queue.ts
  class RequestQueue {
    pending = [];
    active = 0;
    lastStart = 0;
    timer;
    seq = 0;
    get activeCount() {
      return this.active;
    }
    fetch(url, options = {}) {
      const { promise, resolve, reject } = Promise.withResolvers();
      const controller = new AbortController;
      const userSignal = options.signal;
      const task = {
        url,
        init: options.init ?? {},
        priority: options.priority ?? priorityOf("background"),
        tag: options.tag ?? "default",
        seq: this.seq++,
        controller,
        resolve,
        reject,
        detach: null
      };
      if (userSignal) {
        if (userSignal.aborted) {
          reject(userSignal.reason);
          return promise;
        }
        const onAbort = () => {
          const index = this.pending.indexOf(task);
          if (index === -1) {
            controller.abort(userSignal.reason);
            return;
          }
          this.pending.splice(index, 1);
          this.finish(task);
          reject(userSignal.reason);
        };
        userSignal.addEventListener("abort", onAbort, { once: true });
        task.detach = () => {
          userSignal.removeEventListener("abort", onAbort);
        };
      }
      this.pending.push(task);
      this.pending.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.pump();
      return promise;
    }
    purge(predicate) {
      for (let index = this.pending.length - 1;index >= 0; index--) {
        const task = this.pending[index];
        if (!task || !predicate(task)) {
          continue;
        }
        this.pending.splice(index, 1);
        this.finish(task);
        task.reject(new RequestPurgedError);
      }
    }
    pump() {
      if (this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      const concurrency = Math.max(1, getSettings().netConcurrency);
      while (this.active < concurrency) {
        const task = this.pending.shift();
        if (!task) {
          return;
        }
        const now = Date.now();
        const wait = this.lastStart + getSettings().netIntervalMs - now;
        if (wait > 0) {
          this.pending.unshift(task);
          this.timer = setTimeout(() => {
            this.pump();
          }, wait);
          return;
        }
        this.active++;
        this.lastStart = now;
        this.run(task);
      }
    }
    async run(task) {
      const timeout = setTimeout(() => {
        task.controller.abort(new DOMException("Request timed out", "TimeoutError"));
      }, Math.max(1000, getSettings().netTimeoutMs));
      try {
        const response = await fetch(task.url, {
          ...task.init,
          signal: task.controller.signal
        });
        task.resolve(response);
      } catch (error) {
        task.reject(error);
      } finally {
        clearTimeout(timeout);
        this.active--;
        this.finish(task);
        this.pump();
      }
    }
    finish(task) {
      task.detach?.();
      task.detach = null;
    }
  }
  var net = new RequestQueue;

  // src/net/http.ts
  async function post(url, body, contentType, options) {
    const response = await net.fetch(url, {
      priority: priorityOf("critical"),
      tag: options.tag,
      signal: options.signal,
      init: {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { "Content-Type": contentType }
      }
    });
    if (!response.ok) {
      throw new Error(`${options.failure} (${response.status}).`);
    }
    return response;
  }
  function postForm(url, body, options) {
    return post(url, body, "application/x-www-form-urlencoded", options);
  }
  async function postJson(url, body, options) {
    const response = await post(url, JSON.stringify(body), "application/json", options);
    return await response.json();
  }
  var LIMIT_PATTERNS = [
    /image viewing limit/i,
    /not have sufficient gp/i,
    /opening pages too fast/i,
    /temporarily banned/i,
    /too many requests/i
  ];
  function isRateLimitText(text) {
    return LIMIT_PATTERNS.some((pattern) => pattern.test(text));
  }
  function isHtmlResponse(response, text) {
    const type = response.headers.get("content-type") ?? "";
    return type.includes("html") || /^\s*<(!doctype|html|head|body)/i.test(text);
  }
  var PAGE_CONTENT_SELECTOR = "#gn, #gdt, #gdd, #i1, #i2, #i3, #profile_form, .itg";
  function hasPageContent(doc) {
    return doc.querySelector(PAGE_CONTENT_SELECTOR) !== null;
  }
  function isLoginPage(doc) {
    if (doc.querySelector("#sadpanda") !== null) {
      return true;
    }
    return !hasPageContent(doc) && /sad panda/i.test(doc.title);
  }
  var SITE_SUFFIX = /\s*[-–—|]\s*(?:e-hentai|exhentai)(?:\.org)?(?:\s+galleries)?\s*$/i;
  var NOT_FOUND_HEADINGS = {
    "not found": true,
    "not available": true,
    "gallery not available": true
  };
  function normalizeHeading(text) {
    return text.replace(SITE_SUFFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  var NOT_FOUND_TEXT = /^(?:gallery not found|gallery not available|page not found|not found)\b/i;
  function isNotFoundPage(doc) {
    if (hasPageContent(doc)) {
      return false;
    }
    const title = normalizeHeading(doc.title);
    const heading = normalizeHeading(doc.querySelector("h1")?.textContent ?? "");
    const body = doc.body.textContent.trim();
    const bare = body.length > 0 && body.length < 800 && NOT_FOUND_TEXT.test(body);
    return [title, heading].some((text) => /^404\b/.test(text) || NOT_FOUND_HEADINGS[text] === true) || bare;
  }

  // src/parse/helpers.ts
  var CATEGORY_CLASS = /^ct[0-9a-z]+$/;
  function isChecked(input) {
    if (!input) {
      return false;
    }
    const live = input.checked;
    return typeof live === "boolean" ? live : input.hasAttribute("checked");
  }
  function cleanText(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }
  function parseNumber(value) {
    const match = /([\d,]+)/.exec(value ?? "");
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function anchorHref(anchor, base) {
    const href = anchor?.getAttribute("href");
    if (href === null || href === undefined) {
      return null;
    }
    return safeUrl(href, base)?.href ?? null;
  }
  function categoryFromNode(node) {
    if (!node) {
      return null;
    }
    const cls = [...node.classList].find((name) => CATEGORY_CLASS.test(name));
    if (!cls) {
      return null;
    }
    const category = categoryFromClass(cls);
    if (!category) {
      return null;
    }
    return { name: cleanText(node.textContent) || category.name, cls };
  }

  // src/parse/title.ts
  var LANGUAGE = /\[(English|Japanese|Chinese|Korean|Thai|Vietnamese|French|German|Italian|Portuguese|Russian|Spanish)/i;
  var NON_ARTIST_TAGS = {
    digital: true,
    colorized: true,
    decensored: true,
    incomplete: true,
    raw: true,
    translated: true,
    edited: true,
    webtoon: true,
    doujinshi: true,
    manga: true
  };
  function parseTitle(raw) {
    let text = raw.trim();
    const leading = [];
    const trailing = [];
    for (;; ) {
      const match = text.match(/^(\([^)]+\)|\[[^\]]+\])\s*/);
      const m = match?.[1];
      if (!m) {
        break;
      }
      let type = "tag";
      if (m.startsWith("(")) {
        type = "event";
      } else if (m.toLowerCase().includes("anthology")) {
        type = "anthology";
      } else {
        const inner = m.slice(1, -1).toLowerCase();
        if (NON_ARTIST_TAGS[inner] !== true) {
          type = "artist";
        }
      }
      leading.push({ text: m, type });
      text = text.slice(match[0].length).trim();
    }
    for (;; ) {
      const match = text.match(/\s*(\([^)]+\)|\[[^\]]+\])$/);
      const m = match?.[1];
      if (!m) {
        break;
      }
      let type = "tag";
      if (m.startsWith("(")) {
        type = "parody";
      } else if (LANGUAGE.test(m)) {
        type = "lang";
      }
      trailing.unshift({ text: m, type });
      text = text.slice(0, -match[0].length).trim();
    }
    const parts = text.split(/\s*\|\s*/);
    return {
      leading,
      primary: parts[0] || "Untitled",
      secondary: parts[1] || null,
      trailing
    };
  }

  // src/parse/viewer.ts
  function parseViewer(doc, viewerUrl) {
    const [, pageHash = "", galleryId = "", rawNum = "1"] = viewerUrl.match(/\/s\/([^/]+)\/(\d+)-(\d+)/) ?? [];
    const pageNum = parseInt(rawNum, 10);
    const imgEl = doc.querySelector("#i3 a img, iframe + a img, .sni > a img");
    const imgSrc = imgEl?.getAttribute("src") ?? "";
    const originalHref = anchorHref(doc.querySelector("a[href*='/fullimg/']"), viewerUrl);
    const nlToken = doc.querySelector('a[onclick*="nl("]')?.getAttribute("onclick")?.match(/nl\((\d+)\)/)?.[1] ?? null;
    const anchorHrefs = [...doc.querySelectorAll('a[href*="/s/"]')].map((anchor) => anchorHref(anchor, viewerUrl));
    const hrefMatching = (n) => anchorHrefs.find((href) => href?.match(new RegExp(`-(${n})(\\?|$)`))) ?? null;
    const nextHref = (() => {
      const byNum = hrefMatching(pageNum + 1);
      if (byNum) {
        return byNum;
      }
      const i3Href = anchorHref(doc.querySelector("#i3 a"), viewerUrl);
      return i3Href && i3Href !== viewerUrl ? i3Href : null;
    })();
    const prevHref = pageNum <= 1 ? null : hrefMatching(pageNum - 1) ?? (pageHash && galleryId ? `${new URL(viewerUrl).origin}/s/${pageHash}/${galleryId}-${pageNum - 1}` : null);
    const counterText = [...doc.querySelectorAll("div, span, td")].find((el) => /^\d+ \/ \d+$/.test(el.textContent.trim()))?.textContent.trim() ?? `${pageNum} / ?`;
    const fileInfo = (() => {
      for (const el of doc.querySelector("#i2")?.querySelectorAll("div, span") ?? []) {
        const t = el.textContent.trim();
        if (/\d+ x \d+/.test(t) && t.includes("::")) {
          return (t.split(`
`)[0] ?? t).trim();
        }
      }
      return "";
    })();
    const galleryHref = anchorHref(doc.querySelector('a[href*="/g/"]'), viewerUrl) ?? "#";
    const totalPages = Number.parseInt(/\/\s*(\d+)\s*$/.exec(counterText)?.[1] ?? "", 10);
    const lastByImage = [...doc.querySelectorAll("a")].find((anchor) => anchor.querySelector("img")?.getAttribute("src")?.includes("/l.png"));
    const firstHref = pageNum <= 1 ? null : hrefMatching(1);
    const lastHref = Number.isFinite(totalPages) && totalPages > 0 ? hrefMatching(totalPages) : anchorHref(lastByImage ?? null, viewerUrl);
    const forumHref = anchorHref(doc.querySelector('a[href*="/forumtoken/"]'), viewerUrl) ?? /'(https?:\/\/[^']*forumtoken[^']*)'/.exec(doc.querySelector('a[onclick*="forumtoken"]')?.getAttribute("onclick") ?? "")?.[1] ?? null;
    const searchHref = anchorHref(doc.querySelector('a[href*="f_shash="]'), viewerUrl);
    const galleryTitleElement = doc.querySelector("h1");
    const galleryTitle = galleryTitleElement?.textContent.trim() ?? "Untitled";
    const parsedTitle = parseTitle(galleryTitle);
    return {
      viewerUrl,
      pageNum,
      counterText,
      galleryTitle: parsedTitle,
      imgSrc,
      originalHref,
      nextHref,
      prevHref,
      firstHref,
      lastHref,
      fileInfo,
      galleryHref,
      nlToken,
      forumHref,
      searchHref
    };
  }

  // src/fetch/lru.ts
  function createLru(limit, onEvict) {
    const entries = new Map;
    let capacity = limit;
    const drop = (key, value) => {
      entries.delete(key);
      onEvict?.(value, key);
    };
    const trim = () => {
      while (entries.size > capacity) {
        const oldest = entries.entries().next().value;
        if (!oldest) {
          return;
        }
        drop(oldest[0], oldest[1]);
      }
    };
    return {
      get(key) {
        if (!entries.has(key)) {
          return;
        }
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        entries.delete(key);
        if (capacity < 1) {
          onEvict?.(value, key);
          return;
        }
        if (entries.size >= capacity) {
          const oldest = entries.entries().next().value;
          if (oldest) {
            drop(oldest[0], oldest[1]);
          }
        }
        entries.set(key, value);
      },
      setLimit(next) {
        capacity = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
        trim();
      }
    };
  }

  // src/fetch/loader.ts
  var DOC_CACHE_LIMIT = 24;
  var PAGE_CACHE_LIMIT = 40;
  function abortError(reason) {
    return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
  }
  function waitFor(promise, signal) {
    if (!signal) {
      return promise;
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal.reason));
      const settle = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(abortError(signal.reason));
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      promise.then((value) => {
        settle();
        resolve(value);
      }, (error) => {
        settle();
        reject(error);
      });
    });
  }
  function createPageLoader(deps) {
    const documents = createLru(DOC_CACHE_LIMIT);
    const pages = createLru(PAGE_CACHE_LIMIT);
    const inFlight = new Map;
    function cachePage(data, requestedUrl) {
      pages.set(data.viewerUrl, data);
      if (requestedUrl !== data.viewerUrl) {
        pages.set(requestedUrl, data);
      }
      log("cached viewer", data.viewerUrl, "| img:", data.imgSrc, "| nl:", data.nlToken);
      return data;
    }
    async function loadDocument(url, options = {}) {
      if (!options.fresh) {
        const cached = documents.get(url);
        if (cached) {
          log("html cache hit", url);
          return cached;
        }
      }
      const response = await deps.request(url, {
        priority: options.priority ?? priorityOf("navigation"),
        tag: options.tag ?? "html",
        signal: options.signal
      });
      const finalUrl = response.url || url;
      const text = await response.text();
      if (!response.ok || !isHtmlResponse(response, text)) {
        if (isRateLimitText(text)) {
          deps.purgeQueue();
          throw new RateLimitedError(text);
        }
        if (!response.ok) {
          throw new HttpError(response.status, finalUrl);
        }
        throw new Error(text.slice(0, 300) || `Unexpected response from ${finalUrl}`);
      }
      const doc = deps.parseHtml(text);
      if (isLoginPage(doc)) {
        throw new LoginRequiredError;
      }
      const result = { doc, url: finalUrl };
      documents.set(url, result);
      if (finalUrl !== url) {
        documents.set(finalUrl, result);
      }
      return result;
    }
    function fetchViewerPage(url, priority, tag, cancelSignal) {
      log("fetching viewer →", url);
      const controller = new AbortController;
      const shared = (async () => {
        const { doc, url: finalUrl } = await loadDocument(url, {
          priority,
          tag,
          signal: controller.signal
        });
        return cachePage(parseViewer(doc, finalUrl), url);
      })();
      const entry = {
        promise: shared,
        controller,
        protected: cancelSignal === undefined,
        detach: () => {
          return;
        }
      };
      const onAbort = () => {
        if (!entry.protected) {
          controller.abort(cancelSignal?.reason);
        }
      };
      if (cancelSignal !== undefined) {
        if (cancelSignal.aborted) {
          onAbort();
        } else {
          cancelSignal.addEventListener("abort", onAbort, { once: true });
          entry.detach = () => cancelSignal.removeEventListener("abort", onAbort);
        }
      }
      const tracked = shared.finally(() => {
        entry.detach();
        if (inFlight.get(url) === entry) {
          inFlight.delete(url);
        }
      });
      entry.promise = tracked;
      inFlight.set(url, entry);
      return entry;
    }
    return {
      document: loadDocument,
      async viewerPage(url, options = {}) {
        const cached = pages.get(url);
        if (cached) {
          log("viewer cache hit", url);
          return cached;
        }
        let entry = inFlight.get(url);
        if (entry) {
          log("joining viewer fetch →", url);
          if (options.cancel !== true) {
            entry.protected = true;
          }
        } else {
          entry = fetchViewerPage(url, options.priority ?? priorityOf("facing"), options.tag ?? "viewer", options.cancel === true ? options.signal : undefined);
        }
        return waitFor(entry.promise, options.signal);
      },
      seedViewerPage(url, data) {
        cachePage(data, url);
      },
      async retryWithNl(page) {
        if (!page.nlToken) {
          return null;
        }
        const retryUrl = `${page.viewerUrl.split("?")[0]}?nl=${page.nlToken}`;
        log("nl retry →", retryUrl);
        try {
          const { doc } = await loadDocument(retryUrl, {
            fresh: true,
            priority: priorityOf("critical"),
            tag: "viewer"
          });
          return cachePage(parseViewer(doc, page.viewerUrl), page.viewerUrl);
        } catch (error) {
          warn("nl retry fetch failed", error);
          return null;
        }
      }
    };
  }
  var loader = createPageLoader({
    request: (url, options) => net.fetch(url, options),
    parseHtml: (text) => new DOMParser().parseFromString(text, "text/html"),
    purgeQueue: () => {
      net.purge((task) => task.tag !== "critical");
    }
  });

  // src/parse/list.ts
  var PAGES_TEXT = /^([\d,]+)\s+pages?$/i;
  var FAVORITE_SLOT_RGB = [
    [0, 0, 0],
    [240, 0, 0],
    [240, 160, 0],
    [208, 208, 0],
    [0, 128, 0],
    [144, 240, 64],
    [64, 176, 240],
    [0, 0, 240],
    [80, 0, 128],
    [224, 128, 224]
  ];
  var FAVORITE_COLOR = /(?:border|background)-color\s*:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;
  function favoriteSlot(style) {
    const match = FAVORITE_COLOR.exec(style ?? "");
    if (!match?.[1] || !match[2] || !match[3]) {
      return null;
    }
    const rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
    const slot = FAVORITE_SLOT_RGB.findIndex(([red, green, blue]) => red === rgb[0] && green === rgb[1] && blue === rgb[2]);
    return slot === -1 ? null : slot;
  }
  function parseFavorite(root) {
    for (const node of root.querySelectorAll('div[id^="posted_"]')) {
      const folder = node.getAttribute("title");
      const slot = favoriteSlot(node.getAttribute("style"));
      if (folder === null && slot === null) {
        continue;
      }
      return { folder: cleanText(folder), slot };
    }
    return null;
  }
  function parsePages(root) {
    for (const node of root.querySelectorAll("*")) {
      const match = PAGES_TEXT.exec(cleanText(node.textContent));
      if (match?.[1]) {
        return Number.parseInt(match[1].replace(/,/g, ""), 10);
      }
    }
    return null;
  }
  function coverSrc(image) {
    if (!image) {
      return null;
    }
    const src = image.getAttribute("data-src") ?? image.getAttribute("src") ?? "";
    return src.startsWith("data:") ? null : src;
  }
  function coverSize(image) {
    if (!image) {
      return null;
    }
    const width = Number.parseFloat(image.style.width);
    const height = Number.parseFloat(image.style.height);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  function parseRating(root) {
    const position = root.querySelector(".ir")?.style.backgroundPosition;
    if (!position) {
      return null;
    }
    const match = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(position);
    if (!match?.[1] || !match[2]) {
      return null;
    }
    const goldRun = Number.parseFloat(match[2]) <= -10 ? 72 : 80;
    const stars = (goldRun + Number.parseFloat(match[1])) / 16;
    return stars >= 0 && stars <= 5 ? Math.round(stars * 2) / 2 : null;
  }
  function parseTorrents(root, base) {
    const anchor = root.querySelector(".gldown a[href*='gallerytorrents']");
    return anchor ? anchorHref(anchor, base) ?? null : null;
  }
  var CATEGORY_SELECTOR = ".glcat .cn, .glcat .cs, .cn, .cs";
  var POSTED_SELECTOR = "div[id^='postedpop_'], div[id^='posted_']";
  function parseAnchorLink(anchor, base) {
    if (!anchor) {
      return null;
    }
    const href = anchorHref(anchor, base);
    if (!href) {
      return null;
    }
    const identity = galleryIdentity(href);
    if (!identity) {
      return null;
    }
    return { href, gid: identity.gid, token: identity.token };
  }
  var TABLE_ROW = {
    link: ".gl3c a[href*='/g/'], a[href*='/g/']",
    image: ".glthumb img, img",
    title: ".glink",
    category: CATEGORY_SELECTOR
  };
  var THUMB_ITEM = {
    link: "a[href*='/g/']",
    image: ".gl3t img, img",
    title: ".glink, .gl4t",
    category: ".cn, .cs"
  };
  function parseItem(root, base, selectors) {
    const link = root.querySelector(selectors.link);
    const parsedLink = parseAnchorLink(link, base);
    if (!parsedLink) {
      return null;
    }
    const image = root.querySelector(selectors.image);
    const titleText = cleanText(root.querySelector(selectors.title)?.textContent) || cleanText(link?.textContent) || "Untitled";
    return {
      href: parsedLink.href,
      gid: parsedLink.gid,
      token: parsedLink.token,
      title: parseTitle(titleText),
      coverSrc: coverSrc(image),
      coverSize: coverSize(image),
      rating: parseRating(root),
      category: categoryFromNode(root.querySelector(selectors.category)),
      uploader: cleanText(root.querySelector("a[href*='/uploader/']")?.textContent) || null,
      uploaderHref: anchorHref(root.querySelector("a[href*='/uploader/']"), base),
      posted: cleanText(root.querySelector(POSTED_SELECTOR)?.textContent),
      pages: parsePages(root),
      torrentsHref: parseTorrents(root, base),
      favorite: parseFavorite(root)
    };
  }
  function nextLink(doc, id, base) {
    const node = doc.getElementById(id);
    if (!node?.getAttribute("href")) {
      return null;
    }
    return anchorHref(node, base);
  }
  function resultSummary(doc) {
    const raw = cleanText(doc.querySelector(".searchtext p")?.textContent);
    const match = /(?:Found|Showing)[^.]*?\./i.exec(raw);
    if (match?.[0]) {
      return match[0];
    }
    const notice = cleanText(doc.querySelector("p.ip strong")?.textContent);
    return notice || raw || null;
  }
  function parseListPage(doc, url) {
    const items = [];
    const seen = new Set;
    for (const row of doc.querySelectorAll("table.itg > tbody > tr")) {
      const item = parseItem(row, url, TABLE_ROW);
      if (item && !seen.has(item.gid)) {
        seen.add(item.gid);
        items.push(item);
      }
    }
    if (items.length === 0) {
      for (const itemNode of doc.querySelectorAll(".gl1t")) {
        const item = parseItem(itemNode, url, THUMB_ITEM);
        if (item && !seen.has(item.gid)) {
          seen.add(item.gid);
          items.push(item);
        }
      }
    }
    return {
      url,
      items,
      nextHref: nextLink(doc, "dnext", url),
      prevHref: nextLink(doc, "dprev", url),
      resultText: resultSummary(doc)
    };
  }

  // src/parse/favorites.ts
  var FAVCAT = /favcat=(\d+)/;
  var NOTE_ID = /^favnote_(.+)$/;
  var ORDER_SELECT = 'option[value="f"]';
  function urlParam(url, key) {
    return safeUrl(url)?.searchParams.get(key) ?? null;
  }
  function orderOf(value) {
    if (value === "p" || value === "fs_p") {
      return "published";
    }
    if (value === "f" || value === "fs_f") {
      return "favorited";
    }
    return null;
  }
  function parseOrder(doc, url) {
    for (const select of doc.querySelectorAll("select")) {
      if (!select.querySelector(ORDER_SELECT)) {
        continue;
      }
      const marked = select.querySelector("option[selected]");
      const first = select.querySelector("option");
      return orderOf(marked?.getAttribute("value") ?? null) ?? orderOf(urlParam(url, "inline_set")) ?? orderOf(first?.getAttribute("value") ?? null) ?? "favorited";
    }
    return orderOf(urlParam(url, "inline_set")) ?? "favorited";
  }
  function folderName(tab) {
    const fromIcon = cleanText(tab.querySelector(".i")?.getAttribute("title"));
    if (fromIcon) {
      return fromIcon;
    }
    const labels = tab.querySelectorAll("div");
    return cleanText(labels[labels.length - 1]?.textContent);
  }
  function parseFolderTabs(doc) {
    const folders = [];
    let active = null;
    for (const tab of doc.querySelectorAll(".fp")) {
      const slotMatch = FAVCAT.exec(tab.getAttribute("onclick") ?? "");
      const activeTab = tab.classList.contains("fps");
      if (slotMatch?.[1] === undefined) {
        if (activeTab) {
          active = "all";
        }
        continue;
      }
      folders.push({
        slot: Number.parseInt(slotMatch[1], 10),
        name: folderName(tab),
        count: parseNumber(tab.querySelector("div")?.textContent) ?? 0
      });
      if (activeTab) {
        active = Number.parseInt(slotMatch[1], 10);
      }
    }
    return { folders, active };
  }
  function parseActive(tabs, url) {
    if (tabs.active !== null) {
      return tabs.active;
    }
    const value = urlParam(url, "favcat");
    if (value === null || value === "all") {
      return "all";
    }
    return /^[0-9]$/.test(value) ? Number.parseInt(value, 10) : "all";
  }
  function noteText(node) {
    const raw = "value" in node && node.value !== "" ? node.value : node.textContent;
    return typeof raw === "string" ? cleanText(raw) : "";
  }
  function parseNotes(doc) {
    const notes = new Map;
    for (const node of doc.querySelectorAll("[id^='favnote_']")) {
      const gid = NOTE_ID.exec(node.id)?.[1];
      if (gid === undefined || notes.has(gid)) {
        continue;
      }
      const text = noteText(node);
      if (text) {
        notes.set(gid, text);
      }
    }
    return notes;
  }
  function parseFavorites(doc, url) {
    const list = parseListPage(doc, url);
    const tabs = parseFolderTabs(doc);
    return {
      url,
      folders: tabs.folders,
      active: parseActive(tabs, url),
      order: parseOrder(doc, url),
      items: list.items,
      notes: parseNotes(doc),
      search: urlParam(url, "f_search")?.trim() ?? "",
      nextHref: list.nextHref,
      prevHref: list.prevHref,
      summary: list.resultText
    };
  }

  // src/parse/gallery.ts
  function backgroundUrl(node) {
    if (!node || !("style" in node)) {
      return null;
    }
    const match = /url\(["']?(.*?)["']?\)/.exec(node.style.backgroundImage);
    return match?.[1] ?? null;
  }
  function inlineSize(node) {
    if (!node || !("style" in node)) {
      return null;
    }
    const { width, height } = node.style;
    const parsed = { width: Number.parseFloat(width), height: Number.parseFloat(height) };
    return parsed.width > 0 && parsed.height > 0 ? parsed : null;
  }
  function scriptValue(doc, name) {
    const pattern = new RegExp(`(?:^|[;\\s])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`, "m");
    for (const script of doc.querySelectorAll("script")) {
      if (script.getAttribute("src") !== null) {
        continue;
      }
      const match = pattern.exec(script.textContent);
      const value = match?.[1] ?? match?.[2] ?? match?.[3];
      if (value !== undefined) {
        return value;
      }
    }
    return null;
  }
  function parseGalleryApiConfig(doc) {
    const apiUrl = scriptValue(doc, "api_url");
    const apiUid = scriptValue(doc, "apiuid");
    const apiKey = scriptValue(doc, "apikey");
    const gid = scriptValue(doc, "gid");
    const token = scriptValue(doc, "token");
    if (!apiUrl || !apiUid || !apiKey || !gid || !token) {
      return null;
    }
    return { apiUrl, apiUid, apiKey, gid, token };
  }
  function parseTags(doc, url) {
    const groups = [];
    for (const row of doc.querySelectorAll("#taglist tr")) {
      const ns = cleanText(row.querySelector("td.tc")?.textContent).replace(/:$/, "");
      const anchors = [...row.querySelectorAll("td a[href*='/tag/']")];
      if (!ns || anchors.length === 0) {
        continue;
      }
      groups.push({
        ns,
        tags: anchors.map((anchor) => {
          const [name = "", ...note] = cleanText(anchor.textContent).split(" | ");
          const trimmed = note.join(" | ").trim();
          return {
            name: name.trim(),
            href: anchorHref(anchor, url) ?? "",
            note: trimmed === "" ? null : trimmed
          };
        })
      });
    }
    return groups;
  }
  function parseThumbs(doc, url) {
    const grid = doc.getElementById("gdt");
    if (!grid) {
      return [];
    }
    const thumbs = [];
    const spriteCounts = new Map;
    [...grid.children].forEach((node, index) => {
      if (node.localName !== "a") {
        return;
      }
      const tile = node.querySelector("div[style]");
      if (!tile) {
        return;
      }
      const sprite = backgroundUrl(tile);
      if (!sprite) {
        return;
      }
      const width = Number.parseFloat(tile.style.width) || 100;
      const height = Number.parseFloat(tile.style.height) || 100;
      const x = Number.parseFloat(tile.style.backgroundPositionX || tile.style.backgroundPosition) || 0;
      const labelMatch = /Page\s+(\d+)/i.exec(tile.title);
      const label = labelMatch?.[1] ? Number.parseInt(labelMatch[1], 10) : index + 1;
      thumbs.push({
        href: anchorHref(node, url) ?? "",
        label,
        sprite,
        x,
        width,
        height,
        spriteCount: 1
      });
      spriteCounts.set(sprite, (spriteCounts.get(sprite) ?? 0) + 1);
    });
    for (const thumb of thumbs) {
      thumb.spriteCount = spriteCounts.get(thumb.sprite) ?? 1;
    }
    return thumbs;
  }
  function bodyText(node) {
    if (!node) {
      return "";
    }
    if (node.nodeType === 3) {
      return node.textContent ?? "";
    }
    if (node.nodeName === "BR") {
      return `
`;
    }
    return [...node.childNodes].map((child) => bodyText(child)).join("");
  }
  function normalizeBody(text) {
    return text.replace(/\r\n?/g, `
`).replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).trim();
  }
  function signedNumber(value) {
    const match = /^\s*([+-]?\d[\d,]*)/.exec(value ?? "");
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function commentIsEditable(block, id) {
    if (block.querySelector(`#comment_edit_${id}, [data-comment-edit="${id}"]`)) {
      return true;
    }
    for (const control of block.querySelectorAll("a, button")) {
      if (/^edit$/iu.test(cleanText(control.textContent))) {
        return true;
      }
    }
    return false;
  }
  function parseComments(doc, url) {
    const comments = [];
    for (const block of doc.querySelectorAll("#cdiv .c1")) {
      const body = block.querySelector(".c6[id^='comment_']");
      const idText = body?.id.startsWith("comment_") ? body.id.slice("comment_".length) : "";
      const id = Number.parseInt(idText, 10);
      if (!Number.isFinite(id)) {
        continue;
      }
      const header = block.querySelector(".c3");
      const authorAnchor = header?.querySelector("a[href*='/uploader/']");
      const postedText = cleanText(header?.textContent);
      const posted = /Posted on\s+(.+?)\s+by:/i.exec(postedText)?.[1] ?? postedText;
      const scoreNode = block.querySelector("[id^='comment_score_']");
      const voteNode = block.querySelector("[id^='cvotes_']");
      const marker = block.querySelector(".c4 a[name='ulcomment']");
      comments.push({
        id,
        author: cleanText(authorAnchor?.textContent),
        authorHref: anchorHref(authorAnchor ?? null, url),
        posted,
        body: normalizeBody(bodyText(body)),
        score: signedNumber(scoreNode?.textContent),
        votes: cleanText(voteNode?.textContent) || null,
        uploader: marker !== null,
        editable: commentIsEditable(block, id)
      });
    }
    return comments;
  }
  function popupTarget(doc, fragment, url) {
    const anchor = doc.querySelector(`a[onclick*='${fragment}']`);
    const onclick = anchor?.getAttribute("onclick") ?? "";
    const match = /popUp\(\s*(['"])(.*?)\1/.exec(onclick);
    if (!match?.[2]) {
      return null;
    }
    return safeUrl(match[2].replace(/&amp;/g, "&"), url)?.href ?? null;
  }
  function parseActions(doc, url) {
    const report = doc.querySelector("a[href*='report=select']");
    const expunge = doc.querySelector("a[href*='act=expunge']");
    const rename = doc.getElementById("renamelink");
    const base = scriptValue(doc, "base_url") ?? url;
    const identity = galleryIdentity(url);
    const popup = rename ? safeUrl("gallerypopups.php", base) : null;
    let renameHref = null;
    if (identity && popup) {
      popup.searchParams.set("gid", identity.gid);
      popup.searchParams.set("t", identity.token);
      popup.searchParams.set("act", "rename");
      renameHref = popup.href;
    }
    return {
      archiverHref: popupTarget(doc, "archiver.php", url),
      torrentsHref: popupTarget(doc, "gallerytorrents.php", url),
      reportHref: anchorHref(report, url),
      expungeHref: anchorHref(expunge, url),
      renameHref
    };
  }
  function parsePageRange(text) {
    const match = /^Showing\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)(.*)$/iu.exec(text.trim());
    if (!match?.[1] || !match[2] || !match[3]) {
      return null;
    }
    return {
      start: parseNumber(match[1]) ?? 0,
      end: parseNumber(match[2]) ?? 0,
      total: parseNumber(match[3]) ?? 0,
      suffix: match[4] ?? ""
    };
  }
  function formatPageRange(range) {
    const number = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    const total = number(range.total);
    return `Showing ${number(range.start)} - ${number(range.end)} of ${total}${range.suffix}`;
  }
  function parsePaging(doc, url) {
    const summary = cleanText(doc.querySelector(".gpc")?.textContent);
    const pageRange = parsePageRange(summary);
    if (pageRange === null) {
      return { prevHref: null, nextHref: null, summary, pageRange: null };
    }
    const { start, end, total } = pageRange;
    const current = new URL(url);
    const rawPage = current.searchParams.get("p");
    const urlPage = rawPage === null ? 0 : Math.max(0, Number.parseInt(rawPage, 10) || 0);
    const inferredSize = urlPage > 0 ? Math.round((start - 1) / urlPage) : 0;
    const pageSize = Math.max(1, inferredSize || end - start + 1);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = rawPage === null ? Math.max(0, Math.floor((start - 1) / pageSize)) : urlPage;
    const pageUrl = (index) => {
      const next = new URL(current.href);
      if (index === 0) {
        next.searchParams.delete("p");
      } else {
        next.searchParams.set("p", String(index));
      }
      return next.href;
    };
    return {
      prevHref: page > 0 ? pageUrl(page - 1) : null,
      nextHref: page + 1 < pageCount ? pageUrl(page + 1) : null,
      summary,
      pageRange
    };
  }
  function parseFavorite2(doc) {
    const star = doc.querySelector("#fav div");
    const text = cleanText(doc.getElementById("favoritelink")?.textContent);
    const folder = text === "" || /^add to favorites$/i.test(text) ? "" : text;
    const offset = /background-position:\s*0(?:px)?\s+-(\d+)px/i.exec(star?.getAttribute("style") ?? "")?.[1];
    const index = offset === undefined ? null : Math.floor((Number(offset) - 2) / 19);
    const slot = index !== null && index >= 0 && index < 10 ? index : null;
    if (star === null && folder === "") {
      return null;
    }
    return { folder, slot };
  }
  function parseGalleryPage(doc, url) {
    const identity = galleryIdentity(url);
    if (!identity) {
      throw new Error(`Invalid gallery URL: ${url}`);
    }
    const metadata = new Map;
    for (const row of doc.querySelectorAll("#gdd tr")) {
      const label = cleanText(row.querySelector(".gdt1")?.textContent).replace(/:$/, "");
      const value = row.querySelector(".gdt2");
      if (label && value) {
        metadata.set(label, value);
      }
    }
    const categoryNode = doc.querySelector("#gdc .cs");
    const tags = parseTags(doc, url);
    const thumbs = parseThumbs(doc, url);
    const paging = parsePaging(doc, url);
    const heading = cleanText(doc.getElementById("gn")?.textContent);
    if (heading === "" && thumbs.length === 0) {
      throw new HttpError(404, url);
    }
    const title = heading || "Untitled";
    const alternateTitle = cleanText(doc.getElementById("gj")?.textContent) || null;
    const uploaderNode = doc.querySelector("#gdn a[href*='/uploader/']");
    const parentAnchor = metadata.get("Parent")?.querySelector("a") ?? null;
    const parentHref = parentAnchor ? anchorHref(parentAnchor, url) ?? "" : null;
    const lengthText = cleanText(metadata.get("Length")?.textContent);
    const ratingText = cleanText(doc.getElementById("rating_label")?.textContent);
    const ratingMatch = /Average:\s*([\d.]+)/i.exec(ratingText);
    const ratingCount = parseNumber(doc.getElementById("rating_count")?.textContent) ?? parseNumber(metadata.get("Rating")?.textContent);
    const apiConfig = parseGalleryApiConfig(doc);
    const displayRating = Number.parseFloat(scriptValue(doc, "display_rating") ?? "");
    const ratingClass = doc.getElementById("rating_image")?.getAttribute("class") ?? "";
    const rated = /\bir[rgb]\b/.test(ratingClass);
    const ratingInfo = {
      average: ratingMatch?.[1] ? Number.parseFloat(ratingMatch[1]) : null,
      votes: ratingCount,
      user: rated && Number.isFinite(displayRating) ? Math.min(5, Math.max(0, displayRating)) : null
    };
    const coverNode = doc.querySelector("#gd1 div[style*='background']");
    return {
      url,
      gid: identity.gid,
      token: identity.token,
      title: parseTitle(title),
      alternateTitle,
      category: categoryFromNode(categoryNode),
      uploader: uploaderNode ? { name: cleanText(uploaderNode.textContent), href: anchorHref(uploaderNode, url) ?? "" } : null,
      posted: cleanText(metadata.get("Posted")?.textContent),
      parentHref,
      size: cleanText(metadata.get("File Size")?.textContent),
      pageCount: parseNumber(lengthText) ?? thumbs.length,
      favCount: parseNumber(doc.getElementById("favcount")?.textContent),
      rating: ratingMatch?.[1] ? Number.parseFloat(ratingMatch[1]) : null,
      ratingCount,
      favorite: parseFavorite2(doc),
      tags,
      thumbs,
      coverSrc: backgroundUrl(coverNode),
      coverSize: inlineSize(coverNode),
      pageSummary: paging.summary,
      pageRange: paging.pageRange,
      firstPageHref: thumbs[0]?.href ?? null,
      prevHref: paging.prevHref,
      nextHref: paging.nextHref,
      comments: parseComments(doc, url),
      ratingInfo,
      actions: parseActions(doc, url),
      visible: cleanText(metadata.get("Visible")?.textContent) || null,
      apiConfig
    };
  }

  // src/parse/pager.ts
  function pagerTable(doc) {
    return doc.querySelector("table.ptt, table.ptb");
  }
  function pagerPages(table) {
    if (!table) {
      return [];
    }
    const pages = [];
    for (const cell of table.querySelectorAll("td")) {
      const text = cleanText(cell.textContent);
      if (/^\d+$/.test(text)) {
        pages.push(Number.parseInt(text, 10));
      }
    }
    return pages;
  }
  function pagerCurrent(table) {
    if (!table) {
      return null;
    }
    for (const cell of table.querySelectorAll("td.ptds")) {
      const page = parseNumber(cleanText(cell.textContent));
      if (page !== null) {
        return page;
      }
    }
    return null;
  }
  function pagerArrows(table, base) {
    const arrows = { prevHref: null, nextHref: null };
    if (!table) {
      return arrows;
    }
    for (const anchor of table.querySelectorAll("a[href]")) {
      const label = cleanText(anchor.textContent);
      if (label === "<" && arrows.prevHref === null) {
        arrows.prevHref = anchorHref(anchor, base);
      } else if (label === ">" && arrows.nextHref === null) {
        arrows.nextHref = anchorHref(anchor, base);
      }
    }
    return arrows;
  }

  // src/parse/toplist.ts
  var CATEGORIES2 = [
    { base: 10, name: "Galleries" },
    { base: 20, name: "Uploader" },
    { base: 30, name: "Tagging" },
    { base: 40, name: "Hentai@Home" },
    { base: 50, name: "EHTracker" },
    { base: 60, name: "Cleanup" },
    { base: 70, name: "Rating & Reviewing" }
  ];
  var PERIODS = [
    { digit: "1", name: "All-Time" },
    { digit: "2", name: "Past Year" },
    { digit: "3", name: "Past Month" },
    { digit: "5", name: "Yesterday" }
  ];
  function periodFor(key, label) {
    const digit = key.slice(-1);
    const byDigit = PERIODS.find((period) => period.digit === digit);
    if (byDigit) {
      return byDigit.name;
    }
    return PERIODS.find((period) => label.endsWith(period.name))?.name ?? "";
  }
  function labelFor(rawLabel, period) {
    if (period !== "" && rawLabel.endsWith(period)) {
      const stripped = cleanText(rawLabel.slice(0, -period.length));
      if (stripped !== "") {
        return stripped;
      }
    }
    return rawLabel;
  }
  function toplistKey(url) {
    return url === null ? null : safeUrl(url)?.searchParams.get("tl") ?? null;
  }
  function buildTabs(sources, requested) {
    const seen = new Set;
    const tabs = [];
    for (const source of sources) {
      if (seen.has(source.key)) {
        continue;
      }
      seen.add(source.key);
      const group = periodFor(source.key, source.label);
      tabs.push({
        label: labelFor(source.label, group),
        href: source.href,
        group,
        active: source.key === requested
      });
    }
    return tabs;
  }
  function catalogueSources(url) {
    const base = safeUrl(url);
    const sources = [];
    for (const category of CATEGORIES2) {
      for (const period of PERIODS) {
        const key = String(category.base + Number.parseInt(period.digit, 10));
        const path = `/toplist.php?tl=${key}`;
        sources.push({
          key,
          href: base ? new URL(path, base).href : path,
          label: `${category.name} ${period.name}`
        });
      }
    }
    return sources;
  }
  function galleryMetrics(doc, url) {
    const metrics = new Map;
    for (const row of doc.querySelectorAll("table.itg tr")) {
      const gid = galleryIdentity(anchorHref(row.querySelector("a[href*='/g/']"), url))?.gid;
      const cell = row.querySelector("td");
      if (!gid || !cell) {
        continue;
      }
      const lines = [...cell.querySelectorAll("p")].map((line) => cleanText(line.textContent));
      metrics.set(gid, {
        rank: parseNumber(lines[0]) ?? metrics.size + 1,
        score: lines[1] || null
      });
    }
    return metrics;
  }
  function galleryEntries(doc, url) {
    const page = parseListPage(doc, url);
    const metrics = galleryMetrics(doc, url);
    return page.items.map((item, index) => {
      const metric = metrics.get(item.gid);
      return {
        rank: metric?.rank ?? index + 1,
        label: item.title.primary,
        href: item.href,
        gid: item.gid,
        score: metric?.score ?? null,
        uploader: item.uploader,
        uploaderHref: item.uploaderHref,
        posted: item.posted,
        pages: item.pages,
        category: item.category,
        torrentsHref: item.torrentsHref
      };
    });
  }
  function userEntries(doc, url) {
    const entries = [];
    for (const row of doc.querySelectorAll("table.itg tr")) {
      const ranks = [...row.querySelectorAll("td.dr")];
      const scores = [...row.querySelectorAll("td.ds")];
      const links = [...row.querySelectorAll("td.du a[href]")];
      for (const [index, cell] of ranks.entries()) {
        const rank = parseNumber(cell.textContent);
        if (rank === null) {
          continue;
        }
        const anchor = links[index];
        entries.push({
          rank,
          label: cleanText(anchor?.textContent) || cleanText(cell.textContent),
          href: anchorHref(anchor ?? null, url),
          gid: null,
          score: cleanText(scores[index]?.textContent) || null,
          uploader: null,
          uploaderHref: null,
          posted: "",
          pages: null,
          category: null,
          torrentsHref: null
        });
      }
    }
    return entries.sort((a, b) => a.rank - b.rank);
  }
  function parsePager(doc, url) {
    const table = pagerTable(doc);
    if (!table) {
      return null;
    }
    return {
      page: pagerCurrent(table) ?? 1,
      pages: pagerPages(table).reduce((max, page) => Math.max(max, page), 1),
      ...pagerArrows(table, url)
    };
  }
  function parseEntries(block, url) {
    const entries = [];
    for (const row of block.querySelectorAll("tr")) {
      const rankNode = row.querySelector("td.pso");
      const anchor = row.querySelector("div.tun a[href]") ?? row.querySelector("td a[href]");
      if (!rankNode && !anchor) {
        continue;
      }
      const href = anchorHref(anchor, url);
      const label = cleanText(anchor?.textContent) || cleanText(row.querySelector("td:last-child")?.textContent);
      if (label === "" && href === null) {
        continue;
      }
      const gid = galleryIdentity(href)?.gid ?? null;
      entries.push({
        rank: parseNumber(rankNode?.textContent) ?? entries.length + 1,
        label,
        href,
        gid,
        score: null,
        uploader: null,
        uploaderHref: null,
        posted: "",
        pages: null,
        category: null,
        torrentsHref: null
      });
    }
    return entries;
  }
  function parseOverview(doc, url) {
    const sections = [];
    for (const block of doc.querySelectorAll(".tdo")) {
      const title = cleanText(block.querySelector("p a[href]")?.textContent);
      const entries = parseEntries(block, url);
      if (title === "" && entries.length === 0) {
        continue;
      }
      sections.push({ title, entries });
    }
    const sources = [];
    for (const anchor of doc.querySelectorAll(".tdo p a[href]")) {
      const href = anchorHref(anchor, url);
      const key = toplistKey(href);
      if (href !== null && key !== null) {
        sources.push({ key, href, label: cleanText(anchor.textContent) });
      }
    }
    const tabs = buildTabs(sources, toplistKey(url));
    return { kind: "overview", tabs, sections };
  }
  function categoryTitle(doc) {
    const crumb = cleanText(doc.querySelector("h1.ih a[href*='tl=']")?.textContent);
    return crumb !== "" ? crumb : cleanText(doc.querySelector("h1.ih")?.textContent);
  }
  function parseCategory(doc, url) {
    const tabs = buildTabs(catalogueSources(url), toplistKey(url));
    const entries = galleryEntries(doc, url);
    return {
      kind: "category",
      url,
      tabs,
      title: categoryTitle(doc),
      entries: entries.length > 0 ? entries : userEntries(doc, url),
      pager: parsePager(doc, url)
    };
  }
  function parseToplist(doc, url) {
    if (doc.querySelector(".tdo")) {
      return parseOverview(doc, url);
    }
    if (doc.querySelector("table.itg")) {
      return parseCategory(doc, url);
    }
    return { kind: "overview", tabs: [], sections: [] };
  }

  // src/parse/torrents.ts
  function statusFromUrl(url) {
    const status = url?.searchParams.get("s");
    if (status === "seeded" || status === "unseeded") {
      return status;
    }
    return "all";
  }
  function pageFromUrl(url) {
    const raw = url?.searchParams.get("page");
    if (raw === null || raw === undefined) {
      return 1;
    }
    const zeroBased = Number.parseInt(raw, 10);
    return Number.isInteger(zeroBased) && zeroBased > 0 ? zeroBased + 1 : 1;
  }
  function parseSummary(doc) {
    for (const node of doc.querySelectorAll("p.ip")) {
      const text = cleanText(node.textContent);
      if (parsePageRange(text) === null) {
        continue;
      }
      return text;
    }
    return null;
  }
  function rowCells(row) {
    return [...row.children].filter((child) => child.classList.contains("itd"));
  }
  function parseRow(row, base) {
    const cells = rowCells(row);
    const [addedCell, nameCell, galleryCell, sizeCell, seedsCell, peersCell, downloadsCell] = cells;
    const uploaderCell = cells[7];
    if (!addedCell || !nameCell || !galleryCell || !sizeCell || !seedsCell || !peersCell || !downloadsCell || !uploaderCell) {
      return null;
    }
    const nameAnchor = nameCell.querySelector("a");
    const name = cleanText(nameAnchor?.textContent) || cleanText(nameCell.textContent);
    if (!name) {
      return null;
    }
    const galleryHref = anchorHref(galleryCell.querySelector("a"), base);
    const rowId = row.getAttribute("id");
    const uploaderLink = uploaderCell.querySelector("a");
    return {
      gid: galleryGid(galleryHref) ?? (rowId !== null && /^\d+$/.test(rowId) ? rowId : null),
      name,
      torrentHref: anchorHref(nameAnchor, base),
      galleryHref,
      size: cleanText(sizeCell.textContent),
      seeds: parseNumber(seedsCell.textContent) ?? 0,
      peers: parseNumber(peersCell.textContent) ?? 0,
      downloads: parseNumber(downloadsCell.textContent) ?? 0,
      uploader: cleanText(uploaderLink?.textContent) || cleanText(uploaderCell.textContent) || null,
      uploaderHref: anchorHref(uploaderLink, base),
      added: cleanText(addedCell.textContent)
    };
  }
  function parseTorrents2(doc, url) {
    const parsedUrl = safeUrl(url);
    const pager = pagerTable(doc);
    const rows = [];
    for (const row of doc.querySelectorAll("table.itg tr")) {
      const parsedRow = parseRow(row, url);
      if (parsedRow) {
        rows.push(parsedRow);
      }
    }
    const summary = parseSummary(doc);
    const uploader = parsedUrl?.searchParams.get("u")?.trim() ?? "";
    return {
      url,
      rows,
      status: statusFromUrl(parsedUrl),
      uploaderFilter: uploader === "" ? null : uploader,
      search: parsedUrl?.searchParams.get("search")?.trim() ?? "",
      sort: parsedUrl?.searchParams.get("o")?.trim() || null,
      summary,
      page: pageFromUrl(parsedUrl),
      pages: pagerPages(pager),
      ...pagerArrows(pager, url)
    };
  }

  // src/parse/uconfig.ts
  var SKIPPED_INPUT_TYPES = {
    submit: true,
    button: true,
    reset: true,
    image: true,
    file: true
  };
  var INLINE_LABEL_TAGS = {
    SPAN: true,
    B: true,
    STRONG: true,
    EM: true,
    LABEL: true
  };
  function isInput(node) {
    return node.tagName === "INPUT";
  }
  function isSelect(node) {
    return node.tagName === "SELECT";
  }
  function isTextarea(node) {
    return node.tagName === "TEXTAREA";
  }
  function isElement(node) {
    return node.nodeType === 1;
  }
  function textOrNull(value) {
    const text = cleanText(value);
    return text === "" ? null : text;
  }
  function normalizeLabel(value) {
    return textOrNull(value.replace(/\s*[:：]\s*$/, ""));
  }
  function inputType(input) {
    return (input.getAttribute("type") ?? "text").toLowerCase();
  }
  function leadingLabel(control) {
    const parent = control.parentElement;
    if (!parent) {
      return null;
    }
    let before = "";
    let sibling = control.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 3) {
        before = `${sibling.textContent}${before}`;
        sibling = sibling.previousSibling;
        continue;
      }
      if (isElement(sibling) && INLINE_LABEL_TAGS[sibling.tagName] === true) {
        before = `${sibling.textContent}${before}`;
        sibling = sibling.previousSibling;
        continue;
      }
      break;
    }
    const inline = normalizeLabel(before);
    if (inline !== null) {
      return inline;
    }
    if (parent.tagName === "TD") {
      const cell = parent.previousElementSibling;
      if (cell?.tagName === "TD") {
        return normalizeLabel(cell.textContent);
      }
    }
    return null;
  }
  function explanationText(control) {
    const cell = control.closest("td");
    const next = cell?.nextElementSibling;
    return next?.tagName === "TD" ? cleanText(next.textContent) : "";
  }
  function tableLabel(control) {
    const cell = control.closest("td");
    const row = cell?.parentElement;
    const table = row?.closest("table");
    const headers = table?.querySelector("tr");
    if (!cell || !row || !table || !headers) {
      return null;
    }
    const column = [...row.children].indexOf(cell);
    if (column < 0) {
      return null;
    }
    const rowLabel = cleanText(row.querySelector("td, th")?.textContent);
    const columnLabel = cleanText(headers.children[column]?.textContent);
    const parts = [rowLabel, columnLabel].filter((part) => part !== "");
    return parts.length === 0 ? null : parts.join(" · ");
  }
  function checkboxLabel(input) {
    const own = textOrNull(input.closest("label")?.textContent ?? "");
    return own ?? tableLabel(input);
  }
  function radioOption(input) {
    return {
      value: input.getAttribute("value") ?? "on",
      label: textOrNull(input.closest("label")?.textContent ?? "") ?? "",
      selected: input.hasAttribute("checked"),
      disabled: input.hasAttribute("disabled")
    };
  }
  function categoryKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function categorySwitchShown(value) {
    return value === "0";
  }
  function categorySwitchValue(shown) {
    return shown ? "0" : "1";
  }
  function categoryFor(name, value) {
    if (!name.startsWith("ct_")) {
      return null;
    }
    const key = categoryKey(name.slice("ct_".length));
    const category = CATEGORIES.find((candidate) => categoryKey(candidate.name) === key);
    return category ? {
      bit: category.bit,
      name: category.name,
      cls: category.cls,
      shown: categorySwitchShown(value)
    } : null;
  }
  function radioField(name, inputs, prompt) {
    const options = inputs.map(radioOption);
    const selected = options.find((option) => option.selected);
    const enabled = options.find((option) => !option.disabled);
    return {
      name,
      kind: "radio",
      prompt,
      label: null,
      value: selected?.value ?? enabled?.value ?? "",
      options,
      category: null,
      disabled: options.length > 0 && options.every((option) => option.disabled)
    };
  }
  function checkboxField(input, prompt) {
    const checked = input.hasAttribute("checked");
    return {
      name: input.getAttribute("name") ?? "",
      kind: "checkbox",
      prompt,
      label: checkboxLabel(input),
      value: checked ? input.getAttribute("value") ?? "on" : "",
      options: [],
      category: null,
      disabled: input.hasAttribute("disabled")
    };
  }
  function selectField(select) {
    const rawOptions = [...select.options].map((option) => ({
      value: option.value,
      label: cleanText(option.textContent),
      selected: option.hasAttribute("selected"),
      disabled: option.hasAttribute("disabled")
    }));
    let selectedIndex = -1;
    rawOptions.forEach((option, index) => {
      if (option.selected) {
        selectedIndex = index;
      }
    });
    const options = selectedIndex === -1 && rawOptions.length > 0 ? rawOptions.map((option, index) => ({ ...option, selected: index === 0 })) : rawOptions;
    return {
      name: select.getAttribute("name") ?? "",
      kind: "select",
      prompt: "",
      label: leadingLabel(select),
      value: options.find((option) => option.selected)?.value ?? "",
      options,
      category: null,
      disabled: select.hasAttribute("disabled")
    };
  }
  function textField(input, prompt) {
    return {
      name: input.getAttribute("name") ?? "",
      kind: "text",
      prompt: prompt === "" ? explanationText(input) : prompt,
      label: leadingLabel(input),
      value: input.getAttribute("value") ?? "",
      options: [],
      category: null,
      disabled: input.hasAttribute("disabled")
    };
  }
  function textareaField(textarea, prompt) {
    return {
      name: textarea.getAttribute("name") ?? "",
      kind: "textarea",
      prompt,
      label: leadingLabel(textarea),
      value: textarea.textContent,
      options: [],
      category: null,
      disabled: textarea.hasAttribute("disabled")
    };
  }
  function hiddenField(input) {
    const name = input.getAttribute("name") ?? "";
    const value = input.getAttribute("value") ?? "";
    return {
      name,
      kind: "hidden",
      prompt: "",
      label: null,
      value,
      options: [],
      category: categoryFor(name, value),
      disabled: input.hasAttribute("disabled")
    };
  }
  function parseBlock(block, out) {
    const prompt = cleanText(block.querySelector("p")?.textContent);
    const controls = [...block.querySelectorAll("input, select, textarea")];
    const radioGroups = new Map;
    for (const control of controls) {
      if (!isInput(control) || inputType(control) !== "radio") {
        continue;
      }
      const name = control.getAttribute("name");
      if (name === null || name.trim() === "" || name === "-") {
        continue;
      }
      const group = radioGroups.get(name);
      if (group) {
        group.push(control);
      } else {
        radioGroups.set(name, [control]);
      }
    }
    const emittedRadios = new Set;
    for (const control of controls) {
      if (isInput(control)) {
        const type = inputType(control);
        const name = control.getAttribute("name");
        if (name === null || name.trim() === "" || name === "-") {
          continue;
        }
        if (SKIPPED_INPUT_TYPES[type] === true) {
          continue;
        }
        if (type === "radio") {
          if (emittedRadios.has(name)) {
            continue;
          }
          emittedRadios.add(name);
          out.push(radioField(name, radioGroups.get(name) ?? [control], prompt));
        } else if (type === "checkbox") {
          out.push(checkboxField(control, prompt));
        } else if (type === "hidden") {
          out.push(hiddenField(control));
        } else {
          out.push(textField(control, prompt));
        }
        continue;
      }
      const name = control.getAttribute("name");
      if (name === null || name.trim() === "" || name === "-") {
        continue;
      }
      if (isSelect(control)) {
        out.push(selectField(control));
      } else if (isTextarea(control)) {
        out.push(textareaField(control, prompt));
      }
    }
  }
  function settingsContainer(doc) {
    const submit = doc.querySelector('input[name="apply"]');
    let form = submit?.closest("form") ?? null;
    if (form?.getAttribute("id") === "profile_form") {
      form = null;
    }
    if (!form) {
      for (const candidate of doc.querySelectorAll("form")) {
        if (candidate.getAttribute("id") !== "profile_form") {
          form = candidate;
          break;
        }
      }
    }
    if (!form) {
      return doc.querySelector(".optouter") ? doc : null;
    }
    let scope = form.parentElement;
    while (submit && scope && !scope.contains(submit)) {
      scope = scope.parentElement;
    }
    return scope ?? doc;
  }
  function sectionAnchor(heading) {
    const previous = heading.previousElementSibling;
    if (previous?.tagName !== "A") {
      return "";
    }
    return previous.getAttribute("name") ?? previous.getAttribute("id") ?? "";
  }
  function parseUconfig(doc) {
    const container = settingsContainer(doc);
    if (!container) {
      return [];
    }
    const sections = [];
    let current = null;
    for (const marker of container.querySelectorAll("h2, .optouter")) {
      if (marker.tagName === "H2") {
        current = {
          anchor: sectionAnchor(marker),
          title: cleanText(marker.textContent),
          fields: []
        };
        sections.push(current);
      } else if (current) {
        parseBlock(marker, current.fields);
      }
    }
    return sections.filter((section) => section.fields.length > 0);
  }
  function uconfigBody(sections, overrides) {
    const body = new URLSearchParams;
    const emittedRadios = new Set;
    for (const section of sections) {
      for (const field of section.fields) {
        const override = overrides.get(field.name);
        switch (field.kind) {
          case "radio": {
            if (emittedRadios.has(field.name)) {
              continue;
            }
            emittedRadios.add(field.name);
            body.append(field.name, override ?? field.value);
            break;
          }
          case "checkbox": {
            const value = override ?? field.value;
            if (value !== "") {
              body.append(field.name, value);
            }
            break;
          }
          case "select":
          case "text":
          case "textarea":
          case "hidden": {
            body.append(field.name, override ?? field.value);
            break;
          }
        }
      }
    }
    body.append("apply", "Apply");
    return body;
  }

  // src/site.ts
  function siteLabel() {
    if (typeof location === "undefined") {
      return "E-Hentai";
    }
    return /(^|\.)exhentai\.org$/i.test(location.hostname) ? "ExHentai" : "E-Hentai";
  }
  function documentTitle(...parts) {
    return [...parts, siteLabel()].filter((part) => part !== "").join(" - ");
  }

  // src/data/favorites.ts
  var FOLDER_COLORS = [
    "#c8c8c8",
    "#ff7b7b",
    "#ffb057",
    "#ffe066",
    "#7ee787",
    "#b6f36b",
    "#63e6e2",
    "#8fa8ff",
    "#c792ea",
    "#ff8fd1"
  ];
  function folderColor(slot) {
    return FOLDER_COLORS[slot] ?? "#c8c8c8";
  }
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var folderCache = null;
  function memberId() {
    return /(?:^|; )ipb_member_id=(\d+)/.exec(document.cookie)?.[1] ?? null;
  }
  function isLoggedIn() {
    return memberId() !== null;
  }
  var LOGIN_WALL_TEXT = /sign in|log in|login/i;
  var FAVORITES_TEXT = /favorites/i;
  function assertSignedIn(text) {
    if (LOGIN_WALL_TEXT.test(text) && !FAVORITES_TEXT.test(text)) {
      throw new LoginRequiredError;
    }
  }
  async function getFolders(signal) {
    const account = memberId();
    if (account === null) {
      return [];
    }
    if (folderCache?.memberId === account && Date.now() - folderCache.at < CACHE_TTL) {
      return folderCache.folders;
    }
    const { doc } = await loader.document(`${location.origin}/uconfig.php`, {
      priority: priorityOf("background"),
      tag: "folders",
      signal
    });
    const inputs = doc.querySelectorAll('input[name^="favorite_"]');
    if (inputs.length === 0) {
      throw new LoginRequiredError;
    }
    const names = [];
    for (let slot = 0;slot < 10; slot++) {
      const input = doc.querySelector(`input[name="favorite_${slot}"]`);
      names.push(input?.value.trim() ?? "");
    }
    const folders = names.map((name, slot) => ({
      slot,
      name: name || `Folder ${slot}`,
      color: folderColor(slot)
    }));
    folderCache = { memberId: account, folders, at: Date.now() };
    return folders;
  }
  async function setFavorite(gallery, slot, note = "") {
    if (!isLoggedIn()) {
      throw new LoginRequiredError;
    }
    const url = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(gallery.gid)}&t=${encodeURIComponent(gallery.token)}&act=addfav`;
    const body = new URLSearchParams({
      favcat: slot === null ? "favdel" : String(slot),
      favnote: note,
      ...slot === null ? {} : { apply: "Add to Favorites" },
      update: "1"
    });
    const response = await postForm(url, body, {
      tag: "favorite",
      failure: "Favorite request failed"
    });
    assertSignedIn(await response.text());
  }
  async function getFavoriteNote(gallery, signal) {
    if (!isLoggedIn()) {
      return "";
    }
    const url = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(gallery.gid)}&t=${encodeURIComponent(gallery.token)}&act=addfav`;
    const { doc } = await loader.document(url, {
      priority: priorityOf("background"),
      tag: "favnote",
      signal
    });
    return doc.querySelector('textarea[name="favnote"]')?.value ?? "";
  }
  var FAVORITE_SLOTS = 10;
  async function submitBulk(action, gids, signal) {
    if (gids.length === 0) {
      return;
    }
    const body = new URLSearchParams({ ddact: action, apply: "Confirm" });
    for (const gid of gids) {
      body.append("modifygids[]", gid);
    }
    const response = await postForm(`${location.origin}/favorites.php`, body, {
      tag: "favorite",
      failure: "Favorite update failed",
      signal
    });
    assertSignedIn(await response.text());
  }
  async function deleteFavorites(gids, signal) {
    await submitBulk("delete", gids, signal);
  }
  async function moveFavorites(gids, slot, signal) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= FAVORITE_SLOTS) {
      throw new RangeError(`Invalid favorite folder slot: ${slot}`);
    }
    await submitBulk(`fav${slot}`, gids, signal);
  }

  // src/ui/view-scale.ts
  function bindViewScale({ signal, apply }) {
    apply(getSettings());
    const off = onSettingsChange(apply);
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(getSettings()));
    };
    window.addEventListener("resize", onResize);
    const cleanup = () => {
      off();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
    if (signal.aborted) {
      cleanup();
      return;
    }
    signal.addEventListener("abort", cleanup, { once: true });
  }

  // src/ui/card-grid.ts
  var MOBILE_WIDTH = 720;
  var MOBILE_CARD_SIZE = 150;
  function createCardGrid(signal) {
    const element = el("div", { class: "card-grid" });
    const cards = [];
    let columns = [];
    let nextColumn = 0;
    function columnCount() {
      const width = element.clientWidth || element.getBoundingClientRect().width || 0;
      if (width <= 0) {
        return 1;
      }
      const size = window.innerWidth <= MOBILE_WIDTH ? MOBILE_CARD_SIZE : getSettings().listThumbSize;
      const space = getSettings().gap;
      const fitted = Math.floor((width + space) / (size + space));
      return Math.max(1, fitted);
    }
    function rebuild(count) {
      columns = Array.from({ length: count }, () => el("div", { class: "card-column" }));
      const fragment = document.createDocumentFragment();
      fragment.append(...columns);
      element.replaceChildren(fragment);
      cards.forEach((card, index) => {
        columns[index % count]?.append(card);
      });
      nextColumn = cards.length % count;
    }
    function layout() {
      element.style.setProperty("--gap", `${getSettings().gap}px`);
      const count = columnCount();
      if (count !== columns.length) {
        rebuild(count);
      }
    }
    bindViewScale({ signal, apply: layout });
    return {
      element,
      append: (incoming) => {
        if (columns.length === 0) {
          rebuild(columnCount());
        }
        for (const card of incoming) {
          cards.push(card);
          columns[nextColumn]?.append(card);
          nextColumn = (nextColumn + 1) % columns.length;
        }
      },
      remove: (removing) => {
        const removed = new Set(removing);
        for (const card of removing) {
          card.remove();
        }
        for (let index = cards.length - 1;index >= 0; index--) {
          const card = cards[index];
          if (card !== undefined && removed.has(card)) {
            cards.splice(index, 1);
          }
        }
        nextColumn = cards.length % Math.max(1, columns.length);
      },
      refresh: layout
    };
  }

  // src/ui/error-text.ts
  function errorText(error, fallback = "Something went wrong.") {
    return error instanceof Error ? error.message : fallback;
  }

  // src/ui/jump-row.ts
  function readingLine() {
    const line = Number.parseInt(document.documentElement.style.getPropertyValue("--sticky-reading-line"), 10);
    return Number.isFinite(line) && line > 0 ? line : 96;
  }
  function syncScrollEdges(row) {
    const max = Math.max(0, row.scrollWidth - row.clientWidth);
    row.toggleAttribute("data-scrollable", max > 1);
    row.toggleAttribute("data-scrolled", row.scrollLeft > 1);
    row.toggleAttribute("data-at-end", max > 1 && row.scrollLeft >= max - 1);
  }
  function trackScrollEdges(row, signal) {
    row.addEventListener("scroll", () => syncScrollEdges(row), { passive: true, signal });
    if (signal) {
      window.addEventListener("resize", () => syncScrollEdges(row), { passive: true, signal });
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => syncScrollEdges(row));
    } else {
      syncScrollEdges(row);
    }
  }
  function revealLink(row, link) {
    if (typeof row.scrollTo !== "function") {
      return;
    }
    const start = link.offsetLeft;
    if (start >= row.scrollLeft && start + link.offsetWidth <= row.scrollLeft + row.clientWidth) {
      return;
    }
    row.scrollTo({
      left: Math.max(0, start - (row.clientWidth - link.offsetWidth) / 2),
      behavior: "smooth"
    });
  }
  function trackJumpRow({ row, links, sections }, signal) {
    let current = -1;
    let observer = null;
    let frame = 0;
    const syncEdges = () => {
      syncScrollEdges(row);
    };
    const activate = (index) => {
      if (index === current) {
        return;
      }
      current = index;
      links.forEach((link, linkIndex) => {
        if (linkIndex === index) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
      const link = links[index];
      if (link) {
        revealLink(row, link);
        syncEdges();
      }
    };
    const pick = () => {
      const viewport = window.innerHeight;
      const height = document.documentElement.scrollHeight;
      if (Number.isFinite(viewport) && height > viewport + 4 && window.scrollY + viewport >= height - 4) {
        return sections.length - 1;
      }
      const line = readingLine();
      let active = 0;
      sections.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= line) {
          active = index;
        }
      });
      return active;
    };
    const observe = () => {
      observer?.disconnect();
      observer = null;
      if (typeof IntersectionObserver === "undefined") {
        return;
      }
      const height = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      observer = new IntersectionObserver(() => activate(pick()), {
        rootMargin: `0px 0px -${Math.max(0, height - readingLine())}px 0px`
      });
      for (const section of sections) {
        observer.observe(section);
      }
    };
    const release = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      observer?.disconnect();
      observer = null;
    };
    activate(pick());
    row.addEventListener("scroll", syncEdges, { passive: true, signal });
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          syncEdges();
          observe();
        });
      });
    } else {
      syncEdges();
      observe();
    }
    window.addEventListener("resize", () => {
      observe();
      activate(pick());
      syncEdges();
    }, { passive: true, signal });
    signal.addEventListener("abort", release, { once: true });
    return activate;
  }

  // src/ui/list-header.ts
  function listHeader({ title, summary }) {
    return el("div", { class: "list-header" }, el("div", { class: "list-heading" }, el("h1", { text: title })), el("div", { class: "list-summary" }, ...summary));
  }

  // src/ui/pager.ts
  function pageHref(baseUrl, page, param) {
    const url = new URL(baseUrl);
    if (page <= 1) {
      url.searchParams.delete(param);
    } else {
      url.searchParams.set(param, String(page - 1));
    }
    return url.href;
  }
  function pageWindow(current, total) {
    const wanted = new Set([1, total, current - 1, current, current + 1]);
    const pages = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
    const out = [];
    let previous = 0;
    for (const page of pages) {
      if (previous !== 0 && page - previous > 1) {
        out.push(null);
      }
      out.push(page);
      previous = page;
    }
    return out;
  }
  function numericStrip({ current, total, href }) {
    return pageWindow(current, total).map((page) => page === null ? el("span", { class: "pager-gap", "aria-hidden": "true", text: "…" }) : page === current ? el("span", { class: "pager-num is-current", "aria-current": "page", text: String(page) }, el("span", { class: "sr-only", text: " (current page)" })) : el("a", { class: "pager-num", href: href(page), text: String(page) }));
  }
  function jumpForm(label, input, onSubmit) {
    const form = el("form", { class: "pager-jump" }, el("label", { class: "pager-jump-label", text: label }), input, el("button", { class: "btn btn-small", type: "submit", text: "Go" }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onSubmit();
    });
    return form;
  }
  function pager({
    prev,
    next,
    info = "",
    label,
    pages,
    jump,
    seek
  }) {
    const wrap = el("nav", { class: "pager", "aria-label": label });
    const numbered = pages !== undefined && pages.total > 1;
    if (prev && !numbered) {
      wrap.append(el("a", { class: "pager-btn", href: prev }, icon("arrowLeft"), el("span", { text: "Previous" })));
    }
    if (info !== "") {
      wrap.append(el("span", { class: "pager-info", text: info }));
    }
    if (numbered) {
      wrap.append(el("span", { class: "pager-nums" }, ...numericStrip(pages)));
    }
    if (next && !numbered) {
      wrap.append(el("a", { class: "pager-btn", href: next }, el("span", { text: "Next" }), icon("arrowRight")));
    }
    const paginated = numbered || prev !== null || next !== null;
    if (jump && paginated) {
      const input = el("input", {
        class: "field-input pager-jump-input",
        type: "number",
        min: 1,
        step: 1,
        inputmode: "numeric",
        value: String(jump.current),
        "aria-label": "Jump to page",
        title: "Jump to page"
      });
      wrap.append(jumpForm("Page", input, () => {
        const page = Number.parseInt(input.value, 10);
        if (Number.isFinite(page) && page >= 1) {
          jump.go(page);
        }
      }));
    }
    if (seek && paginated) {
      const input = el("input", {
        class: "field-input pager-jump-input pager-seek-input",
        type: "text",
        placeholder: "date or offset",
        "aria-label": "Seek to a date or offset",
        title: "Enter a year (2020), a date (2020-06-15), or an offset such as 1d, 2w, 3m or 1y."
      });
      const form = jumpForm("Seek", input, () => {
        const value = input.value.trim();
        if (value !== "") {
          seek.go(value);
        }
      });
      form.classList.add("pager-seek");
      wrap.append(form);
    }
    wrap.hidden = prev === null && next === null && !numbered && info === "";
    return wrap;
  }

  // src/ui/anchor.ts
  var PANEL_MARGIN = 8;
  var ANCHOR_GAP = 6;
  function viewport() {
    if (typeof window === "undefined") {
      return { width: 0, height: 0, top: 0, left: 0 };
    }
    const visual = window.visualViewport;
    if (visual && visual.height > 0) {
      return {
        width: visual.width,
        height: visual.height,
        top: visual.offsetTop,
        left: visual.offsetLeft
      };
    }
    return { width: window.innerWidth || 0, height: window.innerHeight || 0, top: 0, left: 0 };
  }
  function boxSize(node) {
    const rect = node.getBoundingClientRect();
    return {
      width: node.offsetWidth || rect.width || 0,
      height: node.offsetHeight || rect.height || 0
    };
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }
  function placePanel(panel, placement) {
    const view = viewport();
    const { anchor } = placement;
    const gap = placement.gap ?? ANCHOR_GAP;
    panel.style.right = "auto";
    if (anchor === null) {
      const size = boxSize(panel);
      const left = view.width > 0 ? (view.width - size.width) / 2 + view.left : 0;
      const top = view.height > 0 ? (view.height - size.height) / 2 + view.top : 0;
      panel.style.left = `${Math.round(Math.max(view.left + PANEL_MARGIN, left))}px`;
      panel.style.top = `${Math.round(Math.max(view.top + PANEL_MARGIN, top))}px`;
      panel.style.maxHeight = view.height > 0 ? `${view.height - PANEL_MARGIN * 2}px` : "";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const natural = boxSize(panel);
    const width = placement.minWidth === undefined ? natural.width : Math.min(Math.max(rect.width, placement.minWidth), Math.max(240, view.width - PANEL_MARGIN * 2));
    if (placement.minWidth !== undefined) {
      panel.style.width = `${Math.round(width)}px`;
    }
    const rawLeft = placement.align === "end" ? rect.right - width : rect.left;
    const left = view.width > 0 ? clamp(rawLeft, view.left + PANEL_MARGIN, view.left + view.width - width - PANEL_MARGIN) : rawLeft;
    panel.style.left = `${Math.round(left)}px`;
    const below = view.height > 0 ? view.top + view.height - rect.bottom - PANEL_MARGIN : 0;
    const above = view.height > 0 ? rect.top - view.top - PANEL_MARGIN : 0;
    const needed = natural.height + gap;
    const openBelow = view.height === 0 || needed <= below || below >= above;
    const room = openBelow ? below : above;
    const maxHeight = room > 0 ? Math.max(placement.fit?.floor ?? 0, room - gap) : 0;
    panel.style.maxHeight = maxHeight > 0 ? `${Math.round(maxHeight)}px` : "";
    if (openBelow) {
      panel.style.top = `${Math.round(rect.bottom + gap)}px`;
      panel.style.bottom = "auto";
    } else {
      panel.style.top = "auto";
      panel.style.bottom = `${Math.round(view.top + view.height - rect.top + gap)}px`;
    }
  }

  // src/ui/popover.ts
  var stack = [];
  var boundDocument = null;
  function onPointerDown(event) {
    const top = stack.at(-1);
    if (!top) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (top.panel.contains(target) || top.anchor?.contains(target) === true) {
      return;
    }
    top.close();
  }
  function onKeyDown(event) {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    const top = stack.at(-1);
    if (!top) {
      return;
    }
    event.preventDefault();
    top.close();
  }
  function focusables(panel) {
    const nodes = panel.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
    return [...nodes].filter((node) => !node.hidden && node.tabIndex >= 0);
  }
  function bind(document2) {
    if (boundDocument === document2) {
      return;
    }
    boundDocument = document2;
    document2.addEventListener("pointerdown", onPointerDown, true);
    document2.addEventListener("keydown", onKeyDown, true);
  }
  function openPopover(request) {
    const { content, anchor, role = "dialog", align = "start", minWidth } = request;
    const expanded = request.expanded ?? anchor;
    const panel = el("div", {
      class: request.className === undefined ? "eh-popover" : `eh-popover ${request.className}`,
      role,
      tabindex: "-1",
      popover: "manual"
    });
    if (request.label !== undefined) {
      panel.setAttribute("aria-label", request.label);
    }
    panel.style.position = "fixed";
    panel.style.overflowY = "auto";
    panel.append(content);
    let open = true;
    const controller = new AbortController;
    const { signal } = controller;
    const close = (restoreFocus = true) => {
      if (!open) {
        return;
      }
      open = false;
      controller.abort();
      const index = stack.findIndex((entry) => entry.panel === panel);
      if (index >= 0) {
        stack.splice(index, 1);
      }
      const active = document.activeElement;
      const heldFocus = restoreFocus && (active === null || active === undefined || panel.contains(active));
      panel.remove();
      if (expanded !== null && expanded.getAttribute("aria-haspopup") !== null) {
        expanded.setAttribute("aria-expanded", "false");
      }
      if (anchor !== null && heldFocus && typeof anchor.focus === "function") {
        anchor.focus();
      }
      request.onClose?.();
    };
    const reposition = () => {
      if (open) {
        placePanel(panel, { anchor, align, minWidth, fit: { floor: 120 } });
      }
    };
    stack.push({ panel, anchor, close: () => close() });
    bind(document);
    document.body.append(panel);
    panel.showPopover();
    if (role === "menu") {
      panel.addEventListener("keydown", (event) => {
        const items = focusables(panel);
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next = current === -1 ? step === 1 ? first : last : items[current + step];
          (next ?? (step === 1 ? first : last))?.focus();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          (event.key === "Home" ? first : last)?.focus();
        } else if (event.key === "Tab") {
          close();
        }
      }, { signal });
    }
    if (request.autoFocus === true) {
      const focusable = panel.querySelector("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])");
      (focusable ?? panel).focus();
      panel.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") {
          return;
        }
        const items = focusables(panel);
        if (items.length === 0) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = items.indexOf(document.activeElement);
        if (event.shiftKey && (current <= 0 || current === -1)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (current === items.length - 1 || current === -1)) {
          event.preventDefault();
          first?.focus();
        }
      }, { signal });
    }
    panel.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) {
        return;
      }
      if (panel.contains(next) || anchor?.contains(next) === true) {
        return;
      }
      close(false);
    }, { signal });
    if (expanded !== null && expanded.getAttribute("aria-haspopup") !== null) {
      expanded.setAttribute("aria-expanded", "true");
    }
    window.addEventListener("resize", reposition, { signal });
    window.addEventListener("scroll", reposition, { capture: true, passive: true, signal });
    if (typeof window !== "undefined" && window.visualViewport) {
      window.visualViewport.addEventListener("resize", reposition, { signal });
      window.visualViewport.addEventListener("scroll", reposition, { signal });
    }
    if (request.signal !== undefined) {
      request.signal.addEventListener("abort", () => close(false), { once: true, signal });
    }
    reposition();
    return {
      element: panel,
      close: () => close(),
      reposition,
      isOpen: () => open
    };
  }
  function bindPopover(anchor, build, options = {}, signal) {
    let current = null;
    const open = () => {
      if (current?.isOpen() === true) {
        current.reposition();
        return;
      }
      let instance = null;
      const built = build(() => instance?.close());
      let dispose = built.dispose;
      const panel = openPopover({
        ...options,
        content: built.content,
        anchor,
        signal,
        onClose: () => {
          if (current === panel) {
            current = null;
          }
          dispose?.();
          dispose = undefined;
        }
      });
      instance = panel;
      current = panel;
    };
    return {
      toggle: () => {
        if (current?.isOpen() === true) {
          current.close();
        } else {
          open();
        }
      },
      open,
      close: () => {
        current?.close();
      },
      reposition: () => {
        current?.reposition();
      },
      isOpen: () => current?.isOpen() === true
    };
  }
  function closePopovers() {
    for (const entry of [...stack].reverse()) {
      entry.close();
    }
  }

  // src/ui/stars.ts
  var HALF_STEPS = 10;
  function litHalves(value) {
    return Math.min(HALF_STEPS, Math.max(0, Math.round(value * 2)));
  }
  function halfClass(half) {
    return `rating-half ${half % 2 === 1 ? "rating-half-left" : "rating-half-right"}`;
  }
  function starGlyphs() {
    const outline = icon("star", false);
    outline.classList.add("rating-half-off");
    const filled = icon("star", true);
    filled.classList.add("rating-half-on");
    return [outline, filled];
  }
  function starRow(value) {
    if (value === null) {
      return null;
    }
    const lit = litHalves(value);
    const label = value.toFixed(1).replace(/\.0$/u, "");
    const row = el("span", {
      class: "rating-stars is-static",
      role: "img",
      "aria-label": `${label} out of 5 stars`
    });
    for (let half = 1;half <= HALF_STEPS; half++) {
      const cell = el("span", {
        class: `${halfClass(half)}${half <= lit ? " is-on" : ""}`
      });
      cell.append(...starGlyphs());
      row.append(cell);
    }
    return row;
  }

  // src/ui/text.ts
  function plural(count, singular, pluralForm = `${singular}s`) {
    return count === 1 ? singular : pluralForm;
  }
  function countText(count, singular, pluralForm) {
    return `${count} ${plural(count, singular, pluralForm)}`;
  }

  // src/ui/card-facts.ts
  function cardFactRows(item, posted) {
    const rows = [];
    if (item.category) {
      rows.push(el("span", { class: `cat-badge ${item.category.cls}`, text: item.category.name }));
    }
    const stars = starRow(item.rating);
    if (stars) {
      rows.push(stars);
    }
    if (item.posted) {
      rows.push(posted(item.posted));
    }
    if (item.pages) {
      rows.push(el("span", { text: countText(item.pages, "page") }));
    }
    return rows;
  }

  // src/ui/state-panel.ts
  function nativePageAction(href = nativeUrl()) {
    return { label: "Open native page", href, native: true };
  }
  function actionNode(action) {
    const classes = action.primary === true ? "btn btn-primary" : "btn";
    if (action.href !== undefined) {
      return el("a", {
        class: classes,
        href: action.href,
        "data-native": action.native === true ? "" : null
      }, action.label);
    }
    return el("button", {
      class: classes,
      type: "button",
      text: action.label,
      onclick: action.onClick
    });
  }
  function statePanel(options) {
    const tone = options.tone ?? "empty";
    const children = [];
    if (tone === "error") {
      children.push(el("div", { class: "state-icon", "aria-hidden": "true" }, icon("warning")));
    }
    if (options.title !== undefined) {
      const heading = (options.headingLevel ?? 2) === 1 ? "h1" : "h2";
      children.push(el(heading, { class: "state-title", text: options.title }));
    }
    children.push(el("p", { class: "state-text", text: options.text }));
    if (options.detail !== undefined) {
      children.push(el("p", { class: "state-text", text: options.detail }));
    }
    const actions = options.actions ?? [];
    if (actions.length > 0) {
      children.push(el("div", { class: "state-actions" }, ...actions.map(actionNode)));
    }
    return el("div", {
      class: tone === "error" ? "error-view" : "empty-state",
      role: tone === "error" ? "alert" : null
    }, ...children);
  }

  // src/ui/login-gate.ts
  var LOGIN_HREF = "https://forums.e-hentai.org/index.php?act=Login&CODE=00";
  function loginGate(options = {}) {
    return statePanel({
      title: options.title ?? "Sign in required",
      text: options.message ?? "This page reads your account, so it needs a signed-in session.",
      headingLevel: 1,
      actions: [
        { label: "Sign in", href: LOGIN_HREF, native: true, primary: true },
        ...options.nativeHref === undefined ? [] : [nativePageAction(options.nativeHref)]
      ]
    });
  }

  // src/ui/favmenu.ts
  var activeMenu = null;
  function closeFavoriteMenu() {
    activeMenu?.close();
    activeMenu = null;
  }
  function createStatusRegion() {
    const node = el("div", {
      class: "fav-status",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    });
    node.hidden = true;
    const write = (text) => {
      node.textContent = text;
      node.hidden = text === "";
    };
    return {
      node,
      announce(text) {
        announceInto(node, text.trim(), write);
      }
    };
  }
  function favoriteDot(color) {
    const dot = el("span", { class: "fav-dot" });
    dot.style.background = color;
    return dot;
  }
  function isCurrentFavoriteFolder(folder, snapshot) {
    if (snapshot.favorited !== true) {
      return false;
    }
    if (typeof snapshot.slot === "number") {
      return folder.slot === snapshot.slot;
    }
    const name = snapshot.folder?.trim();
    return name !== undefined && name !== "" && folder.name.toLowerCase() === name.toLowerCase();
  }
  function openFavoriteMenu(options) {
    activeMenu?.close();
    const {
      anchor,
      state,
      loadFolders = getFolders,
      loadNote = (signal) => getFavoriteNote(state, signal),
      save = setFavorite
    } = options;
    const content = el("div");
    const header = el("div", { class: "fav-head" });
    const syncHeader = () => {
      const favorited = state.get().favorited;
      header.textContent = favorited === true ? "Update favorite" : favorited === false ? "Add to favorites" : "Favorites";
    };
    syncHeader();
    const status = createStatusRegion();
    const note = el("textarea", {
      class: "field-input fav-note",
      rows: 2,
      placeholder: "Note (optional)",
      "aria-label": "Favorite note"
    });
    note.hidden = !isLoggedIn();
    const body = el("div", {}, header, status.node, note, content);
    const controller = new AbortController;
    const popover = bindPopover(anchor, () => ({
      content: body,
      dispose: () => {
        controller.abort();
        if (activeMenu?.anchor === anchor) {
          activeMenu = null;
        }
      }
    }), {
      role: "dialog",
      label: "Favorite folders",
      className: "fav-menu",
      align: "end",
      autoFocus: true
    });
    activeMenu = { close: () => popover.close(), anchor };
    popover.open();
    const nativeFavoriteUrl = `${location.origin}/gallerypopups.php?gid=${encodeURIComponent(state.gid)}&t=${encodeURIComponent(state.token)}&act=addfav`;
    const nativeLink = (label) => {
      const link = el("a", {
        class: "fav-link",
        href: nativeFavoriteUrl,
        "data-native": "",
        target: "_blank",
        rel: "noopener"
      }, label);
      return link;
    };
    const renderFolders = (folders) => {
      content.replaceChildren();
      if (!isLoggedIn()) {
        status.announce("Sign in to use favorites.");
        content.append(el("a", {
          class: "fav-link",
          href: LOGIN_HREF,
          "data-native": ""
        }, "Sign in"));
        return;
      }
      if (folders.length === 0) {
        status.announce("No favorite folders found.");
        content.append(nativeLink("Open native dialog"));
        return;
      }
      status.announce("");
      const snapshot = state.get();
      const grid = el("div", { class: "fav-grid" });
      for (const folder of folders) {
        const current = isCurrentFavoriteFolder(folder, snapshot);
        grid.append(el("button", {
          class: current ? "fav-item is-current" : "fav-item",
          type: "button",
          "aria-current": current ? "true" : null,
          onclick: () => {
            apply(folder);
          }
        }, favoriteDot(folder.color), el("span", { class: "fav-name", text: folder.name }), current ? el("span", { class: "fav-check", "aria-hidden": "true", text: "✓" }) : null));
      }
      content.append(grid);
      if (snapshot.favorited !== false) {
        content.append(el("button", {
          class: "fav-item fav-remove",
          type: "button",
          onclick: () => {
            apply(null);
          }
        }, favoriteDot("var(--color-danger)"), el("span", { class: "fav-name", text: "Remove from favorites" })));
      }
      content.append(el("a", {
        class: "fav-link",
        href: `${location.origin}/uconfig.php`,
        "data-native": "",
        target: "_blank",
        rel: "noopener",
        text: "Manage folders"
      }));
    };
    const apply = async (folder) => {
      content.replaceChildren();
      status.announce("Saving…");
      try {
        await noteLoad;
        await save(state, folder === null ? null : folder.slot, note.value.trim());
        state.set(folder !== null, folder);
        syncHeader();
        showToast(folder === null ? "Removed from favorites" : "Added to favorites");
        popover.close();
        anchor.focus();
      } catch (error) {
        const message = errorText(error, "Favorite update failed.");
        const retry = nativeLink("Retry in native dialog");
        content.replaceChildren(retry);
        status.announce(message);
        popover.reposition();
        retry.focus();
      }
    };
    status.announce("Loading folders…");
    const noteLoad = state.get().favorited === true ? loadNote(controller.signal).catch(() => "") : Promise.resolve("");
    noteLoad.then((savedNote) => {
      if (!controller.signal.aborted && note.value === "") {
        note.value = savedNote;
      }
    });
    loadFolders(controller.signal).then((folders) => {
      renderFolders(folders);
      popover.reposition();
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      const message = errorText(error, "Could not load favorite folders.");
      const retry = nativeLink("Open native dialog");
      content.replaceChildren(retry);
      status.announce(message);
      popover.reposition();
      retry.focus();
    });
  }
  function favoriteButton(state, signal) {
    const button = el("button", {
      class: "fav-btn",
      type: "button",
      "aria-label": "Favorite",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      title: "Favorite"
    });
    const sync = (snapshot = state.get()) => {
      const favorited = snapshot.favorited;
      const folder = snapshot.folder;
      const label = favorited === true ? folder === null || folder === "" ? "Favorited" : folder : "Favorite";
      button.replaceChildren(icon("star", favorited === true), el("span", { class: "fav-label", text: label }));
      button.classList.toggle("is-favorite", favorited === true);
      const action = favorited === true ? "Edit favorite" : favorited === false ? "Add to favorites" : "Favorite folders";
      button.setAttribute("aria-label", action);
      button.title = action;
    };
    sync();
    const unsubscribe = state.subscribe(sync);
    if (signal !== undefined) {
      if (signal.aborted) {
        unsubscribe();
      } else {
        signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (activeMenu?.anchor === button) {
        closeFavoriteMenu();
        return;
      }
      openFavoriteMenu({ anchor: button, state });
    });
    return button;
  }

  // src/ui/card-preview.ts
  function favoriteFact(snapshot) {
    if (snapshot.favorited !== true) {
      return null;
    }
    return el("span", {
      class: "card-preview-favorite",
      text: snapshot.folder === null || snapshot.folder === "" ? "In favorites" : `In: ${snapshot.folder}`
    });
  }
  function resultFacts(item, favorite) {
    const facts = el("div", { class: "card-preview-facts" }, ...cardFactRows(item, (text) => el("span", { text })));
    if (item.uploader) {
      facts.append(el("span", { text: item.uploader }));
    }
    const mark = favoriteFact(favorite.get());
    if (mark !== null) {
      facts.append(mark);
    }
    return facts;
  }
  function previewContent(item, favorite) {
    const content = el("div", { class: "card-preview-body" });
    const controller = new AbortController;
    const heading = el("div", {}, el("p", { class: "card-preview-title", text: item.title.primary }), item.title.secondary ? el("p", { class: "card-preview-secondary", text: item.title.secondary }) : null);
    content.append(heading);
    const facts = resultFacts(item, favorite);
    content.append(facts);
    const unsubscribe = favorite.subscribe((snapshot) => {
      const current = facts.querySelector(".card-preview-favorite");
      const next = favoriteFact(snapshot);
      if (next === null) {
        current?.remove();
      } else if (current === null) {
        facts.append(next);
      } else {
        current.replaceWith(next);
      }
    });
    const actions = el("div", { class: "card-preview-actions" }, el("a", { class: "btn btn-primary", href: item.href }, el("span", { text: "Open gallery" }), icon("arrowRight")), item.torrentsHref ? el("a", {
      class: "btn btn-ghost",
      href: item.torrentsHref,
      "data-native": "",
      target: "_blank",
      rel: "nofollow noopener"
    }, el("span", { text: "Torrents" })) : null, favoriteButton(favorite, controller.signal));
    content.append(actions);
    return {
      element: content,
      dispose: () => {
        controller.abort();
        unsubscribe();
      }
    };
  }
  function cardPreview(card, item, signal, favorite) {
    const trigger = el("button", {
      class: "card-preview-trigger",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-label": `Preview ${item.title.primary}`,
      title: "Preview"
    });
    trigger.append(icon("eye"));
    const popover = bindPopover(card, (close) => {
      const content = previewContent(item, favorite);
      content.element.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          close();
        }
      });
      return { content: content.element, dispose: content.dispose };
    }, {
      role: "dialog",
      label: `Preview: ${item.title.primary}`,
      className: "card-preview",
      autoFocus: true,
      expanded: trigger
    }, signal);
    trigger.addEventListener("click", () => popover.toggle(), { signal });
    return trigger;
  }

  // src/ui/favorite-state.ts
  function createFavoriteState(gallery, mark, known = mark !== null) {
    let snapshot = !known ? { favorited: null, folder: null, slot: null } : mark === null ? { favorited: false, folder: null, slot: null } : { favorited: true, folder: mark.folder, slot: mark.slot };
    const listeners = new Set;
    return {
      gid: gallery.gid,
      token: gallery.token,
      get: () => snapshot,
      set(favorited, folder) {
        snapshot = favorited ? { favorited: true, folder: folder?.name ?? "", slot: folder?.slot ?? null } : { favorited: false, folder: null, slot: null };
        for (const listener of listeners) {
          listener(snapshot);
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
    };
  }

  // src/ui/result-card.ts
  var MAX_COVER_ASPECT = 2.5;
  function setFavoriteMark(node, mark) {
    node.classList.toggle("is-favorite", mark !== null);
    if (mark === null) {
      node.style.removeProperty("--fav-color");
      node.removeAttribute("title");
      return;
    }
    node.style.setProperty("--fav-color", mark.slot === null ? "var(--color-accent)" : folderColor(mark.slot));
    node.title = mark.folder === "" ? "In favorites" : `In favorites: ${mark.folder}`;
  }
  function cardCover(item) {
    const link = el("a", {
      class: "card-cover",
      href: item.href,
      "aria-label": item.title.primary,
      tabindex: "-1"
    });
    const missing = () => {
      link.replaceChildren("No cover");
      link.classList.add("is-missing");
    };
    if (item.coverSrc) {
      const image = el("img", {
        src: item.coverSrc,
        alt: "",
        loading: "lazy",
        decoding: "async",
        width: item.coverSize?.width ?? null,
        height: item.coverSize?.height ?? null
      });
      const width = item.coverSize?.width;
      const height = item.coverSize?.height;
      if (width !== undefined && width > 0 && height !== undefined && height / width > MAX_COVER_ASPECT) {
        link.classList.add("is-tall-cover");
      }
      image.addEventListener("error", missing, { once: true });
      link.append(image);
    } else {
      missing();
    }
    return link;
  }
  function cardTitle(item) {
    const title = el("a", { class: "card-title", href: item.href });
    for (const meta of item.title.leading) {
      title.append(el("span", { class: "card-artist", text: `${meta.text} ` }));
    }
    title.append(el("span", { class: "card-primary", text: item.title.primary }));
    if (item.title.secondary) {
      title.append(el("span", { class: "card-secondary", text: item.title.secondary }));
    }
    return title;
  }
  function cardMeta(item) {
    const meta = el("div", { class: "card-meta" }, ...cardFactRows(item, (text) => {
      const posted = el("span", { class: "card-posted", text });
      setFavoriteMark(posted, item.favorite);
      return posted;
    }));
    if (item.torrentsHref) {
      meta.append(el("a", {
        class: "card-torrent",
        href: item.torrentsHref,
        "data-native": "",
        target: "_blank",
        rel: "nofollow noopener",
        title: "Show torrents",
        "aria-label": "Show torrents"
      }, icon("download")));
    }
    return meta;
  }
  function resultCard(item, signal, options = {}) {
    const favorite = createFavoriteState(item, item.favorite);
    const meta = cardMeta(item);
    const posted = meta.querySelector(".card-posted");
    const repaint = (snapshot) => {
      if (posted === null) {
        return;
      }
      setFavoriteMark(posted, snapshot.favorited === true ? { folder: snapshot.folder ?? "", slot: snapshot.slot } : null);
    };
    repaint(favorite.get());
    const unsubscribe = favorite.subscribe(repaint);
    signal.addEventListener("abort", unsubscribe, { once: true });
    const article = el("article", {
      class: options.className === undefined ? "card" : `card ${options.className}`
    });
    const cover = el("div", { class: "card-cover-wrap" }, cardCover(item));
    if (options.favorite !== false) {
      cover.append(favoriteButton(favorite, signal));
    }
    if (options.cover) {
      cover.append(options.cover);
    }
    const body = el("div", { class: "card-body" }, cardTitle(item), item.uploader ? el("div", { class: "card-uploader", text: item.uploader }) : null, meta);
    if (options.note) {
      body.append(el("p", { class: "favorites-note", title: options.note, text: options.note }));
    }
    if (options.preview === true) {
      body.append(cardPreview(article, item, signal, favorite));
    }
    article.append(cover, body);
    return article;
  }

  // src/data/search-history.ts
  var HISTORY_KEY = "eh:search-history:v1";
  var VERSION3 = 1;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RECENT_LIMIT = 20;
  var RECENT_TTL_MS = 90 * DAY_MS;
  function normalize(text) {
    return text.replace(/\s+/gu, " ").trim();
  }
  function isRecent(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value;
    return typeof record.text === "string" && typeof record.usedAt === "number";
  }
  var historyStore = createStore({ key: HISTORY_KEY, version: VERSION3, empty: () => [], guard: isUnknownArray }, gmStorage());
  function recentQueries(now = Date.now()) {
    const seen = new Set;
    const recent = [];
    for (const value of historyStore.read()) {
      if (!isRecent(value) || now - value.usedAt >= RECENT_TTL_MS) {
        continue;
      }
      const text = normalize(value.text);
      const key = text.toLowerCase();
      if (text === "" || seen.has(key)) {
        continue;
      }
      seen.add(key);
      recent.push({ text, usedAt: value.usedAt });
    }
    return recent.slice(0, RECENT_LIMIT);
  }
  function rememberQuery(text, now = Date.now()) {
    const normalized = normalize(text);
    if (normalized === "") {
      return;
    }
    const key = normalized.toLowerCase();
    const next = recentQueries(now).filter((entry) => entry.text.toLowerCase() !== key);
    next.unshift({ text: normalized, usedAt: now });
    historyStore.write(next.slice(0, RECENT_LIMIT));
  }
  function clearRecentQueries() {
    historyStore.write([]);
  }

  // src/search-draft.ts
  var QUERY_KEY = "eh:search-context:v1";
  var QUERY_VERSION = 1;
  var DRAFT_KEY = "eh:search-draft:v1";
  var DRAFT_VERSION = 1;
  var adapter = sessionStorageAdapter();
  var queryStore = createStore({
    key: QUERY_KEY,
    version: QUERY_VERSION,
    empty: () => "",
    guard: (value) => typeof value === "string"
  }, adapter);
  var draftStore = createStore({
    key: DRAFT_KEY,
    version: DRAFT_VERSION,
    empty: () => null,
    guard: (value) => value === null || typeof value === "string"
  }, adapter);
  var listeners2 = new Set;
  var cached = null;
  function parseStored(value) {
    if (value === "" || !URL.canParse(value, location.href)) {
      return null;
    }
    return parseSearchQuery(new URL(value, location.href));
  }
  function read() {
    const query = parseStored(queryStore.read()) ?? emptySearchQuery();
    return { query, text: draftStore.read() ?? query.text };
  }
  function isDocumentReload() {
    try {
      const [entry] = performance.getEntriesByType("navigation");
      return entry?.type === "reload";
    } catch {
      return false;
    }
  }
  function getSearchDraft() {
    cached ??= read();
    return cached;
  }
  function setSearchQuery(query) {
    const previous = getSearchDraft();
    const next = { query: { ...query }, text: query.text };
    const url = buildSearchUrl(next.query);
    cached = next;
    queryStore.write(url);
    draftStore.write(next.text);
    if (previous.text !== next.text || buildSearchUrl(previous.query) !== url) {
      notify();
    }
  }
  function setSearchDraftText(text) {
    const previous = getSearchDraft();
    if (previous.text === text) {
      return;
    }
    cached = { query: previous.query, text };
    draftStore.write(text);
    notify();
  }
  function subscribeSearchDraft(listener) {
    listeners2.add(listener);
    return () => {
      listeners2.delete(listener);
    };
  }
  function notify() {
    const state = getSearchDraft();
    for (const listener of listeners2) {
      listener(state);
    }
  }

  // src/ui/popup-window.ts
  function openPopup(url, width, height) {
    const features = `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`;
    const opened = window.open(url, "_blank", features);
    if (opened === null) {
      location.href = url;
    }
  }

  // src/ui/action-menu.ts
  function openActionMenu({ anchor, label, items, signal }) {
    closePopovers();
    const content = el("div", { class: "action-menu", role: "none" });
    let dismiss = () => {};
    for (const item of items) {
      const node = item.href === undefined ? el("button", {
        class: "action-menu-item",
        type: "button",
        role: "menuitem",
        text: item.label,
        onclick: () => {
          dismiss();
          item.run?.();
        }
      }) : (() => {
        const href = item.href;
        const popup = item.popup;
        return el("a", {
          class: "action-menu-item",
          role: "menuitem",
          href,
          "data-native": item.native === true ? "" : null,
          text: item.label,
          onclick: (event) => {
            dismiss();
            if (popup) {
              event.preventDefault();
              openPopup(href, popup.width, popup.height);
            }
          }
        });
      })();
      content.append(node);
    }
    const popover = openPopover({
      content,
      anchor,
      role: "menu",
      label,
      className: "action-menu-panel",
      autoFocus: true,
      signal
    });
    dismiss = () => popover.close();
    return popover;
  }
  function bindContextMenu(element, open, signal) {
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      open();
    }, { signal });
  }

  // src/ui/search-chips.ts
  function signGlyph(term) {
    if (term.sign === "-") {
      return "−";
    }
    if (term.sign === "~") {
      return "~";
    }
    return "+";
  }
  function chipClass(term) {
    if (term.sign === "-") {
      return "term-chip is-excluded";
    }
    if (term.sign === "~") {
      return "term-chip is-or";
    }
    return "term-chip";
  }
  function stateLabel(term) {
    if (term.sign === "-") {
      return "excluded";
    }
    if (term.sign === "~") {
      return "optional";
    }
    return "included";
  }
  function signItems(term, text, index, onSearch) {
    const items = [];
    const set = (sign, label) => {
      if (term.sign !== sign) {
        items.push({
          label,
          run: () => onSearch(setTermSign(text, term, sign), { type: "toggle", index })
        });
      }
    };
    set("", "Include in search");
    set("-", "Exclude from search");
    set("~", "Make optional (OR)");
    items.push({
      label: "Remove",
      run: () => onSearch(removeTerm(text, term), { type: "remove", index })
    });
    return items;
  }
  function chip(term, text, index, onSearch, signal) {
    const node = el("span", {
      class: chipClass(term)
    });
    const toggle = el("button", {
      class: "term-toggle",
      type: "button",
      "aria-label": `${termLabel(term)}, ${stateLabel(term)}. Remove from search. Right-click to include, exclude or make optional.`,
      title: "Click to remove · Right-click to include, exclude or make optional",
      "aria-haspopup": "menu",
      "aria-expanded": "false"
    });
    toggle.append(el("span", { class: "term-sign", "aria-hidden": "true", text: signGlyph(term) }));
    if (term.ns) {
      toggle.append(el("span", {
        class: `term-ns ns-${term.ns.id}`,
        text: term.ns.label
      }));
    }
    toggle.append(el("span", { class: "term-value", text: termLabel(term) }));
    toggle.addEventListener("click", () => {
      onSearch(removeTerm(text, term), { type: "remove", index });
    });
    bindContextMenu(toggle, () => openActionMenu({
      anchor: toggle,
      label: `Actions for ${termLabel(term)}`,
      items: signItems(term, text, index, onSearch),
      signal
    }), signal);
    node.append(toggle);
    return node;
  }
  function renderSearchChips(text, onSearch, signal) {
    const terms = parseSearchTerms(text);
    if (terms.length === 0) {
      return null;
    }
    const row = el("div", {
      class: "search-filters",
      role: "group",
      "aria-label": "Active search filters"
    });
    terms.forEach((term, index) => {
      row.append(chip(term, text, index, onSearch, signal));
    });
    const clear = el("button", {
      class: "search-filters-clear",
      type: "button",
      text: "Clear",
      title: "Clear search"
    });
    clear.addEventListener("click", () => {
      onSearch("", { type: "clear" });
    });
    row.append(clear);
    trackScrollEdges(row);
    return row;
  }

  // src/data/saved-expressions.ts
  var KEY2 = "eh:saved-expressions:v1";
  var LEGACY_QUICK_TAGS = "eh:quick-tags:v1";
  var LEGACY_SAVED_SEARCHES = "eh:saved-searches:v1";
  var VERSION4 = 1;
  var EXPRESSION_LIMIT = 30;
  function normalize2(text) {
    return text.replace(/\s+/gu, " ").trim();
  }
  function isMode(value) {
    return value === "run" || value === "toggle";
  }
  function isExpression(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value;
    return typeof record.name === "string" && typeof record.query === "string" && isMode(record.mode) && typeof record.pinned === "boolean" && typeof record.savedAt === "number";
  }
  var store2 = createStore({ key: KEY2, version: VERSION4, empty: () => [], guard: isUnknownArray }, gmStorage());
  function legacyValues2(key) {
    const raw = gmStorage().read(key);
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === "object" && raw !== null && "values" in raw) {
      const values = raw.values;
      return Array.isArray(values) ? values : [];
    }
    return [];
  }
  function migrateLegacy() {
    const quick = legacyValues2(LEGACY_QUICK_TAGS).flatMap((value) => {
      if (typeof value !== "object" || value === null) {
        return [];
      }
      const record = value;
      if (typeof record.label !== "string" || typeof record.query !== "string") {
        return [];
      }
      const query = normalize2(record.query);
      if (query === "") {
        return [];
      }
      return [
        {
          name: normalize2(record.label) || query,
          query,
          mode: "toggle",
          pinned: true,
          savedAt: 0
        }
      ];
    });
    const saved = legacyValues2(LEGACY_SAVED_SEARCHES).flatMap((value) => {
      if (typeof value !== "object" || value === null) {
        return [];
      }
      const record = value;
      if (typeof record.name !== "string" || typeof record.text !== "string") {
        return [];
      }
      const query = normalize2(record.text);
      const name = normalize2(record.name);
      if (query === "" || name === "") {
        return [];
      }
      return [
        {
          name,
          query,
          mode: "run",
          pinned: false,
          savedAt: typeof record.savedAt === "number" ? record.savedAt : 0
        }
      ];
    });
    if (quick.length === 0 && saved.length === 0) {
      return;
    }
    store2.write([...quick, ...saved].slice(0, EXPRESSION_LIMIT));
    gmStorage().remove(LEGACY_QUICK_TAGS);
    gmStorage().remove(LEGACY_SAVED_SEARCHES);
  }
  var listeners3 = new Set;
  function subscribeExpressions(listener) {
    listeners3.add(listener);
    return () => {
      listeners3.delete(listener);
    };
  }
  function notify2() {
    for (const listener of listeners3) {
      listener();
    }
  }
  function savedExpressions() {
    let values = store2.read();
    if (values.length === 0) {
      migrateLegacy();
      values = store2.read();
    }
    return values.filter(isExpression).map((entry) => ({
      name: normalize2(entry.name),
      query: normalize2(entry.query),
      mode: entry.mode,
      pinned: entry.pinned,
      savedAt: entry.savedAt
    })).filter((entry) => entry.name !== "" && entry.query !== "").sort((a, b) => b.savedAt - a.savedAt).slice(0, EXPRESSION_LIMIT);
  }
  function quickExpressions() {
    return savedExpressions().filter((entry) => entry.pinned);
  }
  function removeExpression(name) {
    const key = normalize2(name).toLowerCase();
    store2.write(savedExpressions().filter((entry) => entry.name.toLowerCase() !== key));
    notify2();
  }
  function replaceExpressions(expressions) {
    const next = expressions.map((entry) => ({
      name: normalize2(entry.name),
      query: normalize2(entry.query),
      mode: entry.mode,
      pinned: entry.pinned === true,
      savedAt: entry.savedAt
    })).filter((entry) => entry.name !== "" && entry.query !== "").slice(0, EXPRESSION_LIMIT);
    store2.write(next);
    notify2();
  }

  // src/ui/saved-expressions.ts
  var MODES = [
    { value: "run", label: "Run search" },
    { value: "toggle", label: "Toggle terms" }
  ];
  function modeSelect(value, index) {
    const select = el("select", { class: "field-select expression-mode", "aria-label": `Expression ${index + 1} action` }, ...MODES.map((mode) => el("option", { value: mode.value, text: mode.label, selected: mode.value === value })));
    return select;
  }
  function openExpressionEditor(anchor, signal, onSaved, options = {}) {
    const draft = savedExpressions().map((entry) => ({ ...entry }));
    const seed = options.seed?.trim() ?? "";
    if (seed !== "") {
      draft.push({ name: "", query: seed, mode: "run", pinned: false, savedAt: Date.now() });
    }
    const list = el("div", { class: "expression-list" });
    let panel = null;
    const focusQuery = (index) => {
      list.querySelectorAll(".expression-query")[index]?.focus();
    };
    const renderRows = (focusIndex) => {
      list.replaceChildren(...draft.map((entry, index) => {
        const name = textInput({
          class: "field-input expression-input expression-name",
          value: entry.name,
          placeholder: "Name",
          "aria-label": `Expression ${index + 1} name`
        });
        name.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, name: name.value };
          }
        });
        const query = textInput({
          class: "field-input expression-input expression-query",
          value: entry.query,
          placeholder: 'f:tag$ ~p:"other tag$"',
          "aria-label": `Expression ${index + 1} search`
        });
        query.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, query: query.value };
          }
        });
        const mode = modeSelect(entry.mode, index);
        mode.addEventListener("change", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = {
              ...current,
              mode: mode.options[mode.selectedIndex]?.value === "toggle" ? "toggle" : "run"
            };
          }
        });
        const pin = el("input", {
          type: "checkbox",
          checked: entry.pinned ? "checked" : null,
          "aria-label": `Show ${entry.name || "expression"} as a quick tag`
        });
        pin.addEventListener("change", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, pinned: pin.checked === true };
          }
        });
        const remove = el("button", {
          class: "expression-remove",
          type: "button",
          text: "×",
          title: "Remove expression",
          "aria-label": `Remove expression ${index + 1}`
        });
        remove.addEventListener("click", () => {
          draft.splice(index, 1);
          renderRows();
        });
        return el("div", { class: "expression-row" }, name, query, remove, el("div", { class: "expression-options" }, mode, el("label", { class: "check expression-pin" }, pin, el("span", { text: "Quick tag" }))));
      }));
      if (focusIndex !== undefined) {
        focusQuery(focusIndex);
      }
    };
    const add = el("button", {
      class: "btn btn-ghost btn-small",
      type: "button",
      text: "+ Add"
    });
    add.addEventListener("click", () => {
      draft.push({
        name: "",
        query: "",
        mode: "run",
        pinned: false,
        savedAt: Date.now()
      });
      renderRows(draft.length - 1);
    });
    const save = el("button", { class: "btn btn-small", type: "submit", text: "Save" });
    const cancel = el("button", {
      class: "btn btn-ghost btn-small",
      type: "button",
      text: "Cancel"
    });
    cancel.addEventListener("click", () => {
      panel?.close();
    });
    const form = el("form", { class: "expression-editor" }, el("p", { class: "expression-editor-title", text: "Saved searches and quick tags" }), el("p", {
      class: "expression-editor-hint",
      text: "Run replaces the search; Toggle adds or removes the terms. Quick tags also appear under the search field."
    }), list, el("div", { class: "expression-editor-actions" }, add, el("span", { class: "expression-editor-spacer" }), cancel, save));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      replaceExpressions(draft.map((entry) => ({
        ...entry,
        name: entry.name.trim() || entry.query.trim(),
        query: entry.query.trim()
      })));
      onSaved?.();
      panel?.close();
    });
    renderRows();
    panel = openPopover({
      content: form,
      anchor,
      label: "Saved searches and quick tags",
      className: "expression-editor-panel",
      signal,
      autoFocus: true
    });
    if (seed !== "") {
      focusQuery(draft.length - 1);
    }
  }

  // src/ui/search-history.ts
  function queryButton(text, label, onPick) {
    return el("button", { class: "search-history-query", type: "button", title: text, onclick: onPick }, el("span", { class: "search-history-name", text: label }), label === text ? null : el("span", { class: "search-history-text", text }));
  }
  function searchHistoryButton(options) {
    const button = el("button", {
      class: "topbar-history",
      type: "button",
      "aria-label": "Search history",
      title: "Recent and saved searches",
      "aria-haspopup": "dialog",
      "aria-expanded": "false"
    });
    button.append(icon("history"));
    function renderInto(container, close) {
      container.replaceChildren();
      const heading = el("h2", { class: "search-history-title", text: "Search history" });
      container.append(heading);
      const recent = recentQueries();
      if (recent.length > 0) {
        container.append(el("h3", { class: "search-history-heading", text: "Recent" }));
        const list = el("div", { class: "search-history-list" });
        for (const entry of recent) {
          list.append(queryButton(entry.text, entry.text, () => {
            close();
            options.onPick(entry.text);
          }));
        }
        container.append(list);
        const clear = el("button", {
          class: "search-history-clear",
          type: "button",
          text: "Clear recent"
        });
        clear.addEventListener("click", () => {
          clearRecentQueries();
          renderInto(container, close);
        });
        container.append(clear);
      }
      const saved = savedExpressions();
      if (saved.length > 0) {
        container.append(el("h3", { class: "search-history-heading", text: "Saved" }));
        const list = el("div", { class: "search-history-list" });
        for (const entry of saved) {
          const row = el("div", { class: "search-history-saved" });
          row.append(queryButton(entry.query, entry.name, () => {
            close();
            options.onPick(entry.query);
          }));
          const toggle = el("button", {
            class: "search-history-toggle",
            type: "button",
            text: entry.mode === "toggle" ? "±" : "+",
            "aria-label": `Toggle terms of ${entry.name}`,
            title: "Add or remove these terms"
          });
          toggle.addEventListener("click", () => {
            close();
            options.onToggle(entry.query);
          });
          const remove = el("button", {
            class: "search-history-remove",
            type: "button",
            text: "×",
            "aria-label": `Remove saved search ${entry.name}`,
            title: `Remove ${entry.name}`
          });
          remove.addEventListener("click", () => {
            removeExpression(entry.name);
            renderInto(container, close);
          });
          row.append(toggle, remove);
          list.append(row);
        }
        container.append(list);
        const edit = el("button", {
          class: "search-history-edit",
          type: "button",
          text: "Edit saved",
          title: "Edit saved searches and quick tags"
        });
        edit.addEventListener("click", () => {
          openExpressionEditor(edit, options.signal, () => {
            renderInto(container, close);
          });
        });
        container.append(edit);
      }
      if (recent.length === 0 && saved.length === 0) {
        container.append(el("p", {
          class: "search-history-empty",
          text: "No recent searches yet. Queries you submit appear here."
        }));
      }
      const saveCurrent = el("button", {
        class: "btn btn-small search-history-save-current",
        type: "button",
        text: "Save current search",
        title: "Save the current search",
        "aria-haspopup": "dialog",
        "aria-expanded": "false"
      });
      saveCurrent.addEventListener("click", () => {
        openExpressionEditor(saveCurrent, options.signal, () => {
          renderInto(container, close);
        }, { seed: options.getQuery() });
      });
      container.append(saveCurrent);
    }
    const popover = bindPopover(button, (close) => {
      const content = el("div", { class: "search-history" });
      renderInto(content, close);
      return { content };
    }, {
      role: "dialog",
      label: "Search history",
      className: "search-history-panel",
      autoFocus: true
    }, options.signal);
    button.addEventListener("click", () => popover.toggle(), { signal: options.signal });
    return button;
  }

  // src/tags/base64.ts
  function base64FromBytes(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  function bytesFromBase64(base64) {
    let binary;
    try {
      binary = atob(base64);
    } catch {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0;index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  // src/tags/mirror.ts
  var ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var ASSET_RETRY_MS = 60 * 60 * 1000;
  var DATA_REPO = "identity-morphism/better-eh";
  function assetUrls(name) {
    return [
      `https://raw.githubusercontent.com/${DATA_REPO}/master/assets/${name}`,
      `https://cdn.jsdelivr.net/gh/${DATA_REPO}@master/assets/${name}`
    ];
  }
  async function fetchAsset(urls, decode, { label, timeoutMs }) {
    for (const url of urls) {
      const controller = timeoutMs === undefined ? null : new AbortController;
      const timer = controller === null ? undefined : setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          cache: "no-cache",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { accept: "application/octet-stream" },
          ...controller === null ? {} : { signal: controller.signal }
        });
        if (!response.ok) {
          warn(`${label} returned ${response.status}`, url);
          continue;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const value = decode(bytes);
        if (value === null) {
          warn(`${label} returned invalid data`, url);
          continue;
        }
        return { value, bytes };
      } catch (error) {
        warn(`${label} failed`, url, error);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`Could not download ${label.toLowerCase()}`);
  }

  // src/tags/snapshot.ts
  function createSnapshot(options) {
    const { label, ttlMs, retryMs, load: download, readCache, writeCache, onError } = options;
    let current = null;
    let cacheRead = false;
    let inFlight = null;
    let generation = 0;
    let lastAttempt = 0;
    const listeners = new Set;
    function cached() {
      if (!cacheRead) {
        current = readCache();
        cacheRead = current !== null;
      }
      return current;
    }
    function notify(value) {
      for (const listener of listeners) {
        listener(value);
      }
    }
    function start(background) {
      const token = ++generation;
      lastAttempt = Date.now();
      let request;
      try {
        request = download();
      } catch (error) {
        request = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      const pending = request.then((value) => {
        if (token !== generation) {
          return cached()?.value ?? value;
        }
        const updated = Date.now();
        current = { value, updated };
        cacheRead = true;
        writeCache(value, updated);
        notify(value);
        return value;
      }).catch((error) => {
        if (onError === "cached") {
          if (token === generation) {
            warn(`${label} refresh failed`, error);
          }
          return cached()?.value ?? null;
        }
        throw error;
      }).finally(() => {
        if (token === generation) {
          inFlight = null;
        }
      });
      inFlight = pending;
      if (background) {
        pending.catch((error) => {
          warn(`Background ${label} refresh failed`, error);
        });
      }
      return pending;
    }
    function loadFromCache(force = false) {
      const cachedValue = cached();
      const now = Date.now();
      if (force) {
        return start(false);
      }
      if (cachedValue) {
        if (now - cachedValue.updated <= ttlMs) {
          return Promise.resolve(cachedValue.value);
        }
        if (inFlight || now - lastAttempt <= retryMs) {
          return Promise.resolve(cachedValue.value);
        }
        start(true);
        return Promise.resolve(cachedValue.value);
      }
      if (inFlight) {
        return inFlight;
      }
      return start(false);
    }
    return {
      get() {
        return cached()?.value ?? null;
      },
      updated() {
        return cached()?.updated ?? 0;
      },
      load: loadFromCache,
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      publish(value) {
        const known = cached();
        current = { value, updated: known?.updated ?? Date.now() };
        cacheRead = true;
        notify(value);
      },
      reset() {
        generation++;
        current = null;
        cacheRead = false;
        inFlight = null;
        lastAttempt = 0;
      }
    };
  }

  // src/tags/tag-counts-codec.ts
  var MAGIC = [66, 69, 84, 67];
  var VERSION5 = 1;
  var HEADER_BYTES = 11;
  var ENTRY_BYTES = 6;
  var QUANT_MAX = 255;
  function hash32(key, seed) {
    let hash = seed >>> 0;
    for (let index = 0;index < key.length; index++) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function tagKeyId(key) {
    const normalized = normaliseTagKey(key);
    const high = hash32(normalized, 2166136261);
    const low = hash32(normalized, 2654435769) & 255;
    return high * 256 + low;
  }
  function dequantiseCount(quantized, max) {
    if (quantized <= 0 || max <= 0) {
      return 0;
    }
    return Math.round(Math.expm1(quantized / QUANT_MAX * Math.log1p(max)));
  }
  function decodeTagCountsFromBytes(bytes) {
    if (bytes.length < HEADER_BYTES) {
      return null;
    }
    for (let index = 0;index < MAGIC.length; index++) {
      if (bytes[index] !== MAGIC[index]) {
        return null;
      }
    }
    if (bytes[4] !== VERSION5) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const max = view.getUint32(5, true);
    const entryCount = view.getUint16(9, true);
    if (max <= 0 || bytes.length !== HEADER_BYTES + entryCount * ENTRY_BYTES) {
      return null;
    }
    const counts = new Map;
    for (let index = 0;index < entryCount; index++) {
      const offset = HEADER_BYTES + index * ENTRY_BYTES;
      const id = (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 256 + (bytes[offset + 2] ?? 0) * 65536 + (bytes[offset + 3] ?? 0) * 16777216 + (bytes[offset + 4] ?? 0) * 4294967296;
      const quantized = bytes[offset + 5] ?? 0;
      counts.set(id, dequantiseCount(quantized, max));
    }
    return { counts, max };
  }
  function decodeTagCounts(base64) {
    const bytes = bytesFromBase64(base64);
    return bytes ? decodeTagCountsFromBytes(bytes) : null;
  }

  // src/tags/counts.ts
  var CACHE_KEY = "eh:tag-counts:v3";
  var CACHE_VERSION = 3;
  var REMOTE_URLS = assetUrls("tag-counts.bin");
  function isStoredCounts(value) {
    return isRecord(value) && typeof value.updated === "number" && typeof value.payload === "string";
  }
  var countsStore = createStore({
    key: CACHE_KEY,
    version: CACHE_VERSION,
    empty: () => ({ updated: 0, payload: "" }),
    guard: isStoredCounts
  }, gmStorage());
  function readCountsCache() {
    const stored = countsStore.read();
    if (stored.payload === "") {
      return null;
    }
    const counts = decodeTagCounts(stored.payload);
    return counts ? { value: { counts, payload: stored.payload }, updated: stored.updated } : null;
  }
  async function fetchCounts() {
    const { value, bytes } = await fetchAsset(REMOTE_URLS, decodeTagCountsFromBytes, {
      label: "Tag count mirror",
      timeoutMs: 12000
    });
    log(`Tag counts refreshed: ${value.counts.size} tags`);
    return { counts: value, payload: base64FromBytes(bytes) };
  }
  var countsSnapshot = createSnapshot({
    label: "tag counts",
    ttlMs: ASSET_TTL_MS,
    retryMs: ASSET_RETRY_MS,
    load: fetchCounts,
    readCache: readCountsCache,
    writeCache: (cached, updated) => {
      countsStore.write({ updated, payload: cached.payload });
    },
    onError: "cached"
  });
  function getTagCounts() {
    return countsSnapshot.get()?.counts ?? null;
  }
  function onTagCountsChange(listener) {
    return countsSnapshot.onChange((cached) => {
      listener(cached.counts);
    });
  }
  function loadTagCounts(force = false) {
    return countsSnapshot.load(force).then((cached) => cached?.counts ?? null);
  }

  // src/tags/index-codec.ts
  var MAGIC2 = [69, 72, 84, 73];
  var FORMAT_VERSION = 1;
  var HEADER_BYTES2 = 7;
  var MAX_NAMESPACES = 128;
  var MAX_KEYS_PER_NAMESPACE = 200000;
  var MAX_KEY_BYTES = 4096;
  function readVarint(bytes, offset) {
    let value = 0;
    let shift = 0;
    let position = offset;
    while (position < bytes.length && shift <= 21) {
      const byte = bytes[position];
      position++;
      if (byte === undefined) {
        return null;
      }
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) {
        return { value, next: position };
      }
      shift += 7;
    }
    return null;
  }
  function decodeTagVocabulary(bytes) {
    if (bytes.length < HEADER_BYTES2) {
      return null;
    }
    for (let index = 0;index < MAGIC2.length; index++) {
      if (bytes[index] !== MAGIC2[index]) {
        return null;
      }
    }
    if (bytes[4] !== FORMAT_VERSION) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const namespaceCount = view.getUint16(5, true);
    if (namespaceCount === 0 || namespaceCount > MAX_NAMESPACES) {
      return null;
    }
    let offset = HEADER_BYTES2;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const groups = new Map;
    try {
      for (let groupIndex = 0;groupIndex < namespaceCount; groupIndex++) {
        if (offset >= bytes.length) {
          return null;
        }
        const idLength = bytes[offset];
        offset++;
        if (idLength === undefined || idLength === 0 || offset + idLength + 4 > bytes.length) {
          return null;
        }
        const namespace = decoder.decode(bytes.subarray(offset, offset + idLength));
        offset += idLength;
        const keyCount = view.getUint32(offset, true);
        offset += 4;
        if (keyCount > MAX_KEYS_PER_NAMESPACE) {
          return null;
        }
        const keys = [];
        let previous = "";
        for (let keyIndex = 0;keyIndex < keyCount; keyIndex++) {
          if (offset >= bytes.length) {
            return null;
          }
          const prefix = bytes[offset];
          offset++;
          const length = readVarint(bytes, offset);
          if (prefix === undefined || length === null) {
            return null;
          }
          offset = length.next;
          if (prefix > previous.length || length.value > MAX_KEY_BYTES || offset + length.value > bytes.length) {
            return null;
          }
          const suffix = decoder.decode(bytes.subarray(offset, offset + length.value));
          offset += length.value;
          const key = previous.slice(0, prefix) + suffix;
          if (key === "") {
            return null;
          }
          keys.push(key);
          previous = key;
        }
        groups.set(namespace, keys);
      }
    } catch {
      return null;
    }
    return offset === bytes.length ? groups : null;
  }

  // src/tags/db.ts
  var CACHE_KEY2 = "eh:tag-index:v2";
  var USAGE_KEY = "eh:tag-usage:v1";
  var TAG_COMPLETIONS_KEY = "eh:tag-completions:v1";
  var CACHE_VERSION2 = 2;
  var USAGE_LIMIT = 200;
  var COMPLETION_LIMIT = 200;
  var DAY_MS2 = 24 * 60 * 60 * 1000;
  var COMPLETION_TTL_MS = 90 * DAY_MS2;
  var COMPLETION_HALF_LIFE_MS = 30 * DAY_MS2;
  var DOWNLOAD_TIMEOUT_MS = 12000;
  var INDEX_URLS = assetUrls("tag-index.bin");
  function isStoredIndex(value) {
    return isRecord(value) && typeof value.updated === "number" && isRecord(value.payload);
  }
  var indexStore = createStore({
    key: CACHE_KEY2,
    version: CACHE_VERSION2,
    empty: () => ({ updated: 0, payload: {} }),
    guard: isStoredIndex
  }, gmStorage());
  var usageStore = createStore({ key: USAGE_KEY, version: 1, empty: () => ({}), guard: isRecord }, gmStorage());
  var completionStore = createStore({ key: TAG_COMPLETIONS_KEY, version: 1, empty: () => ({}), guard: isRecord }, gmStorage());
  function tagId(ns, key) {
    return `${ns}\x00${key}`;
  }
  function maxTagCount(counts) {
    let max = 0;
    if (counts) {
      for (const count of counts.values()) {
        if (count > max) {
          max = count;
        }
      }
    }
    return max;
  }
  function buildIndex(groups, updated, counts) {
    const entries = [];
    const byNamespace = new Map;
    const lookup = new Map;
    const maxCount = maxTagCount(counts);
    for (const namespace of TAG_NAMESPACES) {
      const keys = groups.get(namespace.id);
      if (!keys || keys.length === 0) {
        continue;
      }
      const scoped = [];
      for (const key of keys) {
        const folded = fold(key);
        const count = counts?.get(tagKeyId(folded)) ?? 0;
        const entry = { ns: namespace, key, folded, count };
        entries.push(entry);
        scoped.push(entry);
        lookup.set(tagId(namespace.id, key), entry);
      }
      scoped.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      byNamespace.set(namespace.id, scoped);
    }
    return { entries, updated, lookup, byNamespace, maxCount };
  }
  function buildTagIndexFromGroups(groups, updated = Date.now(), counts) {
    const index = buildIndex(groups, updated, counts);
    if (index.entries.length === 0) {
      throw new Error("Tag database is empty");
    }
    return index;
  }
  function encodeIndex(index) {
    const payload = {};
    for (const [id, entries] of index.byNamespace) {
      payload[id] = entries.map((entry) => entry.key);
    }
    return payload;
  }
  function decodeIndex(payload, updated, counts) {
    const groups = new Map;
    for (const [id, keys] of Object.entries(payload)) {
      if (Array.isArray(keys)) {
        groups.set(id, keys.filter((key) => typeof key === "string").map(cleanTagKey).filter((key) => key !== ""));
      }
    }
    const index = buildIndex(groups, updated, counts);
    return index.entries.length === 0 ? null : index;
  }
  function withTagCounts(current, counts) {
    if (!counts) {
      return current;
    }
    const maxCount = maxTagCount(counts);
    if (maxCount === 0) {
      return current;
    }
    const entries = current.entries.map((entry) => ({
      ...entry,
      count: counts.get(tagKeyId(entry.folded)) ?? 0
    }));
    const lookup = new Map;
    const byNamespace = new Map;
    for (const entry of entries) {
      lookup.set(tagId(entry.ns.id, entry.key), entry);
      const scoped = byNamespace.get(entry.ns.id);
      if (scoped) {
        scoped.push(entry);
      } else {
        byNamespace.set(entry.ns.id, [entry]);
      }
    }
    return { entries, updated: current.updated, lookup, byNamespace, maxCount };
  }
  function readIndexCache() {
    const stored = indexStore.read();
    const counts = getTagCounts();
    const index = decodeIndex(stored.payload, stored.updated, counts?.counts);
    return index ? { value: { index, counts }, updated: stored.updated } : null;
  }
  async function fetchVocabulary() {
    const { value } = await fetchAsset(INDEX_URLS, decodeTagVocabulary, {
      label: "Tag index mirror",
      timeoutMs: DOWNLOAD_TIMEOUT_MS
    });
    return value;
  }
  async function fetchIndex() {
    try {
      const vocabulary = await fetchVocabulary();
      const counts = getTagCounts();
      const index = buildTagIndexFromGroups(vocabulary, Date.now(), counts?.counts);
      log(`Tag index downloaded: ${index.entries.length} tags`);
      return { index, counts };
    } catch (error) {
      warn("Tag vocabulary download failed", error);
      throw error;
    }
  }
  var indexSnapshot = createSnapshot({
    label: "tag index",
    ttlMs: ASSET_TTL_MS,
    retryMs: ASSET_RETRY_MS,
    load: fetchIndex,
    readCache: readIndexCache,
    writeCache: (bound, updated) => {
      indexStore.write({ updated, payload: encodeIndex(bound.index) });
    },
    onError: "throw"
  });
  function onTagIndexChange(listener) {
    return indexSnapshot.onChange(listener);
  }
  function applyTagCounts(counts) {
    const current = indexSnapshot.get();
    if (!current || current.counts === counts) {
      return;
    }
    const next = withTagCounts(current.index, counts.counts);
    if (next === current.index) {
      return;
    }
    indexSnapshot.publish({ index: next, counts });
  }
  onTagCountsChange(applyTagCounts);
  function getTagIndex() {
    return indexSnapshot.get()?.index ?? null;
  }
  async function loadTagIndex(force = false) {
    loadTagCounts().catch((error) => {
      warn("Tag popularity refresh failed", error);
    });
    const loaded = await indexSnapshot.load(force);
    if (!loaded) {
      throw new Error("Could not load the tag index");
    }
    return loaded.index;
  }
  function readTimedCounts(stored, ttl, now = Date.now()) {
    const counts = new Map;
    for (const [id, value] of Object.entries(stored)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      const count = "count" in value ? value.count : null;
      const lastUsed = "lastUsed" in value ? value.lastUsed : null;
      if (typeof count !== "number" || typeof lastUsed !== "number") {
        continue;
      }
      if (ttl !== undefined && now - lastUsed >= ttl) {
        continue;
      }
      counts.set(id, { count, lastUsed });
    }
    return counts;
  }
  function writePruned(counts, limit, write) {
    if (counts.size > limit) {
      const oldest = [...counts.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed).slice(0, counts.size - limit);
      for (const [idToDrop] of oldest) {
        counts.delete(idToDrop);
      }
    }
    write(Object.fromEntries(counts));
  }
  var usage = null;
  function readUsage() {
    if (usage) {
      return usage;
    }
    usage = readTimedCounts(usageStore.read());
    return usage;
  }
  function tagUsage() {
    return readUsage();
  }
  function recordTagUse(ns, key) {
    const current = readUsage();
    const id = tagId(ns, key);
    const previous = current.get(id);
    current.set(id, {
      count: (previous?.count ?? 0) + 1,
      lastUsed: Date.now()
    });
    writePruned(current, USAGE_LIMIT, (value) => usageStore.write(value));
  }
  function normalizePrefix(prefix) {
    return fold(prefix).trim();
  }
  function completionId(input) {
    return [input.prefixNs, normalizePrefix(input.prefix), input.ns, input.key].join("\x00");
  }
  function tagCompletions(now = Date.now()) {
    return readTimedCounts(completionStore.read(), COMPLETION_TTL_MS, now);
  }
  function recordTagCompletion(input, now = Date.now()) {
    if (normalizePrefix(input.prefix) === "") {
      return;
    }
    const completions = readTimedCounts(completionStore.read(), COMPLETION_TTL_MS, now);
    const id = completionId(input);
    const previous = completions.get(id);
    completions.set(id, { count: (previous?.count ?? 0) + 1, lastUsed: now });
    writePruned(completions, COMPLETION_LIMIT, (value) => completionStore.write(value));
  }

  // src/tags/suggest.ts
  var RECENT_LIMIT2 = 6;
  var DAY_MS3 = 24 * 60 * 60 * 1000;
  var POPULARITY_WEIGHT = 450;
  var ALIAS_BOOST = 500;
  var LANGUAGE_ALIASES = {
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
    zh: ["chinese"]
  };
  var MAINTENANCE_TAGS = {
    "already uploaded": true,
    "extraneous ads": true,
    replaced: true
  };
  function usageBoost(usage, entry, now) {
    const use = usage.get(tagId(entry.ns.id, entry.key));
    if (!use) {
      return 0;
    }
    const age = Math.max(0, now - use.lastUsed) / DAY_MS3;
    const recency = age < 1 ? 60 : age < 7 ? 40 : age < 30 ? 20 : 0;
    return Math.min(100, use.count * 10) + recency;
  }
  function completionBoost(completions, entry, prefixNs, prefix, now) {
    const remembered = completions.get(completionId({ prefixNs, prefix, ns: entry.ns.id, key: entry.key }));
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
  function scoreTag(entry, query, maxCount) {
    const key = entry.folded;
    const at = key.indexOf(query);
    if (at < 0) {
      return null;
    }
    let score;
    let kind;
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
      const factor = kind === "substring" ? 0.15 : kind === "word" ? 0.5 : 1;
      score += POPULARITY_WEIGHT * factor * (Math.log1p(entry.count) / Math.log1p(maxCount));
    }
    if (maxCount === 0) {
      const aliases = Object.hasOwn(LANGUAGE_ALIASES, query) ? LANGUAGE_ALIASES[query] : undefined;
      if (aliases !== undefined && entry.ns.id === "language" && aliases.includes(entry.folded)) {
        score += ALIAS_BOOST;
      }
    }
    return { score, at };
  }
  function namespaceSuggestions(query, tail) {
    const matches = query === "" ? TAG_NAMESPACES : TAG_NAMESPACES.filter((ns) => ns.id.startsWith(query) || ns.alias.startsWith(query));
    return matches.map((ns) => ({
      kind: "namespace",
      ns,
      tail,
      score: 2000 + ns.weight
    }));
  }
  function appliedTerms(terms, phrase) {
    const applied = new Map;
    for (const term of terms) {
      if (!isTagTerm(term) || term.ns === null) {
        continue;
      }
      if (term.start >= phrase.start && term.end <= phrase.end) {
        continue;
      }
      const id = tagIdentity(term.ns, term.value);
      if (!applied.has(id)) {
        applied.set(id, term);
      }
    }
    return applied;
  }
  function recentEntries(index, usage, limit, now) {
    return [...usage.entries()].map(([id]) => {
      const entry = index.lookup.get(id);
      if (!entry) {
        return null;
      }
      return { entry, score: usageBoost(usage, entry, now) };
    }).filter((item) => item !== null).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.entry);
  }
  function tagSuggestions(entries, query, applied, usage, now, maxCount, prefixNs, completions) {
    const items = [];
    let total = 0;
    for (const entry of entries) {
      const match = scoreTag(entry, query, maxCount);
      if (!match) {
        continue;
      }
      total++;
      items.push({
        kind: "tag",
        entry,
        score: match.score + usageBoost(usage, entry, now) + completionBoost(completions, entry, prefixNs, query, now),
        matchStart: match.at,
        matchLength: query.length,
        applied: applied.get(tagIdentity(entry.ns, entry.key)) ?? null,
        recent: usage.has(tagId(entry.ns.id, entry.key))
      });
    }
    items.sort((a, b) => b.score - a.score || a.entry.key.length - b.entry.key.length || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0) || (a.entry.ns.id < b.entry.ns.id ? -1 : 1));
    return { items, total };
  }
  function tagItems(entries, applied, usage) {
    return entries.map((entry) => ({
      kind: "tag",
      entry,
      score: 0,
      matchStart: -1,
      matchLength: 0,
      applied: applied.get(tagIdentity(entry.ns, entry.key)) ?? null,
      recent: usage.has(tagId(entry.ns.id, entry.key))
    }));
  }
  function searchPhrase(index, phrase, terms, usage, limit, now, completions) {
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
        const recent = recentEntries(index, usage, RECENT_LIMIT2, now).filter((entry) => entry.ns.id === namespace.id);
        const seen = new Set(recent.map((entry) => entry.key));
        const rest = entries.filter((entry) => !seen.has(entry.key)).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, Math.max(0, limit - recent.length));
        const items = tagItems([...recent, ...rest].slice(0, limit), applied, usage).map((item, position) => ({
          ...item,
          recent: position < recent.length
        }));
        return { term: phrase, items, total: entries.length, empty: true };
      }
      const { items, total } = tagSuggestions(entries, query, applied, usage, now, index.maxCount, namespace.id, completions);
      return { term: phrase, items: items.slice(0, limit), total, empty: false };
    }
    const query = fold(phrase.value);
    if (query === "") {
      const recent = recentEntries(index, usage, RECENT_LIMIT2, now);
      const tagItemsResult = tagItems(recent, applied, usage);
      const namespaces = namespaceSuggestions("", "");
      return {
        term: phrase,
        items: [...tagItemsResult, ...namespaces].slice(0, limit),
        total: tagItemsResult.length + namespaces.length,
        empty: true
      };
    }
    const namespaces = namespaceSuggestions(query, "");
    const { items, total } = tagSuggestions(index.entries, query, applied, usage, now, index.maxCount, "", completions);
    return {
      term: phrase,
      items: [...namespaces, ...items].slice(0, limit),
      total: total + namespaces.length,
      empty: false
    };
  }
  function phrases(text, terms, active) {
    const result = [];
    const activeIndex = terms.findIndex((term) => term.start === active.start && term.end === active.end);
    const mergeable = activeIndex > 0 && active.value !== "" && active.ns === null && !active.quoted && !active.exact;
    if (mergeable) {
      for (let start = 0;start < activeIndex; start++) {
        const first = terms[start];
        if (!first || first.quoted || first.exact) {
          continue;
        }
        if (first.ns === null && first.value === "") {
          continue;
        }
        let valid = true;
        for (let position = start + 1;position < activeIndex; position++) {
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
        const value = terms.slice(start, activeIndex + 1).map((part) => part.value).filter((part) => part !== "").join(" ");
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
          exact: false
        });
      }
    }
    result.push(active);
    return result;
  }
  function buildSuggestions(index, text, caret, usage = new Map, limit = 50, completions = new Map) {
    const now = Date.now();
    const terms = parseSearchTerms(text);
    const active = termAt(text, caret);
    let empty = null;
    for (const phrase of phrases(text, terms, active)) {
      const result = searchPhrase(index, phrase, terms, usage, limit, now, completions);
      if (result.items.length > 0) {
        return result;
      }
      empty = result;
    }
    return empty ?? { term: active, items: [], total: 0, empty: active.value === "" };
  }
  function suggestionInsertion(suggestion, sign) {
    if (suggestion.kind === "namespace") {
      return `${sign}${suggestion.ns.alias}:${suggestion.tail}`;
    }
    return formatTagToken(suggestion.entry.ns.id, suggestion.entry.key, sign);
  }
  function effectiveSign(term, exclude) {
    return exclude ? "-" : term.sign;
  }

  // src/ui/tag-combobox.ts
  var LIMIT = 50;
  var nextId = 0;
  function inputCaret(input) {
    return input.selectionStart ?? input.value.length;
  }
  function setSelection(input, position) {
    const caret = Math.max(0, Math.min(position, input.value.length));
    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(caret, caret);
      return;
    }
    try {
      input.selectionStart = caret;
      input.selectionEnd = caret;
    } catch {}
  }
  function highlight(text, start, length) {
    if (start < 0 || length <= 0) {
      return [text];
    }
    const end = start + length;
    const nodes = [
      text.slice(0, start),
      el("mark", { text: text.slice(start, end) })
    ];
    if (end < text.length) {
      nodes.push(text.slice(end));
    }
    return nodes;
  }
  function nsClass(ns) {
    return `ns-${ns.replace(/[^a-z0-9_-]/giu, "")}`;
  }
  function attachTagCombobox(options) {
    const { input } = options;
    const deps = {
      getIndex: options.deps?.getIndex ?? getTagIndex,
      loadIndex: options.deps?.loadIndex ?? loadTagIndex,
      getUsage: options.deps?.getUsage ?? tagUsage,
      recordUse: options.deps?.recordUse ?? recordTagUse,
      getCompletions: options.deps?.getCompletions ?? tagCompletions,
      recordCompletion: options.deps?.recordCompletion ?? recordTagCompletion
    };
    const signal = options.signal;
    const panelId = `eh-tag-combobox-${nextId++}`;
    const listId = `${panelId}-list`;
    let popover = null;
    let list = null;
    let countLabel = null;
    let excludeButton = null;
    let retryButton = null;
    let optionEls = [];
    let index = null;
    let state = "idle";
    let loading = null;
    let result = null;
    let active = -1;
    let excludeNext = false;
    let modifierExclude = false;
    let composing = false;
    let destroyed = false;
    let stopIndexWatch = null;
    deps.getIndex();
    stopIndexWatch = onTagIndexChange(() => {
      if (destroyed) {
        return;
      }
      const latest = deps.getIndex();
      if (latest) {
        index = latest;
        if (state === "idle") {
          state = "ready";
        }
      }
      if (isOpen()) {
        render();
      }
    });
    function enabled() {
      return getSettings().tagSuggestions;
    }
    function isOpen() {
      return popover !== null;
    }
    function excludeActive() {
      return excludeNext || modifierExclude;
    }
    function setInputAttributes(expanded) {
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-haspopup", "listbox");
      input.setAttribute("aria-autocomplete", "list");
      if (expanded) {
        input.setAttribute("aria-controls", listId);
      } else {
        input.removeAttribute("aria-controls");
      }
      input.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (!expanded) {
        input.removeAttribute("aria-activedescendant");
      }
    }
    function setActive(next) {
      active = next;
      for (const [i, node] of optionEls.entries()) {
        const selected = i === active;
        node.classList.toggle("is-active", selected);
        node.setAttribute("aria-selected", selected ? "true" : "false");
      }
      const current = active >= 0 ? optionEls[active] : null;
      if (current) {
        input.setAttribute("aria-activedescendant", current.id);
        current.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }
    function move(delta) {
      if (!isOpen() || optionEls.length === 0) {
        return;
      }
      const count = optionEls.length;
      const start = active < 0 ? delta > 0 ? -1 : 0 : active;
      setActive((start + delta + count) % count);
    }
    function row(suggestion, slot, sign) {
      const id = `${panelId}-option-${slot}`;
      const node = el("div", {
        class: "tag-option",
        id,
        role: "option",
        "aria-selected": "false"
      });
      const signLabel = sign === "-" ? "Exclude " : sign === "~" ? "Optional " : "";
      if (suggestion.kind === "namespace") {
        node.classList.add("is-namespace");
        node.append(el("span", { class: `tag-option-badge ${nsClass(suggestion.ns.id)}`, text: "ns" }), el("span", { class: "tag-option-key", text: suggestion.ns.label }), el("span", {
          class: "tag-option-meta",
          text: suggestion.tail === "" ? "namespace" : "complete namespace"
        }));
        node.setAttribute("aria-label", `${signLabel}Complete namespace ${suggestion.ns.id}${suggestion.tail === "" ? "" : ` with ${suggestion.tail}`}`);
      } else {
        const { entry } = suggestion;
        if (sign !== "") {
          node.classList.add(sign === "-" ? "is-excluded" : "is-or");
          node.append(el("span", {
            class: "tag-option-sign",
            "aria-hidden": "true",
            text: sign === "-" ? "−" : "~"
          }));
        }
        node.append(el("span", { class: `tag-option-badge ${nsClass(entry.ns.id)}`, text: entry.ns.label }));
        const key = el("span", { class: "tag-option-key" });
        key.append(...highlight(entry.key, suggestion.matchStart, suggestion.matchLength));
        node.append(key);
        if (suggestion.applied) {
          node.classList.add("is-applied");
          node.append(el("span", { class: "tag-option-meta", text: "applied" }));
          node.setAttribute("aria-label", `${entry.ns.label} ${entry.key}, already applied. Activate to remove.`);
        } else if (suggestion.recent) {
          node.append(el("span", { class: "tag-option-meta", text: "recent" }));
          node.setAttribute("aria-label", `${signLabel}${entry.ns.label} ${entry.key}, recently used`);
        } else {
          node.setAttribute("aria-label", `${signLabel}${entry.ns.label} ${entry.key}`);
        }
      }
      node.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      node.addEventListener("pointermove", () => {
        if (active !== slot) {
          setActive(slot);
        }
      });
      node.addEventListener("click", () => {
        applyAt(slot);
      });
      return node;
    }
    function renderMessage(title, detail, retry) {
      if (!list) {
        return;
      }
      optionEls = [];
      list.replaceChildren(el("div", { class: "tag-combobox-state", role: "presentation" }, el("strong", { text: title }), el("span", { text: detail })));
      if (retryButton) {
        retryButton.hidden = !retry;
      }
    }
    function render() {
      if (!popover || !list) {
        return;
      }
      if (!enabled()) {
        close();
        return;
      }
      const latest = deps.getIndex();
      if (latest) {
        index = latest;
        if (state === "idle") {
          state = "ready";
        }
      }
      if (state === "loading" && !index) {
        list.setAttribute("aria-busy", "true");
        renderMessage("Loading tags…", "The tag vocabulary is downloaded once and cached.", false);
        if (countLabel) {
          countLabel.textContent = "Loading tag list…";
        }
        return;
      }
      list.removeAttribute("aria-busy");
      if (state === "error" && !index) {
        renderMessage("Tag suggestions unavailable", "Search still works: type a tag and press Enter.", true);
        if (countLabel) {
          countLabel.textContent = "Could not load the tag list";
        }
        return;
      }
      if (!index) {
        renderMessage("Tag suggestions unavailable", "Type a tag and press Enter.", false);
        return;
      }
      const caret = inputCaret(input);
      result = buildSuggestions(index, input.value, caret, deps.getUsage(), LIMIT, deps.getCompletions());
      const sign = effectiveSign(result.term, excludeActive());
      optionEls = [];
      const fragment = document.createDocumentFragment();
      for (const [slot, suggestion] of result.items.entries()) {
        const node = row(suggestion, slot, sign);
        optionEls.push(node);
        fragment.append(node);
      }
      list.replaceChildren();
      if (optionEls.length === 0) {
        const query = result.term.value.trim();
        renderMessage("No matching tags", query === "" ? "Pick a namespace or type a tag name." : `Press Enter to search for “${query}” instead.`, false);
      } else {
        list.append(fragment);
        if (retryButton) {
          retryButton.hidden = true;
        }
      }
      setActive(-1);
      if (countLabel) {
        if (result.empty) {
          const recent = result.items.filter((item) => item.kind === "tag" && item.recent).length;
          const namespaces = result.items.filter((item) => item.kind === "namespace").length;
          const parts = [];
          if (recent > 0) {
            parts.push(`${recent} recent`);
          }
          if (namespaces > 0) {
            parts.push(countText(namespaces, "namespace"));
          }
          countLabel.textContent = parts.join(" · ");
        } else {
          countLabel.textContent = countText(result.total, "match", "matches");
        }
      }
      if (excludeButton) {
        excludeButton.setAttribute("aria-pressed", excludeActive() ? "true" : "false");
      }
      popover.reposition();
    }
    function setInputValue(term, replacement, keepOpen) {
      const edit = replaceTerm(input.value, term, replacement, keepOpen);
      if (typeof input.setRangeText === "function") {
        input.setRangeText(edit.insert, edit.from, edit.to, "end");
      } else {
        input.value = edit.text;
      }
      setSelection(input, edit.caret);
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function applyAt(slot) {
      const suggestion = result?.items[slot];
      const term = result?.term;
      if (!suggestion || !term) {
        return;
      }
      if (suggestion.kind === "tag" && suggestion.applied) {
        input.value = removeTerm(input.value, suggestion.applied);
        setSelection(input, input.value.length);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        close();
        options.onCommit?.();
        return;
      }
      const sign = effectiveSign(term, excludeActive());
      if (suggestion.kind === "namespace") {
        excludeNext = false;
        setInputValue(term, suggestionInsertion(suggestion, sign), true);
        return;
      }
      excludeNext = false;
      setInputValue(term, suggestionInsertion(suggestion, sign), false);
      deps.recordUse(suggestion.entry.ns.id, suggestion.entry.key);
      deps.recordCompletion({
        prefixNs: term.ns?.id ?? "",
        prefix: term.value,
        ns: suggestion.entry.ns.id,
        key: suggestion.entry.key
      });
      close();
      options.onCommit?.();
    }
    function startLoad() {
      if (loading || destroyed) {
        return;
      }
      const cached = deps.getIndex();
      if (cached) {
        index = cached;
        state = "ready";
        deps.loadIndex().catch(() => {});
        if (isOpen()) {
          render();
        }
        return;
      }
      state = "loading";
      if (isOpen()) {
        render();
      }
      loading = deps.loadIndex().then((built) => {
        index = built;
        state = "ready";
      }).catch(() => {
        state = "error";
      }).finally(() => {
        loading = null;
        if (isOpen()) {
          render();
        }
      });
    }
    function buildPanel() {
      if (popover) {
        return;
      }
      list = el("div", {
        class: "tag-combobox-list",
        id: listId,
        role: "listbox",
        "aria-label": "Tag suggestions"
      });
      countLabel = el("span", { class: "tag-combobox-count" });
      const hints = el("span", {
        class: "tag-combobox-hints",
        "aria-hidden": "true",
        text: "↑↓ move · Enter apply · Ctrl/Cmd exclude"
      });
      excludeButton = el("button", {
        class: "tag-combobox-exclude tag-combobox-exclude-toggle",
        type: "button",
        tabindex: "-1",
        "aria-pressed": "false",
        title: "Apply the next tag as an exclusion (hold Ctrl/Cmd)",
        text: "Exclude"
      });
      excludeButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      excludeButton.addEventListener("click", () => {
        excludeNext = !excludeNext;
        render();
      });
      retryButton = el("button", {
        class: "tag-combobox-exclude is-retry",
        type: "button",
        tabindex: "-1",
        text: "Retry",
        hidden: "hidden"
      });
      retryButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      retryButton.addEventListener("click", () => {
        state = "idle";
        startLoad();
      });
      const footer = el("div", { class: "tag-combobox-foot" }, countLabel, el("span", { class: "tag-combobox-actions" }, hints, retryButton, excludeButton));
      const handle = openPopover({
        content: list,
        anchor: input,
        label: "Tag suggestions",
        className: "tag-combobox",
        minWidth: 360,
        autoFocus: false,
        signal,
        onClose: () => {
          if (handle !== popover) {
            return;
          }
          popover = null;
          clearPanel();
        }
      });
      popover = handle;
      handle.element.id = panelId;
      handle.element.append(footer);
      handle.element.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      setInputAttributes(true);
      startLoad();
      render();
    }
    function open() {
      if (destroyed || !enabled()) {
        return;
      }
      buildPanel();
      render();
    }
    function clearPanel() {
      list = null;
      countLabel = null;
      excludeButton = null;
      retryButton = null;
      optionEls = [];
      result = null;
      active = -1;
      excludeNext = false;
      modifierExclude = false;
      setInputAttributes(false);
    }
    function close() {
      const handle = popover;
      if (!handle) {
        return;
      }
      handle.close();
      if (popover === handle) {
        popover = null;
        clearPanel();
      }
    }
    function destroy() {
      destroyed = true;
      stopIndexWatch?.();
      stopIndexWatch = null;
      close();
    }
    function onInput() {
      if (composing) {
        return;
      }
      if (!enabled()) {
        close();
        return;
      }
      if (isOpen()) {
        render();
      } else {
        open();
      }
    }
    function onFocus() {
      open();
    }
    function onBlur() {
      setTimeout(() => {
        if (destroyed) {
          return;
        }
        const focused = document.activeElement;
        if (focused !== input && popover?.element.contains(focused) !== true) {
          close();
        }
      }, 0);
    }
    function onKeyDown(event) {
      if (!enabled() || event.isComposing || composing) {
        return;
      }
      if (event.key === "Control" || event.key === "Meta") {
        if (!modifierExclude) {
          modifierExclude = true;
          render();
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.altKey || event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (!isOpen()) {
          open();
        }
        if (optionEls.length === 0) {
          return;
        }
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (!isOpen()) {
        return;
      }
      if (event.key === "Home" || event.key === "End" || event.key === "PageDown" || event.key === "PageUp") {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
          return;
        }
        if (optionEls.length === 0) {
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          setActive(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setActive(optionEls.length - 1);
        } else {
          event.preventDefault();
          move(event.key === "PageDown" ? 8 : -8);
        }
        return;
      }
      if (event.key === "Enter") {
        if (active >= 0) {
          event.preventDefault();
          event.stopPropagation();
          applyAt(active);
          return;
        }
        close();
        return;
      }
      if (event.key === "Tab") {
        close();
      }
    }
    function onKeyUp(event) {
      if (event.key === "Control" || event.key === "Meta") {
        if (modifierExclude) {
          modifierExclude = false;
          render();
        }
        return;
      }
      if (isOpen() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        render();
      }
    }
    function onCompositionStart() {
      composing = true;
    }
    function onCompositionEnd() {
      composing = false;
      if (enabled()) {
        open();
        render();
      }
    }
    function onClick() {
      if (!enabled() || composing) {
        return;
      }
      open();
      render();
    }
    input.addEventListener("input", onInput, { signal });
    input.addEventListener("focus", onFocus, { signal });
    input.addEventListener("blur", onBlur, { signal });
    input.addEventListener("keydown", onKeyDown, { signal });
    input.addEventListener("keyup", onKeyUp, { signal });
    input.addEventListener("click", onClick, { signal });
    input.addEventListener("compositionstart", onCompositionStart, { signal });
    input.addEventListener("compositionend", onCompositionEnd, { signal });
    window.addEventListener("blur", () => {
      if (modifierExclude) {
        modifierExclude = false;
        if (isOpen()) {
          render();
        }
      }
    }, { signal });
    signal?.addEventListener("abort", destroy, { once: true });
    setInputAttributes(false);
    return {
      open,
      refresh: () => {
        if (isOpen()) {
          render();
        }
      }
    };
  }

  // src/ui/topbar.ts
  var FORUMS_URL = "https://forums.e-hentai.org/";
  var WIKI_URL = "https://ehwiki.org/";
  var HENTAIVERSE_URL = "https://hentaiverse.org/";
  var TOPLIST_HOST = "e-hentai.org";
  function hasToplists(host) {
    return host === TOPLIST_HOST || host.endsWith(`.${TOPLIST_HOST}`);
  }
  function trimSlash(pathname) {
    return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }
  function matchesPath(tabPath, pathname) {
    return trimSlash(tabPath) === trimSlash(pathname);
  }
  function navSpecs(host) {
    const specs = [
      { key: "front", label: "Front Page", target: { kind: "internal", path: "/" }, primary: true },
      {
        key: "watched",
        label: "Watched",
        target: { kind: "internal", path: "/watched" },
        primary: true
      },
      {
        key: "popular",
        label: "Popular",
        target: { kind: "internal", path: "/popular" },
        primary: true
      },
      {
        key: "torrents",
        label: "Torrents",
        target: { kind: "internal", path: "/torrents.php" },
        primary: true
      },
      {
        key: "favorites",
        label: "Favorites",
        target: { kind: "internal", path: "/favorites.php" },
        primary: true,
        accountOnly: true
      },
      {
        key: "settings",
        label: "Settings",
        target: { kind: "internal", path: "/uconfig.php" },
        accountOnly: true
      },
      {
        key: "uploads",
        label: "My Uploads",
        target: { kind: "external", href: `https://upld.${location.hostname}/manage` },
        accountOnly: true
      },
      {
        key: "mytags",
        label: "My Tags",
        target: { kind: "internal", path: "/mytags" },
        accountOnly: true
      },
      { key: "home", label: "My Home", target: { kind: "internal", path: "/home.php" } },
      { key: "toplist", label: "Toplists", target: { kind: "internal", path: "/toplist.php" } },
      { key: "bounty", label: "Bounties", target: { kind: "internal", path: "/bounty.php" } },
      { key: "news", label: "News", target: { kind: "internal", path: "/news.php" } },
      { key: "lofi", label: "LoFi", target: { kind: "internal", path: "/lofi/" } },
      { key: "forums", label: "Forums", target: { kind: "external", href: FORUMS_URL } },
      { key: "wiki", label: "Wiki", target: { kind: "external", href: WIKI_URL } },
      {
        key: "hentaiverse",
        label: "HentaiVerse",
        target: { kind: "external", href: HENTAIVERSE_URL }
      }
    ];
    return hasToplists(host) ? specs : specs.filter((spec) => spec.key !== "toplist");
  }
  function resolveTabs(pathname, signedIn, host) {
    const tabs = [];
    for (const spec of navSpecs(host)) {
      if (spec.accountOnly === true && !signedIn) {
        continue;
      }
      const target = spec.target;
      tabs.push({
        label: spec.label,
        href: target.kind === "internal" ? target.path : target.href,
        external: target.kind === "external",
        active: target.kind === "internal" && matchesPath(target.path, pathname),
        primary: spec.primary === true
      });
    }
    return tabs;
  }
  var IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.userAgent);
  function focusShortcut(input, signal) {
    if (!signal) {
      return;
    }
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== "k" || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      input.focus();
      input.select();
    }, { signal });
  }
  function navLink(tab, className) {
    const link = el("a", { class: className, href: tab.href, text: tab.label });
    if (tab.external) {
      link.setAttribute("rel", "noreferrer");
      link.append(icon("external"));
    }
    if (tab.active) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
    return link;
  }
  function revealActiveTab(nav, signal) {
    const row = nav.querySelector(".topbar-tabs");
    if (row === null) {
      return;
    }
    trackScrollEdges(row, signal);
    const apply = () => {
      if (!nav.isConnected) {
        return;
      }
      const active = row.querySelector(".topbar-tab.is-active");
      if (active === null) {
        return;
      }
      const start = active.offsetLeft;
      if (start >= row.scrollLeft && start + active.offsetWidth <= row.scrollLeft + row.clientWidth) {
        return;
      }
      row.scrollLeft = Math.max(0, start - (row.clientWidth - active.offsetWidth) / 2);
      syncScrollEdges(row);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(apply);
    } else {
      apply();
    }
  }
  function siteNav(signal) {
    const nav = renderNav(location.pathname, isLoggedIn(), signal);
    nav.prepend(backButton(), brandLink());
    revealActiveTab(nav, signal);
    return el("header", { class: "topbar topbar-slim" }, nav);
  }
  function renderNav(pathname, signedIn, signal) {
    const tabs = resolveTabs(pathname, signedIn, location.hostname);
    const row = el("div", { class: "topbar-tabs" });
    for (const tab of tabs) {
      if (tab.primary) {
        row.append(navLink(tab, "topbar-tab"));
      }
    }
    const overflow = tabs.filter((tab) => !tab.primary);
    const nav = el("nav", { class: "topbar-nav", "aria-label": "Site sections" }, row);
    if (overflow.length === 0) {
      return nav;
    }
    const moreButton = el("button", {
      class: "topbar-more btn btn-ghost btn-small",
      type: "button",
      text: "More",
      "aria-haspopup": "menu",
      "aria-expanded": "false"
    });
    const popover = bindPopover(moreButton, (close) => {
      const content = el("div", { class: "topbar-more-list", role: "none" });
      for (const tab of overflow) {
        const link = navLink(tab, "topbar-more-link");
        link.setAttribute("role", "menuitem");
        link.addEventListener("click", close);
        content.append(link);
      }
      return { content };
    }, {
      role: "menu",
      label: "More site sections",
      className: "topbar-more-panel",
      align: "end",
      autoFocus: true
    }, signal);
    moreButton.addEventListener("click", () => popover.toggle());
    if (overflow.some((tab) => tab.active)) {
      moreButton.classList.add("is-active");
      moreButton.setAttribute("aria-current", "page");
    }
    nav.append(moreButton);
    return nav;
  }
  function backButton() {
    return el("button", {
      class: "icon-btn",
      type: "button",
      "aria-label": "Go back",
      title: "Back",
      onclick: () => {
        if (history.length > 1) {
          history.back();
        } else {
          location.href = "/";
        }
      }
    }, icon("back"));
  }
  function brandLink() {
    return el("a", { class: "brand", href: "/", "aria-label": `${siteLabel()} home` }, "E-H");
  }
  function renderTopbar(options) {
    const initial = getSearchDraft();
    const form = el("form", { class: "topbar-search", role: "search" });
    const input = searchInput({
      name: "f_search",
      value: initial.text,
      placeholder: "Search tags or titles",
      "aria-label": "Search tags or titles",
      "aria-keyshortcuts": "Control+K Meta+K"
    });
    const clear = el("button", {
      class: "topbar-clear",
      type: "button",
      "aria-label": "Clear search",
      title: "Clear search",
      hidden: "hidden"
    }, icon("close"));
    const hint = el("kbd", {
      class: "kbd topbar-kbd",
      "aria-hidden": "true",
      text: IS_MAC ? "⌘K" : "Ctrl K"
    });
    let combobox = null;
    const history2 = searchHistoryButton({
      getQuery: () => input.value,
      onPick: (text) => {
        setSearchDraftText(text);
        submit(text);
      },
      onToggle: (text) => {
        const next = toggleExpressionInSearch(getSearchDraft().text, text);
        setSearchDraftText(next);
        submit(next);
      },
      signal: options.signal ?? new AbortController().signal
    });
    form.append(el("span", { class: "topbar-search-icon" }, icon("search")), input, clear, hint, history2, el("button", { class: "topbar-search-submit", type: "submit", "aria-label": "Search" }, el("span", { class: "topbar-search-submit-icon" }, icon("search")), el("span", { class: "topbar-search-submit-label", text: "Search" })));
    const filters = el("div", { class: "topbar-filters", hidden: "hidden" });
    let renderedText = "";
    const chipsFromDraft = options.draftChips === true;
    function syncInputChrome() {
      filters.hidden = input.value !== renderedText || filters.childElementCount === 0;
      clear.hidden = input.value === "";
      hint.hidden = document.activeElement === input || input.value !== "";
      const row = filters.firstElementChild;
      if (!filters.hidden && row !== null) {
        syncScrollEdges(row);
      }
    }
    input.addEventListener("focus", syncInputChrome);
    input.addEventListener("blur", syncInputChrome);
    const submit = (text) => {
      rememberQuery(text);
      options.onSearch(text);
    };
    const applyChip = (text, action) => {
      if (chipsFromDraft) {
        setSearchDraftText(text);
      } else {
        submit(text);
      }
      if (action.type === "clear") {
        input.focus();
        return;
      }
      const nodes = [...filters.querySelectorAll(".term-toggle")];
      (nodes[action.index] ?? nodes[action.index - 1] ?? input).focus();
    };
    function renderFilters(text) {
      renderedText = text;
      const row = renderSearchChips(text, applyChip, options.signal);
      filters.replaceChildren();
      if (row !== null) {
        filters.append(row);
      }
      syncInputChrome();
    }
    function applyState(state) {
      if (input.value !== state.text) {
        input.value = state.text;
        combobox?.refresh();
      }
      const text = chipsFromDraft ? state.text : state.query.text;
      if (text !== renderedText) {
        renderFilters(text);
      } else {
        syncInputChrome();
      }
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(input.value);
    });
    input.addEventListener("input", () => {
      setSearchDraftText(input.value);
    });
    clear.addEventListener("click", () => {
      setSearchDraftText("");
      combobox?.refresh();
      input.focus();
    }, { signal: options.signal });
    combobox = getSettings().tagSuggestions ? attachTagCombobox({
      input,
      signal: options.signal,
      onCommit: () => setSearchDraftText(input.value)
    }) : null;
    focusShortcut(input, options.signal);
    const back = backButton();
    const main = el("div", { class: "topbar-main" }, back, brandLink(), form);
    const nav = renderNav(location.pathname, isLoggedIn(), options.signal);
    revealActiveTab(nav, options.signal);
    const element = el("header", { class: "topbar" }, main, filters, nav);
    renderFilters(chipsFromDraft ? initial.text : initial.query.text);
    const unsubscribe = subscribeSearchDraft(applyState);
    const signal = options.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        unsubscribe();
      } else {
        signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }
    return element;
  }

  // src/views/favorites-selection.ts
  function createSelection(gids) {
    const order = [...gids];
    const positions = new Map(order.map((gid, index) => [gid, index]));
    const chosen = new Set;
    const listeners = new Set;
    let anchor = null;
    const notify = () => {
      for (const listener of listeners) {
        listener();
      }
    };
    return {
      has(gid) {
        return chosen.has(gid);
      },
      get size() {
        return chosen.size;
      },
      get all() {
        return order.length > 0 && chosen.size === order.length;
      },
      get some() {
        return chosen.size > 0;
      },
      ids() {
        return order.filter((gid) => chosen.has(gid));
      },
      toggle(gid, options = {}) {
        const index = positions.get(gid);
        if (index === undefined) {
          return;
        }
        if (options.shift && anchor !== null) {
          const target = index;
          const from = Math.min(anchor, target);
          const to = Math.max(anchor, target);
          for (let cursor = from;cursor <= to; cursor += 1) {
            const entry = order[cursor];
            if (entry !== undefined) {
              chosen.add(entry);
            }
          }
          anchor = target;
          notify();
          return;
        }
        if (chosen.has(gid)) {
          chosen.delete(gid);
        } else {
          chosen.add(gid);
        }
        anchor = index;
        notify();
      },
      setAll(on) {
        let changed = anchor !== null;
        if (on) {
          for (const gid of order) {
            if (!chosen.has(gid)) {
              chosen.add(gid);
              changed = true;
            }
          }
        } else {
          changed = chosen.size > 0 || anchor !== null;
          chosen.clear();
        }
        anchor = null;
        if (changed) {
          notify();
        }
      },
      clear() {
        const changed = chosen.size > 0 || anchor !== null;
        chosen.clear();
        anchor = null;
        if (changed) {
          notify();
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
    };
  }

  // src/views/favorites.ts
  var FAVORITES_PATH = "/favorites.php";
  var ORDER_PARAM = { published: "fs_p", favorited: "fs_f" };
  function favoritesLabels(data) {
    const active = data.active === "all" ? null : data.folders.find((folder) => folder.slot === data.active) ?? null;
    return {
      heading: "Favorites",
      title: active === null ? ["Favorites"] : [active.name, "Favorites"]
    };
  }
  function folderTotal(data) {
    if (data.active === "all") {
      if (data.folders.length === 0) {
        return null;
      }
      return data.folders.reduce((total, folder) => total + folder.count, 0);
    }
    return data.folders.find((folder) => folder.slot === data.active)?.count ?? null;
  }
  function pageStart(data, total, count) {
    const rawPage = new URL(data.url).searchParams.get("page");
    const page = rawPage === null ? Number.NaN : Number(rawPage);
    const lastPageStart = Math.max(1, total - count + 1);
    if (Number.isInteger(page) && page >= 0) {
      if (page === 0) {
        return 1;
      }
      return data.nextHref === null ? lastPageStart : page * count + 1;
    }
    if (data.prevHref === null) {
      return 1;
    }
    return data.nextHref === null ? lastPageStart : null;
  }
  function summaryText(data) {
    if (data.search !== "") {
      return data.summary ?? `${data.items.length} ${plural(data.items.length, "match", "matches")}`;
    }
    const count = data.items.length;
    const items = `${count} ${plural(count, "favorite", "favorites")}`;
    const total = folderTotal(data);
    if (total === null || total < count || count === 0) {
      return data.summary ?? items;
    }
    const noun = plural(total, "favorite", "favorites");
    const start = pageStart(data, total, count);
    return start === null ? `Showing ${count} of ${total} ${noun}` : formatPageRange({ start, end: start + count - 1, total, suffix: ` ${noun}` });
  }
  function folderHref(baseUrl, active) {
    const url = new URL(FAVORITES_PATH, baseUrl);
    for (const [key, value] of new URL(baseUrl).searchParams) {
      if (key !== "favcat" && key !== "next" && key !== "prev") {
        url.searchParams.set(key, value);
      }
    }
    if (active !== "all") {
      url.searchParams.set("favcat", String(active));
    }
    return url.href;
  }
  function orderHref(baseUrl, active, order) {
    const url = new URL(folderHref(baseUrl, active));
    url.searchParams.set("inline_set", ORDER_PARAM[order]);
    return url.href;
  }
  function folderTab(label, count, href, active) {
    return el("a", {
      class: active ? "favorites-tab is-active" : "favorites-tab",
      href,
      title: label,
      "aria-current": active ? "page" : null
    }, el("span", { class: "favorites-tab-name", text: label }), el("span", { class: "favorites-tab-count", text: String(count) }));
  }
  function orderLink(baseUrl, order, label, active, current) {
    const selected = order === current;
    return el("a", {
      class: selected ? "favorites-order-link is-active" : "favorites-order-link",
      href: orderHref(baseUrl, active, order),
      "aria-current": selected ? "true" : null,
      text: label
    });
  }
  function renderFavorites(host, data, ctx, deps) {
    host.replaceChildren();
    const labels = favoritesLabels(data);
    const remove = deps?.remove ?? deleteFavorites;
    const move = deps?.move ?? moveFavorites;
    const selection = createSelection(data.items.map((item) => item.gid));
    let busy = false;
    let retryAction = null;
    let movePopover = null;
    let armedDelete = false;
    let armedCount = 0;
    let armTimer;
    const countLabel = el("span", { class: "favorites-bulk-count" });
    const statusText = el("span", { class: "favorites-bulk-status", role: "status" });
    statusText.hidden = true;
    const retryButton = el("button", {
      class: "btn btn-small favorites-retry",
      type: "button",
      text: "Retry"
    });
    const removeButton = el("button", {
      class: "btn btn-small favorites-delete",
      type: "button",
      text: "Delete"
    });
    const moveButton = el("button", {
      class: "btn btn-small favorites-move",
      type: "button",
      text: "Move to…",
      "aria-haspopup": "menu",
      "aria-expanded": "false"
    });
    const bar = el("div", { class: "favorites-bulk", role: "region", "aria-label": "Selected favorites" }, countLabel, statusText, retryButton, removeButton, moveButton);
    bar.hidden = true;
    const bulkSpacer = el("div", { class: "favorites-bulk-spacer" });
    bulkSpacer.hidden = true;
    const syncBulkSpace = () => {
      const viewport = window.innerHeight;
      if (bar.hidden || !Number.isFinite(viewport) || viewport <= 0) {
        bulkSpacer.hidden = true;
        bulkSpacer.style.height = "";
        return;
      }
      bulkSpacer.hidden = false;
      const clearance = Math.ceil(viewport - bar.getBoundingClientRect().top);
      bulkSpacer.style.height = `${Math.max(0, clearance) + 8}px`;
    };
    const selectAll = el("input", { class: "favorites-check-all", type: "checkbox" });
    const grid = createCardGrid(ctx.signal);
    const disarmDelete = () => {
      armedDelete = false;
      armedCount = 0;
      clearTimeout(armTimer);
      removeButton.classList.remove("is-armed");
      removeButton.textContent = "Delete";
    };
    const syncBar = () => {
      const total = selection.size;
      bar.hidden = total === 0;
      countLabel.textContent = `${total} selected`;
      statusText.hidden = retryAction === null;
      retryButton.hidden = retryAction === null;
      removeButton.disabled = total === 0 || busy;
      moveButton.disabled = total === 0 || busy;
      retryButton.disabled = busy;
      if (total === 0 || armedDelete && total !== armedCount) {
        disarmDelete();
      }
      selectAll.checked = selection.all;
      selectAll.indeterminate = selection.some && !selection.all;
      for (const box of grid.element.querySelectorAll(".favorites-checkbox")) {
        box.checked = selection.has(box.value);
      }
      syncBulkSpace();
    };
    const perform = async (action) => {
      if (busy || selection.size === 0) {
        return;
      }
      busy = true;
      retryAction = null;
      statusText.hidden = true;
      syncBar();
      try {
        await action.run();
        showToast(action.success);
        selection.clear();
        busy = false;
        syncBar();
        ctx.reload();
      } catch (error) {
        retryAction = action;
        statusText.textContent = errorText(error, "Favorite update failed.");
      } finally {
        busy = false;
        syncBar();
        if (retryAction !== null) {
          retryButton.focus();
        }
      }
    };
    const openMoveMenu = () => {
      movePopover?.close();
      const content = el("div", { class: "favorites-move-panel", role: "none" }, el("div", { class: "favorites-move-head", role: "presentation", text: "Move to folder" }));
      if (data.folders.length === 0) {
        content.append(el("div", { class: "favorites-move-empty", text: "No favorite folders found." }));
      }
      for (const folder of data.folders) {
        const choice = el("button", { class: "favorites-move-item", type: "button", role: "menuitem" }, el("span", { class: "favorites-move-name", text: folder.name }), el("span", { class: "favorites-move-count", text: String(folder.count) }));
        choice.addEventListener("click", () => {
          movePopover?.close();
          const gids = selection.ids();
          perform({
            run: () => move(gids, folder.slot, ctx.signal),
            success: `Moved ${gids.length} ${plural(gids.length, "favorite", "favorites")} to ${folder.name}`
          });
        }, { signal: ctx.signal });
        content.append(choice);
      }
      movePopover = openPopover({
        content,
        anchor: moveButton,
        role: "menu",
        label: "Move to folder",
        align: "end",
        autoFocus: true,
        signal: ctx.signal,
        onClose: () => {
          movePopover = null;
        }
      });
    };
    const buildCard = (item) => {
      const checkbox = el("input", {
        class: "favorites-checkbox",
        type: "checkbox",
        name: "modifygids[]",
        value: item.gid,
        "aria-label": `Select ${item.title.primary}`
      });
      let shift = false;
      checkbox.addEventListener("click", (event) => {
        shift = event.shiftKey;
      });
      checkbox.addEventListener("change", () => {
        selection.toggle(item.gid, { shift });
        shift = false;
      }, { signal: ctx.signal });
      const select = el("label", { class: "favorites-select", title: "Select favorite" }, checkbox);
      return resultCard(item, ctx.signal, {
        className: "favorites-card",
        cover: select,
        note: data.notes.get(item.gid)
      });
    };
    grid.append(data.items.map(buildCard));
    selectAll.addEventListener("change", () => {
      selection.setAll(selectAll.checked);
    }, { signal: ctx.signal });
    removeButton.addEventListener("click", () => {
      if (selection.size === 0 || busy) {
        return;
      }
      if (!armedDelete) {
        armedDelete = true;
        armedCount = selection.size;
        removeButton.classList.add("is-armed");
        removeButton.textContent = `Delete ${selection.size}?`;
        armTimer = window.setTimeout(disarmDelete, 4000);
        return;
      }
      disarmDelete();
      const gids = selection.ids();
      perform({
        run: () => remove(gids, ctx.signal),
        success: `Deleted ${gids.length} ${plural(gids.length, "favorite", "favorites")}`
      });
    }, { signal: ctx.signal });
    moveButton.addEventListener("click", openMoveMenu, { signal: ctx.signal });
    retryButton.addEventListener("click", () => {
      if (retryAction) {
        perform(retryAction);
      }
    }, { signal: ctx.signal });
    const tabs = el("nav", { class: "favorites-tabs", "aria-label": "Favorite folders" });
    let allCount = 0;
    for (const folder of data.folders) {
      allCount += folder.count;
      const active = data.active === folder.slot;
      tabs.append(folderTab(folder.name, folder.count, folderHref(data.url, folder.slot), active));
    }
    tabs.prepend(folderTab("All", allCount, folderHref(data.url, "all"), data.active === "all"));
    const order = el("div", { class: "favorites-order", role: "group", "aria-label": "Sort favorites" }, el("span", { class: "favorites-order-label", text: "Order:" }), orderLink(data.url, "published", "Published Time", data.active, data.order), orderLink(data.url, "favorited", "Favorited Time", data.active, data.order));
    const toolbar = el("div", { class: "favorites-toolbar" }, data.items.length > 0 ? el("label", { class: "check text-control" }, selectAll, el("span", { text: "Select all on this page" })) : null);
    const header = listHeader({
      title: labels.heading,
      summary: [el("span", { text: summaryText(data) })]
    });
    const footer = data.items.length === 0 ? statePanel({
      text: data.active === "all" ? "You have no favorites yet." : "This folder has no favorites yet.",
      actions: [
        ...data.active === "all" ? [] : [{ label: "Show all favorites", href: folderHref(data.url, "all") }],
        { label: "Browse galleries", href: "/", primary: true },
        nativePageAction()
      ]
    }) : pager({
      prev: data.prevHref,
      next: data.nextHref,
      label: "Favorite pages"
    });
    const search = el("form", { class: "favorites-search", role: "search" });
    const searchInput = el("input", {
      class: "field-input favorites-search-input",
      type: "search",
      name: "f_search",
      value: data.search,
      placeholder: "Search favorites",
      "aria-label": "Search favorites"
    });
    search.append(searchInput, el("button", { class: "btn btn-small", type: "submit", text: "Search" }));
    search.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new URL(folderHref(data.url, data.active));
      const text = searchInput.value.trim();
      if (text === "") {
        url.searchParams.delete("f_search");
        url.searchParams.delete("f_apply");
      } else {
        url.searchParams.set("f_search", text);
        url.searchParams.set("f_apply", "Search+Favorites");
      }
      ctx.navigate(`${url.pathname}${url.search}`);
    }, { signal: ctx.signal });
    host.append(siteNav(ctx.signal), header, search, tabs, order, toolbar);
    if (data.items.length > 0) {
      host.append(grid.element);
      grid.refresh();
    }
    host.append(bar, footer, bulkSpacer);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(syncBulkSpace);
      observer.observe(bar);
      ctx.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    }
    window.addEventListener("resize", syncBulkSpace, { passive: true, signal: ctx.signal });
    const activeTab = tabs.querySelector(".favorites-tab.is-active");
    if (activeTab !== null) {
      tabs.scrollLeft = Math.max(0, activeTab.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2);
    }
    trackScrollEdges(tabs, ctx.signal);
    const unsubscribe = selection.subscribe(syncBar);
    ctx.signal.addEventListener("abort", unsubscribe, { once: true });
    syncBar();
  }

  // src/data/gallery-actions.ts
  function readField(data, key) {
    if (typeof data !== "object" || data === null || !(key in data)) {
      return;
    }
    const record = data;
    return record[key];
  }
  function readNumber(data, key) {
    const value = readField(data, key);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function throwIfFailed(data, context) {
    if (readField(data, "login") !== undefined) {
      throw new LoginRequiredError;
    }
    const error = readField(data, "error");
    if (typeof error === "string" && error !== "") {
      throw new Error(`${context}: ${error}`);
    }
  }
  function postJson2(url, body) {
    return postJson(url, body, { tag: "gallery-action", failure: "Gallery request failed" });
  }
  async function send(config, payload, deps) {
    const post = deps.post ?? postJson2;
    return post(config.apiUrl, {
      apiuid: config.apiUid,
      apikey: config.apiKey,
      gid: config.gid,
      token: config.token,
      ...payload
    });
  }
  async function rateGallery(config, stars, deps = {}) {
    const rating = Math.min(10, Math.max(1, Math.round(stars * 2)));
    const data = await send(config, { method: "rategallery", rating }, deps);
    throwIfFailed(data, "Could not rate gallery");
    return {
      average: readNumber(data, "rating_avg"),
      votes: readNumber(data, "rating_cnt"),
      user: readNumber(data, "rating_usr")
    };
  }
  async function voteTag(config, tag, vote, deps = {}) {
    const data = await send(config, { method: "taggallery", tags: tag, vote }, deps);
    throwIfFailed(data, "Could not vote for tag");
  }
  async function voteComment(config, commentId, vote, deps = {}) {
    const data = await send(config, { method: "votecomment", comment_id: commentId, comment_vote: vote }, deps);
    throwIfFailed(data, "Could not vote for comment");
    const id = readNumber(data, "comment_id");
    const score = readNumber(data, "comment_score");
    const nextVote = readNumber(data, "comment_vote");
    if (id === null || score === null || nextVote === null) {
      throw new Error("Could not vote for comment: malformed response");
    }
    return { id, score, vote: nextVote };
  }
  async function editComment(url, commentId, text, signal) {
    await postForm(url, new URLSearchParams({ commenttext_edit: text, edit_comment: String(commentId) }), { tag: "gallery-comment", failure: "Comment edit failed", signal });
  }
  async function postComment(url, text, signal) {
    await postForm(url, new URLSearchParams({ commenttext_new: text }), {
      tag: "gallery-comment",
      failure: "Comment post failed",
      signal
    });
  }

  // src/data/my-tags.ts
  function normalizeName(name) {
    return name.replace(/\s+/gu, " ").trim().toLowerCase();
  }
  function normalizeColor(color) {
    if (color === null || color === undefined) {
      return "";
    }
    const value = color.trim().replace(/^#/, "");
    return /^[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(value) ? `#${value.toLowerCase()}` : "";
  }
  function parseUserTags(doc) {
    const tags = [];
    for (const block of doc.querySelectorAll("#usertags_outer > div[id^='usertag_']")) {
      const rawId = block.id.slice("usertag_".length);
      const id = Number.parseInt(rawId, 10);
      if (!Number.isFinite(id) || id <= 0) {
        continue;
      }
      const preview = block.querySelector(`#tagpreview_${id}`);
      const name = preview?.getAttribute("title")?.trim() ?? "";
      if (name === "") {
        continue;
      }
      const colorInput = block.querySelector(`#tagcolor_${id}`);
      const weightInput = block.querySelector(`#tagweight_${id}`);
      const weight = Number.parseInt(weightInput?.value ?? "", 10);
      tags.push({
        id,
        name,
        watched: isChecked(block.querySelector(`#tagwatch_${id}`)),
        hidden: isChecked(block.querySelector(`#taghide_${id}`)),
        color: normalizeColor(colorInput?.value ?? ""),
        weight: Number.isFinite(weight) ? weight : 10
      });
    }
    return tags;
  }
  function throwIfFailed2(data) {
    if (typeof data === "object" && data !== null && "error" in data) {
      const error = data.error;
      if (typeof error === "string" && error !== "") {
        throw new Error(`Could not save tag: ${error}`);
      }
    }
  }
  async function postTagJson(url, body, signal) {
    const data = await postJson(url, body, {
      tag: "my-tags",
      failure: "Tag request failed",
      signal
    });
    throwIfFailed2(data);
    return data;
  }
  async function addTagForm(url, body, signal) {
    await postForm(url, body, { tag: "my-tags", failure: "Could not save tag", signal });
  }
  async function applyMyTag(tag, change, deps) {
    const name = normalizeName(tag);
    if (name === "") {
      throw new Error("Missing tag name.");
    }
    const response = await deps.loadDocument(deps.myTagsUrl, { fresh: true, signal: deps.signal });
    if (deps.signal?.aborted) {
      return "updated";
    }
    const existing = parseUserTags(response.doc).find((entry) => normalizeName(entry.name) === name);
    if (existing) {
      let watched = change.watched ?? existing.watched;
      let hidden = change.hidden ?? existing.hidden;
      if (change.watched === true) {
        hidden = false;
      } else if (change.hidden === true) {
        watched = false;
      }
      const next = {
        watched,
        hidden,
        color: change.color === undefined ? existing.color : normalizeColor(change.color)
      };
      const post = deps.post ?? ((url, body) => postTagJson(url, body, deps.signal));
      const data = await post(deps.config.apiUrl, {
        method: "setusertag",
        apiuid: deps.config.apiUid,
        apikey: deps.config.apiKey,
        tagid: existing.id,
        tagwatch: next.watched ? 1 : 0,
        taghide: next.hidden ? 1 : 0,
        tagcolor: next.color,
        tagweight: existing.weight
      });
      throwIfFailed2(data);
      return "updated";
    }
    const body = new URLSearchParams({
      usertag_action: "add",
      tagname_new: name,
      tagweight_new: "10",
      usertag_target: "0"
    });
    if (change.watched === true) {
      body.set("tagwatch_new", "on");
    }
    if (change.hidden === true) {
      body.set("taghide_new", "on");
    }
    const color = normalizeColor(change.color);
    if (color !== "") {
      body.set("tagcolor_new", color);
    }
    const add = deps.addTag ?? addTagForm;
    await add(deps.myTagsUrl, body, deps.signal);
    return "added";
  }

  // src/data/resume.ts
  var RESUME_KEY = "eh:resume:v1";
  var VERSION6 = 1;
  var DAY_MS4 = 24 * 60 * 60 * 1000;
  var RESUME_TTL_MS = 30 * DAY_MS4;
  var RESUME_LIMIT = 100;
  function galleryKey(galleryUrl) {
    const identity = galleryIdentity(galleryUrl);
    return identity === null ? null : `${identity.gid}/${identity.token}`;
  }
  function isEntry(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value;
    return typeof record.pageUrl === "string" && typeof record.pageNum === "number" && Number.isFinite(record.pageNum) && typeof record.counterText === "string" && typeof record.savedAt === "number" && Number.isFinite(record.savedAt);
  }
  var resumeStore = createStore({ key: RESUME_KEY, version: VERSION6, empty: () => ({}), guard: isRecord }, gmStorage());
  function readStore() {
    const store = {};
    for (const [key, value] of Object.entries(resumeStore.read())) {
      if (isEntry(value)) {
        store[key] = value;
      }
    }
    return store;
  }
  function writeStore(store) {
    resumeStore.write(store);
  }
  function getResume(galleryUrl, now = Date.now()) {
    const key = galleryKey(galleryUrl);
    if (key === null) {
      return null;
    }
    const entry = readStore()[key];
    if (!entry || now - entry.savedAt >= RESUME_TTL_MS) {
      return null;
    }
    return entry;
  }
  function saveResume(galleryUrl, entry, now = Date.now()) {
    const key = galleryKey(galleryUrl);
    if (key === null || entry.pageUrl === "") {
      return;
    }
    const store = readStore();
    store[key] = { ...entry, savedAt: now };
    const live = Object.entries(store).filter(([, value]) => now - value.savedAt < RESUME_TTL_MS);
    if (live.length > RESUME_LIMIT) {
      live.sort((a, b) => b[1].savedAt - a[1].savedAt);
      live.length = RESUME_LIMIT;
    }
    writeStore(Object.fromEntries(live));
  }
  function clearResume(galleryUrl) {
    const key = galleryKey(galleryUrl);
    if (key === null) {
      return;
    }
    const store = readStore();
    if (!(key in store)) {
      return;
    }
    delete store[key];
    writeStore(store);
  }

  // src/ui/gallery-comments.ts
  function isAborted(signal) {
    return signal.aborted;
  }
  function scoreText(score) {
    if (score === null) {
      return "—";
    }
    return score > 0 ? `+${score}` : String(score);
  }
  function commentCard(comment, config, deps, signal, edit) {
    const card = el("article", {
      class: comment.uploader ? "comment is-uploader" : "comment",
      "data-comment-id": comment.id
    });
    const score = el("span", {
      class: "comment-score",
      text: scoreText(comment.score),
      "aria-live": "polite"
    });
    const up = el("button", {
      class: "comment-vote comment-vote-up",
      type: "button",
      title: "Vote up",
      "aria-label": `Vote up ${comment.author || "comment"}`,
      "aria-pressed": "false",
      text: "+"
    });
    const down = el("button", {
      class: "comment-vote comment-vote-down",
      type: "button",
      title: "Vote down",
      "aria-label": `Vote down ${comment.author || "comment"}`,
      "aria-pressed": "false",
      text: "−"
    });
    const voteButtons = config === null ? null : el("span", { class: "comment-score-wrap" }, score, up, down);
    const head = el("header", { class: "comment-head" }, comment.authorHref ? el("a", {
      class: "comment-author",
      href: comment.authorHref,
      text: comment.author || "Anonymous"
    }) : el("span", { class: "comment-author", text: comment.author || "Anonymous" }), comment.uploader ? el("span", { class: "comment-badge", text: "Uploader" }) : "", el("span", { class: "comment-posted", text: comment.posted }), config === null ? el("span", { class: "comment-score-wrap" }, score) : voteButtons);
    let pending = false;
    const setPending = (busy) => {
      pending = busy;
      card.classList.toggle("is-busy", busy);
      if (busy) {
        card.setAttribute("aria-busy", "true");
      } else {
        card.removeAttribute("aria-busy");
      }
    };
    const cast = async (vote) => {
      if (pending || config === null) {
        return;
      }
      setPending(true);
      try {
        const result = await voteComment(config, comment.id, vote, { post: deps.post });
        if (signal.aborted) {
          return;
        }
        score.textContent = scoreText(result.score);
        up.setAttribute("aria-pressed", result.vote > 0 ? "true" : "false");
        down.setAttribute("aria-pressed", result.vote < 0 ? "true" : "false");
      } catch (error) {
        if (!signal.aborted) {
          showToast(errorText(error));
        }
      } finally {
        setPending(false);
      }
    };
    if (config !== null) {
      up.addEventListener("click", () => void cast(1), { signal });
      down.addEventListener("click", () => void cast(-1), { signal });
    }
    const body = el("div", { class: "comment-body", text: comment.body });
    const bodyHost = el("div", { class: "comment-body-host" }, body);
    let editing = false;
    let saving = false;
    const editButton = config !== null && comment.editable ? el("button", {
      class: "comment-edit",
      type: "button",
      text: "Edit",
      "aria-label": `Edit comment by ${comment.author || "Anonymous"}`
    }) : null;
    if (editButton) {
      head.append(editButton);
      editButton.addEventListener("click", () => {
        if (editing) {
          return;
        }
        editing = true;
        editButton.hidden = true;
        const form = el("form", { class: "comment-edit-form" });
        const textarea = el("textarea", {
          class: "field-input comment-input",
          rows: "3",
          "aria-label": `Edit comment by ${comment.author || "Anonymous"}`
        });
        textarea.value = comment.body;
        const save = el("button", { class: "btn btn-small", type: "submit", text: "Save" });
        const cancel = el("button", {
          class: "btn btn-ghost btn-small",
          type: "button",
          text: "Cancel"
        });
        const status = el("span", { class: "comment-status", role: "status" });
        form.append(textarea, el("div", { class: "comment-compose-actions" }, save, cancel, status));
        bodyHost.replaceChildren(form);
        if (typeof textarea.focus === "function") {
          textarea.focus();
        }
        const closeEdit = () => {
          editing = false;
          editButton.hidden = false;
          bodyHost.replaceChildren(body);
        };
        cancel.addEventListener("click", () => {
          closeEdit();
        }, { signal });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const text = textarea.value.trim();
          if (saving) {
            return;
          }
          if (text === "") {
            status.textContent = "Comment cannot be empty.";
            return;
          }
          saving = true;
          save.disabled = true;
          cancel.disabled = true;
          save.textContent = "Saving…";
          status.textContent = "Saving…";
          (async () => {
            try {
              await edit(comment.id, text);
              if (signal.aborted) {
                return;
              }
              comment.body = text;
              body.textContent = text;
              editButton.hidden = false;
              editing = false;
              bodyHost.replaceChildren(body);
              showToast("Comment updated");
              try {
                await deps.refresh();
              } catch (error) {
                if (!isAborted(signal)) {
                  showToast(errorText(error));
                }
              }
            } catch (error) {
              if (!signal.aborted) {
                status.textContent = "Save failed.";
                showToast(errorText(error));
              }
            } finally {
              saving = false;
              save.disabled = false;
              cancel.disabled = false;
              save.textContent = "Save";
            }
          })();
        }, { signal });
      }, { signal });
    }
    appendChildren(card, [
      head,
      bodyHost,
      comment.votes === null ? null : el("div", { class: "comment-votes", text: comment.votes })
    ]);
    return card;
  }
  function commentsSection(options) {
    const { data, config, deps, signal } = options;
    const section = el("section", { class: "gallery-comments", "aria-label": "Comments" });
    const list = el("div", { class: "comment-list" });
    const edit = deps.editComment ?? editComment;
    section.append(el("h2", { class: "comments-title", text: `Comments (${data.comments.length})` }), list);
    for (const comment of data.comments) {
      list.append(commentCard(comment, config, deps, signal, (commentId, text) => edit(data.url, commentId, text, signal)));
    }
    if (config === null) {
      return section;
    }
    const form = el("form", { class: "comment-composer" });
    const textarea = el("textarea", {
      class: "field-input comment-input",
      name: "commenttext_new",
      rows: "3",
      placeholder: "Add a comment…",
      "aria-label": "New comment"
    });
    const button = el("button", { class: "btn btn-small", type: "submit", text: "Post comment" });
    const status = el("span", { class: "comment-status", role: "status" });
    form.append(textarea, el("div", { class: "comment-compose-actions" }, button, status));
    section.append(form);
    let posting = false;
    const refresh = async () => {
      status.replaceChildren("Posted. Refreshing…");
      try {
        await deps.refresh();
        if (signal.aborted) {
          return;
        }
        status.replaceChildren();
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        status.replaceChildren("Posted, but the page could not refresh. ", el("button", {
          class: "comment-retry",
          type: "button",
          text: "Reload",
          onclick: () => {
            refresh();
          }
        }));
        status.querySelector(".comment-retry")?.focus();
        showToast(errorText(error));
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (posting || text === "") {
        return;
      }
      posting = true;
      button.textContent = "Posting…";
      status.textContent = "Posting…";
      (async () => {
        try {
          await deps.postComment(data.url, text, signal);
          if (signal.aborted) {
            return;
          }
          textarea.value = "";
          await refresh();
        } catch (error) {
          if (!signal.aborted) {
            status.textContent = "Post failed.";
            showToast(errorText(error));
          }
        } finally {
          posting = false;
          button.textContent = "Post comment";
        }
      })();
    }, { signal });
    return section;
  }

  // src/ui/gallery-rating.ts
  var CONFIRM_MS = 2200;
  var FAILURE_MS = 3000;
  function averageLabel(rating) {
    return rating.average === null ? "Not yet rated" : `Average: ${rating.average.toFixed(2)}`;
  }
  function halfText(half) {
    return (half / 2).toFixed(1).replace(/\.0$/u, "");
  }
  function ratingControl(options) {
    const { config, rating, post, signal } = options;
    const label = el("span", {
      class: "rating-label",
      role: "status",
      text: averageLabel(rating)
    });
    const count = el("span", {
      class: "rating-count",
      text: rating.votes === null ? "" : countText(rating.votes, "vote")
    });
    const stars = el("div", {
      class: "rating-stars",
      role: "group",
      "aria-label": "Rate this gallery"
    });
    const cells = [];
    const targets = [];
    let pending = false;
    let resetTimer;
    let current = rating.user;
    const restingValue = () => current ?? rating.average;
    const paint = (value, publish) => {
      const filled = value === null ? 0 : litHalves(value);
      cells.forEach((cell, index) => {
        cell.classList.toggle("is-on", index < filled);
      });
      if (publish) {
        for (const target of targets) {
          target.button.setAttribute("aria-pressed", target.last < filled ? "true" : "false");
        }
      }
    };
    const setValue = (value) => {
      current = value;
      paint(value, true);
    };
    const preview = (half) => {
      if (!pending) {
        paint(half / 2, false);
      }
    };
    const unpreview = () => {
      if (!pending) {
        paint(restingValue(), false);
      }
    };
    const destroy = () => {
      if (resetTimer !== undefined) {
        window.clearTimeout(resetTimer);
      }
    };
    const submit = async (starCount) => {
      if (pending) {
        return;
      }
      const previous = current;
      pending = true;
      stars.setAttribute("aria-busy", "true");
      label.textContent = "Saving…";
      paint(starCount, false);
      try {
        const result = await rateGallery(config, starCount, { post });
        if (signal.aborted) {
          return;
        }
        label.textContent = "Thanks for rating!";
        if (result.votes !== null) {
          count.textContent = countText(result.votes, "vote");
        }
        setValue(result.user ?? starCount);
        destroy();
        resetTimer = window.setTimeout(() => {
          label.textContent = averageLabel({
            ...rating,
            average: result.average ?? rating.average,
            user: result.user ?? starCount
          });
        }, CONFIRM_MS);
      } catch (error) {
        if (!signal.aborted) {
          current = previous;
          paint(restingValue(), current !== null);
          label.textContent = "Rating failed.";
          destroy();
          resetTimer = window.setTimeout(() => {
            label.textContent = averageLabel(rating);
          }, FAILURE_MS);
          showToast(errorText(error));
        }
      } finally {
        pending = false;
        stars.removeAttribute("aria-busy");
      }
    };
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
    if (coarse) {
      for (let star = 1;star <= 5; star++) {
        const text = `Rate ${star} ${star === 1 ? "star" : "stars"}`;
        const button = el("button", {
          class: "rating-star",
          type: "button",
          title: text,
          "aria-label": text,
          "aria-pressed": "false",
          onfocusin: () => preview(star * 2),
          onclick: () => {
            submit(star);
          }
        });
        const firstCell = (star - 1) * 2;
        for (let offset = 0;offset < 2; offset++) {
          const cell = el("span", { class: halfClass(firstCell + offset + 1) });
          cell.append(...starGlyphs());
          cells.push(cell);
          button.append(cell);
        }
        targets.push({ button, last: firstCell + 1 });
        stars.append(button);
      }
    } else {
      for (let half = 1;half <= HALF_STEPS; half++) {
        const value = half / 2;
        const text = `Rate ${halfText(half)} ${value === 1 ? "star" : "stars"}`;
        const button = el("button", {
          class: halfClass(half),
          type: "button",
          title: text,
          "aria-label": text,
          "aria-pressed": "false",
          onpointerenter: () => preview(half),
          onfocusin: () => preview(half),
          onclick: () => {
            submit(half / 2);
          }
        });
        button.append(...starGlyphs());
        cells.push(button);
        targets.push({ button, last: half - 1 });
        stars.append(button);
      }
    }
    stars.addEventListener("pointerleave", unpreview);
    stars.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !stars.contains(next)) {
        unpreview();
      }
    });
    paint(restingValue(), current !== null);
    signal.addEventListener("abort", destroy, { once: true });
    return el("div", { class: "rating-control" }, stars, el("span", { class: "rating-meta" }, label, count));
  }

  // src/ui/gallery-tag-menu.ts
  function wikiHref(tag) {
    const name = tag.replace(/^[a-z]+:\s?/i, "").replace(/ /g, "_");
    return `https://ehwiki.org/wiki/${encodeURIComponent(name)}`;
  }
  var openMenu = null;
  function openTagMenu(anchor, tag, tagHref, handlers, signal) {
    if (openMenu?.anchor === anchor && openMenu.binding.isOpen()) {
      openMenu.binding.close();
      return;
    }
    closePopovers();
    const raw = `${tag.ns}:${tag.name}`;
    const divider = () => el("hr", { class: "tag-menu-divider" });
    const content = el("div", { class: "tag-menu" });
    const error = el("p", { class: "tag-menu-error", role: "alert", hidden: "" });
    const form = el("form", { class: "tag-menu-new" });
    const input = tagInput("field-input");
    const extraButtons = [];
    const buttons = {
      up: el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Vote up"
      }),
      down: el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Vote down"
      }),
      include: el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Include in search"
      }),
      exclude: el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Exclude from search"
      }),
      or: el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Make optional (OR)"
      })
    };
    const setBusy = (busy) => {
      for (const button of [...Object.values(buttons), ...extraButtons]) {
        button.disabled = busy;
      }
    };
    const showError = (cause) => {
      error.textContent = errorText(cause, "The action failed.");
      error.hidden = false;
    };
    const binding = bindPopover(anchor, () => ({
      content,
      dispose: () => {
        if (openMenu?.anchor === anchor) {
          openMenu = null;
        }
      }
    }), {
      role: "dialog",
      label: `Actions for ${tag.name}`,
      className: "tag-menu-panel",
      autoFocus: true
    }, signal);
    let running = false;
    const run = async (action, focusTarget) => {
      if (running) {
        return;
      }
      running = true;
      error.hidden = true;
      setBusy(true);
      let failed = false;
      try {
        await action();
        binding.close();
      } catch (cause) {
        showError(cause);
        failed = true;
      } finally {
        running = false;
        setBusy(false);
        if (failed) {
          focusTarget.focus();
        }
      }
    };
    buttons.up.addEventListener("click", () => void run(() => handlers.vote(raw, 1), buttons.up));
    buttons.down.addEventListener("click", () => void run(() => handlers.vote(raw, -1), buttons.down));
    const applySign = (sign) => {
      if (handlers.token === null) {
        return;
      }
      handlers.add(handlers.token, sign);
      binding.close();
    };
    buttons.include.addEventListener("click", () => applySign(""));
    buttons.exclude.addEventListener("click", () => applySign("-"));
    buttons.or.addEventListener("click", () => applySign("~"));
    form.append(input, el("button", { class: "btn btn-small", type: "submit", text: "Add tags" }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (value === "") {
        return;
      }
      run(() => handlers.addTags(value), input);
    }, { signal });
    const myTagButtons = [];
    if (handlers.watchTag) {
      const watch = el("button", { class: "tag-menu-item", type: "button", text: "Watch tag" });
      watch.addEventListener("click", () => {
        const runWatch = handlers.watchTag;
        if (runWatch) {
          run(() => runWatch(raw), watch);
        }
      });
      extraButtons.push(watch);
      myTagButtons.push(watch);
    }
    if (handlers.hideTag) {
      const hide = el("button", { class: "tag-menu-item", type: "button", text: "Hide tag" });
      hide.addEventListener("click", () => {
        const runHide = handlers.hideTag;
        if (runHide) {
          run(() => runHide(raw), hide);
        }
      });
      extraButtons.push(hide);
      myTagButtons.push(hide);
    }
    const actionRows = [
      el("div", { class: "tag-menu-actions" }, buttons.up, buttons.down)
    ];
    if (myTagButtons.length > 0) {
      actionRows.push(el("div", { class: "tag-menu-actions" }, ...myTagButtons));
    }
    if (handlers.colorTag) {
      const color = el("input", {
        class: "tag-menu-color",
        type: "color",
        value: "#ff8800",
        "aria-label": "Tag highlight colour",
        title: "Highlight colour"
      });
      const apply = el("button", {
        class: "tag-menu-item",
        type: "button",
        text: "Apply colour"
      });
      extraButtons.push(apply);
      apply.addEventListener("click", () => {
        const runColor = handlers.colorTag;
        if (runColor) {
          run(() => runColor(raw, color.value), apply);
        }
      });
      actionRows.push(el("div", { class: "tag-menu-actions" }, color, apply));
    }
    if (handlers.token !== null) {
      actionRows.push(el("div", { class: "tag-menu-actions" }, buttons.include, buttons.exclude, buttons.or));
    }
    content.append(el("div", { class: "tag-menu-head" }, el("span", { class: "tag-menu-title", text: tag.name }), el("span", { class: "tag-menu-ns", text: tag.ns })), divider(), ...actionRows);
    content.append(el("div", { class: "tag-menu-actions" }, el("a", { class: "tag-menu-item", href: tagHref, text: "Show tagged galleries" }), el("a", {
      class: "tag-menu-item justify-between",
      href: wikiHref(tag.name),
      "data-native": "",
      target: "_blank",
      rel: "noopener"
    }, "Tag definition", icon("external"))), error, divider(), form);
    openMenu = { anchor, binding };
    binding.open();
  }

  // src/ui/page-cursor.ts
  function createPageCursor({
    next,
    key,
    initialKeys = [],
    load,
    signal
  }) {
    const controller = new AbortController;
    const abort = () => {
      controller.abort();
    };
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
    const isAborted = () => controller.signal.aborted;
    const seen = new Set(initialKeys);
    const fetched = new Set;
    let cursor = next;
    let loading = false;
    let done = next === null;
    let failed = false;
    let looped = false;
    let flight = null;
    const loadNext = () => {
      if (controller.signal.aborted || done || failed) {
        return Promise.resolve(null);
      }
      if (flight !== null) {
        return flight;
      }
      const url = cursor;
      if (url === null) {
        done = true;
        return Promise.resolve(null);
      }
      loading = true;
      let request;
      try {
        request = load(url, controller.signal);
      } catch {
        loading = false;
        if (!isAborted()) {
          failed = true;
        }
        return Promise.resolve(null);
      }
      const chain = request.then((page) => {
        if (controller.signal.aborted) {
          return null;
        }
        const fresh = [];
        for (const item of page.items) {
          const id = key(item);
          if (!seen.has(id)) {
            seen.add(id);
            fresh.push(item);
          }
        }
        fetched.add(url);
        cursor = page.next;
        if (cursor === null) {
          done = true;
        } else if (fetched.has(cursor)) {
          looped = true;
          done = true;
        }
        return fresh;
      }).catch(() => {
        if (!isAborted()) {
          failed = true;
        }
        return null;
      }).finally(() => {
        loading = false;
        flight = null;
      });
      flight = chain;
      return chain;
    };
    const retry = () => {
      if (!controller.signal.aborted) {
        failed = false;
      }
    };
    const stop = () => {
      controller.abort();
      signal.removeEventListener("abort", abort);
    };
    return {
      loadNext,
      state() {
        return { loading, done, failed, looped };
      },
      retry,
      stop
    };
  }

  // src/ui/infinite-scroll.ts
  var DEFAULT_ROOT_MARGIN = "800px 0px";
  var DEFAULT_MAX_CHAINED_PAGES = 3;
  function infiniteScroll({
    next,
    key,
    initialKeys = [],
    load,
    append,
    noun,
    rootMargin = DEFAULT_ROOT_MARGIN,
    maxChainedPages = DEFAULT_MAX_CHAINED_PAGES,
    onChange,
    signal
  }) {
    const status = el("p", { class: "infinite-status", role: "status" });
    const retryButton = el("button", {
      class: "btn btn-small infinite-retry",
      type: "button",
      text: "Retry"
    });
    retryButton.hidden = true;
    const more = el("button", {
      class: "btn btn-small infinite-more",
      type: "button",
      text: "Load more"
    });
    more.hidden = true;
    const element = el("div", { class: "infinite-scroll" }, status, more, retryButton);
    element.hidden = next === null;
    const cursor = createPageCursor({ next, key, initialKeys, load, signal });
    const listeners = new AbortController;
    let armed = true;
    let chained = 0;
    let stopped = false;
    const isStopped = () => stopped;
    const observer = new IntersectionObserver((entries) => {
      if (armed && entries.some((entry) => entry.isIntersecting)) {
        fetchNext();
      }
    }, { rootMargin });
    const finish = (text) => {
      armed = false;
      more.hidden = true;
      status.textContent = text;
      observer.disconnect();
    };
    const fail = () => {
      armed = false;
      more.hidden = true;
      status.textContent = `Could not load more ${noun}.`;
      retryButton.hidden = false;
      observer.disconnect();
    };
    async function fetchNext() {
      const before = cursor.state();
      if (!armed || stopped || before.loading || before.done || before.failed) {
        return false;
      }
      status.textContent = `Loading more ${noun}…`;
      const fresh = await cursor.loadNext();
      const after = cursor.state();
      if (isStopped()) {
        return false;
      }
      if (after.failed) {
        fail();
        onChange?.();
        return false;
      }
      if (fresh === null) {
        if (after.done) {
          finish(after.looped ? "No more pages." : "");
          onChange?.();
        }
        return false;
      }
      const appended = fresh.length > 0;
      if (appended) {
        append(fresh);
      }
      if (after.done) {
        finish(after.looped ? "No more pages." : "");
        onChange?.();
        return appended;
      }
      chained += 1;
      if (chained >= maxChainedPages) {
        armed = false;
        status.textContent = "";
        more.hidden = false;
        observer.disconnect();
        onChange?.();
        return appended;
      }
      status.textContent = "";
      observer.unobserve(element);
      observer.observe(element);
      onChange?.();
      return appended;
    }
    const loadNext = () => {
      if (stopped || cursor.state().failed) {
        return Promise.resolve(false);
      }
      armed = true;
      chained = 0;
      more.hidden = true;
      return fetchNext();
    };
    const retry = () => {
      if (stopped || cursor.state().loading) {
        return Promise.resolve(false);
      }
      cursor.retry();
      armed = true;
      chained = 0;
      retryButton.hidden = true;
      more.hidden = true;
      status.textContent = "";
      return fetchNext();
    };
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      cursor.stop();
      listeners.abort();
      observer.disconnect();
      signal.removeEventListener("abort", stop);
    };
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener("abort", stop, { once: true });
    }
    retryButton.addEventListener("click", () => void retry(), { signal: listeners.signal });
    more.addEventListener("click", () => void loadNext(), { signal: listeners.signal });
    if (next === null || signal.aborted) {
      observer.disconnect();
    } else {
      observer.observe(element);
    }
    return {
      element,
      loadNext,
      retry,
      state: () => cursor.state(),
      stop
    };
  }

  // src/ui/paged-region.ts
  function createPagedRegion({
    signal,
    next,
    initial,
    key,
    noun,
    enabled,
    slot,
    pager,
    load,
    append,
    placeSentinel,
    onSync
  }) {
    const fillSlot = (node) => {
      slot.replaceChildren(...node === null ? [] : [node]);
    };
    const undo = [];
    let scroll = null;
    let infinite = null;
    let stopped = false;
    const setMode = (on) => {
      if (stopped || on === infinite) {
        return;
      }
      scroll?.stop();
      scroll?.element.remove();
      scroll = null;
      for (const revert of undo.splice(0).reverse()) {
        revert();
      }
      infinite = on;
      if (!on) {
        fillSlot(pager(true));
        onSync?.();
        return;
      }
      fillSlot(pager(false));
      scroll = infiniteScroll({
        next,
        key,
        initialKeys: initial.map(key),
        noun,
        signal,
        load,
        append: (items) => {
          undo.push(append(items));
          onSync?.();
        }
      });
      placeSentinel(scroll.element);
      onSync?.();
    };
    const off = onSettingsChange((settings) => setMode(enabled(settings)));
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      off();
      signal.removeEventListener("abort", stop);
      scroll?.stop();
      scroll?.element.remove();
      scroll = null;
    };
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener("abort", stop, { once: true });
      setMode(enabled(getSettings()));
    }
  }

  // src/ui/title.ts
  function metaNode(meta) {
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
  function titleNodes(title) {
    const fragment = document.createDocumentFragment();
    const leading = el("span", { class: "title-meta-wrap" });
    for (const meta of title.leading) {
      leading.append(metaNode(meta));
    }
    const main = el("span", { class: "title-main" });
    main.append(el("span", { class: "title-primary", text: title.primary }));
    if (title.secondary) {
      main.append(el("span", { class: "title-sep", text: " | " }), el("span", { class: "title-secondary", text: title.secondary }));
    }
    const trailing = el("span", { class: "title-meta-wrap" });
    for (const meta of title.trailing) {
      trailing.append(metaNode(meta));
    }
    fragment.append(leading, main, trailing);
    return fragment;
  }

  // src/views/gallery.ts
  function probeImage(src, onError) {
    const probe = el("img", { alt: "" });
    probe.addEventListener("error", onError, { once: true });
    probe.src = src;
  }
  function cover(data) {
    const node = el("div", { class: "gallery-cover" });
    if (!data.coverSrc) {
      node.classList.add("is-missing");
      node.textContent = "No cover";
      return node;
    }
    const image = el("img", {
      src: data.coverSrc,
      alt: "",
      decoding: "async",
      width: data.coverSize?.width ?? null,
      height: data.coverSize?.height ?? null
    });
    image.addEventListener("error", () => {
      node.classList.add("is-missing");
      node.textContent = "No cover";
    }, { once: true });
    node.append(image);
    return node;
  }
  function writableConfig(data) {
    const config = data.apiConfig;
    return config !== null && config.apiUid !== "-1" ? config : null;
  }
  function sameTag(a, b) {
    if (a.nsRaw === null || b.nsRaw === null) {
      return a.nsRaw === b.nsRaw && fold(a.value) === fold(b.value);
    }
    const aNs = a.ns ?? a.nsRaw;
    const bNs = b.ns ?? b.nsRaw;
    return tagIdentity(aNs, a.value) === tagIdentity(bNs, b.value);
  }
  function tagState(term) {
    if (term.sign === "-") {
      return " — excluded from the search";
    }
    if (term.sign === "~") {
      return " — optional (OR) in the search";
    }
    return " — in the search";
  }
  function stateTitle(term) {
    const state = tagState(term).replace(/^ — /u, "");
    return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  }
  function tagHint(match, actionsHint) {
    if (match === undefined) {
      return `Click to add to search · Alt-click to exclude · Middle-click for results${actionsHint}`;
    }
    const click = match.sign === "-" ? "Click to include" : "Click to remove";
    const alt = match.sign === "-" ? "Alt-click to remove" : "Alt-click to exclude";
    return `${stateTitle(match)} · ${click} · ${alt} · Middle-click for results${actionsHint}`;
  }
  function tagLabel(tag) {
    return tag.note === null ? tag.name : `${tag.name} — ${tag.note}`;
  }
  function tagTitle(tag, hint) {
    return tag.note === null ? hint : `${tag.name} | ${tag.note} · ${hint}`;
  }
  function tagSection(data, actions, ctx) {
    const section = el("section", { class: "tag-section", "aria-label": "Tags" });
    section.append(el("h2", { class: "tag-title", text: "Tags" }));
    const links = [];
    const actionsHint = actions.config === null ? "" : " · Right-click for tag actions";
    const refresh = () => {
      const terms = parseSearchTerms(getSearchDraft().text);
      for (const { chip, token, target, tag } of links) {
        chip.setAttribute("href", actions.href(token, ""));
        if (target === null) {
          continue;
        }
        const match = terms.find((term) => sameTag(term, target));
        chip.classList.toggle("is-added", match !== undefined);
        chip.classList.toggle("is-excluded", match?.sign === "-");
        chip.classList.toggle("is-or", match?.sign === "~");
        chip.title = tagTitle(tag, tagHint(match, actionsHint));
        const label = tagLabel(tag);
        chip.setAttribute("aria-label", match === undefined ? label : `${label} — ${tagState(match).replace(/^ — /u, "")}`);
      }
    };
    for (const group of data.tags) {
      const chips = el("div", { class: "tag-chips" });
      const nsClass = group.ns.replace(/[^a-z0-9_-]/gi, "");
      for (const tag of group.tags) {
        const token = tagTokenFromHref(tag.href, data.url);
        const target = token === null ? null : parseSearchTerms(token)[0] ?? null;
        const chip = el("a", {
          class: `tag-chip ns-${nsClass}`,
          href: token ? actions.href(token, "") : tag.href,
          "data-tag": `${group.ns}:${tag.name}`,
          title: tagTitle(tag, token ? tagHint(undefined, actionsHint) : `Open tag search${actionsHint}`),
          "aria-label": tag.note === null ? null : tagLabel(tag)
        }, el("span", { class: "tag-name", text: tag.name }), tag.note === null ? null : el("span", { class: "tag-note", text: tag.note }));
        if (actions.config !== null) {
          chip.setAttribute("aria-haspopup", "dialog");
        }
        if (token) {
          links.push({ chip, token, target, tag });
          const sign = (event) => event.altKey ? "-" : "";
          chip.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
            }
          }, { signal: ctx.signal });
          chip.addEventListener("click", (event) => {
            if (event.button !== 0) {
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
              return;
            }
            event.preventDefault();
            actions.add(token, sign(event));
          }, { signal: ctx.signal });
        }
        if (actions.config !== null) {
          const openMenu = () => {
            openTagMenu(chip, { ns: group.ns, name: tag.name }, tag.href, {
              vote: actions.vote,
              addTags: actions.addTags,
              add: actions.add,
              token,
              watchTag: actions.watchTag,
              hideTag: actions.hideTag,
              colorTag: actions.colorTag
            }, ctx.signal);
          };
          bindContextMenu(chip, openMenu, ctx.signal);
          const trigger = el("button", {
            class: "tag-menu-trigger",
            type: "button",
            "aria-label": `Tag actions for ${tag.name}`,
            "aria-haspopup": "dialog",
            title: "Tag actions",
            onclick: openMenu
          }, "⋯");
          chips.append(el("span", { class: "tag-chip-wrap" }, chip, trigger));
        } else {
          chips.append(chip);
        }
      }
      section.append(el("div", { class: "tag-row" }, el("span", { class: `tag-ns ns-${nsClass}`, text: `${group.ns}:` }), chips));
    }
    if (actions.config !== null) {
      const input = tagInput("field-input tag-add-input");
      const submit = el("button", { class: "btn btn-small", type: "submit", text: "Add tags" });
      const form = el("form", { class: "tag-add" }, input, submit);
      let adding = false;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "" || adding) {
          return;
        }
        adding = true;
        submit.textContent = "Adding…";
        actions.addTags(value).then(() => {
          input.value = "";
        }).catch((error) => {
          if (!ctx.signal.aborted) {
            showToast(errorText(error));
          }
        }).finally(() => {
          adding = false;
          submit.textContent = "Add tags";
        });
      }, { signal: ctx.signal });
      section.append(el("div", { class: "tag-row tag-add-row" }, el("span", { class: "tag-ns", "aria-hidden": "true" }), form));
    }
    refresh();
    return { element: section, refresh };
  }
  function siteActionItems(data) {
    const items = [];
    const { archiverHref, torrentsHref, reportHref, expungeHref, renameHref } = data.actions;
    if (archiverHref !== null) {
      items.push({
        label: "Archive Download",
        href: archiverHref,
        native: true,
        popup: { width: 480, height: 320 }
      });
    }
    if (torrentsHref !== null) {
      items.push({
        label: "Torrent Download",
        href: torrentsHref,
        native: true,
        popup: { width: 610, height: 590 }
      });
    }
    if (reportHref !== null) {
      items.push({ label: "Report Gallery", href: reportHref, native: true });
    }
    if (expungeHref !== null) {
      items.push({ label: "Petition to Expunge", href: expungeHref, native: true });
    }
    if (renameHref !== null) {
      items.push({
        label: "Petition to Rename",
        href: renameHref,
        native: true,
        popup: { width: 675, height: 415 }
      });
    }
    items.push(nativePageAction());
    return items;
  }
  function siteActionRail(items) {
    const rail = el("nav", { class: "gallery-rail", "aria-label": "Site actions" });
    rail.append(el("span", { class: "rail-label", text: "Site actions" }));
    for (const item of items) {
      if (item.href === undefined) {
        continue;
      }
      const href = item.href;
      const popup = item.popup;
      rail.append(el("a", {
        class: "rail-link",
        href,
        "data-native": item.native === true ? "" : null,
        onclick: popup ? (event) => {
          event.preventDefault();
          openPopup(href, popup.width, popup.height);
        } : null
      }, el("span", { text: item.label })));
    }
    return rail;
  }
  function thumbTile(thumb) {
    const tile = el("a", {
      class: "thumb",
      href: thumb.href,
      "aria-label": `Page ${thumb.label}`
    });
    tile.style.aspectRatio = `${thumb.width} / ${thumb.height}`;
    tile.style.setProperty("--sprite-x", `${thumb.x}px`);
    tile.style.setProperty("--sprite-w", `${thumb.width}px`);
    tile.style.setProperty("--sprite-count", String(thumb.spriteCount));
    tile.dataset.sprite = thumb.sprite;
    return el("div", { class: "thumb-cell" }, tile, el("span", { class: "thumb-page", text: `Page ${thumb.label}`, "aria-hidden": "true" }));
  }
  function readAction(data) {
    const url = new URL(data.url);
    const page = Number.parseInt(url.searchParams.get("p") ?? "0", 10) || 0;
    if (page === 0) {
      return data.firstPageHref ? { href: data.firstPageHref, label: "Read" } : null;
    }
    url.searchParams.delete("p");
    return { href: url.href, label: "Start from page 1" };
  }
  function resumeAction(data, ctx) {
    const entry = getResume(data.url);
    if (entry === null) {
      return null;
    }
    const link = el("a", {
      class: "btn btn-ghost gallery-resume",
      href: entry.pageUrl,
      title: `${entry.counterText} · saved ${new Date(entry.savedAt).toLocaleDateString()}`
    }, el("span", { text: `Resume page ${entry.pageNum}` }), icon("arrowRight"));
    const clear = el("button", {
      class: "gallery-resume-clear",
      type: "button",
      text: "×",
      "aria-label": "Clear saved reading position",
      title: "Clear saved reading position"
    });
    const group = el("span", { class: "gallery-resume-group" }, link, clear);
    clear.addEventListener("click", () => {
      clearResume(data.url);
      group.remove();
      showToast("Saved reading position cleared");
    }, { signal: ctx.signal });
    return group;
  }
  function renderGallery(host, data, ctx, deps = {}) {
    host.replaceChildren();
    let tagsSection = null;
    const topbar = renderTopbar({
      onSearch: (text) => {
        const next = { ...getSearchDraft().query, text };
        setSearchQuery(next);
        ctx.navigate(buildSearchUrl(next));
      },
      draftChips: true,
      signal: ctx.signal
    });
    const unsubscribe = subscribeSearchDraft(() => {
      tagsSection?.refresh();
    });
    ctx.signal.addEventListener("abort", unsubscribe, { once: true });
    const favoriteState = createFavoriteState(data, data.favorite, isLoggedIn());
    const favorite = favoriteButton(favoriteState, ctx.signal);
    const config = writableConfig(data);
    const siteItems = siteActionItems(data);
    const openSiteMenu = (anchor) => {
      openActionMenu({ anchor, label: "Site actions", items: siteItems, signal: ctx.signal });
    };
    const read = readAction(data);
    const resume = resumeAction(data, ctx);
    const actions = el("div", { class: "gallery-actions" }, read ? el("a", { class: "btn btn-primary", href: read.href }, el("span", { text: read.label }), icon("arrowRight")) : el("span", { class: "btn is-disabled", text: "No pages" }), resume, favorite);
    const meta = el("div", { class: "gallery-meta" });
    if (data.category) {
      meta.append(el("span", { class: `cat-badge ${data.category.cls}`, text: data.category.name }));
    }
    if (data.uploader) {
      meta.append(el("a", {
        class: "meta-link meta-dot",
        href: data.uploader.href,
        text: data.uploader.name
      }));
    }
    if (data.posted) {
      meta.append(el("span", { class: "meta-dot", text: data.posted }));
    }
    if (data.pageCount) {
      meta.append(el("span", { class: "meta-dot", text: countText(data.pageCount, "page") }));
    }
    if (data.size) {
      meta.append(el("span", { class: "meta-dot", text: data.size }));
    }
    if (data.rating !== null && config === null) {
      const stars = starRow(data.rating);
      if (stars !== null) {
        stars.classList.add("meta-dot");
        meta.append(stars);
      }
      if (data.ratingCount) {
        meta.append(el("span", { class: "meta-dot", text: countText(data.ratingCount, "vote") }));
      }
    }
    if (data.favCount !== null) {
      const baseCount = data.favCount;
      const favoritedAtLoad = favoriteState.get().favorited === true;
      const count = el("span", { class: "meta-dot", text: countText(baseCount, "favorite") });
      const unsubscribeCount = favoriteState.subscribe((snapshot) => {
        const favorited = snapshot.favorited === true;
        const total = favorited === favoritedAtLoad ? baseCount : Math.max(0, baseCount + (favorited ? 1 : -1));
        count.textContent = countText(total, "favorite");
      });
      ctx.signal.addEventListener("abort", unsubscribeCount, { once: true });
      meta.append(count);
    }
    if (data.parentHref) {
      const parentGid = galleryGid(data.parentHref);
      meta.append(el("a", {
        class: "meta-link meta-dot",
        href: data.parentHref,
        text: parentGid === null ? "Parent gallery" : `Parent: ${parentGid}`
      }));
    }
    if (data.visible !== null && data.visible !== "Yes") {
      meta.append(el("span", { class: "meta-dot", text: `Visible: ${data.visible}` }));
    }
    const rating = config === null ? null : ratingControl({ config, rating: data.ratingInfo, post: deps.post, signal: ctx.signal });
    const title = el("h1", { class: "gallery-title", tabindex: "-1" }, titleNodes(data.title));
    if (data.alternateTitle !== null) {
      title.querySelector(".title-primary")?.append(el("span", { class: "title-alt", text: ` · ${data.alternateTitle}` }));
    }
    bindContextMenu(title, () => openSiteMenu(title), ctx.signal);
    const details = el("div", { class: "gallery-details" }, title, meta, rating ?? null, actions);
    const header = el("section", { class: "gallery-header" }, cover(data), details, siteActionRail(siteItems));
    const grid = el("div", { class: "thumb-grid" });
    for (const thumb of data.thumbs) {
      grid.append(thumbTile(thumb));
    }
    const emptyThumbs = data.thumbs.length === 0 ? statePanel({
      text: "No page thumbnails found for this gallery.",
      actions: [nativePageAction()]
    }) : null;
    const load = deps.loadDocument ?? ((url, documentOptions) => loader.document(url, { priority: priorityOf("navigation"), ...documentOptions }));
    const reload = async () => {
      const response = await load(data.url, { fresh: true, signal: ctx.signal });
      if (ctx.signal.aborted) {
        return null;
      }
      return parseGalleryPage(response.doc, response.url);
    };
    const commentDeps = {
      post: deps.post,
      postComment: deps.postComment ?? postComment,
      editComment: deps.editComment,
      refresh: async () => {
        const next = await reload();
        if (next !== null) {
          replaceComments(next);
        }
      }
    };
    let commentsNode = null;
    const buildComments = (source) => source.comments.length > 0 || config !== null ? commentsSection({
      data: source,
      config,
      deps: commentDeps,
      signal: ctx.signal
    }) : null;
    function replaceComments(next) {
      const section = buildComments(next);
      if (section === null) {
        return;
      }
      if (commentsNode === null) {
        host.append(section);
      } else {
        commentsNode.replaceWith(section);
      }
      commentsNode = section;
      section.querySelector(".comment-input")?.focus();
    }
    const refreshTags = async () => {
      const next = await reload();
      if (next === null) {
        return;
      }
      const nextSection = buildTags(next);
      if (nextSection === null) {
        return;
      }
      const previous = tagsSection?.element ?? null;
      let restoreTag = null;
      let restoreComposer = false;
      if (previous !== null) {
        const openChip = previous.querySelector('.tag-chip[aria-expanded="true"]');
        if (openChip?.dataset.tag !== undefined) {
          restoreTag = openChip.dataset.tag;
        } else {
          const active = document.activeElement;
          if (active != null && previous.contains(active)) {
            const chip = active.closest(".tag-chip");
            if (chip?.dataset.tag === undefined) {
              restoreComposer = true;
            } else {
              restoreTag = chip.dataset.tag;
            }
          }
        }
      }
      if (tagsSection === null) {
        host.insertBefore(nextSection.element, grid);
      } else {
        tagsSection.element.replaceWith(nextSection.element);
      }
      tagsSection = nextSection;
      const chip = restoreTag === null ? undefined : [...nextSection.element.querySelectorAll(".tag-chip")].find((node) => node.dataset.tag === restoreTag);
      if (chip !== undefined) {
        chip.focus();
      } else if (restoreTag !== null || restoreComposer) {
        nextSection.element.querySelector(".tag-add-input")?.focus();
      }
    };
    const runTagVote = async (tag, vote) => {
      if (config === null) {
        return;
      }
      await voteTag(config, tag, vote, { post: deps.post });
      await refreshTags();
    };
    const runTagVoteBatch = async (tags) => {
      if (config === null) {
        return;
      }
      await voteTag(config, tags, 1, { post: deps.post });
      await refreshTags();
    };
    const runMyTag = async (tag, change) => {
      if (config === null) {
        return;
      }
      const result = await applyMyTag(tag, change, {
        config,
        myTagsUrl: new URL("/mytags", data.url).href,
        loadDocument: load,
        post: deps.post,
        signal: ctx.signal
      });
      showToast(result === "added" ? "Tag added to My Tags" : "My Tags updated");
    };
    const buildTags = (source) => source.tags.length > 0 ? tagSection(source, {
      href: (token, sign) => {
        const current = getSearchDraft();
        return buildSearchUrl({
          ...current.query,
          text: toggleTagInSearch(current.text, token, sign, false)
        });
      },
      add: (token, sign) => {
        setSearchDraftText(toggleTagInSearch(getSearchDraft().text, token, sign));
      },
      vote: (tag, vote) => runTagVote(tag, vote),
      addTags: (tags) => runTagVoteBatch(tags),
      watchTag: (tag) => runMyTag(tag, { watched: true }),
      hideTag: (tag) => runMyTag(tag, { hidden: true }),
      colorTag: (tag, color) => runMyTag(tag, { color }),
      config
    }, ctx) : null;
    const tags = buildTags(data);
    tagsSection = tags;
    commentsNode = buildComments(data);
    const missingSprites = new Set;
    const probedSprites = new Set;
    const spriteObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const tile = entry.target;
        const sprite = tile.dataset.sprite;
        if (sprite) {
          tile.style.backgroundImage = `url("${sprite}")`;
          tile.classList.add("is-loaded");
        }
        spriteObserver.unobserve(tile);
      }
    }, { rootMargin: "800px 0px" });
    ctx.signal.addEventListener("abort", () => spriteObserver.disconnect(), { once: true });
    const enhanceTiles = (cells) => {
      for (const cell of cells) {
        const tile = cell.querySelector(".thumb");
        const sprite = tile?.dataset.sprite;
        if (!tile || !sprite) {
          continue;
        }
        if (missingSprites.has(sprite)) {
          tile.classList.add("is-missing");
          continue;
        }
        if (!probedSprites.has(sprite)) {
          probedSprites.add(sprite);
          probeImage(sprite, () => {
            missingSprites.add(sprite);
            for (const candidate of grid.querySelectorAll(".thumb")) {
              if (candidate.dataset.sprite === sprite) {
                candidate.classList.add("is-missing");
                spriteObserver.unobserve(candidate);
              }
            }
          });
        }
        spriteObserver.observe(tile);
      }
    };
    enhanceTiles([...grid.children]);
    const navigation = el("div", { class: "gallery-paging" });
    appendChildren(host, [topbar, header, tags?.element ?? null, emptyThumbs ?? navigation]);
    if (data.thumbs.length > 0) {
      host.append(grid);
    }
    appendChildren(host, [commentsNode]);
    const pageRange = data.pageRange;
    let appendedThumbs = 0;
    const syncSummary = () => {
      const info = navigation.querySelector(".pager-info");
      if (info === null || pageRange === null || pageRange.total === 0) {
        return;
      }
      info.textContent = formatPageRange({
        ...pageRange,
        end: Math.min(pageRange.total, pageRange.end + appendedThumbs)
      });
    };
    if (emptyThumbs === null) {
      createPagedRegion({
        signal: ctx.signal,
        next: data.nextHref,
        initial: data.thumbs,
        key: (thumb) => thumb.href,
        noun: "gallery pages",
        enabled: (settings) => settings.galleryInfiniteScroll,
        slot: navigation,
        onSync: syncSummary,
        pager: (withNext) => {
          const node = pager({
            prev: data.prevHref,
            next: withNext ? data.nextHref : null,
            info: data.pageSummary,
            label: "Gallery pages"
          });
          node.classList.add("is-above");
          return node;
        },
        load: (url, signal) => {
          if (deps.pageSource === undefined) {
            return Promise.reject(new Error("No next-page source for this gallery route."));
          }
          return deps.pageSource(url, signal);
        },
        append: (thumbs) => {
          const cells = thumbs.map((thumb) => thumbTile(thumb));
          grid.append(...cells);
          enhanceTiles(cells);
          appendedThumbs += thumbs.length;
          return () => {
            for (const cell of cells) {
              cell.remove();
            }
            appendedThumbs -= thumbs.length;
          };
        },
        placeSentinel: (node) => {
          if (!node.hidden) {
            grid.after(node);
          }
        }
      });
    }
    bindViewScale({
      signal: ctx.signal,
      apply: (settings) => {
        const itemWidth = data.thumbs[0]?.width ?? 100;
        const size = Math.min(window.innerWidth <= 720 ? 110 : settings.galleryThumbSize, itemWidth);
        grid.style.setProperty("--thumb-size", `${size}px`);
        grid.style.setProperty("--gap", `${settings.gap}px`);
        grid.style.setProperty("--scale", String(size / itemWidth));
      }
    });
  }

  // src/data/list-seek.ts
  function seekHref(baseUrl, value) {
    const target = new URL(baseUrl);
    for (const key of ["p", "next", "prev", "seek", "jump"]) {
      target.searchParams.delete(key);
    }
    const seek = value.trim();
    if (seek !== "") {
      target.searchParams.set("seek", seek);
    }
    return `${target.pathname}${target.search}${target.hash}`;
  }

  // src/ui/form-controls.ts
  function selectedValue(select) {
    const options = [...select.querySelectorAll("option")];
    const selected = options.find((option) => option.selected === true || option.hasAttribute("selected"));
    return selected?.value ?? options[0]?.value ?? "";
  }
  function setSelectValue(select, value) {
    const options = [...select.querySelectorAll("option")];
    for (const option of options) {
      if (option.value === value) {
        option.setAttribute("selected", "");
      } else {
        option.removeAttribute("selected");
      }
    }
    const chosen = options.find((option) => option.value === value);
    if (chosen) {
      chosen.selected = true;
    }
  }
  function createSelect(options) {
    const select = el("select", {
      class: options.class,
      id: options.id,
      name: options.name,
      "aria-label": options.ariaLabel,
      disabled: options.disabled ? "" : null
    });
    for (const option of options.options) {
      select.append(el("option", {
        value: option.value,
        text: option.label,
        selected: option.value === options.value ? "" : null,
        disabled: option.disabled ? "" : null
      }));
    }
    return {
      element: select,
      read: () => selectedValue(select),
      write: (value) => setSelectValue(select, value)
    };
  }
  function createChoice(options) {
    const element = el("input", {
      type: options.type,
      value: options.value,
      checked: options.checked ? "" : null,
      id: options.id,
      name: options.name,
      disabled: options.disabled ? "" : null
    });
    return {
      element,
      readChecked: () => isChecked(element),
      writeChecked: (checked) => {
        element.checked = checked;
      }
    };
  }
  function createCheckbox(options) {
    const choice = createChoice({
      type: "checkbox",
      value: options.value ?? "on",
      checked: options.checked ?? false,
      id: options.id,
      name: options.name,
      disabled: options.disabled
    });
    return {
      ...choice,
      readValue: () => choice.readChecked() ? choice.element.value : "",
      writeValue: (value) => {
        choice.writeChecked(value !== "");
        if (value !== "") {
          choice.element.value = value;
        }
      }
    };
  }

  // src/ui/quick-tags.ts
  function renderQuickTags(options) {
    const { signal } = options;
    let tags = quickExpressions();
    let text = options.getText();
    const entries = [];
    const row = el("div", { class: "quick-tags", role: "group", "aria-label": "Quick tags" });
    const refresh = (next) => {
      text = next ?? options.getText();
      for (const entry of entries) {
        const on = containsExpression(text, entry.tag.query);
        entry.node.setAttribute("aria-pressed", String(on));
        entry.node.title = on ? `Remove ${entry.tag.query}` : `Add ${entry.tag.query}`;
      }
    };
    const render = () => {
      entries.length = 0;
      row.replaceChildren();
      for (const tag of tags) {
        const node = el("button", { class: "quick-tag", type: "button", "aria-pressed": "false" }, el("span", { class: "quick-tag-label", text: tag.name }));
        node.addEventListener("click", () => {
          options.search(toggleExpressionInSearch(options.getText(), tag.query));
        }, { signal });
        row.append(node);
        entries.push({ tag, node });
      }
      const edit = el("button", {
        class: "quick-tag-edit",
        type: "button",
        text: tags.length === 0 ? "+ Quick tags" : "Edit tags",
        title: "Edit saved searches and quick tags",
        "aria-haspopup": "dialog",
        "aria-expanded": "false"
      });
      edit.addEventListener("click", () => {
        openExpressionEditor(edit, signal, () => {
          tags = quickExpressions();
          render();
        });
      }, { signal });
      row.append(edit);
      refresh();
    };
    render();
    const unsubscribe = subscribeExpressions(() => {
      tags = quickExpressions();
      render();
    });
    signal.addEventListener("abort", unsubscribe, { once: true });
    return { element: row, refresh };
  }

  // src/views/list.ts
  function listLabels(query, scope, pathTag) {
    const text = query.text === "" ? pathTag ?? "" : query.text;
    if (scope === "popular") {
      return { heading: "Currently popular", title: "Popular" };
    }
    if (scope === "watched") {
      return { heading: "Watched tag galleries", title: "Watched" };
    }
    if (scope === "uploader") {
      return { heading: "Uploader galleries", title: text === "" ? "Galleries" : text };
    }
    const category = singleCategoryName(query.cats);
    return {
      heading: text.trim() ? "Search results" : category === null ? "Gallery listings" : `${category} galleries`,
      title: text === "" ? category ?? "Galleries" : text
    };
  }
  function categoryChips(query, ctx) {
    const row = el("div", { class: "cat-row", role: "group", "aria-label": "Categories" });
    const all = el("button", {
      class: "cat-chip",
      type: "button",
      "aria-pressed": String(query.cats === 0),
      title: "Enable every category",
      text: "All"
    });
    all.addEventListener("click", () => {
      const next = { ...query, cats: 0 };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    }, { signal: ctx.signal });
    row.append(all);
    for (const category of CATEGORIES) {
      const enabled = (query.cats & category.bit) === 0;
      const chip = el("button", {
        class: `cat-chip ${category.cls}`,
        type: "button",
        "aria-pressed": String(enabled),
        title: enabled ? `Disable ${category.name}` : `Enable ${category.name}`,
        text: category.name
      });
      chip.addEventListener("click", () => {
        const next = { ...query, cats: query.cats ^ category.bit };
        saveListFilters(next);
        ctx.navigate(buildSearchUrl(next));
      }, { signal: ctx.signal });
      row.append(chip);
    }
    return row;
  }
  function narrowCount(query) {
    let count = 0;
    if (query.rating > 0) {
      count++;
    }
    if (query.expunged) {
      count++;
    }
    if (query.torrent) {
      count++;
    }
    if (query.pageFrom.trim() || query.pageTo.trim()) {
      count++;
    }
    return count;
  }
  function relaxedCount(query) {
    let count = 0;
    if (query.disableLanguage) {
      count++;
    }
    if (query.disableUploader) {
      count++;
    }
    if (query.disableTags) {
      count++;
    }
    return count;
  }
  function advancedPanel(query, ctx) {
    const activeCount = narrowCount(query) + relaxedCount(query);
    const rating = createSelect({
      class: "field-select",
      ariaLabel: "Minimum rating",
      value: String(query.rating),
      options: [0, 2, 3, 4, 5].map((value) => ({
        value: String(value),
        label: value === 0 ? "Any rating" : `${value} stars`
      }))
    });
    const pageFrom = el("input", {
      class: "field-input",
      type: "number",
      min: "0",
      placeholder: "min",
      value: query.pageFrom,
      "aria-label": "Minimum pages"
    });
    const pageTo = el("input", {
      class: "field-input",
      type: "number",
      min: "0",
      placeholder: "max",
      value: query.pageTo,
      "aria-label": "Maximum pages"
    });
    const checkbox = (label, checked) => {
      const input = el("input", { type: "checkbox", checked: checked ? "checked" : null });
      return {
        wrapper: el("label", { class: "check" }, input, el("span", { text: label })),
        input
      };
    };
    const expunged = checkbox("Include expunged", query.expunged);
    const torrent = checkbox("Require torrent", query.torrent);
    const disableLanguage = checkbox("Disable language filter", query.disableLanguage);
    const disableUploader = checkbox("Disable uploader filter", query.disableUploader);
    const disableTags = checkbox("Disable tag filter", query.disableTags);
    const apply = () => {
      const next = {
        ...query,
        rating: Number.parseInt(rating.read(), 10) || 0,
        pageFrom: pageFrom.value,
        pageTo: pageTo.value,
        expunged: expunged.input.checked,
        torrent: torrent.input.checked,
        disableLanguage: disableLanguage.input.checked,
        disableUploader: disableUploader.input.checked,
        disableTags: disableTags.input.checked
      };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    };
    const applyButton = el("button", {
      class: "btn btn-small",
      type: "submit",
      text: "Apply"
    });
    const reset = el("button", { class: "btn btn-ghost btn-small", type: "button", text: "Reset" });
    reset.addEventListener("click", () => {
      const next = {
        ...query,
        rating: 0,
        pageFrom: "",
        pageTo: "",
        expunged: false,
        torrent: false,
        disableLanguage: false,
        disableUploader: false,
        disableTags: false
      };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    }, { signal: ctx.signal });
    const form = el("form", { class: "filters-grid" }, el("label", { class: "field" }, el("span", { text: "Minimum rating" }), rating.element), el("div", { class: "field" }, el("span", { text: "Page count" }), el("div", { class: "field-row" }, pageFrom, el("span", { text: "to" }), pageTo)), el("div", { class: "check-row" }, expunged.wrapper, torrent.wrapper), el("div", { class: "check-row" }, disableLanguage.wrapper, disableUploader.wrapper, disableTags.wrapper), el("div", { class: "filters-actions" }, activeCount > 0 ? reset : null, applyButton, el("a", {
      class: "filters-native",
      href: `https://upld.${location.hostname}/image_lookup.php`,
      "data-native": "",
      target: "_blank",
      rel: "noopener",
      text: "File search",
      title: "Find galleries containing a file (native upload form)"
    })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      apply();
    }, { signal: ctx.signal });
    const details = el("details", { class: "filters", open: isListPanelOpen() ? "" : null }, el("summary", { class: "filters-summary" }, icon("filter"), el("span", { text: "Filters" }), activeCount > 0 ? el("span", { class: "filters-count", text: String(activeCount) }) : ""), form);
    details.addEventListener("toggle", () => {
      setListPanelOpen(details.hasAttribute("open"));
    }, { signal: ctx.signal });
    return details;
  }
  function updateDraftNote(note, applied, draft) {
    const trimmed = draft.trim();
    if (trimmed === applied.trim()) {
      note.hidden = true;
      note.replaceChildren();
      return;
    }
    note.hidden = false;
    note.replaceChildren("Showing results for ", el("strong", { text: applied.trim() || "everything" }), ". Press Enter to search ", el("strong", { text: trimmed || "everything" }), ".");
  }
  function renderList(host, data, query, ctx, scope = "search", deps = {}) {
    host.replaceChildren();
    const pathTag = tagTokenFromHref(new URL(data.url).pathname, data.url);
    const urlText = query.text === "" ? pathTag ?? "" : query.text;
    const urlQuery = urlText === query.text ? query : { ...query, text: urlText };
    const draftText = urlText === "" && isDocumentReload() ? getSearchDraft().text : urlText;
    const draftQuery = draftText === urlQuery.text ? urlQuery : { ...urlQuery, text: draftText };
    setSearchQuery(draftQuery);
    const search = (next) => {
      setSearchQuery({ ...urlQuery, text: next });
      ctx.navigate(buildSearchUrl({ ...urlQuery, text: next }));
    };
    let quickTags = null;
    const applied = urlQuery.text;
    const note = el("p", { class: "draft-note", hidden: "" });
    const topbar = renderTopbar({ onSearch: search, signal: ctx.signal });
    updateDraftNote(note, applied, draftText);
    const unsubscribe = subscribeSearchDraft((state) => {
      updateDraftNote(note, applied, state.text);
      quickTags?.refresh(state.text);
    });
    ctx.signal.addEventListener("abort", unsubscribe, { once: true });
    const narrow = narrowCount(urlQuery);
    const relaxed = relaxedCount(urlQuery);
    const countNode = el("span", {
      text: data.resultText ?? countText(data.items.length, "item")
    });
    const header = listHeader({
      title: listLabels(urlQuery, scope, pathTag).heading,
      summary: [
        countNode,
        narrow > 0 ? el("span", { class: "badge", text: countText(narrow, "filter") }) : null,
        relaxed > 0 ? el("span", {
          class: "badge",
          text: `${relaxed} relaxed ${plural(relaxed, "filter")}`
        }) : null
      ]
    });
    quickTags = renderQuickTags({
      getText: () => getSearchDraft().text,
      search,
      signal: ctx.signal
    });
    const panel = el("section", { class: "search-panel" }, categoryChips(draftQuery, ctx), quickTags.element, advancedPanel(draftQuery, ctx));
    const grid = createCardGrid(ctx.signal);
    grid.append(data.items.map((item) => resultCard(item, ctx.signal, { preview: true })));
    const syncCount = () => {
      if (data.resultText === null) {
        countNode.textContent = countText(grid.element.querySelectorAll(".card").length, "item");
      }
    };
    const footer = el("div");
    const clearFilters = () => {
      const cleared = {
        ...urlQuery,
        text: "",
        cats: 0,
        rating: 0,
        expunged: false,
        torrent: false,
        pageFrom: "",
        pageTo: "",
        disableLanguage: false,
        disableUploader: false,
        disableTags: false
      };
      saveListFilters(cleared);
      ctx.navigate("/");
    };
    const canReset = urlQuery.text !== "" || urlQuery.cats !== 0 || narrow > 0 || relaxed > 0;
    const empty = data.items.length === 0 ? statePanel({
      text: "No galleries were found on this page.",
      actions: [
        ...canReset ? [
          {
            label: "Clear search and filters",
            primary: true,
            onClick: clearFilters
          }
        ] : [],
        nativePageAction()
      ]
    }) : null;
    host.append(topbar, note, header, panel);
    if (data.items.length > 0) {
      host.append(el("h2", { class: "sr-only", text: "Results" }), grid.element);
      grid.refresh();
    }
    host.append(empty ?? footer);
    const pageSource = deps.pageSource;
    if (empty === null) {
      createPagedRegion({
        signal: ctx.signal,
        next: data.nextHref,
        initial: data.items,
        key: (item) => item.gid,
        noun: "results",
        enabled: (settings) => settings.listInfiniteScroll,
        slot: footer,
        pager: (withNext) => withNext ? pager({
          prev: data.prevHref,
          next: data.nextHref,
          label: "Result pages",
          seek: {
            go: (value) => ctx.navigate(seekHref(data.url, value))
          }
        }) : null,
        load: (url, signal) => {
          if (pageSource === undefined) {
            return Promise.reject(new Error("No next-page source for this list route."));
          }
          return pageSource(url, signal);
        },
        append: (items) => {
          const nodes = items.map((item) => resultCard(item, ctx.signal, { preview: true }));
          grid.append(nodes);
          return () => grid.remove(nodes);
        },
        placeSentinel: (node) => footer.append(node),
        onSync: syncCount
      });
    }
  }

  // src/ui/settings-draft.ts
  function createSettingsDraft({ bindings, onChange }) {
    const baseline = new Map;
    const changed = () => {
      const current = new Map;
      for (const binding of bindings) {
        const value = binding.read();
        if (baseline.has(binding.key)) {
          const previous = baseline.get(binding.key);
          const same = binding.equals ? binding.equals(value, previous) : Object.is(value, previous);
          if (same) {
            continue;
          }
        }
        current.set(binding.key, value);
      }
      return current;
    };
    const capture = () => {
      baseline.clear();
      for (const binding of bindings) {
        baseline.set(binding.key, binding.read());
      }
    };
    const draft = {
      isDirty: () => changed().size > 0,
      changed,
      reset: () => {
        for (const binding of bindings) {
          if (baseline.has(binding.key)) {
            binding.write(baseline.get(binding.key));
          }
        }
        onChange?.();
      },
      rebase: () => {
        capture();
        onChange?.();
      }
    };
    capture();
    return draft;
  }

  // src/ui/settings-panel.ts
  var KEY_LABELS = {
    " ": "Space",
    ARROWLEFT: "←",
    ARROWRIGHT: "→",
    ARROWUP: "↑",
    ARROWDOWN: "↓",
    PAGEUP: "Page Up",
    PAGEDOWN: "Page Down",
    BACKSPACE: "Backspace",
    DELETE: "Delete",
    ESCAPE: "Esc",
    ENTER: "Enter",
    TAB: "Tab"
  };
  var VISUALLY_HIDDEN = "settings-file-input";
  var USERSCRIPT_SETTINGS_SECTION_ID = "settings-userscript";
  function cloneSettings(settings) {
    return { ...settings, keymap: copyKeymap(settings.keymap) };
  }
  function assign(target, key, value) {
    target[key] = value;
  }
  function keyLabel(key) {
    return KEY_LABELS[key] ?? key;
  }
  function normalizeKey(value) {
    if (value === " ") {
      return value;
    }
    return value.trim().toUpperCase();
  }
  function setStatus(node, message, error = false) {
    node.textContent = message;
    node.classList.remove("is-error");
    if (error) {
      node.classList.add("is-error");
    }
  }
  function downloadFile(filename, contents) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const anchor = el("a", { href: url, download: filename });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  function serializeSettings(settings) {
    return JSON.stringify({ app: "better-eh", version: 1, values: settings }, null, 2);
  }
  function assignKey(keymap, action, key, mode) {
    if (keymap[action].includes(key)) {
      return { ok: true, keymap, movedFrom: null, duplicate: true };
    }
    const other = KEY_ACTIONS.find((candidate) => candidate.action !== action && keymap[candidate.action].includes(key))?.action;
    if (mode === "reject" && other !== undefined) {
      return { ok: false, reason: "conflict", other };
    }
    if (keymap[action].length >= MAX_KEYS_PER_ACTION) {
      return { ok: false, reason: "limit", other: other ?? null };
    }
    const next = copyKeymap(keymap);
    if (other !== undefined) {
      next[other] = next[other].filter((value) => value !== key);
    }
    next[action] = [...next[action], key];
    return { ok: true, keymap: next, movedFrom: other ?? null, duplicate: false };
  }
  function parseKeymap(value) {
    const modifierNames = new Set([...MODIFIER_KEYS].map((name) => name.toUpperCase()));
    const seen = new Set;
    let imported = copyKeymap(DEFAULT_KEYMAP);
    for (const { action } of KEY_ACTIONS) {
      imported[action] = [];
    }
    for (const { action } of KEY_ACTIONS) {
      const raw = value[action];
      if (raw === undefined) {
        continue;
      }
      if (!Array.isArray(raw)) {
        return `The "${action}" bindings must be a list of keys.`;
      }
      seen.add(action);
      for (const entry of raw) {
        if (typeof entry !== "string") {
          return `The "${action}" bindings must be a list of keys.`;
        }
        const key = normalizeKey(entry);
        if (key === "" || key.length > MAX_KEY_LENGTH) {
          return `The "${action}" bindings contain an invalid key.`;
        }
        if (key.includes("+") || modifierNames.has(key)) {
          return `The "${action}" bindings contain a modified key; only unmodified keys are supported.`;
        }
        const result = assignKey(imported, action, key, "reject");
        if (!result.ok) {
          return result.reason === "limit" ? `The "${action}" bindings allow at most ${MAX_KEYS_PER_ACTION} keys.` : `The key "${key}" is bound to more than one action.`;
        }
        imported = result.keymap;
      }
    }
    const keymap = copyKeymap(DEFAULT_KEYMAP);
    const explicitKeys = new Set;
    for (const action of seen) {
      for (const key of imported[action]) {
        explicitKeys.add(key);
      }
    }
    for (const { action } of KEY_ACTIONS) {
      keymap[action] = seen.has(action) ? imported[action] : keymap[action].filter((key) => !explicitKeys.has(key));
    }
    return keymap;
  }
  function parseSettingsJson(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: "That file is not valid JSON." };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "That file does not contain a settings object." };
    }
    const record = raw;
    let values = record;
    if ("values" in record) {
      const nested = record.values;
      if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
        return { ok: false, error: `"values" must be a settings object.` };
      }
      values = nested;
    }
    const settings = cloneSettings(DEFAULT_SETTINGS);
    for (const key of SCALAR_KEYS) {
      const value = values[key];
      if (value === undefined) {
        continue;
      }
      const result = validateScalar(key, value);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      assign(settings, key, result.value);
    }
    const keymapValue = values.keymap;
    if (keymapValue !== undefined) {
      if (typeof keymapValue !== "object" || keymapValue === null || Array.isArray(keymapValue)) {
        return { ok: false, error: `"keymap" must be an object.` };
      }
      const keymap = parseKeymap(keymapValue);
      if (typeof keymap === "string") {
        return { ok: false, error: keymap };
      }
      settings.keymap = keymap;
    }
    return { ok: true, settings };
  }
  function renderUserscriptSettings(deps = {}) {
    const bindings = [];
    const toggles = new Map;
    const numbers = new Map;
    const selects = new Map;
    let synced = cloneSettings(getSettings());
    let keymapDraft = copyKeymap(synced.keymap);
    let capturing = null;
    let keymapHost = el("div");
    const statusNode = el("p", {
      class: "status-line settings-backup-status",
      role: "status",
      "aria-live": "polite"
    });
    const keymapStatusNode = el("p", {
      class: "status-line settings-keymap-status",
      role: "status",
      "aria-live": "polite"
    });
    const keymapBinding = {
      key: "keymap",
      read: () => copyKeymap(keymapDraft),
      write: (value) => {
        keymapDraft = copyKeymap(value);
        capturing = null;
        renderKeymap();
      },
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
    };
    bindings.push(keymapBinding);
    const change = () => {
      deps.onChange?.();
    };
    function readDraft() {
      const draft = cloneSettings(getSettings());
      for (const binding of bindings) {
        const value = binding.read();
        if (binding.key === "keymap") {
          draft.keymap = copyKeymap(value);
        } else {
          applyScalar(draft, binding.key, value);
        }
      }
      return draft;
    }
    function stopCapture() {
      capturing = null;
      renderKeymap();
    }
    function addKey(action, key) {
      const result = assignKey(keymapDraft, action, key, "move");
      if (!result.ok) {
        const other = result.other === null ? "another action" : actionLabel(result.other);
        setStatus(keymapStatusNode, result.reason === "limit" ? `Up to ${MAX_KEYS_PER_ACTION} keys per action; remove one first.` : `The key ${keyLabel(key)} is bound to ${other}.`, true);
        return;
      }
      if (result.duplicate) {
        setStatus(keymapStatusNode, `${keyLabel(key)} is already bound to ${actionLabel(action)}.`);
        return;
      }
      keymapDraft = result.keymap;
      setStatus(keymapStatusNode, result.movedFrom === null ? `Bound ${keyLabel(key)} to ${actionLabel(action)}.` : `Moved ${keyLabel(key)} from ${actionLabel(result.movedFrom)} to ${actionLabel(action)}.`);
      renderKeymap();
      change();
    }
    function removeKey(action, key) {
      keymapDraft[action] = keymapDraft[action].filter((value) => value !== key);
      setStatus(keymapStatusNode, `Removed ${keyLabel(key)} from ${actionLabel(action)}.`);
      renderKeymap();
      change();
    }
    function actionLabel(action) {
      return KEY_ACTIONS.find((field) => field.action === action)?.label ?? action;
    }
    function captureButton(action, label) {
      const button = el("button", {
        class: "settings-key-capture",
        type: "button",
        text: "Add key",
        "aria-label": `Add a key for ${label}`
      });
      button.addEventListener("click", () => {
        if (capturing === action) {
          stopCapture();
          return;
        }
        capturing = action;
        renderKeymap();
        const current = keymapHost.querySelector(`[data-capture="${action}"]`);
        current?.focus();
      });
      button.addEventListener("keydown", (event) => {
        if (capturing !== action) {
          return;
        }
        const key = event.key;
        if (typeof key !== "string" || key === "") {
          return;
        }
        if (key === "Escape") {
          event.preventDefault();
          stopCapture();
          return;
        }
        if (key === "Tab" || MODIFIER_KEYS.has(key)) {
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
          event.preventDefault();
          setStatus(keymapStatusNode, "Only unmodified keys can be bound; modifiers belong to the browser.", true);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        addKey(action, normalizeKey(key));
        stopCapture();
      });
      button.dataset.capture = action;
      return button;
    }
    function renderKeymap() {
      const rows = KEY_ACTIONS.map(({ action, label }) => {
        const keys = keymapDraft[action].map((key) => el("span", { class: "settings-key" }, el("span", { class: "settings-key-name", text: keyLabel(key) }), el("button", {
          class: "settings-key-remove",
          type: "button",
          text: "×",
          "aria-label": `Remove ${keyLabel(key)} from ${label}`,
          onclick: () => removeKey(action, key)
        })));
        const button = captureButton(action, label);
        if (capturing === action) {
          button.textContent = "Press a key…";
          button.classList.add("capturing");
        }
        return el("div", { class: "settings-key-row" }, el("span", { class: "settings-key-label", text: label }), el("span", { class: "settings-keys", "aria-label": `${label} keys` }, ...keys), button);
      });
      keymapHost.replaceChildren(...rows);
    }
    function renderBooleanFields() {
      const items = BOOLEAN_FIELDS.map(({ key, label, hint }) => {
        const control = createCheckbox({
          id: `settings-userscript-${key}`,
          checked: synced[key]
        });
        toggles.set(key, control);
        bindings.push({
          key,
          read: control.readChecked,
          write: control.writeChecked
        });
        return el("div", { class: "settings-row" }, control.element, el("div", { class: "settings-row-text" }, el("label", { for: `settings-userscript-${key}`, text: label }), el("span", { class: "settings-hint", text: hint })));
      });
      return el("div", { class: "settings-rows settings-rows-roomy" }, ...items);
    }
    function renderSelectFields() {
      const items = SELECT_FIELDS.map((field) => {
        const control = createSelect({
          class: "field-select settings-select",
          id: `settings-userscript-${field.key}`,
          value: synced[field.key],
          options: field.options
        });
        selects.set(field.key, control);
        bindings.push({
          key: field.key,
          read: control.read,
          write: control.write
        });
        return el("div", { class: "settings-field" }, el("label", {
          class: "eyebrow",
          for: `settings-userscript-${field.key}`,
          text: field.label
        }), control.element, el("span", { class: "settings-hint", text: field.hint }));
      });
      return el("div", { class: "settings-number-grid" }, ...items);
    }
    function renderNumberFields() {
      const items = NUMBER_FIELDS.map((field) => {
        const input = el("input", {
          class: "field-input settings-number-input",
          type: "number",
          id: `settings-userscript-${field.key}`,
          min: field.min,
          max: field.max,
          step: 1,
          inputmode: "numeric"
        });
        numbers.set(field, input);
        bindings.push({
          key: field.key,
          read: () => {
            const raw = input.value.trim();
            if (raw === "") {
              return synced[field.key];
            }
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? clampNumber(field.key, parsed) : synced[field.key];
          },
          write: (value) => {
            input.value = String(value);
          }
        });
        return el("div", { class: "settings-field" }, el("label", {
          class: "eyebrow",
          for: `settings-userscript-${field.key}`,
          text: field.label
        }), input, el("span", { class: "settings-hint", text: field.hint }));
      });
      return el("div", { class: "settings-number-grid" }, ...items);
    }
    function loadDraft(settings) {
      for (const [key, control] of toggles) {
        control.writeChecked(settings[key]);
      }
      for (const [field, input] of numbers) {
        input.value = String(settings[field.key]);
      }
      for (const [key, control] of selects) {
        control.write(settings[key]);
      }
      keymapBinding.write(settings.keymap);
    }
    function exportSettings() {
      const contents = serializeSettings(readDraft());
      const write = deps.exportFile ?? downloadFile;
      write("better-eh-settings.json", contents);
      setStatus(statusNode, "Exported better-eh-settings.json.");
    }
    function importSettings(text) {
      const result = parseSettingsJson(text);
      if (!result.ok) {
        setStatus(statusNode, result.error, true);
        return;
      }
      loadDraft(result.settings);
      setStatus(statusNode, "Imported settings; review the values and press Apply.");
      change();
    }
    const exportButton = el("button", {
      class: "btn btn-ghost settings-export",
      type: "button",
      text: "Export JSON"
    });
    exportButton.addEventListener("click", exportSettings);
    const importButton = el("button", {
      class: "btn btn-ghost settings-import",
      type: "button",
      text: "Import JSON"
    });
    const fileInput = el("input", {
      class: VISUALLY_HIDDEN,
      type: "file",
      accept: "application/json,.json",
      tabindex: -1,
      "aria-hidden": "true"
    });
    importButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      file.text().then((text) => {
        importSettings(text);
        fileInput.value = "";
      }, () => setStatus(statusNode, "Could not read that file.", true));
    });
    const keymapReset = el("button", {
      class: "btn btn-ghost settings-keymap-reset",
      type: "button",
      text: "Reset keys"
    });
    keymapReset.addEventListener("click", () => {
      keymapDraft = copyKeymap(DEFAULT_KEYMAP);
      setStatus(keymapStatusNode, "Keys reset to defaults; press Apply to save.");
      renderKeymap();
      change();
    });
    keymapHost = el("div", { class: "settings-keymap" });
    renderKeymap();
    const keymapSection = el("div", { class: "settings-panel-group" }, el("h3", { class: "settings-subhead", text: "Keyboard shortcuts" }), keymapStatusNode, keymapHost, keymapReset);
    const section = el("section", {
      class: "settings-section settings-panel",
      id: USERSCRIPT_SETTINGS_SECTION_ID,
      "aria-labelledby": `${USERSCRIPT_SETTINGS_SECTION_ID}-title`
    }, el("h2", {
      class: "settings-title",
      id: `${USERSCRIPT_SETTINGS_SECTION_ID}-title`,
      text: "Better EH"
    }), el("p", {
      class: "settings-hint",
      text: "Userscript preferences stored in this browser. Changes apply after you press Apply."
    }), el("div", { class: "settings-panel-group" }, el("h3", { class: "settings-subhead", text: "Reading and interface" }), renderBooleanFields()), el("div", { class: "settings-panel-group" }, el("h3", { class: "settings-subhead", text: "Reader layout" }), renderSelectFields()), el("div", { class: "settings-panel-group" }, el("h3", { class: "settings-subhead", text: "Sizing and network" }), renderNumberFields()), keymapSection, el("div", { class: "settings-panel-group" }, el("h3", { class: "settings-subhead", text: "Backup" }), el("div", { class: "settings-panel-actions" }, exportButton, importButton, fileInput), statusNode));
    for (const type of ["input", "change"]) {
      section.addEventListener(type, change);
    }
    loadDraft(synced);
    const engine = createSettingsDraft({ bindings, onChange: deps.onChange });
    return {
      element: section,
      bindings,
      isDirty: () => engine.isDirty(),
      apply: () => {
        const draft = readDraft();
        updateSettings(draft);
        loadDraft(draft);
        synced = cloneSettings(draft);
        engine.rebase();
      },
      reset: () => {
        engine.reset();
      }
    };
  }

  // src/views/settings.ts
  var saveSiteSettings = async (body, signal) => {
    await postForm(`${location.origin}/uconfig.php`, body, {
      tag: "uconfig-save",
      failure: "Saving settings failed",
      signal
    });
  };
  function humanize(name) {
    const words = name.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
    return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
  }
  function sectionIds(sections) {
    const used = new Set;
    return sections.map((section, index) => {
      const anchor = section.anchor.replace(/[^\w-]+/g, "-");
      const base = anchor === "" ? `settings-section-${index}` : `settings-${anchor}`;
      let id = base;
      for (let suffix = 2;used.has(id); suffix++) {
        id = `${base}-${suffix}`;
      }
      used.add(id);
      return id;
    });
  }
  function fieldId(sectionIndex, fieldIndex) {
    return `setting-${sectionIndex}-${fieldIndex}`;
  }
  function labeledField(field, id, control, sectionTitle) {
    const label = field.label ?? (sectionTitle !== "" ? sectionTitle : humanize(field.name));
    const hint = field.prompt !== "" && field.prompt !== label ? field.prompt : "";
    return el("div", { class: "settings-field" }, el("label", { class: "eyebrow", for: id, text: label }), control, hint === "" ? null : el("p", { class: "settings-hint", text: hint }));
  }
  function radioGroup(field, id, bindings) {
    const choices = [];
    const options = field.options.map((option, index) => {
      const inputId = `${id}-${index}`;
      const choice = createChoice({
        type: "radio",
        id: inputId,
        name: field.name,
        value: option.value,
        checked: option.value === field.value,
        disabled: option.disabled
      });
      choices.push(choice);
      return el("label", { class: "settings-row", for: inputId }, choice.element, el("span", { text: option.label }));
    });
    bindings.push({
      key: field.name,
      read: () => choices.find((choice) => choice.readChecked())?.element.value ?? "",
      write: (value) => {
        for (const choice of choices) {
          choice.writeChecked(choice.element.value === value);
        }
      }
    });
    return el("fieldset", { class: "settings-group" }, el("legend", { class: "settings-subhead", text: field.prompt || humanize(field.name) }), el("div", { class: "settings-rows" }, ...options));
  }
  function checkboxItem(field, id, bindings) {
    const control = createCheckbox({
      id,
      name: field.name,
      value: field.value === "" ? "on" : field.value,
      checked: field.value !== "",
      disabled: field.disabled
    });
    bindings.push({
      key: field.name,
      read: control.readValue,
      write: control.writeValue
    });
    return el("div", { class: "settings-row" }, control.element, el("label", { for: id, text: field.label ?? humanize(field.name) }));
  }
  function checkboxGroup(group, sectionIndex, bindings) {
    const items = group.map(({ field, index }) => checkboxItem(field, fieldId(sectionIndex, index), bindings));
    const prompt = group[0]?.field.prompt ?? "";
    if (prompt === "") {
      return el("div", { class: "settings-rows" }, ...items);
    }
    return el("fieldset", { class: "settings-group" }, el("legend", { class: "settings-subhead", text: prompt }), el("div", { class: "settings-rows" }, ...items));
  }
  function selectField2(field, id, bindings, sectionTitle) {
    const control = createSelect({
      class: "field-select",
      id,
      name: field.name,
      disabled: field.disabled,
      value: field.value,
      options: field.options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled
      }))
    });
    bindings.push({
      key: field.name,
      read: control.read,
      write: control.write
    });
    return labeledField(field, id, control.element, sectionTitle);
  }
  function textField2(field, id, bindings, sectionTitle) {
    const input = el("input", {
      class: "field-input",
      type: "text",
      id,
      name: field.name,
      value: field.value,
      inputmode: /^\d+$/u.test(field.value.trim()) ? "numeric" : null,
      autocomplete: "off",
      disabled: field.disabled ? "" : null
    });
    bindings.push({
      key: field.name,
      read: () => input.value,
      write: (value) => {
        input.value = value;
      }
    });
    return labeledField(field, id, input, sectionTitle);
  }
  function textareaField2(field, id, bindings, sectionTitle) {
    const textarea = el("textarea", {
      class: "field-input settings-textarea",
      id,
      name: field.name,
      rows: 4,
      disabled: field.disabled ? "" : null
    });
    textarea.value = field.value;
    bindings.push({
      key: field.name,
      read: () => textarea.value,
      write: (value) => {
        textarea.value = value;
      }
    });
    return labeledField(field, id, textarea, sectionTitle);
  }
  function hiddenField2(field, bindings) {
    const input = el("input", { type: "hidden", name: field.name, value: field.value });
    bindings.push({
      key: field.name,
      read: () => input.value,
      write: (value) => {
        input.value = value;
      }
    });
    return input;
  }
  function renderField(field, sectionIndex, fieldIndex, bindings, sectionTitle) {
    const id = fieldId(sectionIndex, fieldIndex);
    switch (field.kind) {
      case "radio":
        return radioGroup(field, id, bindings);
      case "checkbox":
        return checkboxItem(field, id, bindings);
      case "select":
        return selectField2(field, id, bindings, sectionTitle);
      case "text":
        return textField2(field, id, bindings, sectionTitle);
      case "textarea":
        return textareaField2(field, id, bindings, sectionTitle);
      case "hidden":
        return hiddenField2(field, bindings);
    }
  }
  function categoryChips2(entries, sectionIndex, bindings) {
    const row = el("div", { class: "settings-cat-chips" });
    for (const { field } of entries) {
      const category = field.category;
      if (!category) {
        continue;
      }
      const input = el("input", { type: "hidden", name: field.name, value: field.value });
      const chip = el("button", {
        class: `cat-chip ${category.cls}`,
        type: "button",
        text: category.name,
        title: "Show this category by default"
      });
      const paint = () => {
        const shown = categorySwitchShown(input.value);
        chip.setAttribute("aria-pressed", shown ? "true" : "false");
        chip.classList.toggle("is-off", !shown);
      };
      const binding = {
        key: field.name,
        read: () => input.value,
        write: (value) => {
          input.value = value;
          paint();
        }
      };
      binding.write(field.value);
      chip.addEventListener("click", () => {
        binding.write(categorySwitchValue(!categorySwitchShown(input.value)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      row.append(input, chip);
      bindings.push(binding);
    }
    return el("div", { class: "settings-field", id: `setting-${sectionIndex}-categories` }, el("span", { class: "eyebrow", text: "Default categories" }), row);
  }
  function renderSection(section, sectionIndex, id, bindings) {
    const children = [];
    const categoryEntries = section.fields.map((field, fieldIndex) => ({ field, index: fieldIndex })).filter(({ field }) => field.category !== null);
    const categoryIndexes = new Set(categoryEntries.map(({ index }) => index));
    if (categoryEntries.length > 0) {
      children.push(categoryChips2(categoryEntries, sectionIndex, bindings));
    }
    let index = 0;
    while (index < section.fields.length) {
      const field = section.fields[index];
      if (!field) {
        index++;
        continue;
      }
      if (categoryIndexes.has(index)) {
        index++;
        continue;
      }
      if (field.kind !== "checkbox") {
        children.push(renderField(field, sectionIndex, index, bindings, section.title));
        index++;
        continue;
      }
      const group = [{ field, index }];
      let next = index + 1;
      while (next < section.fields.length) {
        const candidate = section.fields[next];
        if (candidate?.kind !== "checkbox" || candidate.prompt !== field.prompt) {
          break;
        }
        group.push({ field: candidate, index: next });
        next++;
      }
      children.push(group.length === 1 && field.prompt === "" ? renderField(field, sectionIndex, index, bindings, section.title) : checkboxGroup(group, sectionIndex, bindings));
      index = next;
    }
    return el("section", { class: "settings-section", id, "aria-labelledby": `${id}-title` }, el("h2", { class: "settings-title", id: `${id}-title`, text: section.title }), ...children);
  }
  function renderSettings(host, sections, ctx, deps) {
    host.replaceChildren();
    const ids = sectionIds(sections);
    const uconfigBindings = [];
    const sectionNodes = [];
    const jumpLinks = [];
    let markCurrent = null;
    const panel = renderUserscriptSettings({ onChange: () => syncDirty() });
    const jumpLink = (id, title, index) => {
      const link = el("a", { class: "settings-jump-link", href: `#${id}`, text: title });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        history.replaceState(history.state, "", `#${id}`);
        markCurrent?.(index);
      }, { signal: ctx.signal });
      return link;
    };
    sections.forEach((section, index) => {
      const id = ids[index] ?? `settings-section-${index}`;
      sectionNodes.push(renderSection(section, index, id, uconfigBindings));
      jumpLinks.push(jumpLink(id, section.title, index));
    });
    sectionNodes.push(panel.element);
    jumpLinks.push(jumpLink(USERSCRIPT_SETTINGS_SECTION_ID, "Better EH", sections.length));
    const errorNode = el("p", { class: "settings-error", role: "alert", hidden: "" });
    const apply = el("button", {
      class: "btn btn-primary settings-apply",
      type: "button",
      text: "Apply"
    });
    const reset = el("button", {
      class: "btn btn-ghost settings-reset",
      type: "button",
      text: "Reset"
    });
    const dirtyLabel = el("span", {
      class: "settings-dirty",
      role: "status",
      text: "Unsaved changes",
      hidden: ""
    });
    const actions = el("div", { class: "settings-actions", role: "group", "aria-label": "Settings actions" }, errorNode, dirtyLabel, el("div", { class: "settings-action-buttons" }, reset, apply));
    const jump = el("nav", { class: "settings-jump", "aria-label": "Settings sections" }, ...jumpLinks);
    host.append(siteNav(ctx.signal), listHeader({
      title: "Settings",
      summary: [
        el("a", {
          class: "settings-native",
          href: "/uconfig.php?eh_native=1",
          "data-native": "",
          text: "Native settings",
          title: "Open the site's own settings page (display-name profiles, category switches)"
        })
      ]
    }), el("div", { class: "settings-page" }, jump, ...sectionNodes, actions));
    markCurrent = trackJumpRow({ row: jump, links: jumpLinks, sections: sectionNodes }, ctx.signal);
    const save = deps?.save ?? saveSiteSettings;
    const draft = createSettingsDraft({
      bindings: [...uconfigBindings, ...panel.bindings],
      onChange: () => syncDirty()
    });
    const uconfigKeys = new Set(uconfigBindings.map((binding) => binding.key));
    let saving = false;
    let dirty = false;
    const clearError = () => {
      errorNode.textContent = "";
      errorNode.setAttribute("hidden", "");
    };
    const showError = (message) => {
      errorNode.textContent = message;
      errorNode.removeAttribute("hidden");
    };
    function syncDirty() {
      dirty = draft.isDirty();
      apply.disabled = !dirty || saving;
      reset.disabled = !dirty || saving;
      dirtyLabel.hidden = !dirty;
    }
    const submit = async () => {
      if (saving) {
        return;
      }
      const changed = draft.changed();
      const overrides = new Map;
      for (const [key, value] of changed) {
        if (uconfigKeys.has(key)) {
          overrides.set(key, String(value));
        }
      }
      const settingsChanged = panel.bindings.some((binding) => changed.has(binding.key));
      if (overrides.size === 0 && !settingsChanged) {
        syncDirty();
        return;
      }
      saving = true;
      clearError();
      apply.disabled = true;
      reset.disabled = true;
      apply.textContent = "Saving…";
      try {
        if (overrides.size > 0) {
          await save(uconfigBody(sections, overrides), ctx.signal);
          if (ctx.signal.aborted) {
            return;
          }
        }
        if (settingsChanged) {
          panel.apply();
        }
        draft.rebase();
        showToast("Settings saved");
      } catch (cause) {
        if (!ctx.signal.aborted) {
          showError(errorText(cause, "Saving settings failed."));
        }
      } finally {
        saving = false;
        apply.textContent = "Apply";
        syncDirty();
      }
    };
    apply.addEventListener("click", () => {
      submit();
    }, { signal: ctx.signal });
    reset.addEventListener("click", () => {
      clearError();
      draft.reset();
    }, { signal: ctx.signal });
    for (const type of ["input", "change"]) {
      host.addEventListener(type, syncDirty, { signal: ctx.signal });
    }
    ctx.setLeaveGuard(() => !dirty || confirm("Discard unsaved changes to your settings?"));
    window.addEventListener("beforeunload", (event) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }, { signal: ctx.signal });
    ctx.signal.addEventListener("abort", () => ctx.setLeaveGuard(null), { once: true });
    syncDirty();
  }

  // src/views/toplist.ts
  var PODIUM_RANKS = 3;
  function sectionAnchor2(index) {
    return `toplist-section-${index}`;
  }
  function tabLink(tab) {
    return el("a", {
      class: tab.active ? "toplist-tab is-active" : "toplist-tab",
      href: tab.href,
      "aria-current": tab.active ? "page" : null,
      text: tab.label
    });
  }
  function tabStrip(tabs) {
    const groups = new Map;
    for (const tab of tabs) {
      const name = tab.group === "" ? "Toplists" : tab.group;
      const bucket = groups.get(name);
      if (bucket) {
        bucket.push(tab);
      } else {
        groups.set(name, [tab]);
      }
    }
    const strip = el("nav", { class: "toplist-tabs", "aria-label": "Toplist categories" });
    for (const [name, items] of groups) {
      strip.append(el("div", { class: "toplist-tab-group" }, el("h2", { class: "toplist-tab-group-title", text: name }), el("div", { class: "toplist-tab-links" }, ...items.map(tabLink))));
    }
    return strip;
  }
  function rankBadge(rank) {
    return el("span", {
      class: rank <= PODIUM_RANKS ? "toplist-rank is-top" : "toplist-rank",
      text: `#${rank}`
    });
  }
  function entryRow(entry) {
    const label = entry.href === null ? el("span", { class: "toplist-label", text: entry.label }) : el("a", {
      class: entry.gid === null ? "toplist-label" : "toplist-label is-gallery",
      href: entry.href,
      text: entry.label
    });
    const row = el("li", { class: entry.gid === null ? "toplist-row" : "toplist-row is-gallery" }, rankBadge(entry.rank), label);
    if (entry.score !== null) {
      row.append(el("span", { class: "toplist-score", text: entry.score }));
    }
    if (entry.gid !== null) {
      const meta = el("div", { class: "toplist-meta" });
      if (entry.category) {
        meta.append(el("span", { class: `cat-badge ${entry.category.cls}`, text: entry.category.name }));
      }
      if (entry.uploader !== null) {
        meta.append(entry.uploaderHref === null ? el("span", { text: entry.uploader }) : el("a", { class: "toplist-uploader", href: entry.uploaderHref, text: entry.uploader }));
      }
      if (entry.posted !== "") {
        meta.append(el("span", { text: entry.posted }));
      }
      if (entry.pages !== null) {
        meta.append(el("span", { text: countText(entry.pages, "page") }));
      }
      if (entry.torrentsHref !== null) {
        meta.append(el("a", {
          class: "toplist-torrents",
          href: entry.torrentsHref,
          "data-native": "",
          target: "_blank",
          rel: "nofollow noopener",
          text: "Torrents"
        }));
      }
      if (meta.childElementCount > 0) {
        row.append(meta);
      }
    }
    return row;
  }
  function rowsList(entries) {
    const rows = el("ol", { class: "toplist-rows" });
    for (const entry of entries) {
      rows.append(entryRow(entry));
    }
    return rows;
  }
  function sectionBlock(section, index) {
    return el("section", { class: "toplist-section", id: sectionAnchor2(index), "aria-label": section.title }, el("h2", { class: "toplist-section-title", text: section.title }), rowsList(section.entries));
  }
  function jumpNav(sections) {
    if (sections.length < 4) {
      return null;
    }
    const links = sections.map((section, index) => el("a", {
      class: "toplist-jump-link",
      href: `#${sectionAnchor2(index)}`,
      text: section.title
    }));
    return {
      nav: el("nav", { class: "toplist-jump", "aria-label": "Toplist sections" }, ...links),
      links
    };
  }
  function summary(data) {
    if (data.kind === "category") {
      return countText(data.entries.length, "ranked entry", "ranked entries");
    }
    const selected = data.tabs.find((tab) => tab.active);
    return selected ? `${selected.group} · ${selected.label}` : "All categories";
  }
  function emptyState() {
    return statePanel({
      text: "No toplists were found on this page.",
      actions: [nativePageAction()]
    });
  }
  function categoryBody(data, ctx) {
    if (data.entries.length === 0) {
      return [emptyState()];
    }
    const nodes = [
      el("section", { class: "toplist-section", "aria-label": data.title }, rowsList(data.entries))
    ];
    if (data.pager) {
      nodes.push(pager({
        prev: data.pager.prevHref,
        next: data.pager.nextHref,
        info: `Page ${data.pager.page} of ${data.pager.pages}`,
        label: "Toplist pages",
        pages: {
          current: data.pager.page,
          total: data.pager.pages,
          href: (page) => pageHref(data.url, page, "p")
        },
        jump: {
          current: data.pager.page,
          go: (page) => ctx.navigate(pageHref(data.url, page, "p"))
        }
      }));
    }
    return nodes;
  }
  function renderToplist(host, data, ctx) {
    host.replaceChildren();
    host.append(siteNav(ctx.signal), listHeader({
      title: data.kind === "category" ? data.title : "Toplists",
      summary: [el("span", { text: summary(data) })]
    }));
    if (data.tabs.length > 0) {
      host.append(tabStrip(data.tabs));
    }
    switch (data.kind) {
      case "overview": {
        if (data.sections.length === 0) {
          host.append(emptyState());
          return;
        }
        const blocks = data.sections.map((section, index) => sectionBlock(section, index));
        const jump = jumpNav(data.sections);
        if (jump) {
          host.append(jump.nav);
        }
        host.append(el("div", { class: "toplist-sections" }, ...blocks));
        if (jump) {
          const activate = trackJumpRow({ row: jump.nav, links: jump.links, sections: blocks }, ctx.signal);
          jump.links.forEach((link, index) => {
            link.addEventListener("click", (event) => {
              event.preventDefault();
              blocks[index]?.scrollIntoView({ block: "start" });
              history.replaceState(history.state, "", `#${sectionAnchor2(index)}`);
              activate(index);
            }, { signal: ctx.signal });
          });
        }
        return;
      }
      case "category":
        host.append(...categoryBody(data, ctx));
        return;
    }
  }

  // src/views/torrents.ts
  var STATUS_OPTIONS = [
    { status: "all", label: "All" },
    { status: "seeded", label: "Seeded" },
    { status: "unseeded", label: "Unseeded" }
  ];
  function filterUrl(baseUrl, patch) {
    const url = new URL(baseUrl);
    url.searchParams.delete("page");
    if (patch.status !== undefined) {
      if (patch.status === "all") {
        url.searchParams.delete("s");
      } else {
        url.searchParams.set("s", patch.status);
      }
    }
    if (patch.mine === true) {
      const member = memberId();
      if (member !== null) {
        url.searchParams.set("u", member);
      }
    } else if (patch.mine === false) {
      url.searchParams.delete("u");
    }
    if (patch.search !== undefined) {
      if (patch.search.trim() === "") {
        url.searchParams.delete("search");
      } else {
        url.searchParams.set("search", patch.search.trim());
      }
    }
    return url.href;
  }
  function sortHref(baseUrl, key) {
    const url = new URL(baseUrl);
    url.searchParams.delete("page");
    if (key === null) {
      url.searchParams.delete("o");
    } else {
      url.searchParams.set("o", key);
    }
    return url.href;
  }
  function searchForm(data, ctx) {
    const input = searchInput({
      class: "field-input torrent-search-input",
      name: "search",
      value: data.search,
      placeholder: "Search torrents",
      "aria-label": "Search torrents"
    });
    const submit = el("button", { class: "btn btn-small", type: "submit", text: "Search" });
    const form = el("form", { class: "torrent-search", role: "search" }, input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ctx.navigate(filterUrl(data.url, { search: input.value }));
    }, { signal: ctx.signal });
    return form;
  }
  function statusFilter(data, ctx) {
    const group = el("div", { class: "torrent-status", role: "group", "aria-label": "Status" });
    for (const option of STATUS_OPTIONS) {
      const button = el("button", {
        class: "btn btn-small torrent-filter-btn",
        type: "button",
        "aria-pressed": String(data.status === option.status),
        text: option.label
      });
      button.addEventListener("click", () => ctx.navigate(filterUrl(data.url, { status: option.status })), { signal: ctx.signal });
      group.append(button);
    }
    return group;
  }
  function mineActive(data) {
    const member = memberId();
    return member !== null && data.uploaderFilter === member;
  }
  function mineToggle(data, ctx) {
    const member = memberId();
    const input = el("input", {
      type: "checkbox",
      disabled: member === null ? "disabled" : null
    });
    input.checked = mineActive(data);
    input.addEventListener("change", () => ctx.navigate(filterUrl(data.url, { mine: input.checked })), {
      signal: ctx.signal
    });
    const label = el("label", {
      class: "check torrent-filter-label torrent-mine",
      title: member === null ? "Sign in to see only your torrents" : "Show only your torrents"
    }, input, el("span", { text: "Only my torrents" }));
    if (member === null) {
      label.classList.add("is-disabled");
    }
    return label;
  }
  function uploaderFilterNote(data, ctx) {
    if (data.uploaderFilter === null || mineActive(data)) {
      return null;
    }
    const clear = el("button", {
      class: "btn btn-ghost btn-small",
      type: "button",
      text: "Clear"
    });
    clear.addEventListener("click", () => ctx.navigate(filterUrl(data.url, { mine: false })), {
      signal: ctx.signal
    });
    return el("div", { class: "torrent-filter-note" }, el("span", { text: `Uploader #${data.uploaderFilter}` }), clear);
  }
  function filterBar(data, ctx) {
    const note = uploaderFilterNote(data, ctx);
    return el("div", { class: "torrent-filters" }, searchForm(data, ctx), el("div", { class: "torrent-filter" }, el("span", { class: "torrent-filter-label", text: "Status" }), statusFilter(data, ctx)), mineToggle(data, ctx), note ?? null);
  }
  function tableHead(data) {
    const row = el("tr");
    const columns = [
      ["Added", "torrent-added", null],
      ["Torrent Name", "torrent-name", undefined],
      ["Gallery", "is-right torrent-gallery", undefined],
      ["Size", "is-right torrent-size", "bd"],
      ["Seeds", "is-right torrent-seeds", "sd"],
      ["Peers", "is-right torrent-peers", "dd"],
      ["DLs", "is-right torrent-downloads", "cd"],
      ["Uploader", "torrent-uploader", undefined]
    ];
    for (const [label, extra, key] of columns) {
      const cell = el("th", { class: `torrent-cell ${extra}`, scope: "col" });
      if (key === undefined) {
        cell.textContent = label;
      } else {
        const active = data.sort === key;
        cell.append(el("a", {
          class: active ? "torrent-sort is-active" : "torrent-sort",
          href: sortHref(data.url, key),
          text: label,
          title: key === null ? "Sort by newest" : `Sort by ${label.toLowerCase()}`,
          "aria-current": active ? "true" : null
        }));
      }
      row.append(cell);
    }
    return el("thead", {}, row);
  }
  function galleryCell(row) {
    const cell = el("td", {
      class: "torrent-cell is-right torrent-gallery",
      "data-label": "Gallery",
      "aria-label": `Gallery: ${row.gid ?? "none"}`
    });
    if (row.galleryHref !== null && row.gid !== null) {
      cell.append(el("a", { class: "torrent-link", href: row.galleryHref, text: row.gid }));
    } else {
      cell.append(el("span", { text: row.gid ?? "—" }));
    }
    return cell;
  }
  function uploaderCell(row) {
    const cell = el("td", {
      class: "torrent-cell torrent-uploader",
      "data-label": "Uploader",
      "aria-label": `Uploader: ${row.uploader ?? "none"}`
    });
    if (row.uploader === null) {
      cell.append(el("span", { text: "—" }));
    } else if (row.uploaderHref !== null) {
      cell.append(el("a", {
        class: "torrent-link torrent-uploader-text",
        href: row.uploaderHref,
        title: row.uploader,
        text: row.uploader
      }));
    } else {
      cell.append(el("span", { class: "torrent-uploader-text", title: row.uploader, text: row.uploader }));
    }
    return cell;
  }
  function nameCell(row) {
    const cell = el("td", { class: "torrent-cell torrent-name" });
    cell.append(row.torrentHref === null ? el("span", { class: "torrent-name-text", title: row.name, text: row.name }) : el("a", {
      class: "torrent-name-text torrent-name-link",
      href: row.torrentHref,
      "data-native": "",
      rel: "nofollow",
      title: row.name,
      text: row.name
    }));
    return cell;
  }
  function torrentRow(row) {
    return el("tr", { class: "torrent-row" }, el("td", {
      class: "torrent-cell torrent-added",
      "data-label": "Added",
      "aria-label": `Added: ${row.added}`,
      text: row.added
    }), nameCell(row), galleryCell(row), el("td", {
      class: "torrent-cell is-right torrent-size",
      "data-label": "Size",
      "aria-label": `Size: ${row.size}`,
      text: row.size
    }), el("td", {
      class: "torrent-cell is-right torrent-seeds",
      "data-label": "Seeds",
      "aria-label": `Seeds: ${row.seeds}`,
      text: String(row.seeds)
    }), el("td", {
      class: "torrent-cell is-right torrent-peers",
      "data-label": "Peers",
      "aria-label": `Peers: ${row.peers}`,
      text: String(row.peers)
    }), el("td", {
      class: "torrent-cell is-right torrent-downloads",
      "data-label": "Dls",
      "aria-label": `Downloads: ${row.downloads}`,
      text: String(row.downloads)
    }), uploaderCell(row));
  }
  function torrentTable(data) {
    const body = el("tbody");
    for (const row of data.rows) {
      body.append(torrentRow(row));
    }
    return el("table", { class: "torrent-table" }, el("caption", { class: "sr-only", text: "Torrents" }), tableHead(data), body);
  }
  function renderTorrents(host, data, ctx) {
    host.replaceChildren();
    const header = listHeader({
      title: "Torrents",
      summary: [
        el("span", {
          text: data.summary ?? countText(data.rows.length, "torrent")
        })
      ]
    });
    const filtered = data.search !== "" || data.status !== "all" || data.uploaderFilter !== null;
    const body = data.rows.length === 0 ? statePanel({
      text: filtered ? "No torrents match this filter." : "No torrents were found on this page.",
      actions: [
        ...filtered ? [{ label: "Clear filters", primary: true, href: "/torrents.php" }] : [],
        nativePageAction()
      ]
    }) : el("div", { class: "torrent-table-wrap" }, torrentTable(data));
    host.append(siteNav(ctx.signal), header, filterBar(data, ctx), body);
    const total = data.pages[data.pages.length - 1] ?? data.page;
    if (total > 1) {
      host.append(pager({
        label: "Torrent pages",
        prev: null,
        next: null,
        pages: {
          current: data.page,
          total,
          href: (page) => pageHref(data.url, page, "page")
        },
        jump: {
          current: data.page,
          go: (page) => ctx.navigate(pageHref(data.url, page, "page"))
        }
      }));
    }
  }

  // src/fetch/images.ts
  var preloadContainer = null;
  function ensurePreloadContainer() {
    if (preloadContainer) {
      return preloadContainer;
    }
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    preloadContainer = container;
    document.body.append(preloadContainer);
    return preloadContainer;
  }
  var imgCache = createLru(getSettings().imgCacheLimit, (img, src) => {
    img.remove();
    log("evicted preload", src);
  });
  onSettingsChange((settings) => {
    imgCache.setLimit(settings.imgCacheLimit);
  });
  function touchImage(src) {
    imgCache.get(src);
  }
  function preloadImage(src) {
    const cached = imgCache.get(src);
    if (cached) {
      return cached;
    }
    const container = ensurePreloadContainer();
    const img = document.createElement("img");
    img.onload = () => {
      img.decode().then(() => log("preload + decode done", src), (error) => warn("preload decode failed", src, error));
    };
    img.onerror = () => warn("preload error", src);
    img.src = src;
    container.append(img);
    imgCache.set(src, img);
    log("preloading", src);
    return img;
  }

  // src/fetch/prefetch.ts
  var PREFETCH_IDLE_MS = 150;
  function createPrefetcher(deps) {
    const clock = deps.clock;
    let generation = 0;
    let timer;
    let inflight = null;
    let chain = Promise.resolve();
    function stop() {
      generation += 1;
      if (timer !== undefined) {
        clock.clearTimeout(timer);
        timer = undefined;
      }
      inflight?.abort();
      inflight = null;
    }
    function exclusive(task) {
      const run = chain.then(task, task);
      chain = run.then(() => {
        return;
      }, () => {
        return;
      });
      return run;
    }
    async function warmPage(href, mine, signal) {
      return exclusive(async () => {
        if (generation !== mine) {
          return null;
        }
        if (deps.activeCount() >= deps.concurrency() - 1) {
          return null;
        }
        try {
          return await deps.viewerPage(href, {
            priority: priorityOf("prefetch"),
            tag: "prefetch",
            signal,
            cancel: true
          });
        } catch (error) {
          if (error instanceof RateLimitedError) {
            stop();
            return null;
          }
          if (!isAbortError(error)) {
            warn("prefetch page failed", href, error);
          }
          return null;
        }
      });
    }
    function preloadPageImage(page, mine) {
      const img = deps.preloadImage(page.imgSrc);
      img.addEventListener("error", () => {
        if (generation !== mine) {
          return;
        }
        deps.retryWithNl(page).then((retried) => {
          if (retried !== null && retried.imgSrc !== "" && generation === mine) {
            deps.preloadImage(retried.imgSrc);
          }
        });
      }, { once: true });
    }
    async function warmOneWay(start, step, mine, signal, depth) {
      const images = [];
      let page = start;
      for (let index = 0;index < depth; index++) {
        if (generation !== mine) {
          break;
        }
        const href = step(page);
        if (href === null) {
          break;
        }
        const next = await warmPage(href, mine, signal);
        if (next === null || generation !== mine) {
          break;
        }
        if (next.imgSrc) {
          preloadPageImage(next, mine);
          images.push(next.imgSrc);
        }
        page = next;
      }
      return images;
    }
    function touchWarmed(forward, backward) {
      const deepest = Math.max(forward.length, backward.length) - 1;
      for (let index = deepest;index >= 0; index--) {
        const behind = backward[index];
        if (behind !== undefined) {
          deps.touchImage(behind);
        }
        const ahead = forward[index];
        if (ahead !== undefined) {
          deps.touchImage(ahead);
        }
      }
    }
    function warm(data) {
      stop();
      const depth = deps.depth();
      if (depth < 1) {
        return;
      }
      const mine = generation;
      const signal = new AbortController;
      inflight = signal;
      timer = clock.setTimeout(() => {
        timer = undefined;
        if (generation !== mine) {
          return;
        }
        (async () => {
          const [forward, backward] = await Promise.all([
            warmOneWay(data, (page) => page.nextHref, mine, signal.signal, depth),
            warmOneWay(data, (page) => page.prevHref, mine, signal.signal, depth)
          ]);
          if (generation === mine) {
            touchWarmed(forward, backward);
          }
        })().catch((error) => {
          warn("prefetch error", error);
        });
      }, PREFETCH_IDLE_MS);
    }
    return { warm, cancel: stop };
  }

  // src/keymap.ts
  function isKey(e, action) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
      return false;
    }
    return getSettings().keymap[action].includes(e.key.toUpperCase());
  }

  // src/zoom.ts
  function nativeZoomLimit(displayed, natural) {
    return displayed > 0 && natural > 0 ? natural / displayed : Number.POSITIVE_INFINITY;
  }

  class ZoomController {
    zoomLevel = 1;
    zoomSnapTimer;
    panX = 0;
    panY = 0;
    isDragging = false;
    startX = 0;
    startY = 0;
    hasMoved = false;
    container;
    getSurface;
    getFitHeight;
    onZoom;
    surface = null;
    constructor(container, getSurface, getFitHeight, signal, onZoom) {
      this.container = container;
      this.getSurface = getSurface;
      this.getFitHeight = getFitHeight;
      this.onZoom = onZoom;
      this.initEvents(signal);
      signal.addEventListener("abort", () => {
        clearTimeout(this.zoomSnapTimer);
        this.isDragging = false;
        this.surface?.classList.remove("no-transition");
        this.surface?.style.removeProperty("transform");
        this.surface = null;
        this.container.style.removeProperty("cursor");
      }, { once: true });
    }
    currentSurface() {
      const next = this.getSurface();
      if (next !== this.surface) {
        this.surface?.style.removeProperty("transform");
        this.surface?.classList.remove("no-transition");
        this.surface = next;
      }
      return next;
    }
    initEvents(signal) {
      this.container.addEventListener("mousedown", (e) => this.onMouseDown(e), { signal });
      window.addEventListener("mousemove", (e) => this.onMouseMove(e), { signal });
      window.addEventListener("mouseup", () => this.onMouseUp(), { signal });
      window.addEventListener("wheel", (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          this.updateZoom(e.deltaY < 0 ? 0.1 : -0.1, this.getFitHeight());
        }
      }, { passive: false, signal });
    }
    updateTransform() {
      const surface = this.currentSurface();
      const imgWidth = surface.clientWidth;
      const imgHeight = surface.clientHeight;
      const scaledWidth = imgWidth * this.zoomLevel;
      const scaledHeight = imgHeight * this.zoomLevel;
      const limitX = Math.max(0, (scaledWidth - window.innerWidth) / 2);
      const limitY = Math.max(0, (scaledHeight - window.innerHeight) / 2);
      this.panX = Math.max(-limitX, Math.min(this.panX, limitX));
      this.panY = Math.max(-limitY, Math.min(this.panY, limitY));
      surface.style.transform = this.zoomLevel === 1 && this.panX === 0 && this.panY === 0 ? "" : `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    }
    updateZoom(delta, isFitHeight) {
      if (delta === null) {
        this.reset();
      } else if (!isFitHeight) {
        showToast("Press F to switch to fit-height before zooming");
        return;
      } else {
        this.zoomLevel = Math.max(0.7, Math.min(5, this.zoomLevel + delta));
        this.updateTransform();
        this.onZoom?.(this.zoomLevel);
        showToast(`Zoom ${Math.round(this.zoomLevel * 100)}%`);
      }
      clearTimeout(this.zoomSnapTimer);
      if (this.zoomLevel < 1) {
        this.zoomSnapTimer = window.setTimeout(() => {
          this.reset();
          showToast("Zoom 100%");
        }, 200);
      }
    }
    reset() {
      clearTimeout(this.zoomSnapTimer);
      this.zoomLevel = 1;
      this.panX = 0;
      this.panY = 0;
      this.hasMoved = false;
      this.updateTransform();
      this.onZoom?.(this.zoomLevel);
    }
    getZoomLevel() {
      return this.zoomLevel;
    }
    setZoom(level, isFitHeight) {
      if (!isFitHeight) {
        return;
      }
      clearTimeout(this.zoomSnapTimer);
      this.zoomLevel = Math.max(1, Math.min(5, level));
      this.updateTransform();
      this.onZoom?.(this.zoomLevel);
    }
    onMouseDown(e) {
      if (e.button !== 0 || !this.getFitHeight()) {
        return;
      }
      if (e.target instanceof Element && e.target.closest("#hud, #page-info")) {
        return;
      }
      e.preventDefault();
      if (this.zoomLevel > 1) {
        this.isDragging = true;
        this.hasMoved = false;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
        this.container.style.cursor = "grabbing";
        this.currentSurface().classList.add("no-transition");
      }
    }
    onMouseMove(e) {
      if (this.isDragging) {
        const newPanX = e.clientX - this.startX;
        const newPanY = e.clientY - this.startY;
        if (Math.abs(newPanX - this.panX) > 2 || Math.abs(newPanY - this.panY) > 2) {
          this.hasMoved = true;
        }
        this.panX = newPanX;
        this.panY = newPanY;
        this.updateTransform();
      }
    }
    onMouseUp() {
      if (this.isDragging) {
        this.isDragging = false;
        this.container.style.removeProperty("cursor");
        this.surface?.classList.remove("no-transition");
      }
    }
    handleKey(e, isFitHeight) {
      if (isFitHeight && this.zoomLevel > 1) {
        if (isKey(e, "up")) {
          this.panY += getSettings().scrollStep;
          this.updateTransform();
          return true;
        }
        if (isKey(e, "down")) {
          this.panY -= getSettings().scrollStep;
          this.updateTransform();
          return true;
        }
      }
      return false;
    }
    panBy(dx, dy) {
      this.panX += dx;
      this.panY += dy;
      this.updateTransform();
    }
    consumePanned() {
      const panned = this.hasMoved;
      this.hasMoved = false;
      return panned;
    }
  }

  // src/page-image.ts
  function showPageImage({
    img,
    page,
    retry,
    maxRetries,
    onGiveUp,
    onLoaded
  }) {
    let gaveUp = false;
    const clearHandlers = () => {
      img.onload = null;
      img.onerror = null;
    };
    const render = (data, attempt) => {
      clearHandlers();
      if (img.src === data.imgSrc && img.complete && img.naturalWidth > 0) {
        log("instant from cache", data.imgSrc);
        onLoaded?.(data);
        return;
      }
      img.onload = () => {
        onLoaded?.(data);
      };
      img.onerror = () => {
        if (gaveUp) {
          return;
        }
        clearHandlers();
        warn(`image failed (attempt ${attempt + 1})`, data.imgSrc);
        if (attempt >= maxRetries) {
          gaveUp = true;
          warn("giving up");
          onGiveUp();
          return;
        }
        retry(data).then((retried) => {
          if (retried) {
            render(retried, attempt + 1);
            return;
          }
          if (!gaveUp) {
            gaveUp = true;
            warn("image retry unavailable");
            onGiveUp();
          }
        }).catch((error) => {
          if (gaveUp) {
            return;
          }
          gaveUp = true;
          warn("image retry failed", error);
          onGiveUp();
        });
      };
      img.src = data.imgSrc;
    };
    render(page, 0);
  }
  function createPageImageSlot(img, {
    page: initialPage,
    retry,
    maxRetries,
    onLoaded,
    onGiveUp,
    signal,
    isCurrent,
    probe: createProbe
  }) {
    let page = initialPage;
    let upgradePending = false;
    let upgradeFailed = false;
    let upgraded = false;
    const show = () => {
      showPageImage({
        img,
        page,
        retry,
        maxRetries,
        onGiveUp: onGiveUp ?? (() => {
          return;
        }),
        onLoaded: (loaded) => {
          page = loaded;
          onLoaded?.(loaded);
        }
      });
    };
    const reload = () => {
      const source = img.getAttribute("src");
      if (source === null || source === "") {
        return false;
      }
      const base = source.replace(/([?&])nl=[^&]*/u, "");
      const token = page.nlToken ?? String(Date.now());
      img.src = `${base}${base.includes("?") ? "&" : "?"}nl=${token}`;
      return true;
    };
    const upgrade = (level) => {
      if (upgradePending || upgradeFailed || upgraded) {
        return;
      }
      const source = page.originalHref;
      if (source === null || source === page.imgSrc) {
        return;
      }
      const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      if (level <= nativeZoomLimit(img.clientHeight * dpr, img.naturalHeight)) {
        return;
      }
      upgradePending = true;
      const probe = createProbe ? createProbe() : new Image;
      probe.onload = () => {
        upgradePending = false;
        if (signal?.aborted || isCurrent?.() === false) {
          return;
        }
        if (probe.naturalWidth <= img.naturalWidth && probe.naturalHeight <= img.naturalHeight) {
          upgradeFailed = true;
          return;
        }
        upgraded = true;
        img.src = source;
        log("original image", source);
      };
      probe.onerror = () => {
        upgradePending = false;
        upgradeFailed = true;
      };
      probe.src = source;
    };
    return {
      img,
      get page() {
        return page;
      },
      show,
      reload,
      upgrade
    };
  }

  // src/reader-mode.ts
  function readerLayout(mode) {
    return {
      spread: mode === "spread",
      continuous: mode === "continuous"
    };
  }
  function clickIntent(ratio, mode, direction) {
    if (ratio >= 0.3 && ratio <= 0.7) {
      return "toggle";
    }
    if (mode === "continuous") {
      return ratio < 0.5 ? "prev" : "next";
    }
    const forward = ratio > 0.7;
    const next = direction === "ltr" ? forward : !forward;
    return next ? "next" : "prev";
  }
  function swipeIntent(dx, minDistance, mode, direction) {
    if (Math.abs(dx) < minDistance) {
      return null;
    }
    if (mode === "continuous") {
      return dx < 0 ? "next" : "prev";
    }
    const forward = dx < 0;
    return (direction === "ltr" ? forward : !forward) ? "next" : "prev";
  }

  // src/shell.html
  var shell_default = `<div id="reader">
  <span id="img-wrap">
    <img id="main-img" alt="" />
    <img id="spread-img" alt="" hidden />
  </span>
  <div id="continuous" hidden></div>
  <div id="hud">
    <a id="hud-gallery" href="" title="Back to gallery" aria-label="Back to gallery"></a>
    <div class="hud-spacer"></div>
    <h1 id="hud-title"></h1>
  </div>
  <div id="page-nav">
    <span class="page-nav-group">
      <button id="hud-first" type="button" aria-label="First page" title="First page"></button>
      <button id="hud-prev" type="button" aria-label="Previous page" title="Previous page"></button>
    </span>
    <span class="page-nav-group">
      <button id="hud-next" type="button" aria-label="Next page" title="Next page"></button>
      <button id="hud-last" type="button" aria-label="Last page" title="Last page"></button>
    </span>
  </div>
  <div id="page-info">
    <div id="hud-counter"></div>
    <div id="file-info"></div>
    <div id="page-links">
      <a id="hud-original" href="" download>Original</a>
      <a id="hud-forum" href="" target="_blank" rel="noopener">Forum link</a>
      <a id="hud-search" href="">Find this image</a>
    </div>
  </div>
  <div id="hud-help" role="group" aria-label="Reader shortcuts" hidden>
    <p id="hud-help-title">Shortcuts</p>
    <dl>
      <dt>
        <kbd class="kbd">←</kbd><kbd class="kbd">→</kbd><kbd class="kbd">A</kbd
        ><kbd class="kbd">D</kbd>
      </dt>
      <dd>Previous / next page</dd>
      <dt>
        <kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd><kbd class="kbd">W</kbd
        ><kbd class="kbd">S</kbd>
      </dt>
      <dd>Scroll or pan</dd>
      <dt>Click</dt>
      <dd>Page edge steps; the middle pins the HUD</dd>
      <dt>Swipe</dt>
      <dd>Horizontal swipe on touch</dd>
      <dt><kbd class="kbd">F</kbd></dt>
      <dd>Toggle fit-height / natural-width</dd>
      <dt>
        <kbd class="kbd">Ctrl</kbd><kbd class="kbd">+</kbd><kbd class="kbd">−</kbd
        ><kbd class="kbd">0</kbd>
      </dt>
      <dd>Zoom in / out / reset</dd>
      <dt><kbd class="kbd">Q</kbd><kbd class="kbd">Esc</kbd></dt>
      <dd>Back to the gallery</dd>
      <dt><kbd class="kbd">?</kbd></dt>
      <dd>Show or hide this panel</dd>
      <dt>Settings</dt>
      <dd>Reader layout (single, spread, continuous), page direction, and keys</dd>
    </dl>
  </div>
  <div id="hud-toast" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="img-error" role="alert" hidden>
    <p id="img-error-text">This page could not be loaded.</p>
    <button id="img-error-retry" class="img-error-retry" type="button">Retry</button>
  </div>
</div>
`;

  // src/ui/continuous-stack.ts
  function createContinuousStack({
    container,
    initial,
    next,
    key,
    load,
    render,
    onChange,
    signal
  }) {
    const pages = [];
    const appendPage = (item) => {
      const rendered = render(item);
      pages.push({ node: rendered.node, view: rendered.view });
      container.insertBefore(rendered.node, scroll.element);
    };
    const scroll = infiniteScroll({
      next,
      key,
      initialKeys: [key(initial)],
      load,
      noun: "pages",
      rootMargin: "150% 0px",
      signal,
      onChange,
      append: (items) => {
        for (const item of items) {
          appendPage(item);
        }
      }
    });
    scroll.element.classList.add("continuous-status", "reader-sentinel");
    container.replaceChildren(scroll.element);
    appendPage(initial);
    return {
      pages: () => pages,
      state: scroll.state,
      loadNext: scroll.loadNext,
      retry: scroll.retry,
      stop: scroll.stop
    };
  }

  // src/view-mode.ts
  function applyViewMode({
    viewer,
    fitHeight,
    cursorHidden,
    readerMode,
    readingDirection
  }) {
    const { classList } = document.body;
    classList.toggle("eh-viewer", viewer);
    classList.toggle("fit-h", viewer && fitHeight);
    classList.toggle("fit-w", viewer && !fitHeight);
    classList.toggle("reader-spread", viewer && readerMode === "spread");
    classList.toggle("reader-continuous", viewer && readerMode === "continuous");
    classList.toggle("reader-rtl", viewer && readingDirection === "rtl");
    classList.toggle("no-cursor", cursorHidden);
  }
  function setCursorHidden(hidden) {
    document.body.classList.toggle("no-cursor", hidden);
  }
  function resetViewMode() {
    document.body.classList.remove("eh-viewer", "fit-h", "fit-w", "reader-spread", "reader-continuous", "reader-rtl", "no-cursor");
  }

  // src/views/shell.ts
  function requireShell(id) {
    const node = document.getElementById(id);
    if (!node) {
      throw new Error(`missing #${id} in shell.html`);
    }
    return node;
  }

  // src/views/viewer.ts
  var HIDE_CURSOR_AFTER = 3000;
  var SWIPE_MIN = 50;
  function mountViewer(host, pageData, ctx) {
    host.innerHTML = shell_default;
    const ui = {
      elReader: requireShell("reader"),
      elWrap: requireShell("img-wrap"),
      elImg: requireShell("main-img"),
      elSpread: requireShell("spread-img"),
      elContinuous: requireShell("continuous"),
      elTitle: requireShell("hud-title"),
      elCounter: requireShell("hud-counter"),
      elFileInfo: requireShell("file-info"),
      elGallery: requireShell("hud-gallery"),
      elFirst: requireShell("hud-first"),
      elPrev: requireShell("hud-prev"),
      elNext: requireShell("hud-next"),
      elLast: requireShell("hud-last"),
      elOriginal: requireShell("hud-original"),
      elForum: requireShell("hud-forum"),
      elSearch: requireShell("hud-search"),
      elHelp: requireShell("hud-help"),
      elError: requireShell("img-error"),
      elErrorText: requireShell("img-error-text"),
      elErrorRetry: requireShell("img-error-retry")
    };
    ui.elGallery.append(icon("back"));
    ui.elFirst.append(icon("first"));
    ui.elPrev.append(icon("chevronLeft"));
    ui.elNext.append(icon("chevronRight"));
    ui.elLast.append(icon("last"));
    const prefetcher = createPrefetcher({
      viewerPage: (url, options) => loader.viewerPage(url, options),
      preloadImage,
      touchImage,
      retryWithNl: (page) => loader.retryWithNl(page),
      activeCount: () => net.activeCount,
      concurrency: () => getSettings().netConcurrency,
      depth: () => getSettings().prefetchCount,
      clock: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle)
      }
    });
    const setSpreadSingle = (single) => {
      ui.elWrap.classList.toggle("is-single", single);
    };
    const setHelp = (open) => {
      ui.elHelp.hidden = !open;
    };
    let current = pageData;
    let chromePinned = false;
    let mainSlot = null;
    let companionSlot = null;
    let spreadCompanion = null;
    let spreadToken = 0;
    let navigationToken = 0;
    let stack = null;
    let continuousIndex = 0;
    let continuousAspect = 1.4;
    let activeMode = getSettings().readerMode;
    let resumeTimer;
    let resumePage = null;
    function makeSurface(element, primary, visible) {
      return {
        element,
        get page() {
          return primary.page;
        },
        reload: () => primary.reload(),
        upgrade(level) {
          for (const slot of visible) {
            slot.upgrade(level);
          }
        }
      };
    }
    let surface = null;
    const zoom = new ZoomController(ui.elReader, () => activeSurface().element, () => getSettings().fitHeight, ctx.signal, (level) => activeSurface().upgrade(level));
    const updateTitleWidth = () => {
      const viewportWidth = window.innerWidth;
      const maxWidth = getSettings().fitHeight ? Math.max(220, (viewportWidth - ui.elImg.clientWidth) / 2 - 30) : Math.min(760, viewportWidth * 0.62);
      ui.elTitle.style.maxWidth = `${maxWidth}px`;
    };
    function createMainSlot(data) {
      return createPageImageSlot(ui.elImg, {
        page: data,
        retry: (page) => loader.retryWithNl(page),
        maxRetries: getSettings().maxNlRetry,
        signal: ctx.signal,
        isCurrent: () => current === data && !readerLayout(getSettings().readerMode).continuous,
        onGiveUp: () => showError(),
        onLoaded: (loaded) => {
          hideError();
          if (ui.elImg.naturalWidth > 0) {
            continuousAspect = ui.elImg.naturalHeight / ui.elImg.naturalWidth;
          }
          log("image displayed", loaded.imgSrc);
        }
      });
    }
    function computeSurface() {
      const mode = getSettings().readerMode;
      if (mode === "continuous") {
        const pages = stack?.pages() ?? [];
        const entry = pages[continuousIndex] ?? pages[0];
        if (entry) {
          const slot = entry.view;
          return makeSurface(slot.img, slot, [slot]);
        }
      } else if (mode === "spread" && mainSlot !== null) {
        const spreadPrimary = mainSlot;
        const visible = [spreadPrimary];
        if (companionSlot !== null && !ui.elSpread.hidden) {
          visible.push(companionSlot);
        }
        return makeSurface(ui.elWrap, spreadPrimary, visible);
      }
      const primary = mainSlot ?? createMainSlot(current);
      return makeSurface(ui.elImg, primary, [primary]);
    }
    function refreshSurface() {
      surface = computeSurface();
    }
    function activeSurface() {
      surface ??= computeSurface();
      return surface;
    }
    function flushResume() {
      if (resumePage === null) {
        return;
      }
      saveResume(resumePage.galleryHref, {
        pageUrl: resumePage.viewerUrl,
        pageNum: resumePage.pageNum,
        counterText: resumePage.counterText
      });
    }
    function rememberPosition(data) {
      resumePage = data;
      if (resumeTimer !== undefined) {
        return;
      }
      resumeTimer = window.setTimeout(() => {
        resumeTimer = undefined;
        flushResume();
      }, 750);
    }
    const hideError = () => {
      ui.elError.hidden = true;
    };
    const showError = () => {
      ui.elErrorText.textContent = `Page ${current.counterText} could not be loaded.`;
      ui.elError.hidden = false;
    };
    const syncNav = (data) => {
      ui.elFirst.disabled = data.firstHref === null;
      ui.elPrev.disabled = data.prevHref === null;
      ui.elNext.disabled = data.nextHref === null;
      ui.elLast.disabled = data.lastHref === null;
    };
    const reloadImage = () => {
      if (!activeSurface().reload()) {
        return;
      }
      hideError();
      showToast("Reloading image");
    };
    const goEnd = (direction) => {
      const target = direction === "first" ? current.firstHref : current.lastHref;
      if (target) {
        ctx.navigate(target, { replace: true });
        return;
      }
      showToast(direction === "first" ? "First page" : "Last page");
    };
    const goSingle = (direction) => {
      const target = direction === "prev" ? current.prevHref : current.nextHref;
      if (target) {
        ctx.navigate(target, { replace: true });
        return;
      }
      showToast(direction === "prev" ? "First page" : "Last page");
    };
    async function goSpread(direction) {
      const token = ++navigationToken;
      if (direction === "next") {
        let trailing = spreadCompanion;
        if (!trailing && current.nextHref) {
          trailing = await loader.viewerPage(current.nextHref, {
            priority: priorityOf("facing"),
            signal: ctx.signal
          }).catch(() => null);
        }
        if (token !== navigationToken || ctx.signal.aborted) {
          return;
        }
        const target = trailing ? trailing.nextHref : current.nextHref;
        if (target) {
          ctx.navigate(target, { replace: true });
          return;
        }
        showToast("Last page");
        return;
      }
      const back = current.prevHref ? await loader.viewerPage(current.prevHref, {
        priority: priorityOf("facing"),
        signal: ctx.signal
      }).catch(() => null) : null;
      if (token !== navigationToken || ctx.signal.aborted) {
        return;
      }
      const target = back ? back.prevHref : current.prevHref;
      if (target) {
        ctx.navigate(target, { replace: true });
        return;
      }
      showToast("First page");
    }
    function syncContinuousNav() {
      if (!readerLayout(getSettings().readerMode).continuous) {
        return;
      }
      const pages = stack?.pages() ?? [];
      ui.elPrev.disabled = continuousIndex <= 0;
      const state = stack?.state();
      ui.elNext.disabled = (state === undefined || state.done) && continuousIndex >= pages.length - 1;
    }
    function scrollToContinuous(index) {
      const entry = stack?.pages()[index];
      if (!entry) {
        return;
      }
      entry.node.scrollIntoView({ block: "start" });
      continuousIndex = index;
      refreshSurface();
      ui.elCounter.textContent = entry.view.page.counterText;
      ui.elFileInfo.textContent = entry.view.page.fileInfo;
      syncContinuousNav();
      activeSurface().upgrade(zoom.getZoomLevel());
    }
    async function goContinuous(direction) {
      const active = stack;
      if (active === null) {
        return;
      }
      if (direction === "prev") {
        if (continuousIndex <= 0) {
          showToast("First page");
          return;
        }
        scrollToContinuous(continuousIndex - 1);
        return;
      }
      if (continuousIndex >= active.pages().length - 1) {
        const state = active.state();
        if (state.loading) {
          return;
        }
        if (!state.done) {
          const appended = state.failed ? await active.retry() : await active.loadNext();
          if (active !== stack || ctx.signal.aborted) {
            return;
          }
          if (!appended) {
            const after = active.state();
            if (after.failed) {
              showToast("Could not load the next page");
            } else if (after.done) {
              showToast("Last page");
            }
            syncContinuousNav();
            return;
          }
        }
      }
      if (continuousIndex >= active.pages().length - 1) {
        showToast("Last page");
        return;
      }
      scrollToContinuous(continuousIndex + 1);
    }
    const go = (direction) => {
      const mode = getSettings().readerMode;
      if (mode === "continuous") {
        goContinuous(direction);
        return;
      }
      if (mode === "spread") {
        goSpread(direction);
        return;
      }
      goSingle(direction);
    };
    function clearSpread() {
      spreadToken += 1;
      spreadCompanion = null;
      companionSlot = null;
      ui.elSpread.hidden = true;
      ui.elSpread.removeAttribute("src");
      setSpreadSingle(false);
      refreshSurface();
    }
    function renderSpread(data) {
      clearSpread();
      const token = spreadToken;
      setSpreadSingle(data.nextHref === null);
      if (!readerLayout(getSettings().readerMode).spread || data.nextHref === null) {
        return;
      }
      loader.viewerPage(data.nextHref, {
        priority: priorityOf("facing"),
        signal: ctx.signal
      }).then((companion) => {
        if (ctx.signal.aborted || token !== spreadToken || !readerLayout(getSettings().readerMode).spread) {
          return;
        }
        spreadCompanion = companion;
        ui.elSpread.hidden = false;
        setSpreadSingle(false);
        ui.elSpread.alt = `${companion.galleryTitle.primary} — page ${companion.counterText}`;
        companionSlot = createPageImageSlot(ui.elSpread, {
          page: companion,
          retry: (page) => loader.retryWithNl(page),
          maxRetries: getSettings().maxNlRetry,
          signal: ctx.signal,
          isCurrent: () => spreadCompanion === companion,
          onGiveUp: () => {
            ui.elSpread.hidden = true;
            setSpreadSingle(true);
            ui.elNext.disabled = data.nextHref === null;
            refreshSurface();
          }
        });
        companionSlot.show();
        ui.elNext.disabled = companion.nextHref === null;
        refreshSurface();
        activeSurface().upgrade(zoom.getZoomLevel());
      }).catch(() => {
        if (ctx.signal.aborted || token !== spreadToken) {
          return;
        }
        clearSpread();
        setSpreadSingle(true);
        ui.elNext.disabled = data.nextHref === null;
      });
    }
    function continuousPage(data) {
      const node = el("div", { class: "reader-page" });
      const img = el("img", {
        class: "reader-page-img",
        alt: `${data.galleryTitle.primary} — page ${data.counterText}`,
        loading: "lazy"
      });
      const retry = el("button", {
        class: "btn btn-small reader-page-retry",
        type: "button",
        text: "Retry",
        style: "position: absolute; z-index: 1;"
      });
      retry.hidden = true;
      node.append(img, retry);
      node.style.minHeight = `${Math.round(window.innerWidth * continuousAspect)}px`;
      const slot = createPageImageSlot(img, {
        page: data,
        retry: (page) => loader.retryWithNl(page),
        maxRetries: getSettings().maxNlRetry,
        signal: ctx.signal,
        onGiveUp: () => {
          node.classList.add("is-failed");
          retry.hidden = false;
        },
        onLoaded: () => {
          node.classList.remove("is-failed");
          retry.hidden = true;
          node.style.removeProperty("min-height");
          if (img.naturalWidth > 0) {
            continuousAspect = img.naturalHeight / img.naturalWidth;
          }
        }
      });
      retry.addEventListener("click", () => {
        retry.hidden = true;
        node.classList.remove("is-failed");
        slot.show();
      });
      slot.show();
      return { node, view: slot };
    }
    function teardownContinuous() {
      stack?.stop();
      stack = null;
      continuousIndex = 0;
      ui.elContinuous.replaceChildren();
    }
    function startContinuous(data) {
      teardownContinuous();
      stack = createContinuousStack({
        container: ui.elContinuous,
        initial: data,
        next: data.nextHref,
        key: (page) => page.viewerUrl,
        signal: ctx.signal,
        load: (url, signal) => loader.viewerPage(url, { priority: priorityOf("facing"), signal }).then((page) => ({
          items: [page],
          next: page.nextHref
        })),
        render: continuousPage,
        onChange: () => syncContinuousNav()
      });
      continuousIndex = 0;
      refreshSurface();
      syncContinuousNav();
    }
    function syncContinuousCounter() {
      const pages = stack?.pages() ?? [];
      if (!readerLayout(getSettings().readerMode).continuous || pages.length === 0) {
        return;
      }
      const midpoint = window.innerHeight / 2;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      pages.forEach((entry, index) => {
        const rect = entry.node.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - midpoint);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      const previous = continuousIndex;
      continuousIndex = best;
      if (best !== previous) {
        refreshSurface();
      }
      const visible = pages[best];
      if (visible) {
        ui.elCounter.textContent = visible.view.page.counterText;
        ui.elFileInfo.textContent = visible.view.page.fileInfo;
        rememberPosition(visible.view.page);
      }
      syncContinuousNav();
      if (best !== previous) {
        activeSurface().upgrade(zoom.getZoomLevel());
      }
    }
    let counterFrame;
    function onContinuousScroll() {
      if (!readerLayout(getSettings().readerMode).continuous || counterFrame !== undefined) {
        return;
      }
      counterFrame = window.requestAnimationFrame(() => {
        counterFrame = undefined;
        syncContinuousCounter();
      });
    }
    function showMain(data) {
      mainSlot = createMainSlot(data);
      mainSlot.show();
      refreshSurface();
    }
    function syncLayout() {
      const settings = getSettings();
      const layout = readerLayout(settings.readerMode);
      ui.elWrap.hidden = layout.continuous;
      ui.elContinuous.hidden = !layout.continuous;
      ui.elContinuous.style.setProperty("--reader-gap", `${settings.gap}px`);
      if (layout.continuous) {
        mainSlot = null;
        ui.elImg.removeAttribute("src");
        startContinuous(current);
        clearSpread();
        syncContinuousCounter();
        return;
      }
      teardownContinuous();
      if (layout.spread) {
        showMain(current);
        syncNav(current);
        renderSpread(current);
      } else {
        showMain(current);
        clearSpread();
        syncNav(current);
      }
    }
    function render(data) {
      current = data;
      ui.elTitle.replaceChildren(titleNodes(data.galleryTitle));
      ui.elCounter.textContent = data.counterText;
      ui.elFileInfo.textContent = data.fileInfo;
      ui.elGallery.href = data.galleryHref;
      ui.elOriginal.hidden = data.originalHref === null;
      ui.elOriginal.href = data.originalHref ?? "";
      ui.elForum.hidden = data.forumHref === null;
      ui.elForum.href = data.forumHref ?? "";
      ui.elSearch.hidden = data.searchHref === null;
      ui.elSearch.href = data.searchHref ?? "";
      ui.elImg.alt = `${data.galleryTitle.primary} — page ${data.counterText}`;
      syncNav(data);
      hideError();
      syncLayout();
      if (!getSettings().fitHeight && !readerLayout(getSettings().readerMode).continuous) {
        window.scrollTo(0, 0);
      }
      rememberPosition(data);
      log("rendered", data.counterText);
    }
    let cursorHidden = false;
    applyViewMode({
      viewer: true,
      fitHeight: getSettings().fitHeight,
      cursorHidden,
      readerMode: getSettings().readerMode,
      readingDirection: getSettings().readingDirection
    });
    render(pageData);
    window.addEventListener("scroll", onContinuousScroll, { passive: true, signal: ctx.signal });
    const off = onSettingsChange((settings) => {
      applyViewMode({
        viewer: true,
        fitHeight: settings.fitHeight,
        cursorHidden,
        readerMode: settings.readerMode,
        readingDirection: settings.readingDirection
      });
      ui.elContinuous.style.setProperty("--reader-gap", `${settings.gap}px`);
      updateTitleWidth();
      if (settings.readerMode !== activeMode) {
        activeMode = settings.readerMode;
        syncLayout();
      }
      zoom.updateZoom(null, settings.fitHeight);
    });
    ctx.signal.addEventListener("abort", off, { once: true });
    const resizeObserver = new ResizeObserver(updateTitleWidth);
    resizeObserver.observe(document.body);
    resizeObserver.observe(ui.elImg);
    ctx.signal.addEventListener("abort", () => resizeObserver.disconnect(), { once: true });
    let cursorTimer;
    const hideCursor = () => {
      if (chromePinned) {
        return;
      }
      cursorHidden = true;
      setCursorHidden(true);
    };
    const showCursor = () => {
      cursorHidden = false;
      setCursorHidden(false);
      clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(hideCursor, HIDE_CURSOR_AFTER);
    };
    window.addEventListener("mousemove", showCursor, { signal: ctx.signal });
    window.addEventListener("mousedown", showCursor, { signal: ctx.signal });
    ui.elReader.addEventListener("wheel", showCursor, { passive: true, signal: ctx.signal });
    showCursor();
    ui.elReader.addEventListener("pointerdown", showCursor, { signal: ctx.signal });
    const toggleChrome = () => {
      chromePinned = !chromePinned;
      document.body.classList.toggle("hud-pinned", chromePinned);
      if (chromePinned) {
        clearTimeout(cursorTimer);
        cursorHidden = false;
        setCursorHidden(false);
      } else {
        showCursor();
      }
    };
    ctx.signal.addEventListener("abort", () => document.body.classList.remove("hud-pinned"), {
      once: true
    });
    let suppressClick = false;
    let swipeStart = null;
    const activePointers = new Map;
    let pinchStart = null;
    let panPoint = null;
    ui.elReader.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") {
        return;
      }
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size === 2) {
        swipeStart = null;
        panPoint = null;
        suppressClick = true;
        const [first, second] = [...activePointers.values()];
        if (first !== undefined && second !== undefined && getSettings().fitHeight && getSettings().readerMode !== "continuous") {
          pinchStart = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            zoom: zoom.getZoomLevel()
          };
        }
        return;
      }
      suppressClick = false;
      if (zoom.getZoomLevel() > 1 && getSettings().fitHeight && getSettings().readerMode !== "continuous") {
        swipeStart = null;
        panPoint = { x: event.clientX, y: event.clientY };
      } else {
        swipeStart = { x: event.clientX, y: event.clientY };
      }
    }, { signal: ctx.signal });
    ui.elReader.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || !activePointers.has(event.pointerId)) {
        return;
      }
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchStart === null && panPoint !== null && activePointers.size === 1) {
        const dx = event.clientX - panPoint.x;
        const dy = event.clientY - panPoint.y;
        if (dx !== 0 || dy !== 0) {
          event.preventDefault();
          zoom.panBy(dx, dy);
          panPoint = { x: event.clientX, y: event.clientY };
          suppressClick = true;
        }
        return;
      }
      if (pinchStart === null || activePointers.size < 2) {
        return;
      }
      const [first, second] = [...activePointers.values()];
      if (first === undefined || second === undefined) {
        return;
      }
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (pinchStart.distance <= 0 || distance <= 0) {
        return;
      }
      event.preventDefault();
      zoom.setZoom(pinchStart.zoom * (distance / pinchStart.distance), getSettings().fitHeight);
      suppressClick = true;
    }, { passive: false, signal: ctx.signal });
    ui.elReader.addEventListener("pointerup", (event) => {
      const pinching = pinchStart !== null;
      const panning = panPoint !== null;
      if (event.pointerType !== "mouse") {
        activePointers.delete(event.pointerId);
        if (activePointers.size < 2) {
          pinchStart = null;
        }
        panPoint = null;
      }
      if (pinching || panning) {
        swipeStart = null;
        suppressClick = true;
        return;
      }
      if (swipeStart === null || event.pointerType === "mouse") {
        swipeStart = null;
        return;
      }
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) {
        return;
      }
      const intent = swipeIntent(dx, SWIPE_MIN, getSettings().readerMode, getSettings().readingDirection);
      if (intent === null) {
        return;
      }
      suppressClick = true;
      go(intent);
    }, { signal: ctx.signal });
    ui.elReader.addEventListener("pointercancel", (event) => {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) {
        pinchStart = null;
      }
      swipeStart = null;
      panPoint = null;
    }, { signal: ctx.signal });
    ui.elReader.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("#hud, #page-info, #page-nav, #hud-help, #img-error")) {
        return;
      }
      if (zoom.consumePanned() || suppressClick) {
        suppressClick = false;
        return;
      }
      const ratio = event.clientX / Math.max(1, window.innerWidth);
      const intent = clickIntent(ratio, getSettings().readerMode, getSettings().readingDirection);
      if (intent === "toggle") {
        toggleChrome();
      } else {
        go(intent);
      }
    }, { signal: ctx.signal });
    ui.elFirst.addEventListener("click", () => goEnd("first"), { signal: ctx.signal });
    ui.elPrev.addEventListener("click", () => go("prev"), { signal: ctx.signal });
    ui.elNext.addEventListener("click", () => go("next"), { signal: ctx.signal });
    ui.elLast.addEventListener("click", () => goEnd("last"), { signal: ctx.signal });
    ui.elForum.addEventListener("click", (event) => {
      if (ui.elForum.href === "" || !("clipboard" in navigator)) {
        return;
      }
      event.preventDefault();
      navigator.clipboard.writeText(ui.elForum.href).then(() => showToast("Forum link copied"), () => showToast("Could not copy the forum link"));
    }, { signal: ctx.signal });
    const returnToGallery = () => {
      const state = history.state;
      if (state?.fromGallery === true) {
        history.back();
        return;
      }
      ctx.navigate(ui.elGallery.href);
    };
    ui.elGallery.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      returnToGallery();
    }, { signal: ctx.signal });
    ui.elErrorRetry.addEventListener("click", () => {
      (async () => {
        hideError();
        const retried = await loader.retryWithNl(current);
        if (ctx.signal.aborted) {
          return;
        }
        if (retried) {
          render(retried);
        } else {
          showError();
        }
      })();
    }, { signal: ctx.signal });
    document.addEventListener("keydown", (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toUpperCase();
        if (key === "=" || key === "+") {
          event.preventDefault();
          zoom.updateZoom(0.1, getSettings().fitHeight);
          return;
        }
        if (key === "-" || key === "_") {
          event.preventDefault();
          zoom.updateZoom(-0.1, getSettings().fitHeight);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          zoom.updateZoom(null, getSettings().fitHeight);
          return;
        }
      }
      const scrollKey = isKey(event, "up") || isKey(event, "down") || event.key === " ";
      if (event.repeat && !scrollKey) {
        return;
      }
      showCursor();
      if (zoom.handleKey(event, getSettings().fitHeight)) {
        return;
      }
      if (isKey(event, "fit")) {
        updateSetting("fitHeight", !getSettings().fitHeight);
      } else if (event.key === "?") {
        setHelp(ui.elHelp.hasAttribute("hidden"));
      } else if (isKey(event, "gallery") || event.key === "Escape") {
        if (!ui.elHelp.hasAttribute("hidden")) {
          setHelp(false);
          return;
        }
        returnToGallery();
      } else if (event.key === " ") {
        event.preventDefault();
        const step = Math.round(window.innerHeight * 0.75);
        if (event.shiftKey) {
          if (window.scrollY <= 0) {
            go("prev");
          } else {
            window.scrollBy(0, -step);
          }
        } else if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
          go("next");
        } else {
          window.scrollBy(0, step);
        }
      } else if (event.key === "r" || event.key === "R") {
        reloadImage();
      } else if (isKey(event, "up")) {
        if (!getSettings().fitHeight || getSettings().readerMode === "continuous") {
          event.preventDefault();
          window.scrollBy(0, -getSettings().scrollStep);
        }
      } else if (isKey(event, "down")) {
        if (!getSettings().fitHeight || getSettings().readerMode === "continuous") {
          event.preventDefault();
          window.scrollBy(0, getSettings().scrollStep);
        }
      } else if (isKey(event, "next")) {
        event.preventDefault();
        go("next");
      } else if (isKey(event, "prev")) {
        event.preventDefault();
        go("prev");
      }
    }, { signal: ctx.signal });
    ctx.signal.addEventListener("abort", () => {
      clearTimeout(cursorTimer);
      if (resumeTimer !== undefined) {
        window.clearTimeout(resumeTimer);
        resumeTimer = undefined;
      }
      flushResume();
      prefetcher.cancel();
      resizeObserver.disconnect();
      teardownContinuous();
      if (counterFrame !== undefined) {
        window.cancelAnimationFrame(counterFrame);
      }
      ui.elImg.removeAttribute("src");
      ui.elSpread.removeAttribute("src");
    }, { once: true });
    prefetcher.warm(pageData);
  }

  // src/routes/index.ts
  function documentView(deps, spec) {
    const fetchDocument = (url, signal, priority, options) => deps.document(url, {
      signal,
      priority,
      tag: spec.tag,
      ...options?.fresh === true ? { fresh: true } : {}
    });
    const page = spec.page;
    const pageSource = page === undefined ? undefined : async (url, signal) => {
      const { doc, url: finalUrl } = await fetchDocument(url, signal, priorityOf("append"));
      return page(doc, finalUrl);
    };
    return {
      load: async (route, signal, options) => {
        const { doc, url } = await fetchDocument(route.url, signal, priorityOf("navigation"), options);
        return spec.parse(doc, url, route);
      },
      parse: (doc, route) => spec.parse(doc, route.url, route),
      render: (host, data, ctx) => spec.render(host, data, ctx, pageSource),
      title: (data) => spec.title(data),
      pageSource
    };
  }
  function createRouteViews(deps) {
    const table = {
      viewer: {
        match: (url) => VIEWER_PATH.test(url.pathname) ? { kind: "viewer", url: url.href } : null,
        load: (route, signal) => deps.viewerPage(route.url, { signal, priority: priorityOf("navigation") }),
        parse: (doc, route) => {
          const data = parseViewer(doc, route.url);
          deps.seedViewerPage(data.viewerUrl, data);
          return data;
        },
        render: mountViewer,
        title: (data) => documentTitle(data.galleryTitle.primary, data.counterText)
      },
      gallery: {
        match: (url) => GALLERY_PATH.test(url.pathname) ? { kind: "gallery", url: url.href } : null,
        ...documentView(deps, {
          tag: "gallery",
          parse: parseGalleryPage,
          page: (doc, url) => {
            const page = parseGalleryPage(doc, url);
            return { items: page.thumbs, next: page.nextHref };
          },
          render: (host, data, ctx, pageSource) => renderGallery(host, data, ctx, { pageSource }),
          title: (data) => documentTitle(data.title.primary)
        })
      },
      list: {
        match: (url) => {
          if (UPLOADER_PATH.test(url.pathname)) {
            const text = uploaderTokenFromHref(url.href, url.href);
            if (text !== null) {
              return {
                kind: "list",
                url: url.href,
                query: { ...parseSearchQuery(url), text },
                scope: "uploader"
              };
            }
          }
          const categoryBit = categoryPathBit(url.pathname);
          if (categoryBit !== null || url.pathname.startsWith("/tag/")) {
            const query = parseSearchQuery(url);
            if (categoryBit !== null && categoryBit !== 0) {
              query.cats = ALL_CATEGORY_BITS & ~categoryBit;
            }
            return { kind: "list", url: url.href, query, scope: "search" };
          }
          const scope = SCOPE_PATHS[url.pathname];
          if (scope !== undefined) {
            return { kind: "list", url: url.href, query: parseSearchQuery(url), scope };
          }
          return null;
        },
        ...documentView(deps, {
          tag: "list",
          parse: (doc, url, route) => ({
            page: parseListPage(doc, url),
            query: route.query,
            scope: route.scope
          }),
          page: (doc, url) => {
            const page = parseListPage(doc, url);
            return { items: page.items, next: page.nextHref };
          },
          render: (host, data, ctx, pageSource) => renderList(host, data.page, data.query, ctx, data.scope, { pageSource }),
          title: (data) => {
            const pathTag = tagTokenFromHref(new URL(data.page.url).pathname, data.page.url);
            return documentTitle(listLabels(data.query, data.scope, pathTag).title);
          }
        })
      },
      torrents: {
        match: (url) => url.pathname === "/torrents.php" ? { kind: "torrents", url: url.href } : null,
        ...documentView(deps, {
          tag: "torrents",
          parse: parseTorrents2,
          render: renderTorrents,
          title: () => documentTitle("Torrents")
        })
      },
      favorites: {
        match: (url) => url.pathname === "/favorites.php" ? { kind: "favorites", url: url.href } : null,
        ...documentView(deps, {
          tag: "favorites",
          parse: parseFavorites,
          render: (host, data, ctx) => renderFavorites(host, data, ctx),
          title: (data) => documentTitle(...favoritesLabels(data).title)
        })
      },
      toplist: {
        match: (url) => url.pathname === "/toplist.php" ? { kind: "toplist", url: url.href } : null,
        ...documentView(deps, {
          tag: "toplist",
          parse: parseToplist,
          render: renderToplist,
          title: (data) => data.kind === "category" ? documentTitle(data.title) : documentTitle("Toplists")
        })
      },
      settings: {
        match: (url) => url.pathname === "/uconfig.php" ? { kind: "settings", url: url.href } : null,
        ...documentView(deps, {
          tag: "settings",
          parse: parseUconfig,
          render: (host, data, ctx) => renderSettings(host, data, ctx),
          title: () => documentTitle("Settings")
        })
      }
    };
    function routeView(route) {
      if (route.kind === "native" || !Object.hasOwn(table, route.kind)) {
        throw new Error(`Cannot render a ${route.kind} route`);
      }
      return table[route.kind];
    }
    function match(url) {
      const entries = Object.values(table);
      for (const entry of entries) {
        const route = entry.match(url);
        if (route !== null) {
          return route;
        }
      }
      return null;
    }
    return { routeView, match };
  }
  var productionViews = createRouteViews(loader);
  var routeView = (route) => productionViews.routeView(route);
  var matchOwnedRoute = (url) => productionViews.match(url);

  // src/router.ts
  function parseRoute(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return { kind: "native", url: href };
    }
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) {
      return { kind: "native", url: url.href };
    }
    if (url.searchParams.has("eh_native")) {
      return { kind: "native", url: url.href };
    }
    return matchOwnedRoute(url) ?? { kind: "native", url: url.href };
  }
  function startLinkInterception(navigate) {
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) {
        return;
      }
      if (anchor.dataset.native !== undefined || anchor.hasAttribute("download")) {
        return;
      }
      if (anchor.target && anchor.target !== "_self") {
        return;
      }
      const rawHref = anchor.getAttribute("href") ?? "";
      if (rawHref.startsWith("#")) {
        return;
      }
      const href = anchor.href;
      if (!href.startsWith("http")) {
        return;
      }
      const route = parseRoute(href);
      if (route.kind === "native") {
        return;
      }
      event.preventDefault();
      navigate(href);
    };
    document.addEventListener("click", onClick);
  }

  // src/site-ads.ts
  var SITE_AD_SELECTOR = 'script[src*="juicyads.com"], iframe[src*="juicyads.com"]';
  function stripSiteAds(root) {
    for (const node of root.querySelectorAll(SITE_AD_SELECTOR)) {
      node.remove();
    }
  }
  function blockSiteAds(doc = document, options = {}) {
    stripSiteAds(doc);
    const Observer = options.Observer ?? doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof Observer !== "function") {
      return () => {
        return;
      };
    }
    const strip = (node) => {
      if (node.nodeType !== 1) {
        return;
      }
      const element = node;
      if (element.matches(SITE_AD_SELECTOR)) {
        element.remove();
        return;
      }
      stripSiteAds(element);
    };
    const observer = new Observer((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target.nodeType === 1 && target.matches(SITE_AD_SELECTOR)) {
            target.remove();
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          strip(node);
        }
      }
    });
    observer.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
    return () => observer.disconnect();
  }

  // src/ui/banner.ts
  var messages = [];
  var host = null;
  function ensureHost() {
    if (host?.isConnected) {
      return host;
    }
    const existing = document.getElementById("eh-banner-host");
    if (existing) {
      host = existing;
      if (!existing.hasAttribute("aria-live")) {
        existing.setAttribute("role", "status");
        existing.setAttribute("aria-live", "polite");
        existing.setAttribute("aria-atomic", "false");
      }
      return existing;
    }
    host = el("div", {
      id: "eh-banner-host",
      class: "eh-banner-host",
      role: "status",
      "aria-live": "polite"
    });
    const root = document.getElementById("eh-root") ?? document.body;
    root.prepend(host);
    return host;
  }
  function build(message) {
    const banner = el("div", { class: "eh-banner" });
    appendChildren(banner, [
      icon("warning"),
      el("span", { class: "eh-banner-text", text: message.text }),
      message.count > 1 ? el("span", { class: "eh-banner-count", text: `×${message.count}` }) : null,
      el("button", {
        class: "eh-banner-close",
        type: "button",
        "aria-label": "Dismiss",
        onclick: () => {
          dismiss(message, banner);
        }
      }, icon("close"))
    ]);
    return banner;
  }
  function dismiss(message, banner) {
    const index = messages.indexOf(message);
    if (index >= 0) {
      messages.splice(index, 1);
    }
    const next = messages[0]?.node;
    banner.remove();
    message.node = null;
    if (next) {
      next.querySelector(".eh-banner-close")?.focus();
      return;
    }
    if (host) {
      host.hidden = true;
    }
  }
  function showBanner(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const container = ensureHost();
    container.hidden = false;
    const existing = messages.find((message) => message.text === trimmed);
    if (existing) {
      existing.count = Math.min(existing.count + 1, 99);
      if (existing.node) {
        const count = existing.node.querySelector(".eh-banner-count");
        if (count) {
          count.textContent = `×${existing.count}`;
        } else {
          existing.node.insertBefore(el("span", { class: "eh-banner-count", text: `×${existing.count}` }), existing.node.querySelector(".eh-banner-close"));
        }
      }
      return;
    }
    const message = { text: trimmed, count: 1, node: null };
    const banner = build(message);
    message.node = banner;
    messages.push(message);
    container.append(banner);
  }

  // src/ui/scroll-restore.ts
  var SCROLL_RESTORE_TIMEOUT_MS = 8000;
  var SCROLL_RESTORE_STALL_MS = 3000;
  function restoreScrollWhenReady(target, {
    scrollTo = (y) => {
      window.scrollTo(0, y);
    },
    scrollY = () => window.scrollY,
    scrollHeight = () => document.documentElement.scrollHeight,
    now = () => performance.now(),
    frame = (callback) => window.requestAnimationFrame(callback),
    cancelFrame = (handle) => window.cancelAnimationFrame(handle),
    timeoutMs = SCROLL_RESTORE_TIMEOUT_MS
  } = {}) {
    if (target <= 0) {
      scrollTo(0);
      return () => {
        return;
      };
    }
    const deadline = now() + timeoutMs;
    let pending = null;
    let stopped = false;
    let lastHeight = scrollHeight();
    let lastGrowth = now();
    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (pending !== null) {
        cancelFrame(pending);
        pending = null;
      }
    };
    const tick = () => {
      pending = null;
      if (stopped) {
        return;
      }
      scrollTo(target);
      const at = now();
      const height = scrollHeight();
      if (height !== lastHeight) {
        lastHeight = height;
        lastGrowth = at;
      }
      const reached = Math.abs(scrollY() - target) <= 2;
      const stalled = at - lastGrowth >= SCROLL_RESTORE_STALL_MS;
      if (reached || stalled || at >= deadline) {
        stopped = true;
        return;
      }
      pending = frame(tick);
    };
    pending = frame(tick);
    return stop;
  }

  // src/ui/sticky.ts
  var READING_GAP = 12;
  function trackStickyChrome(root) {
    let frame = 0;
    const apply = () => {
      frame = 0;
      const style = document.documentElement.style;
      const header = root.querySelector(".topbar");
      const pinned = [
        ...root.querySelectorAll(".topbar, .settings-jump, .toplist-tabs")
      ];
      let stack = 0;
      for (const node of pinned) {
        stack += Math.round(node.getBoundingClientRect().height);
      }
      style.setProperty("--topbar-h", `${header === null ? 0 : Math.round(header.getBoundingClientRect().height)}px`);
      style.setProperty("--sticky-reading-line", `${stack + READING_GAP}px`);
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(apply);
      }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    for (const node of root.querySelectorAll(".topbar, .settings-jump, .toplist-tabs")) {
      observer.observe(node);
    }
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      const style = document.documentElement.style;
      style.removeProperty("--topbar-h");
      style.removeProperty("--sticky-reading-line");
    };
  }

  // .cache/app.css
  var app_default = `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
    --spacing: 0.25rem;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-weight-extrabold: 800;
    --tracking-wide: 0.025em;
    --leading-relaxed: 1.625;
    --blur-sm: 8px;
    --default-transition-duration: 150ms;
    --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    --default-font-family: var(--font-sans);
    --default-mono-font-family: var(--font-mono);
    --color-void: #000;
    --color-canvas: #34353b;
    --color-surface: #3a3c42;
    --color-panel: #40444c;
    --color-panel-hover: #4a4f58;
    --color-line: #4c5058;
    --color-line-strong: #5f646e;
    --color-field-line: #8a909b;
    --color-fg: #f1f1f1;
    --color-muted: #c0c4cc;
    --color-accent: #a8323a;
    --color-accent-hover: #c04149;
    --color-accent-text: #f0a0a6;
    --color-star: #e8c46a;
    --color-torrent: #8fbf6a;
    --color-link: #e0b3a6;
    --color-parchment: #e3e0d1;
    --color-parchment-hover: #f0eddc;
    --color-burgundy: #5c0d11;
    --color-danger: #ff6b6b;
    --color-danger-text: #ffb3b3;
    --color-danger-surface: #3a1d1d;
    --color-danger-line: #7a2a2a;
    --text-micro: 11px;
    --text-meta: 12px;
    --text-control: 13px;
    --text-body: 14px;
    --text-section: 15px;
    --text-title-2: 18px;
    --text-heading: 20px;
    --text-display: 25px;
    --radius-card: 0px;
    --radius-control: 0px;
    --radius-row: 0px;
    --radius-inline: 0px;
    --radius-chip: 0px;
    --control-h: 32px;
    --shadow-float: 0 18px 50px rgb(0 0 0 / 0.55);
    --ns-artist: #8fb4dd;
    --ns-group: #bfa9ea;
    --ns-parody: #8cc79b;
    --ns-character: #e0b078;
    --ns-female: #e99cbe;
    --ns-male: #8fc3d0;
    --ns-language: #adb3bf;
    --ns-cosplayer: #92cfae;
    --ns-mixed: #c6a9e8;
    --ns-other: #d6c27c;
    --ns-location: #82c8ce;
    --ns-reclass: #b2b5be;
  }
}
@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 0 solid;
  }
  html, :host {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    font-family: var(--default-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji');
    font-feature-settings: var(--default-font-feature-settings, normal);
    font-variation-settings: var(--default-font-variation-settings, normal);
    -webkit-tap-highlight-color: transparent;
  }
  hr {
    height: 0;
    color: inherit;
    border-top-width: 1px;
  }
  abbr:where([title]) {
    -webkit-text-decoration: underline dotted;
    text-decoration: underline dotted;
  }
  h1, h2, h3, h4, h5, h6 {
    font-size: inherit;
    font-weight: inherit;
  }
  a {
    color: inherit;
    -webkit-text-decoration: inherit;
    text-decoration: inherit;
  }
  b, strong {
    font-weight: bolder;
  }
  code, kbd, samp, pre {
    font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
    font-feature-settings: var(--default-mono-font-feature-settings, normal);
    font-variation-settings: var(--default-mono-font-variation-settings, normal);
    font-size: 1em;
  }
  small {
    font-size: 80%;
  }
  sub, sup {
    font-size: 75%;
    line-height: 0;
    position: relative;
    vertical-align: baseline;
  }
  sub {
    bottom: -0.25em;
  }
  sup {
    top: -0.5em;
  }
  table {
    text-indent: 0;
    border-color: inherit;
    border-collapse: collapse;
  }
  :-moz-focusring:where(:not(iframe)) {
    outline: auto;
  }
  progress {
    vertical-align: baseline;
  }
  summary {
    display: list-item;
  }
  ol, ul, menu {
    list-style: none;
  }
  img, svg, video, canvas, audio, iframe, embed, object {
    display: block;
    vertical-align: middle;
  }
  img, video {
    max-width: 100%;
    height: auto;
  }
  button, input, select, optgroup, textarea, ::file-selector-button {
    font: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    letter-spacing: inherit;
    color: inherit;
    border-radius: 0;
    background-color: transparent;
    opacity: 1;
  }
  :where(select:is([multiple], [size])) optgroup {
    font-weight: bolder;
  }
  :where(select:is([multiple], [size])) optgroup option {
    padding-inline-start: 20px;
  }
  ::file-selector-button {
    margin-inline-end: 4px;
  }
  ::placeholder {
    opacity: 1;
  }
  @supports (not (-webkit-appearance: -apple-pay-button))  or (contain-intrinsic-size: 1px) {
    ::placeholder {
      color: currentcolor;
      @supports (color: color-mix(in lab, red, red)) {
        color: color-mix(in oklab, currentcolor 50%, transparent);
      }
    }
  }
  textarea {
    resize: vertical;
  }
  ::-webkit-search-decoration {
    -webkit-appearance: none;
  }
  ::-webkit-date-and-time-value {
    min-height: 1lh;
    text-align: inherit;
  }
  ::-webkit-datetime-edit {
    display: inline-flex;
  }
  ::-webkit-datetime-edit-fields-wrapper {
    padding: 0;
  }
  ::-webkit-datetime-edit, ::-webkit-datetime-edit-year-field, ::-webkit-datetime-edit-month-field, ::-webkit-datetime-edit-day-field, ::-webkit-datetime-edit-hour-field, ::-webkit-datetime-edit-minute-field, ::-webkit-datetime-edit-second-field, ::-webkit-datetime-edit-millisecond-field, ::-webkit-datetime-edit-meridiem-field {
    padding-block: 0;
  }
  ::-webkit-calendar-picker-indicator {
    line-height: 1;
  }
  :-moz-ui-invalid {
    box-shadow: none;
  }
  button, input:where([type='button'], [type='reset'], [type='submit']), ::file-selector-button {
    appearance: button;
  }
  ::-webkit-inner-spin-button, ::-webkit-outer-spin-button {
    height: auto;
  }
  [hidden]:where(:not([hidden='until-found'])) {
    display: none !important;
  }
}
@layer utilities {
  .collapse {
    visibility: collapse;
  }
  .visible {
    visibility: visible;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border-width: 0;
  }
  .absolute {
    position: absolute;
  }
  .fixed {
    position: fixed;
  }
  .relative {
    position: relative;
  }
  .static {
    position: static;
  }
  .sticky {
    position: sticky;
  }
  .container {
    width: 100%;
    @media (width >= 40rem) {
      max-width: 40rem;
    }
    @media (width >= 48rem) {
      max-width: 48rem;
    }
    @media (width >= 64rem) {
      max-width: 64rem;
    }
    @media (width >= 80rem) {
      max-width: 80rem;
    }
    @media (width >= 96rem) {
      max-width: 96rem;
    }
  }
  .\\!table {
    display: table !important;
  }
  .block {
    display: block;
  }
  .contents {
    display: contents;
  }
  .flex {
    display: flex;
  }
  .grid {
    display: grid;
  }
  .hidden {
    display: none;
  }
  .inline {
    display: inline;
  }
  .table {
    display: table;
  }
  .table-cell {
    display: table-cell;
  }
  .grow {
    flex-grow: 1;
  }
  .transform {
    transform: var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,);
  }
  .resize {
    resize: both;
  }
  .justify-between {
    justify-content: space-between;
  }
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rounded {
    border-radius: 0.25rem;
  }
  .text-control {
    font-size: var(--text-control);
  }
  .uppercase {
    text-transform: uppercase;
  }
  .outline {
    outline-style: var(--tw-outline-style);
    outline-width: 1px;
  }
  .blur {
    --tw-blur: blur(8px);
    filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,);
  }
  .filter {
    filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,);
  }
  .transition {
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .select-all {
    -webkit-user-select: all;
    user-select: all;
  }
}
@layer components {
  html, body {
    height: 100%;
  }
  html {
    background: var(--color-canvas);
    color-scheme: dark;
  }
  body.eh-body {
    min-height: 100vh;
    overflow-x: hidden;
    background: var(--color-canvas);
    color: var(--color-fg);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    line-height: 1.5;
    text-align: left;
    -webkit-font-smoothing: antialiased;
  }
  #eh-root {
    min-height: 100vh;
  }
  #eh-view[aria-busy="true"] {
    pointer-events: none;
  }
  #eh-view {
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 28px 56px;
  }
  body.eh-viewer #eh-view {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  body.eh-viewer {
    background: var(--color-void);
  }
  a {
    color: inherit;
  }
  ::selection {
    background: var(--color-burgundy);
    color: var(--color-fg);
  }
  :focus-visible {
    outline: 2px solid var(--color-link);
    outline-offset: 2px;
  }
  .eh-popover {
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-line-strong);
    border-radius: var(--radius-card);
    background: var(--color-panel);
    color: var(--color-fg);
    box-shadow: var(--shadow-float);
    outline: none;
  }
  .icon-btn, .btn, .fav-btn, .pager-btn, .pager-num, .comment-vote, .gallery-resume-clear, .search-history-remove, .settings-key-capture {
    display: inline-flex;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    gap: calc(var(--spacing) * 1.5);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-fg);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
  }
  .icon-btn:hover, .btn:hover, .pager-btn:hover, .pager-num:hover, .settings-key-capture:hover, .settings-key-capture:focus-visible {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .topbar-clear, .topbar-history, .expression-remove, .card-preview-trigger {
    display: inline-grid;
    cursor: pointer;
    place-items: center;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
    color: var(--color-muted);
    transition: color 0.15s, background-color 0.15s;
  }
  .topbar-clear:hover, .topbar-history:hover, .expression-remove:hover, .card-preview-trigger:hover {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .topbar-tab:focus-visible, .term-toggle:focus-visible {
    outline-offset: -2px;
  }
  .cat-chip, .quick-tag, .quick-tag-edit {
    display: inline-flex;
    height: 26px;
    cursor: pointer;
    align-items: center;
    border-radius: var(--radius-chip);
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .rail-link, .fav-item, .favorites-move-item, .favorites-order-link, .topbar-more-link, .toplist-tab, .topbar-tab, .action-menu-item, .tag-menu-item {
    display: flex;
    height: calc(var(--spacing) * 7);
    cursor: pointer;
    align-items: center;
    gap: var(--spacing);
    border-radius: var(--radius-row);
    padding-inline: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .rail-link:hover, .fav-item:hover, .favorites-move-item:hover, .favorites-order-link:hover, .topbar-more-link:hover, .toplist-tab:hover, .topbar-tab:hover, .action-menu-item:hover, .action-menu-item:focus-visible, .tag-menu-item:hover, .tag-menu-item:focus-visible {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .gallery-resume-clear:hover, .gallery-resume-clear:focus-visible, .settings-key-capture.capturing {
    background-color: var(--color-panel);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }
  .topbar-search-submit, .tag-combobox-exclude[aria-pressed="true"], .filters-count, .pager-num.is-current {
    border-color: var(--color-accent);
    background-color: var(--color-accent);
    color: var(--color-parchment);
  }
  .meta-link, .fav-link, .comment-author, .torrent-link {
    color: var(--color-link);
    text-decoration-line: none;
  }
  .meta-link:hover, .fav-link:hover, .comment-author:hover, .torrent-link:hover {
    text-decoration-line: underline;
  }
  .search-history-clear, .comment-edit {
    cursor: pointer;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-underline-offset: 2px;
  }
  .search-history-clear:hover, .search-history-clear:focus-visible, .comment-edit:hover, .comment-edit:focus-visible {
    color: var(--color-fg);
    text-decoration-line: underline;
  }
  .draft-note, .tag-menu-error, .torrent-filter-note {
    margin: 0px;
    border-radius: var(--radius-row);
    border-style: var(--tw-border-style);
    border-width: 1px;
    padding-inline: calc(var(--spacing) * 2.5);
    padding-block: calc(var(--spacing) * 1.5);
    font-size: var(--text-meta);
  }
  .draft-note {
    border-color: var(--color-line);
    background-color: var(--color-surface);
    color: var(--color-muted);
  }
  .tag-menu-error {
    border-color: var(--color-danger-line);
    background-color: var(--color-panel);
    color: var(--color-danger-text);
  }
  .torrent-filter-note {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-color: var(--color-accent);
    color: var(--color-accent-text);
  }
  .eyebrow, .rail-label, .fav-head, .search-history-heading, .toplist-tab-group-title, .favorites-move-head {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    font-size: var(--text-micro);
    letter-spacing: 0.06em;
    color: var(--color-muted);
  }
  .topbar-tab.is-active, .favorites-tab.is-active, .toplist-tab.is-active, .topbar-more.is-active {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  .tag-option.is-active {
    box-shadow: inset 2px 0 0 var(--color-accent);
  }
  .settings-jump, .toplist-jump, .topbar-tabs, .favorites-tabs {
    position: relative;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .settings-jump::-webkit-scrollbar, .toplist-jump::-webkit-scrollbar, .topbar-tabs::-webkit-scrollbar, .favorites-tabs::-webkit-scrollbar {
    display: none;
  }
  .settings-jump, .toplist-jump, .topbar-tabs {
    mask-image: var(--scroll-fade);
  }
  .topbar-tabs[data-scrolled] {
    mask-image: var(--scroll-fade-both);
  }
  .topbar-tabs[data-scrolled][data-at-end] {
    mask-image: var(--scroll-fade-left);
  }
  .settings-jump[data-scrolled], .toplist-jump[data-scrolled] {
    mask-image: var(--scroll-fade-both);
  }
  .settings-jump[data-scrolled][data-at-end], .toplist-jump[data-scrolled][data-at-end] {
    mask-image: var(--scroll-fade-left);
  }
  .tag-add .field-input, .tag-add .btn, .tag-menu-new .field-input, .tag-menu-new .btn, .torrent-search .field-input, .torrent-search .btn {
    height: var(--control-h);
  }
  input[type="checkbox"], input[type="radio"] {
    accent-color: var(--color-accent);
  }
  .status-line {
    margin: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .status-line.is-error {
    color: var(--color-danger-text);
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin: 0 -28px;
    padding: 14px 28px 10px;
    background: linear-gradient(var(--color-canvas) 82%, transparent);
    backdrop-filter: blur(10px);
  }
  .topbar-main {
    display: flex;
    width: 100%;
    align-items: center;
    gap: calc(var(--spacing) * 3);
  }
  .topbar-slim {
    padding-top: calc(var(--spacing) * 3);
    padding-bottom: calc(var(--spacing) * 2.5);
  }
  .topbar-filters {
    width: 100%;
  }
  .icon-btn {
    width: calc(var(--spacing) * 8);
    height: calc(var(--spacing) * 8);
    flex-shrink: 0;
    color: var(--color-muted);
  }
  .brand {
    display: inline-flex;
    height: calc(var(--spacing) * 8);
    flex-shrink: 0;
    align-items: center;
    border-radius: var(--radius-control);
    background-color: var(--color-parchment);
    padding-inline: calc(var(--spacing) * 3);
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-extrabold);
    font-weight: var(--font-weight-extrabold);
    --tw-tracking: 0.08em;
    letter-spacing: 0.08em;
    color: var(--color-burgundy);
    text-decoration-line: none;
  }
  .topbar-search {
    display: flex;
    height: calc(var(--spacing) * 8);
    max-width: 760px;
    min-width: 0px;
    flex: 1;
    align-items: center;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding-left: calc(var(--spacing) * 2.5);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .topbar-search:focus-within {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, #a8323a 55%, transparent);
    @supports (color: color-mix(in lab, red, red)) {
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
    }
  }
  .topbar-search-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--color-muted);
  }
  .topbar-search input {
    height: 100%;
    min-width: 0px;
    flex: 1;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 2.5);
    font-size: var(--text-body);
    color: var(--color-fg);
    --tw-outline-style: none;
    outline-style: none;
  }
  .topbar-search input::placeholder {
    color: var(--color-muted);
  }
  .topbar-search input::-webkit-search-cancel-button, .topbar-search input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
    display: none;
  }
  .kbd, .settings-key {
    display: inline-flex;
    min-height: 18px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-row);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-canvas);
    padding-inline: 5px;
    font-size: var(--text-micro);
    color: var(--color-muted);
    font-family: inherit;
  }
  .topbar-kbd {
    margin-right: var(--spacing);
  }
  .topbar-search-submit {
    margin-right: var(--spacing);
    height: calc(var(--spacing) * 6);
    cursor: pointer;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 0px;
    padding-inline: calc(var(--spacing) * 2.5);
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .topbar-search-submit-icon {
    display: none;
  }
  .topbar-clear {
    margin-right: var(--spacing);
    width: calc(var(--spacing) * 6);
    height: calc(var(--spacing) * 6);
    flex-shrink: 0;
  }
  .topbar-search-submit:hover {
    background-color: var(--color-accent-hover);
    color: var(--color-fg);
  }
  .list-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
    padding-top: calc(var(--spacing) * 4);
    padding-bottom: calc(var(--spacing) * 2);
  }
  .list-heading h1 {
    margin: 0px;
    font-size: var(--text-heading);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    --tw-tracking: -0.01em;
    letter-spacing: -0.01em;
  }
  .list-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .badge {
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .search-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .term-chip {
    display: inline-flex;
    min-width: 0px;
    align-items: stretch;
    overflow: hidden;
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
  }
  .term-chip.is-excluded {
    border-color: color-mix(in srgb, #a8323a 70%, #5f646e);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--color-accent) 70%, var(--color-line-strong));
    }
  }
  .term-chip.is-or {
    border-style: dashed;
  }
  .term-toggle {
    display: inline-flex;
    min-width: 0px;
    cursor: pointer;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 2);
    padding-block: 3px;
    color: var(--color-muted);
    font: inherit;
  }
  .term-toggle:hover {
    color: var(--color-fg);
  }
  .term-sign {
    width: calc(var(--spacing) * 3);
    flex-shrink: 0;
    text-align: center;
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
    color: var(--color-muted);
  }
  .term-chip.is-excluded .term-sign {
    color: var(--color-danger-text);
  }
  .term-ns {
    flex-shrink: 0;
    font-size: var(--text-micro);
    --tw-tracking: 0.05em;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ns-color, var(--color-muted));
  }
  .term-value {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-control);
    color: var(--color-fg);
  }
  .term-chip.is-excluded .term-value {
    text-decoration-line: line-through;
    opacity: 75%;
  }
  .search-filters-clear {
    margin-left: calc(var(--spacing) * 0.5);
    display: inline-flex;
    min-height: calc(var(--spacing) * 6);
    cursor: pointer;
    align-items: center;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 1.5);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .search-filters-clear:hover {
    color: var(--color-fg);
  }
  .tag-combobox {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tag-combobox-list {
    min-height: 0px;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--spacing);
    scrollbar-width: thin;
    scroll-padding: 4px;
  }
  .tag-option {
    display: flex;
    min-height: calc(var(--spacing) * 8);
    cursor: pointer;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-control);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 1.5);
  }
  .tag-option:hover, .tag-option.is-active {
    background-color: var(--color-panel-hover);
  }
  .tag-option-sign {
    width: calc(var(--spacing) * 3);
    flex-shrink: 0;
    text-align: center;
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
    color: var(--color-danger-text);
  }
  .tag-option-badge {
    flex-shrink: 0;
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    padding-inline: var(--spacing);
    padding-block: 1px;
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ns-color, var(--color-muted));
    border-color: var(--ns-color, #c0c4cc);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--ns-color, var(--color-muted)) 45%, transparent);
    }
    background: var(--ns-color, #c0c4cc);
    @supports (color: color-mix(in lab, red, red)) {
      background: color-mix(in srgb, var(--ns-color, var(--color-muted)) 12%, transparent);
    }
  }
  .tag-option-key {
    min-width: 0px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-control);
  }
  .tag-option-key mark {
    border-radius: var(--radius-inline);
    color: inherit;
    background: color-mix(in srgb, #e8c46a 30%, transparent);
    @supports (color: color-mix(in lab, red, red)) {
      background: color-mix(in srgb, var(--color-star) 30%, transparent);
    }
  }
  .tag-option-meta {
    flex-shrink: 0;
    font-size: var(--text-micro);
    color: var(--color-muted);
  }
  .tag-option.is-applied .tag-option-meta {
    color: var(--color-star);
  }
  .tag-option.is-namespace .tag-option-key {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .tag-combobox-state {
    display: grid;
    gap: var(--spacing);
    padding-inline: calc(var(--spacing) * 3.5);
    padding-block: calc(var(--spacing) * 4);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .tag-combobox-state strong {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .tag-combobox-foot {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--spacing) * 2.5);
    border-top-style: var(--tw-border-style);
    border-top-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 1.5);
    font-size: var(--text-micro);
    color: var(--color-muted);
  }
  .tag-combobox-count {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-combobox-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .tag-combobox-hints {
    color: var(--color-muted);
  }
  .tag-combobox-exclude {
    min-height: calc(var(--spacing) * 6);
    cursor: pointer;
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-micro);
    color: var(--color-muted);
    font: inherit;
  }
  .search-panel {
    display: grid;
    gap: calc(var(--spacing) * 2.5);
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-top: calc(var(--spacing) * 2.5);
    padding-bottom: calc(var(--spacing) * 4);
  }
  .cat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .cat-chip {
    padding-inline: calc(var(--spacing) * 3);
    transition-property: opacity;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
    border: 1px solid var(--cat, #a8323a);
    @supports (color: color-mix(in lab, red, red)) {
      border: 1px solid color-mix(in oklab, var(--cat, var(--color-accent)) 70%, transparent);
    }
    background: linear-gradient( oklch(0.47 var(--cat-c, 0.1) var(--cat-h, 20)), oklch(0.42 var(--cat-c, 0.1) var(--cat-h, 20)) );
    color: var(--color-fg);
  }
  .cat-chip:hover {
    opacity: 0.85;
  }
  .cat-chip[aria-pressed="false"] {
    opacity: 0.6;
  }
  .cat-chip[aria-pressed="false"]:hover {
    opacity: 0.8;
  }
  .quick-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .quick-tag {
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    color: var(--color-muted);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .quick-tag:hover {
    border-color: var(--color-line-strong);
    color: var(--color-fg);
  }
  .quick-tag[aria-pressed="true"] {
    border-color: var(--color-accent);
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #a8323a 55%, transparent);
    @supports (color: color-mix(in lab, red, red)) {
      box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-accent) 55%, transparent);
    }
  }
  .quick-tag-label {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quick-tag-edit {
    margin-left: calc(var(--spacing) * 0.5);
    border-style: var(--tw-border-style);
    border-width: 1px;
    --tw-border-style: dashed;
    border-style: dashed;
    border-color: var(--color-line-strong);
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 2.5);
    color: var(--color-muted);
  }
  .quick-tag-edit:hover {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .expression-editor-panel {
    max-width: calc(100vw - 2rem);
  }
  .expression-editor {
    display: flex;
    width: 460px;
    max-width: 100%;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    padding: calc(var(--spacing) * 3);
    font-size: var(--text-control);
  }
  .expression-editor-title {
    margin: 0px;
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .expression-editor-hint {
    margin: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .expression-list {
    display: flex;
    max-height: 320px;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    overflow-y: auto;
  }
  .expression-row {
    display: grid;
    grid-template-columns: minmax(72px,0.7fr) minmax(0,1.6fr) auto;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .expression-options {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .expression-input {
    width: 100%;
    padding-inline: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
  }
  .expression-mode {
    height: calc(var(--spacing) * 7);
    width: auto;
    padding-inline: calc(var(--spacing) * 1.5);
    font-size: var(--text-meta);
  }
  .expression-pin {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .expression-remove {
    height: calc(var(--spacing) * 6);
    width: calc(var(--spacing) * 6);
    font-size: var(--text-control);
  }
  .expression-editor-actions {
    margin-top: var(--spacing);
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .expression-editor-spacer {
    flex: 1;
  }
  .filters {
    width: fit-content;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
  }
  .filters[open] {
    width: 100%;
  }
  .filters-summary {
    display: flex;
    cursor: pointer;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2.5);
    font-size: var(--text-control);
    color: var(--color-muted);
    -webkit-user-select: none;
    user-select: none;
  }
  .filters-summary:hover {
    color: var(--color-fg);
  }
  .filters-count {
    display: inline-flex;
    min-width: 18px;
    align-items: center;
    justify-content: center;
    border-radius: 0;
    padding-inline: calc(var(--spacing) * 1.5);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-micro);
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
  }
  .filters-grid {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: calc(var(--spacing) * 4);
    padding-inline: calc(var(--spacing) * 3);
    padding-bottom: calc(var(--spacing) * 3);
  }
  .filters-grid > .field {
    width: 190px;
  }
  .filters-grid .filters-actions {
    margin-left: auto;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 1.5);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .field-input, .field-select {
    height: calc(var(--spacing) * 8);
    min-width: 0px;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-canvas);
    padding-inline: calc(var(--spacing) * 2.5);
    font-size: var(--text-control);
    color: var(--color-fg);
    border-color: var(--color-field-line);
  }
  .field-select:focus, .field-input:focus {
    border-color: var(--color-accent);
  }
  .field-input {
    width: 84px;
  }
  .check-row {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 2.5);
    font-size: var(--text-control);
    color: var(--color-fg);
  }
  .check {
    display: inline-flex;
    cursor: pointer;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .filters-actions {
    display: flex;
    justify-content: flex-end;
    gap: calc(var(--spacing) * 2);
  }
  .filters-native, .settings-native {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .filters-native {
    margin-right: auto;
    align-self: center;
  }
  .card-grid {
    display: flex;
    align-items: flex-start;
    gap: var(--gap, 12px);
    padding: 18px 0 10px;
  }
  .card-column {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: var(--gap, 12px);
    min-width: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-panel);
    transition-property: border-color,transform;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
    --tw-duration: 150ms;
    transition-duration: 150ms;
  }
  .card:hover {
    --tw-translate-y: calc(var(--spacing) * -0.5);
    translate: var(--tw-translate-x) var(--tw-translate-y);
    border-color: var(--color-line-strong);
  }
  .card-cover-wrap {
    position: relative;
    overflow: hidden;
  }
  .card-cover {
    display: block;
    background-color: var(--color-canvas);
  }
  .card-cover img {
    display: block;
    height: auto;
    width: 100%;
  }
  .card-cover.is-tall-cover {
    aspect-ratio: 1 / 2.5;
    overflow: hidden;
  }
  .card-cover.is-tall-cover img {
    height: 100%;
    object-fit: cover;
    object-position: top;
  }
  .card-cover.is-missing {
    display: grid;
    aspect-ratio: 250/353;
    place-items: center;
    background-color: var(--color-surface);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-cover-wrap .fav-btn {
    position: absolute;
    top: calc(var(--spacing) * 2);
    right: calc(var(--spacing) * 2);
    border-radius: 0;
    padding: calc(var(--spacing) * 1.5);
    --tw-backdrop-blur: blur(var(--blur-sm));
    -webkit-backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);
    backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);
    background: var(--scrim-control);
  }
  .card-cover-wrap .fav-label {
    display: none;
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--spacing);
    padding-inline: calc(var(--spacing) * 3);
    padding-top: calc(var(--spacing) * 2.5);
    padding-bottom: calc(var(--spacing) * 3);
  }
  .card-title {
    font-size: var(--text-body);
    --tw-leading: 1.35;
    line-height: 1.35;
    color: var(--color-fg);
    text-decoration-line: none;
  }
  .card-title:hover {
    color: var(--color-link);
  }
  .card-primary {
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .card-artist {
    color: var(--color-muted);
  }
  .card-secondary {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-uploader {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-torrent {
    display: inline-flex;
    align-items: center;
    color: var(--color-torrent);
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 2);
    row-gap: var(--spacing);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-posted.is-favorite {
    padding-left: 6px;
    box-shadow: inset 2px 0 0 var(--fav-color, var(--color-accent));
    color: var(--color-fg);
  }
  .gallery-header {
    margin-top: calc(var(--spacing) * 2);
    display: grid;
    grid-template-columns: 250px minmax(0,1fr) auto;
    align-items: center;
    gap: calc(var(--spacing) * 7);
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    --tw-gradient-position: to bottom in oklab;
    background-image: linear-gradient(var(--tw-gradient-stops));
    --tw-gradient-from: var(--color-panel);
    --tw-gradient-to: var(--color-surface);
    --tw-gradient-stops: var(--tw-gradient-via-stops, var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-to) var(--tw-gradient-to-position));
    padding: calc(var(--spacing) * 5);
  }
  .gallery-details {
    min-width: 0px;
  }
  .gallery-rail {
    margin-right: calc(var(--spacing) * -2);
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 0.5);
    font-size: var(--text-meta);
    --tw-leading: 1.4;
    line-height: 1.4;
  }
  .rail-link {
    font-size: var(--text-meta);
  }
  .gallery-cover {
    width: 250px;
    overflow: hidden;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-surface);
  }
  .gallery-cover img {
    display: block;
    height: auto;
    width: 100%;
  }
  .gallery-cover.is-missing {
    display: grid;
    aspect-ratio: 250/364;
    place-items: center;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .title-meta-wrap, .title-main {
    display: block;
  }
  .gallery-title .title-meta-wrap {
    margin-bottom: var(--spacing);
  }
  .gallery-title .meta-item {
    font-size: var(--text-control);
  }
  .meta-artist {
    color: var(--ns-artist);
    font-weight: 600;
  }
  .meta-artist span {
    color: var(--ns-group);
    font-weight: 400;
  }
  .meta-event {
    color: var(--ns-character);
  }
  .meta-anthology {
    color: var(--ns-female);
    font-weight: 600;
  }
  .meta-parody {
    color: var(--ns-parody);
  }
  .meta-tag {
    color: var(--ns-language);
  }
  .meta-lang {
    color: var(--ns-mixed);
    font-weight: 600;
  }
  .gallery-title .title-primary {
    display: block;
    font-size: var(--text-display);
    --tw-leading: 1.22;
    line-height: 1.22;
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    --tw-tracking: -0.01em;
    letter-spacing: -0.01em;
    color: var(--color-fg);
  }
  .gallery-title .title-secondary, .gallery-title .title-alt {
    font-size: var(--text-title-2);
    --tw-font-weight: var(--font-weight-normal);
    font-weight: var(--font-weight-normal);
    color: var(--color-muted);
  }
  .gallery-title .title-sep {
    display: none;
  }
  .gallery-meta {
    margin-top: calc(var(--spacing) * 3.5);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 3);
    row-gap: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .cat-badge {
    --cat-fg: oklch(0.85 calc(var(--cat-c, 0.1) * 0.45) var(--cat-h, 20));
    --cat: oklch(0.72 var(--cat-c, 0.1) var(--cat-h, 20));
    display: inline-flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
    border-radius: var(--radius-chip);
    border-style: var(--tw-border-style);
    border-width: 1px;
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-medium);
    font-weight: var(--font-weight-medium);
    border-color: var(--cat);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in oklab, var(--cat) 40%, transparent);
    }
    background: var(--cat);
    @supports (color: color-mix(in lab, red, red)) {
      background: color-mix(in oklab, var(--cat) 12%, transparent);
    }
    color: var(--cat-fg);
  }
  .cat-badge::before {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-chip);
    background: var(--cat);
    content: "";
  }
  .ct1 {
    --cat-h: 0;
    --cat-c: 0.004;
  }
  .ct2 {
    --cat-h: 25;
    --cat-c: 0.16;
  }
  .ct3 {
    --cat-h: 62;
    --cat-c: 0.14;
  }
  .ct4 {
    --cat-h: 104;
    --cat-c: 0.13;
  }
  .ct5 {
    --cat-h: 143;
    --cat-c: 0.15;
  }
  .ct6 {
    --cat-h: 265;
    --cat-c: 0.15;
  }
  .ct7 {
    --cat-h: 305;
    --cat-c: 0.17;
  }
  .ct8 {
    --cat-h: 330;
    --cat-c: 0.13;
  }
  .ct9 {
    --cat-h: 214;
    --cat-c: 0.12;
  }
  .cta {
    --cat-h: 133;
    --cat-c: 0.15;
  }
  .meta-dot {
    position: relative;
  }
  .meta-dot + .meta-dot {
    padding-left: calc(var(--spacing) * 3);
  }
  .meta-dot + .meta-dot::before {
    position: absolute;
    top: calc(1 / 2 * 100%);
    left: 0px;
    width: 3px;
    height: 3px;
    --tw-translate-y: calc(calc(1 / 2 * 100%) * -1);
    translate: var(--tw-translate-x) var(--tw-translate-y);
    border-radius: calc(infinity * 1px);
    background-color: var(--color-line-strong);
    --tw-content: '';
    content: var(--tw-content);
  }
  .draft-note strong {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .gallery-actions {
    margin-top: calc(var(--spacing) * 5);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2.5);
  }
  .btn {
    height: calc(var(--spacing) * 8);
    padding-inline: calc(var(--spacing) * 3.5);
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    text-decoration-line: none;
  }
  .btn-primary {
    border-color: var(--color-parchment);
    background-color: var(--color-parchment);
    color: var(--color-burgundy);
  }
  .btn-primary:hover {
    border-color: var(--color-parchment-hover);
    background-color: var(--color-parchment-hover);
    color: var(--color-burgundy);
  }
  .btn-ghost {
    background-color: transparent;
  }
  .btn-small {
    height: calc(var(--spacing) * 7);
    padding-inline: calc(var(--spacing) * 3);
    font-size: var(--text-control);
  }
  .btn.is-disabled, .btn:disabled {
    pointer-events: none;
    opacity: 40%;
  }
  .btn:disabled {
    cursor: not-allowed;
  }
  .fav-btn {
    height: calc(var(--spacing) * 8);
    max-width: 100%;
    overflow: hidden;
    padding-inline: calc(var(--spacing) * 3);
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    color: var(--color-muted);
  }
  .fav-btn:hover {
    color: var(--color-star);
    border-color: color-mix(in srgb, #e8c46a 45%, #5f646e);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--color-star) 45%, var(--color-line-strong));
    }
  }
  .fav-btn.is-favorite {
    color: var(--color-star);
    border-color: color-mix(in srgb, #e8c46a 40%, #4c5058);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--color-star) 40%, var(--color-line));
    }
    background: color-mix(in srgb, #e8c46a 12%, #40444c);
    @supports (color: color-mix(in lab, red, red)) {
      background: color-mix(in srgb, var(--color-star) 12%, var(--color-panel));
    }
  }
  .fav-label {
    min-width: 0px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    --tw-leading: 1;
    line-height: 1;
  }
  .tag-section {
    display: grid;
    gap: calc(var(--spacing) * 2);
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-block: calc(var(--spacing) * 5);
  }
  .tag-ns {
    width: 4.75rem;
    flex-shrink: 0;
    padding-top: calc(var(--spacing) * 1.5);
    font-size: var(--text-meta);
    --tw-tracking: 0.02em;
    letter-spacing: 0.02em;
    text-transform: lowercase;
    color: var(--ns-color, var(--color-muted));
  }
  .tag-chips {
    display: flex;
    min-width: 0px;
    flex: 1;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 1.5);
  }
  .tag-add {
    margin-top: var(--spacing);
    display: flex;
    max-width: 520px;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .tag-add-input {
    width: 100%;
    flex: 1;
  }
  .tag-chip {
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 2.5);
    padding-block: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
    border-color: var(--ns-color, var(--color-line));
  }
  .tag-chip:hover {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .tag-chip-wrap {
    display: inline-flex;
    align-items: stretch;
  }
  .tag-menu-trigger {
    display: none;
  }
  @media (pointer: coarse), (hover: none) {
    .tag-menu-trigger {
      display: grid;
      width: calc(var(--spacing) * 6);
      cursor: pointer;
      place-items: center;
      border-style: var(--tw-border-style);
      border-width: 1px;
      border-left-style: var(--tw-border-style);
      border-left-width: 0px;
      background-color: var(--color-panel);
      font-size: var(--text-control);
      color: var(--color-muted);
      border-color: var(--ns-color, var(--color-line));
    }
    .tag-menu-trigger:hover, .tag-menu-trigger:focus-visible {
      border-color: var(--color-accent);
      color: var(--color-fg);
    }
  }
  .tag-chip.is-added {
    color: var(--color-fg);
    border-color: var(--ns-color, var(--color-line-strong));
    background: var(--ns-color, #5f646e);
    @supports (color: color-mix(in lab, red, red)) {
      background: color-mix(in srgb, var(--ns-color, var(--color-line-strong)) 26%, transparent);
    }
  }
  .tag-chip.is-added.is-excluded {
    border-color: color-mix(in srgb, #a8323a 75%, #5f646e);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--color-accent) 75%, var(--color-line-strong));
    }
    border-style: dashed;
    text-decoration: line-through;
    opacity: 0.85;
  }
  .tag-chip.is-added.is-or {
    border-style: dashed;
  }
  .ns-artist {
    --ns-color: var(--ns-artist);
  }
  .ns-group {
    --ns-color: var(--ns-group);
  }
  .ns-parody {
    --ns-color: var(--ns-parody);
  }
  .ns-character {
    --ns-color: var(--ns-character);
  }
  .ns-female {
    --ns-color: var(--ns-female);
  }
  .ns-male {
    --ns-color: var(--ns-male);
  }
  .ns-language {
    --ns-color: var(--ns-language);
  }
  .ns-cosplayer {
    --ns-color: var(--ns-cosplayer);
  }
  .ns-mixed {
    --ns-color: var(--ns-mixed);
  }
  .ns-other {
    --ns-color: var(--ns-other);
  }
  .ns-location {
    --ns-color: var(--ns-location);
  }
  .ns-reclass {
    --ns-color: var(--ns-reclass);
  }
  .thumb-grid {
    --scale: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--thumb-size, 200px));
    justify-content: center;
    gap: var(--gap, 12px);
    padding: 14px 0 8px;
  }
  .thumb-cell {
    display: flex;
    flex-direction: column;
    gap: var(--spacing);
  }
  .thumb {
    position: relative;
    display: block;
    overflow: hidden;
    background-color: var(--color-canvas);
    background-repeat: no-repeat;
    --tw-shadow: inset 0 0 0 1px var(--tw-shadow-color, rgb(255 255 255/0.05));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    background-position-y: 0;
  }
  .thumb.is-loaded {
    background-size: calc(var(--sprite-w) * var(--sprite-count) * var(--scale)) auto;
    background-position-x: calc(var(--sprite-x) * var(--scale));
  }
  .thumb.is-missing {
    background-color: var(--color-panel);
  }
  .thumb:hover {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }
  .thumb-page {
    text-align: center;
    font-size: var(--text-micro);
    --tw-leading: 1.3;
    line-height: 1.3;
    color: var(--color-muted);
  }
  .pager {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: calc(var(--spacing) * 4);
    padding-top: calc(var(--spacing) * 6);
    padding-bottom: calc(var(--spacing) * 12);
  }
  .pager.is-above {
    padding-top: calc(var(--spacing) * 5);
    padding-bottom: 0px;
  }
  .pager-btn {
    height: calc(var(--spacing) * 7);
    padding-inline: calc(var(--spacing) * 3);
    font-size: var(--text-control);
    text-decoration-line: none;
  }
  .pager-info {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .pager-nums {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--spacing);
  }
  .pager-num {
    height: calc(var(--spacing) * 7);
    min-width: calc(var(--spacing) * 7);
    padding-inline: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
  }
  .pager-gap {
    padding-inline: var(--spacing);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .settings-jump, .toplist-jump {
    position: sticky;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 0.5);
    overflow-x: auto;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: var(--spacing);
    font-size: var(--text-meta);
    color: var(--color-muted);
    top: var(--topbar-h, 0px);
    border-radius: var(--radius-card);
  }
  .settings-jump-link, .toplist-jump-link {
    display: inline-flex;
    height: calc(var(--spacing) * 6);
    flex-shrink: 0;
    align-items: center;
    border-radius: var(--radius-row);
    padding-inline: calc(var(--spacing) * 2);
    text-decoration-line: none;
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .settings-jump-link:hover, .toplist-jump-link:hover {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .settings-jump-link[aria-current], .toplist-jump-link[aria-current] {
    color: var(--color-fg);
  }
  .infinite-scroll {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    padding-top: calc(var(--spacing) * 5);
    padding-bottom: calc(var(--spacing) * 10);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .infinite-status:empty {
    min-height: 1px;
  }
  .fav-menu {
    width: 280px;
    padding: calc(var(--spacing) * 2);
  }
  .fav-head {
    margin-bottom: calc(var(--spacing) * 1.5);
    padding-inline: var(--spacing);
  }
  .fav-note {
    margin-bottom: calc(var(--spacing) * 1.5);
    width: 100%;
    resize: vertical;
    min-height: 48px;
  }
  .fav-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing);
  }
  .fav-item {
    gap: calc(var(--spacing) * 2);
    color: var(--color-fg);
  }
  .fav-remove {
    margin-top: calc(var(--spacing) * 2);
    width: 100%;
    color: var(--color-danger-text);
  }
  .fav-dot {
    width: calc(var(--spacing) * 2);
    height: calc(var(--spacing) * 2);
    flex-shrink: 0;
    border-radius: calc(infinity * 1px);
  }
  .fav-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fav-item.is-current {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }
  .fav-check {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--color-accent-text);
  }
  .fav-status {
    padding-inline: calc(var(--spacing) * 0.5);
    padding-block: calc(var(--spacing) * 1.5);
    font-size: var(--text-control);
    --tw-leading: var(--leading-relaxed);
    line-height: var(--leading-relaxed);
    color: var(--color-muted);
  }
  .fav-link {
    margin-top: calc(var(--spacing) * 2);
    display: block;
    font-size: var(--text-meta);
  }
  .eh-skip {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 600;
    padding: 8px 14px;
    border: 1px solid var(--color-line-strong);
    border-radius: var(--radius-control);
    background: var(--color-panel);
    color: var(--color-fg);
    text-decoration: none;
    transform: translateY(-200%);
  }
  .eh-skip:focus-visible {
    transform: translateY(0);
    outline-offset: 2px;
  }
  .eh-banner-host {
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    padding-inline: calc(var(--spacing) * 7);
    padding-top: calc(var(--spacing) * 2.5);
  }
  .eh-banner {
    display: flex;
    width: 100%;
    max-width: 760px;
    align-items: flex-start;
    gap: calc(var(--spacing) * 2.5);
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-danger-line);
    background-color: var(--color-danger-surface);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2.5);
    font-size: var(--text-control);
    --tw-leading: var(--leading-relaxed);
    line-height: var(--leading-relaxed);
    color: var(--color-danger-text);
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .eh-banner svg {
    margin-top: 1px;
    flex-shrink: 0;
  }
  .eh-banner-text {
    overflow-wrap: break-word;
    white-space: pre-wrap;
  }
  .eh-banner-count {
    flex-shrink: 0;
    opacity: 70%;
  }
  .eh-banner-close {
    margin-left: auto;
    display: inline-grid;
    width: calc(var(--spacing) * 6);
    height: calc(var(--spacing) * 6);
    cursor: pointer;
    place-items: center;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: calc(var(--spacing) * 0.5);
    color: inherit;
    opacity: 70%;
  }
  .eh-banner-close:hover {
    opacity: 100%;
  }
  .eh-toast {
    position: fixed;
    bottom: 26px;
    left: calc(1 / 2 * 100%);
    z-index: 350;
    border-radius: var(--radius-chip);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 4);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-fg);
    opacity: 0%;
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    pointer-events: none;
    transform: translate(-50%, 8px);
    transition: opacity 0.18s ease, transform 0.18s ease;
  }
  .eh-toast.show {
    opacity: 1;
    transform: translate(-50%, 0);
  }
  .eh-loading {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 500;
    width: 100%;
    height: 2px;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
    background-size: 40% 100%;
    background-repeat: no-repeat;
  }
  body.is-loading .eh-loading {
    opacity: 1;
    animation: eh-loading-slide 1.1s ease-in-out infinite;
  }
  @keyframes eh-loading-slide {
    from {
      background-position: -40% 0;
    }
    to {
      background-position: 140% 0;
    }
  }
  .empty-state, .error-view {
    margin-inline: auto;
    margin-block: calc(var(--spacing) * 16);
    max-width: 560px;
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 8);
    text-align: center;
  }
  .state-icon {
    margin-inline: auto;
    margin-bottom: calc(var(--spacing) * 3);
    display: grid;
    width: calc(var(--spacing) * 9);
    height: calc(var(--spacing) * 9);
    place-items: center;
    border-radius: var(--radius-chip);
    background-color: var(--color-panel-hover);
    color: var(--color-muted);
  }
  .state-title {
    margin-top: 0px;
    margin-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-heading);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .state-text {
    margin: 0px;
    font-size: var(--text-body);
    --tw-leading: var(--leading-relaxed);
    line-height: var(--leading-relaxed);
    color: var(--color-muted);
  }
  .state-text + .state-text {
    margin-top: calc(var(--spacing) * 1.5);
  }
  .state-actions {
    margin-top: calc(var(--spacing) * 5);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: calc(var(--spacing) * 2.5);
  }
  @media (max-width: 720px) {
    #eh-view {
      padding-inline: calc(var(--spacing) * 3.5);
      padding-bottom: calc(var(--spacing) * 7);
    }
    .eh-banner-host {
      padding-inline: calc(var(--spacing) * 3.5);
    }
    .gallery-header {
      grid-template-columns: 120px minmax(0,1fr);
      align-items: flex-start;
      gap: calc(var(--spacing) * 4);
      padding: calc(var(--spacing) * 3.5);
    }
    .gallery-cover {
      width: 120px;
    }
    .gallery-rail {
      grid-column: 1 / -1;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      column-gap: calc(var(--spacing) * 3);
      row-gap: var(--spacing);
    }
    .gallery-rail .rail-label {
      margin-right: var(--spacing);
    }
    .gallery-title .title-primary {
      font-size: var(--text-title-2);
    }
    .topbar {
      margin: 0 -14px;
      padding: 12px 14px 10px;
    }
    .topbar-kbd {
      display: none;
    }
    .topbar-search-submit {
      margin-right: var(--spacing);
      display: grid;
      width: calc(var(--spacing) * 6);
      height: calc(var(--spacing) * 6);
      flex-shrink: 0;
      place-items: center;
      padding: 0;
    }
    .topbar-search-submit-label {
      display: none;
    }
    .topbar-search-submit-icon {
      display: inline-flex;
    }
    .tag-combobox-hints {
      display: none;
    }
    .search-filters {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .search-filters::-webkit-scrollbar {
      display: none;
    }
    .search-filters .term-chip {
      flex: 0 0 auto;
    }
    .search-filters[data-scrollable] {
      mask-image: var(--scroll-fade);
    }
    .search-filters[data-scrollable][data-scrolled] {
      mask-image: var(--scroll-fade-both);
    }
    .search-filters[data-scrollable][data-at-end] {
      mask-image: var(--scroll-fade-left);
    }
    .term-value {
      max-width: 160px;
    }
    .gallery-meta .meta-dot {
      padding-left: 0;
    }
    .gallery-meta .meta-dot + .meta-dot::before {
      display: none;
    }
    .gallery-meta {
      column-gap: calc(var(--spacing) * 3);
      row-gap: var(--spacing);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  .action-menu-panel, .topbar-more-panel {
    min-width: 180px;
    padding: 4px;
  }
  .action-menu {
    display: grid;
    gap: calc(var(--spacing) * 0.5);
  }
  .action-menu-item, .tag-menu-item {
    width: 100%;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    text-align: left;
  }
  .card-preview-trigger {
    margin-left: auto;
    width: calc(var(--spacing) * 7);
    height: calc(var(--spacing) * 7);
    flex-shrink: 0;
    border-radius: var(--radius-control);
  }
  .card-preview {
    padding: calc(var(--spacing) * 3);
    width: min(320px, calc(100vw - 16px));
  }
  .card-preview-body {
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .card-preview-title {
    margin: 0px;
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .card-preview-secondary {
    margin: 0px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-preview-facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 2);
    row-gap: var(--spacing);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .card-preview-favorite {
    color: var(--color-star);
  }
  .card-preview-actions {
    margin-top: var(--spacing);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .pager-jump {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .pager-jump-label {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .pager-jump-input {
    height: calc(var(--spacing) * 7);
    width: calc(var(--spacing) * 16);
    padding-inline: calc(var(--spacing) * 2);
  }
  .pager-seek-input {
    width: calc(var(--spacing) * 32);
  }
  .topbar-history {
    margin-right: var(--spacing);
    width: calc(var(--spacing) * 6);
    height: calc(var(--spacing) * 6);
    flex-shrink: 0;
  }
  .topbar-history[aria-expanded="true"] {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .search-history {
    display: flex;
    max-height: min(70vh, 520px);
    width: min(360px, calc(100vw - 16px));
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    overflow-y: auto;
    padding: calc(var(--spacing) * 3);
  }
  .search-history-title {
    margin: 0px;
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .search-history-heading {
    margin: 0px;
    margin-top: var(--spacing);
  }
  .search-history-list {
    display: grid;
    gap: var(--spacing);
  }
  .search-history-saved {
    display: flex;
    align-items: stretch;
    gap: var(--spacing);
  }
  .search-history-query {
    display: flex;
    min-width: 0px;
    flex: 1;
    cursor: pointer;
    flex-direction: column;
    align-items: flex-start;
    gap: calc(var(--spacing) * 0.5);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-canvas);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: var(--spacing);
    text-align: left;
    font-size: var(--text-control);
    color: var(--color-fg);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
    border-radius: var(--radius-row);
  }
  .search-history-query:hover, .search-history-query:focus-visible {
    border-color: var(--color-accent);
    background-color: var(--color-panel-hover);
  }
  .search-history-name {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .search-history-text {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .search-history-remove, .search-history-toggle {
    width: calc(var(--spacing) * 7);
    flex-shrink: 0;
    background-color: transparent;
    font-size: var(--text-control);
    --tw-leading: 1;
    line-height: 1;
    color: var(--color-muted);
  }
  .search-history-remove:hover, .search-history-remove:focus-visible {
    background-color: var(--color-panel);
    color: var(--color-danger-text);
    border-color: var(--color-accent);
  }
  .search-history-toggle:hover, .search-history-toggle:focus-visible {
    background-color: var(--color-panel);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }
  .search-history-edit {
    cursor: pointer;
    align-self: flex-start;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-underline-offset: 2px;
  }
  .search-history-edit:hover, .search-history-edit:focus-visible {
    color: var(--color-fg);
    text-decoration-line: underline;
  }
  .search-history-clear {
    align-self: flex-start;
  }
  .search-history-empty {
    margin: 0px;
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  @media (forced-colors: active) {
    .btn, .fav-btn, .pager-btn, .pager-num, .cat-chip, .term-toggle, .tag-chip, .card, .gallery-header, .settings-section, .comment, .topbar-search, .field-input, .field-select, .card-preview, .eh-popover, .tag-menu-color, .pager-jump-input {
      border: 1px solid CanvasText;
    }
    .btn-primary, .topbar-search-submit, .pager-num.is-current, .cat-chip[aria-pressed="true"], .quick-tag[aria-pressed="true"], .tag-combobox-exclude[aria-pressed="true"] {
      background: Highlight;
      border-color: Highlight;
      color: HighlightText;
    }
    .card:hover, .card:focus-within {
      transform: none;
    }
    .eh-popover, .card-preview {
      background: Canvas;
      color: CanvasText;
      box-shadow: none;
    }
    .card-posted.is-favorite, .comment-score, .comment-votes, :focus-visible {
      outline: 2px solid CanvasText;
      outline-offset: 2px;
    }
  }
  @media (pointer: coarse) {
    .card-preview-trigger {
      width: calc(var(--spacing) * 9);
      height: calc(var(--spacing) * 9);
    }
  }
  .topbar-nav {
    display: flex;
    width: 100%;
    min-width: 0px;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .topbar-tabs {
    display: flex;
    min-width: 0px;
    flex: 1;
    align-items: center;
    gap: var(--spacing);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .topbar-tab {
    flex-shrink: 0;
    padding-inline: calc(var(--spacing) * 2.5);
    --tw-font-weight: var(--font-weight-medium);
    font-weight: var(--font-weight-medium);
  }
  @media (max-width: 380px) {
    .topbar-tabs {
      gap: 0;
    }
    .topbar-tab {
      padding-inline: 2px;
      font-size: var(--text-meta);
    }
  }
  .topbar-tab svg, .topbar-more-link svg {
    width: 12px;
    height: 12px;
    color: var(--color-muted);
  }
  .topbar-more {
    height: calc(var(--spacing) * 7);
    flex-shrink: 0;
    padding-inline: calc(var(--spacing) * 2.5);
    padding-block: 0px;
    font-size: var(--text-control);
  }
  .topbar-more[aria-expanded="true"] {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .topbar-more-list {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 0.5);
  }
  .topbar-more-link {
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
  }
  .topbar-more-link.is-active {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }
  .settings-page {
    display: flex;
    width: 100%;
    max-width: 900px;
    flex-direction: column;
    gap: calc(var(--spacing) * 4);
    padding-bottom: calc(var(--spacing) * 6);
  }
  .settings-section {
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
    padding-inline: calc(var(--spacing) * 4);
    padding-block: calc(var(--spacing) * 3);
    scroll-margin-top: var(--sticky-reading-line, 96px);
    border-radius: var(--radius-card);
  }
  .settings-title {
    margin: 0px;
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-section);
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
    color: var(--color-fg);
  }
  .settings-group {
    margin: 0px;
    margin-top: calc(var(--spacing) * 3);
    min-width: 0px;
    border-style: var(--tw-border-style);
    border-width: 0px;
    padding: 0px;
  }
  .settings-subhead {
    margin: 0px;
    margin-bottom: calc(var(--spacing) * 2);
    padding: 0px;
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .settings-rows {
    display: grid;
    gap: calc(var(--spacing) * 0.5);
  }
  .settings-rows-roomy {
    gap: calc(var(--spacing) * 2);
  }
  .settings-row {
    display: flex;
    min-height: calc(var(--spacing) * 7);
    cursor: pointer;
    align-items: flex-start;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-row);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-muted);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .settings-row:hover {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .settings-row input {
    margin-top: 2px;
    flex-shrink: 0;
  }
  .settings-row label {
    cursor: pointer;
  }
  .settings-row input:disabled + span, .settings-row input:disabled + label {
    opacity: 40%;
  }
  .settings-row-text {
    display: flex;
    min-width: 0px;
    flex-direction: column;
    gap: calc(var(--spacing) * 0.5);
  }
  .settings-row-text label {
    cursor: pointer;
    font-size: var(--text-control);
    color: var(--color-fg);
  }
  .settings-field {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    min-width: 0px;
    flex-direction: column;
    gap: calc(var(--spacing) * 1.5);
  }
  .settings-number-grid > .settings-field {
    margin-top: 0px;
  }
  .settings-field .field-input, .settings-field .field-select {
    width: 100%;
    max-width: 360px;
  }
  .settings-cat-chips {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 1.5);
  }
  .settings-textarea {
    min-height: 96px;
    resize: vertical;
    height: auto;
  }
  .settings-hint {
    margin: 0px;
    margin-top: var(--spacing);
    display: block;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .settings-actions {
    position: sticky;
    bottom: 0px;
    z-index: 30;
    margin-top: calc(var(--spacing) * 2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-top-style: var(--tw-border-style);
    border-top-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-canvas);
    padding-inline: var(--spacing);
    padding-block: calc(var(--spacing) * 3);
    backdrop-filter: blur(8px);
  }
  .settings-action-buttons {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .settings-error {
    margin: 0px;
    flex: 1;
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-danger-text);
  }
  .settings-dirty {
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-accent-text);
  }
  .settings-panel-group {
    margin-top: calc(var(--spacing) * 4);
    border-top-style: var(--tw-border-style);
    border-top-width: 1px;
    border-color: var(--color-line);
    padding-top: calc(var(--spacing) * 3);
  }
  .settings-number-grid {
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: calc(var(--spacing) * 3);
    @media (width >= 40rem) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .settings-number-input {
    width: 100%;
  }
  .settings-field .settings-number-input {
    max-width: 160px;
  }
  .settings-keymap {
    display: grid;
    gap: calc(var(--spacing) * 1.5);
  }
  .settings-key-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 2);
    row-gap: var(--spacing);
    border-radius: var(--radius-row);
    padding-inline: calc(var(--spacing) * 2);
    padding-block: var(--spacing);
  }
  .settings-key-row:hover {
    background-color: var(--color-panel-hover);
  }
  .settings-key-label {
    width: 100%;
    flex-shrink: 0;
    font-size: var(--text-control);
    color: var(--color-muted);
    @media (width >= 40rem) {
      width: 190px;
    }
  }
  .settings-keys {
    display: flex;
    min-height: calc(var(--spacing) * 6);
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing);
  }
  .settings-key {
    gap: var(--spacing);
    padding-inline: calc(var(--spacing) * 1.5);
    color: var(--color-fg);
  }
  .settings-key-name {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    font-family: ui-monospace, monospace;
  }
  .settings-key-remove {
    cursor: pointer;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
    font-size: var(--text-control);
    --tw-leading: 1;
    line-height: 1;
    color: var(--color-muted);
  }
  .settings-key-remove:hover, .settings-key-remove:focus-visible {
    color: var(--color-accent-text);
  }
  .settings-key-capture {
    min-height: calc(var(--spacing) * 7);
    background-color: transparent;
    padding-inline: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .settings-key-capture:hover, .settings-key-capture:focus-visible {
    background-color: var(--color-panel);
  }
  .settings-panel-actions {
    margin-top: var(--spacing);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .settings-file-input {
    display: none;
  }
  .toplist-tabs {
    position: sticky;
    z-index: 30;
    margin-bottom: calc(var(--spacing) * 5);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: calc(var(--spacing) * 4);
    row-gap: calc(var(--spacing) * 3);
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
    padding: calc(var(--spacing) * 4);
    top: var(--topbar-h, 0px);
  }
  @media (min-width: 900px) {
    .toplist-tabs {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .toplist-tab-group {
    display: flex;
    min-width: 0px;
    flex-direction: column;
    gap: calc(var(--spacing) * 1.5);
  }
  .toplist-tab-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing);
  }
  .toplist-sections {
    display: grid;
    grid-template-columns: repeat(auto-fill,minmax(290px,1fr));
    align-items: flex-start;
    gap: calc(var(--spacing) * 4);
  }
  .toplist-section {
    min-width: 0px;
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 3);
    scroll-margin-top: var(--sticky-reading-line, 96px);
  }
  .toplist-section-title {
    margin-bottom: calc(var(--spacing) * 2);
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-body);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .toplist-rows {
    margin: 0px;
    display: flex;
    list-style-type: none;
    flex-direction: column;
    gap: calc(var(--spacing) * 0.5);
    padding: 0px;
  }
  .toplist-row {
    display: flex;
    align-items: baseline;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-row);
    padding-inline: calc(var(--spacing) * 1.5);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-control);
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .toplist-row:hover {
    background-color: var(--color-panel-hover);
  }
  .toplist-rank {
    width: calc(var(--spacing) * 7);
    flex-shrink: 0;
    text-align: right;
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);
  }
  .toplist-rank.is-top {
    color: var(--color-accent-text);
  }
  .toplist-label {
    min-width: 0px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-fg);
    text-decoration-line: none;
  }
  .toplist-score {
    margin-left: auto;
    flex-shrink: 0;
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);
  }
  .toplist-row.is-gallery .toplist-label {
    --tw-font-weight: var(--font-weight-medium);
    font-weight: var(--font-weight-medium);
  }
  .toplist-row.is-gallery {
    flex-wrap: wrap;
  }
  .toplist-meta {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 2);
    row-gap: calc(var(--spacing) * 0.5);
    padding-left: calc(var(--spacing) * 9);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .toplist-uploader, .toplist-torrents {
    color: var(--color-muted);
    text-decoration-line: none;
  }
  .toplist-uploader:hover, .toplist-torrents:hover {
    color: var(--color-link);
    text-decoration-line: underline;
  }
  .toplist-label:hover {
    color: var(--color-link);
  }
  .toplist-jump {
    margin-bottom: calc(var(--spacing) * 4);
    position: static;
  }
  .torrent-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 5);
    row-gap: calc(var(--spacing) * 2);
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-top: calc(var(--spacing) * 2.5);
    padding-bottom: calc(var(--spacing) * 4);
  }
  .torrent-filter {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .torrent-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing);
  }
  .torrent-filter-label {
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .torrent-filter-btn[aria-pressed="true"] {
    border-color: var(--color-accent);
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .torrent-mine.is-disabled {
    cursor: not-allowed;
    opacity: 40%;
  }
  .torrent-search {
    display: flex;
    width: 100%;
    max-width: 360px;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .torrent-search-input {
    width: 100%;
  }
  .torrent-table-wrap {
    margin-top: calc(var(--spacing) * 3);
    overflow-x: auto;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
    -webkit-overflow-scrolling: touch;
  }
  .torrent-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-control);
    min-width: 620px;
  }
  .torrent-table thead th {
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    --tw-tracking: var(--tracking-wide);
    letter-spacing: var(--tracking-wide);
    color: var(--color-muted);
    text-transform: uppercase;
  }
  .torrent-sort {
    color: var(--color-muted);
    text-decoration-line: none;
  }
  .torrent-sort:hover, .torrent-sort.is-active {
    color: var(--color-accent);
  }
  @media (min-width: 1000px) {
    .torrent-table-wrap {
      overflow: visible;
    }
    .torrent-table thead {
      position: sticky;
      top: var(--topbar-h, 0px);
      z-index: 2;
    }
    .torrent-table thead tr {
      background: var(--color-panel);
    }
  }
  .torrent-cell {
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 1px;
    border-color: var(--color-line);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    text-align: left;
    vertical-align: middle;
  }
  .torrent-table tbody tr:last-child .torrent-cell {
    border-bottom-style: var(--tw-border-style);
    border-bottom-width: 0px;
  }
  .torrent-cell.is-right {
    text-align: right;
  }
  .torrent-added {
    white-space: nowrap;
    color: var(--color-muted);
  }
  .torrent-name-text {
    display: block;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .torrent-name-link {
    color: var(--color-fg);
    text-decoration-line: none;
  }
  .torrent-name-link:hover {
    color: var(--color-link);
    text-decoration-line: underline;
  }
  .torrent-gallery, .torrent-size, .torrent-seeds, .torrent-peers, .torrent-downloads {
    white-space: nowrap;
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);
  }
  .torrent-uploader-text {
    display: inline-block;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  @media (max-width: 720px) {
    .torrent-table {
      display: block;
      min-width: 0;
    }
    .torrent-table thead {
      display: none;
    }
    .torrent-table tbody {
      display: block;
    }
    .torrent-row {
      display: block;
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-line);
    }
    .torrent-row:last-child {
      border-bottom: 0;
    }
    .torrent-cell {
      display: inline-block;
      padding: 0;
      border: 0;
      text-align: left;
    }
    .torrent-cell.is-right {
      text-align: left;
    }
    .torrent-name {
      display: block;
      margin-bottom: 4px;
    }
    .torrent-added, .torrent-gallery, .torrent-uploader {
      display: block;
      margin-top: 4px;
      color: var(--color-muted);
    }
    .torrent-added::before, .torrent-gallery::before, .torrent-uploader::before {
      color: var(--color-muted);
      content: attr(data-label) ": ";
    }
    .torrent-name-text {
      max-width: none;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .torrent-size, .torrent-seeds, .torrent-peers, .torrent-downloads {
      margin-right: 12px;
    }
    .torrent-size::before, .torrent-seeds::before, .torrent-peers::before, .torrent-downloads::before {
      color: var(--color-muted);
      content: attr(data-label) ": ";
    }
  }
  .favorites-search {
    margin-top: calc(var(--spacing) * 4);
    display: flex;
    max-width: 420px;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .favorites-search-input {
    width: 100%;
  }
  .favorites-tabs {
    margin-top: calc(var(--spacing) * 4);
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 2);
  }
  .favorites-tab {
    display: flex;
    height: calc(var(--spacing) * 8);
    min-width: 132px;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    font-size: var(--text-control);
    color: var(--color-fg);
    text-decoration-line: none;
    transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to;
    transition-timing-function: var(--tw-ease, var(--default-transition-timing-function));
    transition-duration: var(--tw-duration, var(--default-transition-duration));
  }
  .favorites-tab:hover {
    border-color: var(--color-line-strong);
    background-color: var(--color-panel-hover);
  }
  .favorites-tab.is-active {
    border-color: var(--color-line-strong);
  }
  .favorites-tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .favorites-tab-count {
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);
  }
  .favorites-tab.is-active .favorites-tab-count {
    color: var(--color-fg);
  }
  .favorites-order {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .favorites-order-label {
    color: var(--color-muted);
  }
  .favorites-order-link.is-active {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .favorites-select {
    position: absolute;
    top: calc(var(--spacing) * 2);
    left: calc(var(--spacing) * 2);
    display: flex;
    cursor: pointer;
    align-items: center;
    border-radius: var(--radius-row);
    padding: calc(var(--spacing) * 1.5);
    --tw-backdrop-blur: blur(var(--blur-sm));
    -webkit-backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);
    backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);
    background: var(--scrim-control);
  }
  @media (hover: hover) {
    .favorites-select {
      opacity: 0;
      transition: opacity 0.15s;
    }
    .favorites-card:hover .favorites-select, .favorites-card:focus-within .favorites-select, .favorites-select:has(.favorites-checkbox:checked) {
      opacity: 1;
    }
  }
  .favorites-checkbox, .favorites-check-all {
    width: calc(var(--spacing) * 4);
    height: calc(var(--spacing) * 4);
    cursor: pointer;
  }
  .favorites-note {
    margin-top: var(--spacing);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    border-left-style: var(--tw-border-style);
    border-left-width: 2px;
    border-color: var(--color-line-strong);
    padding-left: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .favorites-bulk {
    position: fixed;
    bottom: max(1rem, env(safe-area-inset-bottom));
    left: calc(1 / 2 * 100%);
    z-index: 60;
    display: flex;
    max-width: calc(100vw - 2rem);
    --tw-translate-x: calc(calc(1 / 2 * 100%) * -1);
    translate: var(--tw-translate-x) var(--tw-translate-y);
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-card);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line-strong);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  }
  .favorites-bulk-count {
    padding-inline: var(--spacing);
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .favorites-bulk-status {
    padding-inline: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-accent-text);
  }
  .favorites-move-panel {
    display: flex;
    width: 220px;
    flex-direction: column;
    gap: var(--spacing);
  }
  .favorites-move-head {
    padding-inline: calc(var(--spacing) * 2);
    padding-top: var(--spacing);
    padding-bottom: calc(var(--spacing) * 1.5);
  }
  .favorites-move-item {
    height: auto;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding-block: calc(var(--spacing) * 1.5);
    text-align: left;
    color: var(--color-fg);
  }
  .favorites-move-name {
    min-width: 0px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .favorites-move-count {
    flex-shrink: 0;
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);
  }
  .favorites-move-empty {
    padding-inline: calc(var(--spacing) * 2);
    padding-block: calc(var(--spacing) * 1.5);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .favorites-toolbar {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 3);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .favorites-delete {
    border-color: var(--color-accent-text);
    color: var(--color-accent-text);
  }
  .favorites-delete:hover {
    border-color: var(--color-accent-text);
    color: var(--color-accent-text);
  }
  .favorites-delete.is-armed {
    border-color: var(--color-accent-text);
    background-color: var(--color-accent-text);
    color: var(--color-burgundy);
  }
  @media (max-width: 720px) {
    .favorites-tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      mask-image: var(--scroll-fade);
    }
    .favorites-tabs[data-scrolled] {
      mask-image: var(--scroll-fade-both);
    }
    .favorites-tabs[data-scrolled][data-at-end] {
      mask-image: var(--scroll-fade-left);
    }
    .favorites-tab {
      min-width: 128px;
      flex: none;
    }
  }
  .rating-control {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 3);
  }
  .rating-stars {
    display: inline-flex;
    align-items: center;
  }
  .rating-half {
    position: relative;
    display: inline-block;
    height: calc(var(--spacing) * 5);
    width: calc(var(--spacing) * 2.5);
    cursor: pointer;
    overflow: hidden;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
  }
  .rating-star {
    display: inline-flex;
    min-height: calc(var(--spacing) * 6);
    min-width: calc(var(--spacing) * 6);
    cursor: pointer;
    align-items: center;
    justify-content: center;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
  }
  .rating-star svg {
    pointer-events: none;
  }
  .rating-half svg {
    pointer-events: none;
    position: absolute;
    top: 0px;
    width: calc(var(--spacing) * 5);
    height: calc(var(--spacing) * 5);
  }
  .rating-half-left svg {
    left: 0px;
  }
  .rating-half-right svg {
    left: calc(var(--spacing) * -2.5);
  }
  .rating-stars.is-static .rating-half {
    height: calc(var(--spacing) * 4);
    width: calc(var(--spacing) * 2);
    cursor: default;
  }
  .rating-stars.is-static .rating-half svg {
    width: calc(var(--spacing) * 4);
    height: calc(var(--spacing) * 4);
  }
  .rating-stars.is-static .rating-half-right svg {
    left: calc(var(--spacing) * -2);
  }
  .rating-half-on {
    display: none;
    color: var(--color-star);
  }
  .rating-half-off {
    color: var(--color-muted);
  }
  .rating-half.is-on .rating-half-off {
    display: none;
  }
  .rating-half.is-on .rating-half-on {
    display: block;
  }
  .rating-half:focus-visible, .rating-star:focus-visible {
    outline: 2px solid var(--color-star);
    outline-offset: 1px;
  }
  .rating-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: calc(var(--spacing) * 2);
  }
  .rating-label {
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .rating-count {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .tag-menu-panel {
    width: 240px;
    padding: calc(var(--spacing) * 3);
  }
  .tag-menu {
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .tag-menu-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: calc(var(--spacing) * 1.5);
  }
  .tag-menu-title {
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .tag-menu-ns {
    font-size: var(--text-micro);
    color: var(--color-muted);
    text-transform: lowercase;
  }
  .tag-menu-divider {
    margin: 0px;
    border-style: var(--tw-border-style);
    border-width: 0px;
    border-top-style: var(--tw-border-style);
    border-top-width: 1px;
    border-color: var(--color-line);
  }
  .tag-menu-actions {
    display: grid;
    gap: calc(var(--spacing) * 0.5);
  }
  .tag-menu-item svg {
    width: calc(var(--spacing) * 3);
    height: calc(var(--spacing) * 3);
    flex-shrink: 0;
    color: var(--color-muted);
  }
  .tag-menu-new {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .tag-menu-new .field-input {
    min-width: 0px;
    flex: 1;
    padding-inline: calc(var(--spacing) * 2);
    padding-block: var(--spacing);
    font-size: var(--text-control);
  }
  .tag-menu-item:disabled {
    cursor: not-allowed;
    opacity: 40%;
  }
  .tag-title {
    font-size: var(--text-section);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .tag-row {
    display: grid;
    grid-template-columns: 4.75rem minmax(0,1fr);
    align-items: flex-start;
    column-gap: calc(var(--spacing) * 2);
    row-gap: calc(var(--spacing) * 2);
  }
  .tag-name {
    font-size: var(--text-control);
  }
  .tag-note {
    margin-left: var(--spacing);
    font-size: var(--text-micro);
    color: var(--color-muted);
  }
  .tag-add-row .tag-add {
    margin-top: 0px;
  }
  .gallery-comments {
    margin-top: calc(var(--spacing) * 2);
    display: grid;
    gap: calc(var(--spacing) * 3);
    border-top-style: var(--tw-border-style);
    border-top-width: 1px;
    border-color: var(--color-line);
    padding-top: calc(var(--spacing) * 5);
    padding-bottom: calc(var(--spacing) * 10);
  }
  .comments-title {
    font-size: var(--text-section);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-fg);
  }
  .comment-list {
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .comment {
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-surface);
    padding: calc(var(--spacing) * 3);
  }
  .comment.is-uploader {
    border-color: var(--color-accent);
    background-color: var(--color-panel);
  }
  .comment-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 2);
    row-gap: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .comment-author {
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
  }
  .comment-badge {
    border-radius: 0;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-accent);
    padding-inline: calc(var(--spacing) * 1.5);
    padding-block: 1px;
    font-size: var(--text-micro);
    color: var(--color-star);
  }
  .comment-posted {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .comment-score-wrap {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--spacing);
  }
  .comment-score {
    min-width: calc(var(--spacing) * 6);
    text-align: right;
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-muted);
  }
  .comment-vote {
    display: inline-grid;
    min-height: calc(var(--spacing) * 6);
    min-width: calc(var(--spacing) * 6);
    padding-inline: calc(var(--spacing) * 1.5);
    padding-block: calc(var(--spacing) * 0.5);
    font-size: var(--text-meta);
    --tw-leading: 1;
    line-height: 1;
    color: var(--color-muted);
  }
  .comment.is-busy .comment-vote {
    cursor: progress;
    opacity: 60%;
  }
  .comment-retry {
    cursor: pointer;
    border-style: var(--tw-border-style);
    border-width: 0px;
    background-color: transparent;
    padding: 0px;
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-semibold);
    font-weight: var(--font-weight-semibold);
    color: var(--color-link);
    text-decoration-line: underline;
  }
  .comment-vote:hover, .comment-vote:focus-visible, .comment-vote[aria-pressed="true"] {
    color: var(--color-star);
    border-color: var(--color-accent);
  }
  .comment-vote-down:hover, .comment-vote-down:focus-visible, .comment-vote-down[aria-pressed="true"] {
    border-color: var(--color-danger-line);
    color: var(--color-danger-text);
  }
  .comment-body {
    margin-top: calc(var(--spacing) * 2);
    font-size: var(--text-body);
    white-space: pre-line;
    color: var(--color-fg);
  }
  .comment-votes {
    margin-top: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .comment-composer {
    margin-top: var(--spacing);
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .comment-input {
    min-height: calc(var(--spacing) * 20);
    width: 100%;
    resize: vertical;
    font-size: var(--text-body);
    height: auto;
  }
  .comment-compose-actions {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  .comment-status {
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .gallery-resume-group {
    display: inline-flex;
    min-width: 0px;
    align-items: stretch;
  }
  .gallery-resume-clear {
    margin-left: -1px;
    width: calc(var(--spacing) * 8);
    background-color: transparent;
    font-size: var(--text-control);
    --tw-leading: 1;
    line-height: 1;
    color: var(--color-muted);
  }
  .comment-edit-form {
    margin-top: var(--spacing);
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .comment-edit-form .comment-input {
    width: 100%;
  }
  .tag-menu-color {
    height: calc(var(--spacing) * 7);
    width: calc(var(--spacing) * 10);
    cursor: pointer;
    border-style: var(--tw-border-style);
    border-width: 1px;
    border-color: var(--color-line);
    background-color: var(--color-canvas);
    padding: calc(var(--spacing) * 0.5);
    border-radius: var(--radius-control);
  }
}
:root {
  --scrim-control: rgb(0 0 0 / 0.7);
  --scrim-control-hover: rgb(0 0 0 / 0.85);
  --scrim-line: rgb(255 255 255 / 0.18);
  --scrim-line-hover: rgb(255 255 255 / 0.5);
  --text-scrim: 0 1px 3px rgb(0 0 0 / 0.9);
  --scroll-fade: linear-gradient(90deg, #000 calc(100% - 18px), transparent);
  --scroll-fade-both: linear-gradient(
    90deg,
    transparent,
    #000 18px,
    #000 calc(100% - 18px),
    transparent
  );
  --scroll-fade-left: linear-gradient(90deg, transparent, #000 18px);
}
@property --tw-rotate-x {
  syntax: "*";
  inherits: false;
}
@property --tw-rotate-y {
  syntax: "*";
  inherits: false;
}
@property --tw-rotate-z {
  syntax: "*";
  inherits: false;
}
@property --tw-skew-x {
  syntax: "*";
  inherits: false;
}
@property --tw-skew-y {
  syntax: "*";
  inherits: false;
}
@property --tw-outline-style {
  syntax: "*";
  inherits: false;
  initial-value: solid;
}
@property --tw-blur {
  syntax: "*";
  inherits: false;
}
@property --tw-brightness {
  syntax: "*";
  inherits: false;
}
@property --tw-contrast {
  syntax: "*";
  inherits: false;
}
@property --tw-grayscale {
  syntax: "*";
  inherits: false;
}
@property --tw-hue-rotate {
  syntax: "*";
  inherits: false;
}
@property --tw-invert {
  syntax: "*";
  inherits: false;
}
@property --tw-opacity {
  syntax: "*";
  inherits: false;
}
@property --tw-saturate {
  syntax: "*";
  inherits: false;
}
@property --tw-sepia {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-drop-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-drop-shadow-size {
  syntax: "*";
  inherits: false;
}
@property --tw-border-style {
  syntax: "*";
  inherits: false;
  initial-value: solid;
}
@property --tw-font-weight {
  syntax: "*";
  inherits: false;
}
@property --tw-tracking {
  syntax: "*";
  inherits: false;
}
@property --tw-duration {
  syntax: "*";
  inherits: false;
}
@property --tw-translate-x {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-translate-y {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-translate-z {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
@property --tw-backdrop-blur {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-brightness {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-contrast {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-grayscale {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-hue-rotate {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-invert {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-opacity {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-saturate {
  syntax: "*";
  inherits: false;
}
@property --tw-backdrop-sepia {
  syntax: "*";
  inherits: false;
}
@property --tw-leading {
  syntax: "*";
  inherits: false;
}
@property --tw-gradient-position {
  syntax: "*";
  inherits: false;
}
@property --tw-gradient-from {
  syntax: "<color>";
  inherits: false;
  initial-value: #0000;
}
@property --tw-gradient-via {
  syntax: "<color>";
  inherits: false;
  initial-value: #0000;
}
@property --tw-gradient-to {
  syntax: "<color>";
  inherits: false;
  initial-value: #0000;
}
@property --tw-gradient-stops {
  syntax: "*";
  inherits: false;
}
@property --tw-gradient-via-stops {
  syntax: "*";
  inherits: false;
}
@property --tw-gradient-from-position {
  syntax: "<length-percentage>";
  inherits: false;
  initial-value: 0%;
}
@property --tw-gradient-via-position {
  syntax: "<length-percentage>";
  inherits: false;
  initial-value: 50%;
}
@property --tw-gradient-to-position {
  syntax: "<length-percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-content {
  syntax: "*";
  inherits: false;
  initial-value: "";
}
@property --tw-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-inset-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-inset-shadow-color {
  syntax: "*";
  inherits: false;
}
@property --tw-inset-shadow-alpha {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 100%;
}
@property --tw-ring-color {
  syntax: "*";
  inherits: false;
}
@property --tw-ring-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-inset-ring-color {
  syntax: "*";
  inherits: false;
}
@property --tw-inset-ring-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-ring-inset {
  syntax: "*";
  inherits: false;
}
@property --tw-ring-offset-width {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}
@property --tw-ring-offset-color {
  syntax: "*";
  inherits: false;
  initial-value: #fff;
}
@property --tw-ring-offset-shadow {
  syntax: "*";
  inherits: false;
  initial-value: 0 0 #0000;
}
@property --tw-ordinal {
  syntax: "*";
  inherits: false;
}
@property --tw-slashed-zero {
  syntax: "*";
  inherits: false;
}
@property --tw-numeric-figure {
  syntax: "*";
  inherits: false;
}
@property --tw-numeric-spacing {
  syntax: "*";
  inherits: false;
}
@property --tw-numeric-fraction {
  syntax: "*";
  inherits: false;
}
@layer properties {
  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {
    *, ::before, ::after, ::backdrop {
      --tw-rotate-x: initial;
      --tw-rotate-y: initial;
      --tw-rotate-z: initial;
      --tw-skew-x: initial;
      --tw-skew-y: initial;
      --tw-outline-style: solid;
      --tw-blur: initial;
      --tw-brightness: initial;
      --tw-contrast: initial;
      --tw-grayscale: initial;
      --tw-hue-rotate: initial;
      --tw-invert: initial;
      --tw-opacity: initial;
      --tw-saturate: initial;
      --tw-sepia: initial;
      --tw-drop-shadow: initial;
      --tw-drop-shadow-color: initial;
      --tw-drop-shadow-alpha: 100%;
      --tw-drop-shadow-size: initial;
      --tw-border-style: solid;
      --tw-font-weight: initial;
      --tw-tracking: initial;
      --tw-duration: initial;
      --tw-translate-x: 0;
      --tw-translate-y: 0;
      --tw-translate-z: 0;
      --tw-backdrop-blur: initial;
      --tw-backdrop-brightness: initial;
      --tw-backdrop-contrast: initial;
      --tw-backdrop-grayscale: initial;
      --tw-backdrop-hue-rotate: initial;
      --tw-backdrop-invert: initial;
      --tw-backdrop-opacity: initial;
      --tw-backdrop-saturate: initial;
      --tw-backdrop-sepia: initial;
      --tw-leading: initial;
      --tw-gradient-position: initial;
      --tw-gradient-from: #0000;
      --tw-gradient-via: #0000;
      --tw-gradient-to: #0000;
      --tw-gradient-stops: initial;
      --tw-gradient-via-stops: initial;
      --tw-gradient-from-position: 0%;
      --tw-gradient-via-position: 50%;
      --tw-gradient-to-position: 100%;
      --tw-content: "";
      --tw-shadow: 0 0 #0000;
      --tw-shadow-color: initial;
      --tw-shadow-alpha: 100%;
      --tw-inset-shadow: 0 0 #0000;
      --tw-inset-shadow-color: initial;
      --tw-inset-shadow-alpha: 100%;
      --tw-ring-color: initial;
      --tw-ring-shadow: 0 0 #0000;
      --tw-inset-ring-color: initial;
      --tw-inset-ring-shadow: 0 0 #0000;
      --tw-ring-inset: initial;
      --tw-ring-offset-width: 0px;
      --tw-ring-offset-color: #fff;
      --tw-ring-offset-shadow: 0 0 #0000;
      --tw-ordinal: initial;
      --tw-slashed-zero: initial;
      --tw-numeric-figure: initial;
      --tw-numeric-spacing: initial;
      --tw-numeric-fraction: initial;
    }
  }
}
`;

  // src/style.css
  var style_default = `body.no-cursor,
body.no-cursor * {
  cursor: none !important;
}

body.fit-h {
  overflow: hidden;
}
body.fit-h #reader {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* The fixed viewport owns pinch-to-zoom; continuous mode keeps native vertical scrolling. */
body.fit-h:not(.reader-continuous) #reader {
  touch-action: none;
}
body.fit-h #img-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}
body.fit-h #main-img {
  max-height: 100vh;
  max-width: 100vw;
  width: auto;
  height: 100vh;
  object-fit: contain;
}

body.fit-w {
  overflow-y: auto;
  overflow-x: hidden;
}
body.fit-w #reader {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}
body.fit-w #img-wrap {
  display: block;
}
body.fit-w #main-img,
.reader-page-img {
  display: block;
  max-width: 100vw;
  height: auto;
}

#reader {
  cursor: pointer;
}

#main-img,
#spread-img,
.reader-page-img {
  user-select: none;
  -webkit-user-drag: none;
  transition: transform 0.1s ease-out;
}
#main-img.no-transition {
  transition: none !important;
}

/* ------------------------------------------------------------------- HUD
 *
 * Every overlay follows the pointer's idle state (\`body.no-cursor\`), not \`:hover\`: \`:hover\` leaves
 * them invisible on touch and for keyboard-only readers, and an invisible overlay would still
 * swallow the clicks meant to turn the page.
 */

#hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-start;
  padding: 6px 10px;
  background: linear-gradient(to bottom, var(--scrim-control) 0%, transparent 100%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.2s,
    visibility 0.2s;
  z-index: 10;
}

/* A hit area big enough for touch, drawn with the same icon set as the rest of the app. */
#hud-gallery {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-control);
  color: var(--color-fg);
  text-decoration: none;
  background: var(--scrim-control);
  border: 1px solid var(--scrim-line);
  backdrop-filter: blur(4px);
  pointer-events: none;
}
#hud-gallery svg {
  width: 22px;
  height: 22px;
}
#hud-gallery:hover,
#hud-gallery:focus-visible {
  background: var(--scrim-control-hover);
  border-color: var(--scrim-line-hover);
}
.hud-spacer {
  flex: 1;
}
#hud-title {
  margin: 0;
  padding-top: 4px;
  font-size: var(--text-meta);
  font-weight: inherit;
  color: var(--color-muted);
  text-align: right;
  text-shadow: var(--text-scrim);
  line-height: 1.35;
}
body.eh-viewer .title-main {
  margin: 2px 0;
}
body.eh-viewer .title-primary {
  font-size: var(--text-section);
  color: var(--color-fg);
  font-weight: 600;
}
body.eh-viewer .title-secondary {
  font-size: var(--text-body);
  color: var(--color-muted);
  font-weight: 400;
}
body.eh-viewer .title-sep {
  color: color-mix(in srgb, var(--color-fg) 40%, transparent);
  margin: 0 2px;
  white-space: nowrap;
}
body.eh-viewer .meta-item {
  display: inline-block;
  margin-left: 4px;
}

/* --------------------------------------------------------------- page nav */

#page-nav {
  position: fixed;
  top: 50%;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  padding: 0 10px;
  transform: translateY(-50%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.2s,
    visibility 0.2s;
  z-index: 10;
}
/* The scrim carries the contrast: a translucent pill over bright artwork used to swallow the
   arrow, which is now the only thing inside it. */
.page-nav-group {
  display: flex;
  gap: 8px;
}
#page-nav button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 76px;
  border: 1px solid var(--scrim-line);
  border-radius: var(--radius-chip);
  background: var(--scrim-control);
  color: var(--color-fg);
  cursor: pointer;
  pointer-events: none;
  backdrop-filter: blur(4px);
}
#page-nav button svg {
  width: 24px;
  height: 24px;
}
#page-nav button:hover,
#page-nav button:focus-visible {
  border-color: var(--scrim-line-hover);
  background: var(--scrim-control-hover);
}
#page-nav button:disabled {
  opacity: 0.4;
  cursor: default;
}

body:not(.no-cursor) #hud,
body:not(.no-cursor) #page-info,
body:not(.no-cursor) #page-nav,
body.hud-pinned #hud,
body.hud-pinned #page-info,
body.hud-pinned #page-nav {
  opacity: 1;
  /* Visibility also decides whether a hidden control can take keyboard focus. */
  visibility: visible;
}
body:not(.no-cursor) #hud-gallery,
body:not(.no-cursor) #page-nav button,
body.hud-pinned #hud-gallery,
body.hud-pinned #page-nav button {
  pointer-events: auto;
}

/* Touch has no idle pointer: keep the chrome and its hit areas available. */
@media (hover: none) {
  #hud,
  #page-info,
  #page-nav {
    opacity: 1;
    visibility: visible;
  }
  #hud-gallery,
  #page-nav button {
    pointer-events: auto;
  }
}

/* --------------------------------------------------------------- status */

#page-info {
  position: fixed;
  bottom: 12px;
  right: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}

#hud-counter {
  font-size: var(--text-section);
  color: var(--color-fg);
  font-weight: 500;
  letter-spacing: 0.02em;
  text-shadow: var(--text-scrim);
}

#file-info {
  font-size: var(--text-meta);
  color: color-mix(in srgb, var(--color-fg) 60%, transparent);
  white-space: nowrap;
  text-shadow: var(--text-scrim);
}

#page-links {
  display: flex;
  gap: 10px;
  font-size: var(--text-meta);
}
#page-links a {
  color: color-mix(in srgb, var(--color-fg) 70%, transparent);
  text-decoration: none;
  pointer-events: auto;
  text-shadow: var(--text-scrim);
}
#page-links a:hover {
  color: var(--color-fg);
  text-decoration: underline;
}
#page-links a[hidden] {
  display: none;
}

/* Toasts live outside \`#page-info\`: a failed image must report itself while the HUD is hidden. */
#hud-toast {
  position: fixed;
  right: 14px;
  /* Clear of the page counter, which owns the bottom-right corner. */
  bottom: 62px;
  max-width: min(420px, calc(100vw - 28px));
  font-size: var(--text-control);
  color: var(--color-star);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: right;
  text-shadow: var(--text-scrim);
  pointer-events: none;
  opacity: 0;
  transform: translateY(5px);
  transition:
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
  z-index: 12;
}
#hud-toast.show {
  opacity: 1;
  transform: translateY(0);
}

/* ----------------------------------------------------------- image error */

#img-error {
  position: fixed;
  top: 50%;
  left: 50%;
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 18px 22px;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-card);
  background: var(--color-panel);
  color: var(--color-fg);
  text-align: center;
  box-shadow: var(--shadow-float);
  transform: translate(-50%, -50%);
  z-index: 11;
}
#img-error p {
  margin: 0;
  font-size: var(--text-body);
}
.img-error-retry {
  height: var(--control-h);
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-control);
  background: var(--color-panel);
  color: var(--color-fg);
  font-size: var(--text-control);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s;
}
.img-error-retry:hover {
  border-color: var(--color-accent);
}

/* ---------------------------------------------------------- shortcut help */

#hud-help {
  position: fixed;
  left: 14px;
  bottom: 14px;
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  max-width: min(420px, calc(100vw - 28px));
  max-height: calc(100vh - 28px);
  overflow-y: auto;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-card);
  background: var(--color-panel);
  box-shadow: var(--shadow-float);
  color: var(--color-muted);
  font-size: var(--text-control);
  z-index: 13;
}
#hud-help-title {
  margin: 0 0 2px;
  font-size: var(--text-meta);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
#hud-help dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
}
#hud-help dt {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-self: start;
}
#hud-help dd {
  margin: 0;
  align-self: center;
  color: var(--color-fg);
}

/* ----------------------------------------------------------- reader modes */

#img-wrap[hidden],
#continuous[hidden],
#spread-img[hidden] {
  display: none !important;
}

#img-wrap {
  transition: transform 0.1s ease-out;
}

#img-wrap.no-transition,
#spread-img.no-transition,
.reader-page-img.no-transition {
  transition: none !important;
}

/* Spread: the current page and its neighbour share the viewport. RTL puts the current page on
   the right by reversing the flex order. */
body.reader-spread #img-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100vw;
  max-height: 100vh;
}

body.reader-spread.reader-rtl #img-wrap {
  direction: rtl;
}

body.reader-spread #main-img,
body.reader-spread #spread-img {
  max-width: 50vw;
}

/* An unpaired page has no second half to reserve, so let it use the full frame. The class is set
   only when the next page is absent or its companion failed, not while the companion is loading. */
body.reader-spread #img-wrap.is-single #main-img {
  max-width: 100vw;
}

body.fit-h.reader-spread #main-img,
body.fit-h.reader-spread #spread-img {
  width: auto;
  height: 100vh;
  max-height: 100vh;
  object-fit: contain;
}

body.fit-w.reader-spread #main-img,
body.fit-w.reader-spread #spread-img {
  display: block;
  height: auto;
  object-fit: contain;
}

/* A facing pair is unreadable on a phone-width viewport; keep the current page at full size. */
@media (max-width: 720px) {
  body.reader-spread #spread-img {
    display: none !important;
  }

  body.reader-spread #main-img,
  body.fit-h.reader-spread #main-img {
    max-width: 100vw;
  }

  body.fit-w.reader-spread #main-img {
    max-width: 100vw;
  }
}

/* Continuous: a vertical stack that grows as the reader approaches the end. */
#continuous {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--reader-gap, 12px);
  width: 100%;
}

.reader-page {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
}

.reader-page.is-failed .reader-page-img {
  visibility: hidden;
  min-height: 240px;
}

.reader-page.is-failed::after {
  content: "This page could not be loaded.";
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--color-muted);
  font-size: var(--text-body);
}

.reader-sentinel {
  width: 1px;
  height: 1px;
}

body.reader-continuous #reader {
  display: block;
  min-height: 100vh;
  height: auto;
  overflow: visible;
  padding-bottom: 40vh;
}

body.fit-h.reader-continuous {
  overflow-y: auto;
}

body.fit-h.reader-continuous #reader {
  height: auto;
  overflow: visible;
}

/* ---------------------------------------------------------- forced colors */

@media (forced-colors: active) {
  #hud-gallery,
  #page-nav button,
  #hud-help,
  #img-error,
  .img-error-retry {
    border: 1px solid CanvasText;
    background: Canvas;
    color: CanvasText;
  }

  /* Keep the artwork itself out of the forced palette; the interface around it still adapts. */
  #main-img,
  #spread-img,
  .reader-page-img {
    forced-color-adjust: none;
  }

  /* Windows High Contrast users still need a pointer; an invisible cursor is an accessibility bug. */
  body.no-cursor,
  body.no-cursor * {
    cursor: auto !important;
  }

  :focus-visible {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
`;

  // src/ui/styles.ts
  var injected = false;
  function injectStyles() {
    if (injected) {
      return;
    }
    injected = true;
    GM_addStyle(style_default + app_default);
  }

  // src/view-lifecycle.ts
  function createViewLifecycle(deps) {
    let controller = null;
    let stickyDispose = null;
    let restoreStop = null;
    let leaveGuard = null;
    let current = null;
    const schedule = deps.scheduleScroll ?? ((fn) => {
      requestAnimationFrame(fn);
    });
    return {
      mount(request) {
        restoreStop?.();
        restoreStop = null;
        const host = deps.host();
        if (host === null) {
          return null;
        }
        deps.closePanels();
        controller?.abort();
        controller = new AbortController;
        current = request.route;
        leaveGuard = null;
        deps.resetViewMode();
        stickyDispose?.();
        stickyDispose = null;
        host.replaceChildren();
        request.render(host, controller.signal);
        document.title = request.title;
        stickyDispose = deps.trackSticky(host);
        if (request.focus === true) {
          host.focus({ preventScroll: true });
        }
        if (typeof request.scrollY === "number") {
          const y = request.scrollY;
          if (y > 0 && deps.restoreScroll) {
            restoreStop = deps.restoreScroll(y);
          } else {
            schedule(() => {
              deps.scrollTo(y);
            });
          }
        } else if (request.scrollY === null) {
          deps.scrollTo(0);
        }
        return controller.signal;
      },
      currentRoute() {
        return current;
      },
      setLeaveGuard(guard) {
        leaveGuard = guard;
      },
      guard() {
        return leaveGuard === null || leaveGuard();
      }
    };
  }

  // src/app.ts
  var viewHost = null;
  var navController = null;
  var navId = 0;
  var hiding = true;
  var stopScrollRestore = null;
  function restoreScroll(y) {
    stopScrollRestore?.();
    const restore = restoreScrollWhenReady(y);
    const controller = new AbortController;
    const stop = () => {
      controller.abort();
      restore();
    };
    const options = { once: true, passive: true, signal: controller.signal };
    window.addEventListener("wheel", stop, options);
    window.addEventListener("touchstart", stop, options);
    window.addEventListener("pointerdown", stop, options);
    window.addEventListener("keydown", stop, options);
    stopScrollRestore = stop;
    return stop;
  }
  var lifecycle = createViewLifecycle({
    host: () => viewHost,
    closePanels: closeFavoriteMenu,
    resetViewMode,
    trackSticky: trackStickyChrome,
    scrollTo: (y) => {
      window.scrollTo(0, y);
    },
    restoreScroll
  });
  function hideDocument() {
    const apply = () => {
      if (!hiding) {
        return;
      }
      const root = document.documentElement;
      if (!root) {
        setTimeout(apply, 0);
        return;
      }
      root.style.setProperty("visibility", "hidden", "important");
      root.style.setProperty("background", "#34353b", "important");
    };
    apply();
  }
  function revealDocument() {
    hiding = false;
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.style.removeProperty("visibility");
    root.style.removeProperty("background");
  }
  function ensureShell() {
    if (viewHost) {
      return;
    }
    for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      node.remove();
    }
    if (!document.querySelector('meta[name="viewport"]')) {
      document.head.append(el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }));
    }
    document.body.replaceChildren();
    document.body.className = "eh-body";
    document.body.removeAttribute("style");
    viewHost = el("main", { id: "eh-view", tabindex: "-1" });
    const root = el("div", { id: "eh-root" }, viewHost);
    const skip = el("a", { class: "eh-skip", href: "#eh-view" }, "Skip to content");
    skip.addEventListener("click", (event) => {
      event.preventDefault();
      viewHost?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
    document.body.append(skip, root, el("div", { id: "eh-loading", class: "eh-loading", "aria-hidden": "true" }));
    startLinkInterception(navigate);
    window.addEventListener("popstate", onPopState);
    registerMenuCommands();
    injectStyles();
  }
  function setLoading(active) {
    document.body.classList.toggle("is-loading", active);
    if (active) {
      viewHost?.setAttribute("aria-busy", "true");
    } else {
      viewHost?.removeAttribute("aria-busy");
    }
  }
  function viewContext(route, signal) {
    return {
      signal,
      navigate,
      reload: () => {
        transition(route, window.scrollY, { fresh: true });
      },
      setLeaveGuard: (guard) => {
        lifecycle.setLeaveGuard(guard);
      }
    };
  }
  function present2(route, view, data, scrollY, focus = false) {
    lifecycle.mount({
      route,
      title: view.title(data),
      scrollY,
      focus,
      render: (host, signal) => {
        view.render(host, data, viewContext(route, signal));
      }
    });
  }
  function errorView(error, route) {
    if (!viewHost) {
      return;
    }
    let title = "Something went wrong";
    let message;
    let detail;
    if (error instanceof RateLimitedError) {
      title = "Rate limited";
      message = "The site is throttling requests from this connection. Wait a moment, then retry.";
      showBanner(error.text);
    } else if (error instanceof RequestPurgedError) {
      title = "Requests paused";
      message = "The site is throttling requests from this connection, so this page was not loaded. " + "Wait a moment, then retry.";
    } else if (error instanceof LoginRequiredError) {
      title = "Sign in required";
      message = `This page is not available to guests. Sign in to ${siteLabel()} and try again.`;
    } else if (error instanceof HttpError && error.status === 404) {
      title = "Page not found";
      message = "The site does not serve this page. It may have moved, or the link may be wrong.";
    } else if (error instanceof HttpError) {
      message = `The site answered with an error (HTTP ${error.status}).`;
    } else if (!navigator.onLine) {
      title = "You appear to be offline";
      message = "Check your connection, then retry.";
    } else {
      console.error(LOG_TAG, "unhandled route error", error);
      message = "The page could not be loaded. Retry, or open the site's own version below.";
      detail = "If this keeps happening, the site layout may have changed.";
    }
    const native = nativeUrl(route.url);
    const pageTitle = documentTitle(title);
    if (error instanceof LoginRequiredError) {
      lifecycle.mount({
        route,
        title: pageTitle,
        focus: true,
        render: (host, signal) => {
          host.append(siteNav(signal), loginGate({ title, message, nativeHref: native }));
        }
      });
      return;
    }
    lifecycle.mount({
      route,
      title: pageTitle,
      focus: true,
      render: (host, signal) => {
        host.append(siteNav(signal), statePanel({
          tone: "error",
          headingLevel: 1,
          title,
          text: message,
          detail,
          actions: [
            {
              label: "Retry",
              primary: true,
              onClick: () => {
                transition(parseRoute(location.href), null);
              }
            },
            nativePageAction(native)
          ]
        }));
      }
    });
  }
  function saveScroll() {
    const state = history.state ?? {};
    history.replaceState({ ...state, eh: true, scrollY: window.scrollY }, "", location.href);
  }
  async function transition(route, scrollY, options = {}) {
    const id = ++navId;
    navController?.abort();
    navController = new AbortController;
    setLoading(true);
    try {
      const view = routeView(route);
      const data = await view.load(route, navController.signal, options);
      if (id !== navId) {
        return;
      }
      present2(route, view, data, scrollY, true);
    } catch (error) {
      if (id !== navId || isAbortError(error)) {
        return;
      }
      console.error(LOG_TAG, "navigation failed", error);
      errorView(error, route);
    } finally {
      if (id === navId) {
        setLoading(false);
      }
    }
  }
  function navigate(url, options = {}) {
    let route = parseRoute(url);
    if (!lifecycle.guard()) {
      return;
    }
    if (route.kind === "native") {
      location.href = url;
      return;
    }
    route = applyPersistedListFilters(route);
    saveScroll();
    const fromGallery = route.kind === "viewer" && lifecycle.currentRoute()?.kind === "gallery";
    const previous = history.state ?? {};
    const state = {
      eh: true,
      scrollY: 0,
      fromGallery: options.replace ? previous.fromGallery === true : fromGallery
    };
    if (options.replace) {
      history.replaceState(state, "", route.url);
    } else {
      history.pushState(state, "", route.url);
    }
    transition(route, null);
  }
  function isFragmentOnlyChange(current, next) {
    if (current === "") {
      return false;
    }
    try {
      const from = new URL(current);
      const to = new URL(next);
      return from.origin === to.origin && from.pathname === to.pathname && from.search === to.search && from.hash !== to.hash;
    } catch {
      return false;
    }
  }
  function onPopState(event) {
    const currentUrl = lifecycle.currentRoute()?.url ?? "";
    let route = parseRoute(location.href);
    if (route.kind === "native") {
      if (!lifecycle.guard()) {
        history.pushState(event.state, "", currentUrl);
        return;
      }
      location.reload();
      return;
    }
    if (isFragmentOnlyChange(currentUrl, location.href)) {
      return;
    }
    if (!lifecycle.guard()) {
      history.pushState(event.state, "", currentUrl);
      return;
    }
    route = applyPersistedListFilters(route);
    if (route.url !== location.href) {
      history.replaceState(event.state, "", route.url);
    }
    const state = event.state;
    transition(route, state?.scrollY ?? 0);
  }
  function startOwned(initialRoute) {
    const view = routeView(initialRoute);
    if (isLoginPage(document)) {
      throw new LoginRequiredError;
    }
    if (isNotFoundPage(document)) {
      ensureShell();
      errorView(new HttpError(404, location.href), initialRoute);
      revealDocument();
      return;
    }
    const initial = view.parse(document, initialRoute);
    ensureShell();
    history.replaceState({ eh: true, scrollY: 0 }, "", location.href);
    try {
      present2(initialRoute, view, initial, 0, false);
    } catch (error) {
      console.error(LOG_TAG, "initial render failed", error);
      errorView(error, initialRoute);
    }
    revealDocument();
    log("ready", getSettings().fitHeight ? "fit-height" : "natural-width");
  }
  function boot() {
    let route = parseRoute(location.href);
    if (route.kind === "native") {
      return;
    }
    blockSiteAds();
    hideDocument();
    const effective = applyPersistedListFilters(route);
    if (effective !== route) {
      location.replace(effective.url);
      return;
    }
    route = effective;
    const start = () => {
      try {
        startOwned(route);
      } catch (error) {
        console.error(LOG_TAG, "startup failed", error);
        if (error instanceof LoginRequiredError) {
          ensureShell();
          errorView(error, route);
        }
        revealDocument();
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }

  // src/main.ts
  boot();
})();
