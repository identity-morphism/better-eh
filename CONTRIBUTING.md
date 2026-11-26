# Contributing

Bug reports and pull requests are welcome. This page covers what makes a change land; the
[development guide](docs/DEVELOPMENT.md) covers setup, the dev server and releases, and
[architecture](docs/ARCHITECTURE.md) maps the modules.

## Before opening an issue

- Read [Known Limits](README.md#known-limits). Several native pages are deliberate. Posted-date
  ranges are app-owned (`eh_since`/`eh_until`) rather than site filters: the range is bounded
  in-app, so result counts are approximate.
- Search open and closed issues for the route and symptom.
- A broken page is usually a site HTML change. Say which route broke (`/s/…` list, `/g/…` gallery,
  reader, favorites, toplist, torrents, gallery torrents, My Tags, `/uconfig.php`) and what the
  console says.
- The script matches `https://e-hentai.org/*` and `https://exhentai.org/*` only. Problems in another
  manager's sandbox or another userscript belong upstream.

## Never paste session data

A URL copied from a signed-in tab can carry `ipb_member_id`, `ipb_pass_hash`, `sk`, `igneous`, or
the gallery token in `/g/<id>/<token>/`. Anyone who sees them has your account. Replace the ids and
tokens with zeros, crop the address bar, and keep cookie headers out of bug reports.

The same rule applies to test fixtures: `test/fixtures/*.html` must hold a page with every session
value and every real uploaded image removed.

## Local checks

CI runs these on every pull request, and they run in about two seconds:

```bash
bun install
bun run check         # format, lint, type check
bun run test          # fixture suite, one isolated global per file, about two seconds
bun run test:coverage # the same suite plus the src/ line-coverage floor
bun run test:browser  # built userscript in Chromium, then axe; needs playwright chromium
```

`bun run test:browser` and `bun run check:header` read `dist/`, so build first (`bun run build`).

## Pull requests

- One concern per pull request. Parser fixes, styling and new pages review at different speeds.
- Parser changes come with a test. Fixtures live in `test/fixtures/`; `test/dom.ts` gives them a
  document through linkedom, and the tests in `test/parse/` show the shape.
- Rebuild the bundle and leave the version alone. CI rebuilds `dist/better-eh.user.js` and fails on
  any diff, so the rebuilt file belongs in the same commit as the source change:

  ```bash
  bun run build
  git add dist/better-eh.user.js
  ```

  `version` in `package.json` belongs to releases. `bun run release <patch|minor|major>` bumps it,
  rebuilds, commits and tags, and CI fails a pull request that moves it. On `master`,
  `bun run check:release-tag` fails any version that is not the newest merged `vX.Y.Z` tag, so a
  version bump committed on its own is not releasable either.

- Keep the bundle unminified. Sleazy Fork rejects minified listings, so `build.ts` publishes Bun's
  output verbatim and no formatter runs over it.
- Commit subjects follow the existing style: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`.

## Scope

The script renders pages the site already serves. It stays inside the pages it owns and leaves the
rest native behind `?eh_native=1`. Changes that defeat login, rate limits or paid access, or that
fetch gallery files the page does not already request, are out of scope.

New owned routes are welcome when the site's own page is unreadable with the shell. Add the row to
`src/routes/index.ts` and a `load`/`parse`/`render`/`title` view beside the others.
