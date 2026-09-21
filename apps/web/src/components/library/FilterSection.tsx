import type { ReactNode } from 'react'

/**
 * The `<details><summary>` shell every filter panel section renders
 * (GenreFilterPanel, ui/KeyedFilterPanel, ui/BooleanFilterPanel, …) —
 * extracted here so the panels stop hand-rolling an identical shell and
 * can't drift again. Zero visual/behavioral change from what each one
 * already rendered: uncontrolled, closed by default, no state of its own.
 * Each panel still owns everything inside it.
 */
export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {title}
      </summary>
      {children}
    </details>
  )
}
