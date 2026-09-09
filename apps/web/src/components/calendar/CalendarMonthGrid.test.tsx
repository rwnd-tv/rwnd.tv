import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { CalendarMonthGrid } from './CalendarMonthGrid.js'

function episodeEvent(uid: string, date: string): Extract<CalendarEvent, { kind: 'episode' }> {
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
  }
}

function renderGrid(monthAnchor: Date, events: CalendarEvent[] = [], locale = 'en-GB') {
  return render(
    <MemoryRouter>
      <CalendarMonthGrid
        monthAnchor={monthAnchor}
        events={events}
        locale={locale}
        selectedDay={null}
        onSelectDay={vi.fn()}
      />
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
})
