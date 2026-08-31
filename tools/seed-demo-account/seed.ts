/**
 * Populates a demo account with curated watch history, ratings and
 * watchlists via the running instance's own HTTP API: the same API the
 * real app and every real client use, so this never drifts from what the
 * app actually accepts. Meant to run right before the screenshot tool
 * (../screenshots), on the same throwaway account, so the screenshots have
 * something real to show without touching anyone's personal data.
 *
 * Usage:
 *   BASE_URL=https://dev.rwnd.tv EMAIL=demo@example.com PASSWORD=... pnpm start
 *
 * BASE_URL defaults to http://localhost:3000. See README.md. In
 * particular, registration needs the instance to have email configured and
 * registration open (or an invite code); if it isn't, create the account
 * once by hand and every subsequent run only needs login.
 *
 * Reproducible by construction: every run starts with POST
 * /account/clear-data (history, ratings, watchlists, dropped shows), then
 * reseeds from titles.ts from scratch. Never additive, so running this
 * twice in a row leaves the account in the same state as running it once.
 */
import {
  WATCHED_MOVIES,
  WATCHED_SHOWS,
  WATCHLISTED_MOVIES,
  WATCHLISTED_SHOWS,
  CUSTOM_WATCHLISTS,
} from './titles.js'

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const EMAIL = requireEnv('EMAIL')
const PASSWORD = requireEnv('PASSWORD')
const DISPLAY_NAME = process.env.DISPLAY_NAME ?? 'Demo Account'
const LOCALE = process.env.LOCALE ?? 'en-US'
const INVITE_CODE = process.env.INVITE_CODE

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required env var ${name}. See README.md.`)
    process.exit(1)
  }
  return value
}

// ---------------------------------------------------------------------------
// Tiny cookie-jar fetch client: a session cookie is all auth this needs,
// so a full HTTP client library would be overkill.
// ---------------------------------------------------------------------------

let cookie: string | null = null

class ApiError extends Error {
  constructor(
    public method: string,
    public path: string,
    public status: number,
    public body: unknown,
  ) {
    super(`${method} ${path} -> ${status}: ${JSON.stringify(body)}`)
  }
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: { allow?: number[] } = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0] ?? null

  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined)

  if (!res.ok && !(opts.allow ?? []).includes(res.status)) {
    throw new ApiError(method, path, res.status, data)
  }
  return { status: res.status, data: data as T }
}

// ---------------------------------------------------------------------------
// Account bootstrap
// ---------------------------------------------------------------------------

async function login(): Promise<boolean> {
  const { status } = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, {
    allow: [401],
  })
  return status === 200
}

async function register(): Promise<void> {
  const { status, data } = await api(
    'POST',
    '/auth/register',
    {
      email: EMAIL,
      password: PASSWORD,
      displayName: DISPLAY_NAME,
      locale: LOCALE,
      ...(INVITE_CODE ? { inviteCode: INVITE_CODE } : {}),
    },
    { allow: [403, 409] },
  )
  if (status === 403) {
    console.error(
      'Registration is not available on this instance (email not configured, ' +
        'registration closed, or an invite code is required: set INVITE_CODE). ' +
        `Server said: ${JSON.stringify(data)}\n` +
        'Create the account once by hand instead, then rerun this script; only ' +
        'the first run needs registration to work.',
    )
    process.exit(1)
  }
  // 409 (already exists) is fine here: a race with another run, or the
  // account exists but the earlier login attempt failed for some other
  // reason. Either way, fall through and try to log in again below.
  if (status === 201 || status === 409) return
}

async function ensureAccount(): Promise<void> {
  if (await login()) {
    console.log(`Logged in as ${EMAIL}.`)
    return
  }
  console.log(`No existing session for ${EMAIL}; registering.`)
  await register()
  if (!(await login())) {
    throw new Error(`Registered ${EMAIL} but could not log in afterwards.`)
  }
  console.log(`Registered and logged in as ${EMAIL}.`)
}

// ---------------------------------------------------------------------------
// Search / resolve
// ---------------------------------------------------------------------------

interface SearchResult {
  type: 'movie' | 'show'
  source: string
  externalId: string
  title: string
  year: number | null
}

/** Best-effort title match: prefers an exact year match, falls back to the
 * first result of the right type, null if nothing came back at all. */
async function search(
  title: string,
  type: 'movie' | 'show',
  year?: number,
): Promise<SearchResult | null> {
  const { data } = await api<{ results: SearchResult[] }>(
    'GET',
    `/search?q=${encodeURIComponent(title)}&type=${type}`,
  )
  if (data.results.length === 0) return null
  if (year !== undefined) {
    const exact = data.results.find((r) => r.year === year)
    if (exact) return exact
  }
  return data.results[0] ?? null
}

/** Resolve to a local slug without logging a watch, for watchlist-only
 * (not-yet-watched) titles. */
async function resolve(result: SearchResult): Promise<string> {
  const path = result.type === 'movie' ? '/library/movies/resolve' : '/library/shows/resolve'
  const { data } = await api<{ slug: string }>('POST', path, {
    source: result.source,
    externalId: result.externalId,
  })
  return data.slug
}

const resolvedSlugs = new Map<string, string>() // "movie:Title" | "show:Title" -> slug

async function resolveCached(title: string, type: 'movie' | 'show'): Promise<string | null> {
  const key = `${type}:${title}`
  const cached = resolvedSlugs.get(key)
  if (cached) return cached
  const found = await search(title, type)
  if (!found) {
    console.warn(`  skip: no ${type} search result for "${title}"`)
    return null
  }
  const slug = await resolve(found)
  resolvedSlugs.set(key, slug)
  return slug
}

// ---------------------------------------------------------------------------
// Watching, rating, watchlisting
// ---------------------------------------------------------------------------

function daysAgo(days: number): string {
  // Clamped to at least 1 day ago: POST /plays rejects a future
  // watchedAt outright, and this is meant to degrade gracefully (a
  // slightly-off date), not fail the run, if the spacing math above is
  // ever thrown off by a future titles.ts edit.
  return new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString()
}

async function getVoteAverage(slug: string, type: 'movie' | 'show'): Promise<number | null> {
  const path = type === 'movie' ? `/library/movies/${slug}` : `/library/shows/${slug}`
  const { data } = await api<{ voteAverage: number | null }>('GET', path)
  return data.voteAverage
}

async function rate(slug: string, type: 'movie' | 'show'): Promise<void> {
  const voteAverage = await getVoteAverage(slug, type)
  if (voteAverage === null) {
    console.warn(`  skip rating ${slug}: no consensus vote average cached yet`)
    return
  }
  const rating = Math.min(10, Math.max(1, Math.round(voteAverage)))
  const path = type === 'movie' ? `/library/movies/${slug}/rating` : `/library/shows/${slug}/rating`
  await api('PUT', path, { rating })
}

async function seedWatchedMovies(): Promise<void> {
  console.log(`Watching ${WATCHED_MOVIES.length} movies...`)
  const spacingDays = 270 / WATCHED_MOVIES.length
  for (const [i, movie] of WATCHED_MOVIES.entries()) {
    const found = await search(movie.title, 'movie', movie.year)
    if (!found) {
      console.warn(`  skip: no search result for "${movie.title}" (${movie.year})`)
      continue
    }
    const watchedAt = daysAgo(Math.round(i * spacingDays + Math.random() * 8))
    const { data } = await api<{ media: { movieSlug: string } }>('POST', '/plays', {
      movie: { source: found.source, externalId: found.externalId },
      watchedAt,
    })
    resolvedSlugs.set(`movie:${movie.title}`, data.media.movieSlug)

    // Rate roughly every other watched movie, close to consensus.
    if (i % 2 === 0) await rate(data.media.movieSlug, 'movie')
    console.log(`  watched: ${movie.title}`)
  }
}

// The Dashboard's Continue Watching / Upcoming rows (queue.ts's On Deck /
// Up Next) only look at a show's *most recently watched* episode, and only
// within this same window, matching DASHBOARD_ROW_WINDOW_DAYS there. Every
// show's last-watched episode needs to land inside it, or that show simply
// can't appear in either row no matter how much history it has.
const DASHBOARD_WINDOW_DAYS = 30
const EPISODE_GAP_DAYS = 1.5

async function seedWatchedShows(): Promise<void> {
  console.log(`Watching ${WATCHED_SHOWS.length} shows...`)
  // Spreads each show's most-recent watch across the last ~4 weeks (2 to 27
  // days ago) rather than its whole history: a show's *earliest* logged
  // episode can and does land further back than that, only the latest one
  // is constrained.
  for (const [i, show] of WATCHED_SHOWS.entries()) {
    const found = await search(show.title, 'show', show.year)
    if (!found) {
      console.warn(`  skip: no search result for "${show.title}" (${show.year})`)
      continue
    }
    const daysAgoMostRecent =
      2 + (i * (DASHBOARD_WINDOW_DAYS - 5)) / Math.max(1, WATCHED_SHOWS.length - 1)
    const showStart = daysAgoMostRecent + (show.episodes.length - 1) * EPISODE_GAP_DAYS
    let showSlug: string | null = null
    for (const [epIndex, episodeNumber] of show.episodes.entries()) {
      const watchedAt = daysAgo(Math.round(showStart - epIndex * EPISODE_GAP_DAYS))
      const { status, data } = await api<{ media: { showSlug: string } }>(
        'POST',
        '/plays',
        {
          episode: {
            source: found.source,
            showExternalId: found.externalId,
            seasonNumber: 1,
            episodeNumber,
          },
          watchedAt,
        },
        { allow: [400] },
      )
      if (status === 400) {
        console.warn(`  skip: ${show.title} S1E${episodeNumber} not available yet`)
        continue
      }
      showSlug = data.media.showSlug
    }
    if (!showSlug) continue
    resolvedSlugs.set(`show:${show.title}`, showSlug)
    if (i % 2 === 0) await rate(showSlug, 'show')
    console.log(`  watched: ${show.title} (${show.episodes.length} episodes)`)
  }
}

async function getDefaultWatchlistId(): Promise<string> {
  const { data } = await api<{ watchlists: { id: string; isDefault: boolean }[] }>(
    'GET',
    '/watchlists',
  )
  const def = data.watchlists.find((w) => w.isDefault)
  if (!def) throw new Error('No Default watchlist found; expected one to always exist.')
  return def.id
}

async function seedWatchlistedFuture(defaultWatchlistId: string): Promise<void> {
  console.log('Adding upcoming titles to the watchlist...')
  for (const movie of WATCHLISTED_MOVIES) {
    const slug = await resolveCached(movie.title, 'movie')
    if (!slug) continue
    await api('PUT', `/library/movies/${slug}/watchlists/${defaultWatchlistId}`)
    console.log(`  watchlisted: ${movie.title}`)
  }
  for (const show of WATCHLISTED_SHOWS) {
    const slug = await resolveCached(show.title, 'show')
    if (!slug) continue
    await api('PUT', `/library/shows/${slug}/watchlists/${defaultWatchlistId}`)
    console.log(`  watchlisted: ${show.title}`)
  }
}

async function seedCustomWatchlists(): Promise<void> {
  console.log(`Creating ${CUSTOM_WATCHLISTS.length} custom watchlists...`)
  for (const list of CUSTOM_WATCHLISTS) {
    const { data } = await api<{ id: string }>('POST', '/watchlists', { name: list.name })
    for (const title of list.movies) {
      const slug = await resolveCached(title, 'movie')
      if (slug) await api('PUT', `/library/movies/${slug}/watchlists/${data.id}`)
    }
    for (const title of list.shows) {
      const slug = await resolveCached(title, 'show')
      if (slug) await api('PUT', `/library/shows/${slug}/watchlists/${data.id}`)
    }
    console.log(`  created: "${list.name}"`)
  }
}

// ---------------------------------------------------------------------------

async function main() {
  await ensureAccount()

  console.log('Clearing any existing watch history/ratings/watchlists on this account...')
  await api('POST', '/account/clear-data', {
    watchHistory: true,
    ratings: true,
    watchlist: true,
    droppedShows: true,
  })

  await seedWatchedMovies()
  await seedWatchedShows()

  const defaultWatchlistId = await getDefaultWatchlistId()
  await seedWatchlistedFuture(defaultWatchlistId)
  await seedCustomWatchlists()

  console.log('Done. Ready for the screenshot tool (../screenshots).')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
