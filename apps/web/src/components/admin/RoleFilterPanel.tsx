import type { UserRole } from '@rwnd/shared'
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

/** Same plus/minus include/exclude button as library/StatusFilterPanel.tsx's
 * StatusModeButton — duplicated rather than shared, matching this
 * codebase's existing precedent of one small component per filter section. */
function RoleModeButton({
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
 * One collapsible section of the admin Users list's "Filters…" panel (see
 * FiltersPanel.tsx, UsersPanel.tsx) — same shape as
 * library/StatusFilterPanel.tsx (a vertical list, each row with an
 * include/exclude icon toggle), over `role` instead of `status`. Reuses
 * `StatusFilters`/`StatusFilterMode` (library-filter.ts) rather than
 * declaring an identical type — both are just `Record<string, 'include' |
 * 'exclude'>` under the hood, nothing status-specific about the shape.
 */
export function RoleFilterPanel({
  roles,
  labelFor,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  roles: UserRole[]
  labelFor: (role: UserRole) => string
  filters: StatusFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: StatusFilters) => StatusFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(role: UserRole, mode: StatusFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[role] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[role]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[role] = mode
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
          reasoning as StatusFilterPanel.tsx. */}
      <ul className="mt-3 flex w-fit flex-col gap-2">
        {roles.map((role) => {
          const mode = filters[role]
          const label = labelFor(role)
          return (
            <li key={role} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label}</span>
              <span className="flex shrink-0 items-center gap-1">
                <RoleModeButton
                  mode="include"
                  active={mode === 'include'}
                  onClick={() => setMode(role, 'include')}
                  label={`${includeLabel} ${label}`}
                />
                <RoleModeButton
                  mode="exclude"
                  active={mode === 'exclude'}
                  onClick={() => setMode(role, 'exclude')}
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
