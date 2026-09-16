import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsiblePanel } from './CollapsiblePanel.js'

describe('CollapsiblePanel', () => {
  it('renders a details/summary group whose summary text is exactly the title', () => {
    render(
      <CollapsiblePanel title="Sessions" open={false} onOpenChange={() => {}}>
        body
      </CollapsiblePanel>,
    )
    const group = screen.getByRole('group')
    expect(group.tagName).toBe('DETAILS')
    expect(group.querySelector('summary')?.textContent).toBe('Sessions')
  })

  it('renders no open attribute when closed, and one when open', () => {
    const { rerender } = render(
      <CollapsiblePanel title="Sessions" open={false} onOpenChange={() => {}}>
        body
      </CollapsiblePanel>,
    )
    expect(screen.getByRole('group')).not.toHaveAttribute('open')

    rerender(
      <CollapsiblePanel title="Sessions" open={true} onOpenChange={() => {}}>
        body
      </CollapsiblePanel>,
    )
    expect(screen.getByRole('group')).toHaveAttribute('open')
  })

  it('calls onOpenChange with the new open state when the summary is clicked', async () => {
    const onOpenChange = vi.fn()
    render(
      <CollapsiblePanel title="Sessions" open={false} onOpenChange={onOpenChange}>
        body
      </CollapsiblePanel>,
    )

    await userEvent.click(screen.getByText('Sessions'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('renders the divider by default, and omits it when divider={false}', () => {
    const { container, rerender } = render(
      <CollapsiblePanel title="T" open={true} onOpenChange={() => {}}>
        body
      </CollapsiblePanel>,
    )
    expect(container.querySelector('.border-t')).not.toBeNull()

    rerender(
      <CollapsiblePanel title="T" open={true} onOpenChange={() => {}} divider={false}>
        body
      </CollapsiblePanel>,
    )
    expect(container.querySelector('.border-t')).toBeNull()
  })

  it('puts the danger tone class on the summary, not a child element', () => {
    render(
      <CollapsiblePanel title="Delete account" open={true} onOpenChange={() => {}} tone="danger">
        body
      </CollapsiblePanel>,
    )
    const summary = screen.getByRole('group').querySelector('summary')
    expect(summary).toHaveClass('text-[var(--color-danger)]')
  })

  it('carries both the rotate-on-open class and the flex-shrink guard on the chevron', () => {
    render(
      <CollapsiblePanel title="T" open={true} onOpenChange={() => {}}>
        body
      </CollapsiblePanel>,
    )
    const chevron = screen.getByRole('group').querySelector('svg')
    expect(chevron).toHaveClass('group-open:rotate-180')
    expect(chevron).toHaveClass('h-5', 'w-5', 'flex-shrink-0')
  })
})
