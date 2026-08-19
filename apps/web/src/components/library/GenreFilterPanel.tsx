import type { GenreFilterMode, GenreFilters } from '../../lib/library-filter.js'

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  )
}

/** Grey when off; green for a selected include, red for a selected exclude.
 * No app-wide "success" token exists for the green (only `--color-danger`
 * does, reused here for red) — matches ImportProgress.tsx's existing
 * precedent of raw Tailwind palette colours for one-off accents rather than
 * adding a new CSS variable for a single use. */
function GenreModeButton({
  mode,
  active,
  onClick,
  label,
}: {
  mode: GenreFilterMode
  active: boolean
  onClick: () => void
  label: string
}) {
  const activeClass = mode === 'include' ? 'text-emerald-500' : 'text-[var(--color-danger)]'
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex items-center justify-center rounded p-1 hover:bg-[var(--color-border)] ${
        active ? activeClass : 'text-[var(--color-fg-muted)]'
      }`}
    >
      {mode === 'include' ? <PlusIcon /> : <MinusIcon />}
    </button>
  )
}

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * ShowsPage.tsx) — the card itself is the parent's job, this is just its
 * `<details>` content. A single vertical list, one row per genre present in
 * the library, each with a plus (include) and minus (exclude) icon button
 * rather than a single tri-state control — a toggle button, not a
 * checkbox, is what let each one be clicked again to fall back to "no
 * rule" while still rendering as an icon rather than a native checkbox
 * square.
 */
export function GenreFilterPanel({
  genres,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  genres: string[]
  filters: GenreFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: GenreFilters) => GenreFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(genre: string, mode: GenreFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[genre] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[genre]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[genre] = mode
      }
      return next
    })
  }

  return (
    // Native <details>/<summary> — same collapsible pattern already used
    // for the failure list in ImportProgress.tsx: a real disclosure
    // triangle for free, closed by default, no extra state to manage.
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      {/* w-fit: sizes to the widest row's natural content width (longest
          genre name + icons), so each shorter row's justify-between icons
          land close to that same right edge instead of being spread across
          the full card width. */}
      <ul className="mt-3 flex w-fit flex-col gap-2">
        {genres.map((genre) => {
          const mode = filters[genre]
          return (
            <li key={genre} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{genre}</span>
              <span className="flex shrink-0 items-center gap-1">
                <GenreModeButton
                  mode="include"
                  active={mode === 'include'}
                  onClick={() => setMode(genre, 'include')}
                  label={`${includeLabel} ${genre}`}
                />
                <GenreModeButton
                  mode="exclude"
                  active={mode === 'exclude'}
                  onClick={() => setMode(genre, 'exclude')}
                  label={`${excludeLabel} ${genre}`}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
