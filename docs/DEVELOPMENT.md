# Development

## Requirements

- [Bun](https://bun.sh/) — used for bundling, type checking, linting, formatting, and serving.
  The exact canary build is pinned twice in `package.json` (`packageManager` and the `bun`
  devDependency), so `bun install` fetches it into `node_modules/.bin/bun`, where the scripts and
  the `prek` hooks pick it up. CI bootstraps with the released 1.4.4 and then runs the pinned
  binary; stable Bun has no `bun lint`, so only the pinned canary runs that check.
- Tailwind CSS v4 is compiled by `build.ts`; no separate step is required.

## Setup

```bash
bun install
```

## Static Checks

```bash
bun run check            # format check + lint + type check
bun run test             # fixtures across parse, fetch, routes, viewer and ui; one global per file
bun run test:coverage    # the same suite, then the src/ line-coverage floor CI enforces
bun run test:browser     # built userscript smoke gate (Playwright, two fixtures, axe)
bun run typecheck        # built-in type checker through the pinned Bun
bun run lint             # bun lint
bun run lint:fix         # bun lint --fix
bun run format           # bun fmt
bun run format:check     # bun fmt --check
bun run check:pr-version # fails when a pull request moves the release version
```

Lint and format options live in [`bunfig.toml`](../bunfig.toml).

Bun has no DOM, so `test/dom.ts` supplies a linkedom document and loads the HTML fixtures in
`test/fixtures/`. `bunfig.toml` preloads `test/setup.ts`, which stubs `GM_getValue`/`GM_setValue`.

## Build and Dev Server

```bash
bun run build       # Tailwind + bundle + header into dist/
bun run dev         # watch, rebuild, and serve on :8080
PORT=8081 bun run dev   # --port 8081 / --port=8081 also work when :8080 is taken
```

`build.ts` compiles `src/tailwind.css` into `.cache/app.css`, which is imported as text and
injected with `GM_addStyle` together with the viewer stylesheet. `.cache/` is ignored by Git.

- **Local Server**: Serves the script at `http://localhost:8080/better-eh.user.js`.
- **Live Updates**: Open that URL in the browser and click **Track external edits** (not
  "Install") in the Violentmonkey installer, then tick **Reload tab**. Keep the installer tab
  open while developing: Violentmonkey re-fetches the URL every ~500 ms, reinstalls when the
  bytes change, and reloads the active tab if the script matches it. Its own docs describe the
  same flow as [external-editor development](https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/).
  Violentmonkey has no userscript HMR — a rebuild is a full page reload — and
  scripts installed from `localhost` have "check for update" disabled by design
  ([violentmonkey#1020](https://github.com/violentmonkey/violentmonkey/issues/1020)), so
  re-install from the URL after closing the installer tab.

## Releasing

```bash
bun run release patch   # minor, major, or an explicit X.Y.Z also work
bun run release patch --push
bun run verify:release          # after the repository is public and the tag is pushed
```

The release script requires a clean tree, bumps `package.json`, rebuilds `dist/`, commits both,
and tags `vX.Y.Z`. `--push` also runs `git push --follow-tags`; without it the script prints the
command to run.

Releases own the version. CI rebuilds `dist/` and fails on any diff, so a pull request that
changes behaviour commits the rebuilt bundle and leaves `version` in `package.json` alone;
`bun run check:pr-version` fails a pull request that moves it. Managers only update on a version
change, so the rebuilt bundle reaches installed copies at the next release, not at merge.

CI also installs Chromium for Playwright and runs the browser smoke gate against the built bundle
and two local fixtures, a list page and a gallery. It covers the shell, search routing and the tag
combobox that unit tests cannot boot end to end, then runs axe over `#eh-root` with the WCAG
A/AA rules, so a new control that fails name, contrast or landmark checks fails CI.

Sleazy Fork is the public listing: <https://sleazyfork.org/en/scripts/606064-better-eh>. A new
version must be posted to that listing after the GitHub release; Sleazy Fork rewrites
`@updateURL`/`@downloadURL` to its own update endpoint for installs. The posted bundle must stay
unminified.

The build publishes Bun's bundle verbatim: no formatter or minifier runs over it, and the generated
Tailwind CSS is emitted without `--minify` so the whole bundle stays readable. Bun already keeps
names and statement breaks, so re-printing only re-wraps lines (roughly 11% more lines and 9 KB for
this script), and any minifier would break the unminified requirement.

## Settings & Debugging

- Settings are stored as one versioned `eh:settings:v2` value; legacy `defaultFitHeight`, `debug`,
  and `keymap` values are migrated on first load.
- Site preferences are **not** ours: `/uconfig.php` renders them in-app, and the model is parsed
  from the live form (`parseUconfig`), so a save posts every field back with only your changes
  applied. Fields the script has never heard of survive the round trip.
- The tag index lives in `eh:tag-index:v2` (refreshed weekly from the compact repository asset),
  tag popularity in `eh:tag-counts:v3` (refreshed weekly from the repository asset), tag usage in
  `eh:tag-usage:v1`,
  prefix completions in `eh:tag-completions:v1`, recent searches in `eh:search-history:v1`, named
  searches and quick tags in `eh:saved-expressions:v1` (the old `eh:saved-searches:v1` and
  `eh:quick-tags:v1` records migrate once), per-gallery reading positions in `eh:resume:v1`, and the
  tab's current search in `eh:search-context:v1` and its draft in `eh:search-draft:v1`. Remembered
  listing filters use
  `eh:list-filters:v1`, and the filter panel's state `eh:list-filters-open:v1`. The bundle embeds
  neither dataset; both are downloaded and cached on first use.
- Picking a suggestion teaches the combobox that tag for the exact typed prefix (namespace-scoped
  searches learn their own prefix). Remembered picks outweigh the popularity prior, halve in weight
  every 30 days, expire after 90 days, and stay in a bounded 200-entry local store.
- The **Better EH** section on the settings page edits every userscript preference, including
  the reader layout/direction, key bindings, and JSON backup. The userscript menu keeps quick toggles for the default reading
  mode, infinite scroll for the feed and gallery pages (independent switches; applied to open views
  immediately), tag suggestions, debug logging, and a keymap reset.
- Favorites add/remove requires a signed-in session. Without one, the folder menu shows a login
  prompt; if folder loading fails, it links to the site's native dialog instead. The favorites and
  settings pages render a login gate when the session is missing.

---
