import { type InputHTMLAttributes, useId } from 'react'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  /** Keeps the label in the accessibility tree but hides it visually (e.g. when a placeholder already conveys purpose). */
  hideLabel?: boolean
}

export function Field({ label, error, id, className = '', hideLabel, ...props }: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={inputId}
        className={hideLabel ? 'sr-only' : 'text-sm font-medium text-[var(--color-fg)]'}
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus-visible:border-[var(--color-primary)]"
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
