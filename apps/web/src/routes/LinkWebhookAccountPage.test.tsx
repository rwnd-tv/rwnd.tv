import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@rwnd/shared'
import { LinkWebhookAccountPage } from './LinkWebhookAccountPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { ApiError, api } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      webhookLinks: { redeem: vi.fn() },
    },
  }
})

const fakeUser: User = {
  id: 'user-1',
  email: 'jamie@example.com',
  displayName: 'Jamie',
  locale: 'en-GB',
  timezone: 'Europe/London',
  theme: 'system',
  spoilerProtectionEnabled: true,
  onDeckFillGaps: false,
  role: 'user',
  avatarUpdatedAt: null,
  emailVerifiedAt: null,
  createdAt: new Date().toISOString(),
}

function renderPage(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: fakeUser, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/link-account" element={<LinkWebhookAccountPage />} />
            <Route path="/settings" element={<div>Settings page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('LinkWebhookAccountPage', () => {
  beforeEach(() => {
    vi.mocked(api.webhookLinks.redeem).mockReset()
  })

  it('shows an invalid-link message when there is no code', () => {
    renderPage('/link-account')
    expect(screen.getByText('This link is invalid or has expired.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link this account' })).not.toBeInTheDocument()
  })

  it('shows who is signed in, confirms, and redeems the code from the URL', async () => {
    renderPage('/link-account?code=the-code')
    vi.mocked(api.webhookLinks.redeem).mockResolvedValue({
      id: 'link-1',
      source: 'plex',
      externalAccountId: '2',
      externalAccountName: 'kid-profile',
      userId: 'user-1',
      userDisplayName: 'Jamie',
      callerCanLinkAsSelf: false,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    })

    expect(screen.getByText(/You're signed in as Jamie/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Link this account' }))

    expect(api.webhookLinks.redeem).toHaveBeenCalledWith({ code: 'the-code' })
    await screen.findByText('This account is now linked to yours.')
    expect(screen.getByRole('link', { name: 'Go to Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('shows the server error when redeeming fails', async () => {
    renderPage('/link-account?code=bad-code')
    vi.mocked(api.webhookLinks.redeem).mockRejectedValue(
      new ApiError(400, 'Invalid or expired code'),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Link this account' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid or expired code')
  })
})
