import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'neutral' | 'include' | 'exclude'

// No app-wide "success" token exists for the green (only --color-danger
// does) — matches ImportProgress.tsx's precedent of a raw Tailwind palette
// colour for a one-off accent rather than adding a new CSS variable for a
// single use. Originally GenreFilterPanel.tsx's own comment; carried here
// since every include/exclude toggle now shares this file.
const toneClasses: Record<Tone, string> = {
  neutral: 'text-[var(--color-fg-muted)]',
  include: 'text-emerald-500',
  exclude: 'text-[var(--color-danger)]',
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Sets aria-label and title together — every icon-only button in this app
   * wants both set to the same string, so this is one required prop rather
   * than two easily-out-of-sync ones. */
  label: string
  icon: ReactNode
  /** Passed straight through to aria-pressed; leave unset to omit the
   * attribute entirely (WatchlistDetailPage's pin/remove aren't toggles). */
  pressed?: boolean
  /** Which colour `pressed` paints; ignored while not pressed. */
  tone?: Tone
  /** Hover background. 'border' is the default and fits a control sitting on
   * a --color-surface card (the filter panels); 'surface' fits one sitting
   * directly on the page background instead (a poster tile's pin/remove),
   * where 'border' would be identical to 'surface' but going the other way
   * (a --color-surface hover) would be invisible on a --color-surface card. */
  hoverBg?: 'border' | 'surface'
}

/**
 * A transparent, chrome-less icon-only button. Not a Button size: every
 * Button variant paints a background or border at rest, and Button's own
 * `ghost` variant hovers to --color-surface, which is invisible on the
 * surface-coloured cards these sit inside.
 *
 * Visible box is a 32px `p-2` around a 16px icon — kept modest so a long
 * list of these (a 20-genre filter panel) doesn't grow much taller — plus a
 * transparent `-inset-1.5` hit-area expansion, bringing the actual tap
 * target to ~44px to match Apple/Material platform guidance (WCAG 2.5.8's
 * own AA minimum is 24px, already met without this). Callers space adjacent
 * IconButtons `gap-3` (12px) so two 6px expansions meet edge-to-edge with no
 * overlap — closer than that and a tap near the shared edge could land on
 * the wrong button.
 */
export function IconButton({
  label,
  icon,
  pressed,
  tone = 'neutral',
  hoverBg = 'border',
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`relative flex items-center justify-center rounded p-2 transition-colors after:absolute after:-inset-1.5 after:content-[''] disabled:cursor-not-allowed disabled:opacity-60 ${hoverBg === 'border' ? 'hover:bg-[var(--color-border)]' : 'hover:bg-[var(--color-surface)]'} ${pressed ? toneClasses[tone] : toneClasses.neutral} ${className}`}
      {...props}
    >
      {icon}
    </button>
  )
}
