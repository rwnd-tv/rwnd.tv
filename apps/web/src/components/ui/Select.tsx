import { type SelectHTMLAttributes, useId } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  /** Keeps the label in the accessibility tree but hides it visually (e.g. when adjacent context already conveys purpose). */
  hideLabel?: boolean
}

/** Native `<select>`, deliberately — keyboard nav, mobile wheel pickers, and
 * screen-reader support all come for free, which a custom listbox would
 * have to rebuild. Mirrors Field.tsx's shape (label/id/hideLabel) so the
 * two are interchangeable in a form row. */
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
      <select
        id={selectId}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus-visible:border-[var(--color-primary)]"
        {...props}
      >
        {children}
      </select>
    </div>
  )
}
