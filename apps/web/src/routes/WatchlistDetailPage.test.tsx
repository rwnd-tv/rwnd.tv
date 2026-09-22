import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { User, WatchlistDetail, WatchlistItemMedia } from '@rwnd/shared'
import { WatchlistDetailPage } from './WatchlistDetailPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      watchlists: { get: vi.fn(), update: vi.fn(), delete: vi.fn() },
      library: {
        ...actual.api.library,
        removeShowFromWatchlist: vi.fn(),
        removeMovieFromWatchlist: vi.fn(),
      },
    },
  }
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

function testItem(overrides: Partial<WatchlistItemMedia> = {}): WatchlistItemMedia {
  return {
    itemId: 'item-1',
    type: 'show',
    slug: 'a-show',
    title: 'A Show',
    year: null,
    posterPath: null,
    voteAverage: null,
    listedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function testWatchlist(items: WatchlistItemMedia[]): WatchlistDetail {
  return { id: 'list-1', name: 'Default', isDefault: true, coverItemId: null, items }
}

function renderPage(watchlist: WatchlistDetail, user = testUser()) {
  vi.mocked(api.watchlists.get).mockResolvedValue(watchlist)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, isLoading: false, refetch: () => Promise.resolve() }}>
        <MemoryRouter initialEntries={[`/watchlists/${watchlist.id}`]}>
          <Routes>
            <Route path="/watchlists/:id" element={<WatchlistDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

function headingOrder() {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
}

const alpha = testItem({ itemId: 'a', title: 'Alpha', year: 2000, voteAverage: 5.0 })
const beta = testItem({ itemId: 'b', title: 'Beta', year: 2010, voteAverage: 9.0 })
const gamma = testItem({ itemId: 'c', title: 'Gamma', year: 2020, voteAverage: 2.0 })

describe('WatchlistDetailPage sort/filter', () => {
  it('sorts items by release year when a year sort option is selected', async () => {
    renderPage(testWatchlist([alpha, beta, gamma]))
    await screen.findByText('Alpha')

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Year (Descending)')
    expect(headingOrder()).toEqual(['Gamma', 'Beta', 'Alpha'])

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Year (Ascending)')
    expect(headingOrder()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts items by TMDB rating when a rating sort option is selected', async () => {
    renderPage(testWatchlist([alpha, beta, gamma]))
    await screen.findByText('Alpha')

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'TMDB Rating (Descending)')
    expect(headingOrder()).toEqual(['Beta', 'Alpha', 'Gamma'])

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'TMDB Rating (Ascending)')
    expect(headingOrder()).toEqual(['Gamma', 'Alpha', 'Beta'])
  })

  it('shows no Filters button when nothing on the list has a known year or rating', async () => {
    renderPage(testWatchlist([testItem({ itemId: 'a', title: 'Unrated' })]))
    await screen.findByText('Unrated')
    expect(screen.queryByRole('button', { name: 'Filters…' })).not.toBeInTheDocument()
  })

  it('filters items by release year range', async () => {
    renderPage(testWatchlist([alpha, beta, gamma]))
    await screen.findByText('Alpha')

    await userEvent.click(screen.getByRole('button', { name: 'Filters…' }))
    // Year bounds are 2000-2020, one step per year — narrowing "After" to
    // index 5 (2005) excludes Alpha (2000) but keeps Beta (2010)/Gamma (2020).
    fireEvent.change(screen.getByLabelText('After'), { target: { value: '5' } })

    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('filters items by TMDB rating range', async () => {
    renderPage(testWatchlist([alpha, beta, gamma]))
    await screen.findByText('Alpha')

    await userEvent.click(screen.getByRole('button', { name: 'Filters…' }))
    // Rating bounds are 2.0-9.0 in 0.1 steps — narrowing "Min" to index 10
    // (3.0) excludes Gamma (2.0) but keeps Alpha (5.0)/Beta (9.0).
    fireEvent.change(screen.getByLabelText('Min'), { target: { value: '10' } })

    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('the Reset button clears both filters back to the full range', async () => {
    renderPage(testWatchlist([alpha, beta, gamma]))
    await screen.findByText('Alpha')

    await userEvent.click(screen.getByRole('button', { name: 'Filters…' }))
    fireEvent.change(screen.getByLabelText('After'), { target: { value: '5' } })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
