import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WebhookAccountLink } from '@rwnd/shared'
import { LinkedAccountsPanel } from './LinkedAccountsPanel.js'
import { ApiError, api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      webhookLinks: { redeem: vi.fn(), mine: vi.fn(), unlink: vi.fn() },
    },
  }
})

function link(overrides: Partial<WebhookAccountLink> = {}): WebhookAccountLink {
  return {
    id: 'link-1',
    source: 'plex',
    externalAccountId: '2',
    externalAccountName: 'kid-profile',
    userId: 'user-1',
    userDisplayName: 'Me',
    callerCanLinkAsSelf: false,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LinkedAccountsPanel />
    </QueryClientProvider>,
  )
}

describe('LinkedAccountsPanel', () => {
  beforeEach(() => {
    vi.mocked(api.webhookLinks.mine).mockReset()
    vi.mocked(api.webhookLinks.unlink).mockReset()
    vi.mocked(api.webhookLinks.redeem).mockReset()
  })

  it('shows an empty state when nothing is linked', async () => {
    vi.mocked(api.webhookLinks.mine).mockResolvedValue({ links: [] })
    renderPanel()

    await screen.findByText('No linked accounts yet.')
  })

  it('lists a linked account and unlinks it', async () => {
    vi.mocked(api.webhookLinks.mine).mockResolvedValueOnce({ links: [link()] })
    vi.mocked(api.webhookLinks.unlink).mockResolvedValue(link({ userId: null }))
    renderPanel()

    await screen.findByText('kid-profile')
    expect(screen.getByText('Plex')).toBeInTheDocument()

    vi.mocked(api.webhookLinks.mine).mockResolvedValueOnce({ links: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Unlink: kid-profile' }))

    expect(api.webhookLinks.unlink).toHaveBeenCalledWith('link-1')
    await screen.findByText('No linked accounts yet.')
  })

  it('shows the server error when unlinking fails', async () => {
    vi.mocked(api.webhookLinks.mine).mockResolvedValue({ links: [link()] })
    vi.mocked(api.webhookLinks.unlink).mockRejectedValue(new ApiError(404, 'Link not found'))
    renderPanel()

    await screen.findByText('kid-profile')
    await userEvent.click(screen.getByRole('button', { name: 'Unlink: kid-profile' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Link not found')
  })

  it('redeems a link code and refreshes the list', async () => {
    vi.mocked(api.webhookLinks.mine).mockResolvedValueOnce({ links: [] })
    vi.mocked(api.webhookLinks.redeem).mockResolvedValue(link())
    renderPanel()

    await screen.findByText('No linked accounts yet.')
    vi.mocked(api.webhookLinks.mine).mockResolvedValueOnce({ links: [link()] })

    await userEvent.type(screen.getByPlaceholderText('Link code'), 'a-real-code')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(api.webhookLinks.redeem).toHaveBeenCalledWith({ code: 'a-real-code' })
    await screen.findByText('kid-profile')
    expect(screen.getByPlaceholderText('Link code')).toHaveValue('')
  })

  it('shows the server error when redeeming a link code fails', async () => {
    vi.mocked(api.webhookLinks.mine).mockResolvedValue({ links: [] })
    vi.mocked(api.webhookLinks.redeem).mockRejectedValue(
      new ApiError(400, 'Invalid or expired code'),
    )
    renderPanel()

    await screen.findByText('No linked accounts yet.')
    await userEvent.type(screen.getByPlaceholderText('Link code'), 'bad-code')
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid or expired code')
  })
})
