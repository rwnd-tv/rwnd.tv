import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DatabaseBackupStatus } from '@rwnd/shared'
import { DatabaseBackupsPanel } from './DatabaseBackupsPanel.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        ...actual.api.admin,
        databaseBackupStatus: vi.fn(),
        updateDatabaseBackupRetention: vi.fn(),
      },
    },
  }
})

const DEFAULT_RETENTION = {
  dailyRetentionDays: 7,
  weeklyRetentionWeeks: 4,
  monthlyRetentionMonths: 12,
}

function renderPanel(status: DatabaseBackupStatus) {
  vi.mocked(api.admin.databaseBackupStatus).mockResolvedValue(status)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabaseBackupsPanel />
    </QueryClientProvider>,
  )
}

describe('DatabaseBackupsPanel', () => {
  it('explains itself when DATABASE_BACKUP_DIR is not configured', async () => {
    renderPanel({
      configured: false,
      intervalHours: 24,
      retention: DEFAULT_RETENTION,
      files: [],
      lastRun: null,
      directoryError: null,
    })

    expect(await screen.findByText(/DATABASE_BACKUP_DIR/)).toBeInTheDocument()
  })

  it('shows the last backup, retention form, and schedule when configured', async () => {
    renderPanel({
      configured: true,
      intervalHours: 24,
      retention: DEFAULT_RETENTION,
      files: [
        {
          name: 'rwnd-20260909T030000Z.sql.gz',
          bytes: 13_000_000,
          createdAt: '2026-09-09T03:00:00Z',
        },
        {
          name: 'rwnd-20260908T030000Z.sql.gz',
          bytes: 12_400_000,
          createdAt: '2026-09-08T03:00:00Z',
        },
      ],
      lastRun: { at: '2026-09-09T03:00:05Z', status: 'ok', message: null },
      directoryError: null,
    })

    expect(await screen.findAllByText(/12\.4 MB/)).not.toHaveLength(0)
    expect(screen.getByText('Every 24h')).toBeInTheDocument()
    expect(screen.getByText('rwnd-20260909T030000Z.sql.gz')).toBeInTheDocument()

    expect(screen.getByLabelText('Keep every backup for (days)')).toHaveValue(7)
    expect(screen.getByLabelText('Then keep one per week for (weeks)')).toHaveValue(4)
    expect(screen.getByLabelText('Then keep one per month for (months)')).toHaveValue(12)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    const restoreLink = screen.getByRole('link', {
      name: "the self-hosting guide's Restoring instructions",
    })
    expect(restoreLink).toHaveAttribute(
      'href',
      'https://github.com/rwnd-tv/rwnd.tv/blob/main/docs/self-hosting.md#restoring',
    )
  })

  it('saves an edited retention tier and reflects the response', async () => {
    const user = userEvent.setup()
    const updated: DatabaseBackupStatus = {
      configured: true,
      intervalHours: 24,
      retention: { dailyRetentionDays: 365, weeklyRetentionWeeks: 0, monthlyRetentionMonths: 0 },
      files: [],
      lastRun: null,
      directoryError: null,
    }
    vi.mocked(api.admin.updateDatabaseBackupRetention).mockResolvedValue(updated)

    renderPanel({
      configured: true,
      intervalHours: 24,
      retention: DEFAULT_RETENTION,
      files: [],
      lastRun: null,
      directoryError: null,
    })

    const dailyField = await screen.findByLabelText('Keep every backup for (days)')
    await user.clear(dailyField)
    await user.type(dailyField, '365')
    await user.clear(screen.getByLabelText('Then keep one per week for (weeks)'))
    await user.type(screen.getByLabelText('Then keep one per week for (weeks)'), '0')
    await user.clear(screen.getByLabelText('Then keep one per month for (months)'))
    await user.type(screen.getByLabelText('Then keep one per month for (months)'), '0')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.admin.updateDatabaseBackupRetention).toHaveBeenCalledWith({
      dailyRetentionDays: 365,
      weeklyRetentionWeeks: 0,
      monthlyRetentionMonths: 0,
    })
    expect(await screen.findByLabelText('Keep every backup for (days)')).toHaveValue(365)
  })

  it('surfaces a failed last run even with no files written yet', async () => {
    renderPanel({
      configured: true,
      intervalHours: 24,
      retention: DEFAULT_RETENTION,
      files: [],
      lastRun: {
        at: '2026-09-09T03:00:00Z',
        status: 'failed',
        message: 'pg_dump exited 1: server version mismatch',
      },
      directoryError: null,
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('server version mismatch')
  })
})
