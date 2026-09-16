import type { ReactNode } from 'react'
import { Card } from './Card.js'
import { ChevronDownIcon } from '../icons.js'

type Tone = 'default' | 'danger'

const toneClasses: Record<Tone, string> = {
  default: '',
  danger: 'text-[var(--color-danger)]',
}

/**
 * The `<Card>` + `<details>`/`<summary>` + chevron shell duplicated by hand
 * across 27 collapsible panels on Account/Settings/Admin/Import (M4
 * review's `/code-review high` pass, docs/TODO.md). Takes `open` and
 * `onOpenChange` rather than owning `usePanelOpen` itself — this is the
 * first `components/ui/` file to import out of `ui/` at all
 * (`../icons.js`), and it stays that way deliberately: ImportProgress.tsx
 * force-opens its panel from its own effect, which needs the caller to
 * keep control of the open state.
 *
 * `title` is plain text, not `ReactNode` — several tests
 * (`AdminUserPage.test.tsx`) read `summary.textContent` verbatim.
 *
 * Deliberately has no `description`/`actions` slot: the body varies too
 * freely across the 27 (absent, one paragraph, two stacked paragraphs, a
 * two-column status row) to generalize without just becoming another
 * `ReactNode` prop, so it stays `children`. Also deliberately doesn't try
 * to cover `CalendarFeedsPanel.tsx`'s `FeedRow` (a separate, structurally
 * different not-yet-built collapsible with a real heading, a description,
 * *and* right-hand action buttons) — every prop here is optional with a
 * default, so extending this later costs nothing against the 27 call sites
 * that exist today.
 */
export function CollapsiblePanel({
  title,
  open,
  onOpenChange,
  tone = 'default',
  divider = true,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  tone?: Tone
  divider?: boolean
  children: ReactNode
}) {
  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
        <summary
          className={`flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden ${toneClasses[tone]}`}
        >
          {title}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        {divider && <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />}
        {children}
      </details>
    </Card>
  )
}
