# Development

## Requirements

- [Bun](https://bun.sh/) bundles, type-checks, lints, formats and serves. The exact canary is pinned
  twice in `package.json` (`packageManager` and the `bun` devDependency); every script that runs
  JavaScript goes through `./node_modules/.bin/bun`, and CI bootstraps with released 1.4.4 only to
  install that binary. `prek` runs the same pinned commands. Stable Bun has no `bun lint`, so
  `bun run lint` goes through `scripts/lint.ts`, which reports the mismatch instead of letting
  `bun lint` resolve back to the `lint` script and exit 0.
- Tailwind CSS v4 is compiled by `build.ts`; no separate step is required.

## Setup

```bash
bun install
```

## Static checks

```bash
bun run check            # format check + lint + type check
bun run test             # fixtures across parse, fetch, routes, viewer and ui; one global per file
bun run test:coverage    # the same suite, then the src/ line-coverage floor CI enforces
bun run test:browser     # built userscript smoke gate (Playwright, local fixtures, axe)
bun run check:header     # built bundle metadata: matches, grants, update URLs, version
bun run typecheck        # built-in type checker through the pinned Bun
bun run lint             # bun lint through scripts/lint.ts
bun run lint:fix         # bun lint --fix
bun run format           # bun fmt
bun run format:check     # bun fmt --check
bun run check:pr-version # fails when a pull request moves the release version
```

Lint and format options live in [`bunfig.toml`](../bunfig.toml). Bun has no DOM: `test/dom.ts`
supplies a linkedom document over `test/fixtures/`, and `bunfig.toml` preloads `test/setup.ts`,
which stubs `GM_getValue`/`GM_setValue`.

## Build and dev server

```bash
bun run build           # Tailwind + bundle + header into dist/
bun run dev             # watch, rebuild, and serve on :8080
PORT=8081 bun run dev   # --port 8081 / --port=8081 also work when :8080 is taken
```

`build.ts` compiles `src/tailwind.css` into `.cache/app.css` (Git-ignored), imported as text and
injected with `GM_addStyle` next to the viewer stylesheet.

**Two stylesheets, two cascade roles.** `.cache/app.css` sits entirely inside Tailwind layers
(`theme`, `base`, `components`, `utilities`); `src/style.css` is injected unlayered and outside the
pipeline. Unlayered beats layered regardless of specificity, so the viewer sheet outranks the whole
app: keep every selector in it viewer-scoped (`#id`, `body.<state>`, or a
`reader-`/`hud-`/`img-error-`/`page-nav-` class), because one unscoped rule there silently outranks
the app. The rule cuts both ways: a page's own unlayered CSS outranks every layered app rule, and
the fixture and smoke pages carry no site CSS, so no gate observes that contest.

**Live reload.** The dev server serves `http://localhost:8080/better-eh.user.js`. Open that URL and
click **Track external edits** (not "Install") in the Violentmonkey installer, then tick **Reload
tab**. Violentmonkey re-fetches every ~500 ms, reinstalls on byte changes and reloads the matching
tab; its docs call this
[external-editor development](https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/).
A rebuild is a full page reload, and `localhost` installs have "check for update" disabled by design
([violentmonkey#1020](https://github.com/violentmonkey/violentmonkey/issues/1020)), so reinstall
from the URL after closing the installer tab.

**Size budget**: at most 700 KiB raw and 170 KiB gzipped, the size a manager downloads.
`bun run check:size` enforces both, prints the measured sizes, and prints the app CSS, viewer sheet
and embedded vocabulary as a share of the raw bundle. `bun run check:header` checks the same file's
metadata: both matches, the four grants, `@noframes`, `@run-at document-start`, update URLs, and
`@version` against `package.json`. `src/tags/core-vocabulary.ts` is the only generated source in
`src/`; `bun run check:generated` verifies it against the checked-in assets, and
`bun run scripts/update-core-vocabulary.ts` regenerates it.

## Releasing

```bash
bun run release patch   # minor, major, or an explicit X.Y.Z also work
bun run release patch --push
bun run verify:release  # after the repository is public and the tag is pushed
```

The release script requires a clean tree and `master`, bumps `package.json`, rebuilds `dist/`,
commits both and tags `vX.Y.Z`; `--push` sends commit and exact tag atomically. The tag starts
`.github/workflows/release.yml`, which rebuilds from the tag, fails unless `package.json`, the
bundle header and the committed `dist/` agree, then creates the GitHub Release with
`dist/better-eh.user.js` attached. `.github/release.yml` only groups generated notes. Rerun a failed
publication with `gh workflow run release.yml --ref vX.Y.Z`.

Releases own the version. CI rebuilds `dist/` and fails on any diff, so a behaviour change commits
the rebuilt bundle and leaves `version` alone; `bun run check:pr-version` fails a pull request that
moves it, and managers update only on a version change. `bun run check:release-tag` requires the
newest merged `vX.Y.Z` tag to equal `package.json` and the bundle header; because `bun run release`
bumps, builds, commits and tags in one step, a version only exists on its release commit, and the
script refuses to start until a version committed alone is tagged or reverted.

A dependency that generates the bundle changes it (a Tailwind bump rewrites `dist/` CSS), and a
dependency pull request cannot rebuild it. Dispatch **Rebuild dist** with the bot branch
(`gh workflow run rebuild-dist.yml -f branch=dependabot/...`) to commit the rebuilt bundle back, or
land the bump with a commit that runs `bun run build`; otherwise the dist check fails. The workflow
refuses `master` and `main`, because a release owns the version and the bundle there. Dependabot
leaves the `bun` pin alone: stable Bun resolves `bun lint` back to the `lint` script and exits 0.

CI installs Chromium and Firefox for Playwright and runs the smoke gate against the built bundle and
local fixtures. Chromium boots every owned view (list, gallery, reader, favorites, toplist, torrents,
home, settings, gallery torrents, archive, My Tags) and checks the shell, search routing and tag
combobox that unit tests cannot boot end to end. It opens the filter, favorite and tag menus, runs a
signed-in favorite through a history round trip, a posted-date range through its rewrite to the
site's date cursor, and a parser-sanity failure through the automatic `?eh_native=1` fallback. It
also emulates a Pixel viewport, forced colors and reduced motion; `SMOKE_BROWSERS=chromium,firefox`
adds the Firefox core pass. Axe runs over the shell and every open panel with the WCAG A/AA rules.

`bun run check:live` fetches a listing, the popular tab, a gallery, one of its pages, the toplist
and the news page from the public site, then runs the app's parsers and sanity checks. The weekly
**Live parser canary** workflow runs it and opens an issue on failure; it is advisory, not PR CI.

Sleazy Fork (<https://sleazyfork.org/en/scripts/606064-better-eh>) syncs from this repository's
`dist/better-eh.user.js`, so publishing needs no upload there. Installed copies still update only
when `@version` changes, so the GitHub release remains the release step, and the listing can lag a
release until its next sync. Sleazy Fork serves the bundle through its own update endpoint, rewrites
`@updateURL`/`@downloadURL` for installs, and rejects minified scripts. `bun run verify:release`
compares the listing's version too, but only warns.

The build publishes Bun's output verbatim: no formatter or minifier, and Tailwind CSS without
`--minify`. Bun already keeps names and statement breaks, so re-printing only re-wraps lines
(roughly 11% more lines and 9 KB here), and any minifier would break the unminified requirement.

## Tag data refresh

`Update tag popularity` (Mondays 05:17 UTC) and `Update tag vocabulary` (Mondays 05:47 UTC) rewrite
`assets/*.bin`, regenerate `src/tags/core-vocabulary.ts`, and exit when the upstream release has not
moved. A real refresh also changes `dist/`, because the bundle inlines the core counts.

Master requires the `check` status, and only a run triggered by `push`, `pull_request` (or
`pull_request_review`, `pull_request_target`, `deployment`, `deployment_status`) reports one; a
`workflow_dispatch` run does not count, and a push or pull request made with `GITHUB_TOKEN` starts no
run. So `scripts/publish-data.ts` publishes through the `TAG_DATA_TOKEN` secret (fine-grained,
**Contents** and **Pull requests** write): it commits the refreshed data and bundle on the runner,
force-pushes `automation/tag-popularity` (or `automation/tag-vocabulary`), opens the pull request
with that token so `ci.yml` runs, waits for `mergeStateStatus` `CLEAN`, and squash-merges with
`--match-head-commit`. A rerun reuses the open pull request and overwrites the branch. Missing
secret: `TAG_DATA_TOKEN is required`; missing token event: the merge stays `BLOCKED`. Rerun from the
Actions tab or `gh workflow run update-tag-counts.yml`.

## Settings and debugging

- Settings are one versioned `eh:settings:v2` value; an absent or outdated record starts from the
  schema defaults, and the pre-public-release scalar keys are no longer read.
- Site preferences are **not** ours: `/uconfig.php` renders in-app from the live form
  (`parseUconfig`), so a save posts every field back with only your changes applied, and fields the
  script has never heard of survive the round trip.
- Posted-date ranges use app-owned `eh_since`/`eh_until`, not site filters. Boot rewrites the range
  to the site's date cursor (`seek`) and bounds results client-side; the pager's Seek field still
  uses the site cursor.
- Storage keys: tag index `eh:tag-index:v2` and popularity `eh:tag-counts:v3` (both refreshed
  weekly), `eh:tag-usage:v1`, `eh:tag-completions:v1`, `eh:search-history:v1`, quick tags
  `eh:saved-expressions:v1` (old name kept), `eh:resume:v1`, the tab's `eh:search-context:v1` and
  `eh:search-draft:v1`, remembered filters `eh:list-filters:v1`, and the filter panel's
  `eh:list-filters-open:v1`. The embedded core powers suggestions before any download; the full
  index upgrades in the background and refreshes weekly.
- Picking a suggestion teaches the combobox that tag for the exact typed prefix (namespace-scoped
  searches learn their own). Remembered picks outweigh the popularity prior, halve every 30 days,
  expire after 90 days, and stay in a bounded 200-entry store.
- The **Better EH** settings section edits every preference, including reader layout/direction,
  data-saver mode, key bindings and JSON backup. The userscript menu toggles the default reading
  mode, infinite scroll (feed and gallery independently, applied to open views), tag suggestions and
  debug logging, plus a keymap reset and refresh/clear commands for cached tag data. A refused
  storage write shows one toast.
- Favorites add/remove needs a session: without one the folder menu shows a login prompt, a failed
  folder load links to the native dialog, and favorites/settings render a login gate.
