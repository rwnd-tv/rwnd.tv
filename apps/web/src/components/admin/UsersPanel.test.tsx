import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, ListAdminUsersResponse } from '@rwnd/shared'
import { UsersPanel } from './UsersPanel.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: { ...actual.api, admin: { listUsers: vi.fn() } },
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
    mfaEnabled: false,
    sessionCount: 1,
    ...overrides,
  }
}

function renderPanel(users: AdminUserSummary[]) {
  vi.mocked(api.admin.listUsers).mockResolvedValue({ users } satisfies ListAdminUsersResponse)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UsersPanel', () => {
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
})
