import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, InstanceSettings, ListAdminUsersResponse, User } from '@rwnd/shared'
import { UsersPanel } from './UsersPanel.js'
import { AuthContext } from '../../lib/use-auth.js'
import { api, ApiError } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      admin: {
        listUsers: vi.fn(),
        updateUserRole: vi.fn(),
        deleteUser: vi.fn(),
        listUserSessions: vi.fn(),
        revokeUserSession: vi.fn(),
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
  appVersion: '0.1.0',
  adminEmail: null,
}

const currentAdmin: User = {
  id: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  locale: 'en-GB',
  timezone: 'UTC',
  theme: 'system',
  spoilerProtectionEnabled: true,
  onDeckFillGaps: false,
  role: 'admin',
  avatarUpdatedAt: null,
  emailVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

function adminUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    emailVerifiedAt: new Date().toISOString(),
    mfaEnabled: false,
    sessionCount: 1,
    ...overrides,
  }
}

function renderPanel(users: AdminUserSummary[]) {
  vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
  vi.mocked(api.admin.listUsers).mockResolvedValue({ users } satisfies ListAdminUsersResponse)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: currentAdmin, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <UsersPanel />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('UsersPanel', () => {
  beforeEach(() => {
    vi.mocked(api.admin.updateUserRole).mockReset()
    vi.mocked(api.admin.deleteUser).mockReset()
    vi.mocked(api.admin.listUserSessions).mockReset()
    vi.mocked(api.admin.sendPasswordReset).mockReset()
  })

  it('shows an empty state with no users', async () => {
    renderPanel([])
    await screen.findByText('No users yet.')
  })

  it('renders a row per user, with a role badge and last-login text', async () => {
    renderPanel([
      adminUser(),
      adminUser({
        id: 'user-1',
        email: 'watcher@example.com',
        displayName: 'Watcher',
        role: 'user',
        lastLoginAt: null,
      }),
    ])

    await screen.findByText('Watcher')
    expect(screen.getByText('watcher@example.com')).toBeInTheDocument()
    expect(screen.getByText('Never signed in')).toBeInTheDocument()
    // Two "Admin" badges expected: the role badge on the admin row (the
    // other user's role badge reads "User").
    const adminRow = screen.getByText('Admin', { selector: 'p' }).closest('li')!
    expect(within(adminRow).getByText('Admin', { selector: 'span' })).toBeInTheDocument()
  })

  it('expanding a row and changing role opens a confirm dialog, then calls the mutation', async () => {
    renderPanel([
      adminUser({
        id: 'user-1',
        email: 'watcher@example.com',
        displayName: 'Watcher',
        role: 'user',
      }),
    ])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })
    vi.mocked(api.admin.updateUserRole).mockResolvedValue(
      adminUser({
        id: 'user-1',
        email: 'watcher@example.com',
        displayName: 'Watcher',
        role: 'admin',
      }),
    )

    await userEvent.click(await screen.findByText('Watcher'))
    const select = await screen.findByLabelText('Role')
    await userEvent.selectOptions(select, 'admin')

    await screen.findByText('Promote to admin?')
    await userEvent.click(screen.getByRole('button', { name: 'Promote' }))

    expect(api.admin.updateUserRole).toHaveBeenCalledWith('user-1', 'admin')
  })

  it('warns when an admin demotes themselves', async () => {
    renderPanel([adminUser()])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })

    await userEvent.click(await screen.findByText('Admin', { selector: 'p' }))
    const select = await screen.findByLabelText('Role')
    await userEvent.selectOptions(select, 'user')

    await screen.findByText(
      "You're removing your own admin access. You won't be able to undo this yourself — another admin would need to promote you back.",
    )
  })

  it('shows a server error inline when a role change is rejected', async () => {
    renderPanel([
      adminUser({
        id: 'user-1',
        email: 'watcher@example.com',
        displayName: 'Watcher',
        role: 'user',
      }),
    ])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })
    vi.mocked(api.admin.updateUserRole).mockRejectedValue(
      new ApiError(400, "Can't remove the last remaining admin"),
    )

    await userEvent.click(await screen.findByText('Watcher'))
    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Promote' }))

    await screen.findByText("Can't remove the last remaining admin")
  })

  it("the delete dialog's confirm button stays disabled until the email matches", async () => {
    renderPanel([
      adminUser({
        id: 'user-1',
        email: 'watcher@example.com',
        displayName: 'Watcher',
        role: 'user',
      }),
    ])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })

    await userEvent.click(await screen.findByText('Watcher'))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))

    // Opening the dialog adds a second "Delete account" button (the row's
    // own trigger, plus the dialog's danger-styled confirm) — the dialog's
    // is the one that's disabled until the typed email matches.
    const dialogConfirmButton = screen.getAllByRole('button', { name: 'Delete account' }).at(-1)!
    expect(dialogConfirmButton).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Email address'), 'watcher@example.com')
    expect(dialogConfirmButton).not.toBeDisabled()

    await userEvent.click(dialogConfirmButton)
    expect(api.admin.deleteUser).toHaveBeenCalledWith('user-1')
  })

  it("does not offer a delete button on the current admin's own row", async () => {
    renderPanel([adminUser()])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })

    await userEvent.click(await screen.findByText('Admin', { selector: 'p' }))
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  })

  it("shows a static label instead of a role Select on the owner's row, and no delete button", async () => {
    renderPanel([
      adminUser(),
      adminUser({
        id: 'owner-1',
        email: 'owner@example.com',
        displayName: 'The Owner',
        role: 'owner',
      }),
    ])
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })

    await userEvent.click(await screen.findByText('The Owner'))
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "The owner's role can only be changed by the owner themselves, from their Account page.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  })
})
