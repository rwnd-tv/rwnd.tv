import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, InstanceSettings, User } from '@rwnd/shared'
import { AdminUserPage } from './AdminUserPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api, ApiError } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      admin: {
        getUser: vi.fn(),
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
  calendarFeedsAvailable: false,
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

function renderPage(user: AdminUserSummary, currentUser: User = currentAdmin) {
  vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
  vi.mocked(api.admin.getUser).mockResolvedValue(user)
  vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: currentUser, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter initialEntries={[`/admin/users/${user.id}/some-stale-slug`]}>
          <Routes>
            <Route path="/admin/users/:id" element={<AdminUserPage />} />
            <Route path="/admin/users/:id/:slug" element={<AdminUserPage />} />
            <Route path="/admin" element={<p>Users list</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('AdminUserPage', () => {
  beforeEach(() => {
    vi.mocked(api.admin.updateUserRole).mockReset()
    vi.mocked(api.admin.deleteUser).mockReset()
    vi.mocked(api.admin.sendPasswordReset).mockReset()
  })

  it("renders the user's identity and status", async () => {
    renderPage(adminUser({ mfaEnabled: true, emailVerifiedAt: null }))

    await screen.findByRole('heading', { name: 'Watcher' })
    expect(screen.getByText('watcher@example.com')).toBeInTheDocument()
    expect(screen.getByText('MFA on')).toBeInTheDocument()
    expect(screen.getByText('Unverified')).toBeInTheDocument()
  })

  it('renders one collapsed panel per concern, skipping the ones with nothing to do', async () => {
    renderPage(adminUser())

    // Each panel is a `<details>` whose `<summary>` is its title, all
    // collapsed by default (`usePanelOpen` with no explicit default),
    // same as every panel on Account/Settings/Import.
    const titles = (await screen.findAllByRole('group')).map(
      (panel) => panel.querySelector('summary')?.textContent,
    )
    expect(titles).toEqual(['Sessions', 'Role', 'Password', 'Delete account'])
    for (const panel of screen.getAllByRole('group')) {
      expect(panel).not.toHaveAttribute('open')
    }
  })

  it('explains rather than offering a reset button when the instance has no SMTP configured', async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, emailConfigured: false })
    vi.mocked(api.admin.getUser).mockResolvedValue(adminUser())
    vi.mocked(api.admin.listUserSessions).mockResolvedValue({ sessions: [] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ user: currentAdmin, isLoading: false, refetch: () => Promise.resolve() }}
        >
          <MemoryRouter initialEntries={['/admin/users/user-1/watcher']}>
            <Routes>
              <Route path="/admin/users/:id/:slug" element={<AdminUserPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await screen.findByRole('heading', { name: 'Watcher' })
    // Still a panel, same as Role/Delete account's owner-blocked cases.
    const titles = screen
      .getAllByRole('group')
      .map((panel) => panel.querySelector('summary')?.textContent)
    expect(titles).toEqual(['Sessions', 'Role', 'Password', 'Delete account'])
    expect(screen.queryByRole('button', { name: 'Send password reset' })).not.toBeInTheDocument()
    expect(screen.getByText(/Email isn't configured on this instance/)).toBeInTheDocument()
  })

  it('shows a not-found message for an unknown or deleted user', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
    vi.mocked(api.admin.getUser).mockRejectedValue(new ApiError(404, 'User not found'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ user: currentAdmin, isLoading: false, refetch: () => Promise.resolve() }}
        >
          <MemoryRouter initialEntries={['/admin/users/gone']}>
            <Routes>
              <Route path="/admin/users/:id" element={<AdminUserPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await screen.findByText('This account no longer exists.')
  })

  it('changing role opens a confirm dialog, then calls the mutation', async () => {
    const user = adminUser()
    renderPage(user)
    vi.mocked(api.admin.updateUserRole).mockResolvedValue({ ...user, role: 'admin' })

    const select = await screen.findByLabelText('Role')
    await userEvent.selectOptions(select, 'admin')

    await screen.findByText('Promote to admin?')
    await userEvent.click(screen.getByRole('button', { name: 'Promote' }))

    expect(api.admin.updateUserRole).toHaveBeenCalledWith('user-1', 'admin')
  })

  it('warns when an admin demotes themselves', async () => {
    renderPage(
      adminUser({ id: 'admin-1', email: 'admin@example.com', displayName: 'Admin', role: 'admin' }),
    )

    const select = await screen.findByLabelText('Role')
    await userEvent.selectOptions(select, 'user')

    await screen.findByText(
      "You're removing your own admin access. You won't be able to undo this yourself — another admin would need to promote you back.",
    )
  })

  it('shows a server error inline when a role change is rejected', async () => {
    const user = adminUser()
    renderPage(user)
    vi.mocked(api.admin.updateUserRole).mockRejectedValue(
      new ApiError(400, "Can't remove the last remaining admin"),
    )

    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Promote' }))

    await screen.findByText("Can't remove the last remaining admin")
  })

  it("the delete dialog's confirm button stays disabled until the email matches, then navigates back to the list", async () => {
    const user = adminUser()
    renderPage(user)
    vi.mocked(api.admin.deleteUser).mockResolvedValue(undefined)

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))

    const confirmButton = screen.getAllByRole('button', { name: 'Delete account' }).at(-1)!
    expect(confirmButton).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Email address'), 'watcher@example.com')
    expect(confirmButton).not.toBeDisabled()

    await userEvent.click(confirmButton)
    expect(api.admin.deleteUser).toHaveBeenCalledWith('user-1')
    await screen.findByText('Users list')
  })

  it('explains rather than offering a delete button on your own page', async () => {
    renderPage(
      adminUser({ id: 'admin-1', email: 'admin@example.com', displayName: 'Admin', role: 'admin' }),
    )

    await screen.findByRole('heading', { name: 'Admin' })
    // Delete account stays as a panel, same as the owner's page, but
    // explains the "go to your Account page" redirect instead.
    const titles = screen
      .getAllByRole('group')
      .map((panel) => panel.querySelector('summary')?.textContent)
    expect(titles).toEqual(['Sessions', 'Role', 'Password', 'Delete account'])
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
    expect(screen.getByText(/You can't delete your own account from here/)).toBeInTheDocument()
  })

  it("explains the blocks instead of hiding the panels on the owner's page", async () => {
    renderPage(adminUser({ id: 'owner-1', displayName: 'The Owner', role: 'owner' }))

    await screen.findByRole('heading', { name: 'The Owner' })

    // Both panels stay put, each swapping its control for the reason it
    // can't be used.
    const titles = screen
      .getAllByRole('group')
      .map((panel) => panel.querySelector('summary')?.textContent)
    expect(titles).toEqual(['Sessions', 'Role', 'Password', 'Delete account'])

    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "The owner's role can only be changed by the owner themselves, from their Account page.",
      ),
    ).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
    expect(screen.getByText(/The owner's account can't be deleted/)).toBeInTheDocument()
  })

  it('sends a password reset and shows confirmation', async () => {
    renderPage(adminUser())
    vi.mocked(api.admin.sendPasswordReset).mockResolvedValue(undefined)

    await userEvent.click(await screen.findByRole('button', { name: 'Send password reset' }))

    expect(api.admin.sendPasswordReset).toHaveBeenCalledWith('user-1')
    await screen.findByText('Reset email sent.')
  })
})
