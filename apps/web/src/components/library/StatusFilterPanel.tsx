import type { StatusFilterMode, StatusFilters } from '../../lib/library-filter.js'

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

/** Same plus/minus include/exclude button as GenreFilterPanel.tsx's
 * GenreModeButton — duplicated rather than shared, matching this codebase's
 * existing precedent of one small component per filter section (see
 * ReleaseYearFilterPanel.tsx / WatchedYearFilterPanel.tsx). */
function StatusModeButton({
  mode,
  active,
  onClick,
  label,
}: {
  mode: StatusFilterMode
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
 * ShowsPage.tsx) — same shape as GenreFilterPanel.tsx (a vertical list, each
 * row with an include/exclude icon toggle), but over `shows.status` (a
 * single value per show, e.g. "Returning Series"/"Ended") rather than an
 * array of genres. `statuses` are TMDB's raw canonical strings; `labelFor`
 * maps each to its translated display text (see ShowsPage.tsx) — the panel
 * itself stays free of i18n, same as GenreFilterPanel.tsx does for genre
 * names (which arrive already localized from TMDB).
 */
export function StatusFilterPanel({
  statuses,
  labelFor,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  statuses: string[]
  labelFor: (status: string) => string
  filters: StatusFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: StatusFilters) => StatusFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(status: string, mode: StatusFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[status] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[status]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[status] = mode
      }
      return next
    })
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      {/* w-fit: sizes to the widest row's natural content width, same
          reasoning as GenreFilterPanel.tsx. */}
      <ul className="mt-3 flex w-fit flex-col gap-2">
        {statuses.map((status) => {
          const mode = filters[status]
          const label = labelFor(status)
          return (
            <li key={status} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label}</span>
              <span className="flex shrink-0 items-center gap-1">
                <StatusModeButton
                  mode="include"
                  active={mode === 'include'}
                  onClick={() => setMode(status, 'include')}
                  label={`${includeLabel} ${label}`}
                />
                <StatusModeButton
                  mode="exclude"
                  active={mode === 'exclude'}
                  onClick={() => setMode(status, 'exclude')}
                  label={`${excludeLabel} ${label}`}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
