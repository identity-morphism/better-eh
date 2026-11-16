# Architecture

- **`src/app.ts`**: boot, shell, history, loading/error states; every path mounts through the
  view-lifecycle module.
- **`src/view-lifecycle.ts`**: the one mount/teardown sequence (abort, panels, view mode, sticky,
  host clear, render, title, scroll) with its side effects injected for tests.
- **`src/router.ts`**: route parsing, owned-route detection, link interception.
- **`src/routes/`**: one exhaustive table of route views (`load`, `parse`, `render`, `title`). Six
  kinds are rows of `parse`/`render`/`title` data behind the shared `documentView` builder, so
  adding a document kind is one table row; `load` and `parse` share one parse function.
- **`src/net/queue.ts`**: priority request scheduler with concurrency/interval limits.
- **`src/net/http.ts`**: response classification (HTML bodies, rate-limit notices, login wall) and
  the shared POST helpers (`postForm`, `postJson`) every site mutation goes through.
- **`src/fetch/`**: page-fetch: one loader over transport and parser, with document and viewer-page
  caches, LRU eviction, image preloading and prefetch.
- **`src/page-image.ts`**: page image display, retry ladder, and give-up handling.
- **`src/parse/`**: `viewer`, `gallery`, `list`, `favorites`, `toplist`, `torrents`, `uconfig`,
  `query` (search/tag serialization), `pager` (the shared numeric pager), and shared title parsing.
- **`src/data/`**: `favorites` (folder cache, add/remove, bulk delete/move), `gallery-actions`
  (rating, tag votes, comment votes, comment posts and edits), `list-filters` (remembered category and
  advanced filters), `search-history` (recent queries), and `saved-expressions` (named searches and
  quick tags, with the one-time legacy migration).
- **`src/tags/`**: `model` (search-expression grammar and tag toggling), `db` (compact index,
  popularity attachment, storage cache, download, usage and prefix-completion history), `counts` +
  `tag-counts-codec` (cached remote popularity and binary decoder), `index-codec` (front-coded
  vocabulary asset), `mirror` (asset hosts, fetch policy and refresh cadence), `base64` (the cached
  payload encoding), and `suggest` (ranking and namespace completion).
  `scripts/update-tag-counts.ts` and `scripts/update-tag-index.ts` regenerate the remote assets from
  their upstream datasets.
- **`src/search-draft.ts`**: the tab-scoped committed query and the free-text draft shared by the
  list, gallery and top bar.
- **`src/store.ts`**: one persistence seam over userscript value storage and session storage —
  versioned envelope, shape guard, swallowed failures; tests use an in-memory adapter.
- **`src/settings-schema.ts`**: the single declaration of every scalar preference (default, control,
  bounds, hint); the settings store, panel, validation and import/export derive from it.
- **`src/views/`**: `viewer`, `gallery`, `list`, `favorites`, `toplist`, `torrents` and `settings`
  render modules; `shell.ts` names the viewer shell's element contract.
- **`src/view-mode.ts`**: the one owner of the body view-mode classes.
- **`src/ui/`**: DOM helpers, top bar and site tabs, popover primitive (every panel, including the
  tag combobox), login gate, active filter chips, quick-tag buttons and editor, parsed title
  renderer, favorite popover, gallery rating/comments/tag menu, banner/toast, the result-card
  assembly, form-control state helpers, live-region helpers, shared pager (prev/next or numbered),
  paged-region (pager ⇄ infinite sentinel and
  appended nodes), the empty/error panel builder, the sticky chrome measurer, the in-page jump-row
  tracked, infinite-scroll sentinel, the append-stable card grid, the quick-action card
  preview, and view scaling.
- **`src/tailwind.css` / `src/app.css`**: Tailwind v4 theme/utilities, shared components, and one
  stylesheet per feature (`nav`, `settings`, `toplist`, `torrents`, `favorites`, `gallery-actions`).
  The shared recipes — interactive boxes, ghost icon buttons, tab/filter active treatment,
  uppercase eyebrows, scrolling-row fade, settings rows/fields, status lines — live in `app.css`;
  a feature sheet only adds what makes its component different.
- **`src/style.css`**: viewer-only styles.
- **`src/settings.ts` / `src/keymap.ts` / `src/log.ts` / `src/menu.ts`**: settings store, key
  bindings, debug logging, and menu commands.
