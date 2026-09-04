import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WatchlistSummary } from '@rwnd/shared'
import { WatchlistsPage } from './WatchlistsPage.js'
import { api } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: { ...actual.api, watchlists: { list: vi.fn() } },
  }
})

function watchlist(overrides: Partial<WatchlistSummary> = {}): WatchlistSummary {
  return {
    id: 'list-1',
    name: 'Default',
    isDefault: true,
    itemCount: 0,
    coverPosterPath: null,
    ...overrides,
  }
}

function renderPage(watchlists: WatchlistSummary[]) {
  vi.mocked(api.watchlists.list).mockResolvedValue({ watchlists })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WatchlistsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WatchlistsPage', () => {
  it('links each tile to its list, with a cosmetic name slug appended', async () => {
    renderPage([
      watchlist(),
      watchlist({ id: 'list-2', name: 'Sci-Fi Night!', isDefault: false, itemCount: 3 }),
    ])

    await screen.findByText('Sci-Fi Night!')
    expect(screen.getByText('3 titles')).toBeInTheDocument()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]!).toHaveAttribute('href', '/watchlists/list-1/default')
    // Punctuation collapses and the trailing "!" is trimmed, so the segment
    // is always URL-safe without encoding.
    expect(links[1]!).toHaveAttribute('href', '/watchlists/list-2/sci-fi-night')
  })

  it('falls back to the slugless URL when a name slugifies to nothing', async () => {
    // A list name is free text with no slug-safety guarantee, unlike a
    // show/movie title — this is why both routes exist in App.tsx, not
    // just the slugged one.
    renderPage([watchlist({ id: 'list-3', name: '🎬🍿', isDefault: false })])

    await screen.findByText('🎬🍿')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/watchlists/list-3')
  })
})
