import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { StatsSummary, StatsTimeline, User } from '@rwnd/shared'
import { StatsPage } from './StatsPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api, ApiError } from '../lib/api-client.js'
import { localDayEndISO, localDayStartISO } from '../lib/date.js'

/** Local `new Date(y, m, d)` -> epoch minutes, same reasoning as
 * stats-buckets.test.ts: avoids a TZ-dependent hardcoded UTC timestamp. */
function epochMinutesFor(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month, day, 12).getTime() / 60_000)
}

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return { ...actual, api: { ...actual.api, stats: { summary: vi.fn(), timeline: vi.fn() } } }
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

function testTimeline(overrides: Partial<StatsTimeline> = {}): StatsTimeline {
  return { episodePlays: [], moviePlays: [], unknownDatePlays: 0, ...overrides }
}

function renderPage(
  summary: StatsSummary,
  { user = testUser(), timeline = testTimeline() }: { user?: User; timeline?: StatsTimeline } = {},
) {
  vi.mocked(api.stats.summary).mockResolvedValue(summary)
  vi.mocked(api.stats.timeline).mockResolvedValue(timeline)
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

  it('shows the unknown-date footnote on the all-time view but not once a year is selected', async () => {
    renderPage(testSummary(), {
      timeline: testTimeline({
        episodePlays: [epochMinutesFor(2025, 5, 1)],
        moviePlays: [epochMinutesFor(2024, 0, 1)],
      }),
    })

    expect(
      await screen.findByText(
        "1 play has no known date, so it's counted here but won't appear in any single year",
      ),
    ).toBeInTheDocument()

    await userEvent.selectOptions(await screen.findByLabelText('Year'), '2025')
    expect(screen.queryByText(/has no known date, so it's counted here/)).not.toBeInTheDocument()
  })

  it('offers a year selector once the timeline spans data, and re-scopes the summary request on selection', async () => {
    renderPage(testSummary(), {
      timeline: testTimeline({
        episodePlays: [epochMinutesFor(2025, 5, 1)],
        moviePlays: [epochMinutesFor(2024, 0, 1)],
      }),
    })

    const select = await screen.findByLabelText('Year')
    expect(screen.getByRole('option', { name: 'All time' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2025' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2024' })).toBeInTheDocument()

    expect(api.stats.summary).toHaveBeenCalledWith({ after: undefined, before: undefined })

    await userEvent.selectOptions(select, '2025')

    expect(api.stats.summary).toHaveBeenCalledWith({
      after: localDayStartISO('2025-01-01'),
      before: localDayEndISO('2025-12-31'),
    })
  })

  it('selects that year, same as the dropdown, when a year bar in the activity chart is clicked', async () => {
    renderPage(testSummary(), {
      timeline: testTimeline({
        episodePlays: [epochMinutesFor(2025, 5, 1)],
        moviePlays: [epochMinutesFor(2024, 0, 1)],
      }),
    })

    await screen.findByLabelText('Year')
    expect(api.stats.summary).toHaveBeenCalledWith({ after: undefined, before: undefined })

    await userEvent.click(screen.getByRole('button', { name: /1 episode, 0 movies/ }))

    expect(api.stats.summary).toHaveBeenCalledWith({
      after: localDayStartISO('2025-01-01'),
      before: localDayEndISO('2025-12-31'),
    })
    expect(screen.getByLabelText('Year')).toHaveValue('2025')
  })

  it('renders the activity chart once the timeline has data', async () => {
    renderPage(testSummary(), {
      timeline: testTimeline({ episodePlays: [epochMinutesFor(2025, 5, 1)] }),
    })

    await screen.findByText('Activity')
    expect(screen.queryByText('No activity in this period.')).not.toBeInTheDocument()
  })

  it('shows an empty message for the activity chart when the timeline has no plays', async () => {
    renderPage(testSummary())
    expect(await screen.findByText('No activity in this period.')).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    vi.mocked(api.stats.summary).mockRejectedValue(new ApiError(500, 'boom'))
    vi.mocked(api.stats.timeline).mockResolvedValue(testTimeline())
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
