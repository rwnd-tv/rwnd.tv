# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- Blank line between each item.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40)\
      `typescript-eslint` doesn't support TS 7 yet; leave any TS 7.0
      Dependabot bump open until it does.

## TV Shows / Movies gallery follow-ups

- [ ] **Manual "refresh metadata" button** (2026-08-19 15:25)\
      The gallery's metadata refresher (see [ADR 0005](adr/0005-metadata-refresh.md))
      auto-refreshes airing shows and sweeps everything every ~5 months for
      TMDB compliance, but there's no per-show manual trigger yet for the
      case TMDB itself has something wrong. Needs a button plus a small
      `POST /library/shows/{id}/refresh`-style endpoint.
- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)\
      Shipped without `content-visibility`/windowing — real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.
- [ ] **Title-sort article stripping** (2026-08-19 15:25)\
      The gallery's title sort ("Sort by: Title") is a plain locale-aware
      string compare — "The Wire" sorts under T, not W. Real per-language
      leading-article rules are a bigger job than this feature needed; left
      as a known simplification.

## Settings page

- [ ] **Horizontal rule under each panel's title** (2026-08-21 23:00 added)\
      Every panel on `SettingsPage.tsx` (Profile, API tokens, Database,
      Instance settings) — add a horizontal line under the `<h2>` title,
      before the panel's body content.

- [ ] **Backups section above Clear database** (2026-08-21 23:00 added)\
      In `DatabasePanel.tsx`, reorder so the Backups section renders
      before the Clear database checkboxes/button, not after.

- [ ] **Confirmation dialog on Delete backup** (2026-08-21 23:00 added)\
      Delete currently fires immediately (matches `TokensPanel.tsx`'s
      Revoke button precedent) — James wants a confirm dialog before it
      actually deletes the file, same shape as Restore's existing
      confirmation.

## TV Show pages

- [ ] **Previous/next season navigation on the season page** (2026-08-21 23:00 added)\
      `SeasonDetailPage.tsx` — add `<`/`>` buttons to jump to the
      previous/next season without going back through the show page.

- [ ] **Episode pages** (2026-08-21 23:00 added)\
      No dedicated page per episode yet — only the season grid
      (`SeasonDetailPage.tsx`) and its inline watch toggle. Needs
      scoping: what an episode page shows beyond what the season grid
      already does (overview, still image, watched toggle).

## Terminology

- [ ] **"TV Show" vs "Show" consistency pass** (2026-08-21 23:00 added)\
      Site-wide audit — James wants the full "TV Show" used consistently
      rather than "Show" wherever it currently appears (nav label,
      headings, filter panel copy, etc.), in both en-GB and fr-FR.

## Dashboard

- [ ] **"On Deck" row** (2026-08-21 23:00 added)\
      Next unwatched episode of any incomplete show with a watch logged
      in the last ~30 days (exact window TBD) and not dropped. One row,
      capped at a single row's worth of cards — needs a mobile-specific
      treatment since a single row of poster cards won't fit well narrow.

- [ ] **"Up Next" row** (2026-08-21 23:00 added)\
      Next _airing_ episode of any incomplete show the user has an
      existing watch for and hasn't dropped. Same one-row cap and
      mobile-layout caveat as On Deck above. Needs air-date data the
      season/episode fetch already carries (`firstAired`) — the first
      airing after "now" with no logged watch.

## General

- [ ] **A way to log an additional watch without going through History** (2026-08-21 23:00 added)\
      Right now logging a rewatch of something already fully watched
      means going to the History page. James wants a more direct
      mechanism — exact UX still to be decided (e.g. a "log another
      watch" action from the show/season/episode page itself).

## Spoiler protection

- [ ] **Blur/hide spoiler content for unwatched episodes** (2026-08-22 10:45 added)\
      Thumbnails/stills, overview text, and any other spoiler-ish detail
      (title? air date?) for an episode the user hasn't logged a watch
      for yet should be blurred or hidden by default — mainly
      `SeasonDetailPage.tsx`'s episode grid today, and any future episode
      page (see the "Episode pages" item above — these two should be
      scoped together). Needs a reveal interaction (click/tap to unblur
      one episode) rather than being permanently hidden. Must be a
      per-user toggle on `SettingsPage.tsx` (new panel or folded into an
      existing one) — default state and exact scope of "spoiler-ish"
      still to be decided with James.

## Metadata & matching

- [ ] **Multi-provider metadata (tmdb/imdb/tvdb)** (2026-08-11 22:20)\
      Right now tmdb id is the only key — a title with no tmdb id
      can't be imported even if it has imdb/tvdb ids (hit this live
      importing Formula 1 via Trakt; TMDB doesn't carry it). Idea: a
      new internal id independent of any single provider, an
      admin-configurable provider priority order, and a manual
      per-title "refresh metadata" action rather than silent
      background updates (explicit preference — don't want metadata
      changing behind anyone's back). Also want a UI indicator on
      show/movie pages showing which provider the current metadata
      came from. Also added to [ROADMAP.md](ROADMAP.md) M2 — fairly
      fundamental, not deferred to "not yet scheduled".
