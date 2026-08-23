import type { ReactNode } from 'react'

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * Blurs spoiler-ish content (an episode still, an overview paragraph) behind
 * a click-to-reveal overlay. Purely presentational — `hidden` decides
 * whether a guard applies at all (skips rendering the wrapper entirely when
 * false, e.g. once the underlying episode/season/show is watched), and
 * `revealed`/`onReveal` are owned by the caller rather than this component's
 * own state, so several guards can share one reveal action (see
 * EpisodeDetailPage.tsx, where revealing the still also reveals the
 * overview). Deliberately never persists a reveal anywhere — new state each
 * mount means navigating away and back re-hides everything, so a reveal
 * can't accidentally carry into a later, unrelated viewing.
 */
export function SpoilerGuard({
  hidden,
  revealed,
  onReveal,
  revealLabel,
  blurClassName = 'blur-md',
  className = '',
  overlayClassName = '',
  children,
}: {
  hidden: boolean
  revealed: boolean
  onReveal: () => void
  revealLabel: string
  /** Tailwind blur utility for the hidden content — the default suits
   * small/medium text and images; pass a stronger one for anything large
   * enough to stay legible at `blur-md`. */
  blurClassName?: string
  className?: string
  /** Color/background classes for the reveal button — no default, since a
   * dark image scrim and a text block over the page background need
   * different treatments; every call site sets its own. */
  overlayClassName?: string
  children: ReactNode
}) {
  if (!hidden) return <>{children}</>
  return (
    <div className={`relative ${className}`}>
      <div className={revealed ? '' : `${blurClassName} select-none`} aria-hidden={!revealed}>
        {children}
      </div>
      {!revealed && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onReveal()
          }}
          className={`absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium ${overlayClassName}`}
        >
          <EyeIcon />
          {revealLabel}
        </button>
      )}
    </div>
  )
}
