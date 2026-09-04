import { describe, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings, User } from '@rwnd/shared'
import { LoginPage } from './LoginPage.js'
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
      auth: { ...actual.api.auth, login: vi.fn() },
    },
  }
})

const baseSettings: InstanceSettings = {
  instanceName: 'rwnd.tv',
  registrationMode: 'open',
  defaultLocale: 'en-GB',
  metadataProviderPriority: ['tmdb'],
  availableMetadataProviders: ['tmdb'],
  environmentLabel: null,
  traktConfigured: false,
  backupsConfigured: false,
  emailConfigured: false,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
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

function renderLoginPage(initialPath: string) {
  vi.mocked(api.setup.status).mockResolvedValue({ required: false })
  vi.mocked(api.settings.get).mockResolvedValue(baseSettings)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: null, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<div>Dashboard</div>} />
            <Route path="/link-account" element={<div>Link account page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

async function login() {
  await userEvent.type(await screen.findByLabelText('Email'), 'jamie@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('LoginPage next redirect', () => {
  beforeEach(() => {
    vi.mocked(api.auth.login).mockReset()
  })

  it('goes to /dashboard with no next param', async () => {
    renderLoginPage('/login')
    vi.mocked(api.auth.login).mockResolvedValue(fakeUser)

    await login()

    await screen.findByText('Dashboard')
  })

  it('returns to the requested page when next is a real in-app path', async () => {
    renderLoginPage('/login?next=%2Flink-account%3Fcode%3Dabc')
    vi.mocked(api.auth.login).mockResolvedValue(fakeUser)

    await login()

    await screen.findByText('Link account page')
  })

  it('falls back to /dashboard when next points off-site', async () => {
    renderLoginPage('/login?next=https%3A%2F%2Fevil.example')
    vi.mocked(api.auth.login).mockResolvedValue(fakeUser)

    await login()

    await screen.findByText('Dashboard')
  })

  it('falls back to /dashboard when next is protocol-relative', async () => {
    renderLoginPage('/login?next=%2F%2Fevil.example')
    vi.mocked(api.auth.login).mockResolvedValue(fakeUser)

    await login()

    await screen.findByText('Dashboard')
  })
})
