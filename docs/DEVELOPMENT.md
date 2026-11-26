# Development

## Requirements

- [Bun](https://bun.sh/) — used for bundling, type checking, linting, formatting, and serving.
  The exact canary build is pinned twice in `package.json` (`packageManager` and the `bun`
  devDependency), and every script that runs JavaScript goes through `./node_modules/.bin/bun`;
  CI bootstraps with the released 1.4.4 only to install that binary. `prek` runs the same pinned
  commands. Stable Bun has no `bun lint`, so only the pinned canary runs that check. `bun run lint`
  goes through `scripts/lint.ts`, which reports the mismatch instead of letting `bun lint` resolve
  back to the `lint` script and exit 0 without linting.
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
bun run test:browser     # built userscript smoke gate (Playwright, local fixtures, axe)
bun run check:header     # built bundle metadata: matches, grants, update URLs, version
bun run typecheck        # built-in type checker through the pinned Bun
bun run lint             # bun lint through scripts/lint.ts
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

**Two stylesheets, two cascade roles.** `.cache/app.css` is entirely inside Tailwind layers
(`theme`, `base`, `components`, `utilities`); `src/style.css` is injected unlayered and outside the
Tailwind pipeline. An unlayered declaration beats every layered one regardless of specificity, so
the viewer sheet outranks the whole app — keep it that way, and keep every selector in it
viewer-scoped (`#id`, `body.<state>`, or a `reader-`/`hud-`/`img-error-`/`page-nav-` class). One
unscoped rule there silently outranks the app. The same rule cuts the other way: a page's own
unlayered CSS outranks every layered app rule, so a reskin rule cannot be made to win by adding
specificity; the fixture and smoke pages carry no site CSS, so no gate observes that contest.

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

**Release size budget**: the built bundle must stay at or under 700 KiB raw and 170 KiB gzipped,
the size a userscript manager downloads. `bun run check:size` enforces both and prints the measured
sizes against each limit; CI runs it after `bun run build`, so a bundle that outgrows either
ceiling fails the pull request. It also prints the compiled app CSS, the viewer sheet and the
embedded vocabulary as a share of the raw bundle, so a feature that grows one of them is visible in
review, and the generated core is the only embedded dataset; larger data ships as a repository
asset. `bun run check:header` checks the same built file's metadata: both
matches, the four grants, `@noframes`, `@run-at document-start`, the update URLs, and `@version`
against `package.json`. The core vocabulary (`src/tags/core-vocabulary.ts`) is the only
generated source in `src/`; `bun run check:generated` verifies it against the checked-in assets,
and `bun run scripts/update-core-vocabulary.ts` regenerates it.

## Releasing

```bash
bun run release patch   # minor, major, or an explicit X.Y.Z also work
bun run release patch --push
bun run verify:release          # after the repository is public and the tag is pushed
```

The release script requires a clean tree and `master`, bumps `package.json`, rebuilds `dist/`,
commits both, and tags `vX.Y.Z`. `--push` atomically pushes the commit and the exact tag; without
it the script prints the command to run. The tag push starts `.github/workflows/release.yml`,
which rebuilds from the tag, fails unless `package.json`, the bundle header and the committed
`dist/` agree, then creates the GitHub Release with `dist/better-eh.user.js` attached. The root
`.github/release.yml` only groups generated notes; it is not a workflow. Rerun a failed
publication with `gh workflow run release.yml --ref vX.Y.Z`.

Releases own the version. CI rebuilds `dist/` and fails on any diff, so a pull request that
changes behaviour commits the rebuilt bundle and leaves `version` in `package.json` alone;
`bun run check:pr-version` fails a pull request that moves it. Managers only update on a version
change, so the rebuilt bundle reaches installed copies at the next release, not at merge.

`bun run check:release-tag` closes the other half: the newest merged `vX.Y.Z` tag must equal
`package.json`'s version, and the committed bundle header must match both. Because `bun run release`
bumps, builds, commits and tags in one step and `--push` sends commit and tag atomically, a version
only ever exists on its release commit. If a version is committed on its own, the check fails and
the release script refuses to start until the version is tagged or reverted; never hand-edit
`version` as part of a feature change.

A dependency that generates the bundle changes it: a Tailwind bump rewrites the CSS inside `dist/`.
A dependency pull request cannot rebuild it. Dispatch **Rebuild dist** with the bot branch
(`gh workflow run rebuild-dist.yml -f branch=dependabot/...`) and the workflow commits the rebuilt
bundle back to that branch; otherwise land the bump with a commit that runs `bun run build`, or
CI's dist check fails on the pull request. The workflow refuses `master` and `main`, because a
release owns the version and the bundle on those branches. Dependabot is told to leave the `bun`
pin alone: stable Bun resolves `bun lint` back to the `lint` script and exits 0 without linting.

CI installs Chromium and Firefox for Playwright and runs the browser smoke gate against the built
bundle and local fixtures. Chromium boots every owned view (list, gallery, reader, favorites,
toplist, torrents, home, settings, gallery torrents, archive and My Tags), checks the shell, search
routing and tag combobox that unit tests cannot boot end to end, opens the filter, favorite and tag
menus, follows a signed-in favorite through a history round trip, follows a posted-date range
through its rewrite to the site's date cursor, and asserts that a document which fails parser
sanity reloads through the automatic `?eh_native=1` fallback. It also runs a Pixel viewport and
forced-colors/reduced-motion emulation; Firefox repeats the core page shapes via
`SMOKE_BROWSERS=chromium,firefox`. Axe runs over the shell and every open panel with the WCAG A/AA
rules, so a new control that fails name, contrast or landmark checks fails CI.

`bun run check:live` fetches a listing, the popular tab, a gallery, one of its pages, the toplist
and the news page from the public site, then runs the same parsers and sanity checks the app uses.
The **Live parser canary** workflow runs it weekly and opens an issue on failure; it is advisory
and not part of pull-request CI.

Sleazy Fork is the public listing: <https://sleazyfork.org/en/scripts/606064-better-eh>. The
listing syncs from this repository's `dist/better-eh.user.js` asset, so publishing needs no upload
or edit on Sleazy Fork. It follows the committed bundle, but installed copies only update when
`@version` changes, so the GitHub release remains the release step. Sync is not instantaneous, so
the listing can lag the release until its next sync run. Sleazy Fork serves the bundle through its
own update endpoint and rewrites `@updateURL`/`@downloadURL` for installs; the bundle must stay
unminified because Sleazy Fork rejects minified scripts. `bun run verify:release` compares the
listing's version too, but only warns: a release can run before the next sync lands.

The build publishes Bun's bundle verbatim: no formatter or minifier runs over it, and the generated
Tailwind CSS is emitted without `--minify` so the whole bundle stays readable. Bun already keeps
names and statement breaks, so re-printing only re-wraps lines (roughly 11% more lines and 9 KB for
this script), and any minifier would break the unminified requirement.

## Tag data refresh

`Update tag popularity` (Mondays 05:17 UTC) and `Update tag vocabulary` (Mondays 05:47 UTC) rewrite
`assets/*.bin`, regenerate `src/tags/core-vocabulary.ts` and exit when the upstream release has not
moved. A real refresh also changes `dist/`, because the bundle inlines the core counts.

Master requires the `check` status, and only a run triggered by `push`, `pull_request` (or
`pull_request_review`, `pull_request_target`, `deployment`, `deployment_status`) reports a check that
satisfies it; a `workflow_dispatch` run does not count, and a push or pull request made with
`GITHUB_TOKEN` starts no run at all. So `scripts/publish-data.ts` publishes through the
`TAG_DATA_TOKEN` secret — a fine-grained token with **Contents** and **Pull requests** write on this
repository. It commits the refreshed data and rebuilt bundle on the runner, force-pushes
`automation/tag-popularity` (or `automation/tag-vocabulary`), opens the pull request with that token
so `ci.yml` runs on the head commit, waits for `mergeStateStatus` to become `CLEAN`, and squash-merges
with `--match-head-commit`. A rerun reuses the open pull request and overwrites the branch.

Without the secret the step fails with `TAG_DATA_TOKEN is required`; without the token's
`pull_request` event there is no eligible check and the merge stays `BLOCKED`. Rerun a failed refresh
from the Actions tab, or `gh workflow run update-tag-counts.yml`.

## Settings & Debugging

- Settings are stored as one versioned `eh:settings:v2` value. An absent or outdated record starts
  from the schema defaults; the pre-public-release scalar keys are no longer read.
- Site preferences are **not** ours: `/uconfig.php` renders them in-app, and the model is parsed
  from the live form (`parseUconfig`), so a save posts every field back with only your changes
  applied. Fields the script has never heard of survive the round trip.
- Posted-date ranges use app-owned listing parameters, `eh_since` and `eh_until`, not the site's
  filters. Boot rewrites the range to the site's date cursor (`seek`) and bounds the results
  client-side, so counts are approximate; the pager's own Seek field still uses the site's cursor.
- The tag index lives in `eh:tag-index:v2` (refreshed weekly from the compact repository asset),
  tag popularity in `eh:tag-counts:v3` (refreshed weekly from the repository asset), tag usage in
  `eh:tag-usage:v1`, prefix completions in `eh:tag-completions:v1`, recent searches in
  `eh:search-history:v1`, quick tags in `eh:saved-expressions:v1` (the key keeps its old name),
  per-gallery reading
  positions in `eh:resume:v1`, and the tab's current search in `eh:search-context:v1` and its draft
  in `eh:search-draft:v1`. Remembered listing filters use `eh:list-filters:v1`, and the filter
  panel's state `eh:list-filters-open:v1`. The bundle embeds the core vocabulary, so suggestions
  work before any download; the full index and the popularity snapshot stay remote, and first use
  upgrades to the full index in the background, then refreshes it weekly.
- Picking a suggestion teaches the combobox that tag for the exact typed prefix (namespace-scoped
  searches learn their own prefix). Remembered picks outweigh the popularity prior, halve in weight
  every 30 days, expire after 90 days, and stay in a bounded 200-entry local store.
- The **Better EH** section on the settings page edits every userscript preference, including
  the reader layout/direction, the data-saver mode, key bindings, and JSON backup. The userscript menu keeps quick toggles for the default reading
  mode, infinite scroll for the feed and gallery pages (independent switches; applied to open views
  immediately), tag suggestions, debug logging, a keymap reset, and refresh/clear commands for the
  cached tag data. A refused userscript-storage write shows one toast instead of failing silently.
- Favorites add/remove requires a signed-in session. Without one, the folder menu shows a login
  prompt; if folder loading fails, it links to the site's native dialog instead. The favorites and
  settings pages render a login gate when the session is missing.

---
