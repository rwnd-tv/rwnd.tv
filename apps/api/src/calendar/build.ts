import { and, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm'
import { UNKNOWN_WATCHED_AT, type CalendarEventKind, type PlayMediaSummary } from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { episodes, movies, plays, shows, users, type calendarFeeds } from '@rwnd/db'
import type { IcsAllDayEvent, IcsEvent, IcsTimedEvent } from '../lib/ics.js'
import { getFollowedShows } from '../lib/followed-shows.js'
import { getFollowedMovies } from '../lib/followed-movies.js'
import { localeRegion, releaseDateExpr } from '../lib/release-date.js'
import { episodeDisplayTitle } from '../lib/media.js'

/**
 * Superset of `IcsEvent` carrying the extra fields the in-app calendar's
 * JSON endpoint needs (`buildCalendarTimeline` below) that the `.ics` feed
 * has no use for — poster art, a slug/season/episode to link to, and
 * watched/spoiler flags. TypeScript's structural typing means this stays
 * assignable wherever `IcsEvent` is expected (buildEvent in lib/ics.ts only
 * ever reads the narrower fields), so `buildCalendarEvents` below and its
 * `.ics` route caller need no changes — the three builders just construct
 * a few extra fields on the same object they already build today.
 */
interface CalendarEventExtras {
  kind: CalendarEventKind
  media: PlayMediaSummary
  watched: boolean
  /** `user.spoilerProtectionEnabled && !watched` — see buildShowsEvents'/
   * buildMoviesEvents' existing `description` omission for the .ics
   * equivalent of this same check. Always false for a history event
   * (already watched by construction, same reasoning as that event's own
   * "no spoiler check here" comment). */
  spoilerHidden: boolean
  /** The raw synopsis, no link appended, no spoiler omission — distinct
   * from `description` above, which is the .ics-shaped value. */
  overview: string | null
}

export type CalendarSourceEvent = (IcsAllDayEvent | IcsTimedEvent) & CalendarEventExtras

/**
 * Hard ceiling on VEVENTs in one feed. A user with tens of thousands of
 * plays, or one following many shows with `futureOnly` off, would
 * otherwise regenerate a multi-megabyte body on every poll from every
 * device — there's no caching layer in front of this route (see
 * routes/calendar.ts's `Cache-Control: no-store`). Applied after
 * ordering, so it's always the N most relevant, not an arbitrary N.
 */
const MAX_CALENDAR_EVENTS = 5000

/** Which calendar day `instant` falls on, as seen from `timeZone` —
 * 'en-CA' because it formats as YYYY-MM-DD natively (confirmed: this is
 * not an approximation, it's how that locale actually renders a date).
 * `users.timezone` is unvalidated free text (packages/shared's
 * updateProfileRequestSchema accepts any string), so an unrecognized
 * zone must fall back to UTC rather than throwing and 500ing the whole
 * feed. */
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }
}

function localDay(instant: Date, timeZone: string): string {
  return dayFormatter(timeZone).format(instant)
}

/** The later of two timestamps, one of which may not exist yet. Used to
 * pick each event's DTSTAMP: a plain `createdAt` alone would never
 * advance again once a play is logged or an episode row is first
 * inserted, so a client has no signal to re-fetch an event whose
 * description text was filled in later by the overview backfill
 * (apps/api/src/metadata/refresh.ts) — confirmed live, 2026-09-04: a
 * description backfilled after a feed's first fetch stayed invisible in
 * a real client until DTSTAMP started reflecting it too. */
function latestOf(a: Date, b: Date | null): Date {
  return b && b > a ? b : a
}

/** Appends a link to a description, blank-line separated when there's
 * already description text — omitted entirely (not even the blank line)
 * when there's no link (`baseUrl` isn't configured on this instance). */
function withLink(description: string | undefined, link: string | undefined): string | undefined {
  if (!link) return description
  return description ? `${description}\n\n${link}` : link
}

function episodeSummary(
  showTitle: string,
  seasonNumber: number,
  episodeNumber: number,
  title: string | null,
) {
  const code = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
  return title ? `${showTitle} — ${code} ${title}` : `${showTitle} — ${code}`
}

// Duration for a history event whose own runtime, and its show's sibling
// median (see runtimeForRow below), are both unavailable — rare enough in
// practice (38 of 10,701 real episode plays on the reference instance,
// always a whole season TMDB never had a runtime for at all) that a fixed
// guess isn't worth the complexity of a movie-shaped vs. episode-shaped
// default. It only ever means "no better number was findable," never a
// real duration.
const DEFAULT_RUNTIME_MINUTES = 30

/** A history row's own runtime, or (for an episode) the median runtime of
 * other episodes of the same show, or the flat default above — in that
 * order. `medianByShowId` covers only shows where at least one row in
 * this feed actually needs it; see its own construction in
 * buildHistoryEvents. */
function runtimeForRow(
  row: {
    movieRuntimeMinutes: number | null
    episodeRuntimeMinutes: number | null
    showId: string | null
  },
  medianByShowId: Map<string, number>,
): number {
  const own = row.showId === null ? row.movieRuntimeMinutes : row.episodeRuntimeMinutes
  if (own !== null) return own
  const median = row.showId !== null ? medianByShowId.get(row.showId) : undefined
  return median ?? DEFAULT_RUNTIME_MINUTES
}

/**
 * A fresh query against `plays` rather than reusing export/build.ts's
 * history-gathering — that one is tightly coupled to CSV column layout
 * and pulls ratings/watchlist/dropped this feed doesn't want. Uses
 * `plays_user_watched_at_idx` directly (packages/db/src/schema.ts).
 */
interface HistoryEventOptions {
  includeMovies: boolean
  includeShows: boolean
  /** Inclusive bounds on `plays.watchedAt` — both omitted on the `.ics`
   * feed path, which has no date range at all (just `ORDER BY` + `LIMIT`).
   * Only `buildCalendarTimeline` below sets these. */
  after?: Date
  before?: Date
  baseUrl: string | undefined
}

async function buildHistoryEvents(
  db: Database,
  user: typeof users.$inferSelect,
  opts: HistoryEventOptions,
): Promise<CalendarSourceEvent[]> {
  if (!opts.includeMovies && !opts.includeShows) return []

  const typeFilter = opts.includeMovies
    ? opts.includeShows
      ? undefined
      : isNotNull(plays.movieId)
    : isNotNull(plays.episodeId)

  const rows = await db
    .select({
      playId: plays.id,
      watchedAt: plays.watchedAt,
      createdAt: plays.createdAt,
      movieTitle: movies.title,
      movieYear: movies.year,
      movieSlug: movies.slug,
      moviePosterPath: movies.posterPath,
      movieOverview: movies.overview,
      movieMetadataRefreshedAt: movies.metadataRefreshedAt,
      movieRuntimeMinutes: movies.runtimeMinutes,
      showId: shows.id,
      showSlug: shows.slug,
      showTitle: shows.title,
      showPosterPath: shows.posterPath,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeTitle: episodes.title,
      episodeOverview: episodes.overview,
      episodeOverviewCheckedAt: episodes.overviewCheckedAt,
      episodeRuntimeMinutes: episodes.runtimeMinutes,
    })
    .from(plays)
    .leftJoin(movies, eq(movies.id, plays.movieId))
    .leftJoin(episodes, eq(episodes.id, plays.episodeId))
    .leftJoin(shows, eq(shows.id, episodes.showId))
    .where(
      and(
        eq(plays.userId, user.id),
        // Trakt's "I don't remember when" backfill sentinel
        // (1900-01-01, packages/shared's UNKNOWN_WATCHED_AT) is not a
        // real watch date — excluded the same way every other aggregate
        // over `plays` excludes it (see routes/library/shared.ts's
        // watchedRangeFragments).
        ne(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT)),
        typeFilter,
        opts.after ? gte(plays.watchedAt, opts.after) : undefined,
        opts.before ? lte(plays.watchedAt, opts.before) : undefined,
      ),
    )
    // Newest first — this is also what makes `rows[i + 1]` the
    // chronologically *previous* play for the overlap clamp below,
    // without a second pass or a re-sort.
    .orderBy(desc(plays.watchedAt))
    .limit(MAX_CALENDAR_EVENTS)

  // The oldest row in a *windowed* query (opts.after set) has its true
  // chronologically-previous play sitting just outside the window, so
  // `rows[i + 1]` alone would silently disagree with the unwindowed
  // overlap clamp at that one boundary row. A single extra lookup for
  // "the closest play before the window" fixes it — same "separate
  // top-level query rather than a nested fragment" shape as the median
  // query below, for an analogous reason (keeping this simple rather than
  // risking another joinless-subquery qualifier bug).
  let previousBeforeWindow: { watchedAt: Date } | undefined
  if (opts.after) {
    const [row] = await db
      .select({ watchedAt: plays.watchedAt })
      .from(plays)
      .where(
        and(
          eq(plays.userId, user.id),
          ne(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT)),
          typeFilter,
          lt(plays.watchedAt, opts.after),
        ),
      )
      .orderBy(desc(plays.watchedAt))
      .limit(1)
    previousBeforeWindow = row
  }

  // One extra query for the shows whose sibling-episode runtime median
  // this feed actually needs — not a subquery nested inside the query
  // above: docs/TODO_ARCHIVE.md records a live bug where a raw `sql`
  // fragment nested inside a joinless Drizzle query silently lost its own
  // column qualifiers, and a separate top-level query sidesteps that
  // shape entirely. `percentile_cont` itself ignores NULL inputs, so this
  // is correctly "the median of the episodes that do have a runtime."
  const showIdsNeedingMedian = [
    ...new Set(
      rows
        .filter((row) => row.showId !== null && row.episodeRuntimeMinutes === null)
        .map((row) => row.showId!),
    ),
  ]
  const medianByShowId = new Map<string, number>()
  if (showIdsNeedingMedian.length > 0) {
    const medianRows = await db
      .select({
        showId: episodes.showId,
        median: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${episodes.runtimeMinutes})`,
      })
      .from(episodes)
      .where(inArray(episodes.showId, showIdsNeedingMedian))
      .groupBy(episodes.showId)
    for (const row of medianRows) {
      if (row.median !== null) medianByShowId.set(row.showId, Math.round(row.median))
    }
  }

  return rows.map((row, i) => {
    // `watchedAt` records when playback *finished*, not when it started —
    // every producer of it agrees. Plex's `media.scrobble` webhook fires
    // at its own "watched" threshold near the end of playback
    // (apps/api/src/routes/webhooks.ts sets it to `new Date()` on
    // receipt), and the manual watch-date dialog's default mode is
    // literally "justFinished" — its "now watching" mode computes `now +
    // runtime` as the *predicted finish* rather than logging a start
    // (apps/web/src/components/library/WatchDateDialog.tsx). Confirmed
    // live 2026-09-05 with a controlled watch: the recorded `watchedAt`
    // landed 89% through the episode's real runtime, not at its start —
    // consistent with Plex's own threshold, nowhere close to either end.
    const end = row.watchedAt
    const durationMs = runtimeForRow(row, medianByShowId) * 60_000
    let start = new Date(end.getTime() - durationMs)

    // Push the start later if it would overlap the *previous* play
    // chronologically — rows are ordered newest-first, so that's
    // rows[i + 1], or (only for the oldest row in a windowed query)
    // previousBeforeWindow, fetched above. A tied timestamp (a bulk import
    // commonly logs several plays at once) is not "preceding," so it isn't
    // clamped: those plays keep their full runtime and stack, an honest
    // picture of what actually happened, rather than collapsing to
    // zero-length events.
    const previous = rows[i + 1] ?? (i === rows.length - 1 ? previousBeforeWindow : undefined)
    if (
      previous &&
      previous.watchedAt.getTime() < end.getTime() &&
      previous.watchedAt.getTime() > start.getTime()
    ) {
      start = previous.watchedAt
    }

    return {
      uid: `play-${row.playId}@rwnd.tv`,
      start,
      end,
      summary:
        row.movieTitle !== null
          ? row.movieYear !== null
            ? `${row.movieTitle} (${row.movieYear})`
            : row.movieTitle
          : episodeSummary(row.showTitle!, row.seasonNumber!, row.episodeNumber!, row.episodeTitle),
      // No spoiler check here, unlike buildShowsEvents below — every entry
      // in History is, by construction, something the user has already
      // watched, so there's nothing left to spoil.
      description: withLink(
        (row.movieTitle !== null ? row.movieOverview : row.episodeOverview) ?? undefined,
        !opts.baseUrl
          ? undefined
          : row.movieTitle !== null
            ? `${opts.baseUrl}/movies/${row.movieSlug!}`
            : `${opts.baseUrl}/shows/${row.showSlug!}/season/${row.seasonNumber!}/episode/${row.episodeNumber!}`,
      ),
      // See latestOf's own doc comment — the play's own createdAt alone
      // would never reflect a description backfilled after the fact.
      stamp: latestOf(
        row.createdAt,
        row.movieTitle !== null ? row.movieMetadataRefreshedAt : row.episodeOverviewCheckedAt,
      ),
      kind: 'watch',
      media:
        row.movieTitle !== null
          ? {
              type: 'movie',
              title: row.movieTitle,
              posterPath: row.moviePosterPath,
              movieSlug: row.movieSlug ?? undefined,
            }
          : {
              type: 'episode',
              title: episodeDisplayTitle(
                row.episodeTitle,
                row.seasonNumber ?? undefined,
                row.episodeNumber ?? undefined,
              ),
              posterPath: row.showPosterPath,
              showTitle: row.showTitle ?? undefined,
              showSlug: row.showSlug ?? undefined,
              seasonNumber: row.seasonNumber ?? undefined,
              episodeNumber: row.episodeNumber ?? undefined,
            },
      // A history entry is watched by construction — nothing left to
      // spoil, same reasoning as the `description` comment above.
      watched: true,
      spoilerHidden: false,
      overview: row.movieTitle !== null ? row.movieOverview : row.episodeOverview,
    }
  })
}

/**
 * Reads only from the already-cached `episodes` table — no live provider
 * fetch, unlike Up Next's `findNextAiringEpisode` (routes/library/
 * queue.ts). `episodes.firstAired` is a Drizzle `date()` column in
 * string mode ('YYYY-MM-DD'), so the range comparison below is a plain
 * string comparison with no timezone round-trip risk.
 */
interface ShowsEventOptions {
  includeDropped: boolean
  futureOnly: boolean
  includeAllWatched: boolean
  /** Inclusive bounds on `episodes.firstAired` ('YYYY-MM-DD'), plain
   * string comparisons like `futureOnly`'s own gate — both AND together
   * fine. Only `buildCalendarTimeline` below sets these. */
  fromDay?: string
  toDay?: string
  baseUrl: string | undefined
}

async function buildShowsEvents(
  db: Database,
  user: typeof users.$inferSelect,
  opts: ShowsEventOptions,
): Promise<CalendarSourceEvent[]> {
  const followed = await getFollowedShows(db, user.id, {
    includeDropped: opts.includeDropped,
    windowDays: opts.includeAllWatched ? null : undefined,
  })
  if (followed.length === 0) return []

  const today = localDay(new Date(), user.timezone)
  const showsById = new Map(followed.map((show) => [show.id, show]))

  const rows = await db
    .select({
      episodeId: episodes.id,
      showId: episodes.showId,
      createdAt: episodes.createdAt,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      title: episodes.title,
      firstAired: episodes.firstAired,
      overview: episodes.overview,
      overviewCheckedAt: episodes.overviewCheckedAt,
      // A LEFT JOIN, aggregated with bool_or rather than a correlated
      // EXISTS subquery — found the hard way (live, 2026-09-04): with
      // this query's FROM being `episodes` alone (no join), Drizzle
      // renders every column reference unqualified (safe at the outer
      // level, since there's only one table in scope there) — but that
      // same blanket un-qualification also stripped the table prefix
      // inside this fragment's own nested subquery, where "id" is
      // ambiguous between the correlated `episodes.id` and the
      // subquery's own local `plays.id`. Postgres resolved the bare
      // "id" to the innermost table (`plays.id`), so the EXISTS check
      // silently compared a play against its own row id and was always
      // false. A real JOIN forces every reference to be qualified
      // (needed for real disambiguation now), which this bug can't
      // survive — grouping by `episodes.id` alone is enough per
      // Postgres's primary-key functional-dependency rule, so the other
      // episode columns don't need to be repeated in GROUP BY.
      watched: sql<boolean>`bool_or(${plays.id} is not null)`,
    })
    .from(episodes)
    .leftJoin(plays, and(eq(plays.episodeId, episodes.id), eq(plays.userId, user.id)))
    .where(
      and(
        inArray(
          episodes.showId,
          followed.map((show) => show.id),
        ),
        isNotNull(episodes.firstAired),
        opts.futureOnly ? gte(episodes.firstAired, today) : undefined,
        opts.fromDay ? gte(episodes.firstAired, opts.fromDay) : undefined,
        opts.toDay ? lte(episodes.firstAired, opts.toDay) : undefined,
      ),
    )
    .groupBy(episodes.id)
    // Newest first so MAX_CALENDAR_EVENTS keeps the most relevant window
    // when futureOnly is off; output order doesn't matter to a
    // subscribing client, which sorts on its own.
    .orderBy(desc(episodes.firstAired))
    .limit(MAX_CALENDAR_EVENTS)

  return rows.map((row) => ({
    uid: `episode-${row.episodeId}@rwnd.tv`,
    date: row.firstAired!,
    summary: episodeSummary(
      showsById.get(row.showId)!.title,
      row.seasonNumber,
      row.episodeNumber,
      row.title,
    ),
    // Same rule EpisodeDetailPage.tsx's `spoilerHidden` uses in the UI
    // (apps/web/src/routes/EpisodeDetailPage.tsx) — there it's a CSS
    // blur-until-clicked, but an ICS event has no such mechanism, so a
    // spoiler-hidden synopsis has to be omitted outright rather than
    // sent and hidden client-side. The link itself is never withheld —
    // it points at the episode's own page, which applies this same
    // spoiler rule again client-side.
    description: withLink(
      user.spoilerProtectionEnabled && !row.watched ? undefined : (row.overview ?? undefined),
      opts.baseUrl
        ? `${opts.baseUrl}/shows/${showsById.get(row.showId)!.slug}/season/${row.seasonNumber}/episode/${row.episodeNumber}`
        : undefined,
    ),
    // See latestOf's own doc comment.
    stamp: latestOf(row.createdAt, row.overviewCheckedAt),
    kind: 'episode',
    media: {
      type: 'episode',
      title: episodeDisplayTitle(row.title, row.seasonNumber, row.episodeNumber),
      posterPath: showsById.get(row.showId)!.posterPath,
      showTitle: showsById.get(row.showId)!.title,
      showSlug: showsById.get(row.showId)!.slug,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
    },
    watched: row.watched,
    spoilerHidden: user.spoilerProtectionEnabled && !row.watched,
    overview: row.overview,
  }))
}

/**
 * Movie release dates, region-resolved per user — the Movies calendar
 * feed. Structurally a clone of buildShowsEvents above: same all-day
 * shape, same futureOnly-as-string-compare gate, same leftJoin+bool_or
 * watched flag (see that query's own comment for why this can't be a
 * correlated EXISTS). The one real difference is that the date being
 * filtered/ordered/limited on is a SQL expression (releaseDateExpr,
 * apps/api/src/lib/release-date.ts) rather than a plain column — legal
 * everywhere a column would be (WHERE, ORDER BY, and under GROUP BY
 * movies.id, by the same primary-key functional-dependency rule
 * buildShowsEvents already relies on for episodes.id), so futureOnly
 * filtering and MAX_CALENDAR_EVENTS both apply to the *actual* per-user
 * resolved date, not the primary one.
 *
 * The candidate set here (watched-or-watchlisted movies) is inherently
 * far smaller than "every episode of every followed show", so
 * MAX_CALENDAR_EVENTS is a ceiling in this feed, not expected to bind.
 */
interface MoviesEventOptions {
  futureOnly: boolean
  includeAllWatched: boolean
  /** Inclusive bounds on the region-resolved release date ('YYYY-MM-DD'),
   * same convention as ShowsEventOptions' fromDay/toDay. Only
   * `buildCalendarTimeline` below sets these. */
  fromDay?: string
  toDay?: string
  baseUrl: string | undefined
}

async function buildMoviesEvents(
  db: Database,
  user: typeof users.$inferSelect,
  opts: MoviesEventOptions,
): Promise<CalendarSourceEvent[]> {
  const followed = await getFollowedMovies(db, user.id, {
    windowDays: opts.includeAllWatched ? null : undefined,
  })
  if (followed.length === 0) return []

  const today = localDay(new Date(), user.timezone)
  const region = localeRegion(user.locale)
  const moviesById = new Map(followed.map((movie) => [movie.id, movie]))

  const rows = await db
    .select({
      movieId: movies.id,
      createdAt: movies.createdAt,
      overview: movies.overview,
      metadataRefreshedAt: movies.metadataRefreshedAt,
      releaseDate: releaseDateExpr(region),
      watched: sql<boolean>`bool_or(${plays.id} is not null)`,
    })
    .from(movies)
    .leftJoin(plays, and(eq(plays.movieId, movies.id), eq(plays.userId, user.id)))
    .where(
      and(
        inArray(
          movies.id,
          followed.map((movie) => movie.id),
        ),
        isNotNull(releaseDateExpr(region)),
        opts.futureOnly ? gte(releaseDateExpr(region), today) : undefined,
        opts.fromDay ? gte(releaseDateExpr(region), opts.fromDay) : undefined,
        opts.toDay ? lte(releaseDateExpr(region), opts.toDay) : undefined,
      ),
    )
    .groupBy(movies.id)
    .orderBy(desc(releaseDateExpr(region)))
    .limit(MAX_CALENDAR_EVENTS)

  return rows.map((row) => {
    const movie = moviesById.get(row.movieId)!
    return {
      uid: `movie-${row.movieId}@rwnd.tv`,
      date: row.releaseDate!,
      // Uses `movie.year` (derived from the primary release date), which
      // can disagree with `row.releaseDate` (the user's regional date) by
      // a year for a movie releasing right around New Year's in one
      // region and not the other — accepted, same as the rest of this
      // feed's events staying brief; the movie's own detail page (which
      // shows the resolved date with a region flag) is where that gets
      // disambiguated.
      summary: movie.year !== null ? `${movie.title} (${movie.year})` : movie.title,
      // Same spoiler rule as buildShowsEvents — see that query's own
      // comment.
      description: withLink(
        user.spoilerProtectionEnabled && !row.watched ? undefined : (row.overview ?? undefined),
        opts.baseUrl ? `${opts.baseUrl}/movies/${movie.slug}` : undefined,
      ),
      stamp: latestOf(row.createdAt, row.metadataRefreshedAt),
      kind: 'release',
      media: {
        type: 'movie',
        title: movie.title,
        posterPath: movie.posterPath,
        movieSlug: movie.slug,
      },
      watched: row.watched,
      spoilerHidden: user.spoilerProtectionEnabled && !row.watched,
      overview: row.overview,
    }
  })
}

export async function buildCalendarEvents(
  db: Database,
  user: typeof users.$inferSelect,
  feed: typeof calendarFeeds.$inferSelect,
  /** This instance's own public URL (env.ts's `APP_URL`), or undefined
   * if unconfigured — an event simply gets no link in that case, same
   * "explicit rather than guessed" reasoning as APP_URL's own doc
   * comment (no reliable way to derive this from a request's Host
   * header behind an arbitrary reverse proxy). */
  baseUrl: string | undefined,
): Promise<IcsEvent[]> {
  // An exhaustive switch, not a ternary — see serializeCalendarFeed's own
  // comment (apps/api/src/lib/calendar-feeds.ts) for why, with three feed
  // types now.
  switch (feed.feedType) {
    case 'history':
      return buildHistoryEvents(db, user, {
        includeMovies: feed.includeMovies,
        includeShows: feed.includeShows,
        baseUrl,
      })
    case 'shows':
      return buildShowsEvents(db, user, {
        includeDropped: feed.includeDropped,
        futureOnly: feed.futureOnly,
        includeAllWatched: feed.includeAllWatched,
        baseUrl,
      })
    case 'movies':
      return buildMoviesEvents(db, user, {
        futureOnly: feed.futureOnly,
        includeAllWatched: feed.includeAllWatched,
        baseUrl,
      })
  }
}

/**
 * The in-app calendar page's merged timeline (`GET /calendar-events`,
 * apps/web/src/routes/CalendarPage.tsx) — a single, date-windowed,
 * ascending list combining what's already been watched with what's
 * coming next, unlike `buildCalendarEvents` above (one feed type at a
 * time, no date range, capped only by MAX_CALENDAR_EVENTS). Reuses the
 * same three builders rather than a parallel implementation, so the
 * runtime-fallback/overlap-clamp/region-resolution/spoiler logic they
 * already get right has exactly one home.
 *
 * The "watched" half (history) is unconditionally bounded by `window`;
 * the "upcoming" half (shows/movies) is unconditionally `futureOnly:
 * true` — that split, not a symmetric window, is what makes the merged
 * timeline read as "watched so far, then what's coming" rather than an
 * arbitrary date range. `includeAllWatched: true` (`windowDays: null`
 * inside getFollowedShows/getFollowedMovies) is the followed-candidate-set
 * default: a real calendar of everything you're following, not just the
 * last 30 days. `includeDropped: false` matches the existing feed
 * default; no UI toggle for either in v1. `baseUrl` is left unset on all
 * three — this JSON path builds its own hrefs from `media`, never an
 * embedded description link.
 *
 * Timezone note: `futureOnly`'s "today" inside the builders is resolved
 * via `user.timezone` (effectively always UTC — nothing in the app ever
 * sets that column), while `window` itself comes from the browser's local
 * time (every other frontend date path does the same, see
 * apps/web/src/lib/date.ts's `localDayStartISO` doc comment). This means
 * the in-app calendar and the subscribed `.ics` feed can disagree by up
 * to a day about "today" for a user outside UTC — an accepted,
 * pre-existing divergence, not something this function attempts to fix.
 *
 * Known, accepted overlap: an episode aired and watched today appears as
 * both an `episode` and a `watch` event — honest (it aired, and you
 * watched it), and `watched` distinguishes the two on the wire.
 */
export async function buildCalendarTimeline(
  db: Database,
  user: typeof users.$inferSelect,
  window: { after: Date; before: Date },
): Promise<CalendarSourceEvent[]> {
  // All-day bounds derived by UTC-day truncation of the instant window —
  // `after` is always a browser-local *start* of day and `before` a
  // browser-local *end* of day, so this truncation is never narrower than
  // the requested span and at most one day wider at each edge, whichever
  // side of UTC the browser is on. Widening is the safe direction: a
  // month grid only ever reads the cells it has, and an agenda view
  // showing one genuine extra edge day is harmless.
  const fromDay = window.after.toISOString().slice(0, 10)
  const toDay = window.before.toISOString().slice(0, 10)

  const [historyEvents, showsEvents, moviesEvents] = await Promise.all([
    buildHistoryEvents(db, user, {
      includeMovies: true,
      includeShows: true,
      after: window.after,
      before: window.before,
      baseUrl: undefined,
    }),
    buildShowsEvents(db, user, {
      includeDropped: false,
      futureOnly: true,
      includeAllWatched: true,
      fromDay,
      toDay,
      baseUrl: undefined,
    }),
    buildMoviesEvents(db, user, {
      futureOnly: true,
      includeAllWatched: true,
      fromDay,
      toDay,
      baseUrl: undefined,
    }),
  ])

  // Ascending by normalized date key, tie-broken by uid for a stable sort
  // — a convenience for the client, which regroups by *browser-local* day
  // regardless of this ordering.
  function sortKey(event: CalendarSourceEvent): string {
    return 'date' in event ? `${event.date}T00:00:00.000Z` : event.start.toISOString()
  }

  return [...historyEvents, ...showsEvents, ...moviesEvents].sort((a, b) => {
    const byDate = sortKey(a).localeCompare(sortKey(b))
    return byDate !== 0 ? byDate : a.uid.localeCompare(b.uid)
  })
}
