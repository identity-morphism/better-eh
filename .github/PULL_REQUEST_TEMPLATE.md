## What changed

<!-- One paragraph. Name the routes and modules the change touches. -->

## Checks

- [ ] `bun run check`
- [ ] `bun run test`
- [ ] `bun run test:browser` (after `bun run build`)
- [ ] `dist/better-eh.user.js` rebuilt and committed
- [ ] `version` in `package.json` untouched; releases bump it
- [ ] parsers: a fixture in `test/fixtures/` and a test under `test/parse/`
- [ ] no session cookies, tokens or real gallery ids in fixtures, screenshots or URLs

## Breaking or behavioural risk

<!-- Which route, which cache, what a user on the old bundle notices. Delete if none. -->
