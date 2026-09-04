import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, InstanceSettings } from '@rwnd/shared'
import { UserBulkActions } from './UserBulkActions.js'
import { api, ApiError } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      admin: {
        deleteUser: vi.fn(),
        updateUserRole: vi.fn(),
        revokeAllUserSessions: vi.fn(),
        sendPasswordReset: vi.fn(),
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
  backupsConfigured: false,
  emailConfigured: true,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

function adminUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    email: 'watcher@example.com',
    displayName: 'Watcher',
    role: 'user',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    emailVerifiedAt: new Date().toISOString(),
    avatarUpdatedAt: null,
    mfaEnabled: false,
    sessionCount: 1,
    ...overrides,
  }
}

function renderBar({
  selectedUsers = [],
  hiddenSelectedCount = 0,
  settings = baseSettings,
  onSelectionSettled = vi.fn(),
  onClearSelection = vi.fn(),
  onBusyChange = vi.fn(),
}: {
  selectedUsers?: AdminUserSummary[]
  hiddenSelectedCount?: number
  settings?: InstanceSettings
  onSelectionSettled?: (ids: string[]) => void
  onClearSelection?: () => void
  onBusyChange?: (busy: boolean) => void
} = {}) {
  vi.mocked(api.settings.get).mockResolvedValue(settings)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <UserBulkActions
        selectedUsers={selectedUsers}
        hiddenSelectedCount={hiddenSelectedCount}
        onSelectionSettled={onSelectionSettled}
        onClearSelection={onClearSelection}
        onBusyChange={onBusyChange}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onSelectionSettled, onClearSelection, onBusyChange }
}

describe('UserBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when nothing is selected and there is no report', () => {
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the selected count and the hidden-by-filter count', async () => {
    renderBar({ selectedUsers: [adminUser()], hiddenSelectedCount: 1 })
    await screen.findByText('1 selected')
    expect(screen.getByText('1 hidden by the current filter')).toBeInTheDocument()
  })

  it('sends a password reset without confirming, and reports success', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.sendPasswordReset).mockResolvedValue(undefined)
    const { onSelectionSettled } = renderBar({
      selectedUsers: [adminUser(), adminUser({ id: 'user-2', displayName: 'Root' })],
    })
    await screen.findByText('2 selected')

    await user.click(await screen.findByRole('button', { name: 'Send password reset' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.admin.sendPasswordReset).toHaveBeenCalledTimes(2)
    await screen.findByText('Reset email sent to 2 of 2 accounts.')
    expect(onSelectionSettled).toHaveBeenCalledWith([])
  })

  it('hides the password reset trigger and explains why when SMTP is not configured', async () => {
    renderBar({
      selectedUsers: [adminUser()],
      settings: { ...baseSettings, emailConfigured: false },
    })
    await screen.findByText('1 selected')

    expect(screen.queryByRole('button', { name: 'Send password reset' })).not.toBeInTheDocument()
    expect(screen.getByText("Email isn't configured on this instance.")).toBeInTheDocument()
    expect(api.admin.sendPasswordReset).not.toHaveBeenCalled()
  })

  it('revokes sessions without confirming', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.revokeAllUserSessions).mockResolvedValue(undefined)
    renderBar({ selectedUsers: [adminUser()] })
    await screen.findByText('1 selected')

    await user.click(screen.getByRole('button', { name: 'Revoke sessions' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await screen.findByText('1 of 1 account signed out everywhere.')
  })

  it('confirms before promoting, listing the affected accounts', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.updateUserRole).mockResolvedValue(adminUser())
    renderBar({
      selectedUsers: [adminUser(), adminUser({ id: 'user-2', displayName: 'Root' })],
    })
    await screen.findByText('2 selected')

    await user.click(screen.getByRole('button', { name: 'Promote to admin' }))
    const dialog = await screen.findByRole('dialog', { name: 'Promote 2 accounts to admin?' })
    expect(within(dialog).getByText('Watcher')).toBeInTheDocument()
    expect(within(dialog).getByText('Root')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))

    expect(api.admin.updateUserRole).toHaveBeenCalledWith('user-1', 'admin')
    expect(api.admin.updateUserRole).toHaveBeenCalledWith('user-2', 'admin')
    await screen.findByText('2 of 2 accounts promoted.')
  })

  it('reports a partial failure on demote and keeps the refused user selected', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.updateUserRole).mockImplementation((id) =>
      id === 'user-2'
        ? Promise.reject(new ApiError(400, "Can't remove the last remaining admin"))
        : Promise.resolve(adminUser({ id })),
    )
    const { onSelectionSettled } = renderBar({
      selectedUsers: [adminUser(), adminUser({ id: 'user-2', displayName: 'Root' })],
    })
    await screen.findByText('2 selected')

    await user.click(screen.getByRole('button', { name: 'Remove admin access' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove admin access' }))

    const report = await screen.findByText('1 of 2 accounts demoted.')
    const reportRegion = report.closest('[role="status"]') as HTMLElement
    await user.click(within(reportRegion).getByText('1 refused'))
    expect(
      within(reportRegion).getByText("Can't remove the last remaining admin"),
    ).toBeInTheDocument()
    expect(within(reportRegion).getByText('Root')).toBeInTheDocument()
    expect(onSelectionSettled).toHaveBeenCalledWith(['user-2'])
  })

  it('reports the owner as refused on a bulk delete, rather than pre-filtering them out', async () => {
    const user = userEvent.setup()
    vi.mocked(api.admin.deleteUser).mockImplementation((id) =>
      id === 'owner-1'
        ? Promise.reject(new ApiError(400, "Can't delete the owner's account"))
        : Promise.resolve(undefined),
    )
    renderBar({
      selectedUsers: [
        adminUser(),
        adminUser({ id: 'owner-1', displayName: 'Root', role: 'owner' }),
      ],
    })
    await screen.findByText('2 selected')

    await user.click(screen.getByRole('button', { name: 'Delete accounts' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const report = await screen.findByText('1 of 2 accounts deleted.')
    const reportRegion = report.closest('[role="status"]') as HTMLElement
    await user.click(within(reportRegion).getByText('1 refused'))
    expect(within(reportRegion).getByText("Can't delete the owner's account")).toBeInTheDocument()
  })

  it('cancelling the confirm dialog never calls the API', async () => {
    const user = userEvent.setup()
    renderBar({ selectedUsers: [adminUser()] })
    await screen.findByText('1 selected')

    await user.click(screen.getByRole('button', { name: 'Delete accounts' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('disables every other trigger and reports busy while a bulk action is in flight', async () => {
    const user = userEvent.setup()
    let resolveDelete!: () => void
    vi.mocked(api.admin.deleteUser).mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      }),
    )
    const { onBusyChange } = renderBar({ selectedUsers: [adminUser()] })
    await screen.findByText('1 selected')

    await user.click(screen.getByRole('button', { name: 'Delete accounts' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onBusyChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Revoke sessions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Promote to admin' })).toBeDisabled()

    resolveDelete()
    await screen.findByText('1 of 1 account deleted.')
    expect(onBusyChange).toHaveBeenCalledWith(false)
  })
})
