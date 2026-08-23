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

## Dashboard

- [ ] **"Up Next" row** (2026-08-21 23:00 added)\
      Next _airing_ episode of any incomplete show the user has an
      existing watch for and hasn't dropped. Same one-row cap and
      mobile-layout caveat as On Deck above. Needs air-date data the
      season/episode fetch already carries (`firstAired`) — the first
      airing after "now" with no logged watch.

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
