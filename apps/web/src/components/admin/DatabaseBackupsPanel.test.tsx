import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DatabaseBackupStatus, InstanceSettings, User } from '@rwnd/shared'
import { DatabaseBackupsPanel } from './DatabaseBackupsPanel.js'
import { api } from '../../lib/api-client.js'
import { AuthContext } from '../../lib/use-auth.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      health: vi.fn(),
      admin: {
        ...actual.api.admin,
        databaseBackupStatus: vi.fn(),
        updateDatabaseBackupRetention: vi.fn(),
        runDatabaseBackupNow: vi.fn(),
        restoreDatabaseBackup: vi.fn(),
      },
    },
  }
})

const DEFAULT_RETENTION = {
  dailyRetentionDays: 7,
  weeklyRetentionWeeks: 4,
  monthlyRetentionMonths: 12,
}

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed',
  defaultLocale: 'en-GB',
  metadataProviderPriority: ['tmdb'],
  availableMetadataProviders: ['tmdb'],
  environmentLabel: null,
  traktConfigured: false,
  backupsConfigured: false,
  emailConfigured: true,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
  webhookTokensRecoverable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

const ownerUser: User = {
  id: 'owner-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  locale: 'en-GB',
  timezone: 'UTC',
  theme: 'system',
  spoilerProtectionEnabled: true,
  onDeckFillGaps: false,
  role: 'owner',
  avatarUpdatedAt: null,
  emailVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

const adminUser: User = { ...ownerUser, id: 'admin-1', email: 'admin@example.com', role: 'admin' }

/** Every field a status response needs, with sane defaults — individual
 * tests only override what they care about, so adding a new status field
 * later doesn't require touching every existing test. */
function baseStatus(overrides: Partial<DatabaseBackupStatus> = {}): DatabaseBackupStatus {
  return {
    configured: true,
    intervalHours: 24,
    retention: DEFAULT_RETENTION,
    files: [],
    lastRun: null,
    directoryError: null,
    restoreAvailable: false,
    lastRestore: null,
    snapshots: [],
    ...overrides,
  }
}

function renderPanel(
  status: DatabaseBackupStatus,
  { user = ownerUser, settings = baseSettings }: { user?: User; settings?: InstanceSettings } = {},
) {
  vi.mocked(api.admin.databaseBackupStatus).mockResolvedValue(status)
  vi.mocked(api.settings.get).mockResolvedValue(settings)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, isLoading: false, refetch: () => Promise.resolve() }}>
        <DatabaseBackupsPanel />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('DatabaseBackupsPanel', () => {
  it('explains itself when DATABASE_BACKUP_DIR is not configured', async () => {
    renderPanel(baseStatus({ configured: false }))

    expect(await screen.findByText(/DATABASE_BACKUP_DIR/)).toBeInTheDocument()
  })

  it('shows the last backup, retention form, and schedule when configured', async () => {
    renderPanel(
      baseStatus({
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
      }),
    )

    expect(await screen.findAllByText(/12\.4 MB/)).not.toHaveLength(0)
    expect(screen.getByText('Every 24h')).toBeInTheDocument()
    expect(screen.getByText('rwnd-20260909T030000Z.sql.gz')).toBeInTheDocument()

    expect(screen.getByLabelText('Keep one backup per day for (days)')).toHaveValue(7)
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
    const updated = baseStatus({
      retention: { dailyRetentionDays: 365, weeklyRetentionWeeks: 0, monthlyRetentionMonths: 0 },
    })
    vi.mocked(api.admin.updateDatabaseBackupRetention).mockResolvedValue(updated)

    renderPanel(baseStatus())

    const dailyField = await screen.findByLabelText('Keep one backup per day for (days)')
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
    expect(await screen.findByLabelText('Keep one backup per day for (days)')).toHaveValue(365)
  })

  it('"Run backup now" succeeding does not discard an unsaved retention edit (fixed 2026-09-21, see docs/TODO.md)', async () => {
    // runNow's onSuccess writes a fresh status object straight into the
    // cache via queryClient.setQueryData, unlike a plain refetch - that
    // always gives `data.retention` a new object identity, even though
    // this mock's retention values are byte-identical to the ones the
    // form was already seeded with. The old bug re-seeded on any identity
    // change, with no per-field check, so it clobbered whatever the admin
    // was mid-typing.
    const user = userEvent.setup()
    vi.mocked(api.admin.runDatabaseBackupNow).mockResolvedValue(
      baseStatus({
        retention: { ...DEFAULT_RETENTION },
        lastRun: { at: '2026-09-21T03:00:00Z', status: 'ok', message: null },
      }),
    )

    renderPanel(baseStatus())

    const dailyField = await screen.findByLabelText('Keep one backup per day for (days)')
    await user.clear(dailyField)
    await user.type(dailyField, '30')
    expect(dailyField).toHaveValue(30)

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    await screen.findByText('Backup complete.')

    expect(screen.getByLabelText('Keep one backup per day for (days)')).toHaveValue(30)
  })

  it('surfaces a failed last run even with no files written yet', async () => {
    renderPanel(
      baseStatus({
        lastRun: {
          at: '2026-09-09T03:00:00Z',
          status: 'failed',
          message: 'pg_dump exited 1: server version mismatch',
        },
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('server version mismatch')
  })

  it('explains why restore is unavailable to a non-owner admin, even with restoreAvailable true', async () => {
    renderPanel(baseStatus({ restoreAvailable: true }), { user: adminUser })

    await screen.findByText(/Only the instance owner can restore a backup from here\./)
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('explains why restore is unavailable to the owner when not running under docker-entrypoint.sh', async () => {
    renderPanel(baseStatus({ restoreAvailable: false }), { user: ownerUser })

    await screen.findByText(/isn't running under docker-entrypoint\.sh/)
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('lets the owner confirm and request a restore, then shows the restoring state', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.restoreDatabaseBackup).mockResolvedValue(undefined)

    renderPanel(
      baseStatus({
        restoreAvailable: true,
        files: [
          {
            name: 'rwnd-20260909T030000Z.sql.gz',
            bytes: 13_000_000,
            createdAt: '2026-09-09T03:00:00Z',
          },
        ],
      }),
      { user: ownerUser },
    )

    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    await screen.findByText('Type the instance name (rwnd.tv) to confirm')

    await user.type(screen.getByLabelText('Type the instance name (rwnd.tv) to confirm'), 'rwnd.tv')
    await user.type(screen.getByLabelText('Current password'), 'correct-horse-battery')
    await user.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!)

    expect(api.admin.restoreDatabaseBackup).toHaveBeenCalledWith('rwnd-20260909T030000Z.sql.gz', {
      confirmInstanceName: 'rwnd.tv',
      currentPassword: 'correct-horse-battery',
    })
    await screen.findByText(
      "The server is restarting. This page will move to the sign-in page once it's back.",
    )
  })

  it('offers a Restore button on pre-restore snapshots too, for undoing a restore', async () => {
    renderPanel(
      baseStatus({
        restoreAvailable: true,
        snapshots: [
          {
            name: 'rwnd-pre-restore-20260909T030000Z.sql.gz',
            bytes: 12_000_000,
            createdAt: '2026-09-09T03:00:00Z',
          },
        ],
      }),
      { user: ownerUser },
    )

    await screen.findByText('rwnd-pre-restore-20260909T030000Z.sql.gz')
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1)
  })

  it('surfaces a failed last restore', async () => {
    renderPanel(
      baseStatus({
        restoreAvailable: true,
        lastRestore: {
          file: 'rwnd-20260909T030000Z.sql.gz',
          requestedAt: '2026-09-09T03:00:00Z',
          finishedAt: '2026-09-09T03:00:10Z',
          status: 'failed',
          message: 'psql exited 1: syntax error',
          snapshot: 'rwnd-pre-restore-20260909T030000Z.sql.gz',
        },
      }),
      { user: ownerUser },
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('syntax error')
  })

  it('shows a timed-out message when the health check never recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
    vi.mocked(api.admin.restoreDatabaseBackup).mockResolvedValue(undefined)
    vi.mocked(api.health).mockRejectedValue(new Error('connection refused'))

    renderPanel(
      baseStatus({
        restoreAvailable: true,
        files: [
          {
            name: 'rwnd-20260909T030000Z.sql.gz',
            bytes: 13_000_000,
            createdAt: '2026-09-09T03:00:00Z',
          },
        ],
      }),
      { user: ownerUser },
    )

    await user.click(await screen.findByRole('button', { name: 'Restore' }))
    await user.type(screen.getByLabelText('Type the instance name (rwnd.tv) to confirm'), 'rwnd.tv')
    await user.type(screen.getByLabelText('Current password'), 'correct-horse-battery')
    await user.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!)

    await screen.findByText(
      "The server is restarting. This page will move to the sign-in page once it's back.",
    )

    await vi.advanceTimersByTimeAsync(61_000)
    await waitFor(() =>
      expect(
        screen.getByText(
          "The server hasn't come back within a minute. Check docker compose logs on the host to see what happened.",
        ),
      ).toBeInTheDocument(),
    )

    vi.useRealTimers()
  })
})
