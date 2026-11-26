# Contributing

Bug reports and pull requests are welcome. [Development](docs/DEVELOPMENT.md) covers setup, the dev
server and releases; [architecture](docs/ARCHITECTURE.md) maps the modules.

## Reporting

- Read [Known Limits](README.md#known-limits) first; several native pages are deliberate.
- Search open and closed issues for the route and symptom.
- A broken page is usually a site HTML change. Name the route (`/s/…` list, `/g/…` gallery, reader,
  favorites, toplist, torrents, gallery torrents, My Tags, `/uconfig.php`) and paste the console
  output with debug logging on.
- The script matches `https://e-hentai.org/*` and `https://exhentai.org/*` only. Problems in another
  manager's sandbox or another userscript belong upstream.
- Never paste session data. A URL from a signed-in tab can carry `ipb_member_id`, `ipb_pass_hash`,
  `sk`, `igneous`, or the gallery token in `/g/<id>/<token>/`; anyone who sees them has your
  account. Zero ids and tokens, crop the address bar, and keep cookie headers out of reports.
  Fixtures follow the same rule: no session values, no real uploaded images.

## Local checks

```bash
bun install
bun run check         # format, lint, type check
bun run test          # fixture suite, one isolated global per file
bun run test:coverage # the same suite plus the src/ line-coverage floor
bun run test:browser  # built userscript in Chromium, then axe
                      # SMOKE_BROWSERS=chromium,firefox adds the Firefox core pass
```

CI runs these on every pull request. `test:browser` and `check:header` read `dist/`, so run
`bun run build` first.

## Pull requests

- One concern per pull request; parser fixes, styling and new pages review at different speeds.
- Parser changes come with a test. Fixtures live in `test/fixtures/`, `test/dom.ts` gives them a
  linkedom document, and `test/parse/` shows the shape.
- Rebuild the bundle and leave the version alone. CI rebuilds `dist/better-eh.user.js` and fails on
  any diff, so it belongs in the same commit:

  ```bash
  bun run build
  git add dist/better-eh.user.js
  ```

  `version` in `package.json` belongs to releases: `bun run release <patch|minor|major>` bumps,
  rebuilds, commits and tags, CI fails a pull request that moves it, and on `master`
  `bun run check:release-tag` fails any version that is not the newest merged `vX.Y.Z` tag.

- Keep the bundle unminified; Sleazy Fork rejects minified listings.
- Commit subjects use `feat:`, `fix:`, `docs:`, `test:`, `refactor:` or `chore:`.

## Scope

The script renders pages the site already serves and leaves the rest native behind `?eh_native=1`.
Changes that defeat login, rate limits or paid access, or fetch gallery files the page does not
already request, are out of scope.

New owned routes are welcome when the site's own page is unreadable with the shell: add the row to
`src/routes/index.ts` and a `load`/`parse`/`render`/`title` view beside the others.
