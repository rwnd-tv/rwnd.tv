import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings, ListInvitesResponse } from '@rwnd/shared'
import { InvitesPanel } from './InvitesPanel.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      invites: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
    },
  }
})

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'invite',
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

const emptyInvites: ListInvitesResponse = { invites: [] }

function renderPanel(settingsOverrides: Partial<InstanceSettings> = {}) {
  vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, ...settingsOverrides })
  vi.mocked(api.invites.list).mockResolvedValue(emptyInvites)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <InvitesPanel />
    </QueryClientProvider>,
  )
}

describe('InvitesPanel', () => {
  beforeEach(() => {
    vi.mocked(api.invites.create).mockReset()
  })

  it('renders nothing when registration is not invite-only', async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, registrationMode: 'open' })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <InvitesPanel />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(api.settings.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('creates an invite with no email field when SMTP is not configured', async () => {
    renderPanel({ emailConfigured: false })
    vi.mocked(api.invites.create).mockResolvedValue({
      id: 'invite-1',
      code: 'the-plaintext-code',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      emailSent: false,
    })

    expect(screen.queryByPlaceholderText('Email (optional)')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Create invite' }))

    expect(api.invites.create).toHaveBeenCalledWith({})
    await screen.findByText('the-plaintext-code')
  })

  it('sends the typed email along and shows it was emailed', async () => {
    renderPanel({ emailConfigured: true })
    vi.mocked(api.invites.create).mockResolvedValue({
      id: 'invite-2',
      code: 'another-code',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      emailSent: true,
    })

    const emailField = await screen.findByPlaceholderText('Email (optional)')
    await userEvent.type(emailField, 'invitee@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))

    expect(api.invites.create).toHaveBeenCalledWith({ email: 'invitee@example.com' })
    await screen.findByText('another-code')
    await screen.findByText('Also emailed to invitee@example.com')
  })
})
