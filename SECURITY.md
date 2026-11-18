# Security

## Reporting

Report privately through GitHub's [security advisories](https://github.com/identity-morphism/better-eh/security/advisories/new)
instead of a public issue.

## What the script touches

Better EH runs in your browser as a userscript. It has no server, sends no telemetry, and stores
everything in your manager's value store and session storage on this origin.

Outbound requests go to the site you are already on (`e-hentai.org`, `exhentai.org`, and the image
and forum hosts the pages link) plus the two tag asset mirrors, `raw.githubusercontent.com` and
`cdn.jsdelivr.net`, once a week.

## Credentials

The script reads the site's own session through the page; it never asks for a password and never
writes cookies. Your `ipb_member_id`, `ipb_pass_hash`, `sk` and `igneous` values leave the browser
only to the site.

If you post a URL or a screenshot in an issue, strip those values first. A gallery token in
`/g/<id>/<token>/` works the same way.

## Installing

Install from the [Sleazy Fork listing](https://sleazyfork.org/en/scripts/606064-better-eh) or a
release from this repository. A bundle from anywhere else can carry anything.
