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
