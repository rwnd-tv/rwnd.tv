import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InstanceSettings } from '@rwnd/shared'
import { InstanceSettingsPanel } from './InstanceSettingsPanel.js'
import { api, ApiError } from '../../lib/api-client.js'

// Characterisation test, written BEFORE the form-state consolidation
// refactor (docs/TODO.md's M5 maintainability pass) — every assertion
// here locks in today's real behavior, including the render-phase
// re-seed's warm-cache correctness (the doc comment at the top of
// InstanceSettingsPanel.tsx explains why it starts at `undefined`) and
// the two independent mutations (Save vs. immediate-apply reorder).
// Deliberately not touched by the refactor's own commit — a reviewer
// seeing this file absent from that diff is the strongest evidence the
// refactor preserved behavior.

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn(), update: vi.fn() },
    },
  }
})

// Non-default values for every field the panel edits — a stuck-at-default
// bug (the exact class of bug the warm-cache doc comment describes) can
// never accidentally pass against this fixture.
const SETTINGS: InstanceSettings = {
  instanceName: 'My rwnd.tv',
  registrationMode: 'invite',
  defaultLocale: 'en-GB',
  metadataProviderPriority: ['tvdb', 'tmdb'],
  availableMetadataProviders: ['tvdb', 'tmdb'],
  environmentLabel: null,
  traktConfigured: false,
  backupsConfigured: false,
  emailConfigured: true,
  mfaAvailable: false,
  calendarFeedsAvailable: false,
  webhookTokensRecoverable: false,
  appVersion: '1.1.0',
  adminEmail: 'admin@example.com',
}

function renderPanel(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <InstanceSettingsPanel />
    </QueryClientProvider>,
  )
}

describe('InstanceSettingsPanel', () => {
  it('seeds every field from a warm (pre-populated) query cache, not just the hardcoded defaults', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['settings', 'public'], SETTINGS)
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)

    renderPanel(queryClient)

    expect(await screen.findByDisplayValue('My rwnd.tv')).toBeInTheDocument()
    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Invite only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Closed — admin creates accounts' })).not.toBeChecked()
  })

  it('seeds every field from a cold query (no warm cache) once it resolves', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    renderPanel()

    expect(await screen.findByDisplayValue('My rwnd.tv')).toBeInTheDocument()
    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Invite only' })).toBeChecked()
  })

  it('saves exactly instanceName/registrationMode/adminEmail, never metadataProviderPriority or other fields', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    vi.mocked(api.settings.update).mockResolvedValue(SETTINGS)
    renderPanel()

    const nameInput = await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Renamed instance')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith({
        instanceName: 'Renamed instance',
        registrationMode: 'invite',
        adminEmail: 'admin@example.com',
      }),
    )
  })

  it('reorders a metadata provider immediately, independent of Save, ending up with the SERVER response, not the optimistic swap', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    // SETTINGS starts ['tvdb', 'tmdb']; clicking "Move TMDB up" optimistically
    // swaps to ['tmdb', 'tvdb'] client-side. The mocked server response
    // deliberately returns the ORIGINAL order instead, so the only way the
    // final render can show ['tvdb', 'tmdb'] is if updatePriority's onSuccess
    // really does overwrite local state from the server response.
    vi.mocked(api.settings.update).mockResolvedValue({
      ...SETTINGS,
      metadataProviderPriority: ['tvdb', 'tmdb'],
    })
    renderPanel()

    await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.click(screen.getByRole('button', { name: 'Move TMDB up' }))

    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith({
        metadataProviderPriority: ['tmdb', 'tvdb'],
      }),
    )
    await waitFor(() => {
      const items = screen.getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('TVDB')
      expect(items[1]).toHaveTextContent('TMDB')
    })
  })

  it('normalizes adminEmail at both edges: empty string saves as null, whitespace is trimmed', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    vi.mocked(api.settings.update).mockResolvedValue(SETTINGS)
    renderPanel()

    const emailInput = await screen.findByDisplayValue('admin@example.com')
    await userEvent.clear(emailInput)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({ adminEmail: null }),
      ),
    )

    vi.mocked(api.settings.update).mockClear()
    await userEvent.type(emailInput, '  a@b.com  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({ adminEmail: 'a@b.com' }),
      ),
    )
  })

  it('shows a Save error on the adminEmail field, and a reorder error as its own generic message', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    vi.mocked(api.settings.update).mockRejectedValueOnce(new ApiError(400, 'Email already taken'))
    renderPanel()

    await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email already taken')
    const emailInput = screen.getByDisplayValue('admin@example.com')
    expect(emailInput).toHaveAttribute('aria-describedby', alert.id)

    vi.mocked(api.settings.update).mockRejectedValueOnce(new Error('network down'))
    await userEvent.click(screen.getByRole('button', { name: 'Move TVDB down' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('hides the metadata-providers section until the query resolves and seeds it', async () => {
    vi.mocked(api.settings.get).mockImplementation(() => new Promise(() => {}))
    renderPanel()

    expect(screen.queryByText('Metadata providers')).not.toBeInTheDocument()
  })

  it('a refetch that brings back the SAME field value leaves an unsaved edit to that field alone (fixed 2026-09-16, see docs/TODO.md)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(api.settings.get).mockResolvedValueOnce(SETTINGS)
    // React Query's structural sharing collapses a merely spread-copied
    // object back to the SAME reference as before (deep-equal data keeps
    // the old identity to avoid pointless re-renders) — a plain `{...SETTINGS}`
    // on the refetch would NOT trigger the render-phase re-seed check at
    // all. A genuinely different field (environmentLabel) is needed to
    // force a new identity through structural sharing, while instanceName
    // stays "My rwnd.tv" — unchanged from what this field was already
    // seeded with — so the assertion below can tell whether the re-seed
    // wrongly overwrote the in-progress edit anyway.
    vi.mocked(api.settings.get).mockResolvedValueOnce({
      ...SETTINGS,
      environmentLabel: 'refetched',
    })
    renderPanel(queryClient)

    const nameInput = await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Unsaved edit')
    expect(screen.getByDisplayValue('Unsaved edit')).toBeInTheDocument()

    await queryClient.invalidateQueries({ queryKey: ['settings', 'public'] })
    await waitFor(() => expect(api.settings.get).toHaveBeenCalledTimes(2))

    // The old bug: this used to re-seed to "My rwnd.tv", discarding the
    // edit, even though instanceName itself never actually changed.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByDisplayValue('Unsaved edit')).toBeInTheDocument()
  })

  it('a metadata-provider reorder does not discard an unsaved edit to another field', async () => {
    vi.mocked(api.settings.get).mockResolvedValue(SETTINGS)
    // The reorder's own server response differs from SETTINGS' original
    // order, which is exactly what used to trigger the render-phase
    // re-seed via the reorder's own `invalidateQueries` refetch.
    vi.mocked(api.settings.update).mockResolvedValue({
      ...SETTINGS,
      metadataProviderPriority: ['tvdb', 'tmdb'],
    })
    renderPanel()

    const nameInput = await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Unsaved edit')

    await userEvent.click(screen.getByRole('button', { name: 'Move TMDB up' }))
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith({
        metadataProviderPriority: ['tmdb', 'tvdb'],
      }),
    )

    expect(screen.getByDisplayValue('Unsaved edit')).toBeInTheDocument()
  })

  it('a refetch that brings back a GENUINELY DIFFERENT field value overwrites an unsaved edit to that field', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(api.settings.get).mockResolvedValueOnce(SETTINGS)
    // Unlike the previous test, instanceName itself is different this
    // time — a real change made elsewhere (another admin, another tab).
    // That has to win over local, unsaved typing: an edit sitting on top
    // of a now-outdated value isn't a well-formed edit to keep.
    vi.mocked(api.settings.get).mockResolvedValueOnce({
      ...SETTINGS,
      instanceName: 'Renamed from elsewhere',
    })
    renderPanel(queryClient)

    const nameInput = await screen.findByDisplayValue('My rwnd.tv')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Unsaved edit')
    expect(screen.getByDisplayValue('Unsaved edit')).toBeInTheDocument()

    await queryClient.invalidateQueries({ queryKey: ['settings', 'public'] })

    await waitFor(() =>
      expect(screen.getByDisplayValue('Renamed from elsewhere')).toBeInTheDocument(),
    )
  })
})
