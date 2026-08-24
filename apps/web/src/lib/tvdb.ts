/** TheTVDB's own stable id-only redirect — resolves to a show/movie's real
 * (slug-based) page without this app needing to know or cache that slug.
 * Documented by TheTVDB as the intended way for third-party apps to link
 * to a title by id (https://forums.thetvdb.com/viewtopic.php?t=47708). */
export function tvdbSeriesUrl(tvdbId: string): string {
  return `https://www.thetvdb.com/dereferrer/series/${tvdbId}`
}

export function tvdbMovieUrl(tvdbId: string): string {
  return `https://www.thetvdb.com/dereferrer/movie/${tvdbId}`
}

/** Unlike the series/movie dereferrer above, TVDB addresses a season/
 * episode page by *its own* internal id, not a season/episode number —
 * see seasonDetailSchema's `tvdbSeasonId`/`tvdbEpisodeId` doc comments
 * (packages/shared/src/schemas/library.ts) for where that id comes from. */
export function tvdbSeasonUrl(tvdbSeasonId: string): string {
  return `https://www.thetvdb.com/dereferrer/season/${tvdbSeasonId}`
}

export function tvdbEpisodeUrl(tvdbEpisodeId: string): string {
  return `https://www.thetvdb.com/dereferrer/episode/${tvdbEpisodeId}`
}

/** TheTVDB's own attribution-logo pair (linked from
 * https://www.thetvdb.com/api-information, hosted at thetvdb.com itself —
 * same "use the provider's own hosted asset" reasoning as TMDB_LOGO_URL in
 * lib/tmdb.ts). Unlike TMDB's logo, neither variant reads on both themes —
 * one has dark "db" text (for a light background), the other white (for a
 * dark one) — so both are rendered and CSS picks the visible one via the
 * `.tvdb-logo-light`/`.tvdb-logo-dark` classes in index.css, using this
 * app's own [data-theme]/prefers-color-scheme rules rather than a JS theme
 * check. */
export const TVDB_LOGO_LIGHT_BG_URL = 'https://www.thetvdb.com/images/attribution/logo2.png'
export const TVDB_LOGO_DARK_BG_URL = 'https://www.thetvdb.com/images/attribution/logo1.png'
