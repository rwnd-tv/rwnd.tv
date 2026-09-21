import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'md' | 'icon'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:opacity-90',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-border)] hover:bg-[var(--color-border)]',
  danger: 'bg-[var(--color-danger)] text-[var(--color-danger-fg)] hover:opacity-90',
  ghost: 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]',
}

// `icon` is the same px-2.5 py-2.5 every icon-only Button call site used to
// hand-roll via `className`, plus a transparent `relative`/`after:-inset-*`
// hit-area expansion — 16px icon + 10px padding is a 36px visible box, and
// the -inset-1 expansion rounds that up to the ~44px platform-guidance
// target without growing what's actually painted. See IconButton.tsx for
// the same reasoning applied to chrome-less icon buttons.
const sizeClasses: Record<Size, string> = {
  md: 'px-4 py-2',
  icon: "relative px-2.5 py-2.5 after:absolute after:-inset-1 after:content-['']",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading, disabled, className = '', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})
