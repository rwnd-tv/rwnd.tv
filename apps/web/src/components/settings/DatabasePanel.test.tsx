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

const EMPTY_CATEGORY = { added: 0, removed: 0, addedTitles: [], removedTitles: [] }

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

  it('lists the added and removed item titles when something changed', async () => {
    const user = userEvent.setup()
    renderPanel({
      watchHistory: {
        added: 1,
        removed: 1,
        addedTitles: ['Breaking Bad S01E01 — Pilot · watched 2026-01-05'],
        removedTitles: ['The Matrix (1999) · watched 2026-01-01'],
      },
      ratings: EMPTY_CATEGORY,
      watchlist: EMPTY_CATEGORY,
      droppedShows: EMPTY_CATEGORY,
    })

    await user.click(await screen.findByRole('button', { name: 'Diff' }))

    expect(await screen.findByText('Show what changed')).toBeInTheDocument()
    expect(screen.getByText('Breaking Bad S01E01 — Pilot · watched 2026-01-05')).toBeInTheDocument()
    expect(screen.getByText('The Matrix (1999) · watched 2026-01-01')).toBeInTheDocument()
  })
})
