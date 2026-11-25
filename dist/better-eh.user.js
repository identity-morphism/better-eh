// ==UserScript==
// @name         Better EH
// @namespace    https://github.com/identity-morphism/better-eh
// @version      1.1.0
// @description  A userscript that reskins E-Hentai and ExHentai into one consistent, image-first interface: galleries, listings, favorites, toplists, torrents and the reader, with tag autocomplete and prefetching.
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

  class ParseMismatchError extends Error {
    route;
    constructor(route, detail) {
      super(`${route}: ${detail}`);
      this.name = "ParseMismatchError";
      this.route = route;
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

  // src/emitter.ts
  function createEmitter() {
    const listeners = new Set;
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      emit(value) {
        for (const listener of listeners) {
          listener(value);
        }
      }
    };
  }

  // src/guards.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isUnknownArray(value) {
    return Array.isArray(value);
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

  // src/settings.ts
  var STORAGE_KEY = "eh:settings:v2";
  var VERSION = 2;
  var settingsChanged = createEmitter();
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
  function settingsOptions() {
    return {
      key: STORAGE_KEY,
      version: VERSION,
      empty: () => ({}),
      guard: isStoredValues
    };
  }
  function applyStoredScalars(target, values) {
    for (const key of SCALAR_KEYS) {
      applyScalar(target, key, values[key]);
    }
  }
  function loadSettings(read = readStoredSetting) {
    const values = createStore(settingsOptions(), {
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
  var store = createStore(settingsOptions(), gm);
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
    settingsChanged.emit(current);
  }
  function updateSetting(key, value) {
    updateSettings({ [key]: value });
  }
  function onSettingsChange(listener) {
    return settingsChanged.subscribe(listener);
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
  function buttonEl(props = {}, ...children) {
    return el("button", { type: "button", ...props }, ...children);
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
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"
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

  // src/strings.ts
  var ALREADY_COLLAPSED = /^\S(?: \S)*$/u;
  function collapseWhitespace(value) {
    if (ALREADY_COLLAPSED.test(value)) {
      return value;
    }
    return value.replace(/\s+/gu, " ").trim();
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
    if (isLoginWall(await response.clone().text())) {
      throw new LoginRequiredError;
    }
    return response;
  }
  function isLoginWall(body) {
    return /<input[^>]+type=["']?password/i.test(body);
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
  var PAGE_CONTENT_SELECTOR = "#gn, #gdt, #gdd, #i1, #i2, #i3, #profile_form, #usertags_outer, #torrentinfo, .itg";
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
    return collapseWhitespace(text.replace(SITE_SUFFIX, "")).toLowerCase();
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

  // src/data/list-date.ts
  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var POSTED_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})(?=\s|$)/;
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isValidDate(value) {
    const match = ISO_DATE.exec(value.trim());
    if (!match?.[1] || !match[2] || !match[3]) {
      return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) {
      return false;
    }
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lastDay = month === 2 && leapYear ? 29 : MONTH_DAYS[month - 1] ?? 0;
    return day <= lastDay;
  }
  function isDateRangeActive(range) {
    return isValidDate(range.since) || isValidDate(range.until);
  }
  function postedDate(posted) {
    const match = POSTED_DATE.exec(posted);
    if (!match?.[1] || !match[2] || !match[3]) {
      return null;
    }
    const day = `${match[1]}-${match[2]}-${match[3]}`;
    return isValidDate(day) ? day : null;
  }
  function filterByDateRange(items, range) {
    const since = isValidDate(range.since) ? range.since.trim() : null;
    const until = isValidDate(range.until) ? range.until.trim() : null;
    if (since === null && until === null) {
      return { items: [...items], crossedSince: false };
    }
    const kept = [];
    let crossedSince = false;
    for (const item of items) {
      const day = postedDate(item.posted);
      if (day === null) {
        continue;
      }
      if (since !== null && day < since) {
        crossedSince = true;
        continue;
      }
      if (until !== null && day > until) {
        continue;
      }
      kept.push(item);
    }
    return { items: kept, crossedSince };
  }
  function withDateRange(url, range) {
    const target = new URL(url);
    setDateParam(target.searchParams, "eh_since", range.since);
    setDateParam(target.searchParams, "eh_until", range.until);
    return target.href;
  }
  function setDateParam(params, key, value) {
    const date = value.trim();
    if (isValidDate(date)) {
      params.set(key, date);
    } else {
      params.delete(key);
    }
  }
  function listRequestUrl(url) {
    const target = new URL(url);
    if (target.searchParams.has("seek")) {
      return url;
    }
    const until = (target.searchParams.get("eh_until") ?? "").trim();
    if (!isValidDate(until)) {
      return url;
    }
    target.searchParams.set("seek", until);
    return target.href;
  }

  // src/tags/model.ts
  var TAG_SIGNS = Object.freeze(["", "-", "~"]);
  var SIGN_PRESENTATION = Object.freeze({
    "": {
      glyph: "+",
      state: "included",
      chipClass: "term-chip",
      action: "Include in search",
      searchState: "in the search"
    },
    "-": {
      glyph: "−",
      state: "excluded",
      chipClass: "term-chip is-excluded",
      action: "Exclude from search",
      searchState: "excluded from the search"
    },
    "~": {
      glyph: "~",
      state: "optional",
      chipClass: "term-chip is-or",
      action: "Make optional (OR)",
      searchState: "optional (OR) in the search"
    }
  });
  function termState(term) {
    return SIGN_PRESENTATION[term.sign].searchState;
  }
  function termStateLabel(term) {
    const state = termState(term);
    return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  }
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
  var NON_ASCII = /[^\x20-\x7E]/u;
  var CLEAN_KEY = /[^\x20-\x7E]|[_A-Z]|^\s|\s$|\s{2}/u;
  function fold(text) {
    if (!NON_ASCII.test(text)) {
      return text.toLowerCase();
    }
    return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
  }
  function cleanTagKey(key) {
    if (!CLEAN_KEY.test(key)) {
      return key;
    }
    return collapseWhitespace(key.replace(/_/gu, " ")).toLowerCase();
  }
  function normaliseTagKey(key) {
    return fold(cleanTagKey(key));
  }
  function tagIdentity(ns, key) {
    const id = typeof ns === "string" ? tagNamespace(ns)?.id ?? ns.trim().toLowerCase() : ns.id;
    return `${id}\x00${normaliseTagKey(key)}`;
  }
  function termTagIdentity(term) {
    if (term.value.trim() === "") {
      return null;
    }
    if (term.ns !== null) {
      return tagIdentity(term.ns, term.value);
    }
    return term.nsRaw === null ? null : tagIdentity(term.nsRaw, term.value);
  }
  function termIdentity(term) {
    const tag = termTagIdentity(term);
    return tag ?? `v\x00${fold(term.value)}`;
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
    const value = collapseWhitespace(key);
    const prefix = tagNamespace(ns)?.alias ?? ns;
    const body = /\s/u.test(value) ? `"${value}$"` : `${value}$`;
    return `${sign}${prefix}:${body}`;
  }
  function toggleTagInSearch(text, token, sign = "", removeIfPresent = true) {
    const incoming = parseSearchTerms(token)[0];
    if (incoming === undefined) {
      return text;
    }
    const namespace = incoming.ns?.id ?? incoming.nsRaw;
    const wanted = termTagIdentity(incoming);
    if (namespace === null || wanted === null) {
      return text;
    }
    for (const term of parseSearchTerms(text)) {
      if (termTagIdentity(term) !== wanted) {
        continue;
      }
      if (term.sign === sign) {
        return removeIfPresent ? removeTerm(text, term) : text;
      }
      return setTermSign(text, term, sign);
    }
    const formatted = formatTagToken(namespace, incoming.value, sign);
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
  function expressionTerms(expression) {
    return parseSearchTerms(expression).filter((term) => term.value !== "");
  }
  function containsExpression(text, expression) {
    const wanted = expressionTerms(expression);
    if (wanted.length === 0) {
      return false;
    }
    const present = new Set(parseSearchTerms(text).map(termIdentity));
    return wanted.every((term) => present.has(termIdentity(term)));
  }
  function toggleExpressionInSearch(text, expression) {
    const terms = expressionTerms(expression);
    if (terms.length === 0) {
      return text;
    }
    if (containsExpression(text, expression)) {
      let next = text;
      for (const term of terms) {
        const key = termIdentity(term);
        const located = parseSearchTerms(next).find((candidate) => termIdentity(candidate) === key);
        if (located !== undefined) {
          next = removeTerm(next, located);
        }
      }
      return next;
    }
    const present = new Set(parseSearchTerms(text).map(termIdentity));
    const missing = terms.filter((term) => !present.has(termIdentity(term)));
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
  function galleryHref({ gid, token }) {
    return `/g/${gid}/${token}/`;
  }
  function galleryTorrentsHref({ gid, token }) {
    return `/gallerytorrents.php?gid=${gid}&t=${token}`;
  }
  function queryGalleryIdentity(url, gidParam, tokenParam) {
    const parsed = safeUrl(url);
    const gid = parsed?.searchParams.get(gidParam) ?? "";
    const token = parsed?.searchParams.get(tokenParam) ?? "";
    return GALLERY_PATH.test(galleryHref({ gid, token })) ? { gid, token } : null;
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
    { bit: 2, name: "Doujinshi", cls: "ct2", path: "/doujinshi" },
    { bit: 4, name: "Manga", cls: "ct3", path: "/manga" },
    { bit: 8, name: "Artist CG", cls: "ct4", path: "/artistcg" },
    { bit: 16, name: "Game CG", cls: "ct5", path: "/gamecg" },
    { bit: 512, name: "Western", cls: "cta", path: "/western" },
    { bit: 256, name: "Non-H", cls: "ct9", path: "/non-h" },
    { bit: 32, name: "Image Set", cls: "ct6", path: "/imageset" },
    { bit: 64, name: "Cosplay", cls: "ct7", path: "/cosplay" },
    { bit: 128, name: "Asian Porn", cls: "ct8", path: "/asianporn" },
    { bit: 1, name: "Misc", cls: "ct1", path: "/misc" }
  ];
  function singleCategoryName(cats) {
    const enabled = CATEGORIES.filter((category) => (cats & category.bit) === 0);
    return enabled.length === 1 ? enabled[0]?.name ?? null : null;
  }
  function emptyAdvancedFilters() {
    return {
      rating: 0,
      expunged: false,
      torrent: false,
      pageFrom: "",
      pageTo: "",
      since: "",
      until: "",
      disableLanguage: false,
      disableUploader: false,
      disableTags: false
    };
  }
  function emptySearchFilters() {
    return { cats: 0, ...emptyAdvancedFilters() };
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
      since: params.get("eh_since") ?? "",
      until: params.get("eh_until") ?? "",
      disableLanguage: params.has("f_sfl"),
      disableUploader: params.has("f_sfu"),
      disableTags: params.has("f_sft")
    };
  }
  function hasAdvancedFilters(query) {
    return query.rating > 0 || query.expunged || query.torrent || query.pageFrom.trim() !== "" || query.pageTo.trim() !== "" || query.since.trim() !== "" || query.until.trim() !== "" || query.disableLanguage || query.disableUploader || query.disableTags;
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
    const since = query.since.trim();
    if (since) {
      params.set("eh_since", since);
    }
    const until = query.until.trim();
    if (until) {
      params.set("eh_until", until);
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

  // src/site.ts
  var SITE_DOMAINS = ["e-hentai.org", "exhentai.org"];
  var SITE_PATHS = {
    home: "/home.php",
    favorites: "/favorites.php",
    uconfig: "/uconfig.php",
    myTags: "/mytags",
    torrents: "/torrents.php",
    galleryTorrents: "/gallerytorrents.php",
    archive: "/archiver.php",
    toplist: "/toplist.php"
  };
  var FRONT_PATH = "/";
  var POPULAR_PATH = "/popular";
  var WATCHED_PATH = "/watched";
  function isSiteHost(hostname) {
    return SITE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  }
  function siteLabel() {
    if (typeof location === "undefined") {
      return "E-Hentai";
    }
    return /(^|\.)exhentai\.org$/i.test(location.hostname) ? "ExHentai" : "E-Hentai";
  }
  function documentTitle(...parts) {
    return [...parts, siteLabel()].filter((part) => part !== "").join(" - ");
  }
  function siteUrl(path) {
    return new URL(path, location.origin).href;
  }
  function galleryPopupUrl(gid, token, act, base = location.origin) {
    const url = new URL("gallerypopups.php", base);
    url.searchParams.set("gid", gid);
    url.searchParams.set("t", token);
    url.searchParams.set("act", act);
    return url.href;
  }

  // src/routes/identity.ts
  var VIEWER_PATH = /^\/s\/[^/]+\/\d+-\d+\/?$/;
  var UPLOADER_PATH = /^\/uploader\/[^/]+\/?$/;
  function isPath(pathname, path) {
    return pathname === path || pathname === `${path}/`;
  }
  var LIST_PATHS = {
    "/": 0,
    ...Object.fromEntries(CATEGORIES.map((category) => [category.path, category.bit]))
  };
  var ALL_CATEGORY_BITS = CATEGORIES.reduce((bits, category) => bits | category.bit, 0);
  function categoryPathBit(pathname) {
    return LIST_PATHS[pathname] ?? null;
  }
  var SCOPE_PATHS = {
    [POPULAR_PATH]: "popular",
    [WATCHED_PATH]: "watched"
  };
  function nativeUrl(href = location.href) {
    const url = new URL(href);
    url.searchParams.set("eh_native", "1");
    return url.href;
  }
  function nativePath(path) {
    const url = new URL(path, location.origin);
    url.searchParams.set("eh_native", "1");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  // src/data/list-filters.ts
  var KEY = "eh:list-filters:v1";
  var PANEL_KEY = "eh:list-filters-open:v1";
  var VERSION2 = 1;
  var FILTER_PARAMS = [
    "f_cats",
    "f_srdd",
    "f_sh",
    "f_sto",
    "f_spf",
    "f_spt",
    "f_sfl",
    "f_sfu",
    "f_sft",
    "eh_since",
    "eh_until"
  ];
  function isStoredFilters(value) {
    return isRecord(value);
  }
  var filters = createStore({ key: KEY, version: VERSION2, empty: () => ({}), guard: isStoredFilters }, gmStorage());
  var panel = createStore({
    key: PANEL_KEY,
    version: VERSION2,
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
    if (route.scope !== "search" && route.scope !== "uploader") {
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
    return collapseWhitespace(value ?? "");
  }
  function parseIntMatch(value, pattern) {
    const digits = pattern.exec(value ?? "")?.[1];
    if (digits === undefined) {
      return null;
    }
    const parsed = Number.parseInt(digits.replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function parseNumber(value) {
    return parseIntMatch(value, /([\d,]+)/);
  }
  function parseSignedNumber(value) {
    return parseIntMatch(value, /^\s*([+-]?\d[\d,]*)/);
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
  var LEADING_METADATA = /^(\([^)]+\)|\[[^\]]+\])\s*/;
  var TRAILING_METADATA = /\s*(\([^)]+\)|\[[^\]]+\])$/;
  var TITLE_SEPARATOR = /\s*\|\s*/;
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
      const match = LEADING_METADATA.exec(text);
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
      const match = TRAILING_METADATA.exec(text);
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
    const parts = text.split(TITLE_SEPARATOR);
    return {
      leading,
      primary: parts[0] || "Untitled",
      secondary: parts[1] || null,
      trailing
    };
  }

  // src/parse/viewer.ts
  var NL_TOKEN = /\bnl\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/u;
  function findCounter(root) {
    if (root === null) {
      return null;
    }
    const match = [...root.querySelectorAll("div, span, td")].find((node) => /^\d+ \/ \d+$/.test(node.textContent.trim()));
    return match?.textContent.trim() ?? null;
  }
  function parseNlToken(doc) {
    const anchor = doc.querySelector("#loadfail, a[onclick*='nl(']");
    const match = NL_TOKEN.exec(anchor?.getAttribute("onclick") ?? "");
    const token = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    return token === "" ? null : token;
  }
  function parseViewer(doc, viewerUrl) {
    const [, pageHash = "", galleryId = "", rawNum = "1"] = viewerUrl.match(/\/s\/([^/]+)\/(\d+)-(\d+)/) ?? [];
    const pageNum = parseInt(rawNum, 10);
    const imgEl = doc.querySelector("#i3 a img, iframe + a img, .sni > a img");
    const imgSrc = imgEl?.getAttribute("src") ?? "";
    const originalHref = anchorHref(doc.querySelector("a[href*='/fullimg/']"), viewerUrl);
    const nlToken = parseNlToken(doc);
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
    const counterText = findCounter(doc.querySelector("#i2")) ?? findCounter(doc) ?? `${pageNum} / ?`;
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
      delete(key) {
        return entries.delete(key);
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
      if (options.cache !== false) {
        documents.set(url, result);
        if (finalUrl !== url) {
          documents.set(finalUrl, result);
        }
      }
      return result;
    }
    function fetchViewerPage(url, priority, tag, cancelSignal) {
      log("fetching viewer →", url);
      const controller = new AbortController;
      const shared = (async () => {
        const { doc, url: finalUrl } = await loadDocument(url, {
          cache: false,
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
      async retryWithNl(page, { signal, priority } = {}) {
        if (page.nlToken === null || page.nlToken === "") {
          return null;
        }
        if (signal?.aborted) {
          return null;
        }
        const newer = pages.get(page.viewerUrl);
        if (newer !== undefined && newer !== page) {
          log("nl retry skipped, newer page cached", page.viewerUrl);
          return newer;
        }
        const retryUrl = new URL(page.viewerUrl);
        retryUrl.hash = "";
        retryUrl.search = `?nl=${encodeURIComponent(page.nlToken)}`;
        log("nl retry →", retryUrl.href);
        try {
          const { doc } = await loadDocument(retryUrl.href, {
            fresh: true,
            cache: false,
            priority: priority ?? priorityOf("critical"),
            tag: "viewer",
            signal
          });
          return cachePage(parseViewer(doc, page.viewerUrl), page.viewerUrl);
        } catch (error) {
          if (isAbortError(error)) {
            return null;
          }
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
      net.purge((task) => task.priority < priorityOf("critical"));
    }
  });

  // src/parse/archive.ts
  function labelledText(container, label) {
    for (const node of container.querySelectorAll("div, p")) {
      const text = cleanText(node.textContent);
      if (!text.startsWith(label)) {
        continue;
      }
      const strong = node.querySelector("strong");
      return cleanText(strong?.textContent) || cleanText(text.slice(label.length));
    }
    return "";
  }
  function optionContainer(form) {
    let node = form.parentElement;
    while (node !== null && node.id !== "db") {
      const text = cleanText(node.textContent);
      if (text.includes("Download Cost:") && text.includes("Estimated Size:")) {
        return node;
      }
      node = node.parentElement;
    }
    return form.parentElement ?? form;
  }
  function parseCost(text) {
    const value = cleanText(text);
    if (value === "") {
      return { kind: "unknown", text: value };
    }
    if (/^free!?$/i.test(value)) {
      return { kind: "free" };
    }
    if (/^n\/a$/i.test(value)) {
      return { kind: "unavailable" };
    }
    if (/insufficient funds/i.test(value)) {
      return { kind: "insufficient" };
    }
    if (/^([\d,]+)\s*GP$/i.test(value)) {
      const amount = parseNumber(value);
      if (amount !== null) {
        return { kind: "gp", amount };
      }
    }
    return { kind: "unknown", text: value };
  }
  function parseSize(text) {
    const value = cleanText(text);
    return value === "" || /^n\/a$/i.test(value) ? null : value;
  }
  function optionFrom(form, base) {
    const dltype = (form.querySelector("input[name='dltype']")?.value ?? "").trim();
    const kind = dltype === "org" ? "original" : dltype === "res" ? "resample" : null;
    if (kind === null) {
      return null;
    }
    const action = safeUrl(form.getAttribute("action") ?? "", base)?.href ?? null;
    if (action === null) {
      return null;
    }
    const submit = form.querySelector("input[name='dlcheck']");
    const label = (submit?.getAttribute("value") ?? "").trim() || (kind === "original" ? "Download Original Archive" : "Download Resample Archive");
    const container = optionContainer(form);
    const cost = parseCost(labelledText(container, "Download Cost:"));
    const disabled = submit === null || submit.hasAttribute("disabled");
    const available = !disabled && (cost.kind === "free" || cost.kind === "gp");
    return {
      kind,
      dltype,
      label,
      action,
      cost,
      size: parseSize(labelledText(container, "Estimated Size:")),
      available
    };
  }
  function parseFunds(doc) {
    const container = doc.getElementById("db");
    if (container === null) {
      return null;
    }
    for (const paragraph of container.querySelectorAll("p")) {
      if (!cleanText(paragraph.textContent).startsWith("Current Funds:")) {
        continue;
      }
      const text = cleanText(paragraph.nextElementSibling?.textContent ?? paragraph.textContent);
      const gp = /([\d,]+)\s*GP/i.exec(text)?.[1] ?? null;
      const credits = /([\d,]+)\s*Credits/i.exec(text)?.[1] ?? null;
      return { gp, credits };
    }
    return null;
  }
  function galleryLinks(url) {
    const identity = queryGalleryIdentity(url, "gid", "token");
    return identity === null ? { galleryHref: null, torrentsHref: null } : { galleryHref: galleryHref(identity), torrentsHref: galleryTorrentsHref(identity) };
  }
  function parseArchivePage(doc, url) {
    const container = doc.getElementById("db");
    let original = null;
    let resample = null;
    for (const form of container?.querySelectorAll("form") ?? []) {
      const option = optionFrom(form, url);
      if (option?.kind === "original" && original === null) {
        original = option;
      } else if (option?.kind === "resample" && resample === null) {
        resample = option;
      }
    }
    return {
      url,
      title: cleanText(container?.querySelector("h1")?.textContent),
      funds: parseFunds(doc),
      original,
      resample,
      ...galleryLinks(url)
    };
  }
  function parseArchiveDownloadHref(doc, base) {
    const anchor = doc.getElementById("continue")?.querySelector("a[href]") ?? null;
    const href = anchorHref(anchor, base);
    if (href === null) {
      return null;
    }
    const parsed = safeUrl(href);
    return parsed !== null && /^https?:$/.test(parsed.protocol) ? href : null;
  }

  // src/parse/list.ts
  var PAGES_TEXT = /^\s*([\d,]+)\s+pages?\s*$/i;
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
  function parseFavorite(nodes) {
    for (const node of nodes) {
      if (!node.id.startsWith("posted_")) {
        continue;
      }
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
    const nodes = root.querySelectorAll("*");
    for (const node of nodes) {
      if (node.childElementCount !== 0) {
        continue;
      }
      const pages = wholePages(node.textContent);
      if (pages !== null) {
        return pages;
      }
    }
    for (const node of nodes) {
      if (node.childElementCount === 0) {
        continue;
      }
      const pages = wholePages(node.textContent);
      if (pages !== null) {
        return pages;
      }
    }
    return null;
  }
  function wholePages(text) {
    const digits = PAGES_TEXT.exec(text ?? "")?.[1];
    if (digits === undefined) {
      return null;
    }
    return Number.parseInt(digits.replace(/,/g, ""), 10);
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
  var RATING_POSITION = /(-?[\d.]+)px\s+(-?[\d.]+)px/;
  function parseRating(root) {
    const position = root.querySelector(".ir")?.style.backgroundPosition;
    if (!position) {
      return null;
    }
    const match = RATING_POSITION.exec(position);
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
    const uploader = root.querySelector("a[href*='/uploader/']");
    const postedNodes = root.querySelectorAll(POSTED_SELECTOR);
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
      uploader: cleanText(uploader?.textContent) || null,
      uploaderHref: anchorHref(uploader, base),
      posted: cleanText(postedNodes[0]?.textContent),
      pages: parsePages(root),
      torrentsHref: parseTorrents(root, base),
      favorite: parseFavorite(postedNodes)
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
    const match = /^(?:Found|Showing)\b[^.]*\./i.exec(raw);
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
  function orderParam(order) {
    return order === "published" ? "fs_p" : "fs_f";
  }
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
  var BACKGROUND_URL = /url\(["']?(.*?)["']?\)/;
  function backgroundUrl(node) {
    if (!node || !("style" in node)) {
      return null;
    }
    const match = BACKGROUND_URL.exec(node.style.backgroundImage);
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
  var SCRIPT_VALUE_NAMES = [
    "api_url",
    "apiuid",
    "apikey",
    "gid",
    "token",
    "base_url",
    "display_rating"
  ];
  var SCRIPT_ASSIGNMENT = new RegExp(`(?:^|[;\\s])(${SCRIPT_VALUE_NAMES.join("|")})` + `\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`, "gm");
  var scriptValueCache = new WeakMap;
  function scriptValues(doc) {
    const cached = scriptValueCache.get(doc);
    if (cached) {
      return cached;
    }
    const values = new Map;
    for (const name of SCRIPT_VALUE_NAMES) {
      values.set(name, null);
    }
    for (const script of doc.querySelectorAll("script")) {
      if (script.getAttribute("src") !== null) {
        continue;
      }
      const text = script.textContent;
      SCRIPT_ASSIGNMENT.lastIndex = 0;
      let match;
      while ((match = SCRIPT_ASSIGNMENT.exec(text)) !== null) {
        const name = match[1];
        if (name === undefined || values.get(name) !== null) {
          continue;
        }
        const value = match[2] ?? match[3] ?? match[4];
        if (value !== undefined) {
          values.set(name, value);
        }
      }
    }
    scriptValueCache.set(doc, values);
    return values;
  }
  function scriptValue(doc, name) {
    return scriptValues(doc).get(name) ?? null;
  }
  function parseApiCredentials(doc) {
    const apiUrl = scriptValue(doc, "api_url");
    const apiUid = scriptValue(doc, "apiuid");
    const apiKey = scriptValue(doc, "apikey");
    if (!apiUrl || !apiUid || !apiKey) {
      return null;
    }
    return { apiUrl, apiUid, apiKey };
  }
  function parseGalleryApiConfig(doc) {
    const credentials = parseApiCredentials(doc);
    const gid = scriptValue(doc, "gid");
    const token = scriptValue(doc, "token");
    if (credentials === null || !gid || !token) {
      return null;
    }
    return { ...credentials, gid, token };
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
  var PAGE_LABEL = /Page\s+(\d+)/i;
  function parseThumbs(doc, url) {
    const grid = doc.getElementById("gdt");
    if (!grid) {
      return [];
    }
    const thumbs = [];
    const spriteCounts = new Map;
    const children = grid.children;
    for (let index = 0;index < children.length; index++) {
      const node = children[index];
      if (node?.localName !== "a") {
        continue;
      }
      const tile = node.querySelector("div[style]");
      if (!tile) {
        continue;
      }
      const sprite = backgroundUrl(tile);
      if (!sprite) {
        continue;
      }
      const width = Number.parseFloat(tile.style.width) || 100;
      const height = Number.parseFloat(tile.style.height) || 100;
      const x = Number.parseFloat(tile.style.backgroundPositionX || tile.style.backgroundPosition) || 0;
      const labelMatch = PAGE_LABEL.exec(tile.title);
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
    }
    for (const thumb of thumbs) {
      thumb.spriteCount = spriteCounts.get(thumb.sprite) ?? 1;
    }
    return thumbs;
  }
  function bodyText(node) {
    if (!node) {
      return "";
    }
    let text = "";
    const stack = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      if (current.nodeType === 3) {
        text += current.textContent ?? "";
        continue;
      }
      if (current.nodeName === "BR") {
        text += `
`;
        continue;
      }
      const children = current.childNodes;
      for (let index = children.length - 1;index >= 0; index--) {
        const child = children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
    return text;
  }
  var CRLF = /\r\n?/g;
  var TRAILING_SPACE = /[ \t]+\n/g;
  var EXTRA_BLANK_LINES = /\n{3,}/g;
  function normalizeBody(text) {
    return text.replace(CRLF, `
`).replace(TRAILING_SPACE, `
`).replace(EXTRA_BLANK_LINES, `

`).trim();
  }
  var POSTED_AT = /Posted on\s+(.+?)\s+by:/i;
  var EDIT_LABEL = /^edit$/iu;
  var COMMENT_EDIT_ID = /^comment_edit_(\d+)$/;
  function collectEditableComments(doc, ids) {
    const editable = new Set;
    const candidates = doc.querySelectorAll("#cdiv a, #cdiv button, #cdiv [data-comment-edit], #cdiv [id^='comment_edit_']");
    for (const node of candidates) {
      let id;
      for (let block = node.parentElement;block !== null; block = block.parentElement) {
        id = ids.get(block);
        if (id !== undefined) {
          break;
        }
      }
      if (id === undefined) {
        continue;
      }
      const key = String(id);
      if ((node.localName === "a" || node.localName === "button") && EDIT_LABEL.test(cleanText(node.textContent))) {
        editable.add(key);
        continue;
      }
      const declared = node.getAttribute("data-comment-edit");
      if (declared !== null && declared === key) {
        editable.add(key);
      }
      if (COMMENT_EDIT_ID.exec(node.id)?.[1] === key) {
        editable.add(key);
      }
    }
    return editable;
  }
  function parseComments(doc, url) {
    const fields = [];
    const blockIds = new Map;
    for (const block of doc.querySelectorAll("#cdiv .c1")) {
      const body = block.querySelector(".c6[id^='comment_']");
      const idText = body?.id.startsWith("comment_") ? body.id.slice("comment_".length) : "";
      const id = Number.parseInt(idText, 10);
      if (!Number.isFinite(id)) {
        continue;
      }
      const header = block.querySelector(".c3");
      const postedText = cleanText(header?.textContent);
      fields.push({
        id,
        body,
        author: header?.querySelector("a[href*='/uploader/']") ?? null,
        posted: POSTED_AT.exec(postedText)?.[1] ?? postedText,
        score: parseSignedNumber(block.querySelector("[id^='comment_score_']")?.textContent),
        votes: cleanText(block.querySelector("[id^='cvotes_']")?.textContent) || null,
        uploader: block.querySelector(".c4 a[name='ulcomment']") !== null
      });
      blockIds.set(block, id);
    }
    if (fields.length === 0) {
      return [];
    }
    const editable = collectEditableComments(doc, blockIds);
    return fields.map((comment) => ({
      id: comment.id,
      author: cleanText(comment.author?.textContent),
      authorHref: anchorHref(comment.author, url),
      posted: comment.posted,
      body: normalizeBody(bodyText(comment.body)),
      score: comment.score,
      votes: comment.votes,
      uploader: comment.uploader,
      editable: editable.has(String(comment.id))
    }));
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
  function popupBase(declared, pageUrl) {
    const resolved = declared === null ? null : safeUrl(declared, pageUrl);
    if (resolved !== null && resolved.protocol === "https:" && isSiteHost(resolved.hostname)) {
      return resolved.href;
    }
    return new URL("/", pageUrl).href;
  }
  function parseActions(doc, url) {
    const report = doc.querySelector("a[href*='report=select']");
    const expunge = doc.querySelector("a[href*='act=expunge']");
    const rename = doc.getElementById("renamelink");
    const base = popupBase(scriptValue(doc, "base_url"), url);
    const identity = galleryIdentity(url);
    const renameHref = identity === null || rename === null ? null : galleryPopupUrl(identity.gid, identity.token, "rename", base);
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
  function parseGalleryThumbPage(doc, url) {
    return { items: parseThumbs(doc, url), next: parsePaging(doc, url).nextHref };
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
      throw new ParseMismatchError("gallery", "the title and page thumbnails are missing");
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

  // src/parse/gallery-torrents.ts
  var DOWNLOAD_LINK = "a[href*='ehtracker.org/get/']";
  function galleryHrefFrom(url) {
    const identity = queryGalleryIdentity(url, "gid", "t");
    return identity === null ? null : galleryHref(identity);
  }
  function fieldMap(form) {
    const fields = new Map;
    for (const cell of form.querySelectorAll("td")) {
      const text = cleanText(cell.textContent);
      const colon = text.indexOf(":");
      if (colon <= 0 || fields.has(text.slice(0, colon))) {
        continue;
      }
      fields.set(text.slice(0, colon), cleanText(text.slice(colon + 1)));
    }
    return fields;
  }
  function parseTorrent(form, base) {
    const gtid = (form.querySelector("input[name='gtid']")?.value ?? "").trim();
    if (gtid === "") {
      return null;
    }
    const link = form.querySelector(DOWNLOAD_LINK);
    const fields = fieldMap(form);
    return {
      gtid,
      name: cleanText(link?.textContent),
      posted: fields.get("Posted") ?? "",
      size: fields.get("Size") ?? "",
      seeds: parseNumber(fields.get("Seeds")) ?? 0,
      peers: parseNumber(fields.get("Peers")) ?? 0,
      downloads: parseNumber(fields.get("Downloads")) ?? 0,
      uploader: fields.get("Uploader") ?? "",
      downloadHref: anchorHref(link, base)
    };
  }
  function parseGalleryTorrents(doc, url) {
    const container = doc.getElementById("torrentinfo");
    const torrents = [];
    if (container !== null) {
      for (const form of container.querySelectorAll("form")) {
        const torrent = parseTorrent(form, url);
        if (torrent !== null) {
          torrents.push(torrent);
        }
      }
    }
    return {
      url,
      title: cleanText(container?.querySelector("h1")?.textContent),
      galleryHref: galleryHrefFrom(url),
      torrents
    };
  }

  // src/parse/home.ts
  var VALUE = /^[=+-]?\s*[\d,.]+\s*(?:[A-Za-z%/]+)?$/u;
  function fact(left, right) {
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
  function factsOf(homebox) {
    const facts = [];
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
      if (cells.length === 6) {
        for (let index = 0;index < cells.length; index += 2) {
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
  function paragraphsOf(homebox) {
    const seen = new Set;
    const paragraphs = [];
    for (const node of homebox.querySelectorAll("p")) {
      const text = cleanText(node.textContent);
      if (text !== "" && !seen.has(text)) {
        seen.add(text);
        paragraphs.push(text);
      }
    }
    return paragraphs;
  }
  function linksOf(homebox, url) {
    const links = [];
    for (const anchor of homebox.querySelectorAll("a[href]")) {
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
  function actionOf(homebox) {
    const submit = homebox.querySelector('input[type="submit"]');
    const label = cleanText(submit?.value);
    if (label !== "") {
      return label;
    }
    const button = cleanText(homebox.querySelector("button")?.textContent);
    return button === "" ? null : button;
  }
  function sectionOf(title, homebox, url) {
    const paragraphs = paragraphsOf(homebox);
    const facts = factsOf(homebox);
    const links = linksOf(homebox, url);
    if (paragraphs.length === 0 && facts.length === 0 && links.length === 0) {
      const text = cleanText(homebox.textContent);
      if (text !== "") {
        paragraphs.push(text);
      }
    }
    return { title, paragraphs, facts, links, action: actionOf(homebox) };
  }
  function navOf(doc, url) {
    const current = new URL(url);
    const links = [];
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
        active: target.pathname === current.pathname && target.search === current.search
      });
    }
    return links;
  }
  function parseHome(doc, url) {
    const root = doc.querySelector(".stuffbox");
    const sections = [];
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

  // src/parse/my-tags.ts
  var DEFAULT_WEIGHT = 10;
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
        weight: Number.isFinite(weight) ? weight : DEFAULT_WEIGHT
      });
    }
    return tags;
  }
  function scriptString(doc, key) {
    const pattern = new RegExp(`var\\s+${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`);
    for (const script of doc.querySelectorAll("script")) {
      const match = pattern.exec(script.textContent);
      const literal = match?.[1];
      if (literal === undefined) {
        continue;
      }
      try {
        const value = JSON.parse(literal);
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  function optionName(label) {
    return label.replace(/\s*\(\d+\)\s*$/u, "").trim();
  }
  function parseTagsetFields(form) {
    const fields = [];
    for (const control of form.querySelectorAll("input[name], select[name], textarea[name]")) {
      const name = control.getAttribute("name")?.trim() ?? "";
      if (name === "") {
        continue;
      }
      if (control.tagName === "INPUT") {
        const input = control;
        const type = (input.getAttribute("type") ?? "text").toLowerCase();
        if (type === "submit" || type === "button" || type === "reset" || type === "image" || type === "file") {
          continue;
        }
        if (type === "checkbox") {
          fields.push({
            name,
            kind: "checkbox",
            value: isChecked(input) ? input.getAttribute("value") ?? "on" : ""
          });
          continue;
        }
        if (type === "radio" && !isChecked(input)) {
          continue;
        }
        fields.push({ name, kind: "value", value: input.getAttribute("value") ?? "" });
        continue;
      }
      if (control.tagName === "SELECT") {
        const selected = control.querySelector("option[selected]") ?? control.querySelector("option");
        fields.push({
          name,
          kind: "value",
          value: selected?.getAttribute("value") ?? ""
        });
        continue;
      }
      fields.push({ name, kind: "value", value: control.textContent });
    }
    return fields;
  }
  function parseTagset(doc, url) {
    const form = doc.getElementById("tagset_form");
    if (form === null) {
      return null;
    }
    const choices = [];
    for (const option of form.querySelectorAll("select option")) {
      const id = (option.getAttribute("value") ?? "").trim();
      if (id === "") {
        continue;
      }
      choices.push({
        id,
        label: cleanText(option.textContent),
        selected: option.hasAttribute("selected")
      });
    }
    if (choices.length === 0) {
      return null;
    }
    const current = choices.find((choice) => choice.selected) ?? choices[0];
    if (current === undefined) {
      return null;
    }
    const fields = parseTagsetFields(form);
    const field = (name) => fields.find((candidate) => candidate.name === name);
    const enabledField = field("tagset_enable");
    const action = safeUrl(form.getAttribute("action") ?? "", url)?.href ?? url;
    return {
      choices,
      currentId: current.id,
      name: scriptString(doc, "tagset_name") ?? optionName(current.label),
      enabled: (enabledField?.value ?? "") !== "",
      color: normalizeColor(field("tagset_color")?.value ?? ""),
      action,
      fields
    };
  }
  function parseMyTags(doc, url) {
    return {
      url,
      tags: parseUserTags(doc),
      tagsets: parseTagset(doc, url),
      api: parseApiCredentials(doc)
    };
  }

  // src/parse/sanity.ts
  var EMPTY_LIST = /no hits|no galleries|found 0|no results/i;
  var EMPTY_TORRENTS = /no torrents|no results|showing 0\s*-\s*0/i;
  function assertViewerPage(data) {
    if (data.imgSrc.trim() === "") {
      throw new ParseMismatchError("viewer", "the page image is missing");
    }
  }
  function assertGalleryPage(data) {
    if (data.thumbs.length === 0) {
      throw new ParseMismatchError("gallery", "the page thumbnails are missing");
    }
    if (data.title.primary.trim() === "") {
      throw new ParseMismatchError("gallery", "the gallery title is empty");
    }
  }
  function assertListPage(data, doc) {
    if (doc.querySelector(".searchtext, #searchbox, table.itg, .gl1t") === null) {
      throw new ParseMismatchError("list", "the search and results markup is missing");
    }
    if (data.items.length === 0 && !EMPTY_LIST.test(data.resultText ?? "")) {
      throw new ParseMismatchError("list", "there are no items and no empty-result notice");
    }
  }
  function assertTorrentsPage(data, doc) {
    if (doc.querySelector("table.itg") === null) {
      throw new ParseMismatchError("torrents", "the torrent table is missing");
    }
    if (data.rows.length > 0) {
      return;
    }
    const summary = data.summary ?? doc.querySelector("p.ip")?.textContent.trim() ?? "";
    if (!EMPTY_TORRENTS.test(summary)) {
      throw new ParseMismatchError("torrents", "there are no rows and no empty-result summary");
    }
  }
  function assertFavoritesPage(data) {
    if (data.folders.length === 0) {
      throw new ParseMismatchError("favorites", "the favorite-folder tabs are missing");
    }
  }
  function assertToplistPage(data) {
    if (data.kind === "category") {
      if (data.entries.length === 0) {
        throw new ParseMismatchError("toplist", "the ranked entries are missing");
      }
      return;
    }
    if (data.sections.length === 0) {
      throw new ParseMismatchError("toplist", "the toplist sections are missing");
    }
  }
  function assertArchivePage(data, doc) {
    if (doc.getElementById("db") === null) {
      throw new ParseMismatchError("archive", "the archiver container is missing");
    }
    if (data.original === null && data.resample === null) {
      throw new ParseMismatchError("archive", "the archive download forms are missing");
    }
  }
  function assertSettingsPage(data) {
    if (data.length === 0) {
      throw new ParseMismatchError("settings", "the settings form is missing");
    }
  }
  function assertHomePage(data, doc) {
    if (doc.querySelector(".stuffbox") === null) {
      throw new ParseMismatchError("home", "the account boxes are missing");
    }
    if (data.sections.length === 0) {
      throw new ParseMismatchError("home", "no account sections were parsed");
    }
  }
  function assertGalleryTorrentsPage(data, doc) {
    const container = doc.getElementById("torrentinfo");
    if (container === null) {
      throw new ParseMismatchError("galleryTorrents", "the torrent container is missing");
    }
    if (data.torrents.length > 0) {
      return;
    }
    if (!EMPTY_TORRENTS.test(container.textContent)) {
      throw new ParseMismatchError("galleryTorrents", "there are no torrents and no empty notice");
    }
  }
  function assertMyTagsPage(_data, doc) {
    if (doc.getElementById("usertags_outer") === null) {
      throw new ParseMismatchError("myTags", "the user-tag container is missing");
    }
  }

  // src/parse/pager.ts
  function pagerTable(doc) {
    return doc.querySelector("table.ptt, table.ptb");
  }
  function pagerData(table, base) {
    const data = { pages: [], current: null, prevHref: null, nextHref: null };
    if (!table) {
      return data;
    }
    for (const node of table.querySelectorAll("td, a[href]")) {
      if (node.tagName === "TD") {
        const text = cleanText(node.textContent);
        if (/^\d+$/.test(text)) {
          data.pages.push(Number.parseInt(text, 10));
        }
        if (data.current === null && node.classList.contains("ptds")) {
          data.current = parseNumber(text);
        }
        continue;
      }
      const label = cleanText(node.textContent);
      if (label === "<" && data.prevHref === null) {
        data.prevHref = anchorHref(node, base);
      } else if (label === ">" && data.nextHref === null) {
        data.nextHref = anchorHref(node, base);
      }
    }
    return data;
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
  function resolveAnchor(anchor, base) {
    const raw = anchor?.getAttribute("href");
    if (raw === null || raw === undefined) {
      return { href: null, gid: null };
    }
    const url = safeUrl(raw, base);
    if (url === null) {
      return { href: null, gid: null };
    }
    return { href: url.href, gid: GALLERY_PATH.exec(url.pathname)?.[1] ?? null };
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
        const path = `${SITE_PATHS.toplist}?tl=${key}`;
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
      const tableRow = row;
      let cell;
      for (const candidate of tableRow.cells ?? row.children) {
        if (candidate.tagName === "TD") {
          cell = candidate;
          break;
        }
      }
      if (!cell) {
        continue;
      }
      const gid = resolveAnchor(row.querySelector("a[href*='/g/']"), url).gid;
      if (!gid) {
        continue;
      }
      let rank = null;
      let score = null;
      let index = 0;
      for (const line of cell.querySelectorAll("p")) {
        const text = cleanText(line.textContent);
        if (index === 0) {
          rank = parseNumber(text);
        } else if (index === 1) {
          score = text || null;
          break;
        }
        index++;
      }
      metrics.set(gid, { rank: rank ?? metrics.size + 1, score });
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
      const ranks = [];
      const scores = [];
      const links = [];
      for (const cell of row.children) {
        if (cell.classList.contains("dr")) {
          ranks.push(cell);
        } else if (cell.classList.contains("ds")) {
          scores.push(cell);
        } else if (cell.classList.contains("du")) {
          links.push(cell.querySelector("a[href]"));
        }
      }
      for (const [index, cell] of ranks.entries()) {
        const rank = parseNumber(cell.textContent);
        if (rank === null) {
          continue;
        }
        const anchor = links[index] ?? null;
        entries.push({
          rank,
          label: cleanText(anchor?.textContent) || cleanText(cell.textContent),
          href: resolveAnchor(anchor, url).href,
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
    const data = pagerData(table, url);
    return {
      page: data.current ?? 1,
      pages: data.pages.reduce((max, page) => Math.max(max, page), 1),
      prevHref: data.prevHref,
      nextHref: data.nextHref
    };
  }
  function parseEntries(block, url) {
    const entries = [];
    for (const row of block.querySelectorAll("tr")) {
      const tableRow = row;
      const cells = tableRow.cells ?? row.children;
      let rankNode = null;
      let anyAnchor = null;
      let tunAnchor = null;
      for (const cell of cells) {
        if (cell.tagName !== "TD") {
          continue;
        }
        if (rankNode === null && cell.classList.contains("pso")) {
          rankNode = cell;
        }
        anyAnchor ??= cell.querySelector("a[href]");
        tunAnchor ??= cell.querySelector("div.tun a[href]");
      }
      const anchor = tunAnchor ?? anyAnchor;
      if (!rankNode && !anchor) {
        continue;
      }
      const resolved = resolveAnchor(anchor, url);
      const lastCell = cells[cells.length - 1];
      const label = cleanText(anchor?.textContent) || cleanText(lastCell?.tagName === "TD" ? lastCell.textContent : undefined);
      if (label === "" && resolved.href === null) {
        continue;
      }
      entries.push({
        rank: parseNumber(rankNode?.textContent) ?? entries.length + 1,
        label,
        href: resolved.href,
        gid: resolved.gid,
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
    const anchors = [];
    for (const block of doc.querySelectorAll(".tdo")) {
      const blockAnchors = block.querySelectorAll("p a[href]");
      for (const anchor of blockAnchors) {
        anchors.push(anchor);
      }
      const title = cleanText(blockAnchors[0]?.textContent);
      const entries = parseEntries(block, url);
      if (title === "" && entries.length === 0) {
        continue;
      }
      sections.push({ title, entries });
    }
    const sources = [];
    for (const anchor of anchors) {
      const resolved = resolveAnchor(anchor, url);
      const key = toplistKey(resolved.href);
      if (resolved.href !== null && key !== null) {
        sources.push({ key, href: resolved.href, label: cleanText(anchor.textContent) });
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
    const entries = doc.querySelector("table.itg a[href*='/g/']") ? galleryEntries(doc, url) : userEntries(doc, url);
    return {
      kind: "category",
      url,
      tabs,
      title: categoryTitle(doc),
      entries,
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
  function parseRow(row, base) {
    let addedCell;
    let nameCell;
    let galleryCell;
    let sizeCell;
    let seedsCell;
    let peersCell;
    let downloadsCell;
    let uploaderCell;
    let index = 0;
    for (const child of row.children) {
      if (!child.classList.contains("itd")) {
        continue;
      }
      switch (index) {
        case 0:
          addedCell = child;
          break;
        case 1:
          nameCell = child;
          break;
        case 2:
          galleryCell = child;
          break;
        case 3:
          sizeCell = child;
          break;
        case 4:
          seedsCell = child;
          break;
        case 5:
          peersCell = child;
          break;
        case 6:
          downloadsCell = child;
          break;
        case 7:
          uploaderCell = child;
          break;
        default:
          break;
      }
      index++;
      if (index > 7) {
        break;
      }
    }
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
    const paging = pagerData(pager, url);
    return {
      url,
      rows,
      status: statusFromUrl(parsedUrl),
      uploaderFilter: uploader === "" ? null : uploader,
      search: parsedUrl?.searchParams.get("search")?.trim() ?? "",
      sort: parsedUrl?.searchParams.get("o")?.trim() || null,
      summary,
      page: pageFromUrl(parsedUrl),
      pages: paging.pages,
      prevHref: paging.prevHref,
      nextHref: paging.nextHref
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
  var CATEGORIES_BY_KEY = new Map(CATEGORIES.map((category) => [categoryKey(category.name), category]));
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
    const category = CATEGORIES_BY_KEY.get(key);
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

  // src/data/archive.ts
  async function startArchiveDownload(option, signal, deps = {}) {
    const body = new URLSearchParams({ dltype: option.dltype, dlcheck: option.label });
    const response = await (deps.post ?? postForm)(option.action, body, {
      tag: "archive",
      failure: "Archive request failed",
      signal
    });
    const html = await response.text();
    const doc = (deps.parseHtml ?? ((text) => new DOMParser().parseFromString(text, "text/html")))(html);
    const href = parseArchiveDownloadHref(doc, option.action);
    if (href === null) {
      throw new Error("The site did not return an archive download link.");
    }
    return href;
  }

  // src/ui/fact-row.ts
  function factRow(label, value, className) {
    return el("div", { class: className === undefined ? "fact-row" : `fact-row ${className}` }, el("span", { class: "fact-label", text: label }), el("span", { class: "fact-value" }, value));
  }

  // src/ui/list-header.ts
  function listHeader({ title, summary }) {
    return el("div", { class: "list-header" }, el("div", { class: "list-heading" }, el("h1", { text: title })), el("div", { class: "list-summary" }, ...summary));
  }

  // src/data/search-history.ts
  var HISTORY_KEY = "eh:search-history:v1";
  var VERSION3 = 1;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RECENT_LIMIT = 20;
  var RECENT_TTL_MS = 90 * DAY_MS;
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
      const text = collapseWhitespace(value.text);
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
    const normalized = collapseWhitespace(text);
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
  var DRAFT_WRITE_DELAY_MS = 150;
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
  var draftTimer = null;
  var pendingDraft = null;
  var boundWindow = null;
  var boundDocument = null;
  function flushDraftWrite() {
    if (draftTimer !== null) {
      window.clearTimeout(draftTimer);
      draftTimer = null;
    }
    if (pendingDraft === null) {
      return;
    }
    const text = pendingDraft;
    pendingDraft = null;
    draftStore.write(text);
  }
  function flushWhenHidden() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushDraftWrite();
    }
  }
  function bindDraftLifecycle() {
    const view = typeof window === "undefined" ? null : window;
    if (view !== null && view !== boundWindow) {
      boundWindow?.removeEventListener("pagehide", flushDraftWrite);
      boundWindow?.removeEventListener("blur", flushDraftWrite);
      view.addEventListener("pagehide", flushDraftWrite);
      view.addEventListener("blur", flushDraftWrite);
      boundWindow = view;
    }
    const doc = typeof document === "undefined" ? null : document;
    if (doc !== null && doc !== boundDocument) {
      boundDocument?.removeEventListener("visibilitychange", flushWhenHidden);
      doc.addEventListener("visibilitychange", flushWhenHidden);
      boundDocument = doc;
    }
  }
  function scheduleDraftWrite(text) {
    bindDraftLifecycle();
    pendingDraft = text;
    if (draftTimer !== null) {
      window.clearTimeout(draftTimer);
    }
    draftTimer = window.setTimeout(flushDraftWrite, DRAFT_WRITE_DELAY_MS);
  }
  function discardDraftWrite() {
    if (draftTimer !== null) {
      window.clearTimeout(draftTimer);
      draftTimer = null;
    }
    pendingDraft = null;
  }
  var draftChanged = createEmitter();
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
    discardDraftWrite();
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
    scheduleDraftWrite(text);
    notify();
  }
  function subscribeSearchDraft(listener) {
    return draftChanged.subscribe(listener);
  }
  function notify() {
    draftChanged.emit(getSearchDraft());
  }
  bindDraftLifecycle();

  // src/session.ts
  function memberId() {
    return /(?:^|; )ipb_member_id=(\d+)/.exec(document.cookie)?.[1] ?? null;
  }
  function isLoggedIn() {
    return memberId() !== null;
  }

  // src/ui/frame.ts
  function requestFrame(callback) {
    if (typeof requestAnimationFrame !== "function") {
      callback();
      return null;
    }
    return requestAnimationFrame(callback);
  }
  function cancelFrame(handle) {
    if (handle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    }
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
    requestFrame(() => syncScrollEdges(row));
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
    let observerMargin = "";
    let edgesFrame = null;
    let resizeFrame = null;
    let bootOuter = null;
    let bootInner = null;
    const activate = (index) => {
      if (index === current) {
        return;
      }
      const previous = current;
      current = index;
      if (previous >= 0) {
        links[previous]?.removeAttribute("aria-current");
      }
      const link = links[index];
      if (link) {
        link.setAttribute("aria-current", "true");
        revealLink(row, link);
        syncScrollEdges(row);
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
    const observerOptions = () => {
      const height = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      return {
        rootMargin: `0px 0px -${Math.max(0, height - readingLine())}px 0px`
      };
    };
    const observe = () => {
      if (typeof IntersectionObserver === "undefined") {
        return;
      }
      const options = observerOptions();
      const margin = options.rootMargin ?? "";
      if (observer !== null && margin === observerMargin) {
        return;
      }
      observer?.disconnect();
      observerMargin = margin;
      observer = new IntersectionObserver(() => activate(pick()), options);
      for (const section of sections) {
        observer.observe(section);
      }
    };
    const syncEdges = () => {
      syncScrollEdges(row);
    };
    const scheduleEdges = () => {
      if (edgesFrame !== null) {
        return;
      }
      edgesFrame = requestFrame(() => {
        edgesFrame = null;
        syncEdges();
      });
    };
    const applyResize = () => {
      observe();
      activate(pick());
      syncEdges();
    };
    const scheduleResize = () => {
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = requestFrame(() => {
        resizeFrame = null;
        applyResize();
      });
    };
    const release = () => {
      for (const frame of [edgesFrame, resizeFrame, bootOuter, bootInner]) {
        cancelFrame(frame);
      }
      edgesFrame = null;
      resizeFrame = null;
      bootOuter = null;
      bootInner = null;
      observer?.disconnect();
      observer = null;
    };
    activate(pick());
    row.addEventListener("scroll", scheduleEdges, { passive: true, signal });
    bootOuter = requestFrame(() => {
      bootOuter = null;
      bootInner = requestFrame(() => {
        bootInner = null;
        syncEdges();
        observe();
      });
    });
    window.addEventListener("resize", scheduleResize, { passive: true, signal });
    signal.addEventListener("abort", release, { once: true });
    return activate;
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
  function setStyle(panel, property, value) {
    if (panel.style[property] !== value) {
      panel.style[property] = value;
    }
  }
  function placePanel(panel, placement) {
    const view = viewport();
    const { anchor } = placement;
    const gap = placement.gap ?? ANCHOR_GAP;
    setStyle(panel, "right", "auto");
    if (anchor === null) {
      const size = boxSize(panel);
      const left = view.width > 0 ? (view.width - size.width) / 2 + view.left : 0;
      const top = view.height > 0 ? (view.height - size.height) / 2 + view.top : 0;
      setStyle(panel, "left", `${Math.round(Math.max(view.left + PANEL_MARGIN, left))}px`);
      setStyle(panel, "top", `${Math.round(Math.max(view.top + PANEL_MARGIN, top))}px`);
      setStyle(panel, "maxHeight", view.height > 0 ? `${view.height - PANEL_MARGIN * 2}px` : "");
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const natural = boxSize(panel);
    const width = placement.minWidth === undefined ? natural.width : Math.min(Math.max(rect.width, placement.minWidth), Math.max(240, view.width - PANEL_MARGIN * 2));
    if (placement.minWidth !== undefined) {
      setStyle(panel, "width", `${Math.round(width)}px`);
    }
    const rawLeft = placement.align === "end" ? rect.right - width : rect.left;
    const left = view.width > 0 ? clamp(rawLeft, view.left + PANEL_MARGIN, view.left + view.width - width - PANEL_MARGIN) : rawLeft;
    setStyle(panel, "left", `${Math.round(left)}px`);
    const below = view.height > 0 ? view.top + view.height - rect.bottom - PANEL_MARGIN : 0;
    const above = view.height > 0 ? rect.top - view.top - PANEL_MARGIN : 0;
    const needed = natural.height + gap;
    const openBelow = view.height === 0 || needed <= below || below >= above;
    const room = openBelow ? below : above;
    const maxHeight = room > 0 ? Math.max(placement.fit?.floor ?? 0, room - gap) : 0;
    setStyle(panel, "maxHeight", maxHeight > 0 ? `${Math.round(maxHeight)}px` : "");
    if (openBelow) {
      setStyle(panel, "top", `${Math.round(rect.bottom + gap)}px`);
      setStyle(panel, "bottom", "auto");
    } else {
      setStyle(panel, "top", "auto");
      setStyle(panel, "bottom", `${Math.round(view.top + view.height - rect.top + gap)}px`);
    }
  }

  // src/ui/popover.ts
  var stack = [];
  var boundDocument2 = null;
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
    if (boundDocument2 === document2) {
      return;
    }
    boundDocument2 = document2;
    document2.addEventListener("pointerdown", onPointerDown, true);
    document2.addEventListener("keydown", onKeyDown, true);
  }
  function openPopover(request) {
    const { content, anchor, role = "dialog", align = "start", minWidth } = request;
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
    let frame = null;
    const controller = new AbortController;
    const { signal } = controller;
    const cancelPosition = () => {
      cancelFrame(frame);
      frame = null;
    };
    const close = (restoreFocus = true) => {
      if (!open) {
        return;
      }
      open = false;
      cancelPosition();
      controller.abort();
      const index = stack.findIndex((entry) => entry.panel === panel);
      if (index >= 0) {
        stack.splice(index, 1);
      }
      const active = document.activeElement;
      const heldFocus = restoreFocus && (active === null || active === undefined || panel.contains(active));
      panel.remove();
      if (anchor !== null && anchor.getAttribute("aria-haspopup") !== null) {
        anchor.setAttribute("aria-expanded", "false");
      }
      if (anchor !== null && heldFocus && typeof anchor.focus === "function") {
        anchor.focus();
      }
      request.onClose?.();
    };
    const place = () => {
      if (open) {
        placePanel(panel, { anchor, align, minWidth, fit: { floor: 120 } });
      }
    };
    const reposition = () => {
      if (!open || frame !== null) {
        return;
      }
      frame = requestFrame(() => {
        frame = null;
        place();
      });
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
    if (anchor !== null && anchor.getAttribute("aria-haspopup") !== null) {
      anchor.setAttribute("aria-expanded", "true");
    }
    const repositionOnScroll = (event) => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) {
        return;
      }
      reposition();
    };
    window.addEventListener("resize", reposition, { signal });
    window.addEventListener("scroll", repositionOnScroll, {
      capture: true,
      passive: true,
      signal
    });
    if (typeof window !== "undefined" && window.visualViewport) {
      window.visualViewport.addEventListener("resize", reposition, { signal });
      window.visualViewport.addEventListener("scroll", repositionOnScroll, { signal });
    }
    if (request.signal !== undefined) {
      request.signal.addEventListener("abort", () => close(false), { once: true, signal });
    }
    place();
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
      const node = item.href === undefined ? buttonEl({
        class: "action-menu-item",
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
  function signItems(term, text, index, onSearch) {
    const items = [];
    for (const sign of TAG_SIGNS) {
      if (term.sign === sign) {
        continue;
      }
      items.push({
        label: SIGN_PRESENTATION[sign].action,
        run: () => onSearch(setTermSign(text, term, sign), { type: "toggle", index })
      });
    }
    items.push({
      label: "Remove",
      run: () => onSearch(removeTerm(text, term), { type: "remove", index })
    });
    return items;
  }
  function createChipNode(term) {
    const node = el("span", {
      class: SIGN_PRESENTATION[term.sign].chipClass
    });
    const toggle = buttonEl({
      class: "term-toggle",
      "aria-label": `${termLabel(term)}, ${SIGN_PRESENTATION[term.sign].state}. Remove from search. Right-click to include, exclude or make optional.`,
      title: "Click to remove · Right-click to include, exclude or make optional",
      "aria-haspopup": "menu",
      "aria-expanded": "false"
    });
    toggle.append(el("span", {
      class: "term-sign",
      "aria-hidden": "true",
      text: SIGN_PRESENTATION[term.sign].glyph
    }));
    if (term.ns) {
      toggle.append(el("span", {
        class: `term-ns ns-${term.ns.id}`,
        text: term.ns.label
      }));
    }
    toggle.append(el("span", { class: "term-value", text: termLabel(term) }));
    node.append(toggle);
    return { node, toggle };
  }
  function linkAbort(controller, signal) {
    if (signal === undefined) {
      return;
    }
    if (signal.aborted) {
      controller.abort();
      return;
    }
    const forward = () => controller.abort();
    signal.addEventListener("abort", forward, { once: true });
    controller.signal.addEventListener("abort", () => signal.removeEventListener("abort", forward), {
      once: true
    });
  }
  function createSearchChips(onSearch, signal) {
    const row = el("div", {
      class: "search-filters",
      role: "group",
      "aria-label": "Active search filters"
    });
    const clear = buttonEl({ class: "search-filters-clear", text: "Clear", title: "Clear search" });
    row.append(clear);
    const lifecycle = new AbortController;
    linkAbort(lifecycle, signal);
    clear.addEventListener("click", () => onSearch("", { type: "clear" }), {
      signal: lifecycle.signal
    });
    trackScrollEdges(row, lifecycle.signal);
    let entries = [];
    let text = "";
    let renderController = null;
    let destroyed = false;
    function bind(entry, controller) {
      const { toggle } = entry;
      toggle.addEventListener("click", () => {
        const index = entries.indexOf(entry);
        if (index < 0) {
          return;
        }
        onSearch(removeTerm(text, entry.term), { type: "remove", index });
      }, { signal: controller.signal });
      bindContextMenu(toggle, () => openActionMenu({
        anchor: toggle,
        label: `Actions for ${termLabel(entry.term)}`,
        items: signItems(entry.term, text, entries.indexOf(entry), onSearch),
        signal: controller.signal
      }), controller.signal);
    }
    function reconcile(next, oldNodes) {
      const nextNodes = next.map((entry) => entry.node);
      let prefix = 0;
      const limit = Math.min(oldNodes.length, nextNodes.length);
      while (prefix < limit && oldNodes[prefix] === nextNodes[prefix]) {
        prefix += 1;
      }
      let suffix = 0;
      while (suffix < limit - prefix && oldNodes[oldNodes.length - 1 - suffix] === nextNodes[nextNodes.length - 1 - suffix]) {
        suffix += 1;
      }
      const tail = suffix > 0 ? oldNodes[oldNodes.length - suffix] : undefined;
      const reference = tail ?? clear;
      for (let index = prefix;index < oldNodes.length - suffix; index += 1) {
        oldNodes[index]?.remove();
      }
      for (let index = prefix;index < nextNodes.length - suffix; index += 1) {
        const node = nextNodes[index];
        if (node !== undefined) {
          row.insertBefore(node, reference);
        }
      }
    }
    function update(nextText) {
      if (destroyed) {
        return false;
      }
      text = nextText;
      const terms = parseSearchTerms(nextText);
      if (terms.length === 0) {
        renderController?.abort();
        renderController = null;
        for (const entry of entries) {
          entry.node.remove();
        }
        entries = [];
        return false;
      }
      const wanted = terms.map((term) => ({
        term,
        key: [term.sign, term.ns?.id ?? "", term.ns?.label ?? "", termLabel(term)].join("\x00")
      }));
      if (entries.length === wanted.length && entries.every((entry, index) => entry.key === wanted[index]?.key)) {
        for (const [index, entry] of entries.entries()) {
          const nextTerm = wanted[index]?.term;
          if (nextTerm !== undefined) {
            entry.term = nextTerm;
          }
        }
        return true;
      }
      const previous = entries;
      const obsolete = renderController;
      obsolete?.abort();
      const controller = new AbortController;
      linkAbort(controller, signal);
      renderController = controller;
      const pool = new Map;
      for (const entry of previous) {
        const bucket = pool.get(entry.key);
        if (bucket === undefined) {
          pool.set(entry.key, [entry]);
        } else {
          bucket.push(entry);
        }
      }
      const next = wanted.map(({ term, key }) => {
        const reused = pool.get(key)?.shift();
        if (reused !== undefined) {
          reused.term = term;
          bind(reused, controller);
          return reused;
        }
        const { node, toggle } = createChipNode(term);
        const entry = { key, term, node, toggle };
        bind(entry, controller);
        return entry;
      });
      reconcile(next, previous.map((entry) => entry.node));
      entries = next;
      return true;
    }
    return {
      element: row,
      update,
      destroy() {
        destroyed = true;
        renderController?.abort();
        renderController = null;
        lifecycle.abort();
        entries = [];
        row.remove();
      }
    };
  }

  // src/data/quick-tags.ts
  var KEY2 = "eh:saved-expressions:v1";
  var VERSION4 = 1;
  var QUICK_TAG_LIMIT = 30;
  function isQuickTag(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value;
    return typeof record.name === "string" && typeof record.query === "string" && typeof record.savedAt === "number";
  }
  var store2 = createStore({ key: KEY2, version: VERSION4, empty: () => [], guard: isUnknownArray }, gmStorage());
  var quickTagsChanged = createEmitter();
  function subscribeQuickTags(listener) {
    return quickTagsChanged.subscribe(listener);
  }
  function notify2() {
    quickTagsChanged.emit();
  }
  function cleanTags(values) {
    return values.map((entry) => ({
      name: collapseWhitespace(entry.name),
      query: collapseWhitespace(entry.query),
      savedAt: entry.savedAt
    })).filter((entry) => entry.name !== "" && entry.query !== "");
  }
  function quickTags() {
    return cleanTags(store2.read().filter(isQuickTag)).sort((a, b) => b.savedAt - a.savedAt).slice(0, QUICK_TAG_LIMIT);
  }
  function removeQuickTag(name) {
    const key = collapseWhitespace(name).toLowerCase();
    store2.write(quickTags().filter((entry) => entry.name.toLowerCase() !== key));
    notify2();
  }
  function replaceQuickTags(tags) {
    store2.write(cleanTags(tags).slice(0, QUICK_TAG_LIMIT));
    notify2();
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

  // src/tags/core-vocabulary.ts
  var CORE_VOCABULARY_BASE64 = "RUhUSQEMAAZmZW1hbGXIAAAAAAZhaGVnYW8BBm1wdXRlZQEDbmFsBAwgaW50ZXJjb3Vyc2UBBHByb24ABGJhbGQBAmJ3AQNkc20B" + "CmVhdXR5IG1hcmsCCHN0aWFsaXR5AQppZyBhcmVvbGFlBQJzcwQFYmFsbHMFBnJlYXN0cwQHbmlwcGxlcwQFcGVuaXMCBGtpbmkC" + "BnNleHVhbAEIbGFja21haWwCB2luZGZvbGQCA29vZAQEbWVycwMEd2pvYgcFIGZhY2UBEG9keSBtb2RpZmljYXRpb24FB3dyaXRp" + "bmcEBHN1aXQCBW5kYWdlAQ9yZWFzdCBleHBhbnNpb24HB2ZlZWRpbmcCA2lkZQEGdWtrYWtlAghubnkgZ2lybAILc2luZXNzIHN1" + "aXQAB2NhdGdpcmwBDGhhc3RpdHkgYmVsdAIGZWF0aW5nAgtpbmVzZSBkcmVzcwIHcmlzdG1hcwEFb2xsYXICBG5kb20CCHJydXB0" + "aW9uAghzcGxheWluZwIFd2dpcmwBDHJvc3NkcmVzc2luZwMKdGNoIHRhdHRvbwEJdW1mbGF0aW9uAglubmlsaW5ndXMADGRhcmsg" + "bmlwcGxlcwUEc2tpbgIGdWdodGVyAQllZXB0aHJvYXQCCWZsb3JhdGlvbgIIbW9uIGdpcmwBE2lja2dpcmwgb24gZGlja2dpcmwM" + "BmZlbWFsZQECb2cDBSBnaXJsAhB1YmxlIHBlbmV0cmF0aW9uAQRydWdzAANlbGYBDHhoaWJpdGlvbmlzbQIOcG9zZWQgY2xvdGhp" + "bmcBEHllLWNvdmVyaW5nIGJhbmcDBXBhdGNoAAtmYWNlc2l0dGluZwMIaWFsIGhhaXIBC2VtYWxlcyBvbmx5AwNkb20BBmlsbWlu" + "ZwIHbmdlcmluZwIWcnN0IHBlcnNvbiBwZXJzcGVjdGl2ZQIGc2huZXRzAwR0aW5nAQZvb3Rqb2ICBnggZ2lybAEHcmVja2xlcwEE" + "dXJyeQIGdGFuYXJpAANnYWcCBHBpbmcCCXJ0ZXIgYmVsdAEMZW5kZXIgY2hhbmdlAQdpYW50ZXNzAQZsYXNzZXMCBG92ZXMBBW9i" + "bGluAgRra3VuAQRyb3VwAQN1cm8BBHlhcnUACWhhaXIgYnVucwQBeQUIIGFybXBpdHMCAmxvAgVuZGpvYgIDcmVtAQlpZ2ggaGVl" + "bHMBBG9ybnMDAnNlBQUgZ2lybAIGdHBhbnRzAQt1Z2UgYnJlYXN0cwUFcGVuaXMCDG1hbiBvbiBmdXJyeQMIaWxpYXRpb24ADGlt" + "cHJlZ25hdGlvbgEFbmNlc3QCB2ZsYXRpb24CDnZlcnRlZCBuaXBwbGVzAAprZW1vbm9taW1pAQVpbW9ubwIFc3NpbmcACWxhY3Rh" + "dGlvbgIKcmdlIHRhdHRvbwIDdGV4AQRlYXNoAgVvdGFyZAEHaW5nZXJpZQEGb2xpY29uAAxtYWdpY2FsIGdpcmwCAmlkAgRrZXVw" + "Aglza2VkIGZhY2UDCXR1cmJhdGlvbgEDaWxmAwRraW5nAghuZCBicmVhawUHY29udHJvbAELb25zdGVyIGdpcmwCBHRoZXIBBXVz" + "Y2xlAAluYWthZGFzaGkBB2V0b3JhcmUBCmlwcGxlIGZ1Y2sHCHBpZXJjaW5nBwtzdGltdWxhdGlvbgECdW4CA3JzZQAKb3BwYWkg" + "bG9saQECcmMADXBhaW50ZWQgbmFpbHMDBHp1cmkCB250eWhvc2UCBXN0aWVzARBlbmlzIGVubGFyZ2VtZW50AQdpZXJjaW5nAgd4" + "aWUgY3V0AQdvbnl0YWlsAQdyZWduYW50Agpvc3RpdHV0aW9uAARyYXBlAQVpbWpvYgEEb2JvdAEEeW9uYQAEc2NhdAINaG9vbCBz" + "d2ltc3VpdAYLYm95IHVuaWZvcm0GDGdpcmwgdW5pZm9ybQEHZXggdG95cwEGaGVtYWxlAgVpYmFyaQEFaXN0ZXIBBGxhdmUCBmVl" + "cGluZwEMbWFsbCBicmVhc3RzBgVwZW5pcwIDZWxsAQRudWZmAQxvbGUgZGlja2dpcmwFBmZlbWFsZQEHcGFua2luZwEIcXVpcnRp" + "bmcBCHRvY2tpbmdzAxBtYWNoIGRlZm9ybWF0aW9uAgZyYXAtb24BB3dlYXRpbmcCBmltc3VpdAAEdGFpbAIHbGwgZ2lybAIGbmxp" + "bmVzAQZlYWNoZXICB250YWNsZXMBD2hpZ2ggaGlnaCBib290cwEFb21ib3kCBXJ0dXJlAQ1yYW5zZm9ybWF0aW9uAQh3aW50YWls" + "cwAOdW51c3VhbCBwdXBpbHMBEHJldGhyYSBpbnNlcnRpb24CB2luYXRpb24ADXZhZ2luYWwgYmlydGgBDWVyeSBsb25nIGhhaXIB" + "A29yZQEFdHViZXIABXdpbmdzAgN0Y2gBCG9sZiBnaXJsAAV4LXJheQAEeXVyaQRtYWxlyAAAAAAGYWhlZ2FvAQZtcHV0ZWUBA25h" + "bAQMIGludGVyY291cnNlAQRwcm9uAQtzcGh5eGlhdGlvbgAEYmFsZAECYm0BA2RzbQEKZWF1dHkgbWFyawIIc3RpYWxpdHkBCmln" + "IGFyZW9sYWUFAnNzBAViYWxscwUGcmVhc3RzBARsaXBzBAduaXBwbGVzBAVwZW5pcwIEa2luaQIGc2V4dWFsAQhsYWNrbWFpbAIH" + "aW5kZm9sZAIDb29kBARtZXJzAwR3am9iBwUgZmFjZQEQb2R5IG1vZGlmaWNhdGlvbgUHd3JpdGluZwQEc3VpdAIFbmRhZ2UBD3Jl" + "YXN0IGV4cGFuc2lvbgcHZmVlZGluZwIDaWRlAQZ1a2tha2UCC3NpbmVzcyBzdWl0AAZjYXRib3kBDGhhc3RpdHkgYmVsdAIGZWF0" + "aW5nAgtpbmVzZSBkcmVzcwIHcmlzdG1hcwEFb2xsYXICBG5kb20CCHJydXB0aW9uAghzcGxheWluZwEMcm9zc2RyZXNzaW5nAwp0" + "Y2ggdGF0dG9vAQl1bWZsYXRpb24CCW5uaWxpbmd1cwAMZGFyayBuaXBwbGVzBQRza2luAQllZXB0aHJvYXQCA21vbgEPaWNrZ2ly" + "bCBvbiBtYWxlAgJsZgECb2cDBCBib3kCEHVibGUgcGVuZXRyYXRpb24BBHJ1Z3MDAm5rAANlbGYBDHhoaWJpdGlvbmlzbQIOcG9z" + "ZWQgY2xvdGhpbmcBEHllLWNvdmVyaW5nIGJhbmcDBG1hc2sDBXBhdGNoAAtmYWNlc2l0dGluZwMIaWFsIGhhaXIBC2VtaW5pemF0" + "aW9uAQZpbG1pbmcCFnJzdCBwZXJzb24gcGVyc3BlY3RpdmUCBnNobmV0cwMEdGluZwEJb2N1cyBhbmFsAgpvdCBsaWNraW5nBANq" + "b2ICBXggYm95AQdyZWNrbGVzAQR1cnJ5AANnYWcCBHBpbmcCCXJ0ZXIgYmVsdAEMZW5kZXIgY2hhbmdlAQZsYXNzZXMCBG92ZXMB" + "BW9ibGluAgRra3VuAQRyb3VwAQN1cm8ACWhhaXIgYnVucwQBeQUIIGFybXBpdHMCAmxvAgVuZGpvYgIDcmVtAQlpZGRlbiBzZXgC" + "CGdoIGhlZWxzAQRvcm5zAwJzZQIGdHBhbnRzAQl1Z2UgcGVuaXMCDG1hbiBvbiBmdXJyeQMIaWxpYXRpb24ADGltcHJlZ25hdGlv" + "bgEFbmNlc3QCB2ZsYXRpb24CBHNla2kCDnZlcnRlZCBuaXBwbGVzAAprZW1vbm9taW1pAQVpbW9ubwIFc3NpbmcACWxhY3RhdGlv" + "bgIOcmdlIGluc2VydGlvbnMGBnRhdHRvbwIDdGV4AQRlYXNoAgZnIGxvY2sCBW90YXJkAQdpbmdlcmllAgh6YXJkIGd1eQEKb25n" + "IHRvbmd1ZQAMbWFnaWNhbCBnaXJsAgJpZAIEa2V1cAIIbGVzIG9ubHkCCXNrZWQgZmFjZQMJdHVyYmF0aW9uAQNpa28CBWxraW5n" + "AghuZCBicmVhawUHY29udHJvbAEGb25zdGVyAQV1c2NsZQAJbmFrYWRhc2hpAQdldG9yYXJlAQppcHBsZSBmdWNrBwhwaWVyY2lu" + "ZwcLc3RpbXVsYXRpb24BAnVuAgNyc2UAB29sZCBtYW4BAnJjAA1wYWludGVkIG5haWxzAwR6dXJpAgdudHlob3NlAgVzdGllcwEQ" + "ZW5pcyBlbmxhcmdlbWVudAIFdHBsYXkBB2llcmNpbmcCB3hpZSBjdXQBB29ueXRhaWwBB3JlZ25hbnQCCm9zdGl0dXRpb24ABHJh" + "cGUBBWltam9iAQRvYm90AQR5b25hAARzY2F0Ag1ob29sIHN3aW1zdWl0Bgtib3kgdW5pZm9ybQYMZ2lybCB1bmlmb3JtAQdleCB0" + "b3lzAQZoaWJhcmkCBm90YWNvbgEEbGF2ZQIGZWVwaW5nAQptYWxsIHBlbmlzAgNlbGwBBG51ZmYBCG9sZSBtYWxlAQdwYW5raW5n" + "AQh0b2NraW5ncwMQbWFjaCBkZWZvcm1hdGlvbgIGcmFwLW9uAQd3ZWF0aW5nAgZpbXN1aXQABHRhaWwCBmxsIG1hbgIGbmxpbmVz" + "AQZlYWNoZXICB250YWNsZXMBD2hpZ2ggaGlnaCBib290cwEEaWFyYQEGb21naXJsAgVydHVyZQENcmFuc2Zvcm1hdGlvbgEId2lu" + "dGFpbHMADnVudXN1YWwgcHVwaWxzARByZXRocmEgaW5zZXJ0aW9uAgdpbmF0aW9uAA12YWdpbmFsIGJpcnRoAQ1lcnkgbG9uZyBo" + "YWlyAQhpcmdpbml0eQEDb3JlAgd5ZXVyaXNtAQV0dWJlcgAFd2luZ3MCA3RjaAEHb2xmIGJveQAFeC1yYXkABHlhb2kFbWl4ZWQX" + "AAAAABBhbmltYWwgb24gYW5pbWFsAAlib2R5IHN3YXAADWZmbSB0aHJlZXNvbWUBB3JvdHRhZ2UACWdhbmcgcmFwZQEEcm91cAAG" + "aW5jZXN0AgRzZWtpAA1rb2RvbW8gZG91c2hpAApsb3cgaW5jZXN0AA1tbWYgdGhyZWVzb21lAgt0IHRocmVlc29tZQEMdGYgdGhy" + "ZWVzb21lARF1bHRpbW91dGggYmxvd2pvYgUKcGxlIGFzc2pvYgkHZm9vdGpvYgkHaGFuZGpvYgkIcGFpcmluZ3MABm51ZGlzbQAI" + "b3lha29kb24ACXNoaW1haWRvbgANdHRtIHRocmVlc29tZQEEd2lucwVvdGhlcjwAAAAAAjNkAgkgaW1hZ2VzZXQADGFpIGdlbmVy" + "YXRlZAEPbHJlYWR5IHVwbG9hZGVkAQduYWdseXBoAgZpbWF0ZWQCB3Rob2xvZ3kBBnJ0Ym9vawAHY2FwdGlvbgEEb21pYwMIcGls" + "YXRpb24ACmRha2ltYWt1cmEBBmVmYWNlZAAOZXh0cmFuZW91cyBhZHMABmZpZ3VyZQEQb3JiaWRkZW4gY29udGVudAEOdWxsIGNl" + "bnNvcnNoaXAGBG9sb3IACWdvdWRvdXNoaQAIaGFyZGNvcmUBBW93IHRvAAppbmNvbXBsZXRlAAtrb2RvbW8gb25seQANbWlzc2lu" + "ZyBjb3ZlcgEQb3NhaWMgY2Vuc29yc2hpcAEQdWx0aS13b3JrIHNlcmllcwUOcGFuZWwgc2VxdWVuY2UADm5vIHBlbmV0cmF0aW9u" + "Ag9uLWggZ2FtZSBtYW51YWwGCGltYWdlc2V0BARudWRlAgN2ZWwBCnVkaXR5IG9ubHkAFW9iamVjdCBpbnNlcnRpb24gb25seQEL" + "dXQgb2Ygb3JkZXIACnBhcGVyY2hpbGQBCGl4ZWwgYXJ0AAhyZWFscG9ybgIEZHJhdwIGcGxhY2VkAQxvdWdoIGdyYW1tYXIGC3Ry" + "YW5zbGF0aW9uAAZzYW1wbGUBB2Nhbm1hcmsCCXJlZW5zaG90cwELa2V0Y2ggbGluZXMBCW91c2h1dWhlbgELdGVyZW9zY29waWMC" + "B29yeSBhcmMACXRhbmtvdWJvbgEIaGVtZWxlc3MBCGltZSBzdG9wAAp1bmNlbnNvcmVkAAt2YXJpYW50IHNldAALd2F0ZXJtYXJr" + "ZWQBBmVidG9vbgIIc3Rlcm4gY2cICGltYWdlc2V0CAVub24taAAHeXVra3VyaQhsb2NhdGlvbggAAAAADGJhdGhpbmcgcm9vbQEE" + "ZWFjaAAJY2xhc3Nyb29tAAlpbmZpcm1hcnkABW9uc2VuAAVzYXVuYQEFZW50b3UBDHdpbW1pbmcgcG9vbAZwYXJvZHnIAAAAAA5h" + "ZHZlbnR1cmUgdGltZQEHbXBoaWJpYQEObmltYWwgY3Jvc3NpbmcBCHJrbmlnaHRzCQkgZW5kZmllbGQBC3RlbGllciByeXphARh2" + "YXRhciB0aGUgbGFzdCBhaXJiZW5kZXICBmVuZ2VycwEIenVyIGxhbmUADmJha2Vtb25vZ2F0YXJpAghuZyBkcmVhbQIEdG1hbgIH" + "eW9uZXR0YQEFZW4gMTABCGxhY2sgY2F0AgRlYWNoAgp1ZSBhcmNoaXZlAQ5vY2NoaSB0aGUgcm9jawIEcnV0bwARY2FyZGNhcHRv" + "ciBzYWt1cmEBC2hhaW5zYXcgbWFuAQlvZGUgZ2Vhc3MBCHliZXJwdW5rAAhkYW5kYWRhbgMIZ2Fucm9ucGECCnJrc3RhbGtlcnMD" + "EmxpbmcgaW4gdGhlIGZyYW54eAIJdGUgYSBsaXZlAQxlYWQgb3IgYWxpdmUCB2x0YXJ1bmUCDXRlY3RpdmUgY29uYW4BBmlnaW1v" + "bgEKcmFnb24gYmFsbAsGIHN1cGVyDAF6BwVxdWVzdAE2dW5nZW9uIG5pIGRlYWkgbyBtb3RvbWVydSBubyB3YSBtYWNoaWdhdHRl" + "aXJ1IGRhcm91IGthAAplbGRlbiByaW5nAQ5xdWVzdHJpYSBnaXJscwAKZmFpcnkgdGFpbAIFbGxvdXQCDnRlIGdyYW5kIG9yZGVy" + "BRlrYWxlaWQgbGluZXIgcHJpc21hIGlsbHlhBQpzdGF5IG5pZ2h0AQxpbmFsIGZhbnRhc3kNBCB2aWkOA3hpdgIJcmUgZW1ibGVt" + "CwYgZmF0ZXMMDHRocmVlIGhvdXNlcwIUdmUgbmlnaHRzIGF0IGZyZWRkeXMBBXJvemVuARJ1bGxtZXRhbCBhbGNoZW1pc3QADmdl" + "bnNoaW4gaW1wYWN0AQ5pcmxzIGZyb250bGluZQYKdW5kIHBhbnplcgEMb2JsaW4gc2xheWVyAhhjaHV1bW9uIHdhIHVzYWdpIGRl" + "c3Uga2ECFmRkZXNzIG9mIHZpY3Rvcnkgbmlra2UCEnRvdWJ1biBubyBoYW5heW9tZQEPcmFuYmx1ZSBmYW50YXN5Awp2aXR5IGZh" + "bGxzAQp1aWx0eSBnZWFyAgRuZGFtBgUgc2VlZAAEaGFsbwIKcnJ5IHBvdHRlcgIKemJpbiBob3RlbAEIZWxsdGFrZXIECHV2YSBi" + "b3NzAQ1pZ2hzY2hvb2wgZHhkCwtvZiB0aGUgZGVhZAIDbGRhAQdvbG9saXZlAgtua2FpIGdha3VlbgcJc3RhciByYWlsARZ5cGVy" + "ZGltZW5zaW9uIG5lcHR1bmlhABdpamlyYW5haWRlIG5hZ2F0b3JvLXNhbgEPbmZpbml0ZSBzdHJhdG9zAgZ1eWFzaGEADmp1anV0" + "c3Uga2Fpc2VuAgxzdGljZSBsZWFndWUABGstb24BGWFndXlhLXNhbWEgd2Ega29rdXJhc2V0YWkCEW5vam8gb2thcmlzaGltYXN1" + "Aw50YWkgY29sbGVjdGlvbgENZW1vbm8gZnJpZW5kcwELaWxsIGxhIGtpbGwCCm0gcG9zc2libGUDDWV0c3Ugbm8geWFpYmECDm5n" + "IG9mIGZpZ2h0ZXJzAR9vYmF5YXNoaS1zYW4tY2hpIG5vIG1haWQgZHJhZ29uAgZpa2F0c3UCGW1pLXNhbiB3YSBrb215dXNob3Ug" + "ZGVzdS4CIm5vIHN1YmFyYXNoaWkgc2VrYWkgbmkgc3l1a3VmdWt1IG8AC2xhc3Qgb3JpZ2luARBlYWd1ZSBvZiBsZWdlbmRzAQhv" + "dmUgbGl2ZQkhIG5pamlnYXNha2kgaGlnaCBzY2hvb2wgaWRvbCBjbHViCghzdW5zaGluZQENeWNvcmlzIHJlY29pbAAbbWFob3Ug" + "c2hvdWpvIGx5cmljYWwgbmFub2hhAglzcyBlZmZlY3QBBmV0cm9pZAEGb25zdGVyBwcgaHVudGVyAQ11c2hva3UgdGVuc2VpAQ95" + "IGhlcm8gYWNhZGVtaWEDH2xpdHRsZSBwb255IGZyaWVuZHNoaXAgaXMgbWFnaWMABm5hcnV0bwEWZW9uIGdlbmVzaXMgZXZhbmdl" + "bGlvbgEMaWVyIGF1dG9tYXRhAgdqaXNhbmppAAlvbmUgcGllY2UFCHVuY2ggbWFuAStyZSBubyBpbW91dG8gZ2Ega29ubmEgbmkg" + "a2F3YWlpIHdha2UgZ2EgbmFpAgZpZ2luYWwBCXNoaSBubyBrbwEHdmVybG9yZAQFd2F0Y2gAInBhbnR5IGFuZCBzdG9ja2luZyB3" + "aXRoIGdhcnRlcmJlbHQBBmVyc29uYQcCIDMIATQIATUBBm9rZW1vbgEKcmV0dHkgY3VyZQIOaW5jZXNzIGNvbm5lY3QBGHVlbGxh" + "IG1hZ2kgbWFkb2thIG1hZ2ljYQAMcXVlZW5zIGJsYWRlAAhyYW5tYSAxMgEkZSB6ZXJvIGthcmEgaGFqaW1lcnUgaXNla2FpIHNl" + "aWthdHN1AgtzaWRlbnQgZXZpbAIFd3JpdGUBA3dieQALc2FpbG9yIG1vb24BCWNvb2J5LWRvbwEXZW5raSB6ZXNzaG91IHN5bXBo" + "b2dlYXIDCnJhbiBrYWd1cmEBBmhhbnRhZQIQaW5nZWtpIG5vIGt5b2ppbgIPb2t1Z2VraSBubyBzb21hARFvbmljIHRoZSBoZWRn" + "ZWhvZwMbbyBiaXNxdWUgZG9sbCB3YSBrb2kgbyBzdXJ1Agl1bGNhbGlidXIDDnNvdSBubyBmcmllcmVuAQlwaWRlci1tYW4CBmxh" + "dG9vbgIKeSB4IGZhbWlseQELc3NzLmdyaWRtYW4BB3RhciBmb3gFFnZzLiB0aGUgZm9yY2VzIG9mIGV2aWwFBHdhcnMCDWV2ZW4g" + "dW5pdmVyc2UCDHJlZXQgZmlnaHRlcgMLaWtlIHdpdGNoZXMBE3VwZXIgbWFyaW8gYnJvdGhlcnMFA21hbgEPd29yZCBhcnQgb25s" + "aW5lAA50YWltYW5pbiBhc2FnaQkIeXVraWthemUCGXRlIG5vIHl1dXNoYSBubyBuYXJpYWdhcmkBCmVlbiB0aXRhbnMEGGFnZSBt" + "dXRhbnQgbmluamEgdHVydGxlcwIEa2tlbgIYbmdlbiB0b3BwYSBndXJyZW4gbGFnYW5uAxtzZWkgc2hpdGFyYSBzbGltZSBkYXR0" + "YSBrZW4BEGhlIGVsZGVyIHNjcm9sbHMEEWZhaXJseSBvZGRwYXJlbnRzBAppZG9sbWFzdGVyBQpuY3JlZGlibGVzBA9sZWdlbmQg" + "b2Yga29ycmEOBXplbGRhBQlvdWQgaG91c2UEHW1lbGFuY2hvbHkgb2YgaGFydWhpIHN1enVtaXlhBAlvd2wgaG91c2UECHNpbXBz" + "b25zBAd3aXRjaGVyAQlvIGxvdmUtcnUCC2FydSBwcm9qZWN0AjVraWRva2kgYm9zb3R0byBydXNzaWEtZ28gZGUgZGVyZXJ1IHRv" + "bmFyaSBubyBhbHlhLXNhbgIJbWIgcmFpZGVyAgx1aG91IHByb2plY3QBCHN1a2loaW1lAAh1bHRyYW1hbgEWbWEgbXVzdW1lIHBy" + "ZXR0eSBkZXJieQEIbmRlcnRhbGUBFXpha2ktY2hhbiB3YSBhc29iaXRhaQAIdm9jYWxvaWQACXdhcmhhbW1lcgELb25kZXIgd29t" + "YW4CD3JsZCBvZiB3YXJjcmFmdAEOdXRoZXJpbmcgd2F2ZXMABXgtbWVuARVlbm9ibGFkZSBjaHJvbmljbGVzIDIAMHlhaGFyaSBv" + "cmUgbm8gc2Vpc2h1biBsb3ZlIGNvbWUgd2EgbWFjaGlnYXR0ZWlydQEub3Vrb3NvIGppdHN1cnlva3Ugc2hpam91IHNodWdpIG5v" + "IGt5b3VzaGl0c3UgZQEHdS1naS1vaAARemVubGVzcyB6b25lIHplcm8BB29vdG9waWEJY2hhcmFjdGVyyAAAAAACMmIACGFkYSB3" + "b25nARJlcml0aCBnYWluc2Jvcm91Z2gCBHRoZXIBA2hyaQEHa28gYW1hdQEFbGJlZG8CDmljZSBtYXJnYXRyb2lkAQdteSByb3Nl" + "AQluZHJvaWQgMTgCA2dlbAEIcHBsZWphY2sBA3F1YQEJcmxlY2NoaW5vAg90b3JpYSBwZW5kcmFnb24BBnN0b2xmbwIRdWthIGxh" + "bmdsZXkgc29yeXUDC25hIGljaGlub3NlBgV5dXVraQEEdGFnbwENeWEgc2hhbWVpbWFydQMLa2Ega2FtaXNhdG8ADGJhcmJhcmEg" + "cGVnZwIEdG1hbgIHeW9uZXR0YQEEZWxsZQEKb2EgaGFuY29jawEIcmVtZXJ0b24BC3VsbWEgYnJpZWZzAAtjYW1teSB3aGl0ZQEG" + "aGkgY2hpAw5zYXRvIG5pc2hpa2lnaQIFdW4tbGkBBHJvd24BBnludGhpYQAEZC52YQERYXJrIG1hZ2ljaWFuIGdpcmwEBG5lc3MA" + "A2VsZgIHbGVuIGpvZQEFbWlsaWEBC3J6YSBzY2FybGV0AQx1bGEgbGF3cmVuY2UABGZlcm4BBmlyZWZseQEObGFuZHJlIHNjYXJs" + "ZXQCCHV0dGVyc2h5AQdvY2Fsb3JzAQZyaWVyZW4ABWdhbnl1AgdyZGV2b2lyAgd3ciBndXJhAQR1ZGFvAQl3ZW4gc3RhY3kFCHRl" + "bm55c29uAAxoYXJsZXkgcXVpbm4BBGlsZGECC25hIHNvcmFzYWtpBAh0YSBoeXVnYQIKdG9yaSBnb3RvdQEQb3NoaW1hY2hpIHN1" + "aXNlaQIMdXNob3UgbWFyaW5lAQV1IHRhbwAXaWxseWFzdmllbCB2b24gZWluemJlcm4BC25vIHlhbWFuYWthAQ16dWt1IG1pZG9y" + "aXlhAAhqYW5lIGRvZQELZWFubmUgYWx0ZXIHBGRhcmMBD2lnb2t1IG5vIGZ1YnVraQIMbGwgdmFsZW50aW5lAgJueAEJdWR5IGhv" + "cHBzAgZyaSBoYW4ABWthZmthAgJnYQIMcmluIGtha3VkYXRlAgRzdW1pAQVlcWluZwELaW0gcG9zc2libGUCC3Nha2kgcnl1dWdl" + "ARFva29taSBzYW5nb25vbWl5YQAKbGFyYSBjcm9mdAEDaW5rAQRvb25hAQ51Y3kgaGVhcnRmaWxpYQIEbWluZQALbWFiZWwgcGlu" + "ZXMCCmkgc2hpcmFudWkCDGtpIG5pc2hpa2lubwQCbWECB3JjaCA3dGgDC2luIGtpdGFnYXdhBAtzYSBraXJpc2FtZQIBeQEGZWd1" + "bWluAgNyY3kDBG1haWQBCmlrYSBtaXNvbm8DCm90byBtaXNha2EDCXUgaGF0c3VuZQUGbmFrYW5vAhBsZXMgdGFpbHMgcHJvd2Vy" + "AhBuYW1vdG8gbm8gcmFpa291AgNzdHkCDXRzdXJpIGthbnJvamkBDW9tbyB5YW95b3JvenUCC25hIG1lZ2lzdHVzAg9ycmlnYW4g" + "YWVuc2xhbmQABm5haGlkYQICbWkCDHJ1dG8gdXp1bWFraQEJaWNrIHdpbGRlAwdvIHJvYmluBQZ5YXphd2EECWxlIGRlbWFyYQID" + "bG91AglubyBuYWthbm8ADm9jaGFrbyB1cmFyYWthAQxyaWhpbWUgaW5vdWUAE3BhdGNob3VsaSBrbm93bGVkZ2UBCWlua2llIHBp" + "ZQEEb3dlcgUFIGdpcmwBEHJpbmNlc3MgY2VsZXN0aWEJBGx1bmEJBXBlYWNoCQV6ZWxkYQIGb2R1Y2VyAQN5cmEADXJhaWRlbiBz" + "aG9ndW4DCW5ib3cgZGFzaAIPbmdpa3UgbWF0c3Vtb3RvAgRyaXR5AgN2ZW4BCmVpIGF5YW5hbWkDCm11IGhha3VyZWkCAW0DDGls" + "aWEgc2NhcmxldAIFbmFtb24CAnplAQtpYXMgZ3JlbW9yeQIIbiB0b3Nha2ECDG8gdHN1a2F0c3VraQEEb2JpbgICc2ECC3VnZSB0" + "aGUgYmF0AQ11bWkgdXNhZ2l5YW1hAAVzYWJlcgIMaWxvciBqdXBpdGVyBwRtYXJzCAZlcmN1cnkIA29vbgcFdmVudXMCC2t1cmEg" + "aGFydW5vBAl5YSBpemF5b2kCCG11cyBhcmFuAgtuYWUga29jaGl5YQEHY2F0aGFjaAEUZW5yaXRzdSBubyB0YXRzdW1ha2kDA3Nl" + "aQEFaGVuaGUCBmllbGRlcgMGbWFrYXplAwluamkgaWthcmkECm9idSBrb2Nob3UDD3Jva28gc3VuYW9va2FtaQEKaWx2ZXIgd29s" + "ZgERb25pYyB0aGUgaGVkZ2Vob2cBBnBhcmtsZQIIaWRlci1tYW4BB3RhcmZpcmUCDWV2ZW4gdW5pdmVyc2UBDnVndWhhIGtpcmln" + "YXlhAgdwZXJnaXJsBQNtYW4ABnRhaWhvdQEGZWl0b2t1AQxpZmEgbG9ja2hhcnQBCW9raSBhc3VtYQEFcmFjZXIBBnN1bmFkZQEP" + "d2lsaWdodCBzcGFya2xlAAd2YW1waXJlAQxlbG1hIGRpbmtsZXkBBGlkZWwABHdoaXABCWlkb3dtYWtlcgIDdGNoAQtvbmRlciB3" + "b21hbgAIeWFlIG1pa28CBG1hdG8BBGVsYW4BCW9yIGZvcmdlcgMNdWljaGkgc2hpaG9pbgILdW11IGtvbnBha3UBDHVrYXJpIHlh" + "a3VtbwICcmkCCnVrYSBoYXlhc2UABnpvbWJpZQZhcnRpc3TIAAAAAAMwLWcBBGJha2UBBGswajAAHzEgZG90IG1pZ2kgbmkgenVy" + "YXNoaXRlIGt1ZGFzYWkCCGVxdWFscyAyAQQtZ291AQcwLXNoaW9uAgsweWVuIGxvY2tlcgIFOCBnb3UCA2VraQICbW8CA25pbgED" + "MTAzAQEzAgEuAQI0NAEGOHNhaS00AQJ1cAABMgEJIGVxdWFscyA4AQItZwEBMAECMjIBATMBATQBAjU0AQM4NmMBA2JscwEPYyBl" + "cXVhbHMgZ2Fsb3JlAQNnb3UBBmwgY29sYQEDbm8uAQF0AAgzMDAwIGtydwEDMTA0AQMyMmcBBDMyOTcBAjQ2AQc1IG1hY2hpAQk2" + "MG1iIHlhbm8BATgCAmtiAQFlAQRodXJvAQF1AQJ4MwAJNCBjb3Vsb21iAQExAQI0NQEENWFjcAAEYWZybwQEYnVsbAEGaGVtYXJ1" + "AQdpdWUgb2thAQRrYWdpAwV0c3VraQECbHABBW5kYXZhAgVrb21hbgEGc2FuYWdpAQR5YW5lAAJiYgECZWEBBGxpbmQCCnVlIHN0" + "cmlrZXIBBW9ubmllAgRzc2hpAQd1dGNoYS11AAVjbGFtcAIKZSBtYXNhaGlybwEIcmF6eSBkYWQCBWltc29uAgJvYwEOdXRlc2V4" + "eXJvYnV0dHMCA3ZpZQAGZGFnYXNpAgdpZ2FpamluAgJ0ZQEEaWtrMAADZWxmAQtyZWN0IHNhd2FydQANZmFuIG5vIGhpdG9yaQEI" + "ZWxsYXRyaXgBCXJlZCBwZXJyeQEJdWV0YWtpc2hpAgZtaWhpa28CBm5kb3NoaQMOc2V4eWRyYWdvbmJhbGwCA3JyeQAJZ2FyYWJh" + "dG96AQZpbmhhaGEBBW9ibGluAgh0b2gganVhbgEDcmFuAQV3ZWd3ZQAEaGFsbwICcmEBBWltZW5vAwp1cmEga2lzZWtpAgRzYXNp" + "AgR0b21pAQVvbm9rYQIGcm9zdWtlAAJpZQEGbmF6dW1hAgRjYXNlAwpvZ25pdHltb3VzAQZzaGlrZWkBDHRhYmEgaGlyb3NoaQAD" + "amFiAgh5IG5heWxvcgAGa2FkYXRoAgNub24CDHJtYSB0YXRzdXJvdQIIc2UgZGFpa2kDA3VtaQEFaXJhcmECDHNhcmFnaSBndW5t" + "YQEGb24ta2l0AgNycmEBB3VuYWJvdG8DBW9pY2hpAglyb2ludSBqdXUECXN1IGdhdGFyaQAGbGFtYmRhAQtlc2xpZSBicm93bgEF" + "aWxpdGgCA25kYQEHb2xpY2VwdAEEdW5jaAADbWFpAgJuYQMJa2FpIGthaWthAgNyaW8CBHRlbWkCAXkBCWRhIHN0YXJvdQECZWkC" + "BG1lNTACCG93d2l0aG1lAQhpY2hpa2luZwICa28CBW1vbmVsAgJ5dQIJenVyeXUga2VpAQZvZ3VkYW4CBG1pamkBBHV0c3UADW5h" + "a2FqaW1hIHl1a2ECBnJ1aG9kbwEJZXJvbWFzaGluAQ5ndHZpc3VhbHN0dWRpbwECdW4ABW9ib3JvAQxodG9tbyB0YWt1amkBBG91" + "c28AA3BhbgEHaWcga2luZwEJb3JpdXJldGFuAAZyYWJiaXQCCXRhdGF0YXQ3NAIDdmVuAQxvbXVsbyBtYW5jaW4BBXV6aGFpAA1z" + "YWhhcmEgd2F0YXJ1AgVpZ2FkbwICa2kDA3VyYQILbmJ1biBreW9kZW4BCWhpZ3VyZSB1aQMGbWFrYXplAwRuZG9sAwJvbgMNd2Fz" + "dSBubyBva2luYQIKdXRlbiBkb3VqaQEIaWMgcGh1Y2sBA29yYQEGcGFycm93AAx0YWthc3VnaSBrb3UEA3RzdQMNZWRhIGhpcm9t" + "aXRzdQIGbWFnb3JvAQhlcmFzdSBtYwEHaGUga2l0ZQIJaWNjd2l0aGFxAQhvbSBzbWl0aAEMc3VraW5vIGp5b2dpARB3aXN0ZWRz" + "Y2FybGV0dDYwAQZ5cGUuOTAABXZpY2t5AgVrdHJpYQAJeGllcnJhMDk5AAx5YWhpcm8gcG9jaGkCAmlyAgZtYW1vdG8EAnRvAQp1" + "aWdhIG5hb2hhAgtraW5vIG1pbmF0bwILenVraSBuIGRhc2gABnpvdXJpawljb3NwbGF5ZXKzAAAAABRhIGJhbyB5ZXNoaSB0dSBu" + "aWFuZwEGYmFuNjA1AQtpIGxlaSBqaWFuZwIIbiBuZ3V5ZW4BDGthbmUgYXJhcmFnaQIKZW1pMTAxeG94bwEHbGljZWt5bwMJbmEg" + "YmVja2VyAQduaW5ueWFuAQlvaSBtb21va28BCHF1YSBhcmVhARByYXNoaSBoZWFydGdyYW1tAgh0eSBodWFuZwEFdHN1a2kBCXh1" + "biBrYW9yaQEEemFtaQAMYmFpbGkgc2hpcmx5AgZuYmFua28DA2duaQINb2VyIG15c3RlcmlhbAMJem91bW96aWFhAQZsYWNxa2wB" + "BHlvcnUACmNhb21laXl1eWkCB3JyeSBrZXkCCnRpY29ybnBsYXkDBnRhc2hhYQEKaGVycnkgbmVrbwIGdW5tb21vAQtpZW4gY29z" + "cGxheQAZZGEgZGEganVhbiBqdWFuIHhpYW8ganVhbgEJZW1vbiBtaWthAAtlbHkgY29zcGxheQEEbmFrbwEJcnp1byBuaXNhAQZ0" + "c3Uga28BBnZlbmluawANZmFuZ3FpYW8geWVwbwEPZW5nIGppYW5nIGppYW5nAQdyYW54Y29zABNnNDQgd2Ega2l6dXRzdWthbmFp" + "ARFyZWVuIGNoYWNoYSBqaWFuZwEIdWF4aWNoYW4CE29xaSBtaXhpYW54aWFuIG1pYW8ABWhhY2hpAghuYSBidW5ueQMFZSBhbWUB" + "EmVsbHkgdm9uIHZhbGVudGluZQEKaWRvcmkgcm9zZQEIb3NoaWxpbHkBCnVhIHFpIGhhbmEDCWxpbmcgaGFuYQALamVhbiB3YW53" + "YW4BEGlhb3JvdWppIHdhbGt1cmUCA3VxaQQFdWplYW4DA3lhbgEKdW5rZW5zdGVpbgARa2FndXJhemFrYSBtYWZ1eXUCCWxpbmth" + "IGZveAILbmVrby1rYW1pYW8CCHRpZWNha2V5Agh5YSBodWFuZwUGbmlsc29uAQhpa2kgcm9zZQIHbW1pZSBtaQIKcmlrbyBjZWxp" + "YQIEdGFybwEGb2t1aHVpBAhyYSBjaGl5bwEGdXVrbyB3ABFsYXJpc3NhIHJvY2hlZm9ydAEHZW5mcmllZAEKaW56aSBqaWFuZwEG" + "bXVzaWNsAQlvc3R3aW5kMTACD3ZlbHlzcGFjZWtpdHRlbgENdWVyIGRhIG1vd2FuZwINbyB4aWFvbGkgbWlhbwIEc3Q3NwAFbWFj" + "aGkCBmthY2hhbgIIcmlhIGRlc3UCCXNha28geXVtZQMJaGlybyB5dWtpAQhlbm1lbnRhbgIJcmN1cnlsYW1wAgpzc2llIGh1YW5n" + "AQ5pYW5iaW5nIHhpYW5lcgIJa29qaWFuZ3d3BAltaSBob2tpbmECDW5henVraSBoaWthcnUCDXlhbW90byBzYWt1cmEDA29raQIJ" + "emhpbWFvcWl1AQZvbW9jYXQABm5hLXNhbgIEZ2lzYQIEaXRhbwIFbmdvbmcCC3RoIHNva29sb3ZhAQpla29rb3lvc2hpAgRuZWtv" + "AQlpYW5uaWFuIGQCBHlleWUBCG9yYSBmYXduAQR5YWtvAAtva2l0YSByaW5rYQEEbWltaQEJbmkgaGl0b21pAw9rc2l5YSBzb2Zp" + "bmlrdW0BCXRvaGFyYSBhbgAIcGVua2FydWkBBGlnbWECBXBpbmFpAQ5vdGF0byBnb2R6aWxsYQEJdXJpbnB1cHB5AAxxaXNpa3Vh" + "aSB3aWkCCHVoZSBrZWppAAhyYWt1cmFrdQICbjMBBWVmZWVuAgJuZwEMaW5nbyBtaXRzdWtpAgZvLWNoYW4DAmtvAgVzc29mdAEJ" + "b25ncm9uZ3ppAQp5bmtlcmJlbGxlAAtzYWRha28gbW9tbwICa3UEBnJhIG5vYQIGbmR1LTY5AgpvdG9tZSBsb3ZlAgR5YWtvAQ1l" + "bmx1byBjYWl0dWFuAQloYXJrcGFydHkCDWlrYSB4aWFvbHUgbHUDCW1penUgbmFnaQgEeXVubwQGb3RzdWtpAwpyYWdhIHlhbmtv" + "Awt6dWt1IGhvbmFtaQINdWFuZyBtdSBmdSBzdQEIaWFvIGRpbmcBA29sYQAIdGFuZ3RhbmcCDW8gbGlhbmcgYXpoYWkBB2lueSBh" + "c2ECCnRpIGNvc3BsYXkBBG9rYXICCm1veW8gamlhbmcBB3N1Ym9taW4DB2tpIGRlc3UDCW5ueWFuY2hhbgEOeW91ZHVraSBtYXJ5" + "b3UAB3VtZWtvIGoBBnBtaW5hYQEJcnVtaWJ1bm55AQN5dXkADXZhbGVyeSBoaW1lcmEBCWVjdG9yZmlzaAEHaW5uZWdhbAIMcnR1" + "YWwgZ2Vpc2hhAAd4YW5zb29uAQlpYSB4aWEgemkCBmRhaWRhaQIGbmcgbGFuAQp1ZSBxaS1zYW1hAA55YW1hemFraSByZWluYQMF" + "aXN1bmcCBG5neWkCB295YW9xd3EBCGluZyBsaWxpAQl1a2kgYXN0cmECBXJpY2hhBAVrb2R4ZAIGdWZvcmlhAAt6aHVpbWluZ3lv" + "dQVncm91cMgAAAAAEC4uLiBtb3UgaWkgZGVzdS4BATcBA21pegAHMC1wYXJ0cwEDMDAwAQkxMjM0NTY3ODkBATIBBjMtMzI5NwEB" + "NAIEY3VyYQIJdGggaGVhdmVuAgF1AQU3MjVjbwEGODQ2bmV0AgRiYXNlAQI5NgABMQEOMC1qaWthbiBzdWltaW4DCm1hbiBiYXJp" + "a2kCBi4xMG1oegIIMDAwMDAwMDAEAmFwAwRhY3JlAwd5ZW5tb2ZhAgsyIGdvdXNoaXRzdQIENmdvdQMBbQIEbWlsZQIPcGFzZWMg" + "bm8ga2FuYXRhAgZ3YWRheHgCCXllbiBqb25kbwECMTADBy1ncm9vdmUDAXUCCDEgdG91YmFuAgIyMgMBawEHMi1qaWdlbgIDY3V0" + "AghrYWZmZWlucwEBMwICY20BDDQwa20gc2xhc2ggaAIEOGJwbQIGbG9saXRhAQc1MmhlcnR6AQU2IHNhaQIHMDAwIGFsbAIFa2Vu" + "bWUBCjc1NiBzdHVkaW8CAjg3AgJpbgIBdwEOODBtaWxsaSBjYW5ub24DAXICATMCBzUgc291a28CCjcgc2VpYnV0c3UCBm1hc3Rl" + "cgEHOWxsZGRrawEDYml0AQRnYXlhAQNvcjgABzIgY2FyYXQBCDAgcGx1cyAxAhEwMGtjYWwgc2hha2UgY2x1YgIBMwILOSBnb3Vz" + "aGl0c3UCBmxpcXVpZAICbnQCAnIwAgZ0d2VudHkBBTMuNGRvAggxMTc5cm9jawEGNCBwYWdlAgYxIGluYy4BCjUwcG9ub3JvamkB" + "ATcCAjNrAQM5NjECAjkwAQFiAQVjdi5zcwEKZCBjcmVhdGl2ZQIFLW5vdGUBAWgBCGppbXVzdWJpAQFtAQJuZAMFIGxpZmUBB3At" + "Y29sb3IBBnN0cm9rZQEJdGFpbHF1ZWVuAQJ2cwEFemlnZW4ADDMgY29sb3JzIGNhdAoFb3JvbmECBW9uIDEwAQgtMiBnYWdlbgIH" + "bWVnYS5uZQEILjV0b3VzaW4BITAga291aGFuIGthcmEgaGFqaW1lcnUgZXJvIGRvdWppbgIDMGNtAgsxIGdvdXNoaXRzdQILbWlu" + "LTUwMDB5ZW4BCDEwNHR5b21lAQUyMGJwbQIDMWdvAQIzMwEMNjAgZGVncmVlcyBjAgFrAQE4AgQuNSBjAgVzaGlraQEEOWRtcAIF" + "eHJlYW0BBmQgbGl2ZQIBdAEDZWdnAQNqb3UBBGxib3gACDQuNXNwYWNlAQkwMDEwIDEtZ28CAjQwAgZkZW5pZXIBCjM0bm90Zm91" + "bmQBCDY0OSBjbHViAQI3MQICc3ABCWMtZmFudGFzeQEDZGlwAQFoAgRhbmRzAQxrIHNlaXNha3VzaG8BCW9yNSB3b3JrcwEGc2Vh" + "c29uAgt0IGluamVjdGlvbgAENSAwNgIHc2xhc2ggNAAHYWhlbWFydQEOa2F0c3VraSBzb3VrZW4BEmxpY2Ugbm8gdGFrYXJhYmFr" + "bwACYmIBCGxhY2sgZG9nBQZud2hpdGUDAnplAgVvc3NvbQAIY2F0dGxleWEBCGhyaXN0bWFzAQVpcGhlcgEFbGVzdGEBBnJpbXNv" + "bgIDb3duAQZ5Y2xvbmUCBW50aGlhAA1kaWdpdGFsIGxvdmVyAQZtbS5jb20AA2VsZgAKZmF0YWxwdWxzZQEGaXJlZmx5AAVnaG9z" + "dAEGbGFzc2VzAAVoYXJlbQMEbmVzcwEIZW50YWlrZXkBBWliaWtpAAxsYXBpcyBsYXp1bGkBBWlsaXRoAQxvbGl0YWNoYW5uZWwA" + "BG1hbmECAXkBAmVpAgx0cm9iYXkgY29taXgBBGlzdHkBBm9ub2V5ZQAKbmFydWhvLWRvdQIEeXV0YQEPb3JhbmVrby1uby10YW1h" + "AQJ1bgIEdGFrdQAFb2Jvcm8BB3lha29kb24ACHBhbGNvbWl4AgdudHlob3NlAQVvaXNvbgAGcmFiYml0AQZlYmVjY2EAB3NhaWdh" + "ZG8BB2hhZ2Jhc2UCBmltYXBhbgEKaWxlbnQgaGlsbAEEbGF2ZQEFdGVsbGECA29ybQEGdXp1cmFuBAJ5YQAEdGFpbAEFb21ib3kA" + "BXZlbm9tAAh5YW1hbW90bwhsYW5ndWFnZVcAAAAACWFmcmlrYWFucwEHbGJhbmlhbgEFcmFiaWMDBG1haWMCBm1lbmlhbgAHYmVu" + "Z2FsaQEGb3NuaWFuAQh1bGdhcmlhbgIFcm1lc2UAB2NhdGFsYW4BBmVidWFubwEGaGluZXNlAQNyZWUDA29sZQIGb2F0aWFuAQR6" + "ZWNoAAZkYW5pc2gBBHV0Y2gAB2VuZ2xpc2gBCHNwZXJhbnRvAgZ0b25pYW4AB2Zpbm5pc2gBBXJlbmNoAAhnZW9yZ2lhbgIEcm1h" + "bgEEcmVlawEHdWphcmF0aQAGaGVicmV3AQRpbmRpAQRtb25nAQh1bmdhcmlhbgAJaWNlbGFuZGljAQluZG9uZXNpYW4BBHJpc2gB" + "BnRhbGlhbgAIamFwYW5lc2UCBnZhbmVzZQAHa2FubmFkYQIEemFraAEEaG1lcgEFb3JlYW4BBnVyZGlzaAAGbGFkaW5vAgFvAgN0" + "aW4DBHZpYW4AB21hcmF0aGkBCG9uZ29saWFuAAduZGViZWxlAQVlcGFsaQEIb3J3ZWdpYW4ABW9yb21vAApwYXBpYW1lbnRvAgRz" + "aHRvAQZlcnNpYW4BBW9saXNoAghydHVndWVzZQEGdW5qYWJpAAdyZXdyaXRlAQdvbWFuaWFuAQZ1c3NpYW4ABXNhbmdvAwVza3Jp" + "dAEGZXJiaWFuAQRob25hAQVsb3ZhawQFZW5pYW4BBW9tYWxpAQZwYW5pc2gBBndhaGlsaQIFZWRpc2gAB3RhZ2Fsb2cCA21pbAEF" + "ZWx1Z3UCCnh0IGNsZWFuZWQEDmxlc3MgbmFycmF0aXZlAQNoYWkBBmliZXRhbgIGZ3JpbnlhAQlyYW5zbGF0ZWQBBnVya2lzaAAJ" + "dWtyYWluaWFuAQNyZHUACnZpZXRuYW1lc2UABXdlbHNoAAd5aWRkaXNoAAR6dWx1B3JlY2xhc3MLAAAAAAhhcnRpc3RjZwEIc2lh" + "bnBvcm4AB2Nvc3BsYXkACWRvdWppbnNoaQAGZ2FtZWNnAAhpbWFnZXNldAAFbWFuZ2EBA2lzYwAFbm9uLWgAB3ByaXZhdGUAB3dl" + "c3Rlcm4=";
  var CORE_COUNTS_BASE64 = "QkVUQwHAhhQAqAOskPVgAJq8EOO4AIFpJfVnAaw8IEa3Ao/Dx2q5AqVplUUnA8VCnj5TA8qCBrtrA9Iw9PHFA5YmwkL+A5Gy7gIm" + "BJZ2UhnEBLZHs9Z0BbT4VDHuBYH2IkqBBqs/E9RrB6iXA4uBB5KHszqiB+WglCnQB6JU+GUKCIdDD4EqCLn1MXdvCH0deaL/CIwt" + "cVUbC33tkRGoC7kWOtDlC4EUeHINDEOg3ID1DLol4cQzDakJdUxKDbt1mQV3DZKQ1BmQDbhNaQbbDaCqzg0YDn+l0cfPDoyTPxDn" + "DpQeGkwjD5+HY6g5D9Bg3PpXD9EqRl9yD7zC9lS2D6LavucLELOAVFNaEJrotINhEINSRoqQEJ8bH8/GEChL3wIDEZ+vu1wPEY0X" + "q5IlEY5AhLOXEYIinhxqElOaNgKJEn95vZyNEqVcmKjXEjweitQGEzFOGvAXE6Ed0e6wE31VKWzuE4N0SAo8FLjeUh5CFJo+Co6v" + "FLeMEE7QFJ1gBOLVFH016c86Fb6UmJRDFZvqrhSsFYCSnrdCFpivY7NPFqTNobpuFs2fU9VxFn2L//WhFsNi5kewFr66LoAAF5wU" + "EFIlF4LmuuYrF4Um0vvAF+ExLfDhF5Kk0A8/GLHq1pRZGLlpjU9fGJ6JfWbnGKOhdefwGMGw7Eb0GNIfy2T6GMaY/FvKGd5+Coz2" + "GaIf8xutGpUnE4WyGpY1qS3cGu+9mZ4gG9MCvvBBG7QyFhVoG4Bs8IbgG5mzT02jHKKfE75MHZOS1nOkHVzsAFPjHdcscO8OHpj+" + "AoYnHn6apnhKHpf5rR9XHthc2I9zHoSJRbyOHr71WXG9Hpdr984YH5j3o/NQH/f+utZ0H39Hk0ibH7R7tz0MILRliTEXILeGAqRY" + "IIC8eFJdIK8GIglfIIgHC+ieIKaz5w2oIMXMyGwoIei90YA/IX/EYDxqIcP2WkVxIaXRbVqTIZjYnNk3Io828vCLIsuq1prbIplr" + "F2mOI33jj1yrI66D312uI72BhQO2I7vuGtfjI8390ej1I7ST1y8SJK+ohMseJIcQnMxGJMQa1uJRJA2APNVVJIRa1qxQJZs7D/Gk" + "JZgIpCJjJn9hvSQUJ77K3gUwJ5cg9PpPJ6KSJu3HJ321+U89KKw3g4luKJQx/WGzKLDRvZu2KI8deandKKj3oxruKJQP0+UQKaJn" + "q8BQKTf8OKS7KeFjb6TdKYbJDReCKoLFIQK0Kg134/vCKo0cOB/PKpluMgfdKtERRSUNK5VxNdgcK6RShiZ2K59xvfKmK7AAzAaP" + "LM4tKaSzLJin+8W9LLS1Yb5zLaQLB9miLYHSDj8OLot0CDGxLpr0uBfQLp6SvqDbLp25ZflML4r+2gK2L7kjf2ZsMBRyHiTAMNOv" + "S3vFMJmMaGPPMH5jR5FPMa4EeHRlMc7OuqGAMbnrn6a6MZpzB0jzMaBegtQMMpjrbxtwMp+WaleMMo/QpHm1MqP0UJpbM84tCSvL" + "M6VyzvbnM5eGWrP4M5sJhXZBNIWJtTR/NKAkkJzqNKUS5gMXNczBNcQnNc4cgCtXNbsQHGJeNVvjx93eNcChlZ8ONpue+kp5N8wC" + "flHQN7Vfy1PXN4I+klPcN7UWSnbeN8GcQEYdOM8Pc2w4OH8T56ZZOKukMOmVOKnZXTGyOImARJz2OJhLf0piOZBj1z+pOZ2+Amna" + "ObfJTUnnOZKNITMdOskBBcsjOn3x7fs7OppsaPaBOo8KvpOrO42u0tnvO+CD92L8O4LcoLYSPH5MeEftPJglSRyKPqErJ/eRPtKZ" + "hasrP5M+AkM3P4+KZppGP6hxNS5WP4a/M4C4P59R5aVEQMl8UIMxQahHQ4gyQaxFSWr+QbhxlU83QqNn++44QoMpRbZeQpKGKoBd" + "Qw14JMrlQ52QfNKFRIUMEGk2RaPTH1ynRcA1Mdz6ReB7D6IARp/VoRpERp9xtZXDRpJL34pyR7wTh2rKR4F5NSCOSH2tuaenSIPL" + "/yW9SJwvozD5SJrDh203SY8ixkB2SX3CpgKZSX3jB4/0SaEdIYx3SpxVgTqzSpfOEqclS48/K+Z5S6NWigV/S6DDR7mOS6ARFRGU" + "S5PksK2iS6XQDFQbTA13E9cqTKmy5tlmTLDCdo9xTOtsmNGYTIIUUPKaTH4IXORfTY+pxWt5TX6CjtV/TbdrDxyPTa83M0KuTZDy" + "Jga+TXuRbdYwTqC1uT5bTr96jm3XTpt24rbqTpJksIcNT35w7O5VT4NpVYp8T9eVscCqT5CYVInAT5hRJY/2T6RJbWMLULMVuQaU" + "UILKFpeVUItc6I67UIon03S+UIRdKUTGUJbPI5vSUIB7JzjoUKVC/hkSUYvQlIZtUYFno0WcUX3caK8jUqdHazA0Ut8hVbN3UqOn" + "W/yBUqQSPlWRUqCnS48UU416FnCfU5gWkvYjVNWOctpsVLwdgWB6VMwBjd7WVY/x7TX+VapqRt8mVpd2KuviVvCDt+v8VsHdWfk3" + "V6zPa8RcV7qV+U2CV5fafmGOV45UMPjgV4evG8M6WMf3C+ZQWILKJkmIWNOzB6ioWKycYKQaWbU8MMJiWanFSfqOWakcOJ6/WdAU" + "IElDW3+mOgULXHkAjMZHXJmatlpiXKFp9eiXXJcDP06dXNjEMCDuXMrI/HEjXSA7XwA0XYpDV9tGXa80gGKlXcqXy4LBXekb3zQW" + "XoFGaiofXsMoPCk7XryfW/OJXrqSTjoGX6RGumaZX6BVgVGjX7OwjB65X+2aZt/vX7XJFVHyX64eWg4uYJQgfPSJYM3sOIY9Yb0p" + "NUyDYbvNCdWmYZZBNZvCYZhOas/hYTpcmLsIYsEIrP4ZYn6YpNm0YrnghDH5Yp6RlfArY6GWagxnY7uq9q2/Y83A9BQCZLL59bIv" + "ZKH8OO7cZNmdCdGOZXEXa3DyZbyFWU5MZiPAfKfUZs0YZGEQZ5fAnMUlZ80ajuAbaNE5jdiQab91IQ6haaF9YbavaZeHC5DcaZVe" + "4gXeaZ5KfjZAauBwHLx1aucduRcNa6AE4Jlfa5g0SMsgbPC2Us6tbH/1Md+VbZdJxb2pbZEgzGn4bbCeQrEebqq/gxkjbn5FYVgw" + "blHBBdB9boRglASBbqkuGjqLbs6kIAyMbp+BnYwFbzLoxJAGb5jIvN81b8ThPY+hb8QYRG1jcJEjFyuhcNQyhrZMca8W6gZXcbiQ" + "RFKccZlKXg4DcpgswAK/cn/9AS/Icn+ivpPhcrJ+uuTzcujp5dL4csXQxEV9c9LBZTHAc9DSLlZbdJV0kHuadH4gxAv7dLzm+jOd" + "dYByvkwPdrG7x8oxdptgVFlbdqmtQZSIdtPOStWLds44pMb9drLz51pbd5qfExGod33XI7uqd4GEoPr/d6NeUqwDeJTE0ANAeKng" + "lJJKeJARvQineILzx48VebfM6CkXebNtMb0JesxaflhLeqicSOBtepfADFiPeoDrD+cLe7OMQFQ4e93XSyIFfNQ+gpQxfLLk+OYy" + "fLxmaiQ0fJv9eY61fK+tYRrCfLINMdJxfYCskOyOfTOUKCexffCBtVrQfZs4fBnRfZ7eekfSfZVwNI/efYWP+0AAfqJfM96NfuBV" + "YUGqfn+2emz7fhm26nEFf30Osrlaf5tiRk9wf62sQCKTf5oFwXTQf+zmAgMQgIAckCQVgNeni3ghgLClaYYhgLdVKR1pgLMdYUCc" + "gLQeepurgKg4/CO7gIqOer8JgZbK5qQpgbPLF3VGgZelSS7TgYRzxxRRgpJ+4mxngrj9Gd7igpekKMqhg6i8GFVphOD5NSt9hLL9" + "seaDhJ7ZlYbdhL0WyvAFhZnEyP43hX8tOQNahZe2EoRjhX/TV9aihZ9FkRUXhpv24rY2hrEQRELmhoDEsDB/h4Femg2Uh5C3o9ZN" + "iIXAVCZqiJ780DOniLCPCyUxiZcpDa1biYkUwBR+ib3cCDp/iZ+2YprwidSmeiwQirsKpuRLirN+6qFtin7Xu+gPjJr5zRnHjN+C" + "nr/sjLLtgYKOjeF9Ue2YjX0HewOvjaCYJFQujrRIDEQ5joLGcgIfj8Wd2UQ1j8pzdxJoj8MSDhs8kJIM8MXnkOM3W4xZkZhPixDj" + "kpGyrgoSk32Pi6hRk6u59c5wk8RWWp9zk8b0oJaYk6EHW4fWk58IvEzik6YytlRqlJiSxtWNlJXuYluhlJ4C3ozflLmMIPn2lK4n" + "Gwz6lPWs0CNUlZ7tyTCElc72Et7AlX8/C47BlcVzF3j6laOMcBgMlpxdkciAlqBZvf2uluX6dhW9lrKjp4LjlrX736+Ml57MuBOO" + "l6TABFPwl5bATEhsmJluGpeMmIC0WMi8mJMsAEDcmLO5RVjhmNsrL4IJmTaeytA5mbD6hkKnmcY6fn7Hmdjs6AMKmsvTRxINmq2H" + "o0lKmrOvW3ttmp5jl2L7mtZIPEMCm3+loUwzm8ZsQPA8m9ghHa5Jm6uyplGJm7TlYRbAm67pDcsEnJ6Lv4aHne/x/aeenaxG+s6n" + "ndRYhKAUnrC9ASUinpo9KfKInolT52jCnrv9MYr4nqGi5sZEn5LUqK6ln60+CpSpn4skyG4UoDAppfYdoLWxBSygoB1oBLOkoBTl" + "2Ym1oKzXO73PoOkbJ8IroX1L5x42oaF+khpSoZgBZcV3oZuLL0aGoZntSeicoZ6Znae6odL3cyFHorQpPQZwoo+eyleAo7pUQMuh" + "o5lEUH21o8ikIE+ApLe5LYcDpYN9wWUZpZcVSf5BpdhYpJptpbKTB7SApZqPi5KapZA12f06poMFQcPDphR/y2zKpu+AbHPTpnAH" + "04kBp3210aEcp7R59Vc/p6SD77hap5dhhd9gp5sm2ipjp36mosrup7KAXL8rqJ5YvPwuqI3W6nU+qK8JjWE/qIL4XAvIqMprB/4A" + "qaXWcosrqehtgf3sqYOCjiMdqqGijmxWqoi3k/R4qoUjb7doq4bR1YGQq6OXw9m0q579ubkXrMkjfxorrP//E4tZrCiNiUuNrKQp" + "fbyXrNmrj8XArLMrBzI8rZel4bTVrZ+gXEu0rrlhbeXErqsaFsD6rrUGolBJr5FuUnRar6imIi15r7vLt8+zr8llqd/br5ugHEoQ" + "sKtzZzRNsJfHu/9zsJaa5vO6sJu00F2+sJGjH3vMsOfypmHhsJiRJZtksYWg9Mp1sYOApEC0saEALJ7ssX+8yEf6sVVpFQsds8+o" + "1GGYs8AlGQCzs5jEoLKzs5gDf4N3tIBiJmqLtMbFWSm7tLM+WgjBtH5n60EataLrT3uOtZqBxZ+qtZAADGXwtazWahEitpl8iB9u" + "tpAYrNrLtqfLJ2Aet5pM8B2ut6GyBlu0t6GuSufht7Jvu/5BuIYrV3gduaU1EZA3ude7n46eumHzr7rdurqRjbepu7LLX7zcu4Et" + "qdU0vLT0QJ2AvL4wZOyOvL56Dr/yvKTesjNEvZJtEYJZvaiOctV3vbGgTD2YvYsHSz+ZvaXDP/jyvQ08iCYpvr7cuFWGvokwvD2/" + "vp5DT6nwvoLYPPQuv62csM65v9cKlq/nv4ANAe8TwNb+GrtHwI9IdDx6wE1OSmSrwLeZZQQfwZQ+an1DwrqwFIWDwrbkgBWMwqpy" + "DmvVwp9M8NLXwqbqXgDywiacKFOUw4suImoIxM+o/I5OxIKp7SY6xVrMyCdcxtVVcRT2xqhfO4QKx6IrFyo/x9ym+upix5hj30Km" + "x5wy5iX/x5YYzB3UyJB2eq7dyJtyNvW+yaEbdznDyYU/Ay7LyaeKzqXXyrOMALfayrasMF/6yqInE/v6yp9h5Zxhy4ZCBh6My3+2" + "mn01zJxhDc0HzY0dedckzZr9gW89zYQ/+8WZzbV3w7SfzbdsUF/PzZqnO+HmzcQj3zAUzrajr5oZzpi5RZYvzsOaXrByzp/2SmKt" + "zo5tsSPjzod7D34Pz7CwVMgZz6kDH/Yez30/41p8z8Xjn72+z8kXG5IF0JZ/YzpH0JFvUz5R0LuZDVmS0A1ciPma0LMmMvnN0Jh+" + "ekF/0a5BJRD50Zqs0OPY0oFWysTe0sDNkaJh067cWEaM057/m/oJ1N61eWwM1JnTN68q1I0uutNb1L61Wdxy1H0750Ye1abHC696" + "1YJqJo+c1cfdkY/g1aYzN34R1pRAtIqb1pu6huGi1pkyRhbo1sND34se15//O4LL1+U1kSAE2MltOY1/2MyvEyCO2JU7N4on2Z05" + "7fqT2aX+CoOX2YMkACa42dVewjsF2uHJzSgs2pMv4zCx2pUyHlEf28EYrPpQ24EtMdZU2w1E4EGi27UNeR7C273N4fNz3Kb7H3uH" + "3Kvzv9DK3LML37vz3Iqeuq313IzDvxMY3eX/u3qu3dTZzQe53YJbzxbj3bdOwsft3X1R5WsY3qIc4JAp3rx8AM5+3oAYfN/V3vb3" + "u3Pj3mWyTgZX392LX7ps36u3QxgP4JmXO1QY4Kk1MVw44KBplTuN4KLvq/cJ4YFhNVUd4Zty/utV4bmHI1fD4YCzr2H34rtR7aoQ" + "47EqphZH45jPE8yA46NoPLaL45uvU32c4zaqltiQ5ND0COWd5KV47HMG5cAKBtJw5ZHgpIqD5Y8Pcymm5ZwGgu3q5aTtCb1o5rWK" + "tvqi5oTkSDQr5586zvIr549EUP0353vyVtM458g7F9SR56CH+2ka6KP5jUZy6LHP05bG6JSazvrY6JqWSmLp6IAG6t/s6Jv3c0QK" + "6dKvM4r16ZDswOX36Z/FwSn76bj4lMQY6n7WSmMt6pKHg/Dg6tBt6dD/6siGcnUd69zydgZA66btedGB7L88wPe+7KrqTnDB7K1M" + "0F8P7ckMmPNr7ZtZpfK37Yf6nobS7adzB63u7bae0jIY7p4HC1q+7q3Xm5fv7pn5ZRwT751Df+5A77UDr/3h7394FDbi78JZZSLv" + "75frN6AH8L/4XNBH8J6cgLJS8Lt0GOtr8LvCPvHv8IKLT2468aPYfGtE8Z45VbNI8aqkqKNk8a43g6WT8bNVycey8Zt9AdPF8Y4z" + "12CW8qmTxzNJ88HB/QmB84oSduj384VKLrwm9NyBZakv9Ib3AyBC9MgV6Vym9Lc8SMiy9K1HS7sk9bcaRiNP9ZqMeKLs9cnIDEv8" + "9bhPo0c99n1RPWxe9pxwZHKY9q/qnha/9ps9YdEA98j8YM8K991BnRFD96G1MbNv95zOqjmf97rfg+vy95lLbyhS+H+coGJn+JyX" + "M5jO+JJJFRvj+MQQ/FBP+dvK5kuF+Z843Nqa+aaoVIa2+c0/+26/+X6EABUE+p/PY8k/+qM1+UNT+sfCtkmH+o5ZJS3K+tmfC8/M" + "+seDD2nu+pSxJZjS+69MwF4C/J2PC7cf/H1T32Eq/Mb7N9Q6/Jr02HL9/JmvE1EO/WCQlDY8/YzqPkpf/ShmYqOw/YNK5gS//ZvV" + "oaTO/ZhUOCkX/poXA+gd/kFtwdw7/t8FIRNp/s3eOnO//oALr+jH/rNT70fa/pi2qqbl/ts/w+0B/7PX+3ks/4fgjI89/52qdruz" + "/8M=";

  // src/tags/codec-header.ts
  function hasCodecHeader(bytes, magic, version, headerBytes) {
    if (bytes.length < headerBytes) {
      return false;
    }
    for (let index = 0;index < magic.length; index++) {
      if (bytes[index] !== magic[index]) {
        return false;
      }
    }
    return bytes[magic.length] === version;
  }

  // src/tags/index-codec.ts
  var MAGIC = [69, 72, 84, 73];
  var FORMAT_VERSION = 1;
  var HEADER_BYTES = 7;
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
    if (!hasCodecHeader(bytes, MAGIC, FORMAT_VERSION, HEADER_BYTES)) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const namespaceCount = view.getUint16(5, true);
    if (namespaceCount === 0 || namespaceCount > MAX_NAMESPACES) {
      return null;
    }
    let offset = HEADER_BYTES;
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

  // src/tags/tag-counts-codec.ts
  var MAGIC2 = [66, 69, 84, 67];
  var VERSION5 = 1;
  var HEADER_BYTES2 = 11;
  var ENTRY_BYTES = 6;
  var QUANT_MAX = 255;
  function tagKeyIdFromFolded(folded) {
    let high = 2166136261;
    let low = 2654435769;
    for (let index = 0;index < folded.length; index++) {
      const code = folded.charCodeAt(index);
      high = Math.imul(high ^ code, 16777619);
      low = Math.imul(low ^ code, 16777619);
    }
    return (high >>> 0) * 256 + (low >>> 0 & 255);
  }
  function dequantiseCount(quantized, max) {
    if (quantized <= 0 || max <= 0) {
      return 0;
    }
    return Math.round(Math.expm1(quantized / QUANT_MAX * Math.log1p(max)));
  }
  function decodeTagCountsFromBytes(bytes) {
    if (!hasCodecHeader(bytes, MAGIC2, VERSION5, HEADER_BYTES2)) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const max = view.getUint32(5, true);
    const entryCount = view.getUint16(9, true);
    if (max <= 0 || bytes.length !== HEADER_BYTES2 + entryCount * ENTRY_BYTES) {
      return null;
    }
    const counts = new Map;
    for (let index = 0;index < entryCount; index++) {
      const offset = HEADER_BYTES2 + index * ENTRY_BYTES;
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

  // src/tags/core.ts
  var data;
  function coreTagData() {
    if (data !== undefined) {
      return data;
    }
    const bytes = bytesFromBase64(CORE_VOCABULARY_BASE64);
    const groups = bytes === null ? null : decodeTagVocabulary(bytes);
    if (groups === null) {
      data = null;
      return null;
    }
    const countBytes = bytesFromBase64(CORE_COUNTS_BASE64);
    const counts = countBytes === null ? null : decodeTagCountsFromBytes(countBytes);
    data = { groups, counts };
    return data;
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
  var MAX_ASSET_BYTES = 2 * 1024 * 1024;
  async function readCapped(response, limit) {
    if (Number(response.headers.get("content-length") ?? "0") > limit) {
      return null;
    }
    if (response.body === null) {
      return new Uint8Array(await response.arrayBuffer());
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let read = await reader.read();
    while (!read.done) {
      total += read.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(read.value);
      read = await reader.read();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
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
        const bytes = await readCapped(response, MAX_ASSET_BYTES);
        if (bytes === null) {
          warn(`${label} is larger than ${MAX_ASSET_BYTES} bytes`, url);
          continue;
        }
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
    const listeners = createEmitter();
    function cached() {
      if (!cacheRead) {
        current = readCache();
        cacheRead = current !== null;
      }
      return current;
    }
    function notify(value) {
      listeners.emit(value);
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
        return listeners.subscribe(listener);
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
  function attachCounts(entries, counts) {
    if (!counts || counts.max <= 0) {
      return 0;
    }
    const { counts: byId, max } = counts;
    for (const entry of entries) {
      entry.count = byId.get(tagKeyIdFromFolded(entry.folded)) ?? 0;
    }
    return max;
  }
  function keysAreSorted(entries) {
    for (let index = 1;index < entries.length; index++) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (previous !== undefined && current !== undefined && previous.key > current.key) {
        return false;
      }
    }
    return true;
  }
  function buildIndex(groups, updated, counts) {
    const entries = [];
    const byNamespace = new Map;
    for (const namespace of TAG_NAMESPACES) {
      const keys = groups.get(namespace.id);
      if (!keys || keys.length === 0) {
        continue;
      }
      const scoped = [];
      for (const key of keys) {
        const folded = fold(key);
        const entry = { ns: namespace, key, folded, count: 0 };
        entries.push(entry);
        scoped.push(entry);
      }
      if (!keysAreSorted(scoped)) {
        scoped.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      }
      byNamespace.set(namespace.id, scoped);
    }
    const maxCount = attachCounts(entries, counts);
    let lookup = null;
    return {
      entries,
      updated,
      byNamespace,
      maxCount,
      get lookup() {
        if (lookup === null) {
          lookup = new Map;
          for (const entry of entries) {
            lookup.set(tagId(entry.ns.id, entry.key), entry);
          }
        }
        return lookup;
      }
    };
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
        const cleaned = [];
        for (const key of keys) {
          if (typeof key !== "string") {
            continue;
          }
          const value = cleanTagKey(key);
          if (value !== "") {
            cleaned.push(value);
          }
        }
        groups.set(id, cleaned);
      }
    }
    const index = buildIndex(groups, updated, counts);
    return index.entries.length === 0 ? null : index;
  }
  function withTagCounts(current, counts) {
    if (!counts || counts.max <= 0) {
      return current;
    }
    const maxCount = attachCounts(current.entries, counts);
    return {
      entries: current.entries,
      updated: current.updated,
      byNamespace: current.byNamespace,
      maxCount,
      get lookup() {
        return current.lookup;
      }
    };
  }
  function readIndexCache() {
    const stored = indexStore.read();
    const counts = getTagCounts();
    const index = decodeIndex(stored.payload, stored.updated, counts ?? undefined);
    return index ? { value: { index, counts }, updated: stored.updated } : null;
  }
  var core;
  var coreCounts = null;
  function coreIndex() {
    if (core === undefined) {
      const generated = coreTagData();
      const counts = getTagCounts() ?? generated?.counts ?? null;
      core = generated === null ? null : buildTagIndexFromGroups(generated.groups, 0, counts ?? undefined);
      coreCounts = counts;
    }
    return core;
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
      const index = buildTagIndexFromGroups(vocabulary, Date.now(), counts ?? undefined);
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
  var coreChanges = createEmitter();
  function onTagIndexChange(listener) {
    const offSnapshot = indexSnapshot.onChange(listener);
    const offCore = coreChanges.subscribe(listener);
    return () => {
      offSnapshot();
      offCore();
    };
  }
  function applyTagCounts(counts) {
    const current = indexSnapshot.get();
    if (current !== null && current.counts !== counts) {
      const next = withTagCounts(current.index, counts);
      if (next !== current.index) {
        indexSnapshot.publish({ index: next, counts });
      }
    }
    if (core !== undefined && core !== null && coreCounts !== counts) {
      const next = withTagCounts(core, counts);
      if (next !== core) {
        core = next;
        coreCounts = counts;
        if (current === null) {
          coreChanges.emit();
        }
      }
    }
  }
  onTagCountsChange(applyTagCounts);
  function getTagIndex() {
    return indexSnapshot.get()?.index ?? coreIndex();
  }
  async function loadTagIndex(force = false) {
    loadTagCounts().catch((error) => {
      warn("Tag popularity refresh failed", error);
    });
    if (!force) {
      const cached = indexSnapshot.get();
      if (cached) {
        const loaded = await indexSnapshot.load(false);
        return loaded?.index ?? cached.index;
      }
      const fallback = coreIndex();
      if (fallback) {
        indexSnapshot.load(false).catch((error) => {
          warn("Tag index background download failed", error);
        });
        return fallback;
      }
    }
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
  function usageEntry(index, id) {
    const separator = id.indexOf("\x00");
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
      const middle = low + high >>> 1;
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
  function recentEntries(index, usage, limit, now) {
    return [...usage.entries()].map(([id]) => {
      const entry = usageEntry(index, id);
      if (!entry) {
        return null;
      }
      return { entry, score: usageBoost(usage, entry, now) };
    }).filter((item) => item !== null).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.entry);
  }
  function compareRank(score, entry, otherScore, other) {
    return otherScore - score || entry.key.length - other.key.length || (entry.key < other.key ? -1 : entry.key > other.key ? 1 : 0) || (entry.ns.id < other.ns.id ? -1 : 1);
  }
  function keepBestTag(items, candidate, limit) {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = low + high >>> 1;
      const current = items[middle];
      if (current !== undefined && compareRank(candidate.score, candidate.entry, current.score, current.entry) < 0) {
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
  function tagSuggestions(entries, query, applied, usage, now, maxCount, prefixNs, completions, limit) {
    const items = [];
    let total = 0;
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
      const score = match.score + (hasUsage ? usageBoost(usage, entry, now) : 0) + (hasCompletions ? completionBoost(completions, entry, prefixNs, query, now) : 0);
      const worst = items.length >= limit ? items[items.length - 1] : undefined;
      if (worst !== undefined && compareRank(score, entry, worst.score, worst.entry) >= 0) {
        continue;
      }
      keepBestTag(items, {
        kind: "tag",
        entry,
        score,
        matchStart: match.at,
        matchLength: query.length,
        applied: hasApplied ? applied.get(`${entry.ns.id}\x00${entry.folded}`) ?? null : null,
        recent: hasUsage && usage.has(tagId(entry.ns.id, entry.key))
      }, limit);
    }
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
      const { items, total } = tagSuggestions(entries, query, applied, usage, now, index.maxCount, namespace.id, completions, limit);
      return { term: phrase, items, total, empty: false };
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
    const { items, total } = tagSuggestions(index.entries, query, applied, usage, now, index.maxCount, "", completions, limit);
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

  // src/ui/text.ts
  function plural(count, singular, pluralForm = `${singular}s`) {
    return count === 1 ? singular : pluralForm;
  }
  function countText(count, singular, pluralForm) {
    return `${count} ${plural(count, singular, pluralForm)}`;
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
  function countsRevision(counts) {
    let revision = counts.size;
    for (const [id, value] of counts) {
      revision = Math.imul(revision, 31) + value.count + value.lastUsed | 0;
      for (let index = 0;index < id.length; index += 1) {
        revision = Math.imul(revision, 31) + id.charCodeAt(index) | 0;
      }
    }
    return revision;
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
    let indexRevision = 0;
    let lastRenderKey = null;
    let renderFrame = null;
    if (enabled()) {
      deps.getIndex();
    }
    stopIndexWatch = onTagIndexChange(() => {
      if (destroyed) {
        return;
      }
      const latest = deps.getIndex();
      if (latest) {
        adoptIndex(latest);
        if (state === "idle") {
          state = "ready";
        }
      }
      indexRevision += 1;
      scheduleRender();
    });
    function enabled() {
      return getSettings().tagSuggestions;
    }
    function isOpen() {
      return popover !== null;
    }
    function adoptIndex(next) {
      if (next === index) {
        return;
      }
      index = next;
      indexRevision += 1;
    }
    function cancelScheduledRender() {
      cancelFrame(renderFrame);
      renderFrame = null;
    }
    function scheduleRender() {
      if (!isOpen() || renderFrame !== null) {
        return;
      }
      renderFrame = requestFrame(() => {
        renderFrame = null;
        render();
      });
    }
    function flushScheduledRender() {
      if (renderFrame === null) {
        return;
      }
      cancelFrame(renderFrame);
      renderFrame = null;
      render();
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
      adoptIndex(latest);
      if (latest && state === "idle") {
        state = "ready";
      }
      const stateKey = `${state}\x00${indexRevision}\x00${excludeActive() ? "1" : "0"}`;
      if (state === "loading" && !index) {
        if (lastRenderKey === stateKey) {
          return;
        }
        lastRenderKey = stateKey;
        list.setAttribute("aria-busy", "true");
        renderMessage("Loading tags…", "The tag vocabulary is downloaded once and cached.", false);
        if (countLabel) {
          countLabel.textContent = "Loading tag list…";
        }
        return;
      }
      if (state === "error" && !index) {
        if (lastRenderKey === stateKey) {
          return;
        }
        lastRenderKey = stateKey;
        list.removeAttribute("aria-busy");
        renderMessage("Tag suggestions unavailable", "Search still works: type a tag and press Enter.", true);
        if (countLabel) {
          countLabel.textContent = "Could not load the tag list";
        }
        return;
      }
      if (!index) {
        if (lastRenderKey === stateKey) {
          return;
        }
        lastRenderKey = stateKey;
        list.removeAttribute("aria-busy");
        renderMessage("Tag suggestions unavailable", "Type a tag and press Enter.", false);
        return;
      }
      const caret = inputCaret(input);
      const usage = deps.getUsage();
      const completions = deps.getCompletions();
      const key = [
        stateKey,
        input.value,
        caret,
        countsRevision(usage),
        countsRevision(completions)
      ].join("\x00");
      if (lastRenderKey === key) {
        return;
      }
      lastRenderKey = key;
      list.removeAttribute("aria-busy");
      result = buildSuggestions(index, input.value, caret, usage, LIMIT, completions);
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
        adoptIndex(cached);
        state = "ready";
        deps.loadIndex().catch(() => {});
        return;
      }
      state = "loading";
      loading = deps.loadIndex().then((built) => {
        adoptIndex(built);
        state = "ready";
      }).catch(() => {
        state = "error";
      }).finally(() => {
        loading = null;
        scheduleRender();
      });
    }
    function buildPanel() {
      if (popover) {
        return;
      }
      lastRenderKey = null;
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
      excludeButton = buttonEl({
        class: "tag-combobox-exclude tag-combobox-exclude-toggle",
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
      retryButton = buttonEl({
        class: "tag-combobox-exclude is-retry",
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
        render();
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
    }
    function open() {
      if (destroyed || !enabled()) {
        return;
      }
      buildPanel();
      render();
    }
    function clearPanel() {
      cancelScheduledRender();
      lastRenderKey = null;
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
        scheduleRender();
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
      flushScheduledRender();
      if (event.key === "Control" || event.key === "Meta") {
        if (!modifierExclude) {
          modifierExclude = true;
          scheduleRender();
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
          scheduleRender();
        }
        return;
      }
      if (isOpen() && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        scheduleRender();
      }
    }
    function onCompositionStart() {
      composing = true;
    }
    function onCompositionEnd() {
      composing = false;
      if (enabled()) {
        open();
      }
    }
    function onClick() {
      if (!enabled() || composing) {
        return;
      }
      open();
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
        scheduleRender();
      }
    }, { signal });
    signal?.addEventListener("abort", destroy, { once: true });
    setInputAttributes(false);
    return {
      open,
      refresh: scheduleRender
    };
  }

  // src/ui/quick-tags-editor.ts
  function openQuickTagEditor(anchor, signal, onSaved, options = {}) {
    const draft = quickTags().map((entry) => ({ ...entry }));
    const seed = options.seed?.trim() ?? "";
    if (seed !== "") {
      draft.push({ name: "", query: seed, savedAt: Date.now() });
    }
    const list = el("div", { class: "quick-tag-list" });
    let panel = null;
    let rowSignal = null;
    const focusQuery = (index) => {
      list.querySelectorAll(".quick-tag-query")[index]?.focus();
    };
    const renderRows = (focusIndex) => {
      rowSignal?.abort();
      const rows = new AbortController;
      rowSignal = rows;
      list.replaceChildren(...draft.map((entry, index) => {
        const name = textInput({
          class: "field-input quick-tag-input quick-tag-name",
          value: entry.name,
          placeholder: "Name",
          "aria-label": `Quick tag ${index + 1} name`
        });
        name.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, name: name.value };
          }
        });
        const query = textInput({
          class: "field-input quick-tag-input quick-tag-query",
          value: entry.query,
          placeholder: 'f:tag$ ~p:"other tag$"',
          "aria-label": `Quick tag ${index + 1} search`
        });
        query.addEventListener("input", () => {
          const current = draft[index];
          if (current !== undefined) {
            draft[index] = { ...current, query: query.value };
          }
        });
        if (getSettings().tagSuggestions) {
          attachTagCombobox({ input: query, signal: rows.signal });
        }
        const remove = buttonEl({
          class: "quick-tag-remove",
          text: "×",
          title: "Remove quick tag",
          "aria-label": `Remove quick tag ${index + 1}`
        });
        remove.addEventListener("click", () => {
          draft.splice(index, 1);
          renderRows();
        });
        return el("div", { class: "quick-tag-row" }, name, query, remove);
      }));
      if (focusIndex !== undefined) {
        focusQuery(focusIndex);
      }
    };
    const add = buttonEl({ class: "btn btn-ghost btn-small", text: "+ Add" });
    add.addEventListener("click", () => {
      draft.push({ name: "", query: "", savedAt: Date.now() });
      renderRows(draft.length - 1);
    });
    const save = buttonEl({ class: "btn btn-small", type: "submit", text: "Save" });
    const cancel = buttonEl({ class: "btn btn-ghost btn-small", text: "Cancel" });
    cancel.addEventListener("click", () => {
      panel?.close();
    });
    const form = el("form", { class: "quick-tag-editor" }, el("p", { class: "quick-tag-editor-title", text: "Quick tags" }), el("p", {
      class: "quick-tag-editor-hint",
      text: "Click a quick tag to add its terms to the search, or remove them when all are present."
    }), list, el("div", { class: "quick-tag-editor-actions" }, add, el("span", { class: "quick-tag-editor-spacer" }), cancel, save));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      replaceQuickTags(draft.map((entry) => ({
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
      label: "Quick tags",
      className: "quick-tag-editor-panel",
      signal,
      autoFocus: true,
      onClose: () => {
        rowSignal?.abort();
        rowSignal = null;
      }
    });
    if (seed !== "") {
      focusQuery(draft.length - 1);
    }
  }

  // src/ui/search-history.ts
  function queryButton(text, label, onPick) {
    return buttonEl({ class: "search-history-query", title: text, onclick: onPick }, el("span", { class: "search-history-name", text: label }), label === text ? null : el("span", { class: "search-history-text", text }));
  }
  function searchHistoryButton(options) {
    const button = buttonEl({
      class: "topbar-history",
      "aria-label": "Search history",
      title: "Recent searches and quick tags",
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
        const clear = buttonEl({ class: "search-history-clear", text: "Clear recent" });
        clear.addEventListener("click", () => {
          clearRecentQueries();
          renderInto(container, close);
        });
        container.append(clear);
      }
      const tags = quickTags();
      if (tags.length > 0) {
        container.append(el("h3", { class: "search-history-heading", text: "Quick tags" }));
        const list = el("div", { class: "search-history-list" });
        for (const entry of tags) {
          const row = el("div", { class: "search-history-quick-tag" });
          row.append(queryButton(entry.query, entry.name, () => {
            close();
            options.onToggle(entry.query);
          }));
          const remove = buttonEl({
            class: "search-history-remove",
            text: "×",
            "aria-label": `Remove quick tag ${entry.name}`,
            title: `Remove ${entry.name}`
          });
          remove.addEventListener("click", () => {
            removeQuickTag(entry.name);
            renderInto(container, close);
          });
          row.append(remove);
          list.append(row);
        }
        container.append(list);
        const edit = buttonEl({
          class: "search-history-edit",
          text: "Edit quick tags",
          title: "Edit quick tags"
        });
        edit.addEventListener("click", () => {
          openQuickTagEditor(edit, options.signal, () => {
            renderInto(container, close);
          });
        });
        container.append(edit);
      }
      if (recent.length === 0 && tags.length === 0) {
        container.append(el("p", {
          class: "search-history-empty",
          text: "No recent searches or quick tags yet."
        }));
      }
      const saveCurrent = buttonEl({
        class: "btn btn-small search-history-save-current",
        text: "Save current as quick tag",
        title: "Save the current search as a quick tag",
        "aria-haspopup": "dialog",
        "aria-expanded": "false"
      });
      saveCurrent.addEventListener("click", () => {
        openQuickTagEditor(saveCurrent, options.signal, () => {
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
      {
        key: "front",
        label: "Front Page",
        target: { kind: "internal", path: FRONT_PATH },
        primary: true
      },
      {
        key: "watched",
        label: "Watched",
        target: { kind: "internal", path: WATCHED_PATH },
        primary: true
      },
      {
        key: "popular",
        label: "Popular",
        target: { kind: "internal", path: POPULAR_PATH },
        primary: true
      },
      {
        key: "torrents",
        label: "Torrents",
        target: { kind: "internal", path: SITE_PATHS.torrents },
        primary: true
      },
      {
        key: "favorites",
        label: "Favorites",
        target: { kind: "internal", path: SITE_PATHS.favorites },
        primary: true,
        accountOnly: true
      },
      {
        key: "settings",
        label: "Settings",
        target: { kind: "internal", path: SITE_PATHS.uconfig },
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
        target: { kind: "internal", path: SITE_PATHS.myTags },
        accountOnly: true
      },
      { key: "home", label: "My Home", target: { kind: "internal", path: SITE_PATHS.home } },
      { key: "toplist", label: "Toplists", target: { kind: "internal", path: SITE_PATHS.toplist } },
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
    requestFrame(apply);
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
    const moreButton = buttonEl({
      class: "topbar-more btn btn-ghost btn-small",
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
    return buttonEl({
      class: "icon-btn",
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
    return el("a", { class: "brand", href: "/", "aria-label": "E-H home" }, "E-H");
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
    const clear = buttonEl({
      class: "topbar-clear",
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
        setSearchDraftText(toggleExpressionInSearch(getSearchDraft().text, text));
      },
      signal: options.signal ?? new AbortController().signal
    });
    form.append(el("span", { class: "topbar-search-icon" }, icon("search")), input, clear, hint, history2, buttonEl({ class: "topbar-search-submit", type: "submit", "aria-label": "Search" }, el("span", { class: "topbar-search-submit-icon" }, icon("search")), el("span", { class: "topbar-search-submit-label", text: "Search" })));
    const filters = el("div", { class: "topbar-filters", hidden: "hidden" });
    let renderedText = "";
    let filtersFrame = null;
    let pendingText = null;
    const chipsFromDraft = options.draftChips === true;
    function syncChromeVisibility() {
      const described = pendingText ?? renderedText;
      const clearing = pendingText !== null && pendingText.trim() === "";
      filters.hidden = input.value !== described || filters.childElementCount === 0 || clearing;
      clear.hidden = input.value === "";
      hint.hidden = document.activeElement === input || input.value !== "";
    }
    function syncInputChrome() {
      syncChromeVisibility();
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
      flushFilters();
      if (action.type === "clear") {
        input.focus();
        return;
      }
      const nodes = [...filters.querySelectorAll(".term-toggle")];
      (nodes[action.index] ?? nodes[action.index - 1] ?? input).focus();
    };
    const chips = createSearchChips(applyChip, options.signal);
    function drawFilters(text) {
      renderedText = text;
      if (chips.update(text)) {
        if (filters.firstElementChild !== chips.element) {
          filters.replaceChildren(chips.element);
        }
      } else if (filters.childElementCount !== 0) {
        filters.replaceChildren();
      }
      syncInputChrome();
    }
    function cancelFiltersDraw() {
      cancelFrame(filtersFrame);
      filtersFrame = null;
      pendingText = null;
    }
    function runFiltersDraw() {
      filtersFrame = null;
      const text = pendingText;
      pendingText = null;
      if (text !== null && text !== renderedText) {
        drawFilters(text);
      } else {
        syncInputChrome();
      }
    }
    function scheduleFilters(text) {
      pendingText = text;
      syncChromeVisibility();
      if (filtersFrame !== null) {
        return;
      }
      filtersFrame = requestFrame(runFiltersDraw);
    }
    function flushFilters() {
      if (pendingText === null) {
        return;
      }
      cancelFrame(filtersFrame);
      filtersFrame = null;
      runFiltersDraw();
    }
    function applyState(state) {
      if (input.value !== state.text) {
        input.value = state.text;
        combobox?.refresh();
      }
      const text = chipsFromDraft ? state.text : state.query.text;
      if (text !== renderedText) {
        if (chipsFromDraft) {
          scheduleFilters(text);
        } else {
          cancelFiltersDraw();
          drawFilters(text);
        }
      } else {
        cancelFiltersDraw();
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
    drawFilters(chipsFromDraft ? initial.text : initial.query.text);
    const unsubscribe = subscribeSearchDraft(applyState);
    const signal = options.signal;
    const cleanup = () => {
      unsubscribe();
      cancelFiltersDraw();
      chips.destroy();
    };
    if (signal !== undefined) {
      if (signal.aborted) {
        cleanup();
      } else {
        signal.addEventListener("abort", cleanup, { once: true });
      }
    }
    return element;
  }

  // src/ui/page-scaffold.ts
  function pageScaffold(host, options) {
    host.replaceChildren(siteNav(options.signal), listHeader({ title: options.title, summary: options.summary }));
    return host;
  }
  function galleryBackLink(href, className) {
    return el("a", { class: className, href, text: "Back to gallery" });
  }

  // src/ui/error-text.ts
  function errorText(error, fallback = "Something went wrong.") {
    return error instanceof Error ? error.message : fallback;
  }

  // src/ui/pending-action.ts
  function createPendingAction() {
    let running = false;
    return {
      get busy() {
        return running;
      },
      async run(hooks) {
        if (running) {
          return false;
        }
        running = true;
        hooks.setBusy?.(true);
        let recover = false;
        try {
          let result;
          try {
            result = await hooks.run();
          } catch (error) {
            if (hooks.signal.aborted) {
              return false;
            }
            hooks.failed?.(errorText(error, hooks.failure ?? "The action failed."));
            recover = true;
            return false;
          }
          if (hooks.signal.aborted) {
            return false;
          }
          hooks.success?.(result);
          return true;
        } finally {
          running = false;
          hooks.setBusy?.(false);
          if (recover) {
            hooks.recover?.()?.focus();
          }
        }
      }
    };
  }

  // src/ui/state-panel.ts
  function nativePageAction(href = nativeUrl()) {
    return { label: "Open native page", href, native: true };
  }
  function nativeEmptyPanel(text) {
    return statePanel({ text, actions: [nativePageAction()] });
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
    return buttonEl({ class: classes, text: action.label, onclick: action.onClick });
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

  // src/views/archive.ts
  function optionTitle(option) {
    return option.kind === "original" ? "Original archive" : "Resampled archive";
  }
  function costText(cost) {
    switch (cost.kind) {
      case "free":
        return "Free";
      case "gp":
        return `${cost.amount.toLocaleString("en-US")} GP`;
      case "unavailable":
        return "Not available";
      case "insufficient":
        return "Insufficient funds";
      case "unknown":
        return cost.text === "" ? "Unknown" : cost.text;
    }
  }
  function unavailableNote(option) {
    if (option.available) {
      return null;
    }
    switch (option.cost.kind) {
      case "unavailable":
        return "The site does not offer this archive for the gallery.";
      case "insufficient":
        return "This account does not have enough GP for this archive.";
      case "unknown":
        return "The cost could not be read, so the app will not spend GP on this archive.";
      case "free":
      case "gp":
        return "The site does not offer this download for the gallery.";
    }
  }
  function optionCard(option, ctx, controls, pending, handoff, startDownload, openDownload) {
    const note = unavailableNote(option);
    const status = el("p", { class: "archive-option-status", role: "status", "aria-live": "polite" });
    const button = buttonEl({
      class: "btn btn-primary archive-download",
      disabled: option.available ? null : "disabled",
      text: `Download ${option.kind === "original" ? "original" : "resampled"} archive`
    });
    controls.push({ button, available: option.available });
    button.addEventListener("click", () => {
      if (!option.available) {
        return;
      }
      pending.run({
        run: () => startDownload(option, ctx.signal),
        signal: ctx.signal,
        setBusy: (busy) => {
          button.toggleAttribute("aria-busy", busy);
          for (const control of controls) {
            control.button.disabled = busy || handoff.locked || !control.available;
          }
          if (busy) {
            status.removeAttribute("role");
            status.textContent = "Preparing the archive…";
          }
        },
        success: (href) => {
          handoff.locked = true;
          status.textContent = "Archive ready. Starting the download…";
          openDownload(href);
        },
        failure: "The archive could not be prepared.",
        failed: (message) => {
          status.setAttribute("role", "alert");
          status.textContent = message;
        }
      });
    }, { signal: ctx.signal });
    const cost = costText(option.cost);
    return el("article", { class: "archive-option" }, el("h2", { class: "archive-option-title", text: optionTitle(option) }), el("div", { class: "archive-option-meta" }, factRow("Size", option.size ?? "N/A"), factRow("Cost", cost)), option.cost.kind === "gp" ? el("p", {
      class: "archive-option-note",
      text: `This download spends ${cost} when it starts.`
    }) : null, note === null ? null : el("p", { class: "archive-option-note", text: note }), button, status);
  }
  function galleryLinks2(data) {
    const links = [];
    if (data.galleryHref !== null) {
      links.push(galleryBackLink(data.galleryHref, "meta-link"));
    }
    if (data.torrentsHref !== null) {
      links.push(el("a", { class: "meta-link", href: data.torrentsHref, text: "Torrents" }));
    }
    return links.length === 0 ? null : el("div", { class: "archive-links" }, ...links);
  }
  function fundsLine(funds) {
    if (funds === null || funds.gp === null && funds.credits === null) {
      return null;
    }
    const parts = [];
    if (funds.gp !== null) {
      parts.push(`${funds.gp} GP`);
    }
    if (funds.credits !== null) {
      parts.push(`${funds.credits} Credits`);
    }
    return el("p", { class: "archive-funds", text: `Available: ${parts.join(" · ")}` });
  }
  function renderArchive(host, data, ctx, deps = {}) {
    const startDownload = deps.startDownload ?? startArchiveDownload;
    const openDownload = deps.openDownload ?? ((href) => {
      window.location.href = href;
    });
    const controls = [];
    const pending = createPendingAction();
    const handoff = { locked: false };
    const options = [data.original, data.resample].filter((option) => option !== null);
    const grid = el("div", { class: "archive-options" }, ...options.map((option) => optionCard(option, ctx, controls, pending, handoff, startDownload, openDownload)));
    const empty = options.length === 0 ? statePanel({
      title: "No archive options",
      text: "The site did not offer an archive for this gallery."
    }) : null;
    const native = nativePageAction(nativeUrl(data.url));
    pageScaffold(host, {
      title: data.title === "" ? "Archive Download" : data.title,
      summary: [el("span", { class: "badge", text: "Archive Download" })],
      signal: ctx.signal
    });
    appendChildren(host, [
      fundsLine(data.funds) ?? null,
      empty ?? grid,
      galleryLinks2(data) ?? null,
      el("div", { class: "archive-footer" }, el("a", { class: "btn btn-ghost", href: native.href, "data-native": "", text: native.label }))
    ]);
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
    const { doc } = await loader.document(siteUrl(SITE_PATHS.uconfig), {
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
    const url = galleryPopupUrl(gallery.gid, gallery.token, "addfav");
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
    const url = galleryPopupUrl(gallery.gid, gallery.token, "addfav");
    const { doc } = await loader.document(url, {
      priority: priorityOf("background"),
      tag: "favnote",
      signal,
      fresh: true
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
    const response = await postForm(siteUrl(SITE_PATHS.favorites), body, {
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
    let frame = null;
    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = requestFrame(() => {
        frame = null;
        apply(getSettings());
      });
    };
    const off = onSettingsChange(schedule);
    window.addEventListener("resize", schedule, { passive: true });
    const cleanup = () => {
      off();
      cancelFrame(frame);
      frame = null;
      window.removeEventListener("resize", schedule);
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
    let placed = false;
    function measureWidth() {
      return element.clientWidth || element.getBoundingClientRect().width || 0;
    }
    function columnCount(width) {
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
      const width = measureWidth();
      element.style.setProperty("--gap", `${getSettings().gap}px`);
      if (!placed) {
        return;
      }
      const count = columnCount(width);
      if (count !== columns.length) {
        rebuild(count);
      }
    }
    bindViewScale({ signal, apply: layout });
    return {
      element,
      append: (incoming) => {
        if (!placed) {
          for (const card of incoming) {
            cards.push(card);
          }
          return;
        }
        for (const card of incoming) {
          cards.push(card);
          columns[nextColumn]?.append(card);
          nextColumn = (nextColumn + 1) % columns.length;
        }
      },
      size: () => cards.length,
      remove: (removing) => {
        const removed = new Set(removing);
        for (const card of removing) {
          card.remove();
        }
        let kept = 0;
        for (const card of cards) {
          if (!removed.has(card)) {
            cards[kept] = card;
            kept += 1;
          }
        }
        cards.length = kept;
        nextColumn = cards.length % Math.max(1, columns.length);
      },
      refresh: () => {
        const width = measureWidth();
        element.style.setProperty("--gap", `${getSettings().gap}px`);
        placed = true;
        rebuild(columnCount(width));
      }
    };
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
    const form = el("form", { class: "pager-jump" }, el("label", { class: "pager-jump-label", text: label }), input, buttonEl({ class: "btn btn-small", type: "submit", text: "Go" }));
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
  function numberedPager({
    baseUrl,
    page,
    total,
    param,
    label,
    navigate,
    prev = null,
    next = null,
    info = ""
  }) {
    const href = (target) => pageHref(baseUrl, target, param);
    return pager({
      prev,
      next,
      info,
      label,
      pages: { current: page, total, href },
      jump: { current: page, go: (target) => navigate(href(target)) }
    });
  }

  // src/ui/stars.ts
  var HALF_STEPS = 10;
  function litHalves(value) {
    return Math.min(HALF_STEPS, Math.max(0, Math.round(value * 2)));
  }
  function halfClass(half) {
    return `rating-half ${half % 2 === 1 ? "rating-half-left" : "rating-half-right"}`;
  }
  var GLYPH_PROTOTYPES = new WeakMap;
  function glyphPrototypes() {
    const doc = document;
    const cached = GLYPH_PROTOTYPES.get(doc);
    if (cached !== undefined) {
      return cached;
    }
    const outline = icon("star", false);
    outline.classList.add("rating-half-off");
    const filled = icon("star", true);
    filled.classList.add("rating-half-on");
    const pair = [outline, filled];
    GLYPH_PROTOTYPES.set(doc, pair);
    return pair;
  }
  function starGlyphs() {
    const [outline, filled] = glyphPrototypes();
    return [outline.cloneNode(true), filled.cloneNode(true)];
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
    const nativeFavoriteUrl = galleryPopupUrl(state.gid, state.token, "addfav");
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
        grid.append(buttonEl({
          class: current ? "fav-item is-current" : "fav-item",
          "aria-current": current ? "true" : null,
          onclick: () => {
            apply(folder);
          }
        }, favoriteDot(folder.color), el("span", { class: "fav-name", text: folder.name }), current ? el("span", { class: "fav-check", "aria-hidden": "true", text: "✓" }) : null));
      }
      content.append(grid);
      if (snapshot.favorited !== false) {
        content.append(buttonEl({
          class: "fav-item fav-remove",
          onclick: () => {
            apply(null);
          }
        }, favoriteDot("var(--color-danger)"), el("span", { class: "fav-name", text: "Remove from favorites" })));
      }
      content.append(el("a", {
        class: "fav-link",
        href: siteUrl(SITE_PATHS.uconfig),
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
        if (await noteLoad === null) {
          throw new Error("Could not read the saved note.");
        }
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
    const noteLoad = state.get().favorited === true ? loadNote(controller.signal).catch(() => null) : Promise.resolve("");
    noteLoad.then((savedNote) => {
      if (!controller.signal.aborted && note.value === "" && savedNote !== null) {
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
    const button = buttonEl({
      class: "fav-btn",
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
      link.setAttribute("aria-label", `${item.title.primary} - no cover`);
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
    let posted = null;
    const meta = el("div", { class: "card-meta" }, ...cardFactRows(item, (text) => {
      posted = el("span", { class: "card-posted", text });
      return posted;
    }));
    if (item.torrentsHref) {
      meta.append(el("a", {
        class: "card-torrent",
        href: item.torrentsHref,
        title: "Show torrents",
        "aria-label": "Show torrents"
      }, icon("download")));
    }
    return { element: meta, posted };
  }
  function resultCard(item, signal, options = {}) {
    const favorite = createFavoriteState(item, item.favorite);
    const { element: meta, posted } = cardMeta(item);
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
    article.append(cover, body);
    return article;
  }

  // src/views/favorites-selection.ts
  function createSelection(gids) {
    const order = [...gids];
    const positions = new Map(order.map((gid, index) => [gid, index]));
    const chosen = new Set;
    const selectionChanged = createEmitter();
    let anchor = null;
    const notify = () => {
      selectionChanged.emit();
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
        return selectionChanged.subscribe(listener);
      }
    };
  }

  // src/views/favorites.ts
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
    const url = new URL(SITE_PATHS.favorites, baseUrl);
    for (const [key, value] of new URL(baseUrl).searchParams) {
      if (key !== "favcat" && key !== "next" && key !== "prev" && key !== "page") {
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
    url.searchParams.set("inline_set", orderParam(order));
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
    const labels = favoritesLabels(data);
    const remove = deps?.remove ?? deleteFavorites;
    const move = deps?.move ?? moveFavorites;
    const selection = createSelection(data.items.map((item) => item.gid));
    const pending = createPendingAction();
    let retryAction = null;
    let movePopover = null;
    let armedDelete = false;
    let armedCount = 0;
    let armTimer;
    const countLabel = el("span", { class: "favorites-bulk-count" });
    const statusText = el("span", { class: "favorites-bulk-status", role: "status" });
    statusText.hidden = true;
    const retryButton = buttonEl({ class: "btn btn-small favorites-retry", text: "Retry" });
    const removeButton = buttonEl({ class: "btn btn-small favorites-delete", text: "Delete" });
    const moveButton = buttonEl({
      class: "btn btn-small favorites-move",
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
    const boxes = new Map;
    const disarmDelete = () => {
      armedDelete = false;
      armedCount = 0;
      clearTimeout(armTimer);
      removeButton.classList.remove("is-armed");
      removeButton.textContent = "Delete";
    };
    const syncBar = () => {
      const total = selection.size;
      const hidden = total === 0;
      if (bar.hidden !== hidden) {
        bar.hidden = hidden;
        syncBulkSpace();
      }
      const label = `${total} selected`;
      if (countLabel.textContent !== label) {
        countLabel.textContent = label;
      }
      statusText.hidden = retryAction === null;
      retryButton.hidden = retryAction === null;
      removeButton.disabled = total === 0 || pending.busy;
      moveButton.disabled = total === 0 || pending.busy;
      retryButton.disabled = pending.busy;
      if (total === 0 || armedDelete && total !== armedCount) {
        disarmDelete();
      }
      selectAll.checked = selection.all;
      selectAll.indeterminate = selection.some && !selection.all;
      for (const [gid, box] of boxes) {
        const checked = selection.has(gid);
        if (box.checked !== checked) {
          box.checked = checked;
        }
      }
    };
    const perform = (action) => {
      if (pending.busy || selection.size === 0) {
        return;
      }
      retryAction = null;
      statusText.hidden = true;
      syncBar();
      pending.run({
        run: action.run,
        signal: ctx.signal,
        setBusy: () => {
          syncBar();
        },
        success: () => {
          showToast(action.success);
          selection.clear();
          ctx.reload();
        },
        failure: "Favorite update failed.",
        failed: (message) => {
          retryAction = action;
          statusText.textContent = message;
        },
        recover: () => retryButton
      });
    };
    const openMoveMenu = () => {
      movePopover?.close();
      const content = el("div", { class: "favorites-move-panel", role: "none" }, el("div", { class: "favorites-move-head", role: "presentation", text: "Move to folder" }));
      if (data.folders.length === 0) {
        content.append(el("div", { class: "favorites-move-empty", text: "No favorite folders found." }));
      }
      for (const folder of data.folders) {
        const choice = buttonEl({ class: "favorites-move-item", role: "menuitem" }, el("span", { class: "favorites-move-name", text: folder.name }), el("span", { class: "favorites-move-count", text: String(folder.count) }));
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
      boxes.set(item.gid, checkbox);
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
      if (selection.size === 0) {
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
    search.append(searchInput, buttonEl({ class: "btn btn-small", type: "submit", text: "Search" }));
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
    pageScaffold(host, {
      title: labels.heading,
      summary: [el("span", { text: summaryText(data) })],
      signal: ctx.signal
    });
    host.append(search, tabs, order, toolbar);
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
  function siteUrl2(url) {
    const resolved = new URL(url, location.href);
    if (resolved.protocol !== "https:" || !isSiteHost(resolved.hostname)) {
      throw new Error("Gallery request refused: the endpoint is not on this site.");
    }
    return resolved.href;
  }
  function postJson2(url, body) {
    return postJson(siteUrl2(url), body, {
      tag: "gallery-action",
      failure: "Gallery request failed"
    });
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
  async function readCommentPage(response, fallbackUrl) {
    const text = await response.text();
    if (!isHtmlResponse(response, text)) {
      return;
    }
    return {
      doc: new DOMParser().parseFromString(text, "text/html"),
      url: response.url === "" ? fallbackUrl : response.url
    };
  }
  async function editComment(url, commentId, text, signal) {
    const response = await postForm(url, new URLSearchParams({ commenttext_edit: text, edit_comment: String(commentId) }), { tag: "gallery-comment", failure: "Comment edit failed", signal });
    return readCommentPage(response, url);
  }
  async function postComment(url, text, signal) {
    const response = await postForm(url, new URLSearchParams({ commenttext_new: text }), {
      tag: "gallery-comment",
      failure: "Comment post failed",
      signal
    });
    return readCommentPage(response, url);
  }

  // src/data/my-tags.ts
  var DEFAULT_WEIGHT2 = 10;
  function tagsetBody(fields, overrides) {
    const body = new URLSearchParams;
    const emitted = new Set;
    for (const field of fields) {
      const value = overrides.get(field.name) ?? field.value;
      emitted.add(field.name);
      if (field.kind === "checkbox" && value === "") {
        continue;
      }
      body.append(field.name, value);
    }
    for (const [name, value] of overrides) {
      if (!emitted.has(name)) {
        body.append(name, value);
      }
    }
    return body;
  }
  function normalizeName(name) {
    return collapseWhitespace(name).toLowerCase();
  }
  var userTagCache = new Map;
  function cacheUserTags(tags) {
    for (const tag of tags) {
      userTagCache.set(normalizeName(tag.name), tag);
    }
  }
  function lookupUserTag(name) {
    return userTagCache.get(normalizeName(name));
  }
  function normalizeWeight(weight) {
    if (weight === null || weight === undefined || !Number.isFinite(weight)) {
      return DEFAULT_WEIGHT2;
    }
    return Math.min(99, Math.max(-99, Math.round(weight)));
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
  async function saveUserTag(deps, id, next) {
    const post = deps.post ?? ((url, body) => postTagJson(url, body, deps.signal));
    const data = await post(deps.config.apiUrl, {
      method: "setusertag",
      apiuid: deps.config.apiUid,
      apikey: deps.config.apiKey,
      tagid: id,
      tagwatch: next.watched ? 1 : 0,
      taghide: next.hidden ? 1 : 0,
      tagcolor: next.color,
      tagweight: next.weight
    });
    throwIfFailed2(data);
  }
  async function loadUserTag(name, deps) {
    const response = await deps.loadDocument(deps.myTagsUrl, { fresh: true, signal: deps.signal });
    if (deps.signal?.aborted) {
      return;
    }
    const tags = parseUserTags(response.doc);
    cacheUserTags(tags);
    return tags.find((entry) => normalizeName(entry.name) === name);
  }
  async function saveTagset(tagset, change, deps = {}) {
    const overrides = new Map;
    const renaming = change.name !== undefined;
    overrides.set("tagset_action", renaming ? "rename" : "update");
    if (change.name !== undefined) {
      const name = change.name.trim();
      if (name === "") {
        throw new Error("Enter a tag set name.");
      }
      overrides.set("tagset_name", name);
    } else {
      overrides.set("tagset_name", "");
    }
    const hasEnable = tagset.fields.some((field) => field.name === "tagset_enable");
    if (change.enabled !== undefined && hasEnable) {
      overrides.set("tagset_enable", change.enabled ? "on" : "");
    }
    if (change.color !== undefined) {
      const raw = (change.color ?? "").trim();
      const color = normalizeColor(raw);
      if (raw !== "" && color === "") {
        throw new Error("Use a #rgb or #rrggbb colour, or leave the field empty.");
      }
      overrides.set("tagset_color", color);
    }
    const post = deps.post ?? ((url, body, signal) => postForm(url, body, {
      tag: "my-tags",
      failure: "Could not save tag set",
      signal
    }).then(() => {
      return;
    }));
    await post(tagset.action, tagsetBody(tagset.fields, overrides), deps.signal);
  }
  async function applyMyTag(tag, change, deps) {
    const name = normalizeName(tag);
    if (name === "") {
      throw new Error("Missing tag name.");
    }
    let existing = deps.existing ?? lookupUserTag(name);
    const known = existing;
    existing ??= await loadUserTag(name, deps);
    if (deps.signal?.aborted) {
      return "updated";
    }
    if (existing !== undefined) {
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
        color: change.color === undefined ? existing.color : normalizeColor(change.color),
        weight: change.weight === undefined ? existing.weight : normalizeWeight(change.weight)
      };
      try {
        await saveUserTag(deps, existing.id, next);
        userTagCache.set(name, { id: existing.id, name: existing.name, ...next });
        return "updated";
      } catch (failure) {
        if (known === undefined) {
          throw failure;
        }
        let fresh;
        try {
          fresh = await loadUserTag(name, deps);
        } catch {
          throw failure;
        }
        if (deps.signal?.aborted) {
          throw failure;
        }
        if (fresh === undefined) {
          userTagCache.delete(name);
        } else {
          await saveUserTag(deps, fresh.id, next);
          userTagCache.set(name, { id: fresh.id, name: fresh.name, ...next });
          return "updated";
        }
      }
    }
    const weight = change.weight === undefined ? DEFAULT_WEIGHT2 : normalizeWeight(change.weight);
    const body = new URLSearchParams({
      usertag_action: "add",
      tagname_new: name,
      tagweight_new: String(weight),
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
    const up = buttonEl({
      class: "comment-vote comment-vote-up",
      title: "Vote up",
      "aria-label": `Vote up ${comment.author || "comment"}`,
      "aria-pressed": "false",
      text: "+"
    });
    const down = buttonEl({
      class: "comment-vote comment-vote-down",
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
    const voting = createPendingAction();
    const cast = (vote) => {
      if (config === null) {
        return;
      }
      voting.run({
        run: () => voteComment(config, comment.id, vote, { post: deps.post }),
        signal,
        setBusy: (busy) => {
          card.classList.toggle("is-busy", busy);
          if (busy) {
            card.setAttribute("aria-busy", "true");
          } else {
            card.removeAttribute("aria-busy");
          }
        },
        success: (result) => {
          score.textContent = scoreText(result.score);
          up.setAttribute("aria-pressed", result.vote > 0 ? "true" : "false");
          down.setAttribute("aria-pressed", result.vote < 0 ? "true" : "false");
        },
        failure: "Something went wrong.",
        failed: (message) => {
          showToast(message);
        }
      });
    };
    if (config !== null) {
      up.addEventListener("click", () => cast(1), { signal });
      down.addEventListener("click", () => cast(-1), { signal });
    }
    const body = el("div", { class: "comment-body", text: comment.body });
    const bodyHost = el("div", { class: "comment-body-host" }, body);
    const editingAction = createPendingAction();
    let editing = false;
    const editButton = config !== null && comment.editable ? buttonEl({
      class: "comment-edit",
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
        const save = buttonEl({ class: "btn btn-small", type: "submit", text: "Save" });
        const cancel = buttonEl({ class: "btn btn-ghost btn-small", text: "Cancel" });
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
          if (text === "") {
            status.textContent = "Comment cannot be empty.";
            return;
          }
          editingAction.run({
            run: async () => {
              const page = await edit(comment.id, text);
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
                await deps.refresh(page);
              } catch (error) {
                if (!isAborted(signal)) {
                  showToast(errorText(error));
                }
              }
            },
            signal,
            setBusy: (busy) => {
              save.disabled = busy;
              cancel.disabled = busy;
              save.textContent = busy ? "Saving…" : "Save";
              if (busy) {
                status.textContent = "Saving…";
              }
            },
            failure: "Something went wrong.",
            failed: (message) => {
              status.textContent = "Save failed.";
              showToast(message);
            }
          });
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
    const postComment2 = deps.postComment ?? postComment;
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
    const button = buttonEl({ class: "btn btn-small", type: "submit", text: "Post comment" });
    const status = el("span", { class: "comment-status", role: "status" });
    form.append(textarea, el("div", { class: "comment-compose-actions" }, button, status));
    section.append(form);
    const posting = createPendingAction();
    const refresh = async (page) => {
      status.replaceChildren("Posted. Refreshing…");
      try {
        await deps.refresh(page);
        if (signal.aborted) {
          return;
        }
        status.replaceChildren();
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        status.replaceChildren("Posted, but the page could not refresh. ", buttonEl({
          class: "comment-retry",
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
      if (text === "") {
        return;
      }
      posting.run({
        run: async () => {
          const page = await postComment2(data.url, text, signal);
          if (signal.aborted) {
            return;
          }
          textarea.value = "";
          await refresh(page);
        },
        signal,
        setBusy: (busy) => {
          button.textContent = busy ? "Posting…" : "Post comment";
          if (busy) {
            status.textContent = "Posting…";
          }
        },
        failure: "Something went wrong.",
        failed: (message) => {
          status.textContent = "Post failed.";
          showToast(message);
        }
      });
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
    const ratingAction = createPendingAction();
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
      if (!ratingAction.busy) {
        paint(half / 2, false);
      }
    };
    const unpreview = () => {
      if (!ratingAction.busy) {
        paint(restingValue(), false);
      }
    };
    const destroy = () => {
      if (resetTimer !== undefined) {
        window.clearTimeout(resetTimer);
      }
    };
    const submit = (starCount) => {
      const previous = current;
      ratingAction.run({
        run: () => rateGallery(config, starCount, { post }),
        signal,
        setBusy: (busy) => {
          if (busy) {
            stars.setAttribute("aria-busy", "true");
            label.textContent = "Saving…";
            paint(starCount, false);
          } else {
            stars.removeAttribute("aria-busy");
          }
        },
        success: (result) => {
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
        },
        failure: "Something went wrong.",
        failed: (message) => {
          current = previous;
          paint(restingValue(), current !== null);
          label.textContent = "Rating failed.";
          destroy();
          resetTimer = window.setTimeout(() => {
            label.textContent = averageLabel(rating);
          }, FAILURE_MS);
          showToast(message);
        }
      });
    };
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
    if (coarse) {
      for (let star = 1;star <= 5; star++) {
        const text = `Rate ${star} ${star === 1 ? "star" : "stars"}`;
        const button = buttonEl({
          class: "rating-star",
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
        const button = buttonEl({
          class: halfClass(half),
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
      up: buttonEl({ class: "tag-menu-item", text: "Vote up" }),
      down: buttonEl({ class: "tag-menu-item", text: "Vote down" }),
      include: buttonEl({ class: "tag-menu-item", text: SIGN_PRESENTATION[""].action }),
      exclude: buttonEl({ class: "tag-menu-item", text: SIGN_PRESENTATION["-"].action }),
      or: buttonEl({ class: "tag-menu-item", text: SIGN_PRESENTATION["~"].action })
    };
    const setBusy = (busy) => {
      for (const button of [...Object.values(buttons), ...extraButtons]) {
        button.disabled = busy;
      }
    };
    const showError = (message) => {
      error.textContent = message;
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
    const pending = createPendingAction();
    const run = (action, focusTarget) => {
      pending.run({
        run: action,
        signal,
        setBusy: (busy) => {
          if (busy) {
            error.hidden = true;
          }
          setBusy(busy);
        },
        success: () => {
          binding.close();
        },
        failure: "The action failed.",
        failed: showError,
        recover: () => focusTarget
      });
    };
    buttons.up.addEventListener("click", () => run(() => handlers.vote(raw, 1), buttons.up));
    buttons.down.addEventListener("click", () => run(() => handlers.vote(raw, -1), buttons.down));
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
    form.append(input, buttonEl({ class: "btn btn-small", type: "submit", text: "Add tags" }));
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
      const watch = buttonEl({ class: "tag-menu-item", text: "Watch tag" });
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
      const hide = buttonEl({ class: "tag-menu-item", text: "Hide tag" });
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
      const apply = buttonEl({ class: "tag-menu-item", text: "Apply colour" });
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

  // src/ui/gallery-tag-row.ts
  function tagLabel(tag) {
    return tag.note === null ? tag.name : `${tag.name} — ${tag.note}`;
  }
  function tagTitle(tag, hint) {
    return tag.note === null ? hint : `${tag.name} | ${tag.note} · ${hint}`;
  }
  function tagHint(match, actionsHint) {
    if (match === undefined) {
      return `Click to add to search · Alt-click to exclude · Middle-click for results${actionsHint}`;
    }
    const click = match.sign === "-" ? "Click to include" : "Click to remove";
    const alt = match.sign === "-" ? "Alt-click to remove" : "Alt-click to exclude";
    return `${termStateLabel(match)} · ${click} · ${alt} · Middle-click for results${actionsHint}`;
  }
  function createTagRow(data, actions, signal) {
    if (data.tags.length === 0) {
      return null;
    }
    const section = el("section", { class: "tag-section", "aria-label": "Tags" });
    const title = el("h2", { class: "tag-title", text: "Tags" });
    const links = [];
    const actionsHint = actions.config === null ? "" : " · Right-click for tag actions";
    const refresh = () => {
      const byIdentity = new Map;
      for (const term of parseSearchTerms(actions.text())) {
        const identity = termIdentity(term);
        if (!byIdentity.has(identity)) {
          byIdentity.set(identity, term);
        }
      }
      const hrefs = new Map;
      const hrefFor = (token, sign) => {
        const key = `${sign}\x00${token}`;
        let href = hrefs.get(key);
        if (href === undefined) {
          href = actions.href(token, sign);
          hrefs.set(key, href);
        }
        return href;
      };
      for (const link of links) {
        const href = hrefFor(link.token, "");
        if (link.chip.getAttribute("href") !== href) {
          link.chip.setAttribute("href", href);
        }
        if (link.targetIdentity === null) {
          continue;
        }
        const match = byIdentity.get(link.targetIdentity);
        const applied = match?.sign ?? null;
        if (link.applied === applied) {
          continue;
        }
        link.applied = applied;
        link.chip.classList.toggle("is-added", match !== undefined);
        link.chip.classList.toggle("is-excluded", match?.sign === "-");
        link.chip.classList.toggle("is-or", match?.sign === "~");
        link.chip.title = tagTitle(link.tag, tagHint(match, actionsHint));
        const label = tagLabel(link.tag);
        link.chip.setAttribute("aria-label", match === undefined ? label : `${label} — ${termState(match)}`);
      }
    };
    const composer = () => {
      if (actions.config === null) {
        return null;
      }
      const input = tagInput("field-input tag-add-input");
      const submit = buttonEl({ class: "btn btn-small", type: "submit", text: "Add tags" });
      const form = el("form", { class: "tag-add" }, input, submit);
      const pending = createPendingAction();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "") {
          return;
        }
        pending.run({
          run: () => actions.addTags(value),
          signal,
          setBusy: (busy) => {
            submit.textContent = busy ? "Adding…" : "Add tags";
          },
          success: () => {
            input.value = "";
          },
          failure: "Something went wrong.",
          failed: (message) => {
            showToast(message);
          }
        });
      }, { signal });
      return el("div", { class: "tag-row tag-add-row" }, el("span", { class: "tag-ns", "aria-hidden": "true" }), form);
    };
    const buildGroup = (group) => {
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
          links.push({
            chip,
            token,
            targetIdentity: target === null ? null : termIdentity(target),
            tag,
            applied: undefined
          });
          const sign = (event) => event.altKey ? "-" : "";
          chip.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
              chip.setAttribute("href", actions.href(token, sign(event)));
            }
          }, { signal });
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
          }, { signal });
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
            }, signal);
          };
          bindContextMenu(chip, openMenu, signal);
          const trigger = buttonEl({
            class: "tag-menu-trigger",
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
      return el("div", { class: "tag-row" }, el("span", { class: `tag-ns ns-${nsClass}`, text: `${group.ns}:` }), chips);
    };
    section.append(title);
    for (const group of data.tags) {
      section.append(buildGroup(group));
    }
    const addRow = composer();
    if (addRow !== null) {
      section.append(addRow);
    }
    refresh();
    return { element: section, refresh };
  }

  // src/ui/page-advance.ts
  var advance = null;
  function setPageAdvance(next) {
    advance = next;
  }
  function advancePage() {
    return advance?.() ?? Promise.resolve(false);
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
    const retryButton = buttonEl({ class: "btn btn-small infinite-retry", text: "Retry" });
    retryButton.hidden = true;
    const more = buttonEl({ class: "btn btn-small infinite-more", text: "Load more" });
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
      setPageAdvance(null);
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
    setPageAdvance(loadNext);
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
      fetchpriority: "high",
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
  function siteActionItems(data) {
    const items = [];
    const { archiverHref, torrentsHref, reportHref, expungeHref, renameHref } = data.actions;
    if (archiverHref !== null) {
      items.push({ label: "Archive Download", href: archiverHref });
    }
    if (torrentsHref !== null) {
      items.push({ label: "Torrent Download", href: torrentsHref });
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
    const clear = buttonEl({
      class: "gallery-resume-clear",
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
    let tagRow = null;
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
      tagRow?.refresh();
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
    const emptyThumbs = data.thumbs.length === 0 ? nativeEmptyPanel("No page thumbnails found for this gallery.") : null;
    const load = deps.loadDocument ?? ((url, documentOptions) => loader.document(url, { priority: priorityOf("navigation"), ...documentOptions }));
    const fetchGallery = async () => {
      const response = await load(data.url, { fresh: true, signal: ctx.signal });
      if (ctx.signal.aborted) {
        return null;
      }
      return parseGalleryPage(response.doc, response.url);
    };
    let pendingReload = null;
    const reload = () => {
      if (pendingReload !== null) {
        return pendingReload;
      }
      const run = fetchGallery();
      pendingReload = run;
      const settle = () => {
        if (pendingReload === run) {
          pendingReload = null;
        }
      };
      run.then(settle, settle);
      return run;
    };
    const commentDeps = {
      post: deps.post,
      postComment: deps.postComment,
      editComment: deps.editComment,
      refresh: async (page) => {
        if (page !== undefined) {
          replaceComments(parseGalleryPage(page.doc, page.url));
          return;
        }
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
    const runTagVote = async (tag, vote) => {
      if (config === null) {
        return;
      }
      await voteTag(config, tag, vote, { post: deps.post });
    };
    const runTagVoteBatch = async (tags) => {
      if (config === null) {
        return;
      }
      await voteTag(config, tags, 1, { post: deps.post });
    };
    const runMyTag = async (tag, change) => {
      if (config === null) {
        return;
      }
      const result = await applyMyTag(tag, change, {
        config,
        myTagsUrl: new URL(SITE_PATHS.myTags, data.url).href,
        existing: lookupUserTag(tag),
        loadDocument: load,
        post: deps.post,
        signal: ctx.signal
      });
      showToast(result === "added" ? "Tag added to My Tags" : "My Tags updated");
    };
    const tagActions = {
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
      config,
      text: () => getSearchDraft().text
    };
    tagRow = createTagRow(data, tagActions, ctx.signal);
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
    appendChildren(host, [topbar, header, tagRow?.element ?? null, emptyThumbs ?? navigation]);
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

  // src/data/gallery-torrents.ts
  function fieldPairs(table) {
    const fields = new Map;
    for (const row of table.querySelectorAll("tr")) {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      for (let index = 0;index + 1 < cells.length; index += 2) {
        const label = cleanText(cells[index]?.textContent).toLowerCase();
        if (label !== "") {
          fields.set(label, cleanText(cells[index + 1]?.textContent));
        }
      }
    }
    return fields;
  }
  function labeledHref(root, label, base) {
    for (const anchor of root.querySelectorAll("a[href]")) {
      if (label.test(cleanText(anchor.textContent))) {
        const href = anchorHref(anchor, base);
        if (href !== null) {
          return href;
        }
      }
    }
    return null;
  }
  function parseTorrentInfo(doc, base) {
    const container = doc.getElementById("torrentinfo");
    const table = container?.querySelector("#ett") ?? null;
    if (container === null || table === null) {
      return null;
    }
    const fields = fieldPairs(table);
    return {
      name: cleanText(container.querySelector("h1")?.textContent),
      posted: fields.get("posted") ?? "",
      size: fields.get("size") ?? "",
      seeds: parseNumber(fields.get("seeds")) ?? 0,
      peers: parseNumber(fields.get("dlers")) ?? 0,
      completes: parseNumber(fields.get("completes")) ?? 0,
      uploader: fields.get("uploader") ?? "",
      personalizedHref: labeledHref(container, /personalized/iu, base),
      redistributableHref: labeledHref(container, /redistributable/iu, base),
      comments: cleanText(container.querySelector("#etd")?.textContent)
    };
  }
  async function loadTorrentInfo(pageUrl, gtid, signal) {
    const response = await postForm(pageUrl, new URLSearchParams({ gtid, torrent_info: "Information" }), {
      tag: "gallery-torrents",
      failure: "Torrent information request failed",
      signal
    });
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const info = parseTorrentInfo(doc, pageUrl);
    if (info === null) {
      throw new Error("The torrent information could not be read.");
    }
    return info;
  }

  // src/views/gallery-torrents.ts
  function metaItem(label, value) {
    return factRow(label, value === "" ? "—" : value, "gallery-torrent-meta-item");
  }
  function infoRow(label, href) {
    return factRow(label, href === null ? el("span", { class: "gallery-torrent-info-unavailable", text: "Not available" }) : el("a", {
      class: "gallery-torrent-info-link",
      href,
      rel: "nofollow",
      text: "Download torrent"
    }), "gallery-torrent-info-row");
  }
  function infoNodes(info) {
    const nodes = [];
    nodes.push(el("div", { class: "gallery-torrent-info" }, infoRow("Personalized torrent", info.personalizedHref), infoRow("Redistributable torrent", info.redistributableHref)));
    if (info.comments !== "") {
      nodes.push(el("p", { class: "gallery-torrent-comments", text: info.comments }));
    }
    return nodes;
  }
  function loadingPanel() {
    return el("div", { class: "gallery-torrent-details", "aria-busy": "true" }, el("p", { class: "gallery-torrent-loading", text: "Loading torrent details…" }));
  }
  function torrentCard(page, torrent, ctx, loadInfo) {
    const name = torrent.name === "" ? "Torrent" : torrent.name;
    const title = torrent.downloadHref === null ? el("span", { class: "gallery-torrent-name", text: name }) : el("a", {
      class: "gallery-torrent-name",
      href: torrent.downloadHref,
      rel: "nofollow",
      title: name,
      text: name
    });
    const detailsSlot = el("div", { class: "gallery-torrent-details-slot", hidden: "" });
    const button = buttonEl({
      class: "btn btn-small gallery-torrent-details-button",
      "aria-expanded": "false",
      text: "Details"
    });
    const pending = createPendingAction();
    let requested = false;
    let open = false;
    const show = (visible) => {
      open = visible;
      detailsSlot.toggleAttribute("hidden", !visible);
      button.setAttribute("aria-expanded", String(visible));
      button.textContent = visible ? "Hide details" : "Details";
    };
    button.addEventListener("click", () => {
      if (requested) {
        show(!open);
        return;
      }
      requested = true;
      show(true);
      const panel = loadingPanel();
      detailsSlot.replaceChildren(panel);
      pending.run({
        run: () => loadInfo(page.url, torrent.gtid, ctx.signal),
        signal: ctx.signal,
        setBusy: (busy) => {
          button.disabled = busy;
        },
        success: (info) => {
          panel.removeAttribute("aria-busy");
          panel.replaceChildren(...infoNodes(info));
        },
        failure: "Torrent details could not be loaded.",
        failed: (message) => {
          panel.removeAttribute("aria-busy");
          panel.replaceChildren(el("p", { class: "gallery-torrent-error", role: "alert", text: message }));
        }
      });
    }, { signal: ctx.signal });
    return el("article", { class: "gallery-torrent-card" }, el("div", { class: "gallery-torrent-head" }, title, button), el("div", { class: "gallery-torrent-meta" }, metaItem("Posted", torrent.posted), metaItem("Size", torrent.size), metaItem("Seeds", String(torrent.seeds)), metaItem("Peers", String(torrent.peers)), metaItem("Downloads", String(torrent.downloads)), metaItem("Uploader", torrent.uploader)), detailsSlot);
  }
  function renderGalleryTorrents(host, data, ctx, deps = {}) {
    const loadInfo = deps.loadInfo ?? loadTorrentInfo;
    const root = pageScaffold(el("div", { id: "gallery-torrents", class: "gallery-torrents" }), {
      title: data.title === "" ? "Gallery torrents" : data.title,
      summary: [el("span", { text: countText(data.torrents.length, "torrent") })],
      signal: ctx.signal
    });
    if (data.galleryHref !== null) {
      root.append(galleryBackLink(data.galleryHref, "gallery-torrents-back"));
    }
    if (data.torrents.length === 0) {
      root.append(nativeEmptyPanel("No torrents were found for this gallery."));
    } else {
      const list = el("div", { class: "gallery-torrent-list" });
      for (const torrent of data.torrents) {
        list.append(torrentCard(data, torrent, ctx, loadInfo));
      }
      root.append(list);
    }
    host.replaceChildren(root);
  }

  // src/views/home.ts
  function navStrip(data) {
    if (data.nav.length === 0) {
      return null;
    }
    return el("nav", { class: "home-nav", "aria-label": "Account pages" }, ...data.nav.map((link) => el("a", {
      class: link.active ? "home-nav-link is-active" : "home-nav-link",
      href: link.href,
      "aria-current": link.active ? "page" : null,
      text: link.label
    })));
  }
  function sectionCard(section, url) {
    const card = el("section", { class: "home-section", "aria-label": section.title }, el("h2", { class: "home-section-title", text: section.title }));
    if (section.facts.length > 0) {
      const facts = el("dl", { class: "home-facts" });
      for (const fact of section.facts) {
        facts.append(el("div", { class: "home-fact" }, el("dt", { text: fact.label }), el("dd", { text: fact.value })));
      }
      card.append(facts);
    }
    if (section.paragraphs.length > 0) {
      card.append(el("div", { class: "home-text" }, ...section.paragraphs.map((text) => el("p", { class: "home-text-line", text }))));
    }
    if (section.links.length > 0) {
      card.append(el("div", { class: "home-links" }, ...section.links.map((link) => el("a", { class: "home-link", href: link.href, text: link.label }))));
    }
    if (section.action !== null) {
      card.append(el("a", {
        class: "btn btn-ghost home-action",
        href: nativeUrl(url),
        "data-native": "",
        title: "Open the native My Home page to run this action",
        "aria-label": `${section.action} on the native My Home page`
      }, el("span", { text: section.action }), icon("external")));
    }
    return card;
  }
  function renderHome(host, data, ctx) {
    pageScaffold(host, {
      title: "My Home",
      summary: [el("span", { text: "Account overview" })],
      signal: ctx.signal
    });
    const nav = navStrip(data);
    if (nav !== null) {
      host.append(nav);
    }
    host.append(el("div", { class: "home-sections" }, ...data.sections.map((section) => sectionCard(section, data.url))));
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
    const live = select.value;
    if (typeof live === "string" && live !== "" && typeof select.selectedIndex === "number") {
      return live;
    }
    let first;
    let attributed;
    for (const option of select.querySelectorAll("option")) {
      if (option.selected === true) {
        return option.value;
      }
      first ??= option.value;
      if (attributed === undefined && option.hasAttribute("selected")) {
        attributed = option.value;
      }
    }
    return attributed ?? first ?? "";
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
    let tags = quickTags();
    const entries = [];
    const row = el("div", { class: "quick-tags", role: "group", "aria-label": "Quick tags" });
    const refresh = (next) => {
      const text = next ?? options.getText();
      if (entries.length === 0) {
        return;
      }
      const present = new Set(parseSearchTerms(text).map(termIdentity));
      for (const entry of entries) {
        const on = entry.keys.length > 0 && entry.keys.every((key) => present.has(key));
        if (entry.on === on) {
          continue;
        }
        entry.on = on;
        entry.node.setAttribute("aria-pressed", String(on));
        entry.node.title = on ? `Remove ${entry.tag.query}` : `Add ${entry.tag.query}`;
      }
    };
    const render = () => {
      entries.length = 0;
      row.replaceChildren();
      for (const tag of tags) {
        const node = buttonEl({ class: "quick-tag", "aria-pressed": "false" }, el("span", { class: "quick-tag-label", text: tag.name }));
        node.addEventListener("click", () => {
          options.apply(toggleExpressionInSearch(options.getText(), tag.query));
        }, { signal });
        row.append(node);
        entries.push({
          tag,
          node,
          keys: parseSearchTerms(tag.query).filter((term) => term.value !== "").map(termIdentity)
        });
      }
      const edit = buttonEl({
        class: "quick-tag-edit",
        text: tags.length === 0 ? "+ Quick tags" : "Edit tags",
        title: "Edit quick tags",
        "aria-haspopup": "dialog",
        "aria-expanded": "false"
      });
      edit.addEventListener("click", () => {
        openQuickTagEditor(edit, signal, () => {
          tags = quickTags();
          render();
        });
      }, { signal });
      row.append(edit);
      refresh();
    };
    render();
    const unsubscribe = subscribeQuickTags(() => {
      tags = quickTags();
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
    const all = buttonEl({
      class: "cat-chip",
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
      const chip = buttonEl({
        class: `cat-chip ${category.cls}`,
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
  var LIST_FILTERS = [
    {
      active: (query) => query.rating > 0,
      label: (query) => `${query.rating}★ minimum`
    },
    {
      active: (query) => query.pageFrom.trim() !== "" || query.pageTo.trim() !== "",
      label: (query) => {
        const from = query.pageFrom.trim();
        const to = query.pageTo.trim();
        return from !== "" && to !== "" ? `${from}–${to} pages` : from !== "" ? `${from}+ pages` : `≤${to} pages`;
      }
    },
    {
      active: (query) => isDateRangeActive({ since: query.since, until: query.until }),
      label: (query) => {
        const since = query.since.trim();
        const until = query.until.trim();
        return since !== "" && until !== "" ? `Posted ${since} – ${until}` : since !== "" ? `Posted from ${since}` : `Posted until ${until}`;
      }
    },
    { active: (query) => query.expunged, label: () => "Expunged included" },
    { active: (query) => query.torrent, label: () => "Torrent required" },
    { active: (query) => query.disableLanguage, label: () => "Language filter off", relaxed: true },
    { active: (query) => query.disableUploader, label: () => "Uploader filter off", relaxed: true },
    { active: (query) => query.disableTags, label: () => "Tag filter off", relaxed: true }
  ];
  function activeFilters(query) {
    return LIST_FILTERS.filter((filter) => filter.active(query)).map((filter) => ({
      label: filter.label(query),
      relaxed: filter.relaxed === true
    }));
  }
  function advancedPanel(query, ctx) {
    const active = activeFilters(query);
    const activeCount = active.length;
    const activeLabels = active.map((filter) => filter.label);
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
    const sinceDate = el("input", {
      class: "field-input",
      type: "date",
      placeholder: "YYYY-MM-DD",
      title: "Show galleries posted on or after this day",
      value: query.since,
      "aria-label": "Posted since",
      style: "width: 10rem"
    });
    const untilDate = el("input", {
      class: "field-input",
      type: "date",
      placeholder: "YYYY-MM-DD",
      title: "Show galleries posted on or before this day",
      value: query.until,
      "aria-label": "Posted until",
      style: "width: 10rem"
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
        since: sinceDate.value,
        until: untilDate.value,
        expunged: expunged.input.checked,
        torrent: torrent.input.checked,
        disableLanguage: disableLanguage.input.checked,
        disableUploader: disableUploader.input.checked,
        disableTags: disableTags.input.checked
      };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    };
    const applyButton = buttonEl({
      class: "btn btn-small",
      type: "submit",
      text: "Apply"
    });
    const reset = buttonEl({ class: "btn btn-ghost btn-small", text: "Reset" });
    reset.addEventListener("click", () => {
      const next = { ...query, ...emptyAdvancedFilters() };
      saveListFilters(next);
      ctx.navigate(buildSearchUrl(next));
    }, { signal: ctx.signal });
    const form = el("form", { class: "filters-grid" }, el("label", { class: "field" }, el("span", { text: "Minimum rating" }), rating.element), el("div", { class: "field" }, el("span", { text: "Page count" }), el("div", { class: "field-row" }, pageFrom, el("span", { text: "to" }), pageTo)), el("label", { class: "field" }, el("span", { text: "Posted since" }), sinceDate), el("label", { class: "field" }, el("span", { text: "Posted until" }), untilDate), el("div", { class: "check-row" }, expunged.wrapper, torrent.wrapper), el("div", { class: "check-row" }, disableLanguage.wrapper, disableUploader.wrapper, disableTags.wrapper), el("div", { class: "filters-actions" }, activeCount > 0 ? reset : null, applyButton, el("a", {
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
    const details = el("details", { class: "filters", open: isListPanelOpen() ? "" : null }, el("summary", { class: "filters-summary" }, icon("filter"), el("span", { text: "Filters" }), activeCount > 0 ? el("span", { class: "filters-count", text: String(activeCount) }) : "", activeLabels.length > 0 ? el("span", {
      class: "filters-active",
      text: activeLabels.join(" · "),
      title: activeLabels.join(" · ")
    }) : ""), form);
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
    const active = activeFilters(urlQuery);
    const narrow = active.filter((filter) => !filter.relaxed).length;
    const relaxed = active.length - narrow;
    const range = { since: urlQuery.since, until: urlQuery.until };
    const rangeActive = isDateRangeActive(range);
    const shownItems = data.items;
    const nextHref = data.nextHref;
    const countNode = el("span", {
      text: rangeActive ? `${shownItems.length} shown` : data.resultText ?? countText(data.items.length, "item")
    });
    const header = listHeader({
      title: listLabels(urlQuery, scope, pathTag).heading,
      summary: [
        countNode,
        rangeActive ? el("span", {
          class: "badge date-filter-note",
          text: "Approximate while filtered."
        }) : null,
        narrow > 0 ? el("span", { class: "badge", text: countText(narrow, "filter") }) : null,
        relaxed > 0 ? el("span", {
          class: "badge",
          text: `${relaxed} relaxed ${plural(relaxed, "filter")}`
        }) : null
      ]
    });
    quickTags = renderQuickTags({
      getText: () => getSearchDraft().text,
      apply: setSearchDraftText,
      signal: ctx.signal
    });
    const panel = el("section", { class: "search-panel" }, categoryChips(draftQuery, ctx), quickTags.element, advancedPanel(draftQuery, ctx));
    const grid = createCardGrid(ctx.signal);
    grid.append(shownItems.map((item) => resultCard(item, ctx.signal)));
    const syncCount = () => {
      if (!rangeActive && data.resultText !== null) {
        return;
      }
      const cards = grid.size();
      countNode.textContent = rangeActive ? `${cards} shown` : countText(cards, "item");
    };
    const footer = el("div");
    const clearFilters = () => {
      saveListFilters(emptySearchQuery());
      ctx.navigate(FRONT_PATH);
    };
    const canReset = urlQuery.text !== "" || urlQuery.cats !== 0 || narrow > 0 || relaxed > 0 || rangeActive;
    const empty = shownItems.length === 0 ? statePanel({
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
    if (shownItems.length > 0) {
      host.append(el("h2", { class: "sr-only", text: "Results" }), grid.element);
      grid.refresh();
    }
    host.append(empty ?? footer);
    const pageSource = deps.pageSource;
    if (empty === null) {
      createPagedRegion({
        signal: ctx.signal,
        next: nextHref,
        initial: shownItems,
        key: (item) => item.gid,
        noun: "results",
        enabled: (settings) => settings.listInfiniteScroll,
        slot: footer,
        pager: (withNext) => withNext ? pager({
          prev: data.prevHref,
          next: nextHref,
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
        append: (incoming) => {
          const nodes = incoming.map((item) => resultCard(item, ctx.signal));
          grid.append(nodes);
          return () => grid.remove(nodes);
        },
        placeSentinel: (node) => footer.append(node),
        onSync: syncCount
      });
    }
  }

  // src/views/my-tags.ts
  function tagsetHref(pageUrl, id) {
    const target = new URL(pageUrl);
    target.searchParams.set("tagset", id);
    return target.href;
  }
  function tagsetPanel(data, tagset, editable, ctx, save) {
    const choices = el("div", { class: "my-tags-tagsets", role: "group", "aria-label": "Tag sets" }, ...tagset.choices.map((choice) => el("a", {
      class: "my-tags-tagset-link",
      href: tagsetHref(data.url, choice.id),
      "aria-current": choice.selected ? "page" : null,
      text: choice.label
    })));
    const name = textInput({
      class: "field-input my-tags-tagset-name",
      value: tagset.name,
      "aria-label": "Tag set name"
    });
    const enabled = el("input", {
      type: "checkbox",
      class: "my-tags-tagset-enable",
      checked: tagset.enabled ? "checked" : null
    });
    const color = textInput({
      class: "field-input my-tags-tagset-color",
      value: tagset.color,
      placeholder: "#default",
      maxlength: "7",
      "aria-label": "Default colour for this tag set"
    });
    for (const control of [name, enabled, color]) {
      control.disabled = !editable;
    }
    const hasEnable = tagset.fields.some((field) => field.name === "tagset_enable");
    const error = el("p", { class: "my-tags-tagset-error", role: "alert" });
    error.hidden = true;
    const saveButton = buttonEl({
      class: "btn btn-primary my-tags-tagset-save",
      text: "Save tag set"
    });
    const renameButton = buttonEl({ class: "btn my-tags-tagset-rename", text: "Rename tag set" });
    let busy = false;
    const submit = async (change, message) => {
      if (busy) {
        return;
      }
      error.hidden = true;
      busy = true;
      saveButton.disabled = true;
      renameButton.disabled = true;
      try {
        await save(tagset, change, ctx.signal);
        if (ctx.signal.aborted) {
          return;
        }
        showToast(message);
        ctx.reload();
      } catch (failure) {
        if (ctx.signal.aborted) {
          return;
        }
        error.textContent = errorText(failure, "Could not save the tag set.");
        error.hidden = false;
      } finally {
        busy = false;
        saveButton.disabled = false;
        renameButton.disabled = false;
      }
    };
    const liveChange = (nameValue) => ({
      enabled: isChecked(enabled),
      color: color.value,
      ...nameValue === undefined ? {} : { name: nameValue }
    });
    saveButton.addEventListener("click", () => {
      const next = name.value.trim();
      const renamed = next !== tagset.name.trim();
      if (renamed && next === "") {
        error.textContent = "Enter a tag set name.";
        error.hidden = false;
        name.focus();
        return;
      }
      submit(liveChange(renamed ? next : undefined), renamed ? "Tag set renamed" : "Tag set saved");
    }, { signal: ctx.signal });
    renameButton.addEventListener("click", () => {
      const next = name.value.trim();
      if (next === "") {
        error.textContent = "Enter a tag set name.";
        error.hidden = false;
        name.focus();
        return;
      }
      submit(liveChange(next), "Tag set renamed");
    }, { signal: ctx.signal });
    return el("section", { class: "settings-section my-tags-tagsets-section", "aria-label": "Tag sets" }, el("h2", { class: "settings-title", text: "Tag sets" }), choices, el("div", { class: "my-tags-tagset-form" }, el("label", { class: "settings-field my-tags-tagset-name-field" }, el("span", { text: "Name" }), name), hasEnable ? el("label", { class: "settings-row my-tags-tagset-enable-field" }, enabled, el("span", { text: "Enable flagging and watching for tags in this set" })) : null, el("label", { class: "settings-field my-tags-tagset-color-field" }, el("span", { text: "Default colour" }), color)), el("p", {
      class: "settings-hint",
      text: "Leave the colour empty for the site default. Tag colours in this set fall back to it."
    }), editable ? el("div", { class: "my-tags-tagset-actions" }, saveButton, renameButton, error) : null);
  }
  function syncTagInputs(inputs, readOnly) {
    if (isChecked(inputs.watched)) {
      inputs.hidden.checked = false;
    } else if (isChecked(inputs.hidden)) {
      inputs.watched.checked = false;
    }
    inputs.color.disabled = readOnly || !isChecked(inputs.colorEnabled);
  }
  function writableApi(data) {
    const api = data.api;
    return api !== null && api.apiUid !== "-1" ? api : null;
  }
  function describeTag(tag) {
    const parts = [];
    if (tag.watched) {
      parts.push("Watched");
    }
    if (tag.hidden) {
      parts.push("Hidden");
    }
    parts.push(`Weight ${tag.weight}`);
    if (tag.color !== "") {
      parts.push(tag.color);
    }
    return parts.join(" · ");
  }
  function tagInputs(tag, readOnly, signal, bind = true) {
    const watched = el("input", {
      type: "checkbox",
      class: "my-tags-watch",
      checked: tag?.watched === true ? "checked" : null
    });
    const hidden = el("input", {
      type: "checkbox",
      class: "my-tags-hide",
      checked: tag?.hidden === true ? "checked" : null
    });
    const weight = el("input", {
      type: "number",
      class: "field-input my-tags-weight",
      min: "-99",
      max: "99",
      step: "1",
      inputmode: "numeric",
      value: String(tag?.weight ?? 10)
    });
    const initialColor = tag?.color ?? "";
    const colorEnabled = el("input", {
      type: "checkbox",
      class: "my-tags-color-enable",
      checked: initialColor !== "" ? "checked" : null
    });
    const color = el("input", {
      type: "color",
      class: "my-tags-color",
      value: initialColor === "" ? "#ff8800" : initialColor,
      "aria-label": "Tag colour"
    });
    color.disabled = readOnly || !isChecked(colorEnabled);
    for (const control of [watched, hidden, weight, colorEnabled]) {
      control.disabled = readOnly;
    }
    const node = el("div", { class: "my-tags-fields" }, el("label", { class: "check" }, watched, el("span", { text: "Watched" })), el("label", { class: "check" }, hidden, el("span", { text: "Hidden" })), el("label", { class: "field my-tags-weight-field" }, el("span", { text: "Weight" }), weight), el("label", { class: "check" }, colorEnabled, el("span", { text: "Colour" })), color);
    const inputs = { node, watched, hidden, weight, colorEnabled, color };
    if (bind) {
      for (const control of [watched, hidden, colorEnabled]) {
        control.addEventListener("change", () => {
          syncTagInputs(inputs, readOnly);
        }, { signal });
      }
    }
    return inputs;
  }
  function readChange(inputs) {
    const rawWeight = inputs.weight.value.trim();
    return {
      watched: isChecked(inputs.watched),
      hidden: isChecked(inputs.hidden),
      weight: rawWeight === "" ? undefined : Number(rawWeight),
      color: isChecked(inputs.colorEnabled) ? inputs.color.value : null
    };
  }
  async function runSaveAction({
    button,
    idle,
    busy,
    error,
    failure,
    save,
    onSaved
  }) {
    error.hidden = true;
    button.disabled = true;
    button.textContent = busy;
    try {
      onSaved(await save());
    } catch (cause) {
      error.textContent = errorText(cause, failure);
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = idle;
    }
  }
  function readOnlyNote(data) {
    return el("p", { class: "my-tags-readonly", role: "status" }, "Editing is unavailable on this page. ", el("a", {
      class: "my-tags-native",
      href: nativeUrl(data.url),
      "data-native": "",
      text: "Open the native My Tags page"
    }), ".");
  }
  function renderMyTags(host, data, ctx, deps) {
    const api = writableApi(data);
    cacheUserTags(data.tags);
    const load = deps?.loadDocument ?? ((url, options) => loader.document(url, options));
    const filter = searchInput({
      class: "field-input my-tags-filter",
      placeholder: "Filter tags",
      "aria-label": "Filter tags"
    });
    const toolbar = el("div", { class: "my-tags-toolbar" }, el("label", { class: "field my-tags-filter-field" }, el("span", { text: "Filter" }), filter));
    const list = el("div", { class: "my-tags-list" });
    const noMatch = el("p", {
      class: "my-tags-no-match",
      text: "No tags match this filter."
    });
    noMatch.hidden = true;
    const filterable = [];
    const filterRows = () => {
      const needle = filter.value.trim().toLowerCase();
      let shown = 0;
      for (const { row, nameLower } of filterable) {
        const match = needle === "" || nameLower.includes(needle);
        row.hidden = !match;
        if (match) {
          shown += 1;
        }
      }
      noMatch.hidden = needle === "" || shown > 0 || data.tags.length === 0;
    };
    filter.addEventListener("input", filterRows, { signal: ctx.signal });
    const rowInputs = new WeakMap;
    const rowSaves = new WeakMap;
    list.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const row = target.closest(".my-tags-row");
      const inputs = row === null ? undefined : rowInputs.get(row);
      if (inputs !== undefined) {
        syncTagInputs(inputs, api === null);
      }
    }, { signal: ctx.signal });
    list.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const row = target.closest(".my-tags-row");
      if (row !== null) {
        rowSaves.get(row)?.();
      }
    }, { signal: ctx.signal });
    const buildAddForm = (credentials) => {
      const name = textInput({
        class: "field-input my-tags-add-name",
        placeholder: "namespace:tag",
        "aria-label": "Tag name"
      });
      const inputs = tagInputs(null, false, ctx.signal);
      const error = el("p", { class: "my-tags-error", role: "alert" });
      error.hidden = true;
      const submit = buttonEl({
        class: "btn btn-primary my-tags-add-submit",
        type: "submit",
        text: "Add tag"
      });
      const form = el("form", { id: "my-tags-add", class: "my-tags-add", autocomplete: "off" }, el("h2", { class: "my-tags-add-title", text: "Add a tag" }), el("div", { class: "my-tags-add-fields" }, el("label", { class: "field my-tags-name-field" }, el("span", { text: "Tag" }), name), inputs.node), el("p", {
        class: "my-tags-hint",
        text: "Use the site's namespace:tag form. Weight runs from -99 to 99."
      }), el("div", { class: "my-tags-add-actions" }, submit), error);
      let adding = false;
      const add = async () => {
        if (adding) {
          return;
        }
        const tag = name.value.trim();
        error.hidden = true;
        if (tag === "") {
          error.textContent = "Enter a tag name.";
          error.hidden = false;
          name.focus();
          return;
        }
        adding = true;
        await runSaveAction({
          button: submit,
          idle: "Add tag",
          busy: "Adding…",
          error,
          failure: "Could not save tag.",
          save: async () => {
            const result = await applyMyTag(tag, readChange(inputs), {
              config: credentials,
              myTagsUrl: data.url,
              existing: lookupUserTag(tag),
              loadDocument: load,
              post: deps?.post,
              addTag: deps?.addTag,
              signal: ctx.signal
            });
            return result === "added" ? "Tag added to My Tags" : "My Tags updated";
          },
          onSaved: (message) => {
            showToast(message);
            form.reset();
            inputs.weight.value = "10";
            inputs.color.disabled = true;
            ctx.reload();
          }
        });
        adding = false;
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        add();
      }, { signal: ctx.signal });
      return form;
    };
    const buildRow = (tag, credentials) => {
      const inputs = tagInputs(tag, credentials === null, ctx.signal, false);
      const state = { ...tag };
      const summary = el("span", { class: "my-tags-row-state", text: describeTag(state) });
      const error = el("p", { class: "my-tags-error", role: "alert" });
      error.hidden = true;
      const row = el("div", {
        class: "my-tags-row",
        "data-tag-id": String(tag.id),
        "data-tag-name": tag.name.toLowerCase()
      }, el("div", { class: "my-tags-row-head" }, el("span", { class: "my-tags-row-name", text: tag.name }), summary), inputs.node, error);
      rowInputs.set(row, inputs);
      if (credentials !== null) {
        const save = buttonEl({ class: "btn btn-small my-tags-save", text: "Save" });
        const actions = el("div", { class: "my-tags-row-actions" }, save);
        row.append(actions);
        let busy = false;
        const saveRow = async () => {
          if (busy) {
            return;
          }
          busy = true;
          await runSaveAction({
            button: save,
            idle: "Save",
            busy: "Saving…",
            error,
            failure: "Could not save tag.",
            save: async () => {
              await applyMyTag(tag.name, readChange(inputs), {
                config: credentials,
                myTagsUrl: data.url,
                existing: state,
                loadDocument: load,
                post: deps?.post,
                addTag: deps?.addTag,
                signal: ctx.signal
              });
              const rawWeight = inputs.weight.value.trim();
              Object.assign(state, {
                watched: isChecked(inputs.watched),
                hidden: isChecked(inputs.hidden),
                color: isChecked(inputs.colorEnabled) ? normalizeColor(inputs.color.value) : "",
                weight: rawWeight === "" ? state.weight : normalizeWeight(Number(rawWeight))
              });
              summary.textContent = describeTag(state);
              return "My Tags updated";
            },
            onSaved: showToast
          });
          busy = false;
        };
        rowSaves.set(row, saveRow);
      }
      return row;
    };
    for (const tag of data.tags) {
      const row = buildRow(tag, api);
      filterable.push({ row, nameLower: tag.name.toLowerCase() });
      list.append(row);
    }
    const tagsetSection = data.tagsets === null ? null : tagsetPanel(data, data.tagsets, api !== null, ctx, deps?.saveTagset ?? ((tagset, change, signal) => saveTagset(tagset, change, { signal })));
    const page = el("div", { id: "my-tags", class: "my-tags-page" }, tagsetSection, toolbar);
    if (api === null) {
      page.append(readOnlyNote(data));
    } else {
      page.append(buildAddForm(api));
    }
    page.append(list);
    if (data.tags.length === 0) {
      page.append(el("p", {
        class: "my-tags-empty",
        text: api === null ? "No saved tags." : "No tags yet. Add your first tag above."
      }));
    }
    page.append(noMatch);
    pageScaffold(host, {
      title: "My Tags",
      summary: [el("span", { class: "my-tags-count", text: countText(data.tags.length, "tag") })],
      signal: ctx.signal
    });
    host.append(page);
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
    const isDirty = () => {
      for (const binding of bindings) {
        if (!baseline.has(binding.key)) {
          return true;
        }
        const previous = baseline.get(binding.key);
        const value = binding.read();
        const same = binding.equals ? binding.equals(value, previous) : Object.is(value, previous);
        if (!same) {
          return true;
        }
      }
      return false;
    };
    const draft = {
      isDirty,
      changed,
      reset: () => {
        for (const binding of bindings) {
          if (baseline.has(binding.key)) {
            binding.write(baseline.get(binding.key));
          }
        }
        onChange?.();
      },
      rebase: (saved) => {
        if (saved === undefined) {
          capture();
        } else {
          for (const [key, value] of saved) {
            if (baseline.has(key)) {
              baseline.set(key, value);
            }
          }
        }
        onChange?.();
      }
    };
    capture();
    return draft;
  }

  // src/ui/settings-field.ts
  function bindValue(bindings, key, read, write) {
    bindings.push({ key, read, write });
  }
  function labeledField(label, control, hint = "") {
    return el("div", { class: "settings-field" }, el("label", { class: "eyebrow", for: control.id, text: label }), control, hint === "" ? null : el("p", { class: "settings-hint", text: hint }));
  }
  function labeledRow(label, control, hint = "") {
    const caption = el("label", { for: control.id, text: label });
    const body = hint === "" ? caption : el("div", { class: "settings-row-text" }, caption, el("p", { class: "settings-hint", text: hint }));
    return el("div", { class: "settings-row" }, control, body);
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
      const button = buttonEl({
        class: "settings-key-capture",
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
        const keys = keymapDraft[action].map((key) => el("span", { class: "settings-key" }, el("span", { class: "settings-key-name", text: keyLabel(key) }), buttonEl({
          class: "settings-key-remove",
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
        const id = `settings-userscript-${key}`;
        const control = createCheckbox({ id, checked: synced[key] });
        toggles.set(key, control);
        bindValue(bindings, key, control.readChecked, control.writeChecked);
        return labeledRow(label, control.element, hint);
      });
      return el("div", { class: "settings-rows settings-rows-roomy" }, ...items);
    }
    function renderSelectFields() {
      const items = SELECT_FIELDS.map((field) => {
        const id = `settings-userscript-${field.key}`;
        const control = createSelect({
          class: "field-select settings-select",
          id,
          value: synced[field.key],
          options: field.options
        });
        selects.set(field.key, control);
        bindValue(bindings, field.key, control.read, control.write);
        return labeledField(field.label, control.element, field.hint);
      });
      return el("div", { class: "settings-number-grid" }, ...items);
    }
    function renderNumberFields() {
      const items = NUMBER_FIELDS.map((field) => {
        const id = `settings-userscript-${field.key}`;
        const input = el("input", {
          class: "field-input settings-number-input",
          type: "number",
          id,
          min: field.min,
          max: field.max,
          step: 1,
          inputmode: "numeric"
        });
        numbers.set(field, input);
        bindValue(bindings, field.key, () => {
          const raw = input.value.trim();
          if (raw === "") {
            return synced[field.key];
          }
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? clampNumber(field.key, parsed) : synced[field.key];
        }, (value) => {
          input.value = String(value);
        });
        return labeledField(field.label, input, field.hint);
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
    const exportButton = buttonEl({ class: "btn btn-ghost settings-export", text: "Export JSON" });
    exportButton.addEventListener("click", exportSettings);
    const importButton = buttonEl({ class: "btn btn-ghost settings-import", text: "Import JSON" });
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
    const keymapReset = buttonEl({
      class: "btn btn-ghost settings-keymap-reset",
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
    await postForm(siteUrl(SITE_PATHS.uconfig), body, {
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
  function fieldText(field, sectionTitle) {
    const label = field.label ?? (sectionTitle !== "" ? sectionTitle : humanize(field.name));
    return { label, hint: field.prompt !== "" && field.prompt !== label ? field.prompt : "" };
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
    bindValue(bindings, field.name, () => choices.find((choice) => choice.readChecked())?.element.value ?? "", (value) => {
      for (const choice of choices) {
        choice.writeChecked(choice.element.value === value);
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
    bindValue(bindings, field.name, control.readValue, control.writeValue);
    return labeledRow(field.label ?? humanize(field.name), control.element);
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
    bindValue(bindings, field.name, control.read, control.write);
    const { label, hint } = fieldText(field, sectionTitle);
    return labeledField(label, control.element, hint);
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
    bindValue(bindings, field.name, () => input.value, (value) => {
      input.value = value;
    });
    const { label, hint } = fieldText(field, sectionTitle);
    return labeledField(label, input, hint);
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
    bindValue(bindings, field.name, () => textarea.value, (value) => {
      textarea.value = value;
    });
    const { label, hint } = fieldText(field, sectionTitle);
    return labeledField(label, textarea, hint);
  }
  function hiddenField2(field, bindings) {
    const input = el("input", { type: "hidden", name: field.name, value: field.value });
    bindValue(bindings, field.name, () => input.value, (value) => {
      input.value = value;
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
      const chip = buttonEl({
        class: `cat-chip ${category.cls}`,
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
    const apply = buttonEl({ class: "btn btn-primary settings-apply", text: "Apply" });
    const reset = buttonEl({ class: "btn btn-ghost settings-reset", text: "Reset" });
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
          href: nativePath(SITE_PATHS.uconfig),
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
    const posted = new Map;
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
      const body = new Map(posted);
      for (const [key, value] of overrides) {
        body.set(key, value);
      }
      saving = true;
      clearError();
      apply.disabled = true;
      reset.disabled = true;
      apply.textContent = "Saving…";
      try {
        if (overrides.size > 0) {
          await save(uconfigBody(sections, body), ctx.signal);
          if (ctx.signal.aborted) {
            return;
          }
          for (const [key, value] of overrides) {
            posted.set(key, value);
          }
        }
        if (settingsChanged) {
          panel.apply();
        }
        draft.rebase(changed);
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
    return nativeEmptyPanel("No toplists were found on this page.");
  }
  function categoryBody(data, ctx) {
    if (data.entries.length === 0) {
      return [emptyState()];
    }
    const nodes = [
      el("section", { class: "toplist-section", "aria-label": data.title }, rowsList(data.entries))
    ];
    if (data.pager) {
      nodes.push(numberedPager({
        baseUrl: data.url,
        page: data.pager.page,
        total: data.pager.pages,
        param: "p",
        label: "Toplist pages",
        info: `Page ${data.pager.page} of ${data.pager.pages}`,
        prev: data.pager.prevHref,
        next: data.pager.nextHref,
        navigate: ctx.navigate
      }));
    }
    return nodes;
  }
  function renderToplist(host, data, ctx) {
    pageScaffold(host, {
      title: data.kind === "category" ? data.title : "Toplists",
      summary: [el("span", { text: summary(data) })],
      signal: ctx.signal
    });
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
    const submit = buttonEl({ class: "btn btn-small", type: "submit", text: "Search" });
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
      const button = buttonEl({
        class: "btn btn-small torrent-filter-btn",
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
    const clear = buttonEl({ class: "btn btn-ghost btn-small", text: "Clear" });
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
    pageScaffold(host, {
      title: "Torrents",
      summary: [
        el("span", {
          text: data.summary ?? countText(data.rows.length, "torrent")
        })
      ],
      signal: ctx.signal
    });
    const filtered = data.search !== "" || data.status !== "all" || data.uploaderFilter !== null;
    const body = data.rows.length === 0 ? statePanel({
      text: filtered ? "No torrents match this filter." : "No torrents were found on this page.",
      actions: [
        ...filtered ? [{ label: "Clear filters", primary: true, href: SITE_PATHS.torrents }] : [],
        nativePageAction()
      ]
    }) : el("div", { class: "torrent-table-wrap" }, torrentTable(data));
    host.append(filterBar(data, ctx), body);
    const total = data.pages[data.pages.length - 1] ?? data.page;
    if (total > 1) {
      host.append(numberedPager({
        baseUrl: data.url,
        page: data.page,
        total,
        param: "page",
        label: "Torrent pages",
        navigate: ctx.navigate
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
    img.setAttribute("fetchpriority", "low");
    img.decoding = "async";
    img.onload = () => {
      img.decode().then(() => log("preload + decode done", src), (error) => warn("preload decode failed", src, error));
    };
    img.onerror = () => {
      imgCache.delete(src);
      img.remove();
      warn("preload error", src);
    };
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
    function preloadPageImage(page, mine, signal) {
      const img = deps.preloadImage(page.imgSrc);
      img.addEventListener("error", () => {
        if (generation !== mine || signal.aborted) {
          return;
        }
        deps.retryWithNl(page, { signal, priority: priorityOf("prefetch") }).then((retried) => {
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
          preloadPageImage(next, mine, signal);
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
    syncSurface() {
      if (this.zoomLevel !== 1 || this.panX !== 0 || this.panY !== 0) {
        this.updateTransform();
      }
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
    onLoaded,
    isCurrent
  }) {
    let gaveUp = false;
    const stale = () => isCurrent?.() === false;
    const clearHandlers = () => {
      img.onload = null;
      img.onerror = null;
    };
    const render = (data, attempt) => {
      if (stale()) {
        return;
      }
      clearHandlers();
      if (img.src === data.imgSrc && img.complete && img.naturalWidth > 0) {
        log("instant from cache", data.imgSrc);
        if (!stale()) {
          onLoaded?.(data);
        }
        return;
      }
      img.onload = () => {
        if (stale()) {
          return;
        }
        onLoaded?.(data);
      };
      img.onerror = () => {
        if (gaveUp || stale()) {
          return;
        }
        clearHandlers();
        warn(`image failed (attempt ${attempt + 1})`, data.imgSrc);
        if (attempt >= maxRetries) {
          gaveUp = true;
          warn("giving up");
          if (!stale()) {
            onGiveUp();
          }
          return;
        }
        retry(data).then((retried) => {
          if (stale()) {
            return;
          }
          if (retried) {
            render(retried, attempt + 1);
            return;
          }
          if (!gaveUp) {
            gaveUp = true;
            warn("image retry unavailable");
            if (!stale()) {
              onGiveUp();
            }
          }
        }).catch((error) => {
          if (gaveUp || stale()) {
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
  function createPageImageSlotFactory({
    retry,
    maxRetries,
    signal,
    probe: createProbe
  }) {
    return {
      create(img, initialPage, hooks = {}) {
        let page = initialPage;
        let upgradePending = false;
        let upgradeFailed = false;
        let upgraded = false;
        const isCurrent = () => signal?.aborted !== true && (hooks.isCurrent?.() ?? true);
        const show = () => {
          showPageImage({
            img,
            page,
            retry,
            maxRetries: maxRetries(),
            onGiveUp: hooks.onGiveUp ?? (() => {
              return;
            }),
            onLoaded: (loaded) => {
              page = loaded;
              hooks.onLoaded?.(loaded);
            },
            isCurrent
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
            if (!isCurrent()) {
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
    };
  }

  // src/reader-mode.ts
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

  // src/ui/continuous-stack.ts
  function createContinuousStack({
    container,
    initial,
    next,
    key,
    load,
    render,
    onChange,
    onAppend,
    signal
  }) {
    const pages = [];
    const appendPage = (item) => {
      const rendered = render(item);
      pages.push({ node: rendered.node, view: rendered.view });
      container.insertBefore(rendered.node, scroll.element);
      onAppend?.();
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

  // src/reader-navigation.ts
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
  var FILE_INFO_DIMENSIONS = /::\s*(\d+)\s*x\s*(\d+)/;
  var GEOMETRY_SCAN = 3;
  function pageAspect(data) {
    const match = FILE_INFO_DIMENSIONS.exec(data.fileInfo);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    return match !== null && width > 0 && height > 0 ? height / width : null;
  }
  function nearestGeometryIndex(geometry, point) {
    let low = 0;
    let high = geometry.length;
    while (low < high) {
      const middle = low + high >> 1;
      const entry = geometry[middle];
      if (entry !== undefined && entry.top <= point) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const pivot = low > 0 ? low - 1 : 0;
    return nearestInRange(geometry, point, Math.max(0, pivot - GEOMETRY_SCAN), Math.min(geometry.length - 1, pivot + GEOMETRY_SCAN));
  }
  function nearestInRange(geometry, point, from, to) {
    let best = from;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let position = from;position <= to; position += 1) {
      const entry = geometry[position];
      if (entry === undefined) {
        continue;
      }
      const distance = Math.abs(entry.top + entry.height / 2 - point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = position;
      }
    }
    return best;
  }
  function nearestNearbyIndex(pages, current, viewportCenter) {
    const from = Math.max(0, current - GEOMETRY_SCAN);
    const to = Math.min(pages.length - 1, current + GEOMETRY_SCAN);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (let position = from;position <= to; position += 1) {
      const entry = pages[position];
      if (entry === undefined) {
        continue;
      }
      const rect = entry.node.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = position;
      }
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.top + rect.height);
    }
    return best >= 0 && viewportCenter >= top && viewportCenter <= bottom ? best : null;
  }
  function measureGeometry(pages) {
    const scroll = window.scrollY;
    return pages.map((entry) => {
      const rect = entry.node.getBoundingClientRect();
      return { top: rect.top + scroll, height: rect.height };
    });
  }
  function sameHud(previous, next) {
    return previous.page === next.page && previous.first === next.first && previous.prev === next.prev && previous.next === next.next && previous.last === next.last;
  }
  function createReaderNavigation(options) {
    const slotFactory = createPageImageSlotFactory({
      retry: (page) => loader.retryWithNl(page, { signal: options.signal }),
      maxRetries: () => getSettings().maxNlRetry,
      signal: options.signal
    });
    let mode = getSettings().readerMode;
    let lastPage = null;
    let adapter;
    const reportHud = (page, source, next, prev = source.prevHref !== null) => {
      options.onHud({
        page,
        first: source.firstHref !== null,
        prev,
        next,
        last: source.lastHref !== null
      });
    };
    const navigateEnd = (base, end) => {
      if (base === null) {
        return;
      }
      const target = end === "first" ? base.firstHref : base.lastHref;
      if (target !== null) {
        options.navigate(target, { replace: true });
        return;
      }
      options.toast(end === "first" ? "First page" : "Last page");
    };
    const singleAdapter = () => {
      let base = null;
      let slot = null;
      let surface = null;
      const createMain = (data) => slotFactory.create(options.mainImage, data, {
        isCurrent: () => mode === "single" && base === data,
        onLoaded: options.onImageLoaded,
        onGiveUp: () => options.onImageError(data)
      });
      const hud = () => {
        if (base === null) {
          return;
        }
        reportHud(slot?.page ?? base, base, base.nextHref !== null);
      };
      const show = (data) => {
        base = data;
        options.spreadWrap.hidden = false;
        options.continuousContainer.hidden = true;
        slot = createMain(data);
        slot.show();
        surface = makeSurface(options.mainImage, slot, [slot]);
        options.onSurfaceChange();
        hud();
      };
      const go = (direction) => {
        if (base === null) {
          return;
        }
        const target = direction === "prev" ? base.prevHref : base.nextHref;
        if (target !== null) {
          options.navigate(target, { replace: true });
          return;
        }
        options.toast(direction === "prev" ? "First page" : "Last page");
      };
      return {
        show,
        go,
        goEnd: (end) => navigateEnd(base, end),
        reload: () => slot?.reload() ?? false,
        upgrade: (level) => surface?.upgrade(level),
        surface: () => {
          if (surface === null) {
            throw new Error("reader surface is not mounted");
          }
          return surface;
        },
        page: () => slot?.page ?? base ?? lastPageOrThrow(),
        handleScroll: () => {
          return;
        },
        retryMain: () => {
          if (base !== null) {
            show(base);
          }
        },
        stop: () => {
          return;
        }
      };
    };
    const spreadAdapter = () => {
      let base = null;
      let mainSlot = null;
      let companionSlot = null;
      let companion = null;
      let surface = null;
      let pairToken = 0;
      let navigationToken = 0;
      const setSingle = (single) => {
        options.spreadWrap.classList.toggle("is-single", single);
      };
      const visibleSlots = () => {
        if (mainSlot === null) {
          return [];
        }
        return companionSlot !== null && !options.spreadImage.hidden ? [mainSlot, companionSlot] : [mainSlot];
      };
      const syncSurface = () => {
        surface = mainSlot === null ? null : makeSurface(options.spreadWrap, mainSlot, visibleSlots());
        options.onSurfaceChange();
      };
      const hud = () => {
        if (base === null || mainSlot === null) {
          return;
        }
        const facingVisible = companion !== null && !options.spreadImage.hidden;
        reportHud(mainSlot.page, base, facingVisible && companion !== null ? companion.nextHref !== null : base.nextHref !== null);
      };
      const createMain = (data) => slotFactory.create(options.mainImage, data, {
        isCurrent: () => mode === "spread" && base === data,
        onLoaded: options.onImageLoaded,
        onGiveUp: () => options.onImageError(data)
      });
      const clear = () => {
        pairToken += 1;
        companion = null;
        companionSlot = null;
        options.spreadImage.hidden = true;
        options.spreadImage.removeAttribute("src");
        setSingle(false);
      };
      const show = (data) => {
        base = data;
        options.spreadWrap.hidden = false;
        options.continuousContainer.hidden = true;
        clear();
        setSingle(data.nextHref === null);
        mainSlot = createMain(data);
        mainSlot.show();
        syncSurface();
        hud();
        if (data.nextHref === null) {
          return;
        }
        const loadToken = pairToken;
        loader.viewerPage(data.nextHref, {
          priority: priorityOf("facing"),
          signal: options.signal
        }).then((facing) => {
          if (options.signal.aborted || loadToken !== pairToken || base === null) {
            return;
          }
          companion = facing;
          options.spreadImage.hidden = false;
          setSingle(false);
          options.spreadImage.alt = `${facing.galleryTitle.primary} — page ${facing.counterText}`;
          companionSlot = slotFactory.create(options.spreadImage, facing, {
            isCurrent: () => mode === "spread" && companion === facing,
            onGiveUp: () => {
              options.spreadImage.hidden = true;
              setSingle(true);
              syncSurface();
              hud();
            }
          });
          companionSlot.show();
          syncSurface();
          hud();
          surface?.upgrade(options.zoomLevel());
        }).catch(() => {
          if (options.signal.aborted || loadToken !== pairToken || base === null) {
            return;
          }
          clear();
          setSingle(true);
          syncSurface();
          hud();
        });
      };
      const go = (direction) => {
        const from = base;
        if (from === null) {
          return;
        }
        const loadToken = ++navigationToken;
        if (direction === "next") {
          (async () => {
            let trailing = companion;
            if (trailing === null && from.nextHref !== null) {
              trailing = await loader.viewerPage(from.nextHref, {
                priority: priorityOf("facing"),
                signal: options.signal
              }).catch(() => null);
            }
            if (loadToken !== navigationToken || options.signal.aborted) {
              return;
            }
            const target = trailing !== null ? trailing.nextHref : from.nextHref;
            if (target !== null) {
              options.navigate(target, { replace: true });
              return;
            }
            options.toast("Last page");
          })();
          return;
        }
        (async () => {
          const back = from.prevHref !== null ? await loader.viewerPage(from.prevHref, {
            priority: priorityOf("facing"),
            signal: options.signal
          }).catch(() => null) : null;
          if (loadToken !== navigationToken || options.signal.aborted) {
            return;
          }
          const target = back !== null ? back.prevHref ?? back.viewerUrl : from.prevHref;
          if (target !== null && target !== from.viewerUrl) {
            options.navigate(target, { replace: true });
            return;
          }
          options.toast("First page");
        })();
      };
      return {
        show,
        go,
        goEnd: (end) => navigateEnd(base, end),
        reload: () => mainSlot?.reload() ?? false,
        upgrade: (level) => surface?.upgrade(level),
        surface: () => {
          if (surface === null) {
            throw new Error("reader surface is not mounted");
          }
          return surface;
        },
        page: () => mainSlot?.page ?? base ?? lastPageOrThrow(),
        handleScroll: () => {
          return;
        },
        retryMain: () => {
          if (base === null) {
            return;
          }
          mainSlot = createMain(base);
          mainSlot.show();
          syncSurface();
        },
        stop: () => {
          clear();
          surface = null;
          options.spreadWrap.classList.remove("is-single");
        }
      };
    };
    const continuousAdapter = () => {
      let base = null;
      let stack = null;
      let index = 0;
      let generation = 0;
      let aspect = 1.4;
      let frame;
      let surface = null;
      let geometry = null;
      let nearbyScan = null;
      let layoutRevision = 0;
      let hudState = null;
      const invalidateGeometry = () => {
        geometry = null;
        nearbyScan = null;
        layoutRevision += 1;
      };
      const onResize = () => {
        invalidateGeometry();
      };
      window.addEventListener("resize", onResize, { passive: true });
      const renderPage = (data) => {
        const node = el("div", { class: "reader-page" });
        const img = el("img", {
          class: "reader-page-img",
          alt: `${data.galleryTitle.primary} — page ${data.counterText}`,
          loading: "lazy",
          decoding: "async"
        });
        const retry = buttonEl({
          class: "btn btn-small reader-page-retry",
          text: "Retry",
          style: "position: absolute; z-index: 1;"
        });
        retry.hidden = true;
        node.append(img, retry);
        const declared = pageAspect(data);
        if (declared !== null) {
          aspect = declared;
          const containerWidth = options.continuousContainer.clientWidth;
          const reserveWidth = containerWidth > 0 ? containerWidth : window.innerWidth;
          node.style.minHeight = `${Math.round(reserveWidth * declared)}px`;
        } else {
          node.style.minHeight = `${Math.round(window.innerWidth * aspect)}px`;
        }
        const loadGeneration = generation;
        const slot = slotFactory.create(img, data, {
          isCurrent: () => generation === loadGeneration,
          onGiveUp: () => {
            node.classList.add("is-failed");
            retry.hidden = false;
            invalidateGeometry();
          },
          onLoaded: () => {
            node.classList.remove("is-failed");
            retry.hidden = true;
            node.style.removeProperty("min-height");
            if (img.naturalWidth > 0) {
              aspect = img.naturalHeight / img.naturalWidth;
            }
            invalidateGeometry();
          }
        });
        retry.addEventListener("click", () => {
          retry.hidden = true;
          node.classList.remove("is-failed");
          invalidateGeometry();
          slot.show();
        }, { signal: options.signal });
        slot.show();
        return { node, view: slot };
      };
      const hud = () => {
        if (base === null) {
          return;
        }
        const pages = stack?.pages() ?? [];
        const visible = pages[index]?.view.page ?? base;
        const state = stack?.state();
        const next = {
          page: visible,
          first: base.firstHref !== null,
          prev: index > 0,
          next: !((state === undefined || state.done) && index >= pages.length - 1),
          last: base.lastHref !== null
        };
        if (hudState !== null && sameHud(hudState, next)) {
          return;
        }
        hudState = next;
        options.onHud(next);
      };
      const setSurface = (entry) => {
        surface = entry === undefined ? null : makeSurface(entry.view.img, entry.view, [entry.view]);
        options.onSurfaceChange();
      };
      const scrollTo = (next) => {
        const entry = stack?.pages()[next];
        if (entry === undefined) {
          return;
        }
        entry.node.scrollIntoView({ block: "start" });
        index = next;
        setSurface(entry);
        hud();
        surface?.upgrade(options.zoomLevel());
      };
      const teardown = () => {
        generation += 1;
        stack?.stop();
        stack = null;
        index = 0;
        surface = null;
        geometry = null;
        nearbyScan = null;
        hudState = null;
        options.continuousContainer.replaceChildren();
      };
      const show = (data) => {
        base = data;
        options.spreadWrap.hidden = true;
        options.continuousContainer.hidden = false;
        options.mainImage.removeAttribute("src");
        options.spreadImage.hidden = true;
        options.spreadImage.removeAttribute("src");
        teardown();
        stack = createContinuousStack({
          container: options.continuousContainer,
          initial: data,
          next: data.nextHref,
          key: (page) => page.viewerUrl,
          signal: options.signal,
          load: (url, signal) => loader.viewerPage(url, { priority: priorityOf("facing"), signal }).then((page) => ({
            items: [page],
            next: page.nextHref
          })),
          render: renderPage,
          onChange: hud,
          onAppend: invalidateGeometry
        });
        index = 0;
        setSurface(stack.pages()[0]);
        hud();
      };
      const sync = () => {
        const pages = stack?.pages() ?? [];
        if (pages.length === 0) {
          return;
        }
        const viewportCenter = window.innerHeight / 2;
        const scroll = window.scrollY;
        const documentCenter = scroll + viewportCenter;
        let best;
        if (geometry !== null && geometry.length === pages.length) {
          best = nearestGeometryIndex(geometry, documentCenter);
        } else if (nearbyScan !== null && nearbyScan.revision === layoutRevision && nearbyScan.scroll === scroll && nearbyScan.viewport === window.innerHeight && nearbyScan.count === pages.length && nearbyScan.index === index) {
          best = nearbyScan.index;
        } else {
          const nearby = nearestNearbyIndex(pages, index, viewportCenter);
          if (nearby !== null) {
            best = nearby;
            nearbyScan = {
              revision: layoutRevision,
              scroll,
              viewport: window.innerHeight,
              count: pages.length,
              index: nearby
            };
          } else {
            geometry = measureGeometry(pages);
            nearbyScan = null;
            best = nearestGeometryIndex(geometry, documentCenter);
          }
        }
        const previous = index;
        index = best;
        if (best !== previous) {
          setSurface(pages[best]);
        }
        hud();
        if (best !== previous) {
          surface?.upgrade(options.zoomLevel());
        }
      };
      const go = (direction) => {
        const active = stack;
        if (active === null) {
          return;
        }
        if (direction === "prev") {
          if (index <= 0) {
            options.toast("First page");
            return;
          }
          scrollTo(index - 1);
          return;
        }
        (async () => {
          if (index >= active.pages().length - 1) {
            const state = active.state();
            if (state.loading) {
              return;
            }
            if (!state.done) {
              const appended = state.failed ? await active.retry() : await active.loadNext();
              if (active !== stack || options.signal.aborted) {
                return;
              }
              if (!appended) {
                const after = active.state();
                if (after.failed) {
                  options.toast("Could not load the next page");
                } else if (after.done) {
                  options.toast("Last page");
                }
                hud();
                return;
              }
            }
          }
          if (index >= active.pages().length - 1) {
            options.toast("Last page");
            return;
          }
          scrollTo(index + 1);
        })();
      };
      return {
        show,
        go,
        goEnd: (end) => navigateEnd(base, end),
        reload: () => surface?.reload() ?? false,
        upgrade: (level) => surface?.upgrade(level),
        surface: () => {
          if (surface === null) {
            throw new Error("reader surface is not mounted");
          }
          return surface;
        },
        page: () => {
          const pages = stack?.pages() ?? [];
          return pages[index]?.view.page ?? base ?? lastPageOrThrow();
        },
        handleScroll: () => {
          if (frame !== undefined) {
            return;
          }
          frame = window.requestAnimationFrame(() => {
            frame = undefined;
            sync();
          });
        },
        retryMain: () => {
          return;
        },
        stop: () => {
          window.removeEventListener("resize", onResize);
          if (frame !== undefined) {
            window.cancelAnimationFrame(frame);
            frame = undefined;
          }
          teardown();
        }
      };
    };
    function lastPageOrThrow() {
      if (lastPage === null) {
        throw new Error("reader has no page");
      }
      return lastPage;
    }
    const makeAdapter = (next) => next === "continuous" ? continuousAdapter() : next === "spread" ? spreadAdapter() : singleAdapter();
    adapter = makeAdapter(mode);
    return {
      show(page) {
        lastPage = page;
        adapter.show(page);
      },
      setMode(next) {
        if (next === mode) {
          return;
        }
        adapter.stop();
        mode = next;
        adapter = makeAdapter(next);
        if (lastPage !== null) {
          adapter.show(lastPage);
        }
      },
      go: (direction) => adapter.go(direction),
      goEnd: (end) => adapter.goEnd(end),
      reload: () => adapter.reload(),
      upgrade: (level) => adapter.upgrade(level),
      surface: () => adapter.surface(),
      currentPage: () => adapter.page(),
      handleScroll: () => adapter.handleScroll(),
      retryMain: () => adapter.retryMain(),
      clickIntent: (ratio, direction) => clickIntent(ratio, mode, direction),
      swipeIntent: (dx, minDistance, direction) => swipeIntent(dx, minDistance, mode, direction),
      get continuous() {
        return mode === "continuous";
      },
      stop: () => adapter.stop()
    };
  }

  // src/shell.html
  var shell_default = `<div id="reader">
  <span id="img-wrap">
    <img id="main-img" alt="" fetchpriority="high" decoding="async" />
    <img id="spread-img" alt="" hidden decoding="async" />
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
    <a id="img-error-native" class="img-error-native" href=""></a>
  </div>
</div>
`;

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
      elErrorRetry: requireShell("img-error-retry"),
      elErrorNative: requireShell("img-error-native")
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
      retryWithNl: (page, options) => loader.retryWithNl(page, options),
      activeCount: () => net.activeCount,
      concurrency: () => getSettings().netConcurrency,
      depth: () => getSettings().prefetchCount,
      clock: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle)
      }
    });
    const setHelp = (open) => {
      ui.elHelp.hidden = !open;
    };
    let chromePinned = false;
    let activeMode = getSettings().readerMode;
    let resumeTimer;
    let resumePage = null;
    let hudPage = null;
    let hudWritten = null;
    const flushResume = () => {
      if (resumePage === null) {
        return;
      }
      saveResume(resumePage.galleryHref, {
        pageUrl: resumePage.viewerUrl,
        pageNum: resumePage.pageNum,
        counterText: resumePage.counterText
      });
    };
    const rememberPosition = (data) => {
      resumePage = data;
      if (resumeTimer !== undefined) {
        return;
      }
      resumeTimer = window.setTimeout(() => {
        resumeTimer = undefined;
        flushResume();
      }, 750);
    };
    const hideError = () => {
      ui.elError.hidden = true;
    };
    const showError = (page) => {
      ui.elErrorText.textContent = `Page ${page.counterText} could not be loaded.`;
      ui.elErrorNative.href = nativeUrl(page.viewerUrl);
      ui.elErrorNative.textContent = "Open native page";
      ui.elError.hidden = false;
    };
    const navigation = createReaderNavigation({
      signal: ctx.signal,
      navigate: ctx.navigate,
      toast: showToast,
      mainImage: ui.elImg,
      spreadImage: ui.elSpread,
      spreadWrap: ui.elWrap,
      continuousContainer: ui.elContinuous,
      onHud: (state) => {
        const previous = hudWritten;
        if (previous !== null && previous.page === state.page && previous.first === state.first && previous.prev === state.prev && previous.next === state.next && previous.last === state.last) {
          return;
        }
        if (previous?.page !== state.page) {
          ui.elCounter.textContent = state.page.counterText;
          ui.elFileInfo.textContent = state.page.fileInfo;
        }
        if (previous?.first !== state.first) {
          ui.elFirst.disabled = !state.first;
        }
        if (previous?.prev !== state.prev) {
          ui.elPrev.disabled = !state.prev;
        }
        if (previous?.next !== state.next) {
          ui.elNext.disabled = !state.next;
        }
        if (previous?.last !== state.last) {
          ui.elLast.disabled = !state.last;
        }
        hudWritten = {
          page: state.page,
          first: state.first,
          prev: state.prev,
          next: state.next,
          last: state.last
        };
        if (state.page !== hudPage) {
          hudPage = state.page;
          rememberPosition(state.page);
        }
      },
      onSurfaceChange: () => {
        zoom.syncSurface();
      },
      onImageLoaded: (page) => {
        hideError();
        log("image displayed", page.imgSrc);
      },
      onImageError: showError,
      zoomLevel: () => zoom.getZoomLevel()
    });
    const zoom = new ZoomController(ui.elReader, () => navigation.surface().element, () => getSettings().fitHeight, ctx.signal, (level) => navigation.upgrade(level));
    const updateTitleWidth = () => {
      const viewportWidth = window.innerWidth;
      const maxWidth = getSettings().fitHeight ? Math.max(220, (viewportWidth - ui.elImg.clientWidth) / 2 - 30) : Math.min(760, viewportWidth * 0.62);
      ui.elTitle.style.maxWidth = `${maxWidth}px`;
    };
    const reloadImage = () => {
      if (!navigation.reload()) {
        return;
      }
      hideError();
      showToast("Reloading image");
    };
    const retryPage = () => {
      const page = navigation.currentPage();
      (async () => {
        hideError();
        const retried = await loader.retryWithNl(page, { signal: ctx.signal });
        if (ctx.signal.aborted) {
          return;
        }
        if (retried) {
          render(retried);
          return;
        }
        navigation.retryMain();
      })();
    };
    const go = (direction) => {
      navigation.go(direction);
    };
    const goEnd = (direction) => {
      navigation.goEnd(direction);
    };
    function render(data) {
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
      hideError();
      navigation.show(data);
      if (!getSettings().fitHeight && !navigation.continuous) {
        window.scrollTo(0, 0);
      }
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
    ui.elContinuous.style.setProperty("--reader-gap", `${getSettings().gap}px`);
    render(pageData);
    window.addEventListener("scroll", () => navigation.handleScroll(), {
      passive: true,
      signal: ctx.signal
    });
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
        navigation.setMode(settings.readerMode);
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
        if (first !== undefined && second !== undefined && getSettings().fitHeight && !navigation.continuous) {
          pinchStart = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            zoom: zoom.getZoomLevel()
          };
        }
        return;
      }
      suppressClick = false;
      if (zoom.getZoomLevel() > 1 && getSettings().fitHeight && !navigation.continuous) {
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
      const intent = navigation.swipeIntent(dx, SWIPE_MIN, getSettings().readingDirection);
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
      if (event.target instanceof Element && event.target.closest("#hud, #page-info, #page-nav, #hud-help, #img-error, button, a, input, select, textarea, label")) {
        return;
      }
      if (zoom.consumePanned() || suppressClick) {
        suppressClick = false;
        return;
      }
      const ratio = event.clientX / Math.max(1, window.innerWidth);
      const intent = navigation.clickIntent(ratio, getSettings().readingDirection);
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
    ui.elErrorRetry.addEventListener("click", retryPage, { signal: ctx.signal });
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
        if (!getSettings().fitHeight || navigation.continuous) {
          event.preventDefault();
          window.scrollBy(0, -getSettings().scrollStep);
        }
      } else if (isKey(event, "down")) {
        if (!getSettings().fitHeight || navigation.continuous) {
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
      navigation.stop();
      ui.elImg.removeAttribute("src");
      ui.elSpread.removeAttribute("src");
    }, { once: true });
    prefetcher.warm(pageData);
  }

  // src/routes/index.ts
  var ROUTE_DATA_CACHE_LIMIT = 8;
  function documentView(deps, spec) {
    const cached = new Map;
    const cacheable = spec.fresh !== true;
    const remember = (route, data) => {
      if (!cacheable) {
        return;
      }
      cached.delete(route.url);
      cached.set(route.url, data);
      if (cached.size > ROUTE_DATA_CACHE_LIMIT) {
        const oldest = cached.keys().next().value;
        if (oldest !== undefined) {
          cached.delete(oldest);
        }
      }
    };
    const fetchDocument = (url, signal, priority, options) => deps.document(url, {
      signal,
      priority,
      tag: spec.tag,
      ...spec.fresh === true || options?.fresh === true ? { fresh: true } : {}
    });
    const page = spec.page;
    const pageSource = page === undefined ? undefined : async (url, signal) => {
      const { doc, url: finalUrl } = await fetchDocument(url, signal, priorityOf("append"));
      return page(doc, finalUrl);
    };
    const feed = (route) => {
      if (pageSource === undefined) {
        return;
      }
      return spec.feed === undefined ? pageSource : spec.feed(route, pageSource);
    };
    return {
      prepare: (route) => ({ route, bootUrl: null, state: {} }),
      load: async (route, signal, options) => {
        if (options?.fresh !== true) {
          const hit = cached.get(route.url);
          if (hit !== undefined) {
            return hit;
          }
        }
        const { doc, url } = await fetchDocument(spec.request?.(route) ?? route.url, signal, priorityOf("navigation"), options);
        const data = spec.parse(doc, url, route);
        spec.sanity?.(data, doc);
        remember(route, data);
        return data;
      },
      seed: (route, data) => {
        remember(route, data);
      },
      parse: (doc, route) => {
        const data = spec.parse(doc, route.url, route);
        spec.sanity?.(data, doc);
        return data;
      },
      render: (host, data, ctx, route) => spec.render(host, data, ctx, feed(route)),
      title: (data) => spec.title(data),
      feed
    };
  }
  function listRange(route) {
    return { since: route.query.since, until: route.query.until };
  }
  function listRouteData(route, doc, url) {
    const page = parseListPage(doc, url);
    const range = listRange(route);
    if (!isDateRangeActive(range)) {
      return { page, query: route.query, scope: route.scope };
    }
    const filtered = filterByDateRange(page.items, range);
    return {
      page: {
        ...page,
        items: filtered.items,
        nextHref: page.nextHref !== null && !filtered.crossedSince ? withDateRange(page.nextHref, range) : null
      },
      query: route.query,
      scope: route.scope
    };
  }
  function listFeed(route, source) {
    const range = listRange(route);
    if (!isDateRangeActive(range)) {
      return source;
    }
    return async (url, signal) => {
      const page = await source(withDateRange(url, range), signal);
      const kept = filterByDateRange(page.items, range);
      return {
        items: kept.items,
        next: kept.crossedSince || page.next === null ? null : withDateRange(page.next, range)
      };
    };
  }
  function prepareListRoute(route, context) {
    const filtered = applyPersistedListFilters(route);
    const requestUrl = listRequestUrl(filtered.url);
    const bootUrl = context.previous === null && (filtered.url !== route.url || requestUrl !== filtered.url) ? requestUrl : null;
    return { route: filtered, bootUrl, state: {} };
  }
  function prepareViewerRoute(route, context) {
    const remembered = context.previousState.fromGallery === true;
    const fromGallery = context.replace ? remembered : context.previous?.kind === "gallery";
    return { route, bootUrl: null, state: { fromGallery } };
  }
  function createRouteViews(deps) {
    const table = {
      viewer: {
        match: (url) => VIEWER_PATH.test(url.pathname) ? { kind: "viewer", url: url.href } : null,
        prepare: prepareViewerRoute,
        load: async (route, signal) => {
          const data = await deps.viewerPage(route.url, {
            signal,
            priority: priorityOf("navigation")
          });
          assertViewerPage(data);
          return data;
        },
        parse: (doc, route) => {
          const data = parseViewer(doc, route.url);
          assertViewerPage(data);
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
          sanity: assertGalleryPage,
          page: parseGalleryThumbPage,
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
          request: (route) => listRequestUrl(route.url),
          parse: (doc, url, route) => listRouteData(route, doc, url),
          sanity: (data, doc) => assertListPage(data.page, doc),
          page: (doc, url) => {
            const page = parseListPage(doc, url);
            return { items: page.items, next: page.nextHref };
          },
          feed: listFeed,
          render: (host, data, ctx, pageSource) => renderList(host, data.page, data.query, ctx, data.scope, { pageSource }),
          title: (data) => {
            const pathTag = tagTokenFromHref(new URL(data.page.url).pathname, data.page.url);
            return documentTitle(listLabels(data.query, data.scope, pathTag).title);
          }
        }),
        prepare: prepareListRoute
      },
      torrents: {
        match: (url) => url.pathname === SITE_PATHS.torrents ? { kind: "torrents", url: url.href } : null,
        ...documentView(deps, {
          tag: "torrents",
          parse: parseTorrents2,
          sanity: assertTorrentsPage,
          render: renderTorrents,
          title: () => documentTitle("Torrents")
        })
      },
      galleryTorrents: {
        match: (url) => url.pathname === SITE_PATHS.galleryTorrents ? { kind: "galleryTorrents", url: url.href } : null,
        ...documentView(deps, {
          tag: "gallery-torrents",
          parse: parseGalleryTorrents,
          sanity: assertGalleryTorrentsPage,
          render: (host, data, ctx) => renderGalleryTorrents(host, data, ctx),
          title: (data) => documentTitle(data.title === "" ? "Torrents" : `Torrents for ${data.title}`)
        })
      },
      archive: {
        match: (url) => url.pathname === SITE_PATHS.archive ? { kind: "archive", url: url.href } : null,
        ...documentView(deps, {
          tag: "archive",
          parse: parseArchivePage,
          sanity: assertArchivePage,
          render: (host, data, ctx) => renderArchive(host, data, ctx),
          title: () => documentTitle("Archive Download"),
          fresh: true
        })
      },
      home: {
        match: (url) => url.pathname === SITE_PATHS.home ? { kind: "home", url: url.href } : null,
        ...documentView(deps, {
          tag: "home",
          parse: parseHome,
          sanity: assertHomePage,
          render: (host, data, ctx) => renderHome(host, data, ctx),
          title: () => documentTitle("My Home")
        })
      },
      myTags: {
        match: (url) => isPath(url.pathname, SITE_PATHS.myTags) ? { kind: "myTags", url: url.href } : null,
        ...documentView(deps, {
          tag: "my-tags",
          parse: parseMyTags,
          sanity: assertMyTagsPage,
          render: (host, data, ctx) => renderMyTags(host, data, ctx),
          title: () => documentTitle("My Tags")
        })
      },
      favorites: {
        match: (url) => url.pathname === SITE_PATHS.favorites ? { kind: "favorites", url: url.href } : null,
        ...documentView(deps, {
          tag: "favorites",
          parse: parseFavorites,
          sanity: assertFavoritesPage,
          render: (host, data, ctx) => renderFavorites(host, data, ctx),
          title: (data) => documentTitle(...favoritesLabels(data).title)
        })
      },
      toplist: {
        match: (url) => url.pathname === SITE_PATHS.toplist ? { kind: "toplist", url: url.href } : null,
        ...documentView(deps, {
          tag: "toplist",
          parse: parseToplist,
          sanity: assertToplistPage,
          render: renderToplist,
          title: (data) => data.kind === "category" ? documentTitle(data.title) : documentTitle("Toplists")
        })
      },
      settings: {
        match: (url) => url.pathname === SITE_PATHS.uconfig ? { kind: "settings", url: url.href } : null,
        ...documentView(deps, {
          tag: "settings",
          parse: parseUconfig,
          sanity: assertSettingsPage,
          render: (host, data, ctx) => renderSettings(host, data, ctx),
          title: () => documentTitle("Settings"),
          fresh: true
        })
      }
    };
    function viewFor(route) {
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
    return { routeView: viewFor, match };
  }
  var productionViews = createRouteViews(loader);
  function routeView(route) {
    return productionViews.routeView(route);
  }
  var matchOwnedRoute = (url) => productionViews.match(url);

  // src/router.ts
  function parseRoute(href, base = location.href) {
    let url;
    let origin;
    try {
      url = new URL(href, base);
      origin = new URL(base).origin;
    } catch {
      return { kind: "native", url: href };
    }
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) {
      return { kind: "native", url: url.href };
    }
    if (url.searchParams.has("eh_native")) {
      return { kind: "native", url: url.href };
    }
    return matchOwnedRoute(url) ?? { kind: "native", url: url.href };
  }
  function startLinkInterception(navigate, doc = document) {
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
    doc.addEventListener("click", onClick);
  }

  // src/site-ads.ts
  var SITE_AD_SELECTOR = 'script[src*="juicyads.com"], iframe[src*="juicyads.com"]';
  function canCarrySiteAd(element) {
    const tag = element.localName;
    return tag === "script" || tag === "iframe";
  }
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
    const observer = new Observer((mutations) => {
      const roots = [];
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target.nodeType !== 1) {
            continue;
          }
          const element = target;
          if (!canCarrySiteAd(element)) {
            continue;
          }
          if (element.matches(SITE_AD_SELECTOR)) {
            element.remove();
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) {
            continue;
          }
          const element = node;
          if (element.matches(SITE_AD_SELECTOR)) {
            element.remove();
          } else {
            roots.push(element);
          }
        }
      }
      if (roots.length === 0) {
        return;
      }
      for (const node of doc.querySelectorAll(SITE_AD_SELECTOR)) {
        if (roots.some((root) => root === node || root.contains(node))) {
          node.remove();
        }
      }
      for (const root of roots) {
        if (!root.isConnected) {
          stripSiteAds(root);
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
      buttonEl({
        class: "eh-banner-close",
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
  var SCROLL_RESTORE_SAMPLE_MS = 100;
  function restoreScrollWhenReady(target, {
    scrollTo = (y) => {
      window.scrollTo(0, y);
    },
    scrollY = () => window.scrollY,
    scrollHeight = () => document.documentElement.scrollHeight,
    now = () => performance.now(),
    frame = (callback) => window.requestAnimationFrame(callback),
    cancelFrame = (handle) => window.cancelAnimationFrame(handle),
    timeoutMs = SCROLL_RESTORE_TIMEOUT_MS,
    sampleMs = SCROLL_RESTORE_SAMPLE_MS,
    advance = () => Promise.resolve(false),
    onDone = () => {
      return;
    }
  } = {}) {
    let finished = false;
    let pending = null;
    let stopped = false;
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
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      stop();
      onDone();
    };
    if (target <= 0) {
      scrollTo(0);
      finish();
      return stop;
    }
    const deadline = now() + timeoutMs;
    let growing = false;
    let advanceExhausted = false;
    let lastHeight = scrollHeight();
    let lastGrowth = now();
    let lastSample = now() - sampleMs;
    const tick = () => {
      pending = null;
      if (stopped) {
        return;
      }
      const at = now();
      if (at - lastSample < sampleMs) {
        pending = frame(tick);
        return;
      }
      lastSample = at;
      const height = scrollHeight();
      const changed = height !== lastHeight;
      const reachedBefore = Math.abs(scrollY() - target) <= 2;
      if (changed || !reachedBefore) {
        scrollTo(target);
      }
      if (changed) {
        lastHeight = height;
        lastGrowth = at;
      }
      const reached = Math.abs(scrollY() - target) <= 2;
      const stalled = at - lastGrowth >= SCROLL_RESTORE_STALL_MS;
      if (reached || stalled || at >= deadline) {
        finish();
        return;
      }
      if (!growing && !advanceExhausted) {
        growing = true;
        advance().then((more) => {
          if (!more) {
            advanceExhausted = true;
          }
        }).catch(() => {
          advanceExhausted = true;
        }).finally(() => {
          growing = false;
        });
      }
      pending = frame(tick);
    };
    pending = frame(tick);
    return stop;
  }

  // src/ui/sticky.ts
  var READING_GAP = 12;
  var PINNED_SELECTOR = ".topbar, .settings-jump, .toplist-tabs";
  function trackStickyChrome(root) {
    const header = root.querySelector(".topbar");
    const pinned = [...root.querySelectorAll(PINNED_SELECTOR)];
    let frame = null;
    const apply = () => {
      frame = null;
      const headerHeight = header === null ? 0 : Math.round(header.getBoundingClientRect().height);
      let stack = 0;
      for (const node of pinned) {
        stack += node === header ? headerHeight : Math.round(node.getBoundingClientRect().height);
      }
      const style = document.documentElement.style;
      style.setProperty("--topbar-h", `${headerHeight}px`);
      style.setProperty("--sticky-reading-line", `${stack + READING_GAP}px`);
    };
    const schedule = () => {
      frame ??= requestFrame(apply);
    };
    const observer = new ResizeObserver(schedule);
    const observed = new Set(pinned);
    if (header !== null) {
      observed.add(header);
    }
    for (const node of observed) {
      observer.observe(node);
    }
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelFrame(frame);
      frame = null;
      const style = document.documentElement.style;
      style.removeProperty("--topbar-h");
      style.removeProperty("--sticky-reading-line");
    };
  }

  // .cache/app.css
  var app_default = `/*! tailwindcss v4.3.5 | MIT License | https://tailwindcss.com */
@layer properties;
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    --spacing: 0.25rem;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-bold: 700;
    --font-weight-extrabold: 800;
    --tracking-normal: 0em;
    --tracking-wide: 0.025em;
    --leading-relaxed: 1.625;
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
    font-family: var(--default-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");
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
    font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
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
  button, input:where([type="button"], [type="reset"], [type="submit"]), ::file-selector-button {
    appearance: button;
  }
  ::-webkit-inner-spin-button, ::-webkit-outer-spin-button {
    height: auto;
  }
  [hidden]:where(:not([hidden="until-found"])) {
    display: none !important;
  }
}
@layer utilities {
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
  .justify-between {
    justify-content: space-between;
  }
  .text-control {
    font-size: var(--text-control);
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
    gap: 6px;
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
  .topbar-clear, .topbar-history, .quick-tag-remove {
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
    font-weight: 600;
  }
  .rail-link, .fav-item, .favorites-move-item, .favorites-order-link, .topbar-more-link, .toplist-tab, .topbar-tab, .action-menu-item, .tag-menu-item {
    display: flex;
    cursor: pointer;
    align-items: center;
    border-radius: var(--radius-row);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    height: 28px;
    gap: 4px;
    padding-inline: 8px;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
  }
  .topbar-clear:hover, .topbar-history:hover, .quick-tag-remove:hover, .rail-link:hover, .fav-item:hover, .favorites-move-item:hover, .favorites-order-link:hover, .topbar-more-link:hover, .toplist-tab:hover, .topbar-tab:hover, .action-menu-item:hover, .action-menu-item:focus-visible, .tag-menu-item:hover, .tag-menu-item:focus-visible, .settings-jump-link:hover, .toplist-jump-link:hover, .topbar-history[aria-expanded="true"] {
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
  .search-history-clear:hover, .search-history-clear:focus-visible, .comment-edit:hover, .comment-edit:focus-visible, .search-history-edit:hover, .search-history-edit:focus-visible {
    color: var(--color-fg);
    text-decoration-line: underline;
  }
  .draft-note, .tag-menu-error, .torrent-filter-note {
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-row);
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
    text-transform: uppercase;
    font-size: var(--text-micro);
    font-weight: 600;
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
  .settings-jump::-webkit-scrollbar, .toplist-jump::-webkit-scrollbar, .topbar-tabs::-webkit-scrollbar, .favorites-tabs::-webkit-scrollbar, .topbar-search-submit-icon {
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
  .topbar-filters, .filters[open] {
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
    flex-shrink: 0;
    align-items: center;
    border-radius: var(--radius-control);
    background-color: var(--color-parchment);
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-extrabold);
    font-weight: var(--font-weight-extrabold);
    --tw-tracking: 0.08em;
    letter-spacing: 0.08em;
    color: var(--color-burgundy);
    text-decoration-line: none;
    height: 32px;
    padding-inline: 12px;
  }
  .topbar-search {
    display: flex;
    max-width: 760px;
    min-width: 0px;
    flex: 1;
    align-items: center;
    border-radius: var(--radius-control);
    background-color: var(--color-panel);
    height: 32px;
    padding-left: 10px;
    border: 1px solid var(--color-line-strong);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    font-size: var(--text-body);
    color: var(--color-fg);
    --tw-outline-style: none;
    outline-style: none;
    padding-inline: 10px;
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
    background-color: var(--color-canvas);
    font-size: var(--text-micro);
    color: var(--color-muted);
    padding-inline: 5px;
    border: 1px solid var(--color-line);
    font-family: inherit;
  }
  .fact-row {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 0.5);
  }
  .fact-label {
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fact-value {
    font-size: var(--text-body);
    font-weight: 600;
  }
  .topbar-kbd {
    margin-right: var(--spacing);
  }
  .topbar-search-submit {
    cursor: pointer;
    border-radius: var(--radius-control);
    border-style: var(--tw-border-style);
    border-width: 0px;
    font-size: var(--text-meta);
    margin-right: 4px;
    height: 24px;
    padding-inline: 10px;
    font-weight: 600;
    transition: color 0.15s, background-color 0.15s;
  }
  .topbar-clear, .topbar-history {
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
    --tw-tracking: -0.01em;
    letter-spacing: -0.01em;
    font-weight: 600;
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
    font-size: var(--text-meta);
    color: var(--color-muted);
    padding: 2px 8px;
    border: 1px solid var(--color-line-strong);
  }
  .search-filters, .cat-row {
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
    background-color: var(--color-panel);
    border: 1px solid var(--color-line-strong);
  }
  .term-chip.is-excluded {
    border-color: color-mix(in srgb, #a8323a 70%, #5f646e);
    @supports (color: color-mix(in lab, red, red)) {
      border-color: color-mix(in srgb, var(--color-accent) 70%, var(--color-line-strong));
    }
  }
  .term-chip.is-or, .tag-chip.is-added.is-or {
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
  .term-toggle:hover, .search-filters-clear:hover, .filters-summary:hover, .settings-jump-link[aria-current], .toplist-jump-link[aria-current] {
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
    font-size: var(--text-micro);
    text-transform: uppercase;
    padding: 1px 4px;
    border: 1px solid;
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
    font-weight: 600;
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
    color: var(--color-fg);
    font-weight: 600;
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
  .tag-combobox-count, .fav-name {
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
  .tag-combobox-hints, .card-artist {
    color: var(--color-muted);
  }
  .tag-combobox-exclude {
    cursor: pointer;
    border-radius: 0;
    background-color: transparent;
    font-size: var(--text-micro);
    color: var(--color-muted);
    min-height: 24px;
    padding: 2px 8px;
    border: 1px solid var(--color-line-strong);
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
  .cat-chip {
    padding-inline: 12px;
    transition: opacity 0.15s;
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
    background-color: var(--color-panel);
    color: var(--color-muted);
    padding-inline: 12px;
    border: 1px solid var(--color-line-strong);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    background-color: transparent;
    color: var(--color-muted);
    margin-left: 2px;
    padding-inline: 10px;
    border: 1px dashed var(--color-line-strong);
  }
  .quick-tag-edit:hover, .tag-chip:hover {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .quick-tag-editor-panel {
    max-width: calc(100vw - 2rem);
  }
  .quick-tag-editor {
    display: flex;
    width: 460px;
    max-width: 100%;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    padding: calc(var(--spacing) * 3);
    font-size: var(--text-control);
  }
  .quick-tag-editor-title {
    margin: 0px;
    color: var(--color-fg);
    font-weight: 600;
  }
  .quick-tag-editor-hint {
    margin: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .quick-tag-list {
    display: flex;
    max-height: 320px;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    overflow-y: auto;
  }
  .quick-tag-row {
    display: grid;
    grid-template-columns: minmax(72px,0.7fr) minmax(0,1.6fr) auto;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .quick-tag-input {
    width: 100%;
    padding-inline: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
  }
  .quick-tag-remove {
    height: calc(var(--spacing) * 6);
    width: calc(var(--spacing) * 6);
    font-size: var(--text-control);
  }
  .quick-tag-editor-actions {
    margin-top: var(--spacing);
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .quick-tag-editor-spacer {
    flex: 1;
  }
  .filters {
    width: fit-content;
    border-radius: var(--radius-control);
    background-color: var(--color-surface);
    border: 1px solid var(--color-line);
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
  .filters-active {
    min-width: 0px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-normal);
    font-weight: var(--font-weight-normal);
    color: var(--color-muted);
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
    background-color: var(--color-canvas);
    font-size: var(--text-control);
    color: var(--color-fg);
    padding-inline: 10px;
    border: 1px solid var(--color-field-line);
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
  .filters-native, .settings-native, .pager-info, .pager-jump-label {
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
    background-color: var(--color-panel);
    border: 1px solid var(--color-line);
    transition: border-color 0.15s, transform 0.15s;
    content-visibility: auto;
    contain-intrinsic-size: auto 460px;
  }
  .card:hover {
    border-color: var(--color-line-strong);
    transform: translateY(-2px);
  }
  .card-cover-wrap {
    position: relative;
    overflow: hidden;
  }
  .card-cover {
    display: block;
    background-color: var(--color-canvas);
  }
  .card-cover img, .gallery-cover img {
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
    border-radius: 0;
    top: 8px;
    right: 8px;
    padding: 6px;
    background: var(--scrim-control);
  }
  .card-cover-wrap .fav-label {
    display: none;
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px 12px;
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
    font-weight: 600;
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
    --tw-gradient-position: to bottom in oklab;
    background-image: linear-gradient(var(--tw-gradient-stops));
    --tw-gradient-from: var(--color-panel);
    --tw-gradient-to: var(--color-surface);
    --tw-gradient-stops: var(--tw-gradient-via-stops, var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-to) var(--tw-gradient-to-position));
    padding: calc(var(--spacing) * 5);
    border: 1px solid var(--color-line);
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
    background-color: var(--color-surface);
    border: 1px solid var(--color-line-strong);
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
    --tw-tracking: -0.01em;
    letter-spacing: -0.01em;
    color: var(--color-fg);
    font-weight: 600;
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
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-medium);
    font-weight: var(--font-weight-medium);
    padding: 2px 8px;
    border: 1px solid;
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
    color: var(--color-fg);
    font-weight: 600;
  }
  .gallery-actions {
    margin-top: calc(var(--spacing) * 5);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2.5);
  }
  .btn {
    font-size: var(--text-body);
    white-space: nowrap;
    text-decoration-line: none;
    height: 32px;
    padding-inline: 14px;
    font-weight: 600;
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
    font-size: var(--text-control);
    height: 28px;
    padding-inline: 12px;
  }
  .btn.is-disabled, .btn:disabled {
    pointer-events: none;
    opacity: 40%;
  }
  .btn:disabled {
    cursor: not-allowed;
  }
  .fav-btn {
    max-width: 100%;
    overflow: hidden;
    font-size: var(--text-body);
    white-space: nowrap;
    color: var(--color-muted);
    height: 32px;
    padding-inline: 12px;
    font-weight: 600;
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
    padding-block: calc(var(--spacing) * 5);
    border-bottom: 1px solid var(--color-line);
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
    background-color: var(--color-panel);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    padding: 4px 10px;
    border: 1px solid;
    border-color: var(--ns-color, var(--color-line));
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
      font-size: var(--text-control);
      color: var(--color-muted);
      border: 1px solid;
      border-left-width: 0;
      background: var(--color-panel);
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
    gap: 4px;
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
    font-size: var(--text-control);
    text-decoration-line: none;
    height: 28px;
    padding-inline: 12px;
  }
  .pager-nums {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--spacing);
  }
  .pager-num {
    min-width: calc(var(--spacing) * 7);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    height: 28px;
    padding-inline: 8px;
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
    overflow-x: auto;
    background-color: var(--color-surface);
    font-size: var(--text-meta);
    color: var(--color-muted);
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid var(--color-line);
    top: var(--topbar-h, 0px);
    border-radius: var(--radius-card);
  }
  .settings-jump-link, .toplist-jump-link {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    border-radius: var(--radius-row);
    text-decoration-line: none;
    height: 24px;
    padding-inline: 8px;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    background: var(--color-danger);
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
    background-color: var(--color-danger-surface);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2.5);
    font-size: var(--text-control);
    --tw-leading: var(--leading-relaxed);
    line-height: var(--leading-relaxed);
    color: var(--color-danger-text);
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    border: 1px solid var(--color-danger-line);
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
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 4);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-fg);
    opacity: 0%;
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    border: 1px solid var(--color-line-strong);
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
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 8);
    text-align: center;
    border: 1px solid var(--color-line-strong);
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
    color: var(--color-fg);
    font-weight: 600;
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
    .topbar-kbd, .tag-combobox-hints {
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
    .topbar-search-submit-label, .search-filters::-webkit-scrollbar, .gallery-meta .meta-dot + .meta-dot::before {
      display: none;
    }
    .topbar-search-submit-icon {
      display: inline-flex;
    }
    .search-filters {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
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
  .pager-jump {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1.5);
  }
  .pager-jump-input {
    height: calc(var(--spacing) * 7);
    width: calc(var(--spacing) * 16);
    padding-inline: calc(var(--spacing) * 2);
  }
  .pager-seek-input {
    width: calc(var(--spacing) * 32);
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
    color: var(--color-fg);
    font-weight: 600;
  }
  .search-history-heading {
    margin: 0px;
    margin-top: var(--spacing);
  }
  .search-history-list {
    display: grid;
    gap: var(--spacing);
  }
  .search-history-quick-tag {
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
    background-color: var(--color-canvas);
    text-align: left;
    font-size: var(--text-control);
    color: var(--color-fg);
    gap: 2px;
    padding: 4px 8px;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-row);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    font-weight: 600;
  }
  .search-history-text {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .search-history-remove {
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
  .search-history-clear {
    align-self: flex-start;
  }
  .search-history-empty {
    margin: 0px;
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  @media (forced-colors: active) {
    .btn, .fav-btn, .pager-btn, .pager-num, .cat-chip, .term-toggle, .tag-chip, .card, .gallery-header, .settings-section, .comment, .topbar-search, .field-input, .field-select, .eh-popover, .tag-menu-color, .pager-jump-input {
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
    .eh-popover {
      background: Canvas;
      color: CanvasText;
      box-shadow: none;
    }
    .card-posted.is-favorite, .comment-score, .comment-votes, :focus-visible {
      outline: 2px solid CanvasText;
      outline-offset: 2px;
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
    background-color: var(--color-surface);
    padding: 12px 16px;
    border: 1px solid var(--color-line);
    scroll-margin-top: var(--sticky-reading-line, 96px);
    border-radius: var(--radius-card);
  }
  .settings-title {
    margin: 0px;
    padding-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-section);
    --tw-font-weight: var(--font-weight-bold);
    font-weight: var(--font-weight-bold);
    color: var(--color-fg);
    border-bottom: 1px solid var(--color-line);
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
    color: var(--color-fg);
    font-weight: 600;
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
    cursor: pointer;
    align-items: flex-start;
    border-radius: var(--radius-row);
    font-size: var(--text-control);
    color: var(--color-muted);
    min-height: 28px;
    gap: 8px;
    padding: 4px 8px;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    background-color: var(--color-canvas);
    padding: 12px 4px;
    border-top: 1px solid var(--color-line);
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
    color: var(--color-danger-text);
    font-weight: 600;
  }
  .settings-dirty {
    font-size: var(--text-meta);
    color: var(--color-accent-text);
    font-weight: 600;
  }
  .settings-panel-group {
    margin-top: calc(var(--spacing) * 4);
    padding-top: calc(var(--spacing) * 3);
    border-top: 1px solid var(--color-line);
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
    font-weight: 600;
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
    background-color: var(--color-surface);
    padding: calc(var(--spacing) * 4);
    border: 1px solid var(--color-line);
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
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 3);
    border: 1px solid var(--color-line);
    scroll-margin-top: var(--sticky-reading-line, 96px);
  }
  .toplist-section-title {
    margin-bottom: calc(var(--spacing) * 2);
    padding-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-body);
    color: var(--color-fg);
    border-bottom: 1px solid var(--color-line);
    font-weight: 600;
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
    border-radius: var(--radius-row);
    font-size: var(--text-control);
    gap: 8px;
    padding: 2px 6px;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
  }
  .toplist-row:hover {
    background-color: var(--color-panel-hover);
  }
  .toplist-rank {
    width: calc(var(--spacing) * 7);
    flex-shrink: 0;
    text-align: right;
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
    font-weight: 600;
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
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
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
  .archive-funds {
    margin-top: calc(var(--spacing) * 3);
    margin-bottom: 0px;
    border-radius: var(--radius-row);
    background-color: var(--color-surface);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
    border: 1px solid var(--color-line);
  }
  .archive-options {
    margin-top: calc(var(--spacing) * 4);
    display: grid;
    gap: calc(var(--spacing) * 4);
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
  .archive-option {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 3);
    border-radius: var(--radius-card);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 4);
    border: 1px solid var(--color-line-strong);
  }
  .archive-option-title {
    margin: 0px;
    font-size: var(--text-title-2);
    font-weight: 600;
  }
  .archive-option-meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: calc(var(--spacing) * 8);
    row-gap: calc(var(--spacing) * 2);
  }
  .archive-option-note {
    margin: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .archive-option-status {
    margin: 0px;
    min-height: calc(var(--spacing) * 5);
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .archive-option-status[role="alert"] {
    color: var(--color-danger-text);
  }
  .archive-option .archive-download {
    align-self: flex-start;
  }
  .archive-links {
    margin-top: calc(var(--spacing) * 5);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 4);
    font-size: var(--text-control);
  }
  .archive-footer {
    margin-top: calc(var(--spacing) * 8);
    padding-top: calc(var(--spacing) * 4);
    border-top: 1px solid var(--color-line);
  }
  @media (max-width: 720px) {
    .archive-option-meta {
      column-gap: calc(var(--spacing) * 5);
    }
  }
  .torrent-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: calc(var(--spacing) * 5);
    row-gap: calc(var(--spacing) * 2);
    padding-top: calc(var(--spacing) * 2.5);
    padding-bottom: calc(var(--spacing) * 4);
    border-bottom: 1px solid var(--color-line);
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
    background-color: var(--color-surface);
    border: 1px solid var(--color-line);
    -webkit-overflow-scrolling: touch;
  }
  .torrent-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-control);
    min-width: 620px;
  }
  .torrent-table thead th {
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    --tw-tracking: var(--tracking-wide);
    letter-spacing: var(--tracking-wide);
    color: var(--color-muted);
    text-transform: uppercase;
    border-bottom: 1px solid var(--color-line-strong);
    font-weight: 600;
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
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    text-align: left;
    vertical-align: middle;
    border-bottom: 1px solid var(--color-line);
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
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
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
    .torrent-added::before, .torrent-gallery::before, .torrent-uploader::before, .torrent-size::before, .torrent-seeds::before, .torrent-peers::before, .torrent-downloads::before {
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
    min-width: 132px;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
    border-radius: var(--radius-control);
    background-color: var(--color-panel);
    font-size: var(--text-control);
    color: var(--color-fg);
    text-decoration-line: none;
    height: 32px;
    padding-inline: 12px;
    border: 1px solid var(--color-line);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
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
    font-weight: 600;
  }
  .favorites-tab-count {
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
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
    display: flex;
    cursor: pointer;
    align-items: center;
    border-radius: var(--radius-row);
    top: 8px;
    left: 8px;
    padding: 6px;
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
    padding-left: calc(var(--spacing) * 2);
    font-size: var(--text-meta);
    color: var(--color-muted);
    border-left: 2px solid var(--color-line-strong);
  }
  .favorites-bulk {
    position: fixed;
    left: calc(1 / 2 * 100%);
    z-index: 60;
    display: flex;
    max-width: calc(100vw - 2rem);
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-card);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    --tw-shadow: 0 18px 50px var(--tw-shadow-color, rgb(0 0 0 / 0.55));
    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
    bottom: max(1rem, env(safe-area-inset-bottom));
    border: 1px solid var(--color-line-strong);
    transform: translateX(-50%);
  }
  .favorites-bulk-count {
    padding-inline: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-fg);
    font-weight: 600;
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
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
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
  .favorites-delete, .favorites-delete:hover {
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
  .rating-label, .comment-status {
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .rating-count, .comment-posted {
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .tag-menu-panel {
    width: 240px;
    padding: calc(var(--spacing) * 3);
  }
  .tag-menu, .comment-list {
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
    color: var(--color-fg);
    font-weight: 600;
  }
  .tag-menu-ns {
    font-size: var(--text-micro);
    color: var(--color-muted);
    text-transform: lowercase;
  }
  .tag-menu-divider {
    margin: 0px;
    border: 0;
    border-top: 1px solid var(--color-line);
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
  .tag-title, .comments-title {
    font-size: var(--text-section);
    color: var(--color-fg);
    font-weight: 600;
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
    padding-top: calc(var(--spacing) * 5);
    padding-bottom: calc(var(--spacing) * 10);
    border-top: 1px solid var(--color-line);
  }
  .comment {
    border-radius: var(--radius-control);
    background-color: var(--color-surface);
    padding: calc(var(--spacing) * 3);
    border: 1px solid var(--color-line);
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
    font-weight: 600;
  }
  .comment-badge {
    border-radius: 0;
    font-size: var(--text-micro);
    color: var(--color-star);
    padding: 1px 6px;
    border: 1px solid var(--color-accent);
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
    color: var(--color-muted);
    font-weight: 600;
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
    color: var(--color-link);
    text-decoration-line: underline;
    font-weight: 600;
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
  .comment-composer, .comment-edit-form {
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
  .comment-edit-form .comment-input {
    width: 100%;
  }
  .tag-menu-color {
    height: calc(var(--spacing) * 7);
    width: calc(var(--spacing) * 10);
    cursor: pointer;
    background-color: var(--color-canvas);
    padding: calc(var(--spacing) * 0.5);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-control);
  }
  .gallery-torrents {
    margin-inline: auto;
    width: 100%;
    max-width: 900px;
    padding-bottom: calc(var(--spacing) * 10);
  }
  .gallery-torrents-back {
    margin-top: calc(var(--spacing) * 3);
    display: inline-flex;
    align-items: center;
    font-size: var(--text-control);
    color: var(--color-link);
    text-decoration-line: none;
  }
  .gallery-torrents-back:hover {
    text-decoration-line: underline;
  }
  .gallery-torrent-list {
    margin-top: calc(var(--spacing) * 4);
    display: grid;
    gap: calc(var(--spacing) * 3);
  }
  .gallery-torrent-card {
    border-radius: var(--radius-card);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 3.5);
    border: 1px solid var(--color-line);
  }
  .gallery-torrent-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    column-gap: calc(var(--spacing) * 3);
    row-gap: calc(var(--spacing) * 2);
  }
  .gallery-torrent-name {
    min-width: 0px;
    font-size: var(--text-control);
    overflow-wrap: break-word;
    color: var(--color-fg);
    text-decoration-line: none;
    font-weight: 600;
  }
  a.gallery-torrent-name:hover {
    color: var(--color-link);
    text-decoration-line: underline;
  }
  .gallery-torrent-details-button {
    flex-shrink: 0;
  }
  .gallery-torrent-meta {
    margin-top: calc(var(--spacing) * 2);
    display: flex;
    flex-wrap: wrap;
    column-gap: calc(var(--spacing) * 4);
    row-gap: var(--spacing);
    font-size: var(--text-meta);
  }
  .gallery-torrent-meta-item {
    flex-direction: row;
    align-items: baseline;
    gap: var(--spacing);
  }
  .gallery-torrent-meta-item .fact-label {
    font-size: var(--text-meta);
    --tw-tracking: var(--tracking-normal);
    letter-spacing: var(--tracking-normal);
    text-transform: none;
  }
  .gallery-torrent-meta-item .fact-value {
    font-size: var(--text-meta);
    --tw-font-weight: var(--font-weight-normal);
    font-weight: var(--font-weight-normal);
    color: var(--color-fg);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
  }
  .gallery-torrent-details {
    margin-top: calc(var(--spacing) * 3);
    padding-top: calc(var(--spacing) * 3);
    border-top: 1px solid var(--color-line);
  }
  .gallery-torrent-info {
    display: grid;
    gap: calc(var(--spacing) * 2);
  }
  .gallery-torrent-info-row {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: calc(var(--spacing) * 2);
    row-gap: var(--spacing);
  }
  .gallery-torrent-info-row .fact-label {
    font-size: var(--text-control);
    --tw-tracking: var(--tracking-normal);
    letter-spacing: var(--tracking-normal);
    text-transform: none;
  }
  .gallery-torrent-info-row .fact-value {
    font-size: var(--text-control);
    --tw-font-weight: var(--font-weight-normal);
    font-weight: var(--font-weight-normal);
  }
  .gallery-torrent-info-link {
    color: var(--color-link);
  }
  .gallery-torrent-info-unavailable {
    color: var(--color-muted);
  }
  .gallery-torrent-comments {
    margin-top: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    white-space: pre-line;
    color: var(--color-muted);
  }
  .gallery-torrent-error {
    font-size: var(--text-control);
    color: var(--color-danger-text);
  }
  .gallery-torrent-loading {
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  @media (max-width: 720px) {
    .gallery-torrent-card {
      padding: calc(var(--spacing) * 3);
    }
    .gallery-torrent-head {
      flex-direction: column;
      align-items: stretch;
    }
    .gallery-torrent-details-button {
      align-self: flex-start;
    }
  }
  .home-nav {
    margin-bottom: calc(var(--spacing) * 4);
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 1.5);
  }
  .home-nav-link {
    border-radius: 0;
    background-color: var(--color-panel);
    font-size: var(--text-meta);
    color: var(--color-muted);
    text-decoration-line: none;
    padding: 4px 8px;
    border: 1px solid var(--color-line-strong);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
  }
  .home-nav-link:hover {
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .home-nav-link.is-active {
    border-color: var(--color-accent);
    background-color: var(--color-accent);
    color: var(--color-fg);
  }
  .home-sections {
    display: grid;
    grid-template-columns: repeat(auto-fill,minmax(290px,1fr));
    align-items: flex-start;
    gap: calc(var(--spacing) * 4);
    padding-bottom: calc(var(--spacing) * 6);
  }
  .home-section {
    display: flex;
    min-width: 0px;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    border-radius: var(--radius-card);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 4);
    border: 1px solid var(--color-line);
  }
  .home-section-title {
    margin: 0px;
    padding-bottom: calc(var(--spacing) * 2);
    font-size: var(--text-body);
    color: var(--color-fg);
    border-bottom: 1px solid var(--color-line);
    font-weight: 600;
  }
  .home-text {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 1.5);
  }
  .home-text-line {
    margin: 0px;
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .home-facts {
    margin: 0px;
    display: grid;
    gap: var(--spacing);
  }
  .home-fact {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
    font-size: var(--text-control);
  }
  .home-fact dt {
    min-width: 0px;
    color: var(--color-muted);
  }
  .home-fact dd {
    margin: 0px;
    flex-shrink: 0;
    color: var(--color-fg);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
    font-weight: 600;
  }
  .home-links {
    display: flex;
    flex-wrap: wrap;
    column-gap: calc(var(--spacing) * 3);
    row-gap: var(--spacing);
  }
  .home-link {
    font-size: var(--text-control);
    color: var(--color-accent-text);
    text-decoration-line: none;
  }
  .home-link:hover {
    text-decoration-line: underline;
  }
  .home-action {
    margin-top: var(--spacing);
    align-self: flex-start;
  }
  .my-tags-page {
    margin-top: calc(var(--spacing) * 4);
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 4);
  }
  .my-tags-toolbar, .my-tags-add-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: calc(var(--spacing) * 3);
  }
  .my-tags-filter-field, .my-tags-name-field {
    width: 220px;
    max-width: 100%;
  }
  .my-tags-filter, .my-tags-name-field .field-input, .my-tags-weight-field .field-input, .my-tags-tagset-name-field .field-input, .my-tags-tagset-color-field .field-input {
    width: 100%;
  }
  .my-tags-count {
    font-size: var(--text-control);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
  }
  .my-tags-readonly {
    margin: 0px;
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    font-size: var(--text-control);
    color: var(--color-muted);
    border: 1px solid var(--color-line);
  }
  .my-tags-native {
    margin-left: var(--spacing);
    color: var(--color-accent-text);
  }
  .my-tags-add, .my-tags-row {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
    background-color: var(--color-panel);
    padding: calc(var(--spacing) * 3);
    border: 1px solid var(--color-line);
  }
  .my-tags-add-title {
    margin: 0px;
    font-size: var(--text-section);
    color: var(--color-fg);
    font-weight: 600;
  }
  .my-tags-hint {
    margin: 0px;
    font-size: var(--text-meta);
    color: var(--color-muted);
  }
  .my-tags-add-actions {
    display: flex;
  }
  .my-tags-list {
    display: flex;
    flex-direction: column;
    gap: calc(var(--spacing) * 2);
  }
  .my-tags-row-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: calc(var(--spacing) * 2);
  }
  .my-tags-row-name {
    font-size: var(--text-control);
    color: var(--color-fg);
    font-weight: 600;
  }
  .my-tags-row-state {
    font-size: var(--text-meta);
    color: var(--color-muted);
    --tw-numeric-spacing: tabular-nums;
    font-variant-numeric: var(--tw-ordinal, ) var(--tw-slashed-zero, ) var(--tw-numeric-figure, ) var(--tw-numeric-spacing, ) var(--tw-numeric-fraction, );
  }
  .my-tags-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: calc(var(--spacing) * 3);
    font-size: var(--text-control);
    color: var(--color-fg);
  }
  .my-tags-weight-field {
    width: 84px;
  }
  .my-tags-color {
    height: calc(var(--spacing) * 8);
    width: calc(var(--spacing) * 12);
    cursor: pointer;
    border-radius: var(--radius-control);
    background-color: var(--color-canvas);
    padding: calc(var(--spacing) * 0.5);
    border: 1px solid var(--color-field-line);
  }
  .my-tags-color:disabled {
    cursor: not-allowed;
    opacity: 40%;
  }
  .my-tags-row-actions {
    display: flex;
    justify-content: flex-end;
  }
  .my-tags-error, .my-tags-tagset-error {
    margin: 0px;
    font-size: var(--text-control);
    color: var(--color-danger-text);
  }
  .my-tags-empty, .my-tags-no-match {
    margin: 0px;
    font-size: var(--text-control);
    color: var(--color-muted);
  }
  .my-tags-tagsets {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 1.5);
  }
  .my-tags-tagset-link {
    border-radius: var(--radius-control);
    background-color: var(--color-panel);
    padding-inline: calc(var(--spacing) * 2.5);
    padding-block: var(--spacing);
    font-size: var(--text-control);
    color: var(--color-muted);
    text-decoration-line: none;
    border: 1px solid var(--color-line);
  }
  .my-tags-tagset-link:hover {
    border-color: var(--color-accent);
    color: var(--color-fg);
  }
  .my-tags-tagset-link[aria-current="page"] {
    border-color: var(--color-accent);
    background-color: var(--color-panel-hover);
    color: var(--color-fg);
  }
  .my-tags-tagset-form {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: calc(var(--spacing) * 3);
  }
  .my-tags-tagset-name-field, .my-tags-tagset-color-field {
    margin-top: 0px;
    width: 220px;
    max-width: 100%;
  }
  .my-tags-tagset-color-field {
    width: 140px;
  }
  .my-tags-tagset-enable-field {
    min-height: calc(var(--spacing) * 8);
    align-items: center;
    padding-inline: 0px;
  }
  .my-tags-tagset-actions {
    margin-top: calc(var(--spacing) * 3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--spacing) * 2);
  }
  @media (max-width: 720px) {
    .my-tags-filter-field, .my-tags-name-field, .my-tags-tagset-name-field, .my-tags-tagset-color-field {
      width: 100%;
    }
    .my-tags-add-fields, .my-tags-tagset-actions {
      align-items: stretch;
    }
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
  @supports ((-webkit-hyphens: none) and (not (margin-trim: block))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {
    *, ::before, ::after, ::backdrop {
      --tw-border-style: solid;
      --tw-font-weight: initial;
      --tw-tracking: initial;
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
      --tw-translate-x: 0;
      --tw-translate-y: 0;
      --tw-translate-z: 0;
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
body.no-cursor #reader,
body.no-cursor #reader * {
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
#main-img.no-transition,
#img-wrap.no-transition,
#spread-img.no-transition,
.reader-page-img.no-transition {
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
.img-error-retry:hover,
.img-error-native:hover {
  border-color: var(--color-accent);
}

.img-error-native {
  display: inline-flex;
  align-items: center;
  height: var(--control-h);
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-control);
  background: var(--color-panel);
  color: var(--color-fg);
  font-size: var(--text-control);
  font-weight: 600;
  text-decoration: none;
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

/* Every element the reader hides with \`hidden\`. Tailwind's preflight hides them today through a
   layered \`[hidden] { display: none !important }\`, but this sheet is injected unlayered and outside
   the Tailwind pipeline, so no \`display\` it adds later can be allowed to depend on a generated
   base layer. */
#img-wrap[hidden],
#continuous[hidden],
#spread-img[hidden],
#hud-help[hidden],
#img-error[hidden],
.img-error-retry[hidden] {
  display: none !important;
}

#img-wrap {
  transition: transform 0.1s ease-out;
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
  body.fit-h.reader-spread #main-img,
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
  /*
   * Isolate each page's layout from the ones around it. Paint containment is deliberately absent:
   * the zoom controller scales \`.reader-page-img\`, which has to paint outside this box, and
   * \`contain: paint\` would clip the zoomed artwork.
   */
  contain: layout;
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
  body.no-cursor #reader,
  body.no-cursor #reader * {
    cursor: auto !important;
  }

  :focus-visible {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
`;

  // src/ui/styles.ts
  var APP_STYLE_ATTRIBUTE = "data-better-eh";
  var APP_STYLE_SENTINEL = "/* better-eh-style */";
  var injected = false;
  function injectStyles() {
    if (injected) {
      return;
    }
    injected = true;
    const style = GM_addStyle(APP_STYLE_SENTINEL + style_default + app_default);
    if (style !== undefined) {
      style.setAttribute(APP_STYLE_ATTRIBUTE, "");
    }
  }
  function isAppStyle(node) {
    return node.getAttribute(APP_STYLE_ATTRIBUTE) !== null || node.textContent.includes(APP_STYLE_SENTINEL);
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

  // src/app-shell.ts
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
  function createAppShell(env) {
    const doc = env.document;
    const viewWindow = env.window;
    const { routeView } = env.views;
    let viewHost = null;
    let navController = null;
    let navId = 0;
    let hiding = true;
    let stopScrollRestore = null;
    let stopNativeErrorGuard = null;
    let stopSiteAds = null;
    function historyState() {
      const state = env.history.state;
      return typeof state === "object" && state !== null ? state : {};
    }
    function restoreScroll(y) {
      stopScrollRestore?.();
      const controller = new AbortController;
      let stopped = false;
      let stopRestore = () => {
        return;
      };
      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        stopRestore();
        controller.abort();
        if (stopScrollRestore === stop) {
          stopScrollRestore = null;
        }
      };
      stopRestore = restoreScrollWhenReady(y, {
        advance: advancePage,
        scrollTo: (target) => viewWindow.scrollTo(0, target),
        scrollY: () => viewWindow.scrollY,
        scrollHeight: () => doc.documentElement.scrollHeight,
        frame: (callback) => viewWindow.requestAnimationFrame(callback),
        cancelFrame: (handle) => viewWindow.cancelAnimationFrame(handle),
        onDone: stop
      });
      const isStopped = () => stopped;
      if (isStopped()) {
        return stop;
      }
      const options = {
        once: true,
        passive: true,
        signal: controller.signal
      };
      viewWindow.addEventListener("wheel", stop, options);
      viewWindow.addEventListener("touchstart", stop, options);
      viewWindow.addEventListener("pointerdown", stop, options);
      viewWindow.addEventListener("keydown", stop, options);
      stopScrollRestore = stop;
      return stop;
    }
    const lifecycle = createViewLifecycle({
      host: () => viewHost,
      closePanels: closeFavoriteMenu,
      resetViewMode,
      trackSticky: trackStickyChrome,
      scrollTo: (y) => viewWindow.scrollTo(0, y),
      restoreScroll
    });
    function hideDocument() {
      const apply = () => {
        if (!hiding) {
          return;
        }
        const root = doc.documentElement;
        if (!root) {
          env.setTimeout(apply, 0);
          return;
        }
        root.style.setProperty("visibility", "hidden", "important");
        root.style.setProperty("background", "#34353b", "important");
      };
      apply();
    }
    function guardAgainstNativeImageErrors() {
      const guard = (event) => {
        const target = event.target;
        if (target instanceof Element && target.localName === "img" && (target.getAttribute("onerror") ?? "").includes("nl(")) {
          event.stopImmediatePropagation();
        }
      };
      viewWindow.addEventListener("error", guard, true);
      stopNativeErrorGuard = () => {
        viewWindow.removeEventListener("error", guard, true);
        stopNativeErrorGuard = null;
      };
    }
    function isNativeHandler(handler, marker) {
      return typeof handler === "function" && handler.toString().includes(marker);
    }
    function detachNativePage() {
      if (isNativeHandler(viewWindow.onresize, "update_window_extents")) {
        viewWindow.onresize = null;
      }
      if (isNativeHandler(viewWindow.onpopstate, "apply_json_state")) {
        viewWindow.onpopstate = null;
      }
      if (isNativeHandler(doc.onkeydown, "holdingOverrideKey")) {
        doc.onkeydown = null;
      }
      if (isNativeHandler(doc.onkeyup, "holdingOverrideKey")) {
        doc.onkeyup = null;
      }
      for (const image of doc.querySelectorAll("#i3 img, #img")) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
      }
    }
    function revealDocument() {
      hiding = false;
      stopNativeErrorGuard?.();
      const root = doc.documentElement;
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
      for (const node of doc.head.querySelectorAll('link[rel="stylesheet"], style')) {
        if (!isAppStyle(node)) {
          node.remove();
        }
      }
      if (!doc.querySelector('meta[name="viewport"]')) {
        doc.head.append(el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }));
      }
      if (!doc.querySelector('link[rel="preconnect"][href="https://ehgt.org"]')) {
        doc.head.append(el("link", { rel: "preconnect", href: "https://ehgt.org", crossorigin: "" }));
      }
      stopNativeErrorGuard?.();
      detachNativePage();
      stopSiteAds?.();
      stopSiteAds = null;
      doc.body.replaceChildren();
      doc.body.className = "eh-body";
      doc.body.removeAttribute("style");
      viewHost = el("main", { id: "eh-view", tabindex: "-1" });
      const root = el("div", { id: "eh-root" }, viewHost);
      const skip = el("a", { class: "eh-skip", href: "#eh-view" }, "Skip to content");
      skip.addEventListener("click", (event) => {
        event.preventDefault();
        viewHost?.focus({ preventScroll: true });
        viewWindow.scrollTo(0, 0);
      });
      doc.body.append(skip, root, el("div", { id: "eh-loading", class: "eh-loading", "aria-hidden": "true" }));
      startLinkInterception(navigate, doc);
      viewWindow.addEventListener("popstate", onPopState);
      registerMenuCommands();
    }
    function setLoading(active) {
      doc.body.classList.toggle("is-loading", active);
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
          transition(route, viewWindow.scrollY, { fresh: true });
        },
        setLeaveGuard: (guard) => {
          lifecycle.setLeaveGuard(guard);
        }
      };
    }
    function present(route, view, data, scrollY, focus = false) {
      lifecycle.mount({
        route,
        title: view.title(data),
        scrollY,
        focus,
        render: (host, signal) => {
          view.render(host, data, viewContext(route, signal), route);
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
      } else if (!env.navigator.onLine) {
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
                  transition(parseRoute(env.location.href, env.url()), null);
                }
              },
              nativePageAction(native)
            ]
          }));
        }
      });
    }
    function saveScroll() {
      env.history.replaceState({ ...historyState(), eh: true, scrollY: viewWindow.scrollY }, "", env.url());
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
        present(route, view, data, scrollY, true);
      } catch (error) {
        if (id !== navId || isAbortError(error)) {
          return;
        }
        if (error instanceof ParseMismatchError) {
          console.error(LOG_TAG, "parse mismatch, opening the native page", error);
          env.location.replace(nativeUrl(route.url));
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
      const route = parseRoute(url, env.url());
      if (!lifecycle.guard()) {
        return;
      }
      if (route.kind === "native") {
        env.location.assign(url);
        return;
      }
      const replace = options.replace === true;
      const prepared = routeView(route).prepare(route, {
        previous: lifecycle.currentRoute(),
        replace,
        previousState: historyState()
      });
      saveScroll();
      const state = { eh: true, scrollY: 0, ...prepared.state };
      if (replace) {
        env.history.replaceState(state, "", prepared.route.url);
      } else {
        env.history.pushState(state, "", prepared.route.url);
      }
      transition(prepared.route, null);
    }
    function onPopState(event) {
      const currentUrl = lifecycle.currentRoute()?.url ?? "";
      const route = parseRoute(env.location.href, env.url());
      if (route.kind === "native") {
        if (!lifecycle.guard()) {
          env.history.pushState(event.state, "", currentUrl);
          return;
        }
        env.location.reload();
        return;
      }
      if (isFragmentOnlyChange(currentUrl, env.location.href)) {
        return;
      }
      if (!lifecycle.guard()) {
        env.history.pushState(event.state, "", currentUrl);
        return;
      }
      const prepared = routeView(route).prepare(route, {
        previous: lifecycle.currentRoute(),
        replace: false,
        previousState: historyState()
      });
      if (prepared.route.url !== env.location.href) {
        env.history.replaceState(event.state, "", prepared.route.url);
      }
      const state = event.state;
      transition(prepared.route, state?.scrollY ?? 0);
    }
    function whenIdle(callback) {
      const idle = Reflect.get(viewWindow, "requestIdleCallback");
      if (idle !== undefined) {
        idle.call(viewWindow, callback);
        return;
      }
      env.setTimeout(callback, 0);
    }
    function startOwned(initialRoute) {
      const view = routeView(initialRoute);
      injectStyles();
      if (isLoginPage(doc)) {
        throw new LoginRequiredError;
      }
      if (isNotFoundPage(doc)) {
        ensureShell();
        errorView(new HttpError(404, env.location.href), initialRoute);
        revealDocument();
        return;
      }
      const initial = view.parse(doc, initialRoute);
      view.seed?.(initialRoute, initial);
      ensureShell();
      env.history.replaceState({ eh: true, scrollY: 0 }, "", env.location.href);
      try {
        present(initialRoute, view, initial, 0, false);
      } catch (error) {
        console.error(LOG_TAG, "initial render failed", error);
        errorView(error, initialRoute);
      }
      revealDocument();
      if (getSettings().tagSuggestions) {
        whenIdle(() => {
          loadTagIndex().catch((error) => log("tag index prefetch failed", error));
        });
      }
      log("ready", getSettings().fitHeight ? "fit-height" : "natural-width");
    }
    return {
      boot() {
        const route = parseRoute(env.url(), env.url());
        if (route.kind === "native") {
          return;
        }
        stopSiteAds = blockSiteAds();
        hideDocument();
        guardAgainstNativeImageErrors();
        const prepared = routeView(route).prepare(route, {
          previous: null,
          replace: true,
          previousState: {}
        });
        if (prepared.bootUrl !== null) {
          env.location.replace(prepared.bootUrl);
          return;
        }
        const start = () => {
          try {
            startOwned(prepared.route);
          } catch (error) {
            console.error(LOG_TAG, "startup failed", error);
            if (error instanceof ParseMismatchError) {
              revealDocument();
              env.location.replace(nativeUrl(env.location.href));
              return;
            }
            if (error instanceof LoginRequiredError) {
              ensureShell();
              errorView(error, prepared.route);
            }
            revealDocument();
          }
        };
        if (doc.readyState === "loading") {
          doc.addEventListener("DOMContentLoaded", start, { once: true });
        } else {
          start();
        }
      }
    };
  }

  // src/app.ts
  var environment = {
    url: () => location.href,
    location,
    history,
    document,
    navigator,
    window,
    setTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
    views: { routeView }
  };
  var shell = createAppShell(environment);
  function boot() {
    shell.boot();
  }

  // src/main.ts
  boot();
})();
