import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's default `sm` breakpoint (640px), expressed as its complement —
 * "below sm" is what every consumer of this actually wants to know.
 * Layout.tsx has its own separate '(max-width: 639px)' constant predating
 * this hook; not unified with it here since Layout's read is deliberately a
 * one-shot (see its own comment), not a subscription. */
export const BELOW_SM_QUERY = '(max-width: 639px)'

/**
 * Subscribes to a media query via `useSyncExternalStore`, so a component
 * re-renders across a resize/rotation rather than reading the breakpoint
 * once at mount (contrast Layout.tsx's `closeSidebarIfMobile`, which
 * deliberately wants a one-shot read). No first-paint flash of the wrong
 * value: unlike a `useState` + `useEffect` pair, the initial render already
 * reflects the real `matchMedia` result.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot)
}
