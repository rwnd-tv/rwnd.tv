import type {
  TraktHiddenItem,
  TraktHistoryItem,
  TraktRatingItem,
  TraktSettingsResponse,
  TraktWatchlistItem,
} from './types.js'

/**
 * Thin wrapper around the api.trakt.tv sync endpoints the importer needs.
 * OAuth itself (a different host, auth.trakt.tv) lives in ./auth.ts.
 */

export interface TraktClientOptions {
  apiBaseUrl: string
  clientId: string
  accessToken: string
}

export interface PagedResult<T> {
  items: T[]
  page: number
  /** Total pages, per X-Pagination-Page-Count. 1 if the endpoint didn't
   * paginate the response (ratings/watchlist return everything at once
   * unless asked to page — see docs.trakt.tv/docs/pagination). */
  pageCount: number
  /** Total item count, per X-Pagination-Item-Count. Null when the header is
   * absent, so callers can fall back to "unknown total" rather than 0. */
  itemCount: number | null
}

const DEFAULT_PAGE_LIMIT = 1000
const MAX_RETRY_AFTER_SECONDS = 60

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class TraktClient {
  constructor(private readonly options: TraktClientOptions) {}

  private async request<T>(
    path: string,
    query: Record<string, string> = {},
    isRetry = false,
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(this.options.apiBaseUrl + path)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'rwnd.tv (+https://rwnd.tv)',
        'trakt-api-key': this.options.clientId,
        'trakt-api-version': '2',
        Authorization: `Bearer ${this.options.accessToken}`,
      },
    })

    if (res.status === 429 && !isRetry) {
      // Rate limit: 1000 authenticated GETs per user per 5 minutes
      // (docs.trakt.tv). Retry once, honouring Retry-After; a second 429
      // is surfaced to the caller rather than looped on indefinitely.
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '5', 10)
      await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000)
      return this.request<T>(path, query, true)
    }

    if (!res.ok) {
      throw new Error(`Trakt request failed: ${res.status} ${res.statusText} (${path})`)
    }

    return { data: (await res.json()) as T, headers: res.headers }
  }

  private async getPage<T>(path: string, page: number, limit: number): Promise<PagedResult<T>> {
    const { data, headers } = await this.request<T[]>(path, {
      page: String(page),
      limit: String(limit),
    })
    const pageCountHeader = headers.get('x-pagination-page-count')
    const itemCountHeader = headers.get('x-pagination-item-count')
    return {
      items: data,
      page,
      pageCount: pageCountHeader ? Number.parseInt(pageCountHeader, 10) : 1,
      itemCount: itemCountHeader ? Number.parseInt(itemCountHeader, 10) : null,
    }
  }

  getHistoryPage(page: number, limit = DEFAULT_PAGE_LIMIT): Promise<PagedResult<TraktHistoryItem>> {
    return this.getPage<TraktHistoryItem>('/sync/history', page, limit)
  }

  getRatingsPage(page: number, limit = DEFAULT_PAGE_LIMIT): Promise<PagedResult<TraktRatingItem>> {
    return this.getPage<TraktRatingItem>('/sync/ratings', page, limit)
  }

  getWatchlistPage(
    page: number,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<PagedResult<TraktWatchlistItem>> {
    return this.getPage<TraktWatchlistItem>('/sync/watchlist', page, limit)
  }

  /** `section` is currently only ever called with 'dropped' — kept as a
   * parameter rather than hardcoded since it mirrors Trakt's own hidden
   * items API shape (other sections exist, e.g. 'progress_watched',
   * 'calendar', that rwnd.tv has no use for today). */
  getHiddenPage(
    section: string,
    page: number,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<PagedResult<TraktHiddenItem>> {
    return this.getPage<TraktHiddenItem>(`/users/hidden/${section}`, page, limit)
  }

  async getSettings(): Promise<TraktSettingsResponse> {
    const { data } = await this.request<TraktSettingsResponse>('/users/settings')
    return data
  }
}
