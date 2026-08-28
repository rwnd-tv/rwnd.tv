import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WatchHistoryTable } from './WatchHistoryTable.js'

async function openHistory() {
  await userEvent.click(screen.getByText('History'))
}

describe('WatchHistoryTable', () => {
  it('shows only the Date/Time/Type columns when Season/Episode are both off', async () => {
    render(
      <WatchHistoryTable
        watches={[{ id: 'w1', watchedAt: '2026-01-01T10:00:00.000Z', source: 'manual' }]}
        showSeasonColumn={false}
        showEpisodeColumn={false}
        locale="en-GB"
        isDeleting={false}
        onDeleteSelected={vi.fn()}
      />,
    )
    await openHistory()

    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.queryByText('Season')).not.toBeInTheDocument()
    expect(screen.queryByText('Episode')).not.toBeInTheDocument()
  })

  it('shows Season/Episode columns when asked, falling back to a generic label for an untitled episode', async () => {
    render(
      <WatchHistoryTable
        watches={[
          {
            id: 'w1',
            watchedAt: '2026-01-01T10:00:00.000Z',
            source: 'manual',
            seasonNumber: 0,
            episodeNumber: 1,
            episodeTitle: null,
          },
          {
            id: 'w2',
            watchedAt: '2026-01-02T10:00:00.000Z',
            source: 'plex',
            seasonNumber: 1,
            episodeNumber: 5,
            episodeTitle: 'Ozymandias',
          },
        ]}
        showSeasonColumn
        showEpisodeColumn
        locale="en-GB"
        isDeleting={false}
        onDeleteSelected={vi.fn()}
      />,
    )
    await openHistory()

    expect(screen.getByText('Season')).toBeInTheDocument()
    expect(screen.getByText('Episode')).toBeInTheDocument()
    expect(screen.getByText('Specials')).toBeInTheDocument()
    expect(screen.getByText('Episode 1')).toBeInTheDocument()
    expect(screen.getByText('Ozymandias')).toBeInTheDocument()
  })

  it('shows a loading status while watches is still undefined, not the table', async () => {
    render(
      <WatchHistoryTable
        watches={undefined}
        showSeasonColumn={false}
        showEpisodeColumn={false}
        locale="en-GB"
        isDeleting={false}
        onDeleteSelected={vi.fn()}
      />,
    )
    await openHistory()

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('confirming the delete dialog calls onDeleteSelected with just the checked ids', async () => {
    const onDeleteSelected = vi.fn()
    render(
      <WatchHistoryTable
        watches={[
          { id: 'w1', watchedAt: '2026-01-01T10:00:00.000Z', source: 'manual' },
          { id: 'w2', watchedAt: '2026-01-02T10:00:00.000Z', source: 'manual' },
        ]}
        showSeasonColumn={false}
        showEpisodeColumn={false}
        locale="en-GB"
        isDeleting={false}
        onDeleteSelected={onDeleteSelected}
      />,
    )
    await openHistory()

    const deleteButton = screen.getByRole('button', { name: 'Delete selected episodes' })
    expect(deleteButton).toBeDisabled()

    const [firstCheckbox] = screen.getAllByRole('checkbox')
    await userEvent.click(firstCheckbox!)
    expect(deleteButton).toBeEnabled()

    await userEvent.click(deleteButton)
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove selected watches' }))

    expect(onDeleteSelected).toHaveBeenCalledTimes(1)
    expect(onDeleteSelected).toHaveBeenCalledWith(['w1'], expect.any(Function))
  })

  it("clears the selection and closes the dialog once onDeleteSelected's own onSuccess runs", async () => {
    let capturedOnSuccess: (() => void) | undefined
    const onDeleteSelected = vi.fn((_ids: string[], onSuccess: () => void) => {
      capturedOnSuccess = onSuccess
    })
    render(
      <WatchHistoryTable
        watches={[{ id: 'w1', watchedAt: '2026-01-01T10:00:00.000Z', source: 'manual' }]}
        showSeasonColumn={false}
        showEpisodeColumn={false}
        locale="en-GB"
        isDeleting={false}
        onDeleteSelected={onDeleteSelected}
      />,
    )
    await openHistory()

    await userEvent.click(screen.getByRole('checkbox'))
    const deleteButton = screen.getByRole('button', { name: 'Delete selected episodes' })
    await userEvent.click(deleteButton)
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected watches' }),
    )

    expect(capturedOnSuccess).toBeDefined()
    // Simulates the real caller's mutation onSuccess firing asynchronously
    // (after the network round trip), unlike the userEvent clicks above —
    // needs an explicit act() since nothing else is flushing this update.
    act(() => capturedOnSuccess!())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(deleteButton).toBeDisabled()
  })
})
