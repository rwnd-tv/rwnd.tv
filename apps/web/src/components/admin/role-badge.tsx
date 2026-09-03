import type { ReactNode } from 'react'

/** Small inline badge, same shape as SessionsCard.tsx's "This device" chip
 * — no dedicated Badge component exists elsewhere in this app. Shared
 * between `UserRow.tsx` and `AdminUserPage.tsx` (M4 "split the list into a
 * summary list plus a per-user detail page" work, docs/TODO_ARCHIVE.md) —
 * both show the same role/MFA/verified badges, just at different sizes.
 * The role-to-label mapping those two also share lives in
 * `lib/admin-role-labels.ts` instead of here, so this file exports only a
 * component (Fast Refresh works best that way). */
export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: 'muted' | 'primary'
}) {
  return (
    <span
      className={
        tone === 'primary'
          ? 'shrink-0 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-xs font-normal text-[var(--color-primary-fg)]'
          : 'shrink-0 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-xs font-normal text-[var(--color-fg-muted)]'
      }
    >
      {children}
    </span>
  )
}
