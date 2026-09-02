import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings } from '@rwnd/shared'
import { RegisterPage } from './RegisterPage.js'
import { AuthContext } from '../lib/use-auth.js'
import { ApiError, api } from '../lib/api-client.js'

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      auth: { ...actual.api.auth, register: vi.fn() },
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
  emailConfigured: true,
  mfaAvailable: false,
  appVersion: '0.1.0',
  adminEmail: null,
}

function renderRegisterPage(settingsOverrides: Partial<InstanceSettings> = {}) {
  vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, ...settingsOverrides })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ user: null, isLoading: false, refetch: () => Promise.resolve() }}
      >
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<div>Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.mocked(api.auth.register).mockReset()
  })

  it('shows a standalone alert (not attached to any field) when registration is open and submit fails', async () => {
    renderRegisterPage({ registrationMode: 'open' })
    await screen.findByLabelText('Display name')
    vi.mocked(api.auth.register).mockRejectedValue(new ApiError(409, 'Email already in use'))

    await userEvent.type(screen.getByLabelText('Display name'), 'Jamie')
    await userEvent.type(screen.getByLabelText('Email'), 'jamie@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email already in use')
    // Not attached to any input — no field's aria-describedby points at it.
    expect(screen.queryByLabelText('Email')).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByLabelText('Password')).not.toHaveAttribute('aria-describedby')
  })

  it('attaches the same error to the invite-code field instead, when registration is invite-only', async () => {
    renderRegisterPage({ registrationMode: 'invite' })
    await screen.findByLabelText('Invite code')
    vi.mocked(api.auth.register).mockRejectedValue(new ApiError(403, 'Invalid invite code'))

    await userEvent.type(screen.getByLabelText('Display name'), 'Jamie')
    await userEvent.type(screen.getByLabelText('Email'), 'jamie@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple')
    await userEvent.type(screen.getByLabelText('Invite code'), 'wrong-code')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid invite code')
    expect(screen.getByLabelText('Invite code')).toHaveAttribute('aria-describedby', alert.id)

    // Exactly one alert — the invite field's, not a second freestanding one.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('renders only the closed-registration notice, with no form, when registration is closed', async () => {
    renderRegisterPage({ registrationMode: 'closed' })
    await screen.findByText('Registration is not currently open on this instance.')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('renders only the email-not-configured notice when SMTP is not set up', async () => {
    renderRegisterPage({ emailConfigured: false })
    await screen.findByText('Registration requires email to be configured on this instance.')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('navigates to /dashboard after a successful registration', async () => {
    renderRegisterPage({ registrationMode: 'open' })
    await screen.findByLabelText('Display name')
    vi.mocked(api.auth.register).mockResolvedValue({
      id: 'user-1',
      email: 'jamie@example.com',
      displayName: 'Jamie',
      locale: 'en-GB',
      timezone: 'Europe/London',
      theme: 'system',
      spoilerProtectionEnabled: true,
      onDeckFillGaps: true,
      role: 'user',
      avatarUpdatedAt: null,
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
    })

    await userEvent.type(screen.getByLabelText('Display name'), 'Jamie')
    await userEvent.type(screen.getByLabelText('Email'), 'jamie@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple')
    await userEvent.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    expect(api.auth.register).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Jamie', email: 'jamie@example.com' }),
    )
  })
})
