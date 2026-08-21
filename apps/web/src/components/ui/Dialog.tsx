import { type ReactNode, useEffect, useId, useRef } from 'react'

/**
 * Generic modal dialog, built on the native `<dialog>` element rather than
 * a library — no modal/dialog primitive existed anywhere in this app
 * before, and there's no dialog/focus-trap dependency in package.json,
 * matching the rest of the app's zero-dependency pattern.
 * `showModal()`/`close()` give focus trapping, Escape-to-close, and
 * top-layer + `::backdrop` rendering for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Fires on Escape or any dialog.close() call (including the one
      // above when `open` flips to false) — covers cancel-by-Escape for
      // free, no separate keydown handler needed.
      onClose={onClose}
      // A native <dialog> fills the backdrop area with itself when shown
      // via showModal() — a click landing on the dialog element and not
      // one of its children is a backdrop click.
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      // The UA stylesheet centers an open <dialog> via `margin: auto` on
      // a fixed-position box, but Tailwind's preflight resets margin to 0
      // on every element first — positioned explicitly here instead of
      // relying on that.
      className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-fg)] backdrop:bg-black/60"
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
