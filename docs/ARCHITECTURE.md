# Architecture

- **`src/app-shell.ts`**: boot, navigation, popstate and error rendering over one injected
  environment (URL, history, document, navigator, window, route views). **`src/app.ts`** supplies
  the browser globals and route table.
- **`src/view-lifecycle.ts`**: the one mount/teardown sequence — abort, panels, view mode, sticky,
  host clear, render, title, scroll — with side effects injected for tests.
- **`src/router.ts`**: route parsing, owned-route detection, link interception.
- **`src/routes/`**: `identity` (path regexes, scope/category tables, native marker) and one
  exhaustive route-view table (`prepare`, `load`, `parse`, `render`, `title`, `invalidate`, `feed`).
  A row prepares its own address (remembered filters, date-cursor redirect, history markers) and
  supplies its append feed, so the shell never names a kind. Document-backed kinds are rows behind
  the shared `documentView` builder; `load` and `parse` share one parse function, and `invalidate`
  drops a cached page after a view mutates it.
- **`src/net/queue.ts`**: priority request scheduler with concurrency and interval limits.
- **`src/net/connection.ts`**: Save-Data/2G detection and data-saver mode, gating the background
  vocabulary download and reader prefetch.
- **`src/net/http.ts`**: response classification (HTML, rate limits, login wall) and the shared
  POST helpers (`postForm`, `postJson`) every site mutation goes through.
- **`src/fetch/`**: one page loader over transport and parser, with document and viewer-page caches,
  LRU eviction, image preloading and prefetch.
- **`src/page-image.ts`**: page image display, retry ladder and give-up handling; one slot factory
  per mount owns the retry limit and abort/currency composition.
- **`src/reader-navigation.ts`**: one adapter per reader mode, carrying movement, HUD state, layout
  switching, click/swipe/keyboard intents and the visible zoom surface.
- **`src/site.ts`**: domains, display name, owned page paths, document-title joining, and the one
  builder for site page and per-gallery popup URLs.
- **`src/parse/`**: `viewer`, `gallery`, `gallery-torrents`, `list`, `favorites`, `toplist`,
  `archive`, `torrents`, `home`, `my-tags`, `uconfig`, `query` (search/tag serialization), `pager`,
  shared title parsing, and `url` (safe URLs, gallery identity/href helpers, the `gid`/token query).
- **`src/data/`**: `favorites` (folder cache, add/remove, bulk delete/move), `gallery-actions`
  (rating, tag and comment votes, comment posts and edits), `archive` (chooser POST),
  `gallery-torrents` (details and personalized links), `list-filters`, `list-date` (the app-owned
  posted-date range and date cursor), `my-tags` (set save/rename, watch/hide/colour/weight, add),
  `search-history`, and `quick-tags`. `gallery-actions` and `my-tags` also declare the transport
  contracts the gallery view and its panels share.
- **`src/tags/`**: `model` (expression grammar, toggling, the sign-presentation table), `db`
  (compact index, popularity attachment, storage cache, download, usage and prefix history, with the
  generated core as the synchronous fallback), `core-vocabulary` (generated from `assets/`),
  `counts` + `tag-counts-codec`, `index-codec`, `mirror` (asset hosts, fetch policy, refresh
  cadence), `base64`, `codec-header` (the magic/version guard both decoders share), and `suggest`.
  `scripts/update-tag-index.ts` and `update-tag-counts.ts` regenerate the remote assets;
  `update-core-vocabulary.ts` regenerates the core and verifies with `--check`; `publish-data.ts`
  lands a scheduled refresh through a pull request, because master only accepts `check` from a run a
  non-`GITHUB_TOKEN` push or PR triggered.
- **`src/search-draft.ts`**: the tab-scoped committed query and free-text draft shared by the list,
  gallery and top bar.
- **`src/store.ts`**: one persistence seam over userscript value and session storage — versioned
  envelope, shape guard, record removal, one failure channel the shell reports; in-memory adapter
  for tests.
- **`src/emitter.ts`**: one listener seam (`subscribe`/`emit`) behind every in-app change.
- **`src/strings.ts`**: string primitives shared below the UI (`collapseWhitespace`), so storage,
  parsers and tag normalization fold whitespace alike.
- **`src/session.ts`**: the signed-in session (member id, login check); the one reader of the
  account cookie.
- **`src/settings-schema.ts`**: the single declaration of every scalar preference (default, control,
  bounds, hint); the store, panel, validation and import/export derive from it.
- **`src/views/`**: `viewer`, `gallery`, `gallery-torrents`, `archive`, `list`, `favorites`,
  `toplist`, `torrents`, `home`, `my-tags` and `settings` render modules; `shell.ts` names the
  viewer shell's element contract. The gallery composes `src/ui/gallery-tag-row.ts` for tags and
  keeps the header, grid and paging.
- **`src/view-mode.ts`**: the one owner of body view-mode classes.
- **`src/ui/`**: DOM helpers (`el`, the non-submitting `buttonEl`, inputs, icons); top bar and site
  tabs; the popover primitive every panel uses, tag combobox included; login gate; filter chips;
  quick-tag buttons and editor; title renderer; favorite popover and state; gallery tag
  row/rating/comments/tag menu; the pending-action protocol; banner/toast; result-card assembly;
  fact rows; form-control and live-region helpers; shared pager and paged-region; empty/error panel;
  sticky chrome measurer; jump row; infinite-scroll sentinel; append-stable card grid; view scaling.
- **`src/tailwind.css` / `src/app.css`**: Tailwind v4 theme and utilities, shared components, and one
  stylesheet per feature (`nav`, `settings`, `toplist`, `torrents`, `gallery-torrents`, `home`,
  `my-tags`, `favorites`, `gallery-actions`, `archive`). Shared recipes (interactive boxes, ghost
  icon buttons, tab/filter active treatment, uppercase eyebrows, scrolling-row fade, settings
  rows/fields, status lines) live in `app.css`; a feature sheet adds only its differences.
- **`src/style.css`**: viewer-only styles, injected unlayered beside the compiled Tailwind output
  (see `src/ui/styles.ts`), so the reader outranks the layered app. Every selector must stay
  viewer-scoped (`#id`, `body.<state>`, `reader-`/`hud-`/`img-error-`/`page-nav-` classes), and any
  element whose `display` it sets hides through `[hidden]` rather than preflight.
- **`src/settings.ts` / `src/keymap.ts` / `src/log.ts` / `src/menu.ts`**: settings store, key
  bindings, debug logging, menu commands.
