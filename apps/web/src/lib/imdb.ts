/** IMDb's canonical title URL. One function for all three entity types
 * this app links to (movie/show/episode) — unlike TMDB (separate /movie/
 * and /tv/ trees) or TVDB (a per-type dereferrer, see lib/tvdb.ts), IMDb
 * addresses a movie, a series, and one of its episodes with the same
 * `/title/tt…/` shape. Trailing slash is deliberate — IMDb's own linking
 * guidance asks for it, and omitting it costs a redirect.
 *
 * Callers render this as a plain "IMDb" text link and MUST NOT swap in a
 * logo or wordmark — the opposite of the TMDB/TVDB links alongside it,
 * whose terms *require* their logos. IMDb's conditions of use forbid
 * using their trademark as the clickable element of a link without
 * express written permission
 * (https://help.imdb.com/article/imdb/general-information/how-do-i-link-to-a-specific-page-on-your-site/GTRTF6K8UA9JP9QQ).
 * There is correspondingly no attribution requirement to satisfy for a
 * plain text link — see README.md's own attribution section, which stays
 * TMDB/TVDB-only. */
export function imdbTitleUrl(imdbId: string): string {
  return `https://www.imdb.com/title/${imdbId}/`
}
