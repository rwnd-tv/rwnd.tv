import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarEvent, User } from '@rwnd/shared'
import { CalendarPage } from './CalendarPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api, ApiError } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return { ...actual, api: { ...actual.api, calendar: { events: vi.fn() } } }
})

// useSortCookie (lib/use-sort-cookie.ts) reads/writes a real document.cookie
// session cookie — jsdom doesn't reset it between tests in the same file, so
// a view chosen in one test would otherwise leak into the next one's initial
// render.
beforeEach(() => {
  vi.clearAllMocks()
  document.cookie = 'rwnd_calendar_view=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = 'rwnd_calendar_filter=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
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

function renderPage(events: CalendarEvent[], user = testUser()) {
  vi.mocked(api.calendar.events).mockResolvedValue({ events })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, isLoading: false, refetch: () => Promise.resolve() }}>
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

// All dates computed from the real clock, never vi.useFakeTimers() — a
// prior finding (HistoryRow.test.tsx) that fake timers risk hanging
// TanStack Query's own internal timers and Testing Library's async queries.
function dayString(date: Date): string {
  return date.toISOString().slice(0, 10)
}
const todayDay = dayString(new Date())

function episodeEvent(overrides: Partial<Extract<CalendarEvent, { kind: 'episode' }>> = {}) {
  return {
    kind: 'episode' as const,
    uid: 'episode-1@rwnd.tv',
    media: {
      type: 'episode' as const,
      title: 'The Reveal',
      showTitle: 'A Show',
      showSlug: 'a-show',
      posterPath: null,
      seasonNumber: 1,
      episodeNumber: 2,
    },
    overview: 'A spoiler-ish synopsis.',
    watched: false,
    spoilerHidden: true,
    date: todayDay,
    ...overrides,
  }
}

function releaseEvent(overrides: Partial<Extract<CalendarEvent, { kind: 'release' }>> = {}) {
  return {
    kind: 'release' as const,
    uid: 'movie-1@rwnd.tv',
    media: {
      type: 'movie' as const,
      title: 'A Movie',
      movieSlug: 'a-movie',
      posterPath: null,
    },
    overview: 'A movie synopsis.',
    watched: false,
    spoilerHidden: false,
    date: todayDay,
    ...overrides,
  }
}

function watchEvent(overrides: Partial<Extract<CalendarEvent, { kind: 'watch' }>> = {}) {
  return {
    kind: 'watch' as const,
    uid: 'play-1@rwnd.tv',
    media: {
      type: 'movie' as const,
      title: 'A Watched Movie',
      movieSlug: 'a-watched-movie',
      posterPath: null,
    },
    overview: 'Already watched.',
    watched: true,
    spoilerHidden: false,
    startsAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('CalendarPage', () => {
  it('defaults to Agenda view, with Month one click away', async () => {
    renderPage([episodeEvent({ spoilerHidden: false })])

    expect(await screen.findByRole('button', { name: 'Agenda', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Month', pressed: false })).toBeInTheDocument()
  })

  it('honours a "month" cookie over the Agenda default', async () => {
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([])
    expect(await screen.findByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agenda', pressed: false })).toBeInTheDocument()
  })

  it('selecting a day with no events shows the empty state in its panel', async () => {
    const user = userEvent.setup()
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([])
    await user.click(await screen.findByRole('button', { current: 'date' }))
    // Not the exact locale-specific string (film/movie) — the rendered
    // string here comes from i18next's own active language, detected
    // independently of `user.locale` (which only drives date/number
    // formatting elsewhere on this page), and defaults to en-US in tests.
    await screen.findByText(/Nothing to show yet/)
  })

  it('shows an error message when the request fails', async () => {
    vi.mocked(api.calendar.events).mockRejectedValue(new ApiError(500, 'boom'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ user: testUser(), isLoading: false, refetch: () => Promise.resolve() }}
        >
          <MemoryRouter>
            <CalendarPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    await screen.findByRole('alert')
  })

  it('hides an unwatched, spoiler-protected episode title until revealed', async () => {
    const user = userEvent.setup()
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([episodeEvent()])

    // The compact month-grid cell substitutes the fallback outright (no
    // reveal control at that size) — the real reveal happens in the
    // selected-day panel below, opened by picking the day.
    await screen.findByText('A Show · Episode 2')
    await user.click(screen.getByRole('button', { current: 'date' }))

    expect(await screen.findByText('S1 E2 · Episode 2')).toBeInTheDocument()
    expect(screen.queryByText(/The Reveal/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal spoiler' }))
    expect(await screen.findByText(/The Reveal/)).toBeInTheDocument()
  })

  it('never hides an already-watched episode title', async () => {
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([episodeEvent({ watched: true, spoilerHidden: false })])
    expect(await screen.findByText('A Show · The Reveal')).toBeInTheDocument()
  })

  it('links an upcoming release to its movie page', async () => {
    renderPage([releaseEvent()])
    const link = (await screen.findByText('A Movie')).closest('a')
    expect(link).toHaveAttribute('href', '/movies/a-movie')
  })

  it('links a past watch to its movie page', async () => {
    renderPage([watchEvent()])
    const link = (await screen.findByText('A Watched Movie')).closest('a')
    expect(link).toHaveAttribute('href', '/movies/a-watched-movie')
  })

  it('all three event-kind filters are on by default', async () => {
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([])
    await screen.findByText('Mon')
    for (const name of ['History', 'TV Shows', 'Movies']) {
      expect(screen.getByRole('button', { name, pressed: true })).toBeInTheDocument()
    }
  })

  it('toggling the History filter off hides watch events but keeps others', async () => {
    const user = userEvent.setup()
    renderPage([watchEvent(), releaseEvent()])
    await screen.findByText('A Watched Movie')
    expect(screen.getByText('A Movie')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.queryByText('A Watched Movie')).not.toBeInTheDocument()
    expect(screen.getByText('A Movie')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'History', pressed: false })).toBeInTheDocument()
  })

  it('navigating to the next month issues a new query with a different window', async () => {
    const user = userEvent.setup()
    document.cookie = 'rwnd_calendar_view=month; path=/'
    renderPage([])
    await screen.findByText('Mon')
    expect(api.calendar.events).toHaveBeenCalledTimes(1)
    const firstCall = vi.mocked(api.calendar.events).mock.calls[0]![0]

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    await vi.waitFor(() => expect(api.calendar.events).toHaveBeenCalledTimes(2))
    const secondCall = vi.mocked(api.calendar.events).mock.calls[1]![0]
    expect(secondCall.after).not.toBe(firstCall.after)
  })
})
