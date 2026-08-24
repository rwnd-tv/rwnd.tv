import {
  type AccountDataCounts,
  type ApiToken,
  type BackupSummary,
  type ClearDataRequest,
  type CreateApiTokenRequest,
  type CreateApiTokenResponse,
  type CreateBackupRequest,
  type CreateImportJobRequest,
  type CreatePlayRequest,
  type DiffBackupResponse,
  type DroppedStatus,
  type ImportJob,
  type InstanceSettings,
  type ListBackupsResponse,
  type ListImportJobsResponse,
  type ListLibraryMoviesResponse,
  type ListLibraryShowsResponse,
  type ListPlaysResponse,
  type ListWebhookLinksResponse,
  type LoginRequest,
  type MarkShowWatchedRequest,
  type MarkShowWatchedResponse,
  type MovieDetail,
  type OnDeckResponse,
  type Play,
  type RegisterRequest,
  type RemoveShowWatchesResponse,
  type RemoveWatchesRequest,
  type ResolveMediaRequest,
  type ResolveMediaResponse,
  type RestoreBackupResponse,
  type SearchResponse,
  type SeasonDetail,
  type SetupRequest,
  type ShowDetail,
  type TraktConnectionStatus,
  type TraktDevicePairing,
  type UpdateInstanceSettingsRequest,
  type UpdateProfileRequest,
  type UpdateWebhookLinkRequest,
  type UpNextResponse,
  type User,
  type WatchedStatus,
  type Watches,
} from '@rwnd/shared'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => undefined)
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText)
  }
  return body as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined })

export const api = {
  account: {
    dataCounts: () => get<AccountDataCounts>('/account/data-counts'),
    clearData: (body: ClearDataRequest) => post<void>('/account/clear-data', body),
  },
  backups: {
    list: () => get<ListBackupsResponse>('/backups'),
    create: (body: CreateBackupRequest) => post<BackupSummary>('/backups', body),
    restore: (id: string) =>
      post<RestoreBackupResponse>(`/backups/${encodeURIComponent(id)}/restore`),
    diff: (id: string) => get<DiffBackupResponse>(`/backups/${encodeURIComponent(id)}/diff`),
    delete: (id: string) => del<void>(`/backups/${encodeURIComponent(id)}`),
  },
  setup: {
    status: () => get<{ required: boolean }>('/setup'),
    create: (body: SetupRequest) => post<User>('/setup', body),
  },
  auth: {
    login: (body: LoginRequest) => post<User>('/auth/login', body),
    register: (body: RegisterRequest) => post<User>('/auth/register', body),
    logout: () => post<void>('/auth/logout'),
    me: () => get<User>('/auth/me'),
    updateMe: (body: UpdateProfileRequest) => patch<User>('/auth/me', body),
  },
  tokens: {
    list: () => get<{ tokens: ApiToken[] }>('/tokens'),
    create: (body: CreateApiTokenRequest) => post<CreateApiTokenResponse>('/tokens', body),
    delete: (id: string) => del<void>(`/tokens/${id}`),
    webhookLinks: (id: string) => get<ListWebhookLinksResponse>(`/tokens/${id}/webhook-links`),
    updateWebhookLink: (id: string, linkId: string, body: UpdateWebhookLinkRequest) =>
      patch<void>(`/tokens/${id}/webhook-links/${linkId}`, body),
    deleteWebhookLink: (id: string, linkId: string) =>
      del<void>(`/tokens/${id}/webhook-links/${linkId}`),
  },
  search: (q: string, type: 'movie' | 'show' | 'all' = 'all') =>
    get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  plays: {
    list: (cursor?: string, limit?: number) => {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (limit) params.set('limit', String(limit))
      const qs = params.toString()
      return get<ListPlaysResponse>(`/plays${qs ? `?${qs}` : ''}`)
    },
    create: (body: CreatePlayRequest) => post<Play>('/plays', body),
    delete: (id: string) => del<void>(`/plays/${id}`),
  },
  library: {
    // Whole-library responses, not paginated — see packages/shared/src/schemas/library.ts.
    shows: () => get<ListLibraryShowsResponse>('/library/shows'),
    resolveShow: (body: ResolveMediaRequest) =>
      post<ResolveMediaResponse>('/library/shows/resolve', body),
    onDeck: () => get<OnDeckResponse>('/library/on-deck'),
    upNext: () => get<UpNextResponse>('/library/up-next'),
    show: (slug: string) => get<ShowDetail>(`/library/shows/${encodeURIComponent(slug)}`),
    refreshShow: (slug: string) => post<void>(`/library/shows/${encodeURIComponent(slug)}/refresh`),
    dropShow: (slug: string) =>
      post<DroppedStatus>(`/library/shows/${encodeURIComponent(slug)}/dropped`),
    undropShow: (slug: string) =>
      del<DroppedStatus>(`/library/shows/${encodeURIComponent(slug)}/dropped`),
    markShowWatched: (slug: string, body: MarkShowWatchedRequest) =>
      post<MarkShowWatchedResponse>(`/library/shows/${encodeURIComponent(slug)}/watched`, body),
    removeShowWatches: (slug: string) =>
      del<RemoveShowWatchesResponse>(`/library/shows/${encodeURIComponent(slug)}/watched`),
    season: (slug: string, seasonNumber: number) =>
      get<SeasonDetail>(`/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}`),
    markSeasonWatched: (slug: string, seasonNumber: number, body: MarkShowWatchedRequest) =>
      post<MarkShowWatchedResponse>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/watched`,
        body,
      ),
    removeSeasonWatches: (slug: string, seasonNumber: number) =>
      del<RemoveShowWatchesResponse>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/watched`,
      ),
    unwatchEpisode: (slug: string, seasonNumber: number, episodeNumber: number, ids: string[]) =>
      del<WatchedStatus>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/episodes/${episodeNumber}/plays`,
        { ids } satisfies RemoveWatchesRequest,
      ),
    episodeWatches: (slug: string, seasonNumber: number, episodeNumber: number) =>
      get<Watches>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/episodes/${episodeNumber}/plays`,
      ),
    movies: () => get<ListLibraryMoviesResponse>('/library/movies'),
    resolveMovie: (body: ResolveMediaRequest) =>
      post<ResolveMediaResponse>('/library/movies/resolve', body),
    movie: (slug: string) => get<MovieDetail>(`/library/movies/${encodeURIComponent(slug)}`),
    refreshMovie: (slug: string) =>
      post<void>(`/library/movies/${encodeURIComponent(slug)}/refresh`),
    movieWatches: (slug: string) =>
      get<Watches>(`/library/movies/${encodeURIComponent(slug)}/plays`),
    unwatchMovie: (slug: string, ids: string[]) =>
      del<WatchedStatus>(`/library/movies/${encodeURIComponent(slug)}/plays`, {
        ids,
      } satisfies RemoveWatchesRequest),
  },
  settings: {
    get: () => get<InstanceSettings>('/settings'),
    update: (body: UpdateInstanceSettingsRequest) => patch<InstanceSettings>('/settings', body),
  },
  imports: {
    connection: () => get<TraktConnectionStatus>('/import/trakt/connection'),
    startPairing: () => post<TraktDevicePairing>('/import/trakt/device'),
    disconnect: () => del<void>('/import/trakt/connection'),
    start: (body: CreateImportJobRequest) => post<ImportJob>('/import/trakt', body),
    jobs: () => get<ListImportJobsResponse>('/import/jobs'),
    job: (id: string) => get<ImportJob>(`/import/jobs/${id}`),
    cancel: (id: string) => post<ImportJob>(`/import/jobs/${id}/cancel`),
  },
}
