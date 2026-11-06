import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ActivityEntry, ListActivityResponse, User } from '@rwnd/shared'
import { HistoryPage } from './HistoryPage.js'
import { api } from '../lib/api-client.js'
import { AuthContext } from '../lib/use-auth.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: { ...actual.api, activity: { list: vi.fn(), removeMany: vi.fn() } },
  }
})

const entry = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'watch',
  occurredAt: '2026-01-01T12:00:00.000Z',
  source: 'manual',
  media: { type: 'movie', id: 'movie-1', slug: 'the-matrix-1999', title: 'The Matrix' },
} as unknown as ActivityEntry

const authValue = { user: { locale: 'en-GB' } as User } as never

function renderPage() {
  vi.mocked(api.activity.list).mockResolvedValue({
    entries: [entry],
    total: 1,
    hasMore: false,
  } satisfies ListActivityResponse)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter>
          <HistoryPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

function lastListParams() {
  return vi.mocked(api.activity.list).mock.lastCall?.[0]
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Filters…' }))
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const cookie of document.cookie.split('; ')) {
      document.cookie = `${cookie.split('=')[0]}=; max-age=0; path=/`
    }
  })

  describe('source filter', () => {
    it('sends no source filter while every source is ticked', async () => {
      renderPage()
      await screen.findByText('The Matrix')
      expect(lastListParams()?.sources).toBeUndefined()
    })

    it('sends the remaining sources when one is unticked', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Scrobbled' }))

      await waitFor(() => expect(lastListParams()?.sources).toEqual(['imported', 'manual']))
    })

    it('shows nothing when watches are the only kind and no source is ticked', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      for (const name of ['Manual', 'Imported', 'Scrobbled']) {
        await user.click(screen.getByRole('checkbox', { name }))
      }

      await waitFor(() => expect(screen.queryByText('The Matrix')).not.toBeInTheDocument())
      expect(screen.getByRole('checkbox', { name: 'Manual' })).toBeInTheDocument()
    })

    it('keeps other kinds when no source is ticked', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      await user.click(screen.getByRole('checkbox', { name: 'Rated' }))
      for (const name of ['Manual', 'Imported', 'Scrobbled']) {
        await user.click(screen.getByRole('checkbox', { name }))
      }

      await waitFor(() => expect(lastListParams()?.kinds).toEqual(['rating']))
      expect(lastListParams()?.sources).toBeUndefined()
    })

    it('Reset ticks every source again', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)
      await user.click(screen.getByRole('checkbox', { name: 'Scrobbled' }))

      await user.click(screen.getByRole('button', { name: 'Reset' }))

      expect(screen.getByRole('checkbox', { name: 'Scrobbled' })).toBeChecked()
      await waitFor(() => expect(lastListParams()?.sources).toBeUndefined())
    })
  })

  describe('selection bar', () => {
    async function selectEntry(user: ReturnType<typeof userEvent.setup>) {
      await screen.findByText('The Matrix')
      await user.click(screen.getByRole('checkbox', { name: /The Matrix/ }))
      return screen.getByText('1 selected').parentElement!
    }

    it('is pinned with the filter bar', async () => {
      const user = userEvent.setup()
      renderPage()

      const bar = await selectEntry(user)

      expect(bar.closest('.sticky')).not.toBeNull()
      expect(within(bar).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })

    it('stays outside the part of the pinned area that scrolls', async () => {
      const user = userEvent.setup()
      renderPage()
      await openFilters(user)

      const bar = await selectEntry(user)

      expect(bar.closest('.overflow-y-auto')).toBeNull()
    })
  })
})
