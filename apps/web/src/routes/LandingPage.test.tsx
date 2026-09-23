import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings, User } from '@rwnd/shared'
import { LandingPage } from './LandingPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { api } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      setup: { status: vi.fn() },
      settings: { get: vi.fn() },
    },
  }
})

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'open',
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

function renderLandingPage({
  user = null,
  authLoading = false,
}: { user?: User | null; authLoading?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user, isLoading: authLoading, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/setup" element={<div>Setup page</div>} />
            <Route path="/login" element={<div>Login page</div>} />
            <Route path="/dashboard" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('LandingPage landingMode', () => {
  it('renders the marketing page when landingMode is marketing', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: false })
    vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
    renderLandingPage()

    await screen.findByText('Track what you watch, on your own server.')
  })

  it('redirects to /login when landingMode is login', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: false })
    vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, landingMode: 'login' })
    renderLandingPage()

    await screen.findByText('Login page')
    expect(screen.queryByText('Track what you watch, on your own server.')).not.toBeInTheDocument()
  })

  it('shows the spinner, not the marketing page, while settings is still loading', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: false })
    vi.mocked(api.settings.get).mockImplementation(() => new Promise(() => {}))
    renderLandingPage()

    expect(screen.queryByText('Track what you watch, on your own server.')).not.toBeInTheDocument()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  })

  it('setup-required wins over landingMode: login', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: true })
    vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, landingMode: 'login' })
    renderLandingPage()

    await screen.findByText('Setup page')
  })

  it('a logged-in user wins over landingMode: login', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: false })
    vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, landingMode: 'login' })
    renderLandingPage({ user: fakeUser })

    await screen.findByText('Dashboard')
  })

  it('falls back to the marketing page when the settings fetch fails', async () => {
    vi.mocked(api.setup.status).mockResolvedValue({ required: false })
    vi.mocked(api.settings.get).mockRejectedValue(new Error('network down'))
    renderLandingPage()

    await screen.findByText('Track what you watch, on your own server.')
  })
})
