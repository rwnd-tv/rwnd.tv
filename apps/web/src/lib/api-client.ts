import {
  type ApiToken,
  type CreateApiTokenRequest,
  type CreateApiTokenResponse,
  type CreateImportJobRequest,
  type CreatePlayRequest,
  type ImportJob,
  type InstanceSettings,
  type ListImportJobsResponse,
  type ListLibraryMoviesResponse,
  type ListLibraryShowsResponse,
  type ListPlaysResponse,
  type LoginRequest,
  type Play,
  type RegisterRequest,
  type SearchResponse,
  type SetupRequest,
  type TraktConnectionStatus,
  type TraktDevicePairing,
  type UpdateInstanceSettingsRequest,
  type UpdateProfileRequest,
  type User,
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
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export const api = {
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
  },
  search: (q: string, type: 'movie' | 'show' | 'all' = 'all') =>
    get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  plays: {
    list: (cursor?: string) =>
      get<ListPlaysResponse>(`/plays${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    create: (body: CreatePlayRequest) => post<Play>('/plays', body),
    delete: (id: string) => del<void>(`/plays/${id}`),
  },
  library: {
    // Whole-library responses, not paginated — see packages/shared/src/schemas/library.ts.
    shows: () => get<ListLibraryShowsResponse>('/library/shows'),
    movies: () => get<ListLibraryMoviesResponse>('/library/movies'),
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
