import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { CalendarMonthGrid } from './CalendarMonthGrid.js'

function episodeEvent(
  uid: string,
  date: string,
  overrides: Partial<Extract<CalendarEvent, { kind: 'episode' }>> = {},
): Extract<CalendarEvent, { kind: 'episode' }> {
  return {
    kind: 'episode' as const,
    uid,
    media: {
      type: 'episode' as const,
      title: 'An Episode',
      showTitle: 'A Show',
      showSlug: 'a-show',
      posterPath: null,
      seasonNumber: 1,
      episodeNumber: 1,
    },
    overview: null,
    watched: false,
    spoilerHidden: false,
    date,
    ...overrides,
  }
}

function releaseEvent(uid: string, date: string): Extract<CalendarEvent, { kind: 'release' }> {
  return {
    kind: 'release' as const,
    uid,
    media: {
      type: 'movie' as const,
      title: 'A Movie',
      movieSlug: 'a-movie',
      posterPath: null,
    },
    overview: null,
    watched: false,
    spoilerHidden: false,
    date,
  }
}

/** Below-`sm` tests exercise the real useMediaQuery hook against a stubbed
 * matchMedia — only CalendarMonthGrid itself ever calls matchMedia in this
 * tree, so one query result applies globally without needing to key off the
 * query string. */
function stubBelowSm() {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function renderGrid(monthAnchor: Date, events: CalendarEvent[] = [], locale = 'en-GB') {
  return render(
    <MemoryRouter>
      <CalendarMonthGrid monthAnchor={monthAnchor} events={events} locale={locale} />
    </MemoryRouter>,
  )
}

describe('CalendarMonthGrid', () => {
  it('renders a fixed 6x7 grid of day cells', () => {
    renderGrid(new Date(2026, 8, 1)) // September 2026
    const cells = screen.getAllByRole('cell')
    expect(cells).toHaveLength(42)
  })

  it("starts the grid on Monday for en-GB (September 2026's 1st is a Tuesday)", () => {
    renderGrid(new Date(2026, 8, 1), [], 'en-GB')
    const cells = screen.getAllByRole('cell')
    // Monday-first: column 0 is Monday 31 Aug, column 1 is the 1st itself.
    expect(cells[0]).toHaveTextContent('31')
    expect(cells[1]).toHaveTextContent('1')
  })

  it('starts the grid on Sunday for en-US (the same September 2026)', () => {
    renderGrid(new Date(2026, 8, 1), [], 'en-US')
    const cells = screen.getAllByRole('cell')
    // Sunday-first: column 0 is Sunday 30 Aug, column 2 is the 1st itself.
    expect(cells[0]).toHaveTextContent('30')
    expect(cells[2]).toHaveTextContent('1')
  })

  it('marks a leading out-of-month day distinctly from an in-month day', () => {
    renderGrid(new Date(2026, 8, 1), [], 'en-GB')
    const cells = screen.getAllByRole('cell')
    // cells[0] is 31 Aug (out of month), cells[1] is 1 Sep (in month).
    expect(cells[0]!.className).toContain('bg-[var(--color-surface)]')
    expect(cells[1]!.className).not.toContain('bg-[var(--color-surface)]')
  })

  it('places an event in the cell matching its date, and omits one outside the visible grid', () => {
    renderGrid(new Date(2026, 8, 1), [
      episodeEvent('episode-in@rwnd.tv', '2026-09-15'),
      episodeEvent('episode-out@rwnd.tv', '2026-12-25'),
    ])
    // The compact cell entry shows "Show · Episode" — there's no poster art
    // at this size to tell episodes apart, unlike the Agenda/selected-day
    // tiles.
    expect(screen.getAllByText('A Show · An Episode')).toHaveLength(1)
  })

  it("substitutes a hidden episode's title with the generic fallback, but still shows the show title", () => {
    renderGrid(new Date(2026, 8, 1), [
      { ...episodeEvent('hidden@rwnd.tv', '2026-09-15'), spoilerHidden: true },
    ])
    expect(screen.getByText('A Show · Episode 1')).toBeInTheDocument()
  })

  it('shows every entry for a day, with no "+N more" control', () => {
    const events = [
      episodeEvent('e1@rwnd.tv', '2026-09-10'),
      episodeEvent('e2@rwnd.tv', '2026-09-10'),
      episodeEvent('e3@rwnd.tv', '2026-09-10'),
      episodeEvent('e4@rwnd.tv', '2026-09-10'),
      episodeEvent('e5@rwnd.tv', '2026-09-10'),
    ]
    renderGrid(new Date(2026, 8, 1), events)
    expect(screen.getAllByText('A Show · An Episode')).toHaveLength(5)
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  describe('below sm', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('still renders 42 cells, with no full event title text in the grid', () => {
      stubBelowSm()
      renderGrid(new Date(2026, 8, 1), [episodeEvent('e1@rwnd.tv', '2026-09-15')])
      expect(screen.getAllByRole('cell')).toHaveLength(42)
      expect(screen.queryByText('A Show · An Episode')).not.toBeInTheDocument()
    })

    it('exposes a button naming the event count on a day with events, and no button on an empty day', () => {
      stubBelowSm()
      renderGrid(new Date(2026, 8, 1), [
        episodeEvent('e1@rwnd.tv', '2026-09-15'),
        episodeEvent('e2@rwnd.tv', '2026-09-15'),
        episodeEvent('e3@rwnd.tv', '2026-09-15'),
      ])
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]).toHaveAccessibleName(/3 events/)
    })

    it('shows one dot per distinct kind present, plus the total once there is more than one event', () => {
      stubBelowSm()
      const { container } = renderGrid(new Date(2026, 8, 1), [
        episodeEvent('e1@rwnd.tv', '2026-09-15'),
        episodeEvent('e2@rwnd.tv', '2026-09-15'),
        episodeEvent('e3@rwnd.tv', '2026-09-15'),
        episodeEvent('e4@rwnd.tv', '2026-09-15'),
        releaseEvent('e5@rwnd.tv', '2026-09-15'),
      ])
      const button = screen.getByRole('button')
      // Two distinct kinds present (episode, release) -> two dots.
      expect(container.querySelectorAll('.bg-\\[var\\(--color-primary\\)\\]')).toHaveLength(1)
      expect(container.querySelectorAll('.bg-\\[var\\(--color-success\\)\\]')).toHaveLength(1)
      expect(within(button).getByText('5')).toBeInTheDocument()
    })

    it("clicking a day opens a dialog listing only that day's events", async () => {
      stubBelowSm()
      renderGrid(new Date(2026, 8, 1), [
        episodeEvent('e1@rwnd.tv', '2026-09-15'),
        episodeEvent('e2@rwnd.tv', '2026-09-16'),
      ])
      await userEvent.click(screen.getByRole('button', { name: /15 .* 1 event/ }))
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getAllByText('An Episode')).toHaveLength(1)
    })

    it("shows a spoiler-hidden episode's fallback title in the sheet, with a reveal control", async () => {
      stubBelowSm()
      renderGrid(new Date(2026, 8, 1), [
        episodeEvent('hidden@rwnd.tv', '2026-09-15', { spoilerHidden: true }),
      ])
      await userEvent.click(screen.getByRole('button'))
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Episode 1')).toBeInTheDocument()
      expect(within(dialog).queryByText('An Episode')).not.toBeInTheDocument()

      await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal spoiler' }))
      expect(within(dialog).getByText('An Episode')).toBeInTheDocument()
    })

    it('closes the dialog via its Close button', async () => {
      stubBelowSm()
      renderGrid(new Date(2026, 8, 1), [episodeEvent('e1@rwnd.tv', '2026-09-15')])
      await userEvent.click(screen.getByRole('button'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('still marks today with aria-current in compact mode', () => {
      stubBelowSm()
      const today = new Date()
      const { container } = renderGrid(today)
      expect(container.querySelector('[aria-current="date"]')).not.toBeNull()
    })
  })
})
