import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncludeExcludeToggle } from './IncludeExcludeToggle.js'

describe('IncludeExcludeToggle', () => {
  it('sets both aria-label and title on each button to the given labels', () => {
    render(
      <IncludeExcludeToggle
        value={undefined}
        onSelect={() => {}}
        includeLabel="Include Comedy"
        excludeLabel="Exclude Comedy"
      />,
    )
    const include = screen.getByRole('button', { name: 'Include Comedy' })
    const exclude = screen.getByRole('button', { name: 'Exclude Comedy' })
    expect(include).toHaveAttribute('title', 'Include Comedy')
    expect(exclude).toHaveAttribute('title', 'Exclude Comedy')
  })

  it.each([
    ['include' as const, 'true', 'false'],
    ['exclude' as const, 'false', 'true'],
    ['neutral' as const, 'false', 'false'],
    [undefined, 'false', 'false'],
  ])(
    'reflects value=%s in aria-pressed on each button',
    (value, includePressed, excludePressed) => {
      render(
        <IncludeExcludeToggle
          value={value}
          onSelect={() => {}}
          includeLabel="Include"
          excludeLabel="Exclude"
        />,
      )
      expect(screen.getByRole('button', { name: 'Include' })).toHaveAttribute(
        'aria-pressed',
        includePressed,
      )
      expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute(
        'aria-pressed',
        excludePressed,
      )
    },
  )

  it('calls onSelect with the clicked mode, even when it is already active', async () => {
    const onSelect = vi.fn()
    render(
      <IncludeExcludeToggle
        value="include"
        onSelect={onSelect}
        includeLabel="Include"
        excludeLabel="Exclude"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Include' }))
    expect(onSelect).toHaveBeenCalledWith('include')

    await userEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    expect(onSelect).toHaveBeenCalledWith('exclude')
  })

  it('carries the hit-area expansion class on each button', () => {
    render(
      <IncludeExcludeToggle
        value={undefined}
        onSelect={() => {}}
        includeLabel="Include"
        excludeLabel="Exclude"
      />,
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('after:-inset-1.5')
    }
  })
})
