import { MinusIcon, PlusIcon } from '../icons.js'
import { IconButton } from './IconButton.js'

export type IncludeExcludeMode = 'include' | 'exclude'

/**
 * The plus/minus include/exclude row shared by every filter panel that
 * offers one: GenreFilterPanel, StatusFilterPanel, MyRatingFilterPanel,
 * WatchedYearFilterPanel, DroppedFilterPanel (library), and RoleFilterPanel,
 * MfaFilterPanel, VerifiedFilterPanel (admin). Those eight used to each
 * hand-roll an identical `*ModeButton` — a deliberate duplication at the
 * time (see this file's own history), reversed here because the control
 * also needed the IconButton hit-area fix, and fixing eight copies
 * separately would drift again.
 *
 * Deliberately not generic: every one of the eight panels' own mode types
 * (`GenreFilterMode`, `Exclude<UnratedMode, 'neutral'>`, etc.) is
 * structurally `'include' | 'exclude'`, so a single non-generic
 * `IncludeExcludeMode` is mutually assignable with all of them. Each panel
 * keeps its own union on its own state/setter; only this leaf control
 * speaks the shared two-value one.
 */
export function IncludeExcludeToggle({
  value,
  onSelect,
  includeLabel,
  excludeLabel,
}: {
  /** The active rule, if any. Accepts `'neutral'` and `undefined` so both
   * the tri-state panels (which use `'neutral'`) and the per-item map-based
   * panels (where a missing entry means `undefined`) can pass their value
   * straight through with no narrowing at the call site. */
  value: IncludeExcludeMode | 'neutral' | undefined
  /** Always reports the *clicked* mode, even when it's already active.
   * Clearing an already-active rule stays the caller's job: the eight
   * panels mean different things by it (delete a map entry vs. fall back to
   * `'neutral'`). */
  onSelect: (mode: IncludeExcludeMode) => void
  /** Already composed and localized by the caller (e.g. `${includeLabel}
   * ${genre}`) — this component stays i18n-free, same as the panels it
   * replaces a piece of. */
  includeLabel: string
  excludeLabel: string
}) {
  return (
    <span className="flex shrink-0 items-center gap-3">
      <IconButton
        label={includeLabel}
        icon={<PlusIcon />}
        pressed={value === 'include'}
        tone="include"
        onClick={() => onSelect('include')}
      />
      <IconButton
        label={excludeLabel}
        icon={<MinusIcon />}
        pressed={value === 'exclude'}
        tone="exclude"
        onClick={() => onSelect('exclude')}
      />
    </span>
  )
}
