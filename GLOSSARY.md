# Glossary

Domain terms name the pages this userscript owns. Module terms name the code that handles them.
Architecture vocabulary (module, interface, implementation, depth, seam, adapter, leverage,
locality) is used exactly as defined by the codebase-design skill.

## Domain

- **Gallery**: a gallery detail page, `/g/<gid>/<token>/`. Parsed by `parseGalleryPage` into
  `GalleryData`.
- **Viewer**: a single-image page, `/s/<hash>/<gid>-<n>`. Parsed into `PageData`; mounted by the
  viewer view.
- **List**: a search, category, tag or uploader results page. Parsed into `ListPageData`. The site's
  own Popular and Watched tabs serve the same table and ride this route with a scope (`search`,
  `popular`, `watched`, `uploader`).
- **Favorites page**: `/favorites.php`, the folder tabs plus the favorited gallery grid. Parsed into
  `FavoritesPage`; distinct from a _favorite folder_, which is only a named slot.
- **Toplist**: `/toplist.php`, either the ranked overview (`.tdo` blocks) or one `?tl=` category
  list (a results table plus `?p=` paging). Parsed into `ToplistPage`.
- **Torrent index**: `/torrents.php`, the torrent table with `status`/`mine` filters and numeric
  paging. Parsed into `TorrentPage`.
- **Gallery torrents**: `/gallerytorrents.php?gid=<id>&t=<token>`, one gallery's torrent list,
  parsed into `GalleryTorrentsPage`. Details reads the site's POST result into `TorrentInfo`.
- **My Tags**: `/mytags`, the account's per-tag watch/hide, colour and weight settings plus the
  add/edit form. Parsed into `MyTagsPage`; mutations live in the `my-tags` data module.
- **Posted-date range**: an app-owned `eh_since`/`eh_until` bound on a listing URL, not a site
  filter. The list route row rewrites a cold address to the site's date cursor (`seek`), bounds its
  page one and append feed client-side, and stops paging once a page crosses `since`, so counts are
  approximate.
- **Uconfig**: `/uconfig.php`, the account's site settings form. Parsed into `UconfigSection[]`;
  saving posts every parsed field back with the changed values applied.
- **Page**: one image inside a gallery. Its viewer URL is the unit the page cache is keyed on.
- **Original image**: the un-resized file the viewer's "Download original" link points at
  (`PageData.originalHref`). Fetched lazily on deep zoom, when the served copy runs out of pixels.
- **Thumb**: a sprite-backed tile on a gallery page pointing at one page's viewer.
- **Favorite folder**: one of ten named slots on an account, read from `uconfig.php`.
- **Favorite mark**: the folder name and inline folder colour the site paints on a favorited result
  row's posted date, plus the folder name the gallery header's favorite link shows. Parsed into
  `FavoriteMark`; rendered as a folder-coloured inset bar on the card's posted date and the header
  button's label.
- **Route**: an owned URL classified by `parseRoute`; everything else is native and left to the
  site.
- **Search term**: one whitespace-separated piece of `f_search`, optionally signed (`-`/`~`),
  namespaced (`female:`), quoted, and exact (`$`).
- **Tag index**: the compact namespace/key vocabulary used for suggestions. The bundle embeds a
  generated core of its most popular tags (about 1,500); the full roughly 400 KB front-coded index
  stays remote and upgrades that core in the background on first use.
- **Tag counts**: the cached gallery-frequency snapshot that ranks popular tags ahead of rare
  matches. The generated core embeds the counts of its selected tags; the remote snapshot refreshes
  the full index and the core when it is what suggestions serve.
- **Search draft**: the tab's committed query plus the free text being edited, kept across list,
  gallery, and reloads. Submitting commits the draft; tag clicks and chip edits change only it.

## Modules

- **parse**: HTML document plus URL in, domain data out. No globals: every function takes the URL
  it needs, and every page it parses carries that URL so views never read `location`.
- **page-fetch**: the one interface for loading a page's HTML or parsed data, with caching,
  prioritisation and typed failures behind it.
- **store**: the one persistence seam: one key, one versioned envelope and a shape guard, with
  storage failures swallowed. Adapters: userscript value storage and per-tab session storage;
  tests use an in-memory one.
- **settings**: the store for user settings; readers take a snapshot, writers update and notify.
  The scalar preferences are declared once in the **settings schema**, which also supplies their
  controls, bounds, validation and import/export.
- **search-draft**: the one owner of the Search draft: snapshot reads, draft-only and committed
  setters, and subscriptions for the top bar, chips and tag section. Persists both halves in the
  tab session.
- **route table**: one entry per owned route kind, pairing the URL matcher with the **route view**
  adapter, so `parseRoute` and the view table cannot drift. A row owns its address policy
  (`prepare`: remembered filters, request-only redirects, history markers) and its append feed
  (`feed`: the paging policy applied to page one and every appended page); the shell never names a
  kind. `load` and `parse` share one parse function, so a document is parsed once per load.
- **app shell**: boot, navigation, popstate and error rendering built around one injected
  environment (URL/location, history, document, navigator, window and route views). `src/app.ts` is
  the production adapter; tests construct another environment, so multiple scenarios and shells
  share one process.
- **view-lifecycle**: the one mount/teardown sequence — abort the previous view, close panels, reset
  view mode, dispose sticky tracking, clear the host, render, title, restore scroll. Success, login
  gate and error paths all mount through it.
- **popover**: the one anchored-panel primitive: placement, a dismissal stack that closes only the
  top panel, focus return, and abort-signal teardown. Panels render in the top layer, so the page's
  own stacking contexts cannot cover them. Every panel uses it, including the tag combobox.
- **login gate**: the panel a gated route renders when the session is missing, instead of an error.
- **site nav**: the tab row built from the current path, sign-in state and host; owned tabs stay
  internal, everything else is a plain link the router ignores.
- **gallery actions**: the site's JSON API surface for one gallery (rate, tag vote, comment vote,
  comment post, comment edit), parsed from the page's inline config rather than hardcoded.
- **gallery refresh**: the gallery view's one fresh fetch and parse after a mutation; the tag and
  comment sections receive the refreshed data instead of loading the page themselves.
- **view-mode**: the single owner of body view-mode classes and per-view CSS variables.
- **page-image**: show one page's image, refetch on failure up to the retry limit, then give up. One
  slot factory per mount owns the retry ladder, retry-limit provider and abort/currency composition;
  a surface only supplies its stale check and paints.
- **reader navigation**: one adapter per reader mode (single, spread, continuous), chosen when the
  mode mounts. Movement, HUD state, layout sync, clicks, swipes, keyboard step and the visible zoom
  surface all cross this seam, so the viewer never re-reads the mode.
- **zoom**: the fit-height zoom/pan controller; reports each level so the viewer can swap in the
  original image once the served copy would be upscaled.
- **pager**: the numbered, jump and seek pagination control shared by the gallery, list, favorites,
  toplist and torrents views.
- **page-cursor**: the headless next-page cursor: sequential fetching, seen-key dedupe,
  visited-URL loop detection and retryable failure, shared by infinite-scroll and the viewer's
  continuous mode.
- **infinite-scroll**: the sentinel that appends a paginated view's next page before it scrolls into
  view, driven by page-cursor; shared by the list and gallery views, each behind its own setting.
- **paged-region**: the one pagination controller: it owns the appended-node registry, the pager ⇄
  sentinel swap, the setting subscription and abort teardown, and delegates sentinel paging to
  infinite-scroll.
- **favorites selection**: the favorites page's selected gids, range anchor and select-all
  derivation; cards report intent and render their checked state from it.
- **result-card**: the one result-card assembly (cover, title, uploader, meta, favorite mark,
  optional overlay/note), used by the list and favorites grids.
- **home**: the `/home.php` account overview: the account subnav plus each titled stats box as
  prose, label/value facts and standalone links. Account-mutating forms stay on the native page.
- **tags**: the search-expression grammar, the cached tag index, and the suggestion ranking; no DOM.
  `model` owns term identity for known namespaces, aliases, unknown prefixes, quoting and exact
  markers, plus the sign-presentation table every chip, menu and tooltip consumes. `db` attaches
  the popularity snapshot in one place, using the snapshot's maximum as the denominator, and the
  generated core carries the counts it was selected by so first-run ranking matches the full index.
- **tag-combobox**: the accessible suggestion portal bound to the top bar's input.
- **search-chips**: the structured view of the current query's terms.
- **gallery tag row**: the gallery's tag section: chips, hints, context menus, touch trigger, tag
  composer, applied state and focus return. It rebuilds itself from a refreshed gallery page while
  the gallery keeps the header, grid and paging.
- **action-menu**: the shared menu panel behind a button or a right-click on an element.
- **pending action**: the one mutation protocol — in-flight guard, busy marking, abort check,
  result/error paint and focus restore. Controls supply the request, paints and recovery target;
  archive download, torrent details, comment vote/post/edit, rating, the tag menu and favorites bulk
  actions all run through it.
