# Documentation screenshot tool

Captures screenshots of a running rwnd.tv instance for use in `README.md` and
`docs/`. Deliberately **outside** the pnpm workspace
(`pnpm-workspace.yaml` only globs `apps/*`/`packages/*`) — it has its own
`package.json` and lockfile, so it never adds Playwright's Chromium download
to a CI run that never uses it, and the root `lint`/`format:check`/`typecheck`
gates never see it either.

## Setup

```sh
cd tools/screenshots
pnpm install
pnpm install-browser   # downloads Chromium once
```

## Running

```sh
BASE_URL=https://dev.rwnd.tv EMAIL=you@example.com PASSWORD=... pnpm start
```

`BASE_URL` defaults to `http://localhost:3000`. Output lands in
`../../docs/screenshots/{name}-{locale}-{theme}.webp`.

**Use a dedicated account with a small, curated watch history — not a
personal one.** These screenshots go into a public repo forever. The account
needs at least one logged watch for the show-detail shot; without one, that
shot is skipped with a warning rather than failing the run.

The script switches the account's locale and theme mid-run (locale is a
server-side preference — see `capture.ts`'s top comment for why) and restores
both when it finishes, including on failure. If a run is killed hard enough to
skip the `finally` (e.g. the process is signal-killed), check Account →
Preferences by hand afterwards.

## Redaction — always review before committing

Nothing here redacts automatically. Every image is a screenshot of a real
account: display name, email, watch history, and whatever's on screen. Before
committing new screenshots:

- Open each one and check for anything you wouldn't want public.
- The Settings shot in particular: the script never creates an API token
  (a freshly created one shows its full secret on screen), but if the
  account already has one from an earlier run, confirm the panel isn't
  showing a value that shouldn't be there.
- Confirm the `en-GB`/`en-US` pairs actually differ (e.g. "Films" vs.
  "Movies") — that's the easiest way to catch a locale switch that silently
  no-opped.
