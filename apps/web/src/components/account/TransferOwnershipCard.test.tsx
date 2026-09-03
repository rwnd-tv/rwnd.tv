import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, ListAdminUsersResponse } from '@rwnd/shared'
import { TransferOwnershipCard } from './TransferOwnershipCard.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: { listUsers: vi.fn() },
      auth: { ...actual.api.auth, transferOwnership: vi.fn() },
    },
  }
})

function adminUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    displayName: 'User One',
    role: 'admin',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    emailVerifiedAt: new Date().toISOString(),
    avatarUpdatedAt: null,
    mfaEnabled: false,
    sessionCount: 0,
    ...overrides,
  }
}

function renderCard(users: AdminUserSummary[]) {
  vi.mocked(api.admin.listUsers).mockResolvedValue({ users } satisfies ListAdminUsersResponse)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TransferOwnershipCard />
    </QueryClientProvider>,
  )
}

describe('TransferOwnershipCard', () => {
  beforeEach(() => {
    vi.mocked(api.auth.transferOwnership).mockReset()
  })

  it('lists only existing admins as transfer targets, not plain users or the owner', async () => {
    renderCard([
      adminUser({ id: 'owner-1', email: 'owner@example.com', displayName: 'Owner', role: 'owner' }),
      adminUser({ id: 'admin-1', email: 'admin@example.com', displayName: 'An Admin' }),
      adminUser({ id: 'user-1', email: 'plain@example.com', displayName: 'A User', role: 'user' }),
    ])

    await screen.findByText('An Admin (admin@example.com)')
    expect(screen.queryByText(/Owner \(owner@example\.com\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/A User \(plain@example\.com\)/)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no other admins to transfer to', async () => {
    renderCard([
      adminUser({ id: 'owner-1', email: 'owner@example.com', displayName: 'Owner', role: 'owner' }),
    ])
    await screen.findByText(
      'No other admins to transfer ownership to yet. Promote a user to admin first.',
    )
  })

  it('confirms with a password and calls the API with the chosen target', async () => {
    renderCard([adminUser({ id: 'admin-1', email: 'admin@example.com', displayName: 'An Admin' })])
    vi.mocked(api.auth.transferOwnership).mockResolvedValue(undefined)

    const select = await screen.findByLabelText('New owner')
    await userEvent.selectOptions(select, 'admin-1')
    // The row's own trigger button and the dialog's confirm button share
    // the same label once the dialog is open — the confirm button is the
    // one that shows up last in document order, same disambiguation as
    // DeleteUserDialog's own test.
    await userEvent.click(screen.getAllByRole('button', { name: 'Transfer ownership' }).at(-1)!)

    await userEvent.type(await screen.findByLabelText('Current password'), 'correct-horse-battery')
    await userEvent.click(screen.getAllByRole('button', { name: 'Transfer ownership' }).at(-1)!)

    expect(api.auth.transferOwnership).toHaveBeenCalledWith({
      targetUserId: 'admin-1',
      currentPassword: 'correct-horse-battery',
    })
  })
})
