# Seed demo account

Populates a throwaway account with curated watch history, ratings and
watchlists via the running instance's own API, so the screenshot tool
(`../screenshots`) has something real to capture without ever touching
anyone's personal data. See `titles.ts` for exactly what gets seeded:
around a dozen well-known movies and shows from the last few years,
watched and about half rated close to their real TMDB consensus score, a
handful of upcoming titles on the watchlist, and a few named custom
watchlists.

Reproducible by design: every run clears the account's existing history,
ratings and watchlists first (`POST /account/clear-data`), then reseeds
from `titles.ts` from scratch. Running it twice leaves the account in the
same state as running it once, so it's safe to rerun whenever the landing
page or docs screenshots need refreshing as the app evolves.

## Setup

```sh
cd tools/seed-demo-account
pnpm install
```

## Running

```sh
BASE_URL=https://dev.rwnd.tv EMAIL=demo@example.com PASSWORD=... pnpm start
```

`BASE_URL` defaults to `http://localhost:3000`.

**First run only:** if the account doesn't exist yet, this script tries to
register it. That needs the instance to have email configured and
registration open; pass `INVITE_CODE=...` if the instance is
invite-only. If registration isn't available at all (closed, or no SMTP),
create the account once by hand instead; every run after that only needs
to log in, which has no such requirement.

Then capture the screenshots as usual:

```sh
cd ../screenshots
BASE_URL=https://dev.rwnd.tv EMAIL=demo@example.com PASSWORD=... pnpm start
TARGET=landing BASE_URL=https://dev.rwnd.tv EMAIL=demo@example.com PASSWORD=... pnpm start
```

## Keeping it current

`titles.ts` is a hand-picked, fixed list, not pulled from a "trending
now" API. That's deliberate, so a reseed produces the same shape of
library regardless of when it's run, and there's a real human check on
what ends up in public screenshots forever. Nothing here refreshes it
automatically. Update it every year or so (swap in newer releases, retire
older ones) so "the last few years" stays actually recent: same
"review before it's public" discipline as `../screenshots/README.md`'s
redaction step, just applied to the source data instead of the images.

## Why not the same account as ../screenshots documented?

That tool's README already asks for "a dedicated account with a small,
curated watch history — not a personal one." This is that account,
formalized: instead of someone hand-curating it once and it going stale,
the account's entire state is defined in code and rebuilt fresh every
time. Point both tools at the same account.
