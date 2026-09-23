import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiToken, InstanceSettings } from '@rwnd/shared'
import { WebhookCard } from './WebhookCard.js'
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
        update: vi.fn(),
        webhookLinks: vi.fn(),
      },
    },
  }
})

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed',
  landingMode: 'marketing',
  defaultLocale: 'en-GB',
  metadataProviderPriority: ['tmdb'],
  availableMetadataProviders: ['tmdb'],
  environmentLabel: null,
  traktConfigured: false,
  backupsConfigured: false,
  emailConfigured: false,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
  webhookTokensRecoverable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

function sourcelessToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'token-1',
    name: 'My token',
    source: null,
    token: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderCard(token: ApiToken = sourcelessToken()) {
  vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
  vi.mocked(api.tokens.webhookLinks).mockResolvedValue({ links: [] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <WebhookCard token={token} defaultOpen={true} />
    </QueryClientProvider>,
  )
}

describe('WebhookCard', () => {
  beforeEach(() => {
    vi.mocked(api.tokens.update).mockReset()
    vi.mocked(api.tokens.webhookLinks).mockReset()
  })

  it('shows the server error when picking a source fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.tokens.update).mockRejectedValue(new ApiError(409, 'Source already set'))
    renderCard()

    await user.click(await screen.findByRole('button', { name: 'Plex' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Source already set')
  })

  it('disables every other source button while one is pending, so a second click cannot race the first', async () => {
    const user = userEvent.setup()
    let resolveUpdate!: (value: ApiToken) => void
    vi.mocked(api.tokens.update).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    )
    renderCard()

    const plexButton = await screen.findByRole('button', { name: 'Plex' })
    const jellyfinButton = screen.getByRole('button', { name: 'Jellyfin' })
    await user.click(plexButton)

    expect(plexButton).toBeDisabled()
    expect(jellyfinButton).toBeDisabled()

    // The prop-driven `token` here never actually changes (this test
    // renders WebhookCard in isolation, without the WebhooksPanel.tsx
    // parent that re-derives it from the ['tokens'] cache setSource writes
    // to) — so this only checks the pending state clears, not the resulting
    // source-picked UI.
    resolveUpdate(sourcelessToken({ source: 'plex' }))
    await waitFor(() => expect(plexButton).not.toBeDisabled())
    expect(jellyfinButton).not.toBeDisabled()
  })
})
