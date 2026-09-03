import {
  type AccountDataCounts,
  type ActivityKind,
  type ActivitySort,
  type ApiToken,
  type BackupSummary,
  type AdminUserSummary,
  type ChangeEmailRequest,
  type ChangePasswordRequest,
  type ClearDataRequest,
  type ConfirmEmailChangeRequest,
  type CreateApiTokenRequest,
  type CreateApiTokenResponse,
  type CreateBackupRequest,
  type CreateImportJobRequest,
  type CreatePlayRequest,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type CreateWatchlistRequest,
  type CreateWebhookLinkCodeRequest,
  type CreateWebhookLinkCodeResponse,
  type ConfirmTotpResponse,
  type DeleteAccountRequest,
  type DiffBackupResponse,
  type DisableTotpRequest,
  type DroppedStatus,
  type EnrollTotpResponse,
  type EpisodeImdb,
  type ForgotPasswordRequest,
  type ImportJob,
  type InstanceAbout,
  type InstanceSettings,
  type ListBackupsResponse,
  type ListActivityResponse,
  type ListAdminUsersResponse,
  type ListImportJobsResponse,
  type ListLibraryMoviesResponse,
  type ListLibraryShowsResponse,
  type ListInvitesResponse,
  type ListPlaysResponse,
  type ListSessionsResponse,
  type LoginMfaRequest,
  type ListWatchlistsResponse,
  type ListWebhookLinksResponse,
  type LoginRequest,
  type MarkShowWatchedRequest,
  type MarkShowWatchedResponse,
  type MfaRequiredResponse,
  type MovieDetail,
  type OnDeckResponse,
  type Play,
  type RatingStatus,
  type RedeemWebhookLinkRequest,
  type RegenerateRecoveryCodesRequest,
  type RegenerateRecoveryCodesResponse,
  type RegisterRequest,
  type RemoveActivityRequest,
  type RemoveShowWatchesResponse,
  type RemoveWatchesRequest,
  type ResetPasswordRequest,
  type ResolveMediaRequest,
  type ResolveMediaResponse,
  type RestoreBackupResponse,
  type SearchResponse,
  type SeasonDetail,
  type SeasonWatches,
  type SetRatingRequest,
  type SetupRequest,
  type ShowDetail,
  type ShowWatches,
  type TotpStatus,
  type TraktConnectionStatus,
  type TraktDevicePairing,
  type TransferOwnershipRequest,
  type UpdateInstanceSettingsRequest,
  type UpdatePlayRequest,
  type UpdateProfileRequest,
  type UpdateUserRoleRequest,
  type UpdateWatchlistRequest,
  type UpNextResponse,
  type User,
  type VerifyEmailRequest,
  type WatchedStatus,
  type Watches,
  type WatchlistDetail,
  type WatchlistMembershipStatus,
  type WatchlistSummary,
  type WebhookAccountLink,
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
  // A FormData body needs the browser to set its own multipart boundary in
  // Content-Type — forcing 'application/json' here would break that.
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (res.status === 204) return undefined as T

  const body: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    // Every API route error body is `{ error: string }` (see e.g.
    // apps/api/src/middleware/auth.ts), but it's still just parsed JSON at
    // this point — narrow it rather than trusting the shape.
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : res.statusText
    throw new ApiError(res.status, message)
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
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined })
const putForm = <T>(path: string, form: FormData) => request<T>(path, { method: 'PUT', body: form })
const postForm = <T>(path: string, form: FormData) =>
  request<T>(path, { method: 'POST', body: form })

export const api = {
  account: {
    dataCounts: () => get<AccountDataCounts>('/account/data-counts'),
    clearData: (body: ClearDataRequest) => post<void>('/account/clear-data', body),
    /** Not fetched through api-client's own request() — same reasoning as
     * auth.avatarUrl above, this is a plain URL for the browser to
     * navigate/download directly rather than a function that awaits a
     * parsed JSON body. */
    exportUrl: '/api/v1/account/export',
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
  invites: {
    list: () => get<ListInvitesResponse>('/invites'),
    create: (body: CreateInviteRequest) => post<CreateInviteResponse>('/invites', body),
    delete: (id: string) => del<void>(`/invites/${encodeURIComponent(id)}`),
  },
  admin: {
    listUsers: () => get<ListAdminUsersResponse>('/admin/users'),
    getUser: (id: string) => get<AdminUserSummary>(`/admin/users/${encodeURIComponent(id)}`),
    updateUserRole: (id: string, role: UpdateUserRoleRequest['role']) =>
      patch<AdminUserSummary>(`/admin/users/${encodeURIComponent(id)}`, {
        role,
      } satisfies UpdateUserRoleRequest),
    deleteUser: (id: string) => del<void>(`/admin/users/${encodeURIComponent(id)}`),
    listUserSessions: (id: string) =>
      get<ListSessionsResponse>(`/admin/users/${encodeURIComponent(id)}/sessions`),
    revokeUserSession: (id: string, sessionId: string) =>
      del<void>(`/admin/users/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`),
    revokeAllUserSessions: (id: string) =>
      del<void>(`/admin/users/${encodeURIComponent(id)}/sessions`),
    sendPasswordReset: (id: string) =>
      post<void>(`/admin/users/${encodeURIComponent(id)}/password-reset`),
  },
  auth: {
    login: (body: LoginRequest) => post<User | MfaRequiredResponse>('/auth/login', body),
    loginMfa: (body: LoginMfaRequest) => post<User>('/auth/login/mfa', body),
    register: (body: RegisterRequest) => post<User>('/auth/register', body),
    logout: () => post<void>('/auth/logout'),
    me: () => get<User>('/auth/me'),
    updateMe: (body: UpdateProfileRequest) => patch<User>('/auth/me', body),
    uploadAvatar: (file: File) => {
      const form = new FormData()
      form.set('file', file)
      return putForm<User>('/auth/me/avatar', form)
    },
    deleteAvatar: () => del<User>('/auth/me/avatar'),
    /** Not fetched through api-client's own request() — this is used
     * directly as an <img> src, so it needs a plain URL rather than a
     * function that awaits a parsed JSON body. */
    avatarUrl: (avatarUpdatedAt: string) =>
      `/api/v1/auth/me/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`,
    forgotPassword: (body: ForgotPasswordRequest) => post<void>('/auth/forgot-password', body),
    resetPassword: (body: ResetPasswordRequest) => post<void>('/auth/reset-password', body),
    verifyEmail: (body: VerifyEmailRequest) => post<void>('/auth/verify-email', body),
    resendVerification: () => post<void>('/auth/resend-verification'),
    changePassword: (body: ChangePasswordRequest) => post<void>('/auth/me/password', body),
    changeEmail: (body: ChangeEmailRequest) => post<void>('/auth/me/email', body),
    confirmEmailChange: (body: ConfirmEmailChangeRequest) =>
      post<void>('/auth/confirm-email-change', body),
    deleteAccount: (body: DeleteAccountRequest) => del<void>('/auth/me', body),
    listSessions: () => get<ListSessionsResponse>('/auth/me/sessions'),
    revokeSession: (id: string) => del<void>(`/auth/me/sessions/${encodeURIComponent(id)}`),
    transferOwnership: (body: TransferOwnershipRequest) =>
      post<void>('/auth/me/transfer-ownership', body),
  },
  mfa: {
    status: () => get<TotpStatus>('/auth/mfa/totp'),
    enroll: () => post<EnrollTotpResponse>('/auth/mfa/totp/enroll'),
    confirm: (code: string) => post<ConfirmTotpResponse>('/auth/mfa/totp/confirm', { code }),
    disable: (body: DisableTotpRequest) => post<void>('/auth/mfa/totp/disable', body),
    regenerateRecoveryCodes: (body: RegenerateRecoveryCodesRequest) =>
      post<RegenerateRecoveryCodesResponse>('/auth/mfa/totp/recovery-codes', body),
  },
  tokens: {
    list: () => get<{ tokens: ApiToken[] }>('/tokens'),
    create: (body: CreateApiTokenRequest) => post<CreateApiTokenResponse>('/tokens', body),
    delete: (id: string) => del<void>(`/tokens/${id}`),
    webhookLinks: (id: string) => get<ListWebhookLinksResponse>(`/tokens/${id}/webhook-links`),
    linkWebhookLink: (id: string, linkId: string) =>
      post<WebhookAccountLink>(`/tokens/${id}/webhook-links/${linkId}/link`),
    unlinkWebhookLink: (id: string, linkId: string) =>
      post<WebhookAccountLink>(`/tokens/${id}/webhook-links/${linkId}/unlink`),
    createWebhookLinkCode: (id: string, linkId: string, body: CreateWebhookLinkCodeRequest) =>
      post<CreateWebhookLinkCodeResponse>(`/tokens/${id}/webhook-links/${linkId}/link-code`, body),
    deleteWebhookLink: (id: string, linkId: string) =>
      del<void>(`/tokens/${id}/webhook-links/${linkId}`),
  },
  webhookLinks: {
    redeem: (body: RedeemWebhookLinkRequest) =>
      post<WebhookAccountLink>('/webhook-links/redeem', body),
    mine: () => get<ListWebhookLinksResponse>('/webhook-links/mine'),
    unlink: (linkId: string) => post<WebhookAccountLink>(`/webhook-links/mine/${linkId}/unlink`),
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
    updateWatchedAt: (id: string, watchedAt: string) =>
      patch<Play>(`/plays/${id}`, { watchedAt } satisfies UpdatePlayRequest),
  },
  activity: {
    list: (params: {
      offset: number
      limit: number
      q?: string
      kinds?: ActivityKind[]
      sort: ActivitySort
      /** Inclusive ISO instant bounds — see date.ts's localDayStartISO/
       * localDayEndISO for converting a picked calendar day into these. */
      after?: string
      before?: string
    }) => {
      const qs = new URLSearchParams()
      qs.set('offset', String(params.offset))
      qs.set('limit', String(params.limit))
      if (params.q) qs.set('q', params.q)
      if (params.kinds && params.kinds.length > 0) qs.set('kinds', params.kinds.join(','))
      qs.set('sort', params.sort)
      if (params.after) qs.set('after', params.after)
      if (params.before) qs.set('before', params.before)
      return get<ListActivityResponse>(`/activity-feed?${qs.toString()}`)
    },
    removeMany: (entries: RemoveActivityRequest['entries']) =>
      del<void>('/activity-feed', { entries } satisfies RemoveActivityRequest),
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
    rateShow: (slug: string, rating: number) =>
      put<RatingStatus>(`/library/shows/${encodeURIComponent(slug)}/rating`, {
        rating,
      } satisfies SetRatingRequest),
    clearShowRating: (slug: string) =>
      del<RatingStatus>(`/library/shows/${encodeURIComponent(slug)}/rating`),
    addShowToWatchlist: (slug: string, watchlistId: string) =>
      put<WatchlistMembershipStatus>(
        `/library/shows/${encodeURIComponent(slug)}/watchlists/${watchlistId}`,
      ),
    removeShowFromWatchlist: (slug: string, watchlistId: string) =>
      del<WatchlistMembershipStatus>(
        `/library/shows/${encodeURIComponent(slug)}/watchlists/${watchlistId}`,
      ),
    markShowWatched: (slug: string, body: MarkShowWatchedRequest) =>
      post<MarkShowWatchedResponse>(`/library/shows/${encodeURIComponent(slug)}/watched`, body),
    removeShowWatches: (slug: string) =>
      del<RemoveShowWatchesResponse>(`/library/shows/${encodeURIComponent(slug)}/watched`),
    showWatches: (slug: string) =>
      get<ShowWatches>(`/library/shows/${encodeURIComponent(slug)}/plays`),
    removeShowWatchesByIds: (slug: string, ids: string[]) =>
      del<RemoveShowWatchesResponse>(`/library/shows/${encodeURIComponent(slug)}/plays`, {
        ids,
      } satisfies RemoveWatchesRequest),
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
    // Its own endpoint, not part of season(...) above — an episode's IMDb
    // id costs one dedicated provider call, so folding it into the season
    // fetch would mean ~25 provider calls per season page view. See
    // apps/api/src/routes/library/seasons.ts's .../imdb route.
    episodeImdb: (slug: string, seasonNumber: number, episodeNumber: number) =>
      get<EpisodeImdb>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/episodes/${episodeNumber}/imdb`,
      ),
    rateEpisode: (slug: string, seasonNumber: number, episodeNumber: number, rating: number) =>
      put<RatingStatus>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/episodes/${episodeNumber}/rating`,
        { rating } satisfies SetRatingRequest,
      ),
    clearEpisodeRating: (slug: string, seasonNumber: number, episodeNumber: number) =>
      del<RatingStatus>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/episodes/${episodeNumber}/rating`,
      ),
    seasonWatches: (slug: string, seasonNumber: number) =>
      get<SeasonWatches>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/plays`,
      ),
    removeSeasonWatchesByIds: (slug: string, seasonNumber: number, ids: string[]) =>
      del<RemoveShowWatchesResponse>(
        `/library/shows/${encodeURIComponent(slug)}/seasons/${seasonNumber}/plays`,
        { ids } satisfies RemoveWatchesRequest,
      ),
    movies: () => get<ListLibraryMoviesResponse>('/library/movies'),
    resolveMovie: (body: ResolveMediaRequest) =>
      post<ResolveMediaResponse>('/library/movies/resolve', body),
    movie: (slug: string) => get<MovieDetail>(`/library/movies/${encodeURIComponent(slug)}`),
    rateMovie: (slug: string, rating: number) =>
      put<RatingStatus>(`/library/movies/${encodeURIComponent(slug)}/rating`, {
        rating,
      } satisfies SetRatingRequest),
    clearMovieRating: (slug: string) =>
      del<RatingStatus>(`/library/movies/${encodeURIComponent(slug)}/rating`),
    addMovieToWatchlist: (slug: string, watchlistId: string) =>
      put<WatchlistMembershipStatus>(
        `/library/movies/${encodeURIComponent(slug)}/watchlists/${watchlistId}`,
      ),
    removeMovieFromWatchlist: (slug: string, watchlistId: string) =>
      del<WatchlistMembershipStatus>(
        `/library/movies/${encodeURIComponent(slug)}/watchlists/${watchlistId}`,
      ),
    refreshMovie: (slug: string) =>
      post<void>(`/library/movies/${encodeURIComponent(slug)}/refresh`),
    movieWatches: (slug: string) =>
      get<Watches>(`/library/movies/${encodeURIComponent(slug)}/plays`),
    unwatchMovie: (slug: string, ids: string[]) =>
      del<WatchedStatus>(`/library/movies/${encodeURIComponent(slug)}/plays`, {
        ids,
      } satisfies RemoveWatchesRequest),
  },
  watchlists: {
    list: () => get<ListWatchlistsResponse>('/watchlists'),
    create: (body: CreateWatchlistRequest) => post<WatchlistSummary>('/watchlists', body),
    update: (id: string, body: UpdateWatchlistRequest) =>
      patch<WatchlistSummary>(`/watchlists/${id}`, body),
    delete: (id: string) => del<void>(`/watchlists/${id}`),
    get: (id: string) => get<WatchlistDetail>(`/watchlists/${id}`),
  },
  settings: {
    get: () => get<InstanceSettings>('/settings'),
    update: (body: UpdateInstanceSettingsRequest) => patch<InstanceSettings>('/settings', body),
    getAbout: () => get<InstanceAbout>('/settings/about'),
  },
  imports: {
    connection: () => get<TraktConnectionStatus>('/import/trakt/connection'),
    startPairing: () => post<TraktDevicePairing>('/import/trakt/device'),
    disconnect: () => del<void>('/import/trakt/connection'),
    start: (body: CreateImportJobRequest) => post<ImportJob>('/import/trakt', body),
    uploadZip: (
      file: File,
      opts: { history: boolean; ratings: boolean; watchlist: boolean; dropped: boolean },
    ) => {
      const form = new FormData()
      form.set('file', file)
      form.set('history', String(opts.history))
      form.set('ratings', String(opts.ratings))
      form.set('watchlist', String(opts.watchlist))
      form.set('dropped', String(opts.dropped))
      return postForm<ImportJob>('/import/trakt/zip', form)
    },
    uploadCsv: (
      file: File,
      opts: { history: boolean; ratings: boolean; watchlist: boolean; dropped: boolean },
    ) => {
      const form = new FormData()
      form.set('file', file)
      form.set('history', String(opts.history))
      form.set('ratings', String(opts.ratings))
      form.set('watchlist', String(opts.watchlist))
      form.set('dropped', String(opts.dropped))
      return postForm<ImportJob>('/import/csv', form)
    },
    jobs: () => get<ListImportJobsResponse>('/import/jobs'),
    job: (id: string) => get<ImportJob>(`/import/jobs/${id}`),
    cancel: (id: string) => post<ImportJob>(`/import/jobs/${id}/cancel`),
  },
}
