import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BackupSummary, DiffBackupResponse, InstanceSettings } from '@rwnd/shared'
import { DatabasePanel } from './DatabasePanel.js'
import { api } from '../../lib/api-client.js'

// Only the diff dialog is covered here — DatabasePanel as a whole has no
// other test coverage yet (create/restore/delete/clear-data), out of
// scope for the diff-dialog TODO this file was added for.
vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      account: { ...actual.api.account, dataCounts: vi.fn() },
      backups: {
        ...actual.api.backups,
        list: vi.fn(),
        diff: vi.fn(),
      },
    },
  }
})

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed',
  defaultLocale: 'en-GB',
  metadataProviderPriority: ['tmdb'],
  availableMetadataProviders: ['tmdb'],
  environmentLabel: null,
  traktConfigured: false,
  backupsConfigured: true,
  emailConfigured: true,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
  webhookTokensRecoverable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

const backup: BackupSummary = {
  id: 'before-more-watching-20260101t000000z',
  createdAt: '2026-01-01T00:00:00Z',
  description: 'Before more watching',
  counts: { watchHistory: 2, ratings: 1, watchlist: 0, droppedShows: 0 },
  skipped: 0,
}

const EMPTY_CATEGORY = { added: 0, removed: 0, addedItems: [], removedItems: [] }

function renderPanel(diff: DiffBackupResponse['diff']) {
  vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
  vi.mocked(api.account.dataCounts).mockResolvedValue({
    watchHistory: 0,
    ratings: 0,
    watchlist: 0,
    droppedShows: 0,
  })
  vi.mocked(api.backups.list).mockResolvedValue({ backups: [backup] })
  vi.mocked(api.backups.diff).mockResolvedValue({ diff })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DatabasePanel />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('DatabasePanel diff dialog', () => {
  it('hides the "what changed" section when the diff is all-zero', async () => {
    const user = userEvent.setup()
    renderPanel({
      watchHistory: EMPTY_CATEGORY,
      ratings: EMPTY_CATEGORY,
      watchlist: EMPTY_CATEGORY,
      droppedShows: EMPTY_CATEGORY,
    })

    await user.click(await screen.findByRole('button', { name: 'Diff' }))

    // One "0 added, 0 removed" line per category.
    expect(await screen.findAllByText('0 added, 0 removed')).toHaveLength(4)
    expect(screen.queryByText('Show what changed')).not.toBeInTheDocument()
  })

  it('lists the added and removed items, split into separate fields', async () => {
    const user = userEvent.setup()
    renderPanel({
      watchHistory: {
        added: 1,
        removed: 1,
        addedItems: [
          {
            date: '2026-01-05',
            time: '00:00',
            title: 'Breaking Bad',
            episode: 'S01E01',
            suffix: null,
          },
        ],
        removedItems: [
          {
            date: '2026-01-01',
            time: '00:00',
            title: 'The Matrix (1999)',
            episode: null,
            suffix: null,
          },
        ],
      },
      ratings: EMPTY_CATEGORY,
      watchlist: EMPTY_CATEGORY,
      droppedShows: EMPTY_CATEGORY,
    })

    await user.click(await screen.findByRole('button', { name: 'Diff' }))

    expect(await screen.findByText('Show what changed')).toBeInTheDocument()
    // date/time, title and episode render as separate elements (so the
    // title alone can truncate without ever hiding the episode number) -
    // check each part rather than one combined string.
    expect(screen.getByText('2026-01-05 00:00')).toBeInTheDocument()
    expect(screen.getByText('Breaking Bad')).toBeInTheDocument()
    expect(screen.getByText('S01E01')).toBeInTheDocument()
    expect(screen.getByText('2026-01-01 00:00')).toBeInTheDocument()
    expect(screen.getByText('The Matrix (1999)')).toBeInTheDocument()
  })

  it('merges every category into one newest-first list with a +/- marker per row', async () => {
    const user = userEvent.setup()
    renderPanel({
      watchHistory: {
        added: 1,
        removed: 0,
        addedItems: [
          {
            date: '2026-01-01',
            time: '00:00',
            title: 'The Matrix (1999)',
            episode: null,
            suffix: null,
          },
        ],
        removedItems: [],
      },
      ratings: {
        added: 0,
        removed: 1,
        addedItems: [],
        removedItems: [
          {
            date: '2026-01-05',
            time: '00:00',
            title: 'Breaking Bad',
            episode: 'S01E01',
            suffix: '5/10',
          },
        ],
      },
      watchlist: EMPTY_CATEGORY,
      droppedShows: EMPTY_CATEGORY,
    })

    await user.click(await screen.findByRole('button', { name: 'Diff' }))
    await user.click(await screen.findByText('Show what changed'))

    const rows = screen
      .getAllByRole('listitem')
      .filter((li) => li.textContent?.includes('+') || li.textContent?.includes('−'))
    // Newest first: the rating removal (2026-01-05) before the watch addition (2026-01-01).
    expect(rows).toHaveLength(2)
    const [newest, oldest] = rows
    expect(newest!.textContent).toContain('−')
    expect(newest!.textContent).toContain('Breaking Bad')
    expect(oldest!.textContent).toContain('+')
    expect(oldest!.textContent).toContain('The Matrix (1999)')
  })
})
