import { type SelectHTMLAttributes, useId } from 'react'
import { ChevronDownIcon } from '../icons.js'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  /** Keeps the label in the accessibility tree but hides it visually (e.g. when adjacent context already conveys purpose). */
  hideLabel?: boolean
}

/** Native `<select>`, deliberately — keyboard nav, mobile wheel pickers, and
 * screen-reader support all come for free, which a custom listbox would
 * have to rebuild. Mirrors Field.tsx's shape (label/id/hideLabel) so the
 * two are interchangeable in a form row.
 *
 * The native arrow is replaced with `ChevronDownIcon` (appearance-none +
 * an absolutely-positioned overlay) so its inset matches the select's own
 * `px-3` text padding instead of sitting flush against the edge. */
export function Select({ label, id, className = '', hideLabel, children, ...props }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={selectId}
        className={hideLabel ? 'sr-only' : 'text-sm font-medium text-[var(--color-fg)]'}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 pr-9 text-sm text-[var(--color-fg)] outline-none focus-visible:border-[var(--color-primary)]"
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-muted)]" />
      </div>
    </div>
  )
}
