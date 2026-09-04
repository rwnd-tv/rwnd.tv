import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, InstanceSettings, ListAdminUsersResponse, User } from '@rwnd/shared'
import { UsersPanel } from './UsersPanel.js'
import { api } from '../../lib/api-client.js'
import { AuthContext } from '../../lib/use-auth.js'

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

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      admin: {
        listUsers: vi.fn(),
        deleteUser: vi.fn(),
        updateUserRole: vi.fn(),
        revokeAllUserSessions: vi.fn(),
        sendPasswordReset: vi.fn(),
        avatarUrl: actual.api.admin.avatarUrl,
      },
    },
  }
})

function adminUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    emailVerifiedAt: new Date().toISOString(),
    avatarUpdatedAt: null,
    mfaEnabled: false,
    sessionCount: 1,
    ...overrides,
  }
}

function renderPanel(users: AdminUserSummary[], settings: InstanceSettings = baseSettings) {
  vi.mocked(api.admin.listUsers).mockResolvedValue({ users } satisfies ListAdminUsersResponse)
  vi.mocked(api.settings.get).mockResolvedValue(settings)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: currentAdmin, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter>
          <UsersPanel />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

// useSortCookie (lib/use-sort-cookie.ts) reads/writes real document.cookie
// session cookies — jsdom doesn't reset those between tests in the same
// file the way it resets the DOM, so a filter/sort chosen in one test would
// otherwise leak into the next one's initial render.
const ADMIN_USERS_COOKIES = [
  'rwnd_admin_users_sort',
  'rwnd_admin_users_role_filters',
  'rwnd_admin_users_mfa_mode',
  'rwnd_admin_users_verified_mode',
]

describe('UsersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const name of ADMIN_USERS_COOKIES) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  })

  it('shows an empty state with no users', async () => {
    renderPanel([])
    await screen.findByText('No users yet.')
  })

  it('renders a row per user, each linking to its detail page, with a role badge and last-login text', async () => {
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

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    const watcherLink = links.find((link) => link.textContent?.includes('Watcher'))!
    expect(watcherLink).toHaveAttribute('href', '/admin/users/user-1/watcher')
    const adminLink = links.find((link) => link.textContent?.includes('Admin'))!
    expect(adminLink).toHaveAttribute('href', '/admin/users/admin-1/admin')
  })

  it('narrows the list to matching name or email as you type', async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser({ id: 'root-1', displayName: 'Root', email: 'root@example.com' }),
      adminUser({ id: 'user-1', displayName: 'Watcher', email: 'watcher@example.com' }),
    ])
    await screen.findByText('Watcher')

    await user.type(screen.getByLabelText('Filter users'), 'watcher')

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]!.textContent).toContain('Watcher')
  })

  it('narrows the list by the role filter', async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser({ id: 'root-1', displayName: 'Root', role: 'admin' }),
      adminUser({ id: 'user-1', displayName: 'Watcher', role: 'user' }),
    ])
    await screen.findByText('Watcher')

    await user.click(screen.getByRole('button', { name: 'Filters…' }))
    await user.click(screen.getByRole('button', { name: 'Exclude Admin' }))

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]!.textContent).toContain('Watcher')
  })

  it('reorders the list when the sort option changes', async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser({ id: 'a', displayName: 'Zed' }),
      adminUser({ id: 'b', displayName: 'Amy' }),
    ])
    await screen.findByText('Zed')

    // Default sort is name ascending, so Amy already comes first — switch
    // to descending and confirm the row order actually flips.
    await user.selectOptions(screen.getByLabelText('Sort by'), 'nameDesc')

    const names = screen.getAllByRole('link').map((link) => link.textContent)
    expect(names[0]).toContain('Zed')
    expect(names[1]).toContain('Amy')
  })

  it('shows a filter-specific empty state when a facet filter excludes everyone', async () => {
    renderPanel([adminUser({ id: 'root-1', displayName: 'Root', role: 'admin' })])
    await screen.findByText('Root')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Filters…' }))
    await user.click(screen.getByRole('button', { name: 'Exclude Admin' }))

    await screen.findByText('No users match the selected filters.')
  })

  it("disables the acting admin's own checkbox but not another user's", async () => {
    // adminUser()'s default id ('admin-1') matches currentAdmin.id, so this
    // fixture already includes the acting admin's own row.
    renderPanel([adminUser(), adminUser({ id: 'user-1', displayName: 'Watcher' })])
    await screen.findByText('Watcher')

    expect(
      screen.getByRole('checkbox', { name: "Your own account can't be selected" }),
    ).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select Watcher' })).toBeEnabled()
  })

  it("select-all ticks every row except the acting admin's own", async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser(),
      adminUser({ id: 'user-1', displayName: 'Watcher' }),
      adminUser({ id: 'root-1', displayName: 'Root' }),
    ])
    await screen.findByText('Watcher')

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))

    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: "Your own account can't be selected" }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Watcher' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Root' })).toBeChecked()
  })

  it('keeps a selection when the row it applies to is filtered out of view, and reports it as hidden', async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser(),
      adminUser({ id: 'user-1', displayName: 'Watcher' }),
      adminUser({ id: 'root-1', displayName: 'Root' }),
    ])
    await screen.findByText('Watcher')

    await user.click(screen.getByRole('checkbox', { name: 'Select Watcher' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    // Narrow the filter to Root — Watcher (still selected) drops out of view.
    await user.type(screen.getByLabelText('Filter users'), 'root')
    await screen.findByText('Root')

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByText('1 hidden by the current filter')).toBeInTheDocument()
  })

  it('shows an indeterminate select-all state with a partial selection', async () => {
    const user = userEvent.setup()
    renderPanel([
      adminUser(),
      adminUser({ id: 'user-1', displayName: 'Watcher' }),
      adminUser({ id: 'root-1', displayName: 'Root' }),
    ])
    await screen.findByText('Watcher')

    const selectAll = screen.getByRole('checkbox', {
      name: 'Select all',
    }) as unknown as HTMLInputElement
    await user.click(screen.getByRole('checkbox', { name: 'Select Watcher' }))
    expect(selectAll.indeterminate).toBe(true)
    expect(selectAll.checked).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: 'Select Root' }))
    expect(selectAll.indeterminate).toBe(false)
    expect(selectAll.checked).toBe(true)
  })

  it('shows the bulk action bar only once something is selected, and Clear empties it', async () => {
    const user = userEvent.setup()
    renderPanel([adminUser(), adminUser({ id: 'user-1', displayName: 'Watcher' })])
    await screen.findByText('Watcher')

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Watcher' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Watcher' })).not.toBeChecked()
  })

  it('freezes every row checkbox and select-all while a bulk action is in flight', async () => {
    const user = userEvent.setup()
    let resolveRevoke!: () => void
    vi.mocked(api.admin.revokeAllUserSessions).mockReturnValue(
      new Promise((resolve) => {
        resolveRevoke = () => resolve(undefined)
      }),
    )
    renderPanel([adminUser(), adminUser({ id: 'user-1', displayName: 'Watcher' })])
    await screen.findByText('Watcher')

    await user.click(screen.getByRole('checkbox', { name: 'Select Watcher' }))
    await user.click(screen.getByRole('button', { name: 'Revoke sessions' }))

    expect(screen.getByRole('checkbox', { name: 'Select Watcher' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeDisabled()

    resolveRevoke()
    await screen.findByText('1 of 1 account signed out everywhere.')
    expect(screen.getByRole('checkbox', { name: 'Select Watcher' })).toBeEnabled()
  })
})
