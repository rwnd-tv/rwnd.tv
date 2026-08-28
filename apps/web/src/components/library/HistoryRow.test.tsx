import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Play } from '@rwnd/shared'
import { HistoryRow } from './HistoryRow.js'
import { AuthContext } from '../../lib/use-auth.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return { ...actual, api: { ...actual.api, plays: { list: vi.fn() } } }
})

// formatDashboardDate (lib/date.ts) is relative to "now" (Today/Yesterday/
// Tomorrow, else a locale day/month string) — computed relative to the real
// clock at test-run time, rather than a hardcoded date, so this doesn't
// depend on faking global time (which risks hanging Testing Library's async
// queries and TanStack Query's own internal timers) or on which day this
// test happens to run.
const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000)
const fiveDaysAgoLabel = fiveDaysAgo.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function renderHistoryRow(plays: Play[]) {
  vi.mocked(api.plays.list).mockResolvedValue({ plays, nextCursor: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: null, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter>
          <HistoryRow />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

const moviePlay: Play = {
  id: 'play-movie',
  watchedAt: fiveDaysAgo.toISOString(),
  source: 'manual',
  createdAt: fiveDaysAgo.toISOString(),
  media: {
    type: 'movie',
    title: 'Inception',
    posterPath: '/inception.jpg',
    movieSlug: 'inception-2010',
  },
}

const episodePlay: Play = {
  id: 'play-episode',
  watchedAt: fiveDaysAgo.toISOString(),
  source: 'plex',
  createdAt: fiveDaysAgo.toISOString(),
  media: {
    type: 'episode',
    title: 'Pilot',
    showTitle: 'Breaking Bad',
    posterPath: '/breaking-bad.jpg',
    showSlug: 'breaking-bad-2008',
    seasonNumber: 1,
    episodeNumber: 1,
  },
}

describe('HistoryRow', () => {
  it('renders nothing (not even the heading) once loaded with no plays', async () => {
    const { container } = renderHistoryRow([])
    await vi.waitFor(() => expect(container.querySelector('[aria-hidden]')).not.toBeInTheDocument())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a movie caption with the watched date, linked to the movie page', async () => {
    renderHistoryRow([moviePlay])
    const title = await screen.findByText('Inception')
    expect(title.closest('a')).toHaveAttribute('href', '/movies/inception-2010')
    expect(screen.getByText(fiveDaysAgoLabel)).toBeInTheDocument()
  })

  it('shows an episode caption with season/episode numbers, linked to the episode page', async () => {
    renderHistoryRow([episodePlay])
    const title = await screen.findByText('Breaking Bad')
    expect(title.closest('a')).toHaveAttribute(
      'href',
      '/shows/breaking-bad-2008/season/1/episode/1',
    )
    expect(screen.getByText(/S1 E1/)).toBeInTheDocument()
  })

  it('renders a tile with no link when its slug is missing', async () => {
    renderHistoryRow([{ ...moviePlay, media: { ...moviePlay.media, movieSlug: undefined } }])
    const title = await screen.findByText('Inception')
    expect(title.closest('a')).toBeNull()
  })
})
