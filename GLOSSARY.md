# Glossary

Domain terms name the pages this userscript owns. Module terms name the code that handles them.
Architecture vocabulary (module, interface, implementation, depth, seam, adapter, leverage,
locality) follows the codebase-design skill.

## Domain

- **Gallery**: a gallery detail page, `/g/<gid>/<token>/`. `parseGalleryPage` returns
  `GalleryData`.
- **Viewer**: a single-image page, `/s/<hash>/<gid>-<n>`. Parsed into `PageData`; mounted by the
  viewer view.
- **List**: a search, category, tag or uploader results page, parsed into `ListPageData`. The
  site's Popular and Watched tabs ride this route with a scope (`search`, `popular`, `watched`,
  `uploader`).
- **Favorites page**: `/favorites.php`, folder tabs plus the favorited gallery grid
  (`FavoritesPage`). Distinct from a _favorite folder_, a named slot.
- **Toplist**: `/toplist.php`, either the ranked overview (`.tdo` blocks) or one `?tl=` category
  list (results table plus `?p=` paging). Parsed into `ToplistPage`.
- **Torrent index**: `/torrents.php`, the torrent table with `status`/`mine` filters and numeric
  paging (`TorrentPage`).
- **Gallery torrents**: `/gallerytorrents.php?gid=<id>&t=<token>`, one gallery's torrent list
  (`GalleryTorrentsPage`); details read the site's POST result into `TorrentInfo`.
- **My Tags**: `/mytags`, the account's per-tag watch/hide, colour and weight settings plus the
  add/edit form (`MyTagsPage`); mutations live in the `my-tags` data module.
- **Posted-date range**: an app-owned `eh_since`/`eh_until` bound on a listing URL, not a site
  filter. The list route rewrites a cold address to the site's date cursor (`seek`), bounds page one
  and the append feed client-side, and stops paging once a page crosses `since`; counts are
  approximate.
- **Uconfig**: `/uconfig.php`, the account's site settings form (`UconfigSection[]`); saving posts
  every parsed field back with the changed values applied.
- **Page**: one image inside a gallery. Its viewer URL keys the page cache.
- **Original image**: the un-resized file behind "Download original" (`PageData.originalHref`),
  fetched lazily on deep zoom when the served copy runs out of pixels.
- **Thumb**: a sprite-backed tile on a gallery page pointing at one page's viewer.
- **Favorite folder**: one of ten named slots on an account, read from `uconfig.php`.
- **Favorite mark**: the folder name and inline colour the site paints on a favorited result's
  posted date, plus the name the gallery header's favorite link shows (`FavoriteMark`); rendered as
  a folder-coloured inset bar on the card and the header button's label.
- **Route**: an owned URL classified by `parseRoute`; everything else is native.
- **Search term**: one whitespace-separated piece of `f_search`, optionally signed (`-`/`~`),
  namespaced (`female:`), quoted, and exact (`$`).
- **Tag index**: the compact namespace/key vocabulary behind suggestions. The bundle embeds a
  generated core of the most popular tags (about 1,500); the full roughly 400 KB front-coded index
  stays remote and upgrades that core in the background on first use.
- **Tag counts**: the cached gallery-frequency snapshot that ranks popular tags ahead of rare
  matches. The core embeds the counts of its selected tags; the remote snapshot refreshes the full
  index and the core when it is what suggestions serve.
- **Search draft**: the tab's committed query plus the free text being edited, kept across list,
  gallery and reloads. Submitting commits the draft; tag clicks and chip edits change only it.

## Modules

- **parse**: HTML document plus URL in, domain data out. No globals: functions take the URL they
  need, and parsed pages carry it, so views never read `location`.
- **page-fetch**: the one interface for loading a page's HTML or parsed data, with caching,
  prioritisation and typed failures behind it.
- **store**: the one persistence seam: one key, one versioned envelope, one shape guard, storage
  failures swallowed. Adapters: userscript value storage, per-tab session storage, in-memory for
  tests.
- **settings**: the store for user settings; readers snapshot, writers update and notify. The scalar
  preferences are declared once in the **settings schema**, which also supplies their controls,
  bounds, validation and import/export.
- **search-draft**: the one owner of the Search draft: snapshot reads, draft-only and committed
  setters, subscriptions for the top bar, chips and tag section; both halves persist in the tab
  session.
- **route table**: one entry per owned route kind, pairing the URL matcher with the **route view**
  adapter so `parseRoute` and the view table cannot drift. A row owns its address policy
  (`prepare`: remembered filters, request-only redirects, history markers) and its append feed
  (`feed`: paging policy for page one and every appended page); the shell never names a kind.
- **app shell**: boot, navigation, popstate and error rendering around one injected environment
  (URL, history, document, navigator, window, route views). `src/app.ts` is the production adapter;
  tests build another environment, so scenarios and shells share one process.
- **view-lifecycle**: the one mount/teardown sequence — abort the previous view, close panels, reset
  view mode, dispose sticky tracking, clear the host, render, title, restore scroll. Success, login
  gate and error paths all mount through it.
- **popover**: the one anchored-panel primitive: placement, a dismissal stack that closes only the
  top panel, focus return, abort-signal teardown. Panels render in the top layer, above the page's
  stacking contexts. Every panel uses it, tag combobox included.
- **login gate**: the panel a gated route renders when the session is missing, instead of an error.
- **site nav**: the tab row built from the current path, sign-in state and host; owned tabs stay
  internal, everything else is a plain link the router ignores.
- **gallery actions**: the site's JSON API for one gallery (rate, tag vote, comment vote/post/edit),
  parsed from the page's inline config rather than hardcoded.
- **gallery refresh**: the gallery view's one fresh fetch and parse after a mutation; tag and
  comment sections receive the refreshed data instead of loading the page themselves.
- **view-mode**: the single owner of body view-mode classes and per-view CSS variables.
- **page-image**: show one page's image, refetch on failure up to the retry limit, then give up. One
  slot factory per mount owns the retry ladder, retry-limit provider and abort/currency composition;
  a surface supplies only its stale check and paints.
- **reader navigation**: one adapter per reader mode (single, spread, continuous), chosen at mount.
  Movement, HUD state, layout sync, clicks, swipes, keyboard step and the visible zoom surface cross
  this seam, so the viewer never re-reads the mode.
- **zoom**: the fit-height zoom/pan controller; reports each level so the viewer can swap in the
  original image once the served copy would be upscaled.
- **pager**: the numbered, jump and seek pagination control shared by the gallery, list, favorites,
  toplist and torrents views.
- **page-cursor**: the headless next-page cursor: sequential fetching, seen-key dedupe, visited-URL
  loop detection and retryable failure; shared by infinite-scroll and the viewer's continuous mode.
- **infinite-scroll**: the sentinel that appends a paginated view's next page before it scrolls into
  view, driven by page-cursor; shared by the list and gallery views, each behind its own setting.
- **paged-region**: the one pagination controller: appended-node registry, pager ⇄ sentinel swap,
  setting subscription, abort teardown, sentinel paging delegated to infinite-scroll.
- **favorites selection**: the favorites page's selected gids, range anchor and select-all
  derivation; cards report intent and render their checked state from it.
- **result-card**: the one result-card assembly (cover, title, uploader, meta, favorite mark,
  optional overlay/note) used by the list and favorites grids.
- **home**: the `/home.php` account overview: account subnav plus each titled stats box as prose,
  fact rows and standalone links. Account-mutating forms stay native.
- **tags**: the search-expression grammar, cached tag index and suggestion ranking; no DOM. `model`
  owns term identity for known namespaces, aliases, unknown prefixes, quoting and exact markers,
  plus the sign-presentation table every chip, menu and tooltip consumes. `db` attaches the
  popularity snapshot in one place, using its maximum as the denominator; the generated core carries
  the counts it was selected by, so first-run ranking matches the full index.
- **tag-combobox**: the accessible suggestion portal bound to the top bar's input.
- **search-chips**: the structured view of the current query's terms.
- **gallery tag row**: the gallery's tag section: chips, hints, context menus, touch trigger,
  composer, applied state and focus return. It rebuilds from a refreshed gallery page while the
  gallery keeps the header, grid and paging.
- **action-menu**: the shared menu panel behind a button or a right-click.
- **pending action**: the one mutation protocol — in-flight guard, busy marking, abort check,
  result/error paint and focus restore. Controls supply the request, paints and recovery target;
  archive download, torrent details, comment vote/post/edit, rating, the tag menu and favorites bulk
  actions all run through it.
