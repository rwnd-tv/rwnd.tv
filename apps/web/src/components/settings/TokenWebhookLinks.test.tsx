import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings, ListWebhookLinksResponse } from '@rwnd/shared'
import { TokenWebhookLinks } from './TokenWebhookLinks.js'
import { ApiError, api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      tokens: {
        ...actual.api.tokens,
        webhookLinks: vi.fn(),
        linkWebhookLink: vi.fn(),
        unlinkWebhookLink: vi.fn(),
        createWebhookLinkCode: vi.fn(),
        deleteWebhookLink: vi.fn(),
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
  emailConfigured: false,
  mfaAvailable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

const unlinkedLink: ListWebhookLinksResponse['links'][number] = {
  id: 'link-1',
  source: 'plex',
  externalAccountId: '2',
  externalAccountName: 'kid-profile',
  userId: null,
  userDisplayName: null,
  callerCanLinkAsSelf: true,
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
}

const linkedLink: ListWebhookLinksResponse['links'][number] = {
  ...unlinkedLink,
  id: 'link-2',
  userId: 'user-1',
  userDisplayName: 'Me',
  callerCanLinkAsSelf: false,
}

function renderLinks(settingsOverrides: Partial<InstanceSettings> = {}) {
  vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, ...settingsOverrides })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TokenWebhookLinks tokenId="token-1" />
    </QueryClientProvider>,
  )
}

describe('TokenWebhookLinks', () => {
  beforeEach(() => {
    vi.mocked(api.tokens.webhookLinks).mockReset()
    vi.mocked(api.tokens.linkWebhookLink).mockReset()
    vi.mocked(api.tokens.unlinkWebhookLink).mockReset()
    vi.mocked(api.tokens.createWebhookLinkCode).mockReset()
    vi.mocked(api.tokens.deleteWebhookLink).mockReset()
  })

  it('renders nothing while there are no links', async () => {
    vi.mocked(api.tokens.webhookLinks).mockResolvedValue({ links: [] })
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TokenWebhookLinks tokenId="token-1" />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides "This is me" when the caller already has a different Plex account linked', async () => {
    vi.mocked(api.tokens.webhookLinks).mockResolvedValue({
      links: [{ ...unlinkedLink, callerCanLinkAsSelf: false }],
    })
    renderLinks()

    await screen.findByText('kid-profile')
    expect(screen.queryByRole('button', { name: 'This is me' })).not.toBeInTheDocument()
    // The other either-or option stays available regardless.
    expect(screen.getByRole('button', { name: 'Show link code' })).toBeInTheDocument()
  })

  it('links an unlinked account as the caller, then shows the linked name', async () => {
    vi.mocked(api.tokens.webhookLinks)
      .mockResolvedValueOnce({ links: [unlinkedLink] })
      .mockResolvedValueOnce({ links: [linkedLink] })
    vi.mocked(api.tokens.linkWebhookLink).mockResolvedValue(linkedLink)
    renderLinks()

    await userEvent.click(await screen.findByRole('button', { name: 'This is me' }))

    expect(api.tokens.linkWebhookLink).toHaveBeenCalledWith('token-1', 'link-1')
    await screen.findByText('Me')
  })

  it('unlinks a linked account back to unlinked', async () => {
    vi.mocked(api.tokens.webhookLinks)
      .mockResolvedValueOnce({ links: [linkedLink] })
      .mockResolvedValueOnce({ links: [unlinkedLink] })
    vi.mocked(api.tokens.unlinkWebhookLink).mockResolvedValue(unlinkedLink)
    renderLinks()

    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))

    expect(api.tokens.unlinkWebhookLink).toHaveBeenCalledWith('token-1', 'link-2')
    await screen.findByText('Unlinked')
  })

  it('generates a link code via "Show link code", with no email field when SMTP is not configured', async () => {
    vi.mocked(api.tokens.webhookLinks).mockResolvedValue({ links: [unlinkedLink] })
    vi.mocked(api.tokens.createWebhookLinkCode).mockResolvedValue({
      code: 'the-plaintext-code',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      emailSent: false,
    })
    renderLinks({ emailConfigured: false })

    expect(screen.queryByRole('button', { name: 'Send link email' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Show link code' }))

    await screen.findByText('the-plaintext-code')
    expect(api.tokens.createWebhookLinkCode).toHaveBeenCalledWith('token-1', 'link-1', {})
  })

  it('sends a link email via "Send link email" and shows it was emailed', async () => {
    vi.mocked(api.tokens.webhookLinks).mockResolvedValue({ links: [unlinkedLink] })
    vi.mocked(api.tokens.createWebhookLinkCode).mockResolvedValue({
      code: 'the-plaintext-code',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      emailSent: true,
    })
    renderLinks({ emailConfigured: true })

    const emailField = await screen.findByPlaceholderText('Email')
    await userEvent.type(emailField, 'someone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send link email' }))

    await screen.findByText('the-plaintext-code')
    expect(api.tokens.createWebhookLinkCode).toHaveBeenCalledWith('token-1', 'link-1', {
      email: 'someone@example.com',
    })
    await screen.findByText('Also emailed to someone@example.com')
  })

  it('shows the server error when linking fails', async () => {
    vi.mocked(api.tokens.webhookLinks).mockResolvedValue({ links: [unlinkedLink] })
    vi.mocked(api.tokens.linkWebhookLink).mockRejectedValue(new ApiError(409, 'Already linked'))
    renderLinks()

    await userEvent.click(await screen.findByRole('button', { name: 'This is me' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Already linked')
  })

  it('removes a link only after confirming in the dialog', async () => {
    vi.mocked(api.tokens.webhookLinks)
      .mockResolvedValueOnce({ links: [unlinkedLink] })
      .mockResolvedValueOnce({ links: [] })
    vi.mocked(api.tokens.deleteWebhookLink).mockResolvedValue(undefined)
    renderLinks()

    await userEvent.click(await screen.findByRole('button', { name: /^Remove:/ }))
    expect(api.tokens.deleteWebhookLink).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Remove' }).find((b) => dialog.contains(b))!,
    )

    expect(api.tokens.deleteWebhookLink).toHaveBeenCalledWith('token-1', 'link-1')
  })
})
