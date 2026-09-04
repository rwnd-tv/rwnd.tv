import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarFeed, InstanceSettings, ListCalendarFeedsResponse } from '@rwnd/shared'
import { CalendarFeedsPanel } from './CalendarFeedsPanel.js'
import { api } from '../../lib/api-client.js'

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api-client.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: { get: vi.fn() },
      calendarFeeds: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        regenerate: vi.fn(),
        delete: vi.fn(),
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
  calendarFeedsAvailable: true,
  appVersion: '0.1.0',
  adminEmail: null,
}

const historyFeed: CalendarFeed = {
  feedType: 'history',
  token: 'rwndcal_abc123',
  settings: { includeMovies: true, includeShows: true },
  lastAccessedAt: null,
  createdAt: new Date().toISOString(),
}

const showsFeed: CalendarFeed = {
  feedType: 'shows',
  token: 'rwndcal_def456',
  settings: { includeDropped: false, futureOnly: true, includeAllWatched: false },
  lastAccessedAt: null,
  createdAt: new Date().toISOString(),
}

function renderPanel(feeds: CalendarFeed[], settingsOverrides: Partial<InstanceSettings> = {}) {
  vi.mocked(api.settings.get).mockResolvedValue({ ...baseSettings, ...settingsOverrides })
  const response: ListCalendarFeedsResponse = { feeds }
  vi.mocked(api.calendarFeeds.list).mockResolvedValue(response)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CalendarFeedsPanel />
    </QueryClientProvider>,
  )
}

describe('CalendarFeedsPanel', () => {
  beforeEach(() => {
    vi.mocked(api.calendarFeeds.create).mockReset()
    vi.mocked(api.calendarFeeds.update).mockReset()
    vi.mocked(api.calendarFeeds.regenerate).mockReset()
    vi.mocked(api.calendarFeeds.delete).mockReset()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('renders nothing when the instance has no ENCRYPTION_KEY configured', async () => {
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CalendarFeedsPanel />
      </QueryClientProvider>,
    )
    vi.mocked(api.settings.get).mockResolvedValue({
      ...baseSettings,
      calendarFeedsAvailable: false,
    })
    await vi.waitFor(() => expect(api.settings.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  // The deliberate divergence from TokensPanel.tsx's one-time API token
  // reveal (see CalendarFeedsPanel.tsx's FeedRow doc comment): a
  // subscription URL must be re-copyable indefinitely, so it's shown on
  // first render with zero interaction, not behind a `justCreated` gate.
  it('shows an existing feed’s subscription URL immediately, with no interaction', async () => {
    renderPanel([historyFeed])

    await screen.findByText(`http://localhost:3000/api/v1/calendar/${historyFeed.token}/feed.ics`)
  })

  it('copies the http(s):// URL, not webcal:, when Copy is clicked', async () => {
    renderPanel([historyFeed])

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/calendar/${historyFeed.token}/feed.ics`,
    )
  })

  it("the Subscribe link's href uses the webcal: scheme", async () => {
    renderPanel([historyFeed])

    const link = await screen.findByRole('link', { name: 'Subscribe' })
    expect(link).toHaveAttribute(
      'href',
      `webcal://localhost:3000/api/v1/calendar/${historyFeed.token}/feed.ics`,
    )
  })

  it('disables Save until a checkbox actually changes, then saves both settings in one request', async () => {
    renderPanel([historyFeed])
    vi.mocked(api.calendarFeeds.update).mockResolvedValue({
      ...historyFeed,
      settings: { includeMovies: false, includeShows: true },
    })

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Include movies' }))
    expect(api.calendarFeeds.update).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.calendarFeeds.update).toHaveBeenCalledTimes(1)
    expect(api.calendarFeeds.update).toHaveBeenCalledWith('history', {
      includeMovies: false,
      includeShows: true,
    })
  })

  it('saves the "include every show I\'ve ever watched" toggle for the TV Shows feed', async () => {
    renderPanel([showsFeed])
    vi.mocked(api.calendarFeeds.update).mockResolvedValue({
      ...showsFeed,
      settings: { ...showsFeed.settings, includeAllWatched: true },
    })

    await userEvent.click(
      await screen.findByRole('checkbox', { name: "Include every show I've ever watched" }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.calendarFeeds.update).toHaveBeenCalledWith('shows', {
      includeDropped: false,
      futureOnly: true,
      includeAllWatched: true,
    })
  })

  it('only regenerates the feed after confirming in the dialog', async () => {
    renderPanel([historyFeed])
    vi.mocked(api.calendarFeeds.regenerate).mockResolvedValue({
      ...historyFeed,
      token: 'rwndcal_new',
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(api.calendarFeeds.regenerate).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Regenerate' }).find((b) => dialog.contains(b))!,
    )

    expect(api.calendarFeeds.regenerate).toHaveBeenCalledWith('history')
  })

  it('only deletes the feed after confirming in the dialog', async () => {
    renderPanel([historyFeed])
    vi.mocked(api.calendarFeeds.delete).mockResolvedValue(undefined)

    await userEvent.click(await screen.findByRole('button', { name: 'Delete feed' }))
    expect(api.calendarFeeds.delete).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Delete feed' }).find((b) => dialog.contains(b))!,
    )

    expect(api.calendarFeeds.delete).toHaveBeenCalledWith('history')
  })

  it('creates a feed with server defaults via its own Create feed button', async () => {
    renderPanel([])
    vi.mocked(api.calendarFeeds.create).mockResolvedValue(historyFeed)

    const createButtons = await screen.findAllByRole('button', { name: 'Create feed' })
    expect(createButtons).toHaveLength(2)
    await userEvent.click(createButtons[0]!)

    expect(api.calendarFeeds.create).toHaveBeenCalledWith({ feedType: 'history' })
  })
})
