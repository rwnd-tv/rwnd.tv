import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { StatsSummary, User } from '@rwnd/shared'
import { StatsPage } from './StatsPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api, ApiError } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return { ...actual, api: { ...actual.api, stats: { summary: vi.fn() } } }
})

beforeEach(() => {
  vi.clearAllMocks()
})

function testUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'watcher@example.com',
    displayName: 'Watcher',
    locale: 'en-GB',
    timezone: 'UTC',
    theme: 'system',
    spoilerProtectionEnabled: true,
    onDeckFillGaps: false,
    role: 'user',
    avatarUpdatedAt: null,
    emailVerifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function testSummary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    totals: {
      plays: 7,
      episodePlays: 3,
      moviePlays: 4,
      distinctShows: 1,
      distinctEpisodes: 3,
      distinctMovies: 2,
      minutesWatched: 542,
      estimatedMinutes: 150,
      playsWithoutRuntime: 2,
      firstWatchedAt: '2026-01-01T12:00:00.000Z',
      lastWatchedAt: '2026-01-05T12:00:00.000Z',
      unknownDatePlays: 1,
    },
    topShows: [
      {
        slug: 'breaking-bad-2008',
        title: 'Breaking Bad',
        year: 2008,
        posterPath: null,
        plays: 3,
        episodes: 3,
        minutes: 180,
      },
    ],
    topMovies: [
      {
        slug: 'the-matrix-1999',
        title: 'The Matrix',
        year: 1999,
        posterPath: null,
        plays: 2,
        minutes: 272,
      },
    ],
    ...overrides,
  }
}

function renderPage(summary: StatsSummary, user = testUser()) {
  vi.mocked(api.stats.summary).mockResolvedValue(summary)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, isLoading: false, refetch: () => Promise.resolve() }}>
        <MemoryRouter>
          <StatsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('StatsPage', () => {
  it('renders the totals tiles, the formatted watch time, and top shows/movies', async () => {
    renderPage(testSummary())

    expect(await screen.findByText('3')).toBeInTheDocument() // episodesWatched tile
    expect(screen.getByText('9 hours, 2 minutes')).toBeInTheDocument()
    expect(screen.getByText('Breaking Bad')).toBeInTheDocument()
    expect(screen.getByText('3 episodes')).toBeInTheDocument()
    expect(screen.getByText('The Matrix')).toBeInTheDocument()
    // Top movie's secondary line is its own formatted duration (272 minutes).
    expect(screen.getByText('4 hours, 32 minutes')).toBeInTheDocument()

    expect(screen.getByText('Breaking Bad').closest('a')).toHaveAttribute(
      'href',
      '/shows/breaking-bad-2008',
    )
    expect(screen.getByText('The Matrix').closest('a')).toHaveAttribute(
      'href',
      '/movies/the-matrix-1999',
    )
  })

  it('shows the estimated-runtime footnote only when a fallback runtime was used', async () => {
    renderPage(testSummary({ totals: { ...testSummary().totals, playsWithoutRuntime: 2 } }))
    expect(
      await screen.findByText('Includes an estimate for 2 plays with no known runtime'),
    ).toBeInTheDocument()
  })

  it('omits the estimated-runtime footnote when every play had a known runtime', async () => {
    renderPage(
      testSummary({
        totals: { ...testSummary().totals, playsWithoutRuntime: 0, estimatedMinutes: 0 },
      }),
    )
    await screen.findByText('Time watched')
    expect(screen.queryByText(/Includes an estimate/)).not.toBeInTheDocument()
  })

  it('does not render a Top Shows row when nothing but movies were watched', async () => {
    renderPage(testSummary({ topShows: [] }))
    await screen.findByText('The Matrix')
    expect(screen.queryByText('Top Shows')).not.toBeInTheDocument()
  })

  it('shows an empty-state message rather than empty tiles for a user with no watch history', async () => {
    renderPage(
      testSummary({
        totals: {
          plays: 0,
          episodePlays: 0,
          moviePlays: 0,
          distinctShows: 0,
          distinctEpisodes: 0,
          distinctMovies: 0,
          minutesWatched: 0,
          estimatedMinutes: 0,
          playsWithoutRuntime: 0,
          firstWatchedAt: null,
          lastWatchedAt: null,
          unknownDatePlays: 0,
        },
        topShows: [],
        topMovies: [],
      }),
    )
    expect(
      await screen.findByText('Nothing here yet — log a watch and check back.'),
    ).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    vi.mocked(api.stats.summary).mockRejectedValue(new ApiError(500, 'boom'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ user: testUser(), isLoading: false, refetch: () => Promise.resolve() }}
        >
          <MemoryRouter>
            <StatsPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    await screen.findByRole('alert')
  })
})
