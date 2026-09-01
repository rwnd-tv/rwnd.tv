# TODO

Smaller, non-milestone work: things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- An item also tracked in [ROADMAP.md](ROADMAP.md) gets a milestone tag folded into the trailing date parenthetical, e.g. `(2026-08-23 added; M2)` or `(2026-08-23 added; Not yet scheduled)`, so a listing of this file alone is a complete view of outstanding work, roadmap included. Omit the tag for TODO-only items.
- Blank line between each item.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30)\
      `typescript-eslint` doesn't support TS 7 yet. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it; remove
      that ignore once `typescript-eslint` supports TS 7.

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)\
      Shipped without `content-visibility`/windowing: real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.

## Auth & accounts

- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)\
      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)): sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).
- [ ] **Explore OAuth device-flow login (for a future TV app)** (2026-08-23 16:00 added)\
      The RFC 8628 device authorization grant: the "enter this code on
      your phone" / QR flow BBC iPlayer, Disney+, and `gh auth login`
      all use for devices with no comfortable keyboard. Only relevant
      once there's an actual rwnd.tv TV app to log into, which doesn't
      exist yet; this is groundwork, not urgent. Needs a device-
      authorization endpoint, a short human-typeable code + polling on
      the device side, and a verification page. Worth designing the
      approval page carefully: device-code flows have a known phishing
      pattern where someone's talked into approving a code that isn't
      theirs, so the page should make clear what's being authorized
      rather than a bare yes/no.

## Metadata & matching

- [ ] **IMDb ratings on Movies (and maybe TV Shows)** (2026-09-01 13:35 added)\
      The link groundwork now exists (`imdbId` on show/movie/episode
      detail responses, and an `imdb` `external_ids` row for the large
      majority of movies/shows already, see TODO_ARCHIVE.md), so this no
      longer needs its own id-fetching work, just the rating itself. IMDb
      has no public ratings API, so this means adding OMDb (omdbapi.com)
      as a genuinely new external integration: an optional `OMDB_API_KEY`
      env var (same "unset -> feature hides itself" pattern as
      `TMDB_API_KEY`/`TVDB_API_KEY`, `apps/api/src/env.ts`), a new cached
      `imdbRating` column on `movies` (and `shows` if TV is included, kept
      separate from `voteAverage` since that's TMDB's own rating on a
      different scale), and a second rating badge next to the TMDB one on
      the detail pages, linking to the same imdb.com URL as the existing
      link. OMDb's free tier is 1,000 requests/day, much tighter than
      TMDB's effectively uncapped one, so this likely can't fold into the
      existing 6-month compliance refresh sweep
      (`apps/api/src/metadata/refresh.ts`) the way TMDB/TVDB fields do;
      more realistic is fetch-once-and-cache plus the existing manual
      refresh button. Worth checking OMDb's ToS for self-hosted use at
      this scale before committing to it. Movies-only vs. Movies+TV Shows
      is a small code delta either way (OMDb's `i=` lookup works
      identically for both); the real constraint is the daily quota.
- [ ] **TVDB `remoteIds` → `imdb` id mapping** (2026-09-01 added)\
      `TvdbProvider` (`apps/api/src/providers/tvdb.ts`) never populates
      `imdbId`: every `getMovie`/`getShow`/`getEpisode` call returns
      `imdbId: null`, deliberately left out of scope when the IMDb deep
      link shipped (see TODO_ARCHIVE.md) since TMDB alone already covers
      ~99% of the reference library. TVDB v4's extended movie/series
      records do carry a `remoteIds` array (imdb entries have
      `sourceName: "IMDB"`); whether `short: 'true'` (used on every
      `/extended` call today) strips it needs checking live before
      mapping it in. When this lands, episodes already marked
      `imdb_checked_at` under a TVDB-primary show need a targeted reset
      (`UPDATE episodes SET imdb_checked_at = NULL ...` scoped to those
      shows) or they'll never get re-checked against the newly-available
      source.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28; M4)\
      Plex's own webhook shipped 2026-08-24 (see `docs/TODO_ARCHIVE.md`):
      the entity-resolution/auth core it's built on
      (`apps/api/src/lib/external-match.ts`,
      `apps/api/src/lib/api-tokens.ts`) is deliberately source-agnostic,
      so each of these is "write one payload parser + one route," not a
      rework. Tautulli's webhook body is fully user-templated (no fixed
      shape, needs its own JSON template + setup docs, unlike Plex's
      fixed format), which is why it wasn't bundled into the same pass.
      James, 2026-08-24: not needed to close out M2. ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3; no strong reason it belongs there either.
- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26; Not yet scheduled)\
      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26, see
      ROADMAP.md's M3 framing).
- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26, M4'd 2026-08-28; M4)\
      A view of what's airing next across the shows you're following.
- [ ] **OIDC login** (2026-08-23 15:34 added, un-M3'd 2026-08-26; Not yet scheduled)\
      The `user_credentials` schema was designed for this from M1; see
      [ADR 0003](adr/0003-auth-model.md).
- [ ] **Additional locales beyond English** (2026-08-26 added; Not yet scheduled)\
      en-GB/en-US both ship today; more locales is pure expansion, not
      something the core logging loop needs.
- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added; Not yet scheduled)\
      Installable/add-to-home-screen support.
- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added; Not yet scheduled)\
      A public view of a user's watch history/stats.
